'use strict';

const { JsTamilSyntaxError, ErrorCodes } = require('./errors');
const { isTamilDigit, tamilDigitValue } = require('./numerals');
const {
  getKeywordMapping,
  keywordOptions,
  isDottedName,
  isPropertyNamePosition,
} = require('./keywords');

// Keywords after which a `/` starts a regex (expression expects a value).
// Anything else that behaves like an operator/punctuation also allows regex.
const REGEX_ALLOWED_KEYWORDS = new Set([
  'return', 'throw', 'case', 'do', 'else', 'new', 'delete', 'void',
  'typeof', 'instanceof', 'in', 'of', 'yield', 'await', 'as',
]);
// Keywords that end a value (an operand), so `/` after them is division.
const VALUE_KEYWORDS = new Set([
  'true', 'false', 'null', 'this', 'super', 'undefined',
]);
// Keywords whose `( ... )` is a control-flow condition: the closing `)` may
// be followed by a regex literal (`if (x) /re/.test(y)`), so it does not end
// a value for regex/division disambiguation the way `)` of a call does.
const CONTROL_CONDITION_KEYWORDS = new Set([
  'if', 'while', 'for', 'switch', 'catch', 'with',
]);

// Inclusive Tamil ranges are materialized with a self-contained array
// expression. The expansion deliberately avoids `Array.from` and user-scope
// identifiers so a local binding such as `const Array = ...` cannot change
// the result. The limit keeps a typo such as `$௦..$௯௯௯௯௯௯` from asking the
// runtime for an enormous array.
const MAX_TAMIL_RANGE_LENGTH = 100000;

/**
 * @typedef {{ line: number, column: number, filename?: string }} Location
 */

/**
 * Scanner state for the TamilScript lexical transformer.
 */
class Scanner {
  /**
   * @param {string} source
   * @param {{ filename?: string, collectEvents?: boolean, tamilKeywords?: boolean }} [options]
   */
  constructor(source, options) {
    this.source = source;
    this.length = source.length;
    this.i = 0;
    this.line = 1;
    this.column = 1;
    /** UTF-16 units emitted on the current output line (for map generated columns). */
    this.outLineLen = 0;
    this.out = [];
    this.filename = options && options.filename != null ? options.filename : undefined;
    this.collectEvents = !!(options && options.collectEvents);
    // Opt-in: Tamil words are ordinary identifiers unless the caller asks for
    // keyword mode. The registry owns the word list; the scanner only applies
    // the mapping while tracking JavaScript lexical context.
    this.tamilKeywords = keywordOptions(options).tamilKeywords;
    // this.column tracks SOURCE positions (1-based UTF-16 units) for error
    // locations, explain events and map source columns. Output columns (for
    // map generated columns) are tracked separately via outLineLen, because
    // a replacement is usually narrower than the source it replaces and both
    // may be needed for later literals on the same line.
    // lastSignificant: 'start' | 'value' | 'operator'
    this.lastSignificant = 'start';
    this.lastWord = null;
    // `for await (...)` is a control-flow header, but `await` normally ends a
    // value (`await (x) / 2` is division). Track the two-word sequence so the
    // header's `)` is treated like the `)` of `if`/`while`/`for`.
    this.maybeForAwait = false;
    this.forAwaitPending = false;
    // Stack of `(` that open a control-flow condition (if/while/for/...):
    // the matching `)` sets 'operator' so `if (x) /re/` is a regex, not
    // division. Ordinary call parentheses push false.
    this.controlParens = [];
    // Stack of closing significances for `{...}` pairs. A block or a
    // declaration body ends a statement (operator: a regex may follow),
    // while an object literal or a function/class expression is still a
    // value (division may follow). Plain braces default to 'value' to keep
    // object-literal division correct.
    this.braceStack = [];
    // Function/class headers whose body `{` is still pending. Keeping the
    // expression/declaration distinction prevents treating
    // `const f = function () {} / 2` as a regex.
    this.pendingFunctions = [];
    this.pendingClasses = [];
    // Previous significant token, used only for brace context. Comments and
    // whitespace do not update it.
    this.lastToken = null;
    this.lastParenWasControl = false;
    this.asyncExpression = false;
    // Statement-start tracking. Object/block ambiguity (`{a: 1}` as an object
    // expression versus `label: {}` / `case 1: {}` as blocks) needs more than
    // the previous token: a `{` opens a statement block exactly when a
    // statement can start there, or when it follows `)`, `=>`, `;`, `{`,
    // `}`, or one of else/try/finally/do/catch. `labelCandidate` and
    // `casePending` identify a colon as a label or case colon so the block
    // that follows gets block semantics (regex after its `}`).
    this.atStatementStart = true;
    this.labelCandidate = null;
    this.casePending = null;
    this.lastColonBlock = false;
    this.parenDepth = 0;
    this.bracketDepth = 0;
    this.ternaryDepth = 0;
    /** Transformation events for explain mode (opt-in only). */
    this.events = [];
    /** Single-line replacement segments for source maps (always recorded). */
    this.replacements = [];
    /**
     * Token-start positions for dense source maps (opt-in): Node.js does not
     * interpolate source-map columns, so a map with only line anchors reports
     * every generated position by the nearest preceding segment. Recording
     * each significant token start gives Node an exact original column for
     * the positions that appear in stack traces.
     */
    this.collectPositions = !!(options && options.collectPositions);
    this.positions = [];
    /** Protected lexical spans for formatting (strictly opt-in). */
    this.collectSpans = !!(options && options.collectSpans);
    this.spans = [];
  }

  /**
   * Record a protected lexical span (comments, strings, templates, regex)
   * when `collectSpans` is enabled. Used by the conservative formatter:
   * whitespace inside these spans is never rewritten.
   * @param {string} kind 'line-comment' | 'block-comment' | 'string' | 'template' | 'regex'
   * @param {number} start source offset of the span's first character
   */
  recordSpan(kind, start) {
    if (!this.collectSpans) return;
    this.spans.push({ kind, start, end: this.i });
  }

  err(message, line, column, code) {
    return new JsTamilSyntaxError(message, {
      line: line != null ? line : this.line,
      column: column != null ? column : this.column,
      filename: this.filename,
      code: code != null ? code : null,
    });
  }

  peek(offset) {
    const j = this.i + (offset || 0);
    return j < this.length ? this.source[j] : '';
  }

  /** Append raw text and advance line/column counters accordingly. */
  emit(text) {
    this.out.push(text);
    this.trackLines(text, true);
    this.noteOutput(text);
    this.i += text.length;
  }

  /**
   * Advance line/column counters for verbatim `text` (source and output
   * advance together here).
   * A `\r` followed by `\n` counts as one break even when the pair is
   * split across chunks (e.g. CRLF line endings scanned char by char):
   * with `peekSource`, a trailing `\r` looks at the upcoming source char.
   */
  trackLines(text, peekSource) {
    for (let k = 0; k < text.length; k++) {
      const ch = text[k];
      if (ch === '\n') {
        this.line += 1;
        this.column = 1;
      } else if (ch === '\r') {
        const nextInChunk = text[k + 1];
        const nextInSource = peekSource && k === text.length - 1 ? this.source[this.i + text.length] : undefined;
        if (nextInChunk === '\n' || nextInSource === '\n') {
          continue; // the \n iteration handles the break
        }
        this.line += 1;
        this.column = 1;
      } else {
        this.column += 1;
      }
    }
  }

  /**
   * Track output-line width for generated (map) columns. `text` is output
   * text just appended to `this.out`; line breaks reset the width. Called
   * by emit/pushMapped and by scanners that push verbatim text directly.
   * @param {string} text
   */
  noteOutput(text) {
    for (let k = 0; k < text.length; k++) {
      const ch = text[k];
      if (ch === '\n') {
        this.outLineLen = 0;
      } else if (ch === '\r') {
        if (text[k + 1] === '\n') continue; // CRLF: the \n resets
        this.outLineLen = 0;
      } else {
        this.outLineLen += 1;
      }
    }
  }

