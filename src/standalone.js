'use strict';

// Standalone-runtime support for transform output.
//
// a TamilScript program may call the Tamil print helper அச்சிடு() without
// importing it: `tamilscript run` loads src/register.js, which installs the
// helper from src/runtime.js as a shared global before the program starts.
// Transformed output is meant to execute under plain `node`, where no such
// installer exists, so the transform pipeline prepends a small inlined
// prelude that installs the same global when it is missing. The prelude is
// plain statements only — no `require`, no `import` — so it behaves
// identically in CommonJS and ESM outputs, and needs no installed tamilscript
// package. It never overwrites an existing global and modifies no built-ins.
//
// The prelude must stay behaviorally identical to src/runtime.js: ordinary
// console.log semantics (printf-style formatting, one line per call, write
// errors ignored) through a private color-free Console, so program output is
// byte-exact even under FORCE_COLOR. It reaches the Console class through the
// documented `console.Console` property, which exists on every supported
// Node.js version (verified 18.0.0 through 24) and in both module systems.
// test/standalone.test.js compares the prelude with src/runtime.js in child
// processes under FORCE_COLOR.
//
// Injection point rules (the transformed code, not the Tamil source, is
// inspected, since both keep the helper name verbatim):
//   - after a leading BOM and hashbang line, so both keep working;
//   - after the directive prologue (`"use strict";`), so strict mode
//     survives (a prelude before it would silently make the file sloppy);
//   - at a line boundary when one is available, so source-map line numbers
//     shift by whole lines; otherwise the current line is split and
//     adjustMappingsForInjection() keeps the map line-accurate.

const { PRINT_HELPER_NAME } = require('./runtime');
const { decodeMappings, encodeVlq } = require('./sourcemap');
const { lineColumnAt } = require('./lines');

const HELPER_LITERAL = JSON.stringify(PRINT_HELPER_NAME);

/**
 * The inlined prelude (14 lines, always ending with one newline).
 * Generated (not a source constant) so the helper name stays single-sourced
 * from src/runtime.js.
 *
 * @returns {string}
 */
