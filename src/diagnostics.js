'use strict';

// Tamil-aware diagnostic layer for the TamilScript CLI.
//
// Errors are grouped into five categories so the CLI can report them
// consistently and pick an accurate suggestion:
//
//   usage       bad command line (unknown command, missing/extra arguments)
//   file        file access (missing files, directories, permissions)
//   validation  TamilScript syntax or transformed-JavaScript errors
//   config      project configuration (package.json, npm scripts)
//   runtime     program execution / child-process failures
//
// English is the default. A small catalogue of *exact* Tamil translations
// covers the fixed CLI labels and categories; it is used only when Tamil
// output is explicitly enabled (`--tamil` or `TAMILSCRIPT_LANG=tamil`).
// Anything not in the catalogue falls back to English on purpose: no
// translation is ever guessed, and file paths, error codes, stack traces
// and hints stay in English.

const { formatDiagnostic, JsTamilSyntaxError } = require('./errors');

const Category = Object.freeze({
  USAGE: 'usage',
  FILE: 'file',
  VALIDATION: 'validation',
  CONFIG: 'config',
  RUNTIME: 'runtime',
});

// Filesystem error codes that mean "this is a file-access problem".
const FILE_ERROR_CODES = new Set([
  'ENOENT', 'EISDIR', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP', 'EMFILE', 'ENFILE',
]);

/**
 * Classify an error into a Category. Explicit caller knowledge wins: pass
 * `fallback` when the origin of the error is known (e.g. a spawn failure is
 * always a runtime error).
 *
 * @param {Error} [err]
 * @param {string} [fallback] category when nothing else matches
 * @returns {string} one of the Category values
 */
function categorizeError(err, fallback) {
  if (err && typeof err === 'object') {
    if (err instanceof JsTamilSyntaxError) return Category.VALIDATION;
    const code = typeof err.code === 'string' ? err.code : '';
    if (code.startsWith('JST_READ') || code.startsWith('JST_WRITE')) return Category.FILE;
    if (code.startsWith('JST_')) return Category.VALIDATION;
    if (code.startsWith('SCAFFOLD')) return Category.FILE;
    if (FILE_ERROR_CODES.has(code)) return Category.FILE;
  }
  return fallback || Category.RUNTIME;
}

// Suggestions for specific TamilScript error codes. Each must be accurate
// for what the lexer actually reports; they are covered by tests.
const CODE_HINTS = Object.freeze({
  JST_TAMIL_STRING_REMOVED: 'Remove the $ before the quote: write an ordinary JavaScript string.',
  JST_BAD_NUMERIC_LITERAL: 'After $, use Tamil digits ௦–௯ only (for example $௧௮).',
  JST_MIXED_NUMERAL: 'Use Tamil digits or ASCII digits, not both, in one $ literal.',
  JST_UNSUPPORTED_BIGINT: 'Tamil BigInt literals are not supported; use a plain number.',
  JST_UNSAFE_INTEGER: 'The value exceeds the largest safe integer (9007199254740991).',
  JST_UNTERMINATED_COMMENT: 'Close the block comment with */ before the end of the file.',
  JST_UNTERMINATED_STRING: 'Close the JavaScript string before the end of the line.',
  JST_UNTERMINATED_TEMPLATE: 'Close the template literal with a backtick (`).',
  JST_UNTERMINATED_REGEX: 'Close the regular expression with a / … / pair.',
  JST_UNTERMINATED_TEMPLATE_EXPR: 'Close the ${ … } expression inside the template.',
  JST_READ_ERROR: 'Make sure the file exists, is readable, and is UTF-8 text.',
  JST_WRITE_ERROR: 'Make sure the destination directory exists and is writable.',
  JST_WRITE_OVERWRITE: 'Choose a different output path or pass --force to overwrite the input intentionally.',
  SCAFFOLD_EEXIST: 'Pass --force to overwrite the listed files, or choose an empty directory.',
  SCAFFOLD_DEST_FILE: 'Choose a directory path, or remove the existing file first.',
  SCAFFOLD_OUTSIDE: 'Choose a destination directory and try again.',
  SCAFFOLD_WRITE_FAILED: 'Check directory permissions and try again.',
});

// Suggestions keyed by file-access error code.
const FILE_HINTS = Object.freeze({
  ENOENT: 'Check the path (spelling and current working directory), or create the file first.',
  EISDIR: 'Pass the path of a source file, not a directory.',
  ENOTDIR: 'A path segment is a file where a directory was expected.',
  EACCES: 'Check file permissions and try again.',
  EPERM: 'Check file permissions and try again.',
});

// Expected guard failures: the message and hint fully explain the problem,
// so the CLI omits internal stack frames (they would only add noise).
const QUIET_CODES = new Set(['SCAFFOLD_EEXIST', 'SCAFFOLD_DEST_FILE', 'SCAFFOLD_OUTSIDE', 'JST_WRITE_OVERWRITE']);

/**
 * Produce a short, accurate fix suggestion, or null when giving advice
 * would be guessing (never invent hints for arbitrary runtime errors).
 *
 * @param {Error} [err]
 * @param {string} [category]
 * @returns {string|null}
 */
