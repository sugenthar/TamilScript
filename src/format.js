'use strict';

// Conservative TamilScript formatter.
//
// Full pretty-printing of arbitrary JavaScript requires a parser; without
// one (and without adding a runtime dependency) rewriting code structure
// would be guesswork. This formatter therefore performs only changes that
// are provably semantics-preserving:
//
//   1. Trailing spaces/tabs (and \v/\f) at end of line are removed.
//   2. Lines that contain only such whitespace become empty lines.
//   3. A missing final line break is added (CRLF files get CRLF).
//
// Whitespace inside strings, template literals, comments and regular
// expressions is never touched: the core lexer records those protected
// spans (Scanner `collectSpans`) and the formatter only edits whitespace
// outside them. The input must transform successfully, so malformed
// TamilScript is refused instead of rewritten.
//
// The result is idempotent by construction: a formatted file has no
// trimmable whitespace left, so formatting it again changes nothing.

const { Scanner } = require('./lexer');

/**
 * Merge recorded protected spans into sorted, disjoint [start, end)
 * intervals (template expressions can nest spans).
 * @param {Array<{ kind: string, start: number, end: number }>} spans
 * @returns {Array<{ start: number, end: number }>}
 */
function mergeSpans(spans) {
  const sorted = spans
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) {
      if (s.end > last.end) last.end = s.end;
    } else {
      merged.push({ start: s.start, end: s.end });
    }
  }
  return merged;
}

/** Characters trimmed at end of line (never BOM or Unicode spaces). */
function isTrimChar(ch) {
  return ch === ' ' || ch === '\t' || ch === '\v' || ch === '\f';
}

/**
 * Format TamilScript/JavaScript source conservatively.
 *
 * @param {string} source original text
 * @returns {string} formatted text (may equal the input)
 * @throws {TypeError} when source is not a string
 * @throws {import('./errors').JsTamilSyntaxError} when the source does not
 *   transform (unsupported or malformed TamilScript)
 */
function formatSource(source) {
  if (typeof source !== 'string') {
    throw new TypeError(`formatSource() expects source as a string, got ${typeof source}`);
  }
  if (source.length === 0) return source;
  // Running the scanner both validates the input and records the protected
  // spans; a failure here means the file must not be rewritten at all.
  const scanner = new Scanner(source, { collectSpans: true });
  scanner.run();
  const spans = mergeSpans(scanner.spans);

  let out = '';
  let i = 0;
  let spanIndex = 0;
  const inside = (offset) => {
    while (spanIndex < spans.length && spans[spanIndex].end <= offset) spanIndex += 1;
    return (
      spanIndex < spans.length &&
      spans[spanIndex].start <= offset &&
      offset < spans[spanIndex].end
    );
  };

  while (i < source.length) {
    const ch = source[i];
    if (isTrimChar(ch)) {
      let j = i;
      while (j < source.length && isTrimChar(source[j])) j += 1;
      const atLineEnd = j >= source.length || source[j] === '\n' || source[j] === '\r';
      const protectedSpan = inside(i) || inside(j - 1);
      if (!(atLineEnd && !protectedSpan)) {
        out += source.slice(i, j);
      }
      i = j;
      continue;
    }
    out += ch;
    i += 1;
  }

  if (!out.endsWith('\n') && !out.endsWith('\r')) {
    out += source.includes('\r\n') ? '\r\n' : '\n';
  }
  return out;
}

module.exports = {
  formatSource,
  mergeSpans,
};
