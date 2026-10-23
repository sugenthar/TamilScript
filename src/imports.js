'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { transform, transformWithMap } = require('./transformer');
const { Scanner } = require('./lexer');
const { buildSourceMap, inlineSourceMapComment } = require('./sourcemap');
const { lineStarts } = require('./lines');
const { PRINT_HELPER_NAME } = require('./runtime');

/**
 * Dependency-aware transformation: only the entry file is passed to the
 * Node.js runtime, but a TamilScript program may relatively import helpers that
 * also contain TamilScript syntax. Node.js cannot load those raw files, so this
 * module rewrites relative `import`/`export ... from`/`require()`/
 * `import()` specifiers to point at transformed temporary siblings.
 *
 * Plain JavaScript passes through `transform()` byte-identical, so rewriting
 * every resolved relative JS dependency is always safe.
 */

// ---------------------------------------------------------------------------
// Specifier scanner (operates on already-transformed, i.e. plain, JS)
// ---------------------------------------------------------------------------

/**
 * Word immediately before index `i` (skipping whitespace), or '' when the
 * previous significant character is not part of a word. A generator star
 * (`function* f`) is skipped as well. Used to tell a real `require(...)`
 * call from the declaration `function require(...)`, where rewriting the
 * first argument would be wrong.
 * @param {string} source plain JavaScript source
 * @param {number} i index of the first character after the previous word
 * @returns {string}
 */
function prevWordBefore(source, i) {
  let j = prevSignificantIndex(source, i);
  // A generator star (`function* f`) is skipped as well.
  if (j >= 0 && source[j] === '*') j = prevSignificantIndex(source, j);
  if (j < 0 || !/[A-Za-z0-9_$]/.test(source[j])) return '';
  let k = j;
  while (k >= 0 && /[A-Za-z0-9_$]/.test(source[k])) k -= 1;
  return source.slice(k + 1, j + 1);
}

/**
 * Find string-literal module specifiers in static import/export-from,
 * require() and dynamic import() positions.
 * @param {string} source plain JavaScript source
 * @returns {Array<{ start: number, end: number, value: string, quote: string }>}
 *   `start`/`end` cover the quoted literal including quotes.
 */
function findSpecifierSpans(source) {
  const spans = [];
  const state = { expectFrom: false, pendingCall: null, pendingCallOpen: null, lastSig: 'start' };
  // Reuse the transformer's lexical scanner for regex boundaries. Its
  // block/object context is the single source of truth here; guessing from
  // `lastSig` alone misreads `/require("./x")/` after `{}` as a call.
  const scanner = new Scanner(source, { collectSpans: true });
  scanner.run();
  const regexSpans = new Map();
  for (const span of scanner.spans) {
    if (span.kind === 'regex') regexSpans.set(span.start, span.end);
  }
  scanCode(source, 0, source.length, spans, state, true, regexSpans);
  return spans;
}

/**
 * Next non-trivia character at or after index i (skips whitespace/comments).
 */
function nextSignificantChar(source, i, end) {
  i = skipTrivia(source, i, end);
  return i < end ? source[i] : '';
}

/**
 * Index of the previous non-trivia character before `i`, skipping
 * whitespace, line comments and block comments. Returns -1 at the start of
 * the source.
 * @param {string} source
 * @param {number} i
 * @returns {number}
 */
function prevSignificantIndex(source, i) {
  let j = i - 1;
  while (j >= 0) {
    const ch = source[j];
    if (/\s/.test(ch)) {
      j -= 1;
      continue;
    }
    if (ch === '/' && source[j - 1] === '/') {
      // End of a line comment: move before its first slash, then to the
      // start of the line (the newline is skipped as whitespace next round).
      j -= 2;
      while (j >= 0 && source[j] !== '\n') j -= 1;
      continue;
    }
    if (ch === '/' && source[j - 1] === '*') {
      // End of a block comment: jump before its opening `/*`. Comments do
      // not nest, so the nearest opening marker is the right one.
      const open = source.lastIndexOf('/*', j - 2);
      if (open === -1) return -1;
      j = open - 1;
      continue;
    }
    return j;
  }
  return -1;
}

/**
 * Previous non-trivia character before index i (skips whitespace/comments).
 */
function prevSignificantChar(source, i) {
  const j = prevSignificantIndex(source, i);
  return j < 0 ? '' : source[j];
}