function suggestFix(err, category) {
  if (err && typeof err.code === 'string' && CODE_HINTS[err.code]) {
    return CODE_HINTS[err.code];
  }
  if (category === Category.FILE) {
    const code = err && typeof err.code === 'string' ? err.code : '';
    return FILE_HINTS[code] || 'Check the path and file permissions, then try again.';
  }
  if (category === Category.USAGE) {
    return 'Run `tamilscript --help` to see the available commands.';
  }
  return null;
}

// Exact, tested translations. Keys are shared with the English table below.
const TAMIL_LABELS = Object.freeze({
  error: 'பிழை',
  warning: 'எச்சரிக்கை',
  hint: 'குறிப்பு',
  ok: 'சரி',
  usage: 'பயன்பாட்டுப் பிழை',
  file: 'கோப்புப் பிழை',
  validation: 'சரிபார்ப்புப் பிழை',
  config: 'அமைப்புப் பிழை',
  runtime: 'இயக்கநேரப் பிழை',
  unknownCommand: 'தெரியாத கட்டளை',
  fileNotFound: 'கோப்பு கிடைக்கவில்லை',
  missingFileArgument: 'கோப்பு குறிப்பிடப்படவில்லை',
});

const ENGLISH_LABELS = Object.freeze({
  error: 'Error',
  warning: 'Warning',
  hint: 'Hint',
  ok: 'OK',
  usage: 'usage',
  file: 'file',
  validation: 'validation',
  config: 'config',
  runtime: 'runtime',
  unknownCommand: 'unknown command',
  fileNotFound: 'file not found',
  missingFileArgument: 'missing file argument',
});

/**
 * Look up a fixed label. Unknown keys and anything without an exact
 * translation fall back to the English text.
 *
 * @param {string} key
 * @param {boolean} [tamil]
 * @returns {string}
 */
function label(key, tamil) {
  const table = tamil ? TAMIL_LABELS : ENGLISH_LABELS;
  return table[key] || ENGLISH_LABELS[key] || key;
}

/**
 * Whether a language setting requests Tamil output.
 * @param {string|undefined} value e.g. TAMILSCRIPT_LANG
 * @returns {boolean}
 */
function isTamilLanguage(value) {
  return /^(tamil|ta)$/i.test(String(value == null ? '' : value).trim());
}

/**
 * Render a CLI-authored error with its category and an optional hint:
 *
 *   Error [file]: file not found: missing.js
 *   hint: Check the path ...
 *
 * @param {string} category one of Category
 * @param {string} message an already-composed message
 * @param {{ tamil?: boolean, hint?: string|null }} [options]
 * @returns {string}
 */
function formatProblem(category, message, options) {
  const o = options || {};
  const parts = [`${label('error', o.tamil)} [${label(category, o.tamil)}]: ${message}`];
  if (o.hint) parts.push(`${label('hint', o.tamil)}: ${o.hint}`);
  return parts.join('\n');
}

/**
 * Render any caught error for CLI output.
 *
 * Validation errors (JsTamilSyntaxError) keep their established
 * diagnostic shape (file:line:col + snippet) and gain a trailing hint.
 * Everything else keeps its message, full stack trace and `cause` chain;
 * only the first line gets a category marker.
 *
 * @param {Error} err
 * @param {{ category?: string, source?: string, tamil?: boolean, hint?: string|null }} [options]
 * @returns {string}
 */
function formatCliError(err, options) {
  const o = options || {};
  const category = o.category || categorizeError(err);
  const hint = o.hint !== undefined ? o.hint : suggestFix(err, category);
  const hintLine = hint ? `${label('hint', o.tamil)}: ${hint}` : null;

  if (err instanceof JsTamilSyntaxError) {
    const text = formatDiagnostic(err, o.source !== undefined ? { source: o.source } : undefined);
    return hintLine ? `${text}\n${hintLine}` : text;
  }

  const stack = String((err && err.stack) || err);
  const nl = stack.indexOf('\n');
  let head = nl === -1 ? stack : stack.slice(0, nl);
  const quiet = !!(err && typeof err.code === 'string' && QUIET_CODES.has(err.code));
  const rest = nl === -1 || quiet ? '' : stack.slice(nl);
  const marker = ` [${label(category, o.tamil)}]`;
  const m = /^([A-Za-z_$][A-Za-z0-9_$]*): ([\s\S]*)$/.exec(head);
  if (m) {
    const name = m[1] === 'Error' ? label('error', o.tamil) : m[1];
    head = `${name}${marker}: ${m[2]}`;
  } else {
    head = `${label('error', o.tamil)}${marker}: ${head}`;
  }
  const parts = [head + rest];

  if (err && err.cause !== undefined && err.cause !== null) {
    const causeMessage = err.cause instanceof Error ? err.cause.message : String(err.cause);
    if (causeMessage && !parts[0].includes(causeMessage)) {
      parts.push(`caused by: ${causeMessage}`);
    }
  }
  if (hintLine) parts.push(hintLine);
  return parts.join('\n');
}

module.exports = {
  Category,
  categorizeError,
  suggestFix,
  label,
  isTamilLanguage,
  formatProblem,
  formatCliError,
};
