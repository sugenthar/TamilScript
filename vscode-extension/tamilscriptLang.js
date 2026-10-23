'use strict';

// VS Code-independent bridge to the TamilScript core transformer.
// This module never touches the `vscode` API, never spawns processes and
// never executes user code: validation uses the core transform + parser-backed
// validate() API, falling back to transform() for older cores.
//
// Tamil code points below are built with String.fromCodePoint so this file
// stays pure ASCII.

const fs = require('node:fs');
const path = require('node:path');

function isUsableCore(api) {
  return (
    api !== null &&
    typeof api === 'object' &&
    typeof api.transform === 'function' &&
    typeof api.VERSION === 'string'
  );
}

function tryRequire(request) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const api = require(request);
    if (isUsableCore(api)) return { api, via: request };
    return { error: `Resolved "${request}" but it does not expose the tamilscript API.` };
  } catch (err) {
    return { error: `Cannot load "${request}": ${(err && err.message) || err}` };
  }
}

/**
 * Locate a usable tamilscript core API.
 * Order: explicit corePath setting, workspace node_modules, local checkout
 * (extension directory sibling ../src/index.js, for repo development).
 *
 * @param {{ workspaceFolders?: string[], corePath?: string, localDir?: string }} [options]
 * @returns {{ api: object, via: string } | { error: string }}
 */
function resolveCore(options) {
  const opts = options || {};
  const tried = [];
  if (opts.corePath && opts.corePath.length > 0) {
    const direct = tryRequire(opts.corePath);
    if (direct.api) return direct;
    tried.push(direct.error);
    const nested = tryRequire(path.join(opts.corePath, 'src', 'index.js'));
    if (nested.api) return nested;
    tried.push(nested.error);
  }
  for (const folder of opts.workspaceFolders || []) {
    const r = tryRequire(path.join(folder, 'node_modules', 'tamilscript'));
    if (r.api) return r;
    tried.push(r.error);
  }
  if (opts.localDir) {
    const r = tryRequire(path.join(opts.localDir, '..', 'src', 'index.js'));
    if (r.api) return r;
    tried.push(r.error);
  }
  return {
    error:
      'TamilScript core not found. Install it in the workspace (`npm install tamilscript`) ' +
      'or set `tamilscript.corePath`.' +
      (tried.length > 0 ? ` Tried: ${tried[0]}` : ''),
  };
}

/**
 * Validate source without executing it. Returns at most the first error,
 * matching the core transformer's throw-first behavior.
 *
 * @param {object} api tamilscript public API
 * @param {string} text source text
 * @param {string} [filename] used in messages only
 * @param {{ tamilKeywords?: boolean }} [options]
 * @returns {{ ok: true } | { ok: false, diagnostic: { line: number, column: number, message: string, code: string|null, name: string } }}
 *   line/column are 0-based for editors (core reports 1-based).
 */
function validateText(api, text, filename, options) {
  const opts = options || {};
  const transformOptions = {
    ...(filename !== undefined ? { filename } : {}),
    tamilKeywords: !!opts.tamilKeywords,
  };
  try {
    // Prefer the parser-backed core validator. Older cores only expose
    // transform(); keep a working, honestly weaker fallback for them.
    if (typeof api.validate === 'function') {
      const result = api.validate(text, transformOptions);
      if (result && result.ok) return { ok: true };
      const diag = result && result.diagnostic ? result.diagnostic : {};
      return {
        ok: false,
        diagnostic: {
          line: diag.line != null ? Math.max(0, diag.line - 1) : 0,
          column: diag.column != null ? Math.max(0, diag.column - 1) : 0,
          message: diag.message || 'Invalid TamilScript syntax',
          code: diag.code || null,
          name: diag.name || 'SyntaxError',
        },
      };
    }
    api.transform(text, transformOptions);
    return { ok: true };
  } catch (err) {
    const line = err && err.line != null ? Math.max(0, err.line - 1) : 0;
    const column = err && err.column != null ? Math.max(0, err.column - 1) : 0;
    return {
      ok: false,
      diagnostic: {
        line,
        column,
        message: (err && err.message) || String(err),
        code: (err && err.code) || null,
        name: (err && err.name) || 'Error',
      },
    };
  }
}

/**
 * Detect whether `text` contains TamilScript literals (valid or malformed).
 * Used to decide whether a JavaScript document needs the dedicated language
 * mode: the built-in validator parses `$`-literals as plain JavaScript and
 * reports false syntax errors. Detection uses the same lexer as validation
 * (`transformWithMeta`), so `$` inside comments, ordinary strings, regex
 * literals, and template literal text is never counted; malformed attempts
 * (`JST_*` errors) are counted because they still mean the source is
 * TamilScript. Never executes code.
 *
 * @param {object} api tamilscript public API
 * @param {string} text source text
 * @param {{ tamilKeywords?: boolean }} [options]
 * @returns {boolean}
 */
