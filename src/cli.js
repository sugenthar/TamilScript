'use strict';

const fs = require('fs');
const path = require('path');
const { transformFile, writeFileAtomic } = require('./transform-file');
const { addStandaloneRuntime } = require('./standalone');
const { transform } = require('./transformer');
const { formatSource } = require('./format');
const { runFile, checkFile } = require('./runner');
const { watchAndRun } = require('./watch');
const { runRepl } = require('./repl');
const {
  Category,
  label,
  isTamilLanguage,
  suggestFix,
  formatProblem,
  formatCliError,
} = require('./diagnostics');
const { initProject } = require('./scaffold');
const { runProjectTest } = require('./project-test');
const { runDoctor, formatReport } = require('./doctor');
const { lintPath, formatLintReport } = require('./lint');
const { VERSION } = require('./index');

const USAGE = `TamilScript ${VERSION} — write JavaScript with Tamil literals

Usage:
  tamilscript run [--watch] [--inspect[=host:port]] <file.js> [-- args...]
  tamilscript transform <input.js> -o <out.js> [--force] [--stdout] [--explain] [--source-map]
  tamilscript check <file.js>
  tamilscript format <file.js> [--check]
  tamilscript lint <file-or-directory>
  tamilscript init [directory] [--force]
  tamilscript test
  tamilscript doctor
  tamilscript repl
  tamilscript --version
  tamilscript --help | tamilscript <command> --help

Commands:
  run         Transform and execute a TamilScript file (and its relative deps).
              Program arguments after the file (or after --) are forwarded.
    --watch   Rerun on changes to the entry file or tracked dependencies.
    --inspect[=host:port], --inspect-brk[=host:port]
              Start the Node.js inspector for the run (port 0 = random).
  transform   Transform a file without executing it. Requires -o/--output
              or --stdout. Never overwrites the input unless --force.
    --explain Print which custom literals were transformed and where.
              (Conflicts with --stdout; string contents are truncated.)
    --source-map
              Write an external <out>.map source map alongside the output.
  check       Validate TamilScript syntax and transformed JS without executing.
  format      Conservatively normalize whitespace: remove trailing spaces
              and tabs, and add a missing final line break. Never touches
              whitespace inside strings, templates, comments or regex.
              With --check, report whether a file would change (exit 1)
              without writing anything.
  lint        Check a file or directory for high-confidence problems:
              malformed/unsupported TamilScript literals (OT001) and
              JavaScript syntax errors in the transformed output (OT002,
              \`node --check\`). Recursive; skips node_modules and .git.
              At most one problem per file is reported (the first).
  init        Create a starter TamilScript project in [directory] (default:
              the current directory): package.json, README.md, src/app.ot.js
              and test/app.test.js. Refuses to overwrite existing files
              unless --force is passed.
  test        Run the "test" script from the package.json in the current
              directory via npm, preserving output and exit code.
  doctor      Check the local Node.js/npm setup, the running CLI, the
              tamilscript installation, package.json validity and the entry
              files referenced by npm scripts.
  repl        Start an interactive session for TamilScript expressions and
              statements (multiline input, persistent variables).
              .help, .clear, .exit; Ctrl+C clears input; Ctrl+D exits.

Global options:
  --tamil     Print CLI-authored labels and fixed messages in Tamil where a
              tested translation exists (English fallback otherwise).
              Also enabled by the TAMILSCRIPT_LANG=tamil environment variable.

Exit codes:
  0  success (for run: the program's own exit code; for test: npm's)
  1  transformation, runtime, check, I/O, init, test, or doctor failure
  2  usage error (unknown command, conflicting or missing arguments)

Examples:
  tamilscript run examples/basic.js
  tamilscript run --watch program.js
  tamilscript run program.js -- arg1 arg2
  tamilscript transform input.js -o output.js
  tamilscript transform input.js --explain -o output.js
  tamilscript check program.js
  tamilscript init my-app && cd my-app && npm install && npm start
  tamilscript doctor
`;