  result() {
    return this.out.join('');
  }

  /**
   * Push transformed output without advancing the source cursor.
   * Used for replacement text where the source was already consumed.
   * Only output counters move; `this.column` keeps tracking source.
   * @param {string} text
   */
  pushMapped(text) {
    this.out.push(text);
    this.noteOutput(text);
  }

  /**
   * Record the current token start as a dense source-map anchor (opt-in).
   * Source and output lines are identical because transformation preserves
   * line numbers; only columns can shrink inside replaced literals.
   */
  recordPosition() {
    if (!this.collectPositions) return;
    if (this.i >= this.length) return;
    this.positions.push({
      outLine: this.line,
      outCol: this.outLineLen,
      srcLine: this.line,
      srcCol: this.column - 1,
    });
  }

  /**
   * Record a transformation event (explain mode) and a source-map segment.
   * @param {string} kind 'number' | 'decimal'
   * @param {number} startI source offset where the literal began
   * @param {number} startLine 1-based line of the literal
   * @param {number} outCol1 1-based OUTPUT column of the literal
   * @param {number} srcCol1 1-based SOURCE column of the literal
   * @param {string} emitted replacement text
   */
  recordReplacement(kind, startI, startLine, outCol1, srcCol1, emitted) {
    const endI = this.i;
    if (this.collectEvents) {
      this.events.push({
        type: kind,
        line: startLine,
        column: srcCol1,
        text: this.source.slice(startI, endI),
        value: emitted,
      });
    }
    // TamilScript literals are single-line, so exact column segments are
    // recorded; the multi-line fallback below is kept for forward
    // compatibility with any future multi-line literal form.
    const srcSlice = this.source.slice(startI, endI);
    // Columns are stored 0-based (UTF-16 units) per the source-map spec;
    // the 1-based inputs need a -1.
    const outZero = outCol1 - 1;
    const srcZero = srcCol1 - 1;
    if (!srcSlice.includes('\n') && !srcSlice.includes('\r') && !emitted.includes('\n') && !emitted.includes('\r')) {
      this.replacements.push({
        outLine: startLine,
        outCol: outZero,
        outLen: emitted.length,
        srcLine: startLine,
        srcCol: srcZero,
        srcLen: endI - startI,
      });
    } else {
      this.replacements.push({
        outLine: startLine,
        outCol: outZero,
        outLen: -1, // multi-line: line-level accuracy only
        srcLine: startLine,
        srcCol: srcZero,
        srcLen: -1,
      });
    }
  }