function isWordChar(ch) {
  return (
    ch === '_' || ch === '$' ||
    (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
    (ch >= '0' && ch <= '9') || (ch && ch.codePointAt(0) > 127)
  );
}

/**
 * Skip trivia (whitespace + comments). Returns new index.
 */
function skipTrivia(source, i, end) {
  for (;;) {
    while (i < end && /\s/.test(source[i])) i += 1;
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < end && source[i] !== '\n') i += 1;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < end && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    return i;
  }
}

/**
 * Decode one JavaScript string escape sequence starting at the backslash
 * `source[j]`. Follows the cooked-string value rules that matter for module
 * specifiers: line continuations contribute nothing, simple escapes map to
 * their control character, `\xHH` / `\uHHHH` / `\u{...}` decode, legacy
 * octal digits decode, and any other escaped character is itself.
 *
 * @param {string} source
 * @param {number} j index of the backslash
 * @param {number} end
 * @returns {{ value: string, next: number }|null}
 */
function decodeStringEscape(source, j, end) {
  const n1 = source[j + 1];
  if (n1 === undefined) return null;
  // Line continuation: backslash + line terminator contributes no character.
  if (n1 === '\n') return { value: '', next: j + 2 };
  if (n1 === '\r') return { value: '', next: source[j + 2] === '\n' ? j + 3 : j + 2 };
  if (n1 === '\u2028' || n1 === '\u2029') return { value: '', next: j + 2 };
  const simple = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
  if (Object.prototype.hasOwnProperty.call(simple, n1)) {
    return { value: simple[n1], next: j + 2 };
  }
  if (n1 === 'x') {
    const hex = source.slice(j + 2, j + 4);
    if (hex.length === 2 && /^[0-9a-fA-F]{2}$/.test(hex)) {
      return { value: String.fromCharCode(parseInt(hex, 16)), next: j + 4 };
    }
    // Invalid hex escape: the source is a SyntaxError. Keep scanning
    // leniently so one malformed literal cannot hide later valid ones.
    return { value: 'x', next: j + 2 };
  }
  if (n1 === 'u') {
    if (source[j + 2] === '{') {
      const close = source.indexOf('}', j + 3);
      if (close !== -1 && close - (j + 3) >= 1 && close - (j + 3) <= 6) {
        const hex = source.slice(j + 3, close);
        if (/^[0-9a-fA-F]+$/.test(hex)) {
          const code = parseInt(hex, 16);
          if (code <= 0x10ffff) return { value: String.fromCodePoint(code), next: close + 1 };
        }
      }
      return { value: 'u', next: j + 2 };
    }
    const hex = source.slice(j + 2, j + 6);
    if (hex.length === 4 && /^[0-9a-fA-F]{4}$/.test(hex)) {
      return { value: String.fromCharCode(parseInt(hex, 16)), next: j + 6 };
    }
    return { value: 'u', next: j + 2 };
  }
  // Legacy octal escape (`\0` when not followed by a digit, `\1`, `\12`, ...).
  if (n1 >= '0' && n1 <= '7') {
    let digits = n1;
    let k = j + 2;
    while (k < end && digits.length < 3 && source[k] >= '0' && source[k] <= '7') {
      digits += source[k];
      k += 1;
    }
    const code = parseInt(digits, 8);
    if (code <= 0xff) return { value: String.fromCharCode(code), next: k };
    return { value: digits[0], next: j + 2 };
  }
  if (n1 === '8' || n1 === '9') return { value: n1, next: j + 2 };
  return { value: n1, next: j + 2 };
}

/**
 * Scan a template literal that is a directly-used module specifier:
 * `` import(`./x.js`) `` / `` require(`./x.js`) ``. Only templates with a
 * static value are accepted (no `${}`, no escapes, no line terminators);
 * anything else returns null and is handled as an ordinary template.
 *
 * @param {string} source
 * @param {number} i index of the opening backtick
 * @param {number} end
 * @returns {{ next: number, value: string }|null}
 */
function scanPlainTemplateSpecifier(source, i, end) {
  let j = i + 1;
  let value = '';
  while (j < end) {
    const ch = source[j];
    if (ch === '`') return { next: j + 1, value };
    if (ch === '\\') return null;
    if (ch === '$' && source[j + 1] === '{') return null;
    if (ch === '\n' || ch === '\r' || ch === '\u2028' || ch === '\u2029') return null;
    value += ch;
    j += 1;
  }
  return null;
}