function hasTamilLiterals(api, text, options) {
  const opts = options || {};
  if (typeof text !== 'string') return false;
  // Without keyword mode a source with no `$` cannot contain a TamilScript
  // transformation, so avoid lexing every ordinary JavaScript document.
  if (!opts.tamilKeywords && text.indexOf('$') === -1) return false;
  try {
    if (typeof api.transformWithMeta === 'function') {
      const result = api.transformWithMeta(text, { tamilKeywords: !!opts.tamilKeywords });
      return !!(result && Array.isArray(result.events) && result.events.length > 0);
    }
    // Older cores: literals are the only thing transform() rewrites
    // (sources without them pass through byte-identical).
    return api.transform(text, { tamilKeywords: !!opts.tamilKeywords }) !== text;
  } catch (err) {
    return !!(err && typeof err.code === 'string' && err.code.indexOf('JST_') === 0);
  }
}

/**
 * Transform source without executing it.
 * @returns {{ ok: true, code: string } | { ok: false, diagnostic: object }}
 */
function transformText(api, text, filename, options) {
  const opts = options || {};
  const checked = validateText(api, text, filename, opts);
  if (!checked.ok) return checked;
  return {
    ok: true,
    code: api.transform(text, {
      ...(filename !== undefined ? { filename } : {}),
      tamilKeywords: !!opts.tamilKeywords,
    }),
  };
}

function getVersion(api) {
  return api && typeof api.VERSION === 'string' ? api.VERSION : 'unknown';
}

/**
 * Locate the tamilscript CLI entry script (`bin/tamilscript.js`).
 * Order: explicit corePath setting (package dir or src/index.js), each
 * workspace `node_modules/tamilscript`, then the local checkout
 * (extension directory sibling `../bin/tamilscript.js`). Resolves a path
 * only — never spawns anything.
 *
 * @param {{ workspaceFolders?: string[], corePath?: string, localDir?: string }} [options]
 * @returns {{ cliPath: string, via: string } | { error: string }}
 */
function resolveCli(options) {
  const opts = options || {};
  const candidates = [];
  const addPackageDir = (dir) => {
    if (dir) candidates.push(path.join(dir, 'bin', 'tamilscript.js'));
  };
  if (opts.corePath && opts.corePath.length > 0) {
    if (path.basename(opts.corePath) === 'index.js') {
      addPackageDir(path.dirname(path.dirname(opts.corePath)));
    } else {
      addPackageDir(opts.corePath);
    }
  }
  for (const folder of opts.workspaceFolders || []) {
    addPackageDir(path.join(folder, 'node_modules', 'tamilscript'));
  }
  if (opts.localDir) {
    addPackageDir(path.join(opts.localDir, '..'));
  }
  const seen = new Set();
  for (const candidate of candidates) {
    const key = path.resolve(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (fs.statSync(candidate).isFile()) return { cliPath: path.resolve(candidate), via: key };
    } catch (err) {
      void err;
    }
  }
  return {
    error:
      'TamilScript CLI not found. Install it in the workspace (`npm install tamilscript`) ' +
      'or set `tamilscript.corePath` to the package directory.',
  };
}

/** Characters a Windows shell may expand even inside double quotes. */
const WINDOWS_UNSAFE = /[$%`\r\n]/;

/**
 * Quote one shell argument for a visible terminal. POSIX is fully safe with
 * single quotes plus `'\''` escaping. On Windows, double quotes alone are
 * not enough: cmd.exe expands `%VAR%` and PowerShell expands `$`/backticks
 * even inside double quotes, and those characters are legal in file names —
 * so a path containing them is refused instead of risking executing
 * something else. (Windows file names cannot contain `"`, so quoting is
 * otherwise sufficient.)
 * @param {string} arg
 * @param {string} [platform] `process.platform` by default
 */
function quoteArg(arg, platform) {
  const text = String(arg);
  if ((platform || process.platform) === 'win32') {
    if (WINDOWS_UNSAFE.test(text)) {
      throw new TypeError(
        `refusing to quote the Windows path ${JSON.stringify(text)}: it contains $, %, \` or a line break, ` +
          'which the terminal shell could expand. Run the file from a terminal manually.'
      );
    }
    return `"${text}"`;
  }
  return `'${text.split("'").join(`'\\''`)}'`;
}

/**
 * Build the terminal command that runs a file with the core CLI.
 * The extension never spawns this itself; it is typed into a visible
 * terminal so the user sees full output and keeps control (Ctrl+C works).
 *
 * @param {{ cliPath: string, filePath: string, node?: string, extraArgs?: string[], platform?: string }} options
 * @returns {string} e.g. `node "…/bin/tamilscript.js" run "…/program.js"`
 */
function buildRunCommand(options) {
  const opts = options || {};
  if (!opts.cliPath || !opts.filePath) {
    throw new TypeError('buildRunCommand requires cliPath and filePath');
  }
  const platform = opts.platform || process.platform;
  const parts = [opts.node || 'node', quoteArg(opts.cliPath, platform), 'run'];
  for (const extra of opts.extraArgs || []) parts.push(quoteArg(extra, platform));
  parts.push(quoteArg(opts.filePath, platform));
  return parts.join(' ');
}

module.exports = {
  isUsableCore,
  resolveCore,
  resolveCli,
  quoteArg,
  buildRunCommand,
  validateText,
  transformText,
  hasTamilLiterals,
  getVersion,
};