  isIdentifierStart(ch) {
    if (ch === '$' || ch === '_' || ch === '\\') return true;
    if (!ch) return false;
    const code = ch.codePointAt(0);
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) return true;
    // Treat any non-ASCII letter-ish char as identifier char (Unicode ids).
    // Digits and Tamil digits are NOT identifier starts.
    if (code > 127 && !isTamilDigit(ch) && code !== 0x200c && code !== 0x200d) return true;
    return false;
  }

  isIdentifierPart(ch) {
    if (ch === '$' || ch === '_' || ch === '\\') return true;
    if (!ch) return false;
    const code = ch.codePointAt(0);
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) return true;
    if (code >= 48 && code <= 57) return true;
    if (code > 127) return true;
    return false;
  }

  isAsciiDigit(ch) {
    return ch >= '0' && ch <= '9';
  }

  markWord(word, dottedOverride) {
    // A keyword used as a property name (`obj.if(...)`) or private name
    // (`this.#if(...)`) must not open a control-condition context.
    const before = this.source[this.i - word.length - 1];
    const dotted = dottedOverride !== undefined
      ? !!dottedOverride
      : before === '.' || before === '#';
    this.lastWord = dotted ? null : word;
    if (dotted) {
      this.maybeForAwait = false;
      this.forAwaitPending = false;
    } else if (word === 'for') {
      this.maybeForAwait = true;
      this.forAwaitPending = false;
    } else if (word === 'await' && this.maybeForAwait) {
      this.maybeForAwait = false;
      this.forAwaitPending = true;
    } else {
      this.maybeForAwait = false;
      this.forAwaitPending = false;
    }
    // A dotted name is a property access or private-name reference
    // (`obj.if / 2`, `obj.await / 2`, `this.#do / 2`): the word there is an
    // ordinary identifier and always completes an operand, so a following
    // `/` is division. It must not re-enter keyword classification, which
    // would read that `/` as the start of a regex literal and either reject
    // valid JavaScript or silently corrupt the operator.
    if (dotted) {
      this.lastSignificant = 'value';
    } else if (REGEX_ALLOWED_KEYWORDS.has(word)) {
      this.lastSignificant = 'operator';
    } else if (VALUE_KEYWORDS.has(word)) {
      this.lastSignificant = 'value';
    } else {
      // ordinary identifier: a completed operand
      this.lastSignificant = 'value';
    }
    return dotted;
  }

  /** Remember the previous significant token for brace/keyword context. */
  noteToken(type, value) {
    this.lastToken = { type, value, endLine: this.line, endIndex: this.i };
  }

  /**
   * Index of the next non-trivia character at or after `i`, or the source
   * length at end of input. Used only for cheap keyword-role lookahead.
   * @param {number} i
   * @returns {number}
   */
  nextSignificantIndex(i) {
    let j = i;
    while (j < this.length) {
      const ch = this.source[j];
      if (/\s/.test(ch)) {
        j += 1;
        continue;
      }
      if (ch === '/' && this.source[j + 1] === '/') {
        j += 2;
        while (j < this.length && this.source[j] !== '\n' && this.source[j] !== '\r') j += 1;
        continue;
      }
      if (ch === '/' && this.source[j + 1] === '*') {
        const close = this.source.indexOf('*/', j + 2);
        if (close === -1) return this.length;
        j = close + 2;
        continue;
      }
      break;
    }
    return j;
  }

  /**
   * A `function`/`class` word can be an object/class property key or field
   * name (`{ function: 1 }`, `class C { class = 1 }`). Such a word does not
   * open a function/class header; treating it as one leaves stale pending
   * state that can later turn division after an arrow body into a regex.
   * @param {string} word
   * @returns {boolean}
   */
  isPropertyKeyKeyword(word) {
    if (word !== 'function' && word !== 'class') return false;
    const k = this.nextSignificantIndex(this.i);
    if (k >= this.length) return true;
    const ch = this.source[k];
    return ch === ':' || ch === '=' || ch === ';' || ch === ',' || ch === '}' ||
      ch === ']' || ch === '[' || ch === ')';
  }

  /**
   * True when a `function`/`class` keyword introduces an expression rather
   * than a declaration or statement. `previous` is the token before it.
   */
  isExpressionContext(previous) {
    if (!previous) return false;
    if (previous.type === 'word') {
      if (previous.value === 'async') return this.asyncExpression;
      return previous.value !== 'export' && previous.value !== 'default';
    }
    if (previous.type === 'punct') {
      if (previous.value === ';' || previous.value === '{' || previous.value === '}') return false;
      if (previous.value === ')') return !this.lastParenWasControl;
      return true;
    }
    return true;
  }

  /** Track `function`, `class` and `async` headers for brace context. */
  noteKeyword(word, previous) {
    if (word === 'async') {
      this.asyncExpression = this.isExpressionContext(previous);
      return;
    }
    if (word === 'function') {
      this.pendingFunctions.push({
        expression: this.isExpressionContext(previous),
        sawParen: false,
        parenDepth: 0,
      });
      this.asyncExpression = false;
      return;
    }
    if (word === 'class') {
      this.pendingClasses.push({
        expression: this.isExpressionContext(previous),
        parenDepth: 0,
      });
      this.asyncExpression = false;
      return;
    }
    this.asyncExpression = false;
  }

  /** Update pending headers when a `(` or `)` belongs to them. */
  noteParenOpen() {
    const fn = this.pendingFunctions[this.pendingFunctions.length - 1];
    if (fn) {
      if (fn.sawParen) fn.parenDepth += 1;
      else {
        fn.sawParen = true;
        fn.parenDepth = 1;
      }
    }
    const cls = this.pendingClasses[this.pendingClasses.length - 1];
    if (cls) cls.parenDepth += 1;
  }

  noteParenClose() {
    const fn = this.pendingFunctions[this.pendingFunctions.length - 1];
    if (fn && fn.sawParen && fn.parenDepth > 0) fn.parenDepth -= 1;
    const cls = this.pendingClasses[this.pendingClasses.length - 1];
    if (cls && cls.parenDepth > 0) cls.parenDepth -= 1;
  }

  /**
   * Classify the `{` that is about to open.
   *
   * Returns:
   * - `close`: significance of the token after the matching `}`. A block or
   *   declaration ends a statement (regex allowed), while an object literal
   *   or an expression body is a value (division).
   * - `blockContent`: true when the braces contain a statement list (block,
   *   function/method/arrow body), false for object literals and class
   *   bodies. This drives statement-start tracking inside the braces.
   * - `statementAfter`: true when a statement can start right after the
   *   matching `}` (block statement or function/class declaration).
   *
   * @returns {{ close: string, blockContent: boolean, statementAfter: boolean }}
   */
  braceOpenInfo() {
    const fn = this.pendingFunctions[this.pendingFunctions.length - 1];
    if (fn && fn.sawParen && fn.parenDepth === 0) {
      this.pendingFunctions.pop();
      return {
        close: fn.expression ? 'value' : 'operator',
        blockContent: true,
        statementAfter: !fn.expression,
      };
    }
    const cls = this.pendingClasses[this.pendingClasses.length - 1];
    if (cls && cls.parenDepth === 0) {
      this.pendingClasses.pop();
      return {
        close: cls.expression ? 'value' : 'operator',
        blockContent: false,
        statementAfter: !cls.expression,
        classBody: true,
      };
    }
    const prev = this.lastToken;
    if (prev && prev.type === 'punct') {
      if (prev.value === ')') {
        // A `{` directly after `)` is a control body, a function/method body
        // (`function f() {}` is handled above), or a catch body. It is never
        // a valid object expression in that position.
        return {
          close: this.lastParenWasControl ? 'operator' : 'value',
          blockContent: true,
          statementAfter: this.lastParenWasControl,
        };
      }
      if (prev.value === ';' || prev.value === '{' || prev.value === '}') {
        return { close: 'operator', blockContent: true, statementAfter: true };
      }
      if (prev.value === '=>') {
        return { close: 'value', blockContent: true, statementAfter: false };
      }
      if (prev.value === ':') {
        return {
          close: this.lastColonBlock ? 'operator' : 'value',
          blockContent: this.lastColonBlock,
          statementAfter: this.lastColonBlock,
        };
      }
    }
    if (prev && prev.type === 'word') {
      if (prev.value === 'else' || prev.value === 'try' || prev.value === 'finally' ||
          prev.value === 'do' || prev.value === 'catch') {
        return { close: 'operator', blockContent: true, statementAfter: true };
      }
      if (prev.value === 'static') {
        // `class C { static { ... } }`: a static initialization block is a
        // statement list, not the body of a static field/method.
        const frame = this.braceStack.length > 0
          ? this.braceStack[this.braceStack.length - 1]
          : null;
        if (frame && frame.classBody) {
          return { close: 'operator', blockContent: true, statementAfter: true };
        }
      }
    }
    // At a statement start a bare `{` is always a block statement (an object
    // literal needs parentheses, an assignment, or another expression
    // context). Elsewhere it is an object literal / expression body.
    if (this.atStatementStart) {
      return { close: 'operator', blockContent: true, statementAfter: true };
    }
    return { close: 'value', blockContent: false, statementAfter: false };
  }

  run() {
    while (this.i < this.length) {
      this.scanNormalToken(false);
    }
    return this.result();
  }

  /**
   * Scan one token in normal/expression code.
   * @param {boolean} inTemplateExpr true when inside ${ ... } (a `}` may close it)
   * @returns {boolean} false when the closing `}` of the template expr was hit
   */
  scanNormalToken(inTemplateExpr) {
    const ch = this.source[this.i];

    // Whitespace (preserve verbatim; emit tracks newlines)
    if (/\s/.test(ch)) {
      // A leading UTF-8 BOM is whitespace (ZWNBSP) and is preserved in the
      // output, but it must not shift positions: Node.js strips it before
      // parsing (`node --check` columns) and editors keep it out of document
      // text, so diagnostics and source-map columns only line up with both
      // when it counts as zero width.
      if (ch === '\uFEFF' && this.i === 0) {
        this.out.push(ch);
        this.i += 1;
        return true;
      }
      this.emit(ch);
      return true;
    }

    // Line comment
    if (ch === '/' && this.peek(1) === '/') {
      this.scanLineComment();
      return true;
    }
    // Block comment
    if (ch === '/' && this.peek(1) === '*') {
      this.scanBlockComment();
      return true;
    }
    // Every significant token start gets a dense map anchor.
    this.recordPosition();
    // Strings
    if (ch === "'") {
      this.scanJsString("'");
      this.lastSignificant = 'value';
      this.atStatementStart = false;
      this.labelCandidate = null;
      this.noteToken('value', null);
      return true;
    }
    if (ch === '"') {
      this.scanJsString('"');
      this.lastSignificant = 'value';
      this.atStatementStart = false;
      this.labelCandidate = null;
      this.noteToken('value', null);
      return true;
    }
    // Template literal
    if (ch === '`') {
      this.scanTemplate();
      this.lastSignificant = 'value';
      this.atStatementStart = false;
      this.labelCandidate = null;
      this.noteToken('value', null);
      return true;
    }
    // Regex or division
    if (ch === '/') {
      if (this.isRegexStart()) {
        this.scanRegex();
        this.lastSignificant = 'value';
        this.atStatementStart = false;
        this.labelCandidate = null;
        this.noteToken('value', null);
      } else {
        // division, /=, etc. — copy one char; combos handled char by char
        this.emit(ch);
        this.lastSignificant = 'operator';
        this.atStatementStart = false;
        this.labelCandidate = null;
        this.noteToken('punct', ch);
      }
      return true;
    }
    // Closing brace may end a ${...} expression
    if (ch === '}' && inTemplateExpr) {
      return false; // caller consumes it
    }
    // $ handling — the TamilScript extension point
    if (ch === '$') {
      const next = this.peek(1);
      if (next && isTamilDigit(next)) {
        if (this.scanTamilRange()) {
          this.lastSignificant = 'value';
          this.atStatementStart = false;
          this.labelCandidate = null;
          this.noteToken('value', null);
          return true;
        }
        this.scanTamilNumber();
        this.lastSignificant = 'value';
        this.atStatementStart = false;
        this.labelCandidate = null;
        this.noteToken('value', null);
        return true;
      }
      if (next === '"' || next === "'") {
        // Removed form: `$"..."` / `$'...'` were TamilScript string literals
        // before `$` was reserved for numeric literals. Erroring (rather
        // than copying `$` verbatim) keeps `tamilscript check` honest: the
        // passthrough would be invalid JavaScript anyway.
        const form = next === '"' ? '$"..."' : "$'...'";
        throw this.err(
          `TamilScript string literals (${form}) are no longer supported: remove the "$" prefix and use an ordinary JavaScript string. ` +
            'The "$" is reserved for Tamil numeric literals such as $௧௮.',
          this.line,
          this.column,
          ErrorCodes.TAMIL_STRING_REMOVED
        );
      }
      if (next === '`') {
        // `$` followed by a template is NOT a TamilScript literal
        // (e.g. $`...` tagged template with $ tag). Copy `$` and continue;
        // the template will be scanned on the next iteration.
        this.emit(ch);
        // `$` alone: operator-ish; identifier scan will fix up if part of word
        this.lastSignificant = 'operator';
        this.noteToken('punct', ch);
        return true;
      }
      if (next === '$' || next === '' || next === '\n' || next === '\r') {
        this.emit(ch);
        this.lastSignificant = 'operator';
        this.noteToken('punct', ch);
        return true;
      }
      // `$.௫`: a Tamil fraction with no integer digits. Tamil digits can
      // never start a property name, so `$.` + Tamil digits cannot be valid
      // JavaScript: name the decimal mistake instead of blaming the digit
      // with a `$` suggestion that would not fix the source.
      if (next === '.' && isTamilDigit(this.peek(2))) {
        let digits = '';
        let k = 2;
        while (isTamilDigit(this.peek(k))) {
          digits += this.peek(k);
          k += 1;
        }
        throw this.err(
          `Malformed Tamil decimal "$.${digits}": Tamil decimals need digits on both sides of "." (e.g. "$௦.${digits}").`,
          this.line,
          this.column,
          ErrorCodes.BAD_TAMIL_NUMBER
        );
      }
      // Lone `$` / `$identifier` / `${`: ordinary JavaScript, copy verbatim.
      // If it starts an identifier, scan the whole word for regex tracking.
      if (this.isIdentifierStart(next) || this.isAsciiDigit(next)) {
        this.scanIdentifierOrNumberAfterDollar();
        return true;
      }
      // `$` followed by anything else (e.g. `$ `, `$(`, `$+`, `$;`): copy.
      // `$` before `"`/`'` is rejected above and `$` before a Tamil digit is
      // a numeric literal, so a `$` before a char like `#` or `\` cannot be
      // an attempted literal. Be lenient: copy.
      this.emit(ch);
      this.lastSignificant = 'operator';
      this.noteToken('punct', ch);
      return true;
    }
    // A bare Tamil digit that reaches this point is not part of a `$`
    // literal and not continuing an identifier (scanWord consumes those),
    // so it cannot be valid JavaScript: Tamil digits are identifier
    // *continue* characters, never identifier starts. Name the mistake
    // instead of emitting source that cannot parse.
    if (isTamilDigit(ch)) {
      throw this.err(
        `Tamil digit "${ch}" here is not part of a "$" numeric literal. Did you mean "$${ch}"?`,
        this.line,
        this.column,
        ErrorCodes.BAD_TAMIL_NUMBER
      );
    }
    // Numeric literal (ASCII)
    if (this.isAsciiDigit(ch) || (ch === '.' && this.isAsciiDigit(this.peek(1)))) {
      this.scanAsciiNumber();
      this.lastSignificant = 'value';
      this.atStatementStart = false;
      this.labelCandidate = null;
      this.noteToken('value', null);
      return true;
    }
    // Identifier / keyword
    if (this.isIdentifierStart(ch)) {
      const previous = this.lastToken;
      const info = this.scanWord();
      if (!info.dotted && !this.isPropertyKeyKeyword(info.word)) {
        this.noteKeyword(info.word, previous);
      }
      this.noteToken('word', info.word);
      this.labelCandidate = null;
      if (!info.dotted) {
        if (this.atStatementStart && (info.word === 'case' || info.word === 'default')) {
          this.casePending = {
            paren: this.parenDepth,
            bracket: this.bracketDepth,
            brace: this.braceStack.length,
            ternary: this.ternaryDepth,
          };
          this.atStatementStart = false;
        } else if (this.atStatementStart) {
          this.labelCandidate = { word: info.word };
          this.atStatementStart = false;
        } else {
          this.atStatementStart = false;
        }
        if (
          info.word === 'else' || info.word === 'try' || info.word === 'finally' ||
          info.word === 'do' || info.word === 'catch'
        ) {
          this.atStatementStart = true;
        }
      } else {
        this.atStatementStart = false;
      }
      return true;
    }
    // Punctuation / operators
    if (ch === '#' && this.peek(1) === '!') {
      // hashbang line — copy to end of line
      this.scanLineComment();
      return true;
    }
    if ((ch === '+' && this.peek(1) === '+') || (ch === '-' && this.peek(1) === '-')) {
      this.emit(ch + this.peek(1));
      this.lastSignificant = 'value';
      this.lastWord = null;
      this.maybeForAwait = false;
      this.forAwaitPending = false;
      this.noteToken('value', null);
      return true;
    }
    if (ch === ')') {
      // A `)` closing a control-flow condition may be followed by a regex
      // literal (`if (x) /re/.test(y)`); a call's `)` ends a value.
      const closesCondition = this.controlParens.length > 0 ? this.controlParens.pop() : false;
      if (this.parenDepth > 0) this.parenDepth -= 1;
      this.noteParenClose();
      this.emit(ch);
      this.lastParenWasControl = closesCondition;
      this.lastSignificant = closesCondition ? 'operator' : 'value';
      this.lastWord = null;
      this.maybeForAwait = false;
      this.forAwaitPending = false;
      this.atStatementStart = closesCondition;
      this.labelCandidate = null;
      this.noteToken('punct', ch);
      return true;
    }
    if (ch === ']') {
      if (this.bracketDepth > 0) this.bracketDepth -= 1;
      this.emit(ch);
      this.lastSignificant = 'value';
      this.lastWord = null;
      this.maybeForAwait = false;
      this.forAwaitPending = false;
      this.atStatementStart = false;
      this.labelCandidate = null;
      this.noteToken('punct', ch);
      return true;
    }
    if (ch === '}') {
      // A block or declaration body ends a statement, so a following `/`
      // starts a regex; an object literal or expression body is a value.
      const frame = this.braceStack.length > 0 ? this.braceStack.pop() : null;
      const close = frame ? frame.close : 'value';
      // Pending function/class headers opened inside this brace cannot
      // legally outlive it. Dropping leftovers prevents a keyword-shaped
      // property name/field from corrupting a later brace.
      if (frame) {
        this.pendingFunctions.length = Math.min(this.pendingFunctions.length, frame.fnDepth);
        this.pendingClasses.length = Math.min(this.pendingClasses.length, frame.clsDepth);
      }
      this.emit(ch);
      this.lastSignificant = close;
      this.lastWord = null;
      this.maybeForAwait = false;
      this.forAwaitPending = false;
      this.atStatementStart = frame ? !!frame.statementAfter : true;
      this.labelCandidate = null;
      this.casePending = null;
      this.noteToken('punct', ch);
      return true;
    }
    if (ch === '{') {
      const info = this.braceOpenInfo();
      this.braceStack.push({
        close: info.close,
        blockContent: info.blockContent,
        statementAfter: info.statementAfter,
        classBody: !!info.classBody,
        fnDepth: this.pendingFunctions.length,
        clsDepth: this.pendingClasses.length,
      });
      this.emit(ch);
      this.lastSignificant = 'operator';
      this.lastWord = null;
      this.maybeForAwait = false;
      this.forAwaitPending = false;
      this.atStatementStart = info.blockContent;
      this.labelCandidate = null;
      this.casePending = null;
      this.noteToken('punct', ch);
      return true;
    }
    // Track control-flow conditions so their `)` is not mistaken for the
    // end of a value. The keyword is consumed here exactly once, so nested
    // groups (`if ((a + b) / 2)`) push false and keep division semantics.
    if (ch === '(') {
      const isCondition =
        this.forAwaitPending || CONTROL_CONDITION_KEYWORDS.has(this.lastWord || '');
      this.controlParens.push(isCondition);
      this.parenDepth += 1;
      this.lastWord = null;
      this.maybeForAwait = false;
      this.forAwaitPending = false;
      this.noteParenOpen();
      this.emit(ch);
      this.lastSignificant = 'operator';
      this.atStatementStart = false;
      this.labelCandidate = null;
      this.noteToken('punct', ch);
      return true;
    }
    if (ch === '[') {
      this.bracketDepth += 1;
      this.emit(ch);
      this.lastSignificant = 'operator';
      this.lastWord = null;
      this.atStatementStart = false;
      this.labelCandidate = null;
      this.noteToken('punct', ch);
      return true;
    }
    if (ch === '?' && (this.peek(1) === '.' || this.peek(1) === '?')) {
      // Optional chaining / nullish coalescing: not a ternary operator.
      this.emit(ch);
      this.lastSignificant = 'operator';
      this.lastWord = null;
      this.atStatementStart = false;
      this.labelCandidate = null;
      this.noteToken('punct', ch);
      return true;
    }
    if (ch === '?') {
      this.ternaryDepth += 1;
      this.emit(ch);
      this.lastSignificant = 'operator';
      this.lastWord = null;
      this.atStatementStart = false;
      this.labelCandidate = null;
      this.noteToken('punct', ch);
      return true;
    }
    if (ch === ':') {
      const cp = this.casePending;
      const isCaseColon =
        !!cp &&
        this.parenDepth === cp.paren &&
        this.bracketDepth === cp.bracket &&
        this.braceStack.length === cp.brace &&
        this.ternaryDepth === cp.ternary;
      let isLabelColon = false;
      if (!isCaseColon && this.labelCandidate && this.lastToken &&
          this.lastToken.type === 'word' && this.labelCandidate.word === this.lastToken.value) {
        isLabelColon = true;
      }
      this.lastColonBlock = isCaseColon || isLabelColon;
      if (!this.lastColonBlock && this.ternaryDepth > 0) this.ternaryDepth -= 1;
      // A ternary colon inside a `case` expression must not discard the
      // pending case; only the real case colon (or a new statement) ends it.
      if (isCaseColon) this.casePending = null;
      this.labelCandidate = null;
      this.emit(ch);
      this.lastSignificant = 'operator';
      this.lastWord = null;
      this.atStatementStart = this.lastColonBlock;
      this.noteToken('punct', ch);
      return true;
    }
    if (ch === ';') {
      this.atStatementStart = true;
      this.labelCandidate = null;
      this.casePending = null;
      this.ternaryDepth = 0;
      this.emit(ch);
      this.lastSignificant = 'operator';
      this.lastWord = null;
      this.maybeForAwait = false;
      this.forAwaitPending = false;
      this.noteToken('punct', ch);
      return true;
    }
    if (ch === '=' && this.peek(1) === '>') {
      // Arrow: the body `{` is a block statement list even though the arrow
      // itself is a value, so statement tracking restarts inside it.
      this.emit('=>');
      this.lastSignificant = 'operator';
      this.lastWord = null;
      this.maybeForAwait = false;
      this.forAwaitPending = false;
      this.atStatementStart = true;
      this.labelCandidate = null;
      this.noteToken('punct', '=>');
      return true;
    }
    // Everything else is operator-ish
    this.emit(ch);
    this.lastSignificant = 'operator';
    this.lastWord = null;
    this.maybeForAwait = false;
    this.forAwaitPending = false;
    this.atStatementStart = false;
    this.labelCandidate = null;
    this.noteToken('punct', ch);
    return true;
  }

  scanIdentifierOrNumberAfterDollar() {
    // We are positioned at `$`. Copy it, then scan the rest of the word.
    this.emit('$');
    // scan following identifier chars as a word (for regex tracking)
    let word = '$';
    while (this.i < this.length && this.isIdentifierPart(this.source[this.i])) {
      word += this.source[this.i];
      this.emit(this.source[this.i]);
    }
    // A `$`-identifier is an operand; `$foo: {}` can also be a label.
    this.lastSignificant = 'value';
    this.lastWord = word;
    if (this.atStatementStart) this.labelCandidate = { word };
    this.atStatementStart = false;
    this.noteToken('word', word);
  }

  scanWord() {
    const startI = this.i;
    const startLine = this.line;
    const startCol = this.column;
    const outStart = this.outLineLen;
    let sourceWord = '';
    // Identifiers never contain line breaks, so advancing the source cursor
    // manually is safe and lets us decide on a whole-word replacement before
    // emitting anything.
    while (this.i < this.length && this.isIdentifierPart(this.source[this.i])) {
      sourceWord += this.source[this.i];
      this.i += 1;
      this.column += 1;
    }
    const dotted = isDottedName(this.source, startI, this.lastToken);
    const frame = this.braceStack.length > 0
      ? this.braceStack[this.braceStack.length - 1]
      : null;
    const nextIndex = this.nextSignificantIndex(this.i);
    const candidate = this.tamilKeywords && !dotted ? getKeywordMapping(sourceWord) : null;
    const propertyName = isPropertyNamePosition(this.source, startI, {
      nextSignificant: nextIndex < this.length ? this.source[nextIndex] : '',
      previousToken: this.lastToken,
      lineBreakBefore: !!(this.lastToken && startLine > this.lastToken.endLine),
      lineBreakAfter: /[\r\n\u2028\u2029]/.test(this.source.slice(this.i, nextIndex)),
      inNonBlockBrace: !!(frame && !frame.blockContent),
      inClassBody: !!(frame && frame.classBody),
      memberKeyword: !!(candidate && candidate.role === 'member'),
    });
    const mapping = candidate && !propertyName ? candidate : null;
    const word = mapping ? mapping.js : sourceWord;
    this.pushMapped(word);
    if (mapping) {
      this.recordReplacement('keyword', startI, startLine, outStart + 1, startCol, word);
    }
    this.markWord(word, dotted);
    return { word, sourceWord, dotted, keyword: mapping };
  }

  scanAsciiNumber() {
    // Copy an ASCII numeric literal verbatim (incl. decimals, exponents, bigint n, separators).
    let prev = '';
    while (this.i < this.length) {
      const ch = this.source[this.i];
      if ((ch === '+' || ch === '-') && prev !== 'e' && prev !== 'E') break;
      if (
        (ch >= '0' && ch <= '9') || ch === '.' || ch === '_' ||
        ch === 'e' || ch === 'E' || ch === '+' || ch === '-' ||
        ch === 'x' || ch === 'X' || ch === 'b' || ch === 'B' ||
        ch === 'o' || ch === 'O' || ch === 'n' ||
        (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')
      ) {
        this.emit(ch);
        prev = ch;
      } else {
        break;
      }
    }
  }

  scanLineComment() {
    const startI = this.i;
    let text = '';
    while (this.i < this.length) {
      const ch = this.source[this.i];
      text += ch;
      this.i += 1;
      if (ch === '\n') {
        this.line += 1;
        this.column = 1;
        break;
      } else if (ch === '\r') {
        if (this.source[this.i] === '\n') {
          text += '\n';
          this.i += 1;
        }
        this.line += 1;
        this.column = 1;
        break;
      } else {
        this.column += 1;
      }
    }
    this.out.push(text);
    this.noteOutput(text);
    // comments do not change lastSignificant
    this.recordSpan('line-comment', startI);
  }

  scanBlockComment() {
    const startI = this.i;
    const startLine = this.line;
    const startCol = this.column;
    let text = '/*';
    this.i += 2;
    this.column += 2;
    let closed = false;
    while (this.i < this.length) {
      const ch = this.source[this.i];
      const next = this.source[this.i + 1];
      if (ch === '*' && next === '/') {
        text += '*/';
        this.i += 2;
        this.column += 2;
        closed = true;
        break;
      }
      text += ch;
      this.i += 1;
      if (ch === '\n') {
        this.line += 1;
        this.column = 1;
      } else if (ch === '\r') {
        if (next === '\n') {
          text += '\n';
          this.i += 1;
        }
        this.line += 1;
        this.column = 1;
      } else {
        this.column += 1;
      }
    }
    this.out.push(text);
    this.noteOutput(text);
    if (!closed) {
      throw this.err('Unterminated block comment.', startLine, startCol, ErrorCodes.UNTERMINATED_COMMENT);
    }
    this.recordSpan('block-comment', startI);
  }

  scanJsString(quote) {
    const startI = this.i;
    const startLine = this.line;
    const startCol = this.column;
    let text = quote;
    this.i += 1;
    this.column += 1;
    let closed = false;
    while (this.i < this.length) {
      const ch = this.source[this.i];
      if (ch === '\\') {
        const n1 = this.source[this.i + 1] || '';
        // Line continuation: backslash + line break (preserves line count)
        if (n1 === '\n' || n1 === '\r') {
          text += ch + n1;
          this.i += 2;
          if (n1 === '\r' && this.source[this.i] === '\n') {
            text += '\n';
            this.i += 1;
          }
          this.line += 1;
          this.column = 1;
          continue;
        }
        text += ch + n1;
        this.i += n1 === '' ? 1 : 2;
        this.column += n1 === '' ? 1 : 2;
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        throw this.err('Unterminated string literal (newline in single/double-quoted string).', startLine, startCol, ErrorCodes.UNTERMINATED_STRING);
      }
      text += ch;
      this.i += 1;
      this.column += 1;
      if (ch === quote) {
        closed = true;
        break;
      }
    }
    this.out.push(text);
    this.noteOutput(text);
    if (!closed) {
      throw this.err('Unterminated string literal.', startLine, startCol, ErrorCodes.UNTERMINATED_STRING);
    }
    this.recordSpan('string', startI);
  }

  scanTemplate() {
    // Positioned at opening backtick.
    const startI = this.i;
    const startLine = this.line;
    const startCol = this.column;
    this.emit('`');
    while (this.i < this.length) {
      const ch = this.source[this.i];
      if (ch === '\\') {
        const n1 = this.source[this.i + 1] || '';
        if (n1 === '\n' || n1 === '\r') {
          this.emit(ch);
          this.emit(n1);
          if (n1 === '\r' && this.peek(0) === '\n') this.emit('\n');
          continue;
        }
        this.emit(ch);
        if (n1 !== '') this.emit(n1);
        continue;
      }
      if (ch === '`') {
        this.emit('`');
        this.recordSpan('template', startI);
        return;
      }
      if (ch === '$' && this.peek(1) === '{') {
        this.recordPosition();
        this.emit('$');
        this.emit('{');
        this.scanTemplateExpression();
        continue;
      }
      this.emit(ch);
    }
    throw this.err('Unterminated template literal.', startLine, startCol, ErrorCodes.UNTERMINATED_TEMPLATE);
  }

  scanTemplateExpression() {
    // After `${`: scan JS until the matching `}` (nesting aware).
    const savedSignificant = this.lastSignificant;
    this.lastSignificant = 'start';
    this.atStatementStart = false;
    this.labelCandidate = null;
    let depth = 0;
    while (this.i < this.length) {
      const ch = this.source[this.i];
      if (ch === '{') {
        this.recordPosition();
        this.emit(ch);
        this.lastSignificant = 'operator';
        depth += 1;
        continue;
      }
      if (ch === '}') {
        if (depth === 0) {
          this.recordPosition();
          this.emit(ch);
          this.lastSignificant = 'value';
          this.atStatementStart = false;
          this.labelCandidate = null;
          return;
        }
        this.recordPosition();
        this.emit(ch);
        this.lastSignificant = 'value';
        this.atStatementStart = false;
        depth -= 1;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`' || ch === '/') {
        this.scanNormalToken(true);
        continue;
      }
      const cont = this.scanNormalToken(true);
      if (cont === false) {
        // shouldn't happen: scanNormalToken returns false only for `}` in expr mode,
        // but `}` is handled above. Keep for safety.
        this.emit('}');
        this.lastSignificant = 'value';
        return;
      }
      void savedSignificant;
    }
    throw this.err('Unterminated ${...} expression in template literal.', this.line, this.column, ErrorCodes.UNTERMINATED_TEMPLATE_EXPR);
  }

  isRegexStart() {
    // `/` begins a regex unless the previous significant token ends a value.
    if (this.lastSignificant === 'value') return false;
    return true;
  }

  scanRegex() {
    // Positioned at opening `/` (not // or /* — those handled before).
    const startI = this.i;
    const startLine = this.line;
    const startCol = this.column;
    let text = '/';
    this.i += 1;
    this.column += 1;
    let inClass = false;
    let closed = false;
    while (this.i < this.length) {
      const ch = this.source[this.i];
      if (ch === '\\') {
        const n1 = this.source[this.i + 1] || '';
        if (n1 === '\n' || n1 === '\r') {
          throw this.err('Unterminated regular expression literal.', startLine, startCol, ErrorCodes.UNTERMINATED_REGEX);
        }
        text += ch + n1;
        this.i += n1 === '' ? 1 : 2;
        this.column += n1 === '' ? 1 : 2;
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        throw this.err('Unterminated regular expression literal.', startLine, startCol, ErrorCodes.UNTERMINATED_REGEX);
      }
      if (ch === '[') {
        inClass = true;
        text += ch;
        this.i += 1;
        this.column += 1;
        continue;
      }
      if (ch === ']' && inClass) {
        inClass = false;
        text += ch;
        this.i += 1;
        this.column += 1;
        continue;
      }
      if (ch === '/' && !inClass) {
        text += ch;
        this.i += 1;
        this.column += 1;
        closed = true;
        break;
      }
      text += ch;
      this.i += 1;
      this.column += 1;
    }
    if (!closed) {
      throw this.err('Unterminated regular expression literal.', startLine, startCol, ErrorCodes.UNTERMINATED_REGEX);
    }
    // flags
    while (this.i < this.length && /[A-Za-z_$]/.test(this.source[this.i])) {
      text += this.source[this.i];
      this.i += 1;
      this.column += 1;
    }
    this.out.push(text);
    this.noteOutput(text);
    this.recordSpan('regex', startI);
  }

  /**
   * Whether the dot at `index` begins `.<trivia><IdentifierName>` on the
   * same line. Comments are legal between the dot and a property name,
   * and a numeric literal needs an extra dot before that property access
   * (`1..toString()`). A line terminator (even one inside a block comment)
   * ends the statement, so no extra dot is added.
   * @param {number} index index of the dot
   * @returns {boolean}
   */
  hasDotPropertyNameAfter(index) {
    let j = index + 1;
    while (j < this.length) {
      const ch = this.source[j];
      if (ch === '\n' || ch === '\r' || ch === '\u2028' || ch === '\u2029') return false;
      if (/\s/.test(ch)) {
        j += 1;
        continue;
      }
      if (ch === '/' && this.source[j + 1] === '/') return false;
      if (ch === '/' && this.source[j + 1] === '*') {
        const close = this.source.indexOf('*/', j + 2);
        if (close === -1) return false;
        const body = this.source.slice(j + 2, close);
        if (/[\n\r\u2028\u2029]/.test(body)) return false;
        j = close + 2;
        continue;
      }
      if (this.isIdentifierStart(ch)) {
        // `1. in x` / `1. instanceof x` are the numeric literal `1.` followed
        // by a binary operator, not property access. Adding the member-access
        // dot would change valid source into a property access.
        let k = j;
        while (k < this.length && this.isIdentifierPart(this.source[k])) k += 1;
        const word = this.source.slice(j, k);
        if (word === 'in' || word === 'instanceof') return false;
        return true;
      }
      return false;
    }
    return false;
  }

  /**
   * Read a run of Tamil digits without emitting anything.
   * @param {number} index index of the first digit (just after `$`)
   * @returns {{ digits: string, value: number, end: number, safe: boolean } | null}
   */
  readTamilInteger(index) {
    let digits = '';
    let value = 0;
    let i = index;
    let safe = true;
    while (i < this.length && isTamilDigit(this.source[i])) {
      const digit = tamilDigitValue(this.source[i]);
      digits += this.source[i];
      value = value * 10 + digit;
      if (value > Number.MAX_SAFE_INTEGER) safe = false;
      i += 1;
    }
    if (digits.length === 0) return null;
    return { digits, value, end: i, safe };
  }

  /**
   * Scan an inclusive integer range literal: `$௧..$௫` becomes an array
   * expression. Both endpoints are Tamil integer literals, the range must be
   * ascending, and the result includes both endpoints. A two-dot form with a
   * Tamil or ASCII digit that lacks the second `$` is a likely range typo, so
   * it is diagnosed instead of being emitted as `1..5`.
   * @returns {boolean} true when a range was consumed
   */
  scanTamilRange() {
    const startI = this.i;
    const startLine = this.line;
    const startCol = this.column;
    const outStart = this.outLineLen;
    const first = this.readTamilInteger(startI + 1);
    if (!first) return false;
    const dot = first.end;
    if (this.source[dot] !== '.' || this.source[dot + 1] !== '.') {
      return false;
    }
    const afterDots = this.source[dot + 2] || '';
    if (afterDots !== '$' || !isTamilDigit(this.source[dot + 3])) {
      if (afterDots >= '0' && afterDots <= '9') {
        throw this.err(
          `Mixed Tamil/ASCII range endpoint "$${first.digits}..${afterDots}": both endpoints must be Tamil integer literals (e.g. "$${first.digits}..$௫").`,
          startLine, startCol + (dot + 2 - startI), ErrorCodes.MIXED_TAMIL_NUMBER
        );
      }
      if (afterDots === '$') {
        const afterDollar = this.source[dot + 3] || '';
        if (afterDollar >= '0' && afterDollar <= '9') {
          let ascii = '';
          let k = dot + 3;
          while (this.source[k] >= '0' && this.source[k] <= '9') {
            ascii += this.source[k];
            k += 1;
          }
          throw this.err(
            `Mixed Tamil/ASCII range endpoint "$${first.digits}..$${ascii}": the digits after "$" must be Tamil (e.g. "$${first.digits}..$௫").`,
            startLine, startCol + (dot + 2 - startI), ErrorCodes.MIXED_TAMIL_NUMBER
          );
        }
      }
      if (isTamilDigit(afterDots)) {
        throw this.err(
          `Malformed Tamil range "$${first.digits}..${afterDots}": the second endpoint needs "$" (e.g. "$${first.digits}..$${afterDots}").`,
          startLine, startCol + (dot + 2 - startI), ErrorCodes.BAD_TAMIL_NUMBER
        );
      }
      return false;
    }
    const second = this.readTamilInteger(dot + 3);
    if (!second) return false;
    const afterSecond = this.source[second.end] || '';
    const afterSecondDot = this.source[second.end + 1] || '';
    if (
      afterSecond === '.' &&
      (isTamilDigit(afterSecondDot) || (afterSecondDot >= '0' && afterSecondDot <= '9'))
    ) {
      const mixed = !isTamilDigit(afterSecondDot);
      throw this.err(
        `Tamil range endpoints must be integers, but "$${second.digits}.${afterSecondDot}" has a decimal fraction. Use integer endpoints (e.g. "$${first.digits}..$${second.digits}").`,
        startLine, startCol, mixed ? ErrorCodes.MIXED_TAMIL_NUMBER : ErrorCodes.BAD_TAMIL_NUMBER
      );
    }
    if (!first.safe) {
      throw this.err(
        `Tamil numeric literal "$${first.digits}" exceeds Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER}).`,
        startLine, startCol, ErrorCodes.UNSAFE_INTEGER
      );
    }
    if (!second.safe) {
      throw this.err(
        `Tamil numeric literal "$${second.digits}" exceeds Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER}).`,
        startLine, startCol, ErrorCodes.UNSAFE_INTEGER
      );
    }
    // Match scanTamilNumber's anti-glue rule so a range cannot silently fuse
    // with a preceding identifier or member-access dot.
    const prevChar = startI > 0 ? this.source[startI - 1] : '';
    const afterSpread =
      prevChar === '.' && startI > 2 && this.source[startI - 2] === '.' && this.source[startI - 3] === '.';
    if (prevChar !== '' && !afterSpread && (this.isIdentifierPart(prevChar) || prevChar === '.')) {
      throw this.err(
        `Malformed Tamil numeric literal "$${first.digits}": it must not be directly preceded by "${prevChar}". Separate it with whitespace or an operator.`,
        startLine, startCol, ErrorCodes.BAD_TAMIL_NUMBER
      );
    }
    this.checkIntBoundary(
      second.digits,
      this.source[second.end] || '',
      this.source[second.end + 1] || '',
      startLine,
      startCol
    );
    if (first.value > second.value) {
      throw this.err(
        `Tamil range "$${first.digits}..$${second.digits}" is descending. Ranges must be inclusive and ascending (start <= end).`,
        startLine, startCol, ErrorCodes.BAD_TAMIL_NUMBER
      );
    }
    const length = second.value - first.value + 1;
    if (length > MAX_TAMIL_RANGE_LENGTH) {
      throw this.err(
        `Tamil range "$${first.digits}..$${second.digits}" contains ${length} values; the maximum is ${MAX_TAMIL_RANGE_LENGTH}.`,
        startLine, startCol, ErrorCodes.BAD_TAMIL_NUMBER
      );
    }
    const emitted = `(() => { const values = []; for (let i = 0; i < ${length}; i++) values[i] = ${first.value} + i; return values; })()`;
    this.i = second.end;
    this.column = startCol + (second.end - startI);
    this.pushMapped(emitted);
    this.recordReplacement('range', startI, startLine, outStart + 1, startCol, emitted);
    return true;
  }

  scanTamilNumber() {
    // Positioned at `$`, next char is a Tamil digit.
    //
    // Grammar (OpenTamizh 0.2.0 milestone):
    //   TamilInteger := '$' TamilDigit+
    //   TamilDecimal := '$' TamilDigit+ '.' TamilDigit+
    // The '.' is a decimal separator ONLY when immediately followed by a
    // Tamil digit; otherwise it is ordinary JavaScript (property access
    // such as `$௧.toString()`, spread, optional chaining, ASCII decimals).
    const startLine = this.line;
    const startCol = this.column;
    const startI = this.i;
    // Output column where the replacement will begin (1-based). The inner
    // emit() calls below advance outLineLen by the source span, so capture
    // it before scanning; numeric literals never cross line breaks.
    const outStart = this.outLineLen;
    this.emit('$');
    let intDigits = '';
    while (this.i < this.length && isTamilDigit(this.source[this.i])) {
      intDigits += this.source[this.i];
      this.emit(this.source[this.i]);
    }
    // The literal must not fuse with whatever precedes it: `1$௧` and
    // `$௧$௨` would otherwise silently become `11`/`12`. A `...` spread
    // legitimately ends in a dot, so a full three-dot spread directly
    // before the `$` is allowed while a single dot (`obj.$௧`) and a
    // two-dot prefix (`a..$௧`, never valid JavaScript) are not.
    const prevChar = startI > 0 ? this.source[startI - 1] : '';
    const afterSpread =
      prevChar === '.' && startI > 2 && this.source[startI - 2] === '.' && this.source[startI - 3] === '.';
    if (prevChar !== '' && !afterSpread && (this.isIdentifierPart(prevChar) || prevChar === '.')) {
      throw this.err(
        `Malformed Tamil numeric literal "$${intDigits}": it must not be directly preceded by "${prevChar}". Separate it with whitespace or an operator.`,
        startLine, startCol, ErrorCodes.BAD_TAMIL_NUMBER
      );
    }
    let next = this.i < this.length ? this.source[this.i] : '';
    let next2 = this.i + 1 < this.length ? this.source[this.i + 1] : '';
    this.checkIntBoundary(intDigits, next, next2, startLine, startCol);
    // Mixed-script decimal attempt such as `$௧.5`: refuse to guess.
    if (next === '.' && next2 >= '0' && next2 <= '9') {
      throw this.err(
        `Mixed Tamil/ASCII decimal "$${intDigits}.${next2}". Use all-Tamil digits on both sides of "." (e.g. "$${intDigits}.௫") or a plain ASCII decimal.`,
        startLine, startCol, ErrorCodes.MIXED_TAMIL_NUMBER
      );
    }
    // `$௧.$௨`: a `$`+digit after the separator is a decimal typo, never
    // property access (that form needs no `$` before the digit).
    if (next === '.' && next2 === '$' && isTamilDigit(this.peek(2))) {
      throw this.err(
        `Malformed Tamil decimal "$${intDigits}.$${this.peek(2)}": write the fraction without the second "$" (e.g. "$${intDigits}.௫").`,
        startLine, startCol, ErrorCodes.MIXED_TAMIL_NUMBER
      );
    }
    let fracDigits = '';
    let isDecimal = false;
    if (next === '.' && isTamilDigit(next2)) {
      isDecimal = true;
      this.emit('.');
      while (this.i < this.length && isTamilDigit(this.source[this.i])) {
        fracDigits += this.source[this.i];
        this.emit(this.source[this.i]);
      }
      next = this.i < this.length ? this.source[this.i] : '';
      next2 = this.i + 1 < this.length ? this.source[this.i + 1] : '';
      if (next === '.' && (isTamilDigit(next2) || (next2 >= '0' && next2 <= '9'))) {
        throw this.err(
          `Malformed Tamil decimal literal "$${intDigits}.${fracDigits}.": only one decimal separator is allowed.`,
          startLine, startCol, ErrorCodes.BAD_TAMIL_NUMBER
        );
      }
      // `$௩.௫.` with no property name after the dot: the replacement
      // already ends in digits, so a further `.` can only be member access,
      // and member access needs an identifier next. Whitespace and `/` are
      // left to JavaScript (they may precede a property name, e.g.
      // `$௩.௫. toString()`, or a comment); `\` counts as an identifier
      // start (Unicode escape). Everything else — a second dot, an
      // operator, `)`, `;`, or end of input — cannot parse, so report it
      // here instead of emitting JavaScript that fails later.
      if (
        next === '.' &&
        (next2 === '' || (!this.isIdentifierStart(next2) && !/\s/.test(next2) && next2 !== '/'))
      ) {
        throw this.err(
          `Malformed Tamil decimal literal "$${intDigits}.${fracDigits}.": the decimal point is already part of the literal; use a single "." for property access (e.g. "$${intDigits}.${fracDigits}.toString()").`,
          startLine, startCol, ErrorCodes.BAD_TAMIL_NUMBER
        );
      }
      // `$௩.௫.$௨`: like `$௧.$௨`, a `$`+Tamil digit cannot follow the dot
      // (property names are ordinary identifiers, never numeric literals).
      if (next === '.' && next2 === '$' && isTamilDigit(this.peek(2))) {
        throw this.err(
          `Malformed Tamil decimal "$${intDigits}.${fracDigits}.$${this.peek(2)}": write the fraction without the second "$" (e.g. "$${intDigits}.${fracDigits}${this.peek(2)}").`,
          startLine, startCol, ErrorCodes.MIXED_TAMIL_NUMBER
        );
      }
      if (next !== '' && this.isIdentifierPart(next)) {
        if (next === 'n' && !this.isIdentifierPart(next2)) {
          throw this.err(
            `BigInt Tamil literals are not supported (found "$${intDigits}.${fracDigits}n"). Use a plain BigInt literal instead.`,
            startLine, startCol, ErrorCodes.UNSUPPORTED_BIGINT
          );
        }
        throw this.err(
          `Malformed Tamil decimal literal "$${intDigits}.${fracDigits}${next}". Tamil digits must not be directly followed by "${next}".`,
          startLine, startCol, ErrorCodes.BAD_TAMIL_NUMBER
        );
      }
    }
    // Compute the value.
    let text;
    if (!isDecimal) {
      let value = 0;
      for (const ch of intDigits) {
        value = value * 10 + tamilDigitValue(ch);
        if (value > Number.MAX_SAFE_INTEGER) {
          throw this.err(
            `Tamil numeric literal "$${intDigits}" exceeds Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER}).`,
            startLine, startCol, ErrorCodes.UNSAFE_INTEGER
          );
        }
      }
      text = String(value);
    } else {
      // Decimal: computed exactly as JavaScript parses the equivalent ASCII
      // decimal literal (IEEE 754 double precision — see SYNTAX.md).
      let ascii = '';
      for (const ch of intDigits) ascii += String(tamilDigitValue(ch));
      ascii += '.';
      for (const ch of fracDigits) ascii += String(tamilDigitValue(ch));
      const value = Number(ascii);
      // IEEE 754 overflow is Infinity. Emitting the identifier `Infinity`
      // would let a local binding shadow the literal's value, so use an
      // ordinary numeric literal that evaluates to the same non-finite
      // number (it ends in an exponent, so the member-access dot logic below
      // correctly leaves it untouched).
      text = Number.isFinite(value) ? String(value) : '1e309';
    }
    // `$௧.toString()`: a replacement followed directly by `.` + identifier
    // would yield `1.toString()` — a syntax error. Emitting `1.` keeps the
    // value identical and turns the user's dot into member access
    // (`1..toString()`); `$௧..toString()` (dot already explicit) and
    // `$௧ .toString()` (separated by a space) are left untouched.
    //
    // The extra dot is only needed for digit-only replacements (plain
    // integers, and decimals such as `$௧.௦` that normalize to `1`). A
    // decimal replacement already ends in digits (`3.5.toString()` parses
    // as-is) and an exponent replacement (`1e-7`) must not gain a second
    // dot (`1e-7..toString()` is invalid), so both are emitted untouched.
    const afterChar = this.i < this.length ? this.source[this.i] : '';
    if (afterChar === '.' && this.hasDotPropertyNameAfter(this.i) && /^[0-9]+$/.test(text)) {
      text += '.';
    }
    // Replace the already-emitted `$<tamil>` text with the decimal literal.
    // emit() pushes one entry per UTF-16 unit, and `$`, `.`, Tamil digits
    // are all single units, so the entry count equals the source span.
    const drop = this.i - startI;
    for (let k = 0; k < drop; k++) this.out.pop();
    // Rewind OUTPUT width only: this.column already tracks source exactly.
    this.outLineLen = outStart;
    this.pushMapped(text);
    this.recordReplacement(isDecimal ? 'decimal' : 'number', startI, startLine, outStart + 1, startCol, text);
  }

  checkIntBoundary(digits, next, next2, startLine, startCol) {
    // Any identifier-part character is a boundary violation: `$௧2`,
    // `$௧abc`, `$௧_0`, `$௧க` and `$௧்` could all be typos, so refuse to
    // guess rather than emit JavaScript that does not parse.
    if (next !== '' && this.isIdentifierPart(next)) {
      if (next === 'n' && !this.isIdentifierPart(next2)) {
        throw this.err(
          `BigInt Tamil literals are not supported (found "$${digits}n"). Use a plain integer literal instead.`,
          startLine, startCol, ErrorCodes.UNSUPPORTED_BIGINT
        );
      }
      throw this.err(
        `Malformed Tamil numeric literal "$${digits}${next}". Tamil digits ௦-௯ must not be directly followed by "${next}".`,
        startLine, startCol, ErrorCodes.BAD_TAMIL_NUMBER
      );
    }
  }
}

/**
 * Transform TamilScript source into standard JavaScript.
 * @param {string} source
 * @param {{ filename?: string, collectEvents?: boolean }} [options]
 * @returns {string}
 */
function transformSource(source, options) {
  if (typeof source !== 'string') {
    throw new TypeError(`transform() expects source as a string, got ${typeof source}`);
  }
  const scanner = new Scanner(source, options);
  return scanner.run();
}

module.exports = {
  Scanner,
  transformSource,
};