/**
 * Scan a string literal starting at quote index. Returns
 * `{ next, value, quote }` with the cooked JavaScript value, or null when
 * unterminated (caller then stops).
 */
function scanString(source, i, end) {
  const quote = source[i];
  let j = i + 1;
  let value = '';
  while (j < end) {
    const ch = source[j];
    if (ch === '\\') {
      const escape = decodeStringEscape(source, j, end);
      if (!escape) return null;
      value += escape.value;
      j = escape.next;
      continue;
    }
    if (ch === quote) {
      return { next: j + 1, value, quote };
    }
    if (ch === '\n' || ch === '\r' || ch === '\u2028' || ch === '\u2029') return null;
    value += ch;
    j += 1;
  }
  return null;
}

/**
 * Scan plain-JS code for specifiers. Shared across `${}` nesting.
 * @returns {number} index where scanning stopped (end or closing brace)
 */
function scanCode(source, i, end, spans, state, topLevel, regexSpans) {
  let depth = 0;
  while (i < end) {
    const ch = source[i];
    // trivia
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < end && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < end && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    // strings
    if (ch === "'" || ch === '"') {
      const s = scanString(source, i, end);
      if (!s) return end; // unterminated: stop silently (syntax checked elsewhere)
      if (state.pendingCall) {
        // Only rewrite a call argument when the literal is the complete first
        // argument: `require("./x")` / `import("./x")`. Computed arguments
        // such as `require("./helper" + suffix)` must keep their original
        // text, otherwise the appended suffix would apply to the temp path.
        const direct =
          state.pendingCallOpen != null &&
          skipTrivia(source, state.pendingCallOpen + 1, end) === i;
        const after = nextSignificantChar(source, s.next, end);
        if (direct && (after === ')' || after === ',')) {
          spans.push({ start: i, end: s.next, value: s.value, quote: s.quote });
        }
        state.pendingCall = null;
        state.pendingCallOpen = null;
      } else if (state.expectStringDirect) {
        spans.push({ start: i, end: s.next, value: s.value, quote: s.quote });
        state.expectStringDirect = false;
        state.expectFrom = false;
      }
      i = s.next;
      state.lastSig = 'value';
      continue;
    }
    // template literal
    if (ch === '`') {
      // A template used directly as the module specifier
      // (`import(`./x.js`)`, `require(`./x.js`)`) has a static value when it
      // contains no substitutions or escapes; rewrite it like a string.
      const directTemplate =
        state.pendingCall != null &&
        state.pendingCallOpen != null &&
        skipTrivia(source, state.pendingCallOpen + 1, end) === i;
      if (directTemplate) {
        const t = scanPlainTemplateSpecifier(source, i, end);
        if (t) {
          spans.push({ start: i, end: t.next, value: t.value, quote: '`' });
          i = t.next;
          state.lastSig = 'value';
          state.pendingCall = null;
          state.pendingCallOpen = null;
          continue;
        }
      }
      i = skipTemplate(source, i, end, spans, state, regexSpans);
      state.lastSig = 'value';
      state.pendingCall = null;
      state.pendingCallOpen = null;
      continue;
    }
    // regex vs division: the transformer already classified every `/`, so
    // skip a recorded regex span instead of re-guessing from adjacent tokens.
    if (ch === '/') {
      const regexEnd = regexSpans.get(i);
      if (regexEnd !== undefined) {
        i = regexEnd;
        state.lastSig = 'value';
        state.pendingCall = null;
        continue;
      }
      i += 1;
      state.lastSig = 'operator';
      state.pendingCall = null;
      continue;
    }
    // ASCII numbers (operand ends a value for regex detection)
    if ((ch >= '0' && ch <= '9') || (ch === '.' && source[i + 1] >= '0' && source[i + 1] <= '9')) {
      let j = i;
      while (j < end && /[0-9a-zA-Z_.$]/.test(source[j])) j += 1;
      i = j;
      state.lastSig = 'value';
      state.pendingCall = null;
      continue;
    }
    // braces (only tracked off top level for ${} matching)
    if (ch === '{') {
      if (!topLevel) depth += 1;
      i += 1;
      state.lastSig = 'operator';
      state.pendingCall = null;
      continue;
    }    if (ch === '}') {
      if (!topLevel && depth === 0) return i; // caller consumes
      if (!topLevel) depth -= 1;
      i += 1;
      state.lastSig = 'value';
      continue;
    }
    if (ch === ';') {
      i += 1;
      state.lastSig = 'operator';
      state.expectFrom = false;
      state.pendingCall = null;
      continue;
    }
    // words
    if (isWordChar(ch)) {
      let j = i;
      while (j < end && isWordChar(source[j])) j += 1;
      const word = source.slice(i, j);
      const prev = prevSignificantChar(source, i);
      const dotted = prev === '.';
      if (!dotted) {
        if (word === 'import') {
          let k = skipTrivia(source, j, end);
          if (source[k] === '(') {
            state.pendingCall = 'import';
            state.pendingCallOpen = null;
            state.expectFrom = false;
          } else if (source[k] === '"' || source[k] === "'") {
            const s = scanString(source, k, end);
            if (s) {
              spans.push({ start: k, end: s.next, value: s.value, quote: s.quote });
              i = s.next;
              state.lastSig = 'value';
              state.expectFrom = false;
              continue;
            }
            return end;
          } else if (source[k] === '.') {
            // import.meta — nothing
            state.pendingCall = null;
            state.expectFrom = false;
          } else {
            state.pendingCall = null;
            state.expectFrom = true;
          }
        } else if (word === 'export') {
          state.pendingCall = null;
          state.expectFrom = true;
        } else if (word === 'from' && state.expectFrom) {
          const k = skipTrivia(source, j, end);
          if (source[k] === '"' || source[k] === "'") {
            const s = scanString(source, k, end);
            if (s) {
              spans.push({ start: k, end: s.next, value: s.value, quote: s.quote });
              i = s.next;
              state.lastSig = 'value';
              state.expectFrom = false;
              continue;
            }
            return end;
          }
          state.expectFrom = false;
        } else if (word === 'require' && prevWordBefore(source, i) !== 'function') {
          let k = skipTrivia(source, j, end);
          // `require?.('./x')`: optional-call syntax resolves the same way.
          if (source[k] === '?' && source[k + 1] === '.') k = skipTrivia(source, k + 2, end);
          if (source[k] === '(') {
            state.pendingCall = 'require';
            state.pendingCallOpen = null;
          }
        } else if (/^(true|false|null|this|super|undefined)$/.test(word)) {
          state.lastSig = 'value';
        } else if (/^(return|throw|case|do|else|new|delete|void|typeof|instanceof|in|of|yield|await)$/.test(word)) {
          state.lastSig = 'operator';
        } else {
          state.lastSig = 'value';
        }
      } else if (/^(true|false|null|this|super)$/.test(word)) {
        state.lastSig = 'value';
      }
      // a non-string token clears a pending call-string expectation,
      // unless this token itself set it (handled by `continue` paths above
      // for the direct-string cases; pendingCall set above must survive
      // the `(` that follows — handled in punctuation below).
      if (word !== 'import' && word !== 'require') state.pendingCall = null;
      i = j;
      continue;
    }
    // punctuation
    if ((ch === '+' && source[i + 1] === '+') || (ch === '-' && source[i + 1] === '-')) {
      i += 2;
      state.lastSig = 'value';
      state.pendingCall = null;
      continue;
    }
    // `require?.(` — keep the pending call across `?.` (both characters are
    // consumed here; `.` alone would otherwise clear it).
    if (ch === '?' && source[i + 1] === '.' && state.pendingCall != null) {
      i += 2;
      state.lastSig = 'operator';
      continue;
    }
    if (ch === '(') {
      // Keep pendingCall: `require (` / `import (` may have whitespace
      // between the keyword and the paren. Anything else that set no
      // expectation must not inherit a stale one — but pendingCall is
      // cleared by every other token branch, so only require/import
      // expectations can reach here.
      if (state.pendingCall && state.pendingCallOpen == null) state.pendingCallOpen = i;
      i += 1;
      state.lastSig = 'operator';
      continue;
    }
    if (ch === ')' || ch === ']' ) {
      i += 1;
      state.lastSig = 'value';
      state.pendingCall = null;
      continue;
    }
    i += 1;
    state.lastSig = 'operator';
    if (ch !== '(') state.pendingCall = null;
  }
  return i;
}