const RUN_HELP = `Usage: tamilscript run [--watch] [--inspect[=host:port]] <file.js> [-- args...]

Transform and execute a TamilScript file with the normal Node.js runtime.

  <file.js>   Entry file to run.
              Programs using the Tamil print helper receive it automatically
              (needs Node.js 18.19+ or 20.6+; otherwise import tamilscript/runtime).
  --watch     Rerun when the entry file or a tracked relative dependency
              changes. Only watched files trigger reruns; Ctrl+C stops.
  --inspect[=host:port]
  --inspect-brk[=host:port]
              Start the Node.js inspector for the run (forwarded to node).
              --inspect-brk pauses before user code until a debugger attaches.
              Default host:port is 127.0.0.1:9229; use port 0 for a random
              free port. Inline source maps keep debugger positions and
              stack traces on the original .js files.
  --          Everything after -- is forwarded to the program verbatim.
  args...     Without --, arguments after the file are also forwarded,
              except --watch and inspector flags (use -- to pass those
              through literally).

Exit codes: program's exit code on success; 1 on errors; 2 on usage errors.
`;

const TRANSFORM_HELP = `Usage: tamilscript transform <input.js> -o <output.js> [--force] [--stdout] [--explain] [--source-map]

Transform TamilScript source into standard JavaScript without executing it.

  -o, --output <file>  Destination for transformed output (required unless
                       --stdout). Parent directories are created.
                       Conflicts with --stdout.
  --force              Allow overwriting the input file with the output.
  --stdout             Write transformed code to stdout instead of a file.
  --explain            Print a summary of transformed literals (type and
                       location; string contents truncated) to stdout.
                       Conflicts with --stdout.
  --source-map         Write an external source map (<output>.map) and append
                       a sourceMappingURL comment. Requires -o/--output.

Exit codes: 0 success; 1 transformation or I/O failure; 2 usage errors.
`;

const CHECK_HELP = `Usage: tamilscript check <file.js>

Validate TamilScript syntax and the transformed JavaScript without executing.

Exit codes: 0 valid; 1 invalid or unreadable; 2 usage errors.
`;

const FORMAT_HELP = `Usage: tamilscript format <file.js> [--check]

Conservatively normalize one file's whitespace, in place:

  - trailing spaces/tabs (and \\v/\\f) at end of line are removed;
  - lines containing only such whitespace become empty lines;
  - a missing final line break is added (CRLF files keep CRLF).

Whitespace inside JavaScript strings, template literals, comments and
regular expressions is never touched (the core lexer records those
protected spans). Files that do not transform are refused unchanged,
so malformed TamilScript is never rewritten.

This is not a full pretty-printer: without a parser, re-indenting or
re-wrapping arbitrary JavaScript would be guesswork, so it is not done.
Formatting is idempotent: formatted files stay byte-identical on re-run.

  --check   Report whether the file would change; never writes. Exit 1
            when the file would be reformatted, 0 when it is already
            formatted.

Output: "<file> is already formatted." / "Formatted <file>" /
"<file> would be reformatted."

Exit codes: 0 success (or already formatted); 1 write/read/validation
failure, or --check finding a difference; 2 usage errors.
`;

const LINT_HELP = `Usage: tamilscript lint <file-or-directory>

Report high-confidence problems for one file or a directory tree:

  OT001  tamilscript-syntax   the core lexer rejects the file (malformed
                             or unsupported $ literal) — with an accurate
                             hint and the JST_* code.
  OT002  javascript-syntax   the transformed JavaScript fails
                             \`node --check\` (the same engine used to
                             execute). Reported separately so JavaScript
                             errors are never confused with TamilScript
                             literal errors.
  OT000  file                the file cannot be read.

Output lines: file:line:column: [rule] message (category), plus hint lines
whenever an accurate suggestion exists, and a summary line.

  - Directories are scanned recursively in deterministic order;
    node_modules and .git are skipped, symlinks are not followed. Only
    .js/.mjs/.cjs files are checked (any file type passed explicitly is
    checked as given).
  - At most one problem per file is reported: the first TamilScript
    validation error, or the first transformed-JavaScript syntax error.
    The linter performs no type checking or semantic analysis.
  - Nothing is executed and nothing is written; temporary check files are
    removed even on failure.

Exit codes: 0 no problems; 1 problems or unreadable input; 2 usage errors.
`;

const INIT_HELP = `Usage: tamilscript init [directory] [--force]

Create a starter TamilScript project:

  package.json       npm scripts (start/check/test) and the tamilscript
                     devDependency
  README.md          project overview and commands
  src/app.ot.js      sample program using Tamil literals and the print helper
  test/app.test.js   tests that run and validate the sample

  [directory]  Destination directory (default: current directory). Created
               if missing; parent paths must be directories.
  --force      Overwrite the files listed above when they already exist.
               Nothing else in the destination is ever touched or deleted.

Exit codes: 0 created; 1 failed or existing files; 2 usage errors.
`;

