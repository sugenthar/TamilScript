'use strict';

const { Scanner, transformSource } = require('./lexer');
const { buildSourceMap } = require('./sourcemap');

/**
 * Transform TamilScript source code into standard JavaScript.
 *
 * The input is ordinary JavaScript plus two custom value forms:
 * `$` + Tamil digits (e.g. `$௧௮` -> `18`) and `$` + Tamil decimal
 * digits around `.` (e.g. `$௧௨.௫` -> `12.5`). `$` is reserved for
 * numeric literals: the removed string form `$"..."` / `$'...'` raises
 * `JST_TAMIL_STRING_REMOVED`, and every other `$` (identifiers, tagged
 * templates such as `` $`...` ``) is ordinary JavaScript. Everything
 * else — including the contents of ordinary strings, comments, regular
 * expressions and the literal parts of template literals — is preserved
 * verbatim.
 *
 * This function transforms only; it never executes the source.
 *
 * @param {string} source TamilScript source text
 * @param {{ filename?: string, tamilKeywords?: boolean }} [options]
 *   optional filename used in error messages; `tamilKeywords` opts in to the
 *   documented Tamil keyword aliases (off by default)
 * @returns {string} standard JavaScript source
 * @throws {TypeError} when source is not a string
 * @throws {import('./errors').JsTamilSyntaxError} on malformed TamilScript syntax
 */
function transform(source, options) {
  return transformSource(source, options);
}

/**
 * Transform and also return a Source Map v3 object mapping the output
 * back to the original source (line-accurate everywhere, column-accurate
 * outside replaced literal spans).
 *
 * @param {string} source TamilScript source text
 * @param {{ filename?: string, tamilKeywords?: boolean }} [options]
 *   filename recorded in the map's `sources`; `tamilKeywords` opts in to
 *   Tamil keyword aliases
 * @returns {{ code: string, map: object, replacements: Array }} transformed
 *   code plus source map; `replacements` are the low-level single-line
 *   segments used to build the map (1-based lines, 0-based columns).
 * @throws {TypeError} when source is not a string
 * @throws {import('./errors').JsTamilSyntaxError} on malformed TamilScript syntax
 */
function transformWithMap(source, options) {
  if (typeof source !== 'string') {
    throw new TypeError(`transformWithMap() expects source as a string, got ${typeof source}`);
  }
  const opts = options || {};
  const scanner = new Scanner(source, Object.assign({}, opts, { collectPositions: true }));
  const code = scanner.run();
  const map = buildSourceMap(
    source,
    code,
    scanner.replacements,
    opts.filename != null ? opts.filename : '',
    scanner.positions
  );
  return { code, map, replacements: scanner.replacements, positions: scanner.positions };
}

/**
 * Transform and also return the list of custom literals that were
 * replaced (used by `tamilscript transform --explain`). Event collection is
 * strictly opt-in: plain `transform()` never records source snippets.
 *
 * @param {string} source TamilScript source text
 * @param {{ filename?: string, tamilKeywords?: boolean }} [options]
 *   filename used in error messages; `tamilKeywords` opts in to Tamil keyword
 *   aliases
 * @returns {{ code: string, events: Array<{ type: string, line: number, column: number, text: string, value: string }> }}
 *   `type` is one of `"number"`, `"decimal"`, `"range"`, or `"keyword"`.
 * @throws {TypeError} when source is not a string
 * @throws {import('./errors').JsTamilSyntaxError} on malformed TamilScript syntax
 */
function transformWithMeta(source, options) {
  if (typeof source !== 'string') {
    throw new TypeError(`transformWithMeta() expects source as a string, got ${typeof source}`);
  }
  const scanner = new Scanner(source, Object.assign({}, options, { collectEvents: true }));
  const code = scanner.run();
  return { code, events: scanner.events };
}

module.exports = {
  transform,
  transformWithMap,
  transformWithMeta,
};