function preludeText() {
  return [
    '// TamilScript standalone runtime: installs the Tamil print helper the',
    '// same way `tamilscript run` does. Inlined so this file runs under plain',
    '// `node`, with no installed tamilscript package and no manual import.',
    `if (typeof globalThis[${HELPER_LITERAL}] === "undefined") {`,
    `  globalThis[${HELPER_LITERAL}] = (() => {`,
    '    const plain = new console.Console({',
    '      stdout: process.stdout,',
    '      stderr: process.stderr,',
    '      ignoreErrors: true,',
    '      colorMode: false',
    '    });',
    '    return (...args) => plain.log(...args);',
    '  })();',
    '}',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Insertion point
// ---------------------------------------------------------------------------

function isLineTerminator(ch) {
  return ch === '\n' || ch === '\r' || ch === '\u2028' || ch === '\u2029';
}

/**
 * Skip whitespace and comments forward from `i`.
 *
 * @param {string} code JavaScript source
 * @param {number} i index to start from
 * @returns {{ index: number, lineBreak: boolean }} next significant index,
 *   and whether the skipped text contained a line terminator (a newline
 *   inside a block comment counts: ASI sees it).
 */
function skipTrivia(code, i) {
  let lineBreak = false;
  for (;;) {
    while (i < code.length && /\s/.test(code[i])) {
      if (isLineTerminator(code[i])) lineBreak = true;
      i += 1;
    }
    if (code[i] === '/' && code[i + 1] === '/') {
      i += 2;
      while (i < code.length && !isLineTerminator(code[i])) i += 1;
      lineBreak = true;
      continue;
    }
    if (code[i] === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
        if (isLineTerminator(code[i])) lineBreak = true;
        i += 1;
      }
      i = Math.min(code.length, i + 2);
      continue;
    }
    return { index: i, lineBreak };
  }
}

/**
 * Scan a string literal starting at its opening quote.
 *
 * @param {string} code
 * @param {number} i index of the opening quote
 * @returns {number} index just past the closing quote, or -1 when the
 *   literal is unterminated (a raw line terminator ends it; `\`-continued
 *   line breaks do not).
 */
function scanStringLiteral(code, i) {
  const quote = code[i];
  let j = i + 1;
  while (j < code.length) {
    const ch = code[j];
    if (ch === '\\') {
      j += 1;
      if (code[j] === '\r' && code[j + 1] === '\n') j += 2;
      else j += 1;
      continue;
    }
    if (ch === quote) return j + 1;
    if (isLineTerminator(ch)) return -1;
    j += 1;
  }
  return -1;
}

/**
 * Whether the token at `i` continues a preceding string expression, so a
 * line break there does not trigger ASI and the string is not a directive
 * (`"use strict" + x`, `"use strict"(x)`, `"use strict".length`, ...).
 *
 * @param {string} code
 * @param {number} i index of the first significant character after the string
 * @returns {boolean}
 */
function continuesExpression(code, i) {
  const ch = code[i];
  if (ch === undefined) return false;
  if ('+-*/%<>=!&|^?,.([`'.includes(ch)) return true;
  const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(code.slice(i, i + 12));
  return !!word && (word[0] === 'in' || word[0] === 'instanceof');
}

/**
 * Offset just past a leading directive prologue, scanning from `from`.
 * Conservative by design: the scan stops at the first construct that is not
 * provably an expression statement holding a single string literal, so a
 * prelude never splits a bigger expression.
 *
 * @param {string} code
 * @param {number} from index after BOM/hashbang
 * @returns {number} offset at which a statement can be inserted
 */
function scanDirectivePrologue(code, from) {
  let i = from;
  let end = from;
  for (;;) {
    const t = skipTrivia(code, i);
    const j = t.index;
    const quote = code[j];
    if (quote !== '"' && quote !== "'") return end;
    const after = scanStringLiteral(code, j);
    if (after < 0) return end;
    const t2 = skipTrivia(code, after);
    const k = t2.index;
    if (code[k] === ';') {
      end = k + 1;
      i = k + 1;
      continue;
    }
    if (k >= code.length) return after; // EOF: `"use strict"` alone
    if (!t2.lineBreak) return end; // same line without `;`: not a directive
    if (continuesExpression(code, k)) return end;
    end = after; // ASI ended the directive statement
    i = after;
  }
}

/**
 * Where the prelude should be inserted in transformed `code`: after a
 * leading BOM, a hashbang line and the directive prologue, preferring a
 * line boundary (trailing spaces/tabs before the line break are skipped).
 *
 * @param {string} code transformed JavaScript
 * @returns {{ offset: number }} UTF-16 offset into `code`
 */
function insertionOffset(code) {
  let i = 0;
  if (code.charCodeAt(0) === 0xfeff) i = 1;
  if (code.startsWith('#!', i)) {
    while (i < code.length && code[i] !== '\n' && code[i] !== '\r') i += 1;
    if (code[i] === '\r' && code[i + 1] === '\n') i += 2;
    else if (code[i] === '\r' || code[i] === '\n') i += 1;
  }
  const end = scanDirectivePrologue(code, i);
  let j = end;
  while (code[j] === ' ' || code[j] === '\t') j += 1;
  if (j >= code.length) return { offset: code.length };
  if (code[j] === '\n') return { offset: j + 1 };
  if (code[j] === '\r') return { offset: code[j + 1] === '\n' ? j + 2 : j + 1 };
  return { offset: end };
}

// ---------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------

/**
 * Prepend the standalone runtime prelude when the program mentions the
 * Tamil print helper (same substring rule as the run pipeline in
 * src/imports.js: it cannot miss a real use, and a stray mention in a
 * comment or string only costs one harmless global install).
 *
 * @param {string} code transformed JavaScript (standard, no Tamil literals)
 * @param {string} source original TamilScript source
 * @returns {{ code: string, injection: { line: number, column: number, lines: number }|null }}
 *   `injection` describes where the prelude was inserted: 0-based generated
 *   line, 0-based column, and the prelude's line count. It is exactly what
 *   adjustMappingsForInjection() needs; null means nothing was inserted.
 */
function addStandaloneRuntime(code, source) {
  if (typeof source !== 'string' || !source.includes(PRINT_HELPER_NAME)) {
    return { code, injection: null };
  }
  const { offset } = insertionOffset(code);
  const at = lineColumnAt(code, offset);
  const prelude = preludeText();
  const lines = prelude.split('\n').length - 1;
  if (at.column === 0) {
    return {
      code: code.slice(0, offset) + prelude + code.slice(offset),
      injection: { line: at.line, column: 0, lines },
    };
  }
  if (offset >= code.length) {
    // Nothing follows the insertion point: terminate the last line, then
    // append the prelude. (The prelude ends with a newline itself.)
    return {
      code: `${code}\n${prelude}`,
      injection: { line: at.line + 1, column: 0, lines },
    };
  }
  return {
    code: code.slice(0, offset) + '\n' + prelude + code.slice(offset),
    injection: { line: at.line, column: at.column, lines },
  };
}

// ---------------------------------------------------------------------------
// Source-map adjustment
// ---------------------------------------------------------------------------

/**
 * Rewrite a Source Map v3 `mappings` string after the prelude was inserted.
 *
 * The map built by buildSourceMap() covers the pre-injection code, so lines
 * at or after the insertion must shift, and a mid-line insertion splits one
 * generated line into two (the tail keeps its source positions but starts
 * at generated column 0). Re-encoding from decoded absolute segments keeps
 * the VLQ deltas consistent with buildSourceMap()'s encoding.
 *
 * @param {string} mappings
 * @param {{ line: number, column: number, lines: number }|null} injection
 * @returns {string}
 */
function adjustMappingsForInjection(mappings, injection) {
  if (!injection || injection.lines === 0) return mappings;
  if (injection.column === 0) {
    const split = mappings.split(';');
    const empties = new Array(injection.lines).fill('');
    return split.slice(0, injection.line).concat(empties, split.slice(injection.line)).join(';');
  }
  const decoded = decodeMappings(mappings);
  const target = decoded[injection.line] || [];
  const before = [];
  const after = [];
  let boundary = null;
  for (const segment of target) {
    if (segment.gen < injection.column) {
      before.push({ gen: segment.gen, srcLine: segment.srcLine, srcCol: segment.srcCol });
      boundary = segment;
    } else if (segment.gen === injection.column) {
      // A token anchor exactly at the split belongs to the tail: shift it to
      // generated column 0 so the first tail token keeps its exact mapping.
      after.push({ gen: 0, srcLine: segment.srcLine, srcCol: segment.srcCol });
    } else {
      after.push({
        gen: segment.gen - injection.column,
        srcLine: segment.srcLine,
        srcCol: segment.srcCol,
      });
    }
  }
  // The tail starts a fresh generated line. Give it a base segment at the
  // split's source position (line accurate, and as column-accurate as the
  // nearest preceding segment allows) unless an exact anchor already sits at
  // generated column 0.
  if (after.length === 0 || after[0].gen !== 0) {
    const baseSrcLine = boundary ? boundary.srcLine : injection.line;
    const baseSrcCol = boundary
      ? boundary.srcCol + (injection.column - boundary.gen)
      : 0;
    after.unshift({ gen: 0, srcLine: baseSrcLine, srcCol: baseSrcCol });
  }
  const lines = decoded.map((segments) =>
    segments.map((s) => ({ gen: s.gen, srcLine: s.srcLine, srcCol: s.srcCol }))
  );
  lines.splice(injection.line, 1, before, ...new Array(injection.lines).fill([]), after);
  return encodeMappings(lines);
}

/**
 * Encode absolute segments exactly like buildSourceMap() does: generated
 * columns reset per line; source line/column deltas accumulate across the
 * whole mappings string. `src` (source index) is always the single source 0.
 *
 * @param {Array<Array<{ gen: number, srcLine: number, srcCol: number }>>} lines
 * @returns {string}
 */
function encodeMappings(lines) {
  let prevSrcLine = 0;
  let prevSrcCol = 0;
  const out = [];
  for (const segments of lines) {
    let prevGen = 0;
    const parts = [];
    for (const s of segments) {
      parts.push(
        encodeVlq(s.gen - prevGen) +
          encodeVlq(0) +
          encodeVlq(s.srcLine - prevSrcLine) +
          encodeVlq(s.srcCol - prevSrcCol)
      );
      prevGen = s.gen;
      prevSrcLine = s.srcLine;
      prevSrcCol = s.srcCol;
    }
    out.push(parts.join(','));
  }
  return out.join(';');
}

module.exports = {
  addStandaloneRuntime,
  adjustMappingsForInjection,
  preludeText,
  insertionOffset,
};