const TEST_HELP = `Usage: tamilscript test

Run the "test" script from the package.json in the current directory via
npm (the same command as \`npm test\`), with output and exit code preserved.

Exit codes: npm's exit code; 1 on missing/invalid project files or spawn
failure; 2 usage errors.
`;

const REPL_HELP = `Usage: tamilscript repl

Start an interactive TamilScript session: type JavaScript with Tamil
numeric literals ($௧௮, $௧.௫) and அச்சிடு(), then press Enter.

  - The same core transformer as \`tamilscript run\` handles every input;
    execution uses Node.js (no eval, no second JavaScript engine).
  - Variables persist across inputs.
  - Multiline input is supported (template literals, block comments,
    unbalanced brackets); the prompt shows "... " while a construct is
    still open.
  - Errors are reported and the session continues.
  - Commands: .help, .clear (interactive only), .exit; Ctrl+D also exits;
    Ctrl+C clears the current input (press twice to exit).
  - Piped input prints no banner and no prompts, so output is scriptable.
  - Not supported: top-level await, automatic promise unwrapping, .load.
  - REPL messages stay English (like --help text); --tamil does not
    translate them.

Exit codes: 0 after a normal session end (EOF or .exit); 2 on usage errors.
`;

const DOCTOR_HELP = `Usage: tamilscript doctor

Check the local development setup and print ok/warning/error lines:

  - Node.js version and automatic print-helper availability
  - npm availability (used by \`tamilscript test\`)
  - the running tamilscript CLI entry
  - tamilscript installation in this project
  - package.json validity and its test script
  - files referenced by \`tamilscript run/check\` in npm scripts

Only local state is inspected: no network, registry, or dependency
integrity checks are performed.

Exit codes: 0 no errors (warnings allowed); 1 at least one error; 2 usage.
`;

/**
 * Node.js inspector flags accepted before the entry file and forwarded to
 * the child `node` process by `tamilscript run` (never after `--`).
 */
const INSPECT_FLAG_RE = /^--inspect(-brk)?(=\S+)?$/;

/**
 * Classify a path cheaply: 'missing' | 'file' | 'directory' | 'other'.
 */
function classifyPath(absPath) {
  let st;
  try {
    st = fs.statSync(absPath);
  } catch (err) {
    return err && err.code === 'ENOENT' ? 'missing' : 'other';
  }
  if (st.isDirectory()) return 'directory';
  if (st.isFile()) return 'file';
  return 'other';
}

/** Read a file for diagnostics; never throws. */
function readSourceBestEffort(file) {
  try {
    return fs.readFileSync(path.resolve(file), 'utf8');
  } catch (err) {
    void err;
    return undefined;
  }
}

/** `Error [file]: file not found: <file>` plus an accurate hint. */
function writeFileNotFound(stderr, file, tamil) {
  const message = `${label('fileNotFound', tamil)}: ${file}`;
  const hint = suggestFix({ code: 'ENOENT' }, Category.FILE);
  stderr.write(`${formatProblem(Category.FILE, message, { tamil, hint })}\n`);
}

/** `Error [file]: not a file (directory): <path>` plus an accurate hint. */
function writeNotAFile(stderr, file, tamil) {
  const message = `not a file (directory): ${file}`;
  const hint = suggestFix({ code: 'EISDIR' }, Category.FILE);
  stderr.write(`${formatProblem(Category.FILE, message, { tamil, hint })}\n`);
}

/** Usage error + the relevant help text; always returns exit code 2. */
function writeUsageError(stderr, tamil, message, help) {
  const hint = suggestFix(null, Category.USAGE);
  stderr.write(`${formatProblem(Category.USAGE, message, { tamil, hint })}\n\n${help}`);
  return 2;
}

/**
 * Extract the global `--tamil` flag. Only tokens before an explicit `--`
 * separator are treated as CLI flags; anything after it belongs to the
 * target program and is forwarded untouched.
 */
function extractTamilFlag(args) {
  const sep = args.indexOf('--');
  const head = sep === -1 ? args : args.slice(0, sep);
  const tail = sep === -1 ? [] : args.slice(sep);
  const kept = [];
  let flag = false;
  for (const a of head) {
    if (a === '--tamil') {
      flag = true;
      continue;
    }
    kept.push(a);
  }
  return { args: kept.concat(tail), flag };
}

