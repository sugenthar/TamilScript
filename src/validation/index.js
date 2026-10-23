'use strict';

const { transformWithMap } = require('../transformer');
const { parseJavaScript } = require('./javascript-syntax');

/**
 * Validate TamilScript source without executing it.
 *
 * Validation has two stages:
 *   1. the core lexical transformer (malformed Tamil literals/keywords);
 *   2. a real JavaScript parser over the transformed output (invalid JS).
 *
 * The parser is Acorn. It is a syntax-only check: it proves the program is
 * parseable, not that identifiers exist, types match, or imports resolve.
 * Those are semantic concerns and are deliberately outside this API.
 *
 * @param {string} source TamilScript source text
 * @param {{ filename?: string, tamilKeywords?: boolean }} [options]
 * @returns {{ ok: true, code: string } | { ok: false, diagnostic: { line: number, column: number, message: string, code: string|null, name: string } }}
 *   line/column are 1-based, matching the rest of the core API.
 * @throws {TypeError} when source is not a string
 */
function validate(source, options) {
  if (typeof source !== 'string') {
    throw new TypeError(`validate() expects source as a string, got ${typeof source}`);
  }
  const opts = options || {};
  try {
    const transformed = transformWithMap(source, opts);
    const syntax = parseJavaScript(transformed.code, transformed.positions);
    if (syntax) return { ok: false, diagnostic: syntax };
    return { ok: true, code: transformed.code };
  } catch (err) {
    return {
      ok: false,
      diagnostic: {
        line: err && err.line != null ? err.line : 1,
        column: err && err.column != null ? err.column : 1,
        message: (err && err.message) || String(err),
        code: (err && err.code) || null,
        name: (err && err.name) || 'Error',
      },
    };
  }
}

module.exports = {
  validate,
};
