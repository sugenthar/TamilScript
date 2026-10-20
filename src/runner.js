'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('node:url');
const { transform, transformWithMap } = require('./transformer');
const { mapGeneratedPosition } = require('./sourcemap');
const { buildTransformedTree, cleanupTempFiles, findPackageType, tempExtensionFor } = require('./imports');
const { PRINT_HELPER_NAME } = require('./runtime');
const { formatDiagnostic } = require('./errors');

// Absolute file URL of the side-effect runtime setup (src/register.js).
// A file URL (not a bare path) is required: `--import` resolves its argument
// as a module specifier, and Windows backslash paths are not valid there.
const REGISTER_URL = pathToFileURL(path.join(__dirname, 'register.js')).href;

/**
 * Whether this Node.js runtime supports `node --import` for automatic
 * setup of the Tamil print helper (`module.register` shipped in the same
 * releases: Node 18.19+, 20.6+).
 * @returns {boolean}
 */
function supportsPrintRuntime() {
  try {
    return typeof require('node:module').register === 'function';
  } catch (err) {
    void err;
    return false;
  }
}

/**
 * Extra `node` flags for executing a transformed tree: `--import` the
 * runtime setup only when the program mentions the Tamil print helper.
 * Programs that never mention it spawn exactly as before.
 * @param {{ usesPrintHelper?: boolean }} tree result of buildTransformedTree
 * @returns {string[]} flags to insert before the entry path
 */
function printRuntimeArgs(tree) {
  if (tree && tree.usesPrintHelper && supportsPrintRuntime()) {
    return ['--import', REGISTER_URL];
  }
  return [];
}

/**
 * Actionable error for programs that mention the Tamil print helper on a
 * Node.js too old for automatic setup. Returns null when runnable.
 * @param {{ usesPrintHelper?: boolean }} tree result of buildTransformedTree
 * @param {boolean} [supported] override for tests; defaults to supportsPrintRuntime()
 * @returns {Error|null}
 */
function printRuntimeError(tree, supported) {
  const ok = supported !== undefined ? supported : supportsPrintRuntime();
  if (tree && tree.usesPrintHelper && !ok) {
    return new Error(
      `This program uses the Tamil print helper "${PRINT_HELPER_NAME}", ` +
        `which needs automatic runtime setup (Node.js 18.19+ or 20.6+). ` +
        `You are running Node ${process.version}. Upgrade Node.js, or import ` +
        `the helper explicitly: require('tamilscript/runtime') / ` +
        `import ... from 'tamilscript/runtime'.`
    );
  }
  return null;
}

/**
 * Decide which temporary file extension preserves the source module semantics.
 * @param {string} sourceFile
 * @param {string} source
 * @returns {Promise<string>} e.g. '.mjs', '.cjs' or '.js'
 */
async function pickTempExtension(sourceFile, source) {
  return tempExtensionFor(path.resolve(sourceFile), source);
}

/**
 * Build the node argument array for executing a transformed tree.
 * Node flags (e.g. `--inspect=host:port`) come first, then the fixed
 * `--enable-source-maps`, the optional print-helper `--import`, the script
 * path and finally the program arguments.
 *
 * @param {{ usesPrintHelper?: boolean }} tree result of buildTransformedTree
 * @param {{ nodeFlags?: string[], scriptPath: string, programArgs?: string[] }} options
 * @returns {string[]}
 */
function buildSpawnArgs(tree, options) {
  const opts = options || {};
  return [
    ...(opts.nodeFlags || []),
    '--enable-source-maps',
    ...printRuntimeArgs(tree),
    opts.scriptPath,
    ...(opts.programArgs || []),
  ];
}

/**
 * Environment for the child process that executes a program.
 *
 * Program stdout/stderr are forwarded unchanged, so they must not gain ANSI
 * color from the ambient environment: Node's console colorizes non-string
 * arguments (numbers, objects) as soon as the output stream reports color
 * support, and `FORCE_COLOR` provides that support even for pipes — which
 * would silently change exact program output in shells, CI systems, and
 * editors that happen to set it. Dropping the forcing variable keeps piped
 * and captured output byte-exact; a real terminal still auto-colorizes, and
 * a program that wants color can use a color library (or set the variable
 * itself). `NO_COLOR` is left untouched: an explicit no-color request is
 * honored by Node.
 *
 * @returns {NodeJS.ProcessEnv} a copy of the current environment without FORCE_COLOR
 */
function programEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    // Windows environment variables are case-insensitive.
    if (key.toUpperCase() === 'FORCE_COLOR') delete env[key];
  }
  return env;
}

/**
 * Run a TamilScript file: transform it, execute the result with Node.js,
 * forward stdio/args/exit codes, and clean up the temp file.
 *
 * Code is never executed via eval/new Function; it runs as a real file
 * in a child Node.js process (argument array form — no shell).
 *
 * @param {string} filePath
 * @param {string[]} [extraArgs] forwarded to the program (after the script path)
 * @param {{ nodeFlags?: string[] }} [options]
 *   `nodeFlags` are extra node options inserted before the script (used by
 *   `run --inspect`/`--inspect-brk`).
 * @returns {Promise<number>} the child exit code
 */
async function runFile(filePath, extraArgs, options) {
  const opts = options || {};
  const absFile = path.resolve(filePath);
  let source;
  try {
    source = await fs.promises.readFile(absFile, 'utf8');
  } catch (err) {
    const wrapped = new Error(`Cannot read file ${JSON.stringify(absFile)}: ${err.message}`);
    wrapped.code = err.code || 'JST_READ_ERROR';
    wrapped.cause = err;
    throw wrapped;
  }
  const transformed = transform(source, { filename: absFile });
  // Transform relative JS dependencies too, rewriting their specifiers to
  // the transformed siblings (see src/imports.js). Temp files live next to
  // their originals so nested relative imports keep resolving. Inline
  // source maps keep runtime stack traces pointed at the original files.
  const tree = await buildTransformedTree(absFile, transformed, {
    entrySource: source,
    withMaps: true,
  });
  const tempPath = tree.entryTemp;
  const args = Array.isArray(extraArgs) ? extraArgs : [];
  const spawnArgs = buildSpawnArgs(tree, {
    nodeFlags: opts.nodeFlags,
    scriptPath: tempPath,
    programArgs: args,
  });
  const runtimeErr = printRuntimeError(tree);
  try {
    if (runtimeErr) throw runtimeErr;
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, spawnArgs, {
        stdio: ['inherit', 'inherit', 'inherit'],
        env: programEnv(),
      });
      // Ctrl+C / SIGTERM while the program runs: stop the child and let the
      // normal cleanup in the `finally` below remove the transformed temp
      // files, then report the conventional 128+signal exit code. Without a
      // handler the parent would die on the default signal action and leak
      // those temps (a later run cannot sweep another process's temps).
      // `once` means a second Ctrl+C still force-kills the parent.
      const removeSignalHandlers = () => {
        process.removeListener('SIGINT', onSigint);
        process.removeListener('SIGTERM', onSigterm);
      };
      const onSigint = () => {
        try {
          child.kill('SIGINT');
        } catch (err) {
          void err;
        }
      };
      const onSigterm = () => {
        try {
          child.kill('SIGTERM');
        } catch (err) {
          void err;
        }
      };
      process.once('SIGINT', onSigint);
      process.once('SIGTERM', onSigterm);
      child.on('error', (err) => {
        removeSignalHandlers();
        reject(err);
      });
      child.on('close', (c, signal) => {
        removeSignalHandlers();
        if (c != null) resolve(c);
        else if (signal === 'SIGINT') resolve(130);
        else if (signal === 'SIGTERM') resolve(143);
        else resolve(1);
      });
    });
    return code;
  } finally {
    await cleanupTempFiles(tree.tempFiles);
  }
}

/**
 * Turn `node --check` stderr into a diagnostic against the original
 * TamilScript source: map the reported generated line/caret column back
 * through the scanner's token anchors and show the original source line with
 * the caret at the original column. Falls back to the path-rewritten Node
 * output when the report cannot be parsed.
 *
 * @param {string} stderr raw `node --check` stderr
 * @param {string} tempPath temporary checked file
 * @param {string} absFile original file path
 * @param {string} source original TamilScript source
 * @param {Array} [positions] scanner token anchors for the entry file
 * @returns {string}
 */