function formatInitReport(result) {
  const rel = (abs) => path.join(result.display, path.relative(result.dir, abs));
  const lines = [];
  if (result.created.length > 0) {
    lines.push(`Created ${result.created.length} file${result.created.length === 1 ? '' : 's'}:`);
    for (const f of result.created) lines.push(`  ${rel(f)}`);
  }
  if (result.overwritten.length > 0) {
    lines.push(
      `Overwrote ${result.overwritten.length} existing file${result.overwritten.length === 1 ? '' : 's'} (--force):`
    );
    for (const f of result.overwritten) lines.push(`  ${rel(f)}`);
  }
  lines.push('');
  lines.push('Next steps:');
  if (path.resolve(result.display) !== process.cwd()) lines.push(`  cd ${result.display}`);
  lines.push('  npm install');
  lines.push('  npm start');
  return lines.join('\n');
}

async function commandInit(rest, io, tamil) {
  if (rest.includes('--help') || rest.includes('-h')) {
    io.stdout.write(INIT_HELP);
    return 0;
  }
  let dest = null;
  let force = false;
  for (const a of rest) {
    if (a === '--force') {
      force = true;
    } else if (a.startsWith('-')) {
      return writeUsageError(io.stderr, tamil, `unexpected argument ${JSON.stringify(a)}.`, INIT_HELP);
    } else if (dest === null) {
      dest = a;
    } else {
      return writeUsageError(io.stderr, tamil, 'init takes at most one directory argument.', INIT_HELP);
    }
  }
  try {
    const result = await initProject(dest === null ? '.' : dest, { force });
    io.stdout.write(`${formatInitReport(result)}\n`);
    return 0;
  } catch (err) {
    io.stderr.write(`${formatCliError(err, { tamil })}\n`);
    return 1;
  }
}

async function commandTest(rest, io, tamil) {
  if (rest.includes('--help') || rest.includes('-h')) {
    io.stdout.write(TEST_HELP);
    return 0;
  }
  if (rest.length > 0) {
    return writeUsageError(
      io.stderr,
      tamil,
      `test takes no arguments (got ${JSON.stringify(rest[0])}).`,
      TEST_HELP
    );
  }
  io.stdout.write(`tamilscript test: running "npm test" in ${process.cwd()}\n`);
  const result = await runProjectTest(process.cwd());
  if (result.problem) {
    io.stderr.write(
      `${formatProblem(result.problem.category || Category.CONFIG, result.problem.message, {
        tamil,
        hint: result.problem.hint,
      })}\n`
    );
    return 1;
  }
  return result.code;
}

function commandDoctor(rest, io, tamil) {
  if (rest.includes('--help') || rest.includes('-h')) {
    io.stdout.write(DOCTOR_HELP);
    return 0;
  }
  if (rest.length > 0) {
    return writeUsageError(
      io.stderr,
      tamil,
      `doctor takes no arguments (got ${JSON.stringify(rest[0])}).`,
      DOCTOR_HELP
    );
  }
  const checks = runDoctor(process.cwd());
  io.stdout.write(formatReport(checks, { tamil }));
  return checks.some((c) => c.level === 'error') ? 1 : 0;
}

/**
 * CLI entry point.
 * @param {string[]} argv process.argv
 * @param {{ stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream }} [streams]
 * @returns {Promise<number>} exit code
 */
