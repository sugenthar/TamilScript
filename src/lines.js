'use strict';

/**
 * 0-based offsets of the first UTF-16 unit of each line.
 *
 * JavaScript treats `\r\n`, a lone `\r`, and `\n` as line terminators. A
 * CRLF pair produces one line start, not two.
 *
 * @param {string} text
 * @returns {number[]}
 */
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      starts.push(i + 1);
    } else if (ch === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

/**
 * 0-based line and column of `offset` in `text`.
 *
 * @param {string} text
 * @param {number} offset
 * @returns {{ line: number, column: number }}
 */
function lineColumnAt(text, offset) {
  const starts = lineStarts(text);
  let lo = 0;
  let hi = starts.length;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid;
  }
  return { line: lo, column: offset - starts[lo] };
}

module.exports = {
  lineStarts,
  lineColumnAt,
};