function renderCheckFailure(stderr, tempPath, absFile, source, positions) {
  const text = String(stderr || 'Syntax check failed.');
  const escaped = tempPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const loc = text.match(new RegExp(`${escaped}:(\\d+)(?::(\\d+))?`));
  const fallback = () => text.split(tempPath).join(absFile).trim();
  if (!loc) return fallback();
  const genLine = Number(loc[1]);
  let genCol = loc[2] != null ? Number(loc[2]) : null;
  if (genCol == null) {
    // Node `--check` prints the offending line and a caret but no column.
    const caret = text.match(/^([ \t]*)\^/m);
    if (caret) genCol = caret[1].length + 1;
  }
  if (!positions || genCol == null || !genLine) return fallback();
  const mapped = mapGeneratedPosition(positions, genLine, genCol);
  const srcLines = String(source).split(/\r\n|\r|\n/);
  const lineText = srcLines[mapped.line - 1] != null ? srcLines[mapped.line - 1] : '';
  const messageMatch = text.match(/^[^\n]*Error:[^\n]*$/m);
  const message = messageMatch ? messageMatch[0] : 'SyntaxError';
  const caretPrefix = ' '.repeat(String(mapped.line).length + 3) + '| ';
  const caretCol = Math.min(mapped.column, lineText.length + 1);
  return [
    `${absFile}:${mapped.line}:${mapped.column}`,
    message,
    `  ${mapped.line} | ${lineText}`,
    `${caretPrefix}${' '.repeat(Math.max(0, caretCol - 1))}^`,
  ].join('\n');
}

/**
 * Validate a TamilScript file without executing it: transform it, then run
 * `node --check` on the transformed output. Returns diagnostics.
 *
 * @param {string} filePath
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
async function checkFile(filePath) {
  const absFile = path.resolve(filePath);
  let source;
  try {
    source = await fs.promises.readFile(absFile, 'utf8');
  } catch (err) {
    return { ok: false, errors: [`Cannot read file ${absFile}: ${err.message}`] };
  }
  let transformed;
  let entryPositions;
  try {
    const first = transformWithMap(source, { filename: absFile });
    transformed = first.code;
    entryPositions = first.positions;
  } catch (err) {
    return { ok: false, errors: [formatDiagnostic(err, { source })] };
  }
  // Transform dependencies as well so `node --check` sees runnable code.
  let tree;
  try {
    tree = await buildTransformedTree(absFile, transformed, {
      entrySource: source,
      withMaps: true,
    });
  } catch (err) {
    // Dependency diagnostics already carry their own filename; the entry
    // source is only a fallback for location-less errors.
    const withSource = err && err.filename ? undefined : { source };
    return { ok: false, errors: [formatDiagnostic(err, withSource)] };
  }
  const tempPath = tree.entryTemp;
  try {
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['--check', tempPath], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += String(d); });
      child.on('close', (code) => resolve({ code: code == null ? 1 : code, stderr }));
      child.on('error', (e) => resolve({ code: 1, stderr: String((e && e.message) || e) }));
    });
    if (result.code === 0) {
      return { ok: true, errors: [] };
    }
    // Render the failure against the ORIGINAL source: map Node's generated
    // line/caret back through the token anchors, then show the original line
    // with the caret at its original column (`file:line:column` header).
    const stderr = String(result.stderr || 'Syntax check failed.');
    const positions = tree.entryPositions && tree.entryPositions.length
      ? tree.entryPositions
      : entryPositions;
    const rendered = renderCheckFailure(stderr, tempPath, absFile, source, positions);
    return { ok: false, errors: [rendered] };
  } finally {
    await cleanupTempFiles(tree.tempFiles);
  }
}

module.exports = {
  runFile,
  checkFile,
  pickTempExtension,
  supportsPrintRuntime,
  printRuntimeArgs,
  printRuntimeError,
  buildSpawnArgs,
  programEnv,
  _findPackageType: findPackageType,
};
