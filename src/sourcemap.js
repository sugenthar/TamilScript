'use strict';

/**
 * Source-map support for TamilScript.
 *
 * The transformer preserves line numbers exactly (output line N always
 * corresponds to source line N), so maps are line-accurate everywhere and
 * column-accurate outside replaced literal spans. Maps follow the Source
 * Map Revision 3 format and are consumed by Node.js via
 * `--enable-source-maps` with an inline data-URL comment, which makes
 * stack traces point at the original `.js` files.
 *
 * No third-party dependency: only a small VLQ encoder is needed, and it is
 * implemented here (the algorithm is stable and test-covered).
 */

const { lineStarts } = require('./lines');

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encode a single integer as Base64-VLQ.
 * @param {number} value signed integer
 * @returns {string}
 */
function encodeVlq(value) {
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) digit |= 32;
    out += BASE64[digit];
  } while (vlq > 0);
  return out;
}

/**
 * Decode a Base64-VLQ value starting at `index`.
 * @returns {{ value: number, next: number }}
 */
function decodeVlq(mappings, index) {
  let result = 0;
  let shift = 0;
  let digit;
  do {
    const ch = mappings[index++];
    digit = BASE64.indexOf(ch);
    if (digit === -1) throw new Error(`Invalid VLQ character ${JSON.stringify(ch)}.`);
    result |= (digit & 31) << shift;
    shift += 5;
  } while (digit & 32);
  const negative = result & 1;
  result >>>= 1;
  return { value: negative ? -result : result, next: index };
}

/**
 * Build a Source Map v3 object mapping transformed output back to source.
 *
 * @param {string} source original TamilScript source
 * @param {string} code transformed JavaScript
 * @param {Array} replacements single-line segments recorded by the Scanner:
 *   { outLine, outCol, outLen, srcLine, srcCol, srcLen } (1-based lines,
 *   0-based UTF-16 columns). Multi-line entries (outLen -1) only anchor
 *   their start line, which already maps 1:1.
 * @param {string} sourceName name recorded in `sources` (usually the
 *   absolute original path; used in stack traces)
 * @param {Array} [positions] optional token-start anchors recorded by the
 *   Scanner: { outLine, outCol, srcLine, srcCol } (1-based lines, 0-based
 *   columns). Node.js resolves a generated position to the nearest preceding
 *   segment without interpolating columns, so these anchors make stack-trace
 *   columns exact at token starts (including lines with no replacement).
 * @returns {{ version: 3, file: string, sources: string[], sourcesContent: string[], names: string[], mappings: string }}
 */
function buildSourceMap(source, code, replacements, sourceName, positions) {
  // `\r\n`, `\r` and `\n` are all line terminators in JavaScript. Counting
  // only `\n` collapses lone-CR files into a single generated line.
  const outLineCount = lineStarts(code).length;
  // Group single-line replacements and token anchors per 0-based output line.
  const byLine = new Map();
  for (const r of replacements) {
    if (r.outLen < 0) continue; // multi-line: line mapping already holds
    const line = r.outLine - 1;
    if (!byLine.has(line)) byLine.set(line, []);
    byLine.get(line).push(r);
  }
  const anchorsByLine = new Map();
  if (Array.isArray(positions)) {
    for (const p of positions) {
      const line = p.outLine - 1;
      if (!anchorsByLine.has(line)) anchorsByLine.set(line, []);
      anchorsByLine.get(line).push(p);
    }
  }
  const lines = [];
  let prevSrcLine = 0;
  let prevSrcCol = 0;
  for (let outLine = 0; outLine < outLineCount; outLine++) {
    // Base segment: generated column 0 -> same source line, column 0.
    const segments = [{ gen: 0, srcLine: outLine, srcCol: 0 }];
    for (const p of anchorsByLine.get(outLine) || []) {
      segments.push({ gen: p.outCol, srcLine: p.srcLine - 1, srcCol: p.srcCol });
    }
    const reps = (byLine.get(outLine) || []).slice().sort((a, b) => a.outCol - b.outCol);
    for (const r of reps) {
      segments.push({ gen: r.outCol, srcLine: r.srcLine - 1, srcCol: r.srcCol });
      segments.push({ gen: r.outCol + r.outLen, srcLine: r.srcLine - 1, srcCol: r.srcCol + r.srcLen });
    }
    segments.sort((a, b) => (a.gen - b.gen) || (a.srcLine - b.srcLine) || (a.srcCol - b.srcCol));
    let prevGen = 0;
    const encodedSegs = [];
    let lastGen = -1;
    let lastSrcLine = -1;
    let lastSrcCol = -1;
    for (const s of segments) {
      if (s.gen === lastGen && s.srcLine === lastSrcLine && s.srcCol === lastSrcCol) {
        continue; // exact duplicate (anchor + replacement boundary)
      }
      encodedSegs.push(encodeVlq(s.gen - prevGen) + encodeVlq(0) + encodeVlq(s.srcLine - prevSrcLine) + encodeVlq(s.srcCol - prevSrcCol));
      prevGen = s.gen;
      prevSrcLine = s.srcLine;
      prevSrcCol = s.srcCol;
      lastGen = s.gen;
      lastSrcLine = s.srcLine;
      lastSrcCol = s.srcCol;
    }
    lines.push(encodedSegs.join(','));
  }
  return {
    version: 3,
    file: '',
    sources: [sourceName],
    sourcesContent: [source],
    names: [],
    mappings: lines.join(';'),
  };
}

