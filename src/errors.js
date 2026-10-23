'use strict';

/**
 * Error types for TamilScript.
 *
 * `JsTamilError` / `JsTamilSyntaxError` names and `JST_*` codes are retained
 * for compatibility; do not rename them.
 *
 * Every transformation failure carries a stable machine-readable `code`
 * (see ErrorCodes) plus 1-based `line`/`column` and an optional `filename`,
 * so CLI output and editor integrations can rely on the shape.
 */

/**
 * Stable error codes for common failure categories.
 * These codes are part of the public API; do not rename them.
 */
const ErrorCodes = {
  /**
   * @deprecated No longer produced. `$"..."` / `$'...'` string literals were
   * removed when `$` became reserved for Tamil numeric literals; the
   * replacement diagnostic is `TAMIL_STRING_REMOVED`. Retained so existing
   * consumers that switch on the code keep compiling.
   */
  UNCLOSED_TAMIL_STRING: 'JST_UNCLOSED_STRING',
  /** `$"` / `$'` attempt: the removed TamilScript string-literal form. */
  TAMIL_STRING_REMOVED: 'JST_TAMIL_STRING_REMOVED',
  BAD_TAMIL_NUMBER: 'JST_BAD_NUMERIC_LITERAL',
  MIXED_TAMIL_NUMBER: 'JST_MIXED_NUMERAL',
  UNSUPPORTED_BIGINT: 'JST_UNSUPPORTED_BIGINT',
  UNSAFE_INTEGER: 'JST_UNSAFE_INTEGER',
  /**
   * @deprecated No longer produced (escapes only existed inside the removed
   * `$"..."` string form). Retained for API compatibility.
   */
  BAD_ESCAPE: 'JST_BAD_ESCAPE',
  UNTERMINATED_COMMENT: 'JST_UNTERMINATED_COMMENT',
  UNTERMINATED_STRING: 'JST_UNTERMINATED_STRING',
  UNTERMINATED_TEMPLATE: 'JST_UNTERMINATED_TEMPLATE',
  UNTERMINATED_REGEX: 'JST_UNTERMINATED_REGEX',
  UNTERMINATED_TEMPLATE_EXPR: 'JST_UNTERMINATED_TEMPLATE_EXPR',
  INVALID_NUMERAL_INPUT: 'JST_INVALID_NUMERAL',
  /** Transformed output is not parseable JavaScript (syntax-only check). */
  JAVASCRIPT_SYNTAX: 'JST_JAVASCRIPT_SYNTAX',
  READ_ERROR: 'JST_READ_ERROR',
  WRITE_ERROR: 'JST_WRITE_ERROR',
};

/**
 * Base error for all TamilScript failures (name retained as JsTamilError).
 */
class JsTamilError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, cause?: unknown }} [options]
   */
  constructor(message, options) {
    super(message, options && options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'JsTamilError';
    this.code = (options && options.code) || null;
    // `cause` is set by super() when provided; keep it visible for old runtimes.
    if (options && options.cause !== undefined && this.cause === undefined) {
      this.cause = options.cause;
    }
  }
}

/**
 * Syntax error raised while scanning/transforming TamilScript source.
 * Carries 1-based line/column information.
 */
class JsTamilSyntaxError extends JsTamilError {
  /**
   * @param {string} message
   * @param {{ line?: number, column?: number, filename?: string, code?: string }} [location]
   */
  constructor(message, location) {
    super(message, { code: location && location.code != null ? location.code : null });
    this.name = 'JsTamilSyntaxError';
    this.line = location && location.line != null ? location.line : null;
    this.column = location && location.column != null ? location.column : null;
    this.filename = location && location.filename != null ? location.filename : null;
  }

  /**
   * Short one-line location prefix: `file:line:col` or `line L, column C`.
   * @returns {string}
   */
  locationString() {
    const line = this.line != null ? this.line : 1;
    const column = this.column != null ? this.column : 1;
    if (this.filename != null) return `${this.filename}:${line}:${column}`;
    return `line ${line}, column ${column}`;
  }

  toString() {
    return `${this.name}: ${this.message} (${this.locationString()})`;
  }
}

/**
 * Render a human-readable, multi-line diagnostic for a TamilScript error.
 *
 * Format:
 * ```text
 * example.js:3:14
 * JsTamilSyntaxError [JST_BAD_NUMERIC_LITERAL]: <message>
 *   3 | let x = $௧abc;
 *     |               ^ (caret line only when the column is known)
 * ```
 *
 * Only the single offending source line is shown (never the whole file),
 * truncated to `maxWidth` characters so huge minified lines stay readable.
 * Columns count UTF-16 code units, matching JavaScript string indexing and
 * `node --check` output.
 *
 * @param {Error} err
 * @param {{ source?: string, maxWidth?: number }} [options]
 * @returns {string}
 */
function formatDiagnostic(err, options) {
  const opts = options || {};
  const maxWidth = opts.maxWidth != null ? opts.maxWidth : 120;
  const lines = [];
  if (err instanceof JsTamilSyntaxError) {
    lines.push(err.locationString());
    const codeSuffix = err.code ? ` [${err.code}]` : '';
    lines.push(`${err.name}${codeSuffix}: ${err.message}`);
    // The `L | text` gutter grows with the line number; the caret line must
    // use the same width or multi-digit line numbers shift the caret left.
    const caretPrefix = ' '.repeat(String(err.line).length + 3) + '| ';
    if (typeof opts.source === 'string' && err.line != null) {
      const rawLines = opts.source.split(/\r\n|\r|\n/);
      const errorLine = rawLines[err.line - 1];
      if (errorLine !== undefined) {
        let shown = errorLine;
        if (shown.length > maxWidth) {
          // Keep the region around the error column when possible.
          const col = err.column != null ? err.column : 1;
          const start = Math.max(0, Math.min(shown.length - maxWidth, col - Math.floor(maxWidth / 2)));
          shown = (start > 0 ? '…' : '') + shown.slice(start, start + maxWidth) + (start + maxWidth < errorLine.length ? '…' : '');
          // Clamp the caret to the shown text: a column past the line end
          // (or an absurd column on a crafted error) must not allocate an
          // enormous string of spaces or point past the visible line.
          const caretAt = Math.min(start > 0 ? col - start + 1 : col, shown.length + 1);
          lines.push(`  ${err.line} | ${shown}`);
          if (err.column != null) {
            lines.push(`${caretPrefix}${' '.repeat(Math.max(0, caretAt - 1))}^`);
          }
        } else {
          lines.push(`  ${err.line} | ${shown}`);
          if (err.column != null) {
            const caretAt = Math.min(err.column, errorLine.length + 1);
            lines.push(`${caretPrefix}${' '.repeat(Math.max(0, caretAt - 1))}^`);
          }
        }
      }
    }
    return lines.join('\n');
  }
  if (err instanceof JsTamilError) {
    const codeSuffix = err.code ? ` [${err.code}]` : '';
    return `${err.name}${codeSuffix}: ${err.message}`;
  }
  return String((err && err.stack) || err);
}

// TamilScript-branded aliases. They are the same constructors (not
// subclasses), so every existing `instanceof JsTamil*` check keeps working
// and both names can be used interchangeably. The historical `JsTamil*`
// names and `JST_*` codes remain public API for compatibility.
const TamilScriptError = JsTamilError;
const TamilScriptSyntaxError = JsTamilSyntaxError;

module.exports = {
  ErrorCodes,
  JsTamilError,
  JsTamilSyntaxError,
  TamilScriptError,
  TamilScriptSyntaxError,
  formatDiagnostic,
};