/** Skip a template literal; scan `${...}` expressions for specifiers. */
function skipTemplate(source, i, end, spans, state, regexSpans) {
  i += 1; // opening backtick
  while (i < end) {
    const ch = source[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '`') return i + 1;
    if (ch === '$' && source[i + 1] === '{') {
      const savedFrom = state.expectFrom;
      const savedPending = state.pendingCall;
      const savedPendingOpen = state.pendingCallOpen;
      const savedSig = state.lastSig;
      state.lastSig = 'start';
      const close = scanCode(source, i + 2, end, spans, state, false, regexSpans);
      i = close + 1; // consume `}`
      state.expectFrom = savedFrom;
      state.pendingCall = savedPending;
      state.pendingCallOpen = savedPendingOpen;
      state.lastSig = 'value';
      continue;
    }
    i += 1;
  }
  return i;
}

// ---------------------------------------------------------------------------
// Resolution + recursive transformation
// ---------------------------------------------------------------------------

const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

function candidatePaths(resolved) {
  const out = [resolved];
  if (!path.extname(resolved)) {
    for (const ext of ['.js', '.mjs', '.cjs']) out.push(resolved + ext);
    for (const ext of ['.js', '.mjs', '.cjs']) out.push(path.join(resolved, 'index' + ext));
  } else {
    out.push(path.join(resolved, 'index.js'));
  }
  return out;
}