async function main(argv, streams) {
  const stdout = (streams && streams.stdout) || process.stdout;
  const stderr = (streams && streams.stderr) || process.stderr;
  const io = { stdout, stderr };
  const parsed = extractTamilFlag(argv.slice(2));
  const args = parsed.args;
  // OPENTAMIZH_LANG is the pre-rename spelling, still honored so existing
  // scripts and editor profiles keep working.
  const tamil =
    parsed.flag ||
    isTamilLanguage(process.env.TAMILSCRIPT_LANG || process.env.OPENTAMIZH_LANG);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    stdout.write(USAGE);
    return 0;
  }
  if (args[0] === '--version' || args[0] === '-V' || args[0] === '-v' || args[0] === 'version') {
    stdout.write(`${VERSION}\n`);
    return 0;
  }

  const command = args[0];

  if (command === 'run') {
    const rest = args.slice(1);
    // Split program args at an explicit `--` separator first so that a
    // literal `--watch` or `--help` after it is forwarded instead of
    // consumed.
    let pre = rest;
    let post = [];
    const sep = rest.indexOf('--');
    if (sep !== -1) {
      pre = rest.slice(0, sep);
      post = rest.slice(sep + 1);
    }
    // `--help`/`-h` are CLI flags only in the flag region before the entry
    // file; from the file onward (and after `--`) everything is forwarded
    // to the program, so `run app.js -- --help` runs the program.
    const firstPositional = pre.findIndex((a) => !a.startsWith('-'));
    const flagRegion = firstPositional === -1 ? pre : pre.slice(0, firstPositional);
    if (flagRegion.includes('--help') || flagRegion.includes('-h')) {
      stdout.write(RUN_HELP);
      return 0;
    }
    const watch = pre.includes('--watch');
    pre = pre.filter((a) => a !== '--watch');
    const nodeFlags = [];
    pre = pre.filter((a) => {
      if (INSPECT_FLAG_RE.test(a)) {
        nodeFlags.push(a);
        return false;
      }
      return true;
    });
    if (pre.length === 0) {
      const where = sep === 0 ? ' before "--"' : '';
      const message = `${label('missingFileArgument', tamil)}${where}.`;
      return writeUsageError(stderr, tamil, message, RUN_HELP);
    }
    if (pre[0].startsWith('-') && pre[0] !== '-') {
      return writeUsageError(
        stderr,
        tamil,
        `unexpected argument ${JSON.stringify(pre[0])}.`,
        RUN_HELP
      );
    }
    const file = pre[0];
    const forwarded = [...pre.slice(1), ...post];
    const kind = classifyPath(path.resolve(file));
    if (kind === 'missing') {
      writeFileNotFound(stderr, file, tamil);
      return 1;
    }
    if (kind === 'directory') {
      writeNotAFile(stderr, file, tamil);
      return 1;
    }
    try {
      if (watch) {
        return await watchAndRun(file, forwarded, { stdout, stderr, nodeFlags });
      }
      const code = await runFile(file, forwarded, { nodeFlags });
      return code;
    } catch (err) {
      stderr.write(`${formatCliError(err, { source: readSourceBestEffort(file), tamil })}\n`);
      return 1;
    }
  }

  if (command === 'transform') {
    const rest = args.slice(1);
    if (rest.includes('--help') || rest.includes('-h')) {
      stdout.write(TRANSFORM_HELP);
      return 0;
    }
    let input = null;
    let output = null;
    let force = false;
    let showStdout = false;
    let explain = false;
    let sourceMap = false;
    for (let k = 0; k < rest.length; k++) {
      const a = rest[k];
      if (a === '-o' || a === '--output') {
        const value = rest[k + 1];
        if (value == null || value.startsWith('-')) {
          return writeUsageError(stderr, tamil, '-o/--output requires a file argument.', TRANSFORM_HELP);
        }
        output = value;
        k += 1;
      } else if (a === '--force') {
        force = true;
      } else if (a === '--stdout') {
        showStdout = true;
      } else if (a === '--explain') {
        explain = true;
      } else if (a === '--source-map') {
        sourceMap = true;
      } else if (!a.startsWith('-') && input == null) {
        input = a;
      } else {
        return writeUsageError(stderr, tamil, `unexpected argument ${JSON.stringify(a)}.`, TRANSFORM_HELP);
      }
    }
    if (input == null) {
      return writeUsageError(stderr, tamil, 'missing input file.', TRANSFORM_HELP);
    }
    if (output == null && !showStdout) {
      return writeUsageError(
        stderr,
        tamil,
        'missing output path. Pass -o <output.js> or --stdout.',
        TRANSFORM_HELP
      );
    }
    if (output != null && showStdout) {
      return writeUsageError(
        stderr,
        tamil,
        '--stdout conflicts with -o/--output (choose one destination).',
        TRANSFORM_HELP
      );
    }
    if (explain && showStdout) {
      return writeUsageError(
        stderr,
        tamil,
        '--explain conflicts with --stdout (both write to stdout). Use -o/--output with --explain.',
        TRANSFORM_HELP
      );
    }
    if (sourceMap && output == null) {
      return writeUsageError(
        stderr,
        tamil,
        '--source-map requires -o/--output (there is no file to attach the map to).',
        TRANSFORM_HELP
      );
    }
    const inputKind = classifyPath(path.resolve(input));
    if (inputKind === 'missing') {
      writeFileNotFound(stderr, input, tamil);
      return 1;
    }
    if (inputKind === 'directory') {
      writeNotAFile(stderr, input, tamil);
      return 1;
    }
    try {
      if (output == null) {
        const source = fs.readFileSync(path.resolve(input), 'utf8');
        const transformed = transform(source, { filename: path.resolve(input) });
        // Match `-o` output: helper programs get the standalone prelude.
        const { code: out } = addStandaloneRuntime(transformed, source);
        stdout.write(out);
        if (!out.endsWith('\n')) stdout.write('\n');
        return 0;
      }
      if (explain || sourceMap) {
        const { transformFileWithOptions } = require('./transform-file');
        const result = await transformFileWithOptions(input, output, {
          force,
          explain,
          sourceMap,
        });
        if (explain) {
          stdout.write(formatExplain(path.resolve(input), result.events));
        }
        stdout.write(`Transformed ${input} -> ${output}\n`);
        if (sourceMap) stdout.write(`Source map written to ${output}.map\n`);
        return 0;
      }
      await transformFile(input, output, { force });
      stdout.write(`Transformed ${input} -> ${output}\n`);
      return 0;
    } catch (err) {
      let source;
      try {
        source = fs.readFileSync(path.resolve(input), 'utf8');
      } catch (readErr) {
        void readErr;
      }
      stderr.write(`${formatCliError(err, { source, tamil })}\n`);
      return 1;
    }
  }

  if (command === 'check') {
    if (args.includes('--help') || args.includes('-h')) {
      stdout.write(CHECK_HELP);
      return 0;
    }
    const file = args[1];
    if (file == null) {
      return writeUsageError(stderr, tamil, 'missing file argument.', CHECK_HELP);
    }
    if (args.length > 2) {
      return writeUsageError(stderr, tamil, 'check takes exactly one file argument.', CHECK_HELP);
    }
    if (file.startsWith('-')) {
      return writeUsageError(stderr, tamil, `unexpected argument ${JSON.stringify(file)}.`, CHECK_HELP);
    }
    const kind = classifyPath(path.resolve(file));
    if (kind === 'missing') {
      writeFileNotFound(stderr, file, tamil);
      return 1;
    }
    if (kind === 'directory') {
      writeNotAFile(stderr, file, tamil);
      return 1;
    }
    try {
      const result = await checkFile(file);
      if (result.ok) {
        stdout.write(`OK: ${file} — TamilScript syntax and transformed JavaScript are valid.\n`);
        return 0;
      }
      for (const e of result.errors) stderr.write(`${e}\n`);
      return 1;
    } catch (err) {
      stderr.write(`${formatCliError(err, { tamil })}\n`);
      return 1;
    }
  }

  if (command === 'format') {
    const rest = args.slice(1);
    if (rest.includes('--help') || rest.includes('-h')) {
      stdout.write(FORMAT_HELP);
      return 0;
    }
    let file = null;
    let check = false;
    for (const a of rest) {
      if (a === '--check') {
        check = true;
      } else if (a.startsWith('-')) {
        return writeUsageError(stderr, tamil, `unexpected argument ${JSON.stringify(a)}.`, FORMAT_HELP);
      } else if (file === null) {
        file = a;
      } else {
        return writeUsageError(stderr, tamil, 'format takes exactly one file argument.', FORMAT_HELP);
      }
    }
    if (file == null) {
      return writeUsageError(stderr, tamil, 'missing file argument.', FORMAT_HELP);
    }
    const kind = classifyPath(path.resolve(file));
    if (kind === 'missing') {
      writeFileNotFound(stderr, file, tamil);
      return 1;
    }
    if (kind === 'directory') {
      writeNotAFile(stderr, file, tamil);
      return 1;
    }
    const absFile = path.resolve(file);
    let source;
    try {
      source = fs.readFileSync(absFile, 'utf8');
    } catch (err) {
      stderr.write(`${formatCliError(err, { tamil })}\n`);
      return 1;
    }
    let formatted;
    try {
      formatted = formatSource(source);
    } catch (err) {
      stderr.write(`${formatCliError(err, { source, tamil })}\n`);
      return 1;
    }
    if (formatted === source) {
      stdout.write(`${file} is already formatted.\n`);
      return 0;
    }
    if (check) {
      stdout.write(`${file} would be reformatted.\n`);
      return 1;
    }
    try {
      await writeFileAtomic(absFile, formatted);
    } catch (err) {
      stderr.write(`${formatCliError(err, { tamil })}\n`);
      return 1;
    }
    stdout.write(`Formatted ${file}\n`);
    return 0;
  }

  if (command === 'lint') {
    const rest = args.slice(1);
    if (rest.includes('--help') || rest.includes('-h')) {
      stdout.write(LINT_HELP);
      return 0;
    }
    if (rest.length === 0) {
      return writeUsageError(stderr, tamil, 'missing file or directory argument.', LINT_HELP);
    }
    if (rest.length > 1) {
      return writeUsageError(
        stderr,
        tamil,
        `lint takes exactly one file or directory argument (got ${JSON.stringify(rest[1])}).`,
        LINT_HELP
      );
    }
    const target = rest[0];
    if (target.startsWith('-')) {
      return writeUsageError(stderr, tamil, `unexpected argument ${JSON.stringify(target)}.`, LINT_HELP);
    }
    const absTarget = path.resolve(target);
    const kind = classifyPath(absTarget);
    if (kind === 'missing') {
      writeFileNotFound(stderr, target, tamil);
      return 1;
    }
    if (kind !== 'file' && kind !== 'directory') {
      const hint = suggestFix({ code: 'ENOTDIR' }, Category.FILE);
      stderr.write(
        `${formatProblem(Category.FILE, `not a regular file or directory: ${target}`, { tamil, hint })}\n`
      );
      return 1;
    }
    try {
      const result = await lintPath(absTarget, { isDirectory: kind === 'directory' });
      stdout.write(formatLintReport(result, { tamil }));
      return result.problems.length > 0 ? 1 : 0;
    } catch (err) {
      stderr.write(`${formatCliError(err, { tamil })}\n`);
      return 1;
    }
  }

  if (command === 'init') {
    return commandInit(args.slice(1), io, tamil);
  }

  if (command === 'test') {
    return commandTest(args.slice(1), io, tamil);
  }

  if (command === 'doctor') {
    return commandDoctor(args.slice(1), io, tamil);
  }

  if (command === 'repl') {
    const rest = args.slice(1);
    if (rest.includes('--help') || rest.includes('-h')) {
      stdout.write(REPL_HELP);
      return 0;
    }
    if (rest.length > 0) {
      return writeUsageError(
        stderr,
        tamil,
        `repl takes no arguments (got ${JSON.stringify(rest[0])}).`,
        REPL_HELP
      );
    }
    return runRepl({ output: stdout, error: stderr });
  }

  const message = `${label('unknownCommand', tamil)} ${JSON.stringify(command)}.`;
  return writeUsageError(stderr, tamil, message, USAGE);
}

