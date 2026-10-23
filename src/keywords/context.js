'use strict';

/**
 * Keyword-mode context rules.
 *
 * A Tamil word is rewritten only when keyword mode is explicitly enabled and
 * the word is not a property/private name (`obj.என்றால்`, `#தனி`). Keeping
 * this policy here means the scanner and API agree on when a word is a
 * keyword instead of duplicating ad-hoc checks.
 */

/**
 * Normalize the public option shape without mutating the caller's object.
 * @param {{ tamilKeywords?: boolean }} [options]
 * @returns {{ tamilKeywords: boolean }}
 */
function keywordOptions(options) {
  return { tamilKeywords: !!(options && options.tamilKeywords) };
}

/**
 * Whether the identifier starting at `start` follows `.` or `#`.
 *
 * Whitespace and comments are legal between `.` and a property name, so the
 * scanner also supplies its previous significant token. `...word` is spread,
 * not member access, and must not suppress a keyword rewrite.
 *
 * @param {string} source
 * @param {number} start source offset of the identifier
 * @param {{ type: string, value: string, endIndex?: number } | null} [previousToken]
 * @returns {boolean}
 */
function isDottedName(source, start, previousToken) {
  if (start <= 0) return false;
  const before = source[start - 1];
  if (before === '#') return true;
  if (before === '.') {
    return !(source[start - 2] === '.' && source[start - 3] === '.');
  }
  if (!previousToken || previousToken.type !== 'punct') return false;
  if (previousToken.value === '#') return true;
  if (previousToken.value !== '.') return false;
  if (typeof previousToken.endIndex !== 'number') return true;
  const beforeDot = source[previousToken.endIndex - 2];
  const beforeBeforeDot = source[previousToken.endIndex - 3];
  return !(beforeDot === '.' && beforeBeforeDot === '.');
}

/**
 * Whether the word at `start` may be treated as a Tamil keyword.
 * @param {string} source
 * @param {number} start source offset of the word
 * @param {{ tamilKeywords?: boolean }} [options]
 * @returns {boolean}
 */
function isKeywordEligible(source, start, options) {
  return !!(options && options.tamilKeywords) && !isDottedName(source, start);
}

const MEMBER_PREFIXES = new Set(['static', 'get', 'set', 'async']);

// Words that expect an operand after them. If one of these ends the previous
// line, a following Tamil word is still in an expression, not a class member.
const NON_VALUE_END_WORDS = new Set([
  'return', 'throw', 'case', 'new', 'delete', 'void', 'typeof',
  'instanceof', 'in', 'of', 'yield', 'await', 'extends', 'else', 'do',
  'if', 'for', 'while', 'switch', 'catch', 'with', 'function', 'class',
  'const', 'let', 'var', 'import', 'export', 'from', 'as', 'async',
]);

/**
 * Whether the previous token can end a class field initializer. Class fields
 * may omit their semicolon, so a newline plus one of these tokens is the
 * lexical signal that the next word starts a new member.
 * @param {{ type: string, value: string } | null} previousToken
 * @returns {boolean}
 */
function endsClassMemberValue(previousToken) {
  if (!previousToken) return false;
  if (previousToken.type === 'value') return true;
  if (previousToken.type === 'punct') {
    return previousToken.value === ')' || previousToken.value === ']' ||
      previousToken.value === '}';
  }
  if (previousToken.type === 'word') {
    return !NON_VALUE_END_WORDS.has(previousToken.value);
  }
  return false;
}

/**
 * Whether a word is being used as an object/class property name or a label,
 * rather than as a keyword. Property names are ordinary identifiers in
 * JavaScript (including spellings such as `if`), so keyword mode must not
 * rewrite them; otherwise `{ என்றால்: 1 }` would stop matching `obj.என்றால்`.
 *
 * The scanner supplies only the context it already tracks. The rule remains
 * deliberately conservative: a colon after the word always means a property
 * key or label; member syntax is recognized only in a non-block brace
 * (object literal or class body) at the start of a member.
 *
 * @param {string} source
 * @param {number} start source offset of the word (unused, kept for symmetry)
 * @param {{
 *   nextSignificant: string,
 *   previousToken: { type: string, value: string } | null,
 *   lineBreakBefore?: boolean,
 *   lineBreakAfter?: boolean,
 *   inNonBlockBrace: boolean,
 *   inClassBody?: boolean,
 *   memberKeyword?: boolean,
 * }} context
 * @returns {boolean}
 */
function isPropertyNamePosition(source, start, context) {
  void source;
  void start;
  const ctx = context || {};
  const next = ctx.nextSignificant || '';
  const prev = ctx.previousToken;
  const atMemberStart =
    !prev ||
    (prev.type === 'punct' && (
      ['{', '}', ';', '*'].includes(prev.value) ||
      // Comma separates object-literal members, but it is an operator inside
      // a class field initializer, never a class-member separator.
      (prev.value === ',' && !ctx.inClassBody)
    )) ||
    (prev.type === 'word' && MEMBER_PREFIXES.has(prev.value));
  const startsAfterSemicolonlessField = !!(
    ctx.inClassBody &&
    ctx.lineBreakBefore &&
    endsClassMemberValue(prev)
  );
  const hasMemberModifier = !!(
    prev &&
    ((prev.type === 'word' && MEMBER_PREFIXES.has(prev.value)) ||
      (prev.type === 'punct' && prev.value === '*'))
  );
  const atClassConstructorStart = !!(
    ctx.inClassBody &&
    next === '(' &&
    !hasMemberModifier &&
    (
      !prev ||
      (prev.type === 'punct' && ['{', '}', ';'].includes(prev.value)) ||
      startsAfterSemicolonlessField
    )
  );
  // `constructor` is a keyword whose entire purpose is to name a class
  // constructor. Only a bare class constructor is rewritten; object methods,
  // static/async/accessor/generator methods, and fields with the same spelling
  // are ordinary property names.
  if (ctx.memberKeyword && atClassConstructorStart) return false;
  if (next === ':') return true;
  if (!ctx.inNonBlockBrace) return false;
  // A class field may omit its initializer and semicolon. In that case the
  // next member starts after a line break, so there is no `=`, `;`, or `(` to
  // inspect. The word at the member boundary is the field name.
  if (
    ctx.inClassBody &&
    ctx.lineBreakAfter &&
    (atMemberStart || startsAfterSemicolonlessField)
  ) {
    return true;
  }
  if (!atMemberStart && !startsAfterSemicolonlessField) return false;
  return next === '(' || next === '=' || next === ';' || next === ',' || next === '}';
}

module.exports = {
  keywordOptions,
  isDottedName,
  isKeywordEligible,
  isPropertyNamePosition,
};