/**
 * Render an inline sourceMappingURL comment for appending to generated code.
 * @param {object} map source map object (must be a non-null object)
 * @returns {string} `\n//# sourceMappingURL=...` comment
 * @throws {TypeError} when map is not a non-null object
 */
function inlineSourceMapComment(map) {
  if (map === null || typeof map !== 'object' || Array.isArray(map)) {
    throw new TypeError(`inlineSourceMapComment() expects a source map object, got ${Array.isArray(map) ? 'array' : map === null ? 'null' : typeof map}.`);
  }
  const json = JSON.stringify(map);
  const base64 = Buffer.from(json, 'utf8').toString('base64');
  return `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64}\n`;
}

/**
 * Decode a mappings string back into segments (used by tests to verify
 * round-trip correctness of the encoder).
 * @param {string} mappings
 * @returns {Array<Array<{ gen: number, src: number, srcLine: number, srcCol: number }>>}
 */
function decodeMappings(mappings) {
  const result = [];
  let srcLine = 0;
  let srcCol = 0;
  for (const line of mappings.split(';')) {
    const segments = [];
    if (line.length > 0) {
      let i = 0;
      let gen = 0;
      while (i < line.length) {
        if (line[i] === ',') { i += 1; continue; }
        let d = decodeVlq(line, i);
        gen += d.value;
        i = d.next;
        d = decodeVlq(line, i);
        const src = d.value;
        i = d.next;
        d = decodeVlq(line, i);
        srcLine += d.value;
        i = d.next;
        d = decodeVlq(line, i);
        srcCol += d.value;
        i = d.next;
        segments.push({ gen, src, srcLine, srcCol });
      }
    }
    result.push(segments);
  }
  return result;
}

/**
 * Map a 1-based line/column in generated JavaScript back to the original
 * source with the scanner's token-start anchors. Node.js reports a token
 * start; generated columns after a shortened Tamil literal are shifted by the
 * replacement delta, so the nearest preceding anchor supplies the exact
 * original column. Returns `{ line, column }` unchanged when no anchor
 * applies.
 *
 * @param {Array<{ outLine: number, outCol: number, srcLine: number, srcCol: number }>|undefined} positions
 * @param {number} line 1-based generated line
 * @param {number} column 1-based generated column
 * @returns {{ line: number, column: number }}
 */
function mapGeneratedPosition(positions, line, column) {
  if (!Array.isArray(positions) || positions.length === 0) return { line, column };
  const genCol = Math.max(0, column - 1);
  let best = null;
  for (const p of positions) {
    if (p.outLine === line && p.outCol <= genCol) {
      if (!best || p.outCol >= best.outCol) best = p;
    }
  }
  if (!best) return { line, column };
  return { line: best.srcLine, column: best.srcCol + (genCol - best.outCol) + 1 };
}

module.exports = {
  encodeVlq,
  decodeVlq,
  buildSourceMap,
  inlineSourceMapComment,
  decodeMappings,
  mapGeneratedPosition,
};