/**
 * Format an explain-mode report. Literal source text is truncated so long
 * literals cannot flood the report.
 */
function formatExplain(filename, events) {
  const counts = { number: 0, decimal: 0 };
  const lines = [];
  for (const e of events) {
    if (counts[e.type] !== undefined) counts[e.type] += 1;
    let shown = e.text;
    const MAX = 32;
    if (shown.length > MAX) shown = `${shown.slice(0, MAX)}…`;
    lines.push(`${filename}:${e.line}:${e.column}  ${e.type}  ${shown} -> ${truncateValue(e.value)}`);
  }
  const total = events.length;
  lines.push(
    `Transformed ${total} literal${total === 1 ? '' : 's'}: ` +
    `${counts.number} number, ${counts.decimal} decimal.`
  );
  return lines.join('\n') + '\n';
}

function truncateValue(value) {
  const MAX = 48;
  if (value.length > MAX) return `${value.slice(0, MAX)}…`;
  return value;
}

module.exports = {
  main,
  USAGE,
  RUN_HELP,
  TRANSFORM_HELP,
  CHECK_HELP,
  FORMAT_HELP,
  LINT_HELP,
  INIT_HELP,
  TEST_HELP,
  DOCTOR_HELP,
  REPL_HELP,
  formatExplain,
};

if (require.main === module) {
  main(process.argv).then(
    (code) => process.exit(code == null ? 0 : code),
    (err) => {
      process.stderr.write(`${err && err.stack ? err.stack : String(err)}\n`);
      process.exit(1);
    }
  );
}