/**
 * Resolve a relative specifier to an existing file, or null when it should
 * be left untouched (bare specifiers, node: URLs, other extensions, missing).
 */
function resolveSpecifier(spec, fromDir) {
  let clean = spec;
  // Windows accepts backslash separators in require() specifiers; Node ESM
  // rejects them, but normalizing keeps CommonJS Tamil dependencies working.
  if (process.platform === 'win32') clean = clean.split('\\').join('/');
  if (!clean.startsWith('./') && !clean.startsWith('../')) return null;
  clean = clean.split('?')[0].split('#')[0];
  const resolved = path.resolve(fromDir, clean);
  for (const candidate of candidatePaths(resolved)) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        if (JS_EXTENSIONS.has(path.extname(candidate).toLowerCase()) || !path.extname(resolved)) {
          return candidate;
        }
        return null; // e.g. "./data.json" — load original as-is
      }
    } catch (err) {
      void err;
    }
  }
  return null;
}

/**
 * Find the nearest package.json `type` field walking up from `dir`.
 * @param {string} dir
 * @returns {Promise<string|null>} 'module' | 'commonjs' | null
 */
async function findPackageType(dir) {
  let current = path.resolve(dir);
  for (;;) {
    const candidate = path.join(current, 'package.json');
    try {
      const raw = await fs.promises.readFile(candidate, 'utf8');
      const pkg = JSON.parse(raw);
      if (pkg && (pkg.type === 'module' || pkg.type === 'commonjs')) {
        return pkg.type;
      }
      return null; // found package.json without type -> default CommonJS
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        return null;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Remove the shebang line (and a leading BOM) before parsing. Node strips a
 * shebang before compiling a CommonJS module, so the sniff must do the same.
 * @param {string} source
 * @returns {string}
 */
function stripModulePreamble(source) {
  let text = source;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.startsWith('#!')) {
    const nl = text.search(/\r?\n/);
    text = nl === -1 ? '' : text.slice(nl);
  }
  return text;
}

/**
 * Decide whether transformed source is valid CommonJS by compiling it inside
 * the same wrapper Node uses for CommonJS modules. The script is compiled,
 * never executed, so this has no side effects.
 *
 * This replaces text heuristics: `require("./x" + suffix)` inside an arrow,
 * a static `import` on a line that starts with `;`, and `import`/`export`
 * words in comments or templates are all classified by the parser instead of
 * by regular expressions. True top-level `await` fails the wrapper parse and
 * therefore selects ESM, while `await import()` inside a concise arrow body
 * remains CommonJS.
 *
 * @param {string} source transformed JavaScript
 * @returns {boolean} true when the source parses as a CommonJS module body
 */
function canParseAsCommonJS(source) {
  const text = stripModulePreamble(source);
  try {
    new vm.Script(
      '(function (exports, require, module, __filename, __dirname) {\n' + text + '\n})',
      { filename: 'tamilscript-module-type-check.js' }
    );
    return true;
  } catch (err) {
    void err;
    return false;
  }
}

/**
 * Choose a temp-file extension that preserves the original module semantics:
 * explicit .mjs/.cjs are honored; otherwise the nearest package.json `type`
 * wins (keeping `.js`, exactly like running the original with node); with no
 * package.json context, content sniffing decides between .mjs and .cjs.
 */
async function tempExtensionFor(absPath, transformed) {
  const ext = path.extname(absPath).toLowerCase();
  if (ext === '.mjs') return '.mjs';
  if (ext === '.cjs') return '.cjs';
  const pkgType = await findPackageType(path.dirname(path.resolve(absPath)));
  // An explicit package type wins, exactly like Node: .js stays .js under
  // both "module" and "commonjs". Those files keep their declared semantics,
  // so an ESM-only construct in a CommonJS-typed package remains a genuine
  // syntax error instead of being silently reinterpreted as ESM.
  if (pkgType === 'module' || pkgType === 'commonjs') return '.js';
  // No package.json type applies: sniff the transformed source. ESM is chosen
  // only when the CommonJS wrapper parse fails.
  return canParseAsCommonJS(transformed) ? '.cjs' : '.mjs';
}

async function tempBasenameFor(absPath, transformed) {
  const outExt = await tempExtensionFor(absPath, transformed);
  const base = path.basename(absPath, path.extname(absPath)).replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 40) || 'program';
  // Temp files carry the `tamilscript-` prefix. The stale-file sweep below
  // also accepts the retired `opentamizh-` and `jstamil-` prefixes so debris
  // from older releases is still cleaned up.
  return `tamilscript-${base}-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${outExt}`;
}

/**
 * Transform an entry file plus its relative JS dependencies into temporary
 * siblings, rewriting specifiers. Returns { entryTemp, tempFiles }.
 *
 * Only relative (`./`, `../`) JavaScript dependencies (`.js`, `.mjs`,
 * `.cjs`, extensionless, or extensionless `index` files) are transformed.
 * Bare package imports (`"lodash"`), `node:` URLs and non-JS assets
 * (`"./data.json"`) are left untouched for Node.js to resolve normally —
 * `node_modules` trees are never entered.
 *
 * Temporary files that were already written when a dependency fails are
 * removed before the error propagates, so failures never leak temp files.
 *
 * @param {string} entryAbs absolute path of the entry source file
 * @param {string} entryTransformed already-transformed entry source
 * @param {{ entrySource?: string, withMaps?: boolean, tamilKeywords?: boolean }} [options]
 *   `entrySource` is the original entry text (needed for source maps);
 *   `withMaps` appends an inline source map to every temp file so stack
 *   traces point at the original files; `tamilKeywords` enables the opt-in
 *   keyword aliases for every transformed file in the tree.
 */
async function buildTransformedTree(entryAbs, entryTransformed, options) {
  const opts = options || {};
  const withMaps = !!opts.withMaps;
  const transformOptions = (absPath) => ({
    filename: absPath,
    tamilKeywords: !!opts.tamilKeywords,
  });
  const mapping = new Map(); // absPath -> tempBasename (reserved before recursing: cycle-safe)
  const tempFiles = [];
  const sources = []; // every original file transformed (entry first)
  const attempted = []; // every file reached, including one that fails to transform
  let entryPositions = null; // adjusted token anchors for the entry file (withMaps)
  // Whether any transformed file mentions the Tamil print helper. A plain
  // substring check is deliberate: it cannot miss a real use (the name
  // survives transformation verbatim), and a stray mention in a comment or
  // string only costs one harmless global install at run time.
  const usesPrint = { value: false };

  async function transformOne(absPath, source) {
    if (!withMaps) {
      return {
        code: transform(source, transformOptions(absPath)),
        map: null,
        replacements: [],
      };
    }
    const r = transformWithMap(source, transformOptions(absPath));
    return r; // { code, map, replacements }
  }

  async function processFile(absPath, known) {
    // `known` is { source, code } for the entry file (already transformed
    // by the caller so diagnostics carry the entry filename); dependencies
    // are read and transformed here.
    const existing = mapping.get(absPath);
    if (existing) return existing;
    attempted.push(absPath);
    let source;
    let first;
    if (known) {
      source = known.source;
      first = withMaps
        ? transformWithMap(source, transformOptions(absPath))
        : { code: known.code, map: null, replacements: [] };
    } else {
      try {
        source = await fs.promises.readFile(absPath, 'utf8');
      } catch (err) {
        throw err; // unreadable: propagate; caller decides the message
      }
      first = await transformOne(absPath, source);
    }
    if (!usesPrint.value && source.includes(PRINT_HELPER_NAME)) usesPrint.value = true;
    const tempBase = await tempBasenameFor(absPath, first.code);
    mapping.set(absPath, tempBase);
    sources.push(absPath);
    const rw = await rewriteSpecifiers(first.code, path.dirname(absPath));
    let body = rw.code;
    if (withMaps && first.map) {
      const adjusted = adjustReplacements(first.replacements, rw.edits);
      const adjustedPositions = adjustPositions(first.positions || [], rw.edits);
      if (known) entryPositions = adjustedPositions;
      const map = buildSourceMap(source, body, adjusted, absPath, adjustedPositions);
      body += inlineSourceMapComment(map);
    }
    const tempAbs = path.join(path.dirname(absPath), tempBase);
    // Exclusive create (`wx`) so a pre-existing symlink or planted file is
    // never followed/truncated. Mode 0o600 keeps possibly-secret source out
    // of group/world-readable temporary files.
    let handle;
    try {
      handle = await fs.promises.open(tempAbs, 'wx', 0o600);
      await handle.writeFile(body, 'utf8');
      await handle.close();
      handle = null;
    } catch (err) {
      if (handle) {
        try { await handle.close(); } catch (closeErr) { void closeErr; }
      }
      // Only clean up a file this process created (not an EEXIST collision).
      if (!err || err.code !== 'EEXIST') {
        try { await fs.promises.unlink(tempAbs); } catch (cleanupErr) { void cleanupErr; }
      }
      throw err;
    }
    tempFiles.push(tempAbs);
    return tempBase;
  }

  async function rewriteSpecifiers(transformedText, fromDir) {
    const spans = findSpecifierSpans(transformedText);
    if (spans.length === 0) return { code: transformedText, edits: [] };
    // Offset -> (0-based line, column) table for segment adjustment.
    // `lineStarts` recognizes CRLF, lone CR, and LF, matching JavaScript.
    const starts = lineStarts(transformedText);
    const offsetToPos = (off) => {
      let lo = 0;
      let hi = starts.length;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= off) lo = mid;
        else hi = mid;
      }
      return { line: lo, col: off - starts[lo] };
    };
    let out = '';
    let cursor = 0;
    const edits = [];
    for (const span of spans) {
      const target = resolveSpecifier(span.value, fromDir);
      if (!target) continue;
      const tempBase = await processFile(target, null);
      // The temporary file sits next to the dependency, while the importer
      // itself is a temporary sibling of its own original path. Compute the
      // replacement relative to the importer's directory so dependencies in
      // subdirectories (or parent directories) resolve to the right temp
      // file instead of a same-named file next to the importer.
      const tempAbs = path.join(path.dirname(target), tempBase);
      let rel = path.relative(fromDir, tempAbs).split(path.sep).join('/');
      if (!rel.startsWith('.')) rel = `./${rel}`;
      // Keep `?query` / `#fragment` on the rewritten specifier: they are part
      // of an ES module's identity, and dropping them would also truncate
      // `import.meta.url` inside the dependency.
      const suffixIndex = span.value.search(/[?#]/);
      const suffix = suffixIndex === -1 ? '' : span.value.slice(suffixIndex);
      // Quote the rewritten path with JSON rules. The original quote
      // character must not be reused unescaped: a directory name can contain
      // quotes or backslashes, and inserting them raw would corrupt the
      // program (and the source map edit length).
      const replacement = JSON.stringify(rel + suffix);
      const a = offsetToPos(span.start);
      const b = offsetToPos(span.end);
      if (a.line === b.line) {
        edits.push({ line: a.line, startCol: a.col, endCol: b.col, newLen: replacement.length });
      }
      out += transformedText.slice(cursor, span.start) + replacement;
      cursor = span.end;
    }
    out += transformedText.slice(cursor);
    return { code: out, edits };
  }

  /**
   * Shift recorded output columns on lines where a specifier rewrite
   * changed the text length. Source positions never change.
   */
  function adjustReplacements(replacements, edits) {
    if (edits.length === 0) return replacements;
    return replacements.map((r) => {
      if (r.outLen < 0) return r;
      const line = r.outLine - 1;
      let shift = 0;
      for (const e of edits) {
        if (e.line === line && e.endCol <= r.outCol) {
          shift += e.newLen - (e.endCol - e.startCol);
        }
      }
      return shift === 0 ? r : Object.assign({}, r, { outCol: r.outCol + shift });
    });
  }

  /** Shift dense token anchors past rewritten specifiers on the same line. */
  function adjustPositions(positions, edits) {
    if (edits.length === 0) return positions;
    return positions.map((p) => {
      const line = p.outLine - 1;
      let shift = 0;
      for (const e of edits) {
        if (e.line === line && e.endCol <= p.outCol) {
          shift += e.newLen - (e.endCol - e.startCol);
        }
      }
      return shift === 0 ? p : Object.assign({}, p, { outCol: p.outCol + shift });
    });
  }

  try {
    const entryTempBase = await processFile(path.resolve(entryAbs), {
      source: opts.entrySource != null ? opts.entrySource : entryTransformed,
      code: entryTransformed,
    });
    return {
      entryTemp: path.join(path.dirname(path.resolve(entryAbs)), entryTempBase),
      tempFiles,
      sources,
      usesPrintHelper: usesPrint.value,
      entryPositions,
    };
  } catch (err) {
    // A dependency failed (unreadable or invalid TamilScript): remove temp
    // files already written so failures never leak them, then rethrow
    // the original diagnostic unchanged. `tamilscriptSources` lets watch
    // mode keep watching every file it reached, including the failing one.
    await cleanupTempFiles(tempFiles);
    if (err && typeof err === 'object' && !err.tamilscriptSources) {
      try {
        err.tamilscriptSources = attempted.slice();
      } catch (attachErr) {
        void attachErr;
      }
    }
    throw err;
  }
}

/**
 * Delete temporary files (best effort).
 * @param {string[]} files
 */
async function cleanupTempFiles(files) {
  for (const f of files.slice().reverse()) {
    try {
      await fs.promises.unlink(f);
    } catch (err) {
      void err;
    }
  }
}

/**
 * Best-effort sweep of stale TamilScript temp files left behind by
 * unhandleable termination (e.g. SIGKILL, or a Windows kill() signal,
 * which terminates the process without running any handlers).
 *
 * Temp files carry the `tamilscript-` prefix. Files with the retired
 * `opentamizh-` and `jstamil-` prefixes (from older releases) are swept as
 * well, so no
 * orphaned debris is left behind by an upgrade; only files matching this
 * process's own pid are considered, files in
 * `except` (live trees) are skipped, and files must be older than
 * `olderThanMs` so a concurrent same-process run is never disturbed.
 *
 * @param {string[]} dirs directories to sweep
 * @param {{ except?: Set<string>, olderThanMs?: number }} [options]
 * @returns {Promise<string[]>} removed files
 */
async function sweepStalePidTemps(dirs, options) {
  const opts = options || {};
  const except = opts.except || new Set();
  const olderThanMs = opts.olderThanMs != null ? opts.olderThanMs : 60000;
  const now = Date.now();
  const removed = [];
  const marker = `-${process.pid}-`;
  for (const dir of dirs) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir);
    } catch (err) {
      void err;
      continue;
    }
    for (const name of entries) {
      if (
        !(name.startsWith('tamilscript-') || name.startsWith('opentamizh-') || name.startsWith('jstamil-')) ||
        !name.includes(marker)
      ) {
        continue;
      }
      const full = path.join(dir, name);
      if (except.has(full)) continue;
      let stat;
      try {
        stat = await fs.promises.stat(full);
      } catch (err) {
        void err;
        continue;
      }
      if (!stat.isFile()) continue;
      if (now - stat.mtimeMs < olderThanMs) continue;
      try {
        await fs.promises.unlink(full);
        removed.push(full);
      } catch (err) {
        void err;
      }
    }
  }
  return removed;
}

module.exports = {
  findSpecifierSpans,
  resolveSpecifier,
  buildTransformedTree,
  cleanupTempFiles,
  sweepStalePidTemps,
  findPackageType,
  tempExtensionFor,
  tempBasenameFor,
};
