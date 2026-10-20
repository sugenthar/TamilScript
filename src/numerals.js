'use strict';

const { JsTamilError, ErrorCodes } = require('./errors');

const TAMIL_ZERO = 0x0be6;
const TAMIL_NINE = 0x0bef;

const TAMIL_DIGITS = ['௦', '௧', '௨', '௩', '௪', '௫', '௬', '௭', '௮', '௯'];

/**
 * Check whether a character is a Tamil digit (U+0BE6..U+0BEF).
 * @param {string} ch single character
 * @returns {boolean}
 */
function isTamilDigit(ch) {
  if (!ch || ch.length === 0) return false;
  const code = ch.codePointAt(0);
  return code >= TAMIL_ZERO && code <= TAMIL_NINE;
}

/**
 * Convert a single Tamil digit character to its ASCII value 0-9.
 * @param {string} ch
 * @returns {number}
 */
function tamilDigitValue(ch) {
  return ch.codePointAt(0) - TAMIL_ZERO;
}

/**
 * Convert a Tamil numeral string into a JavaScript Number.
 *
 * Integer strings only, e.g. "௧௨௩" (123) or "௦" (0). An optional single
 * leading "$" is tolerated (e.g. "$௧௮") and stripped before validation.
 * Surrounding whitespace is NOT trimmed: it is rejected so that callers
 * do not silently accept sloppy input. Leading zeros are accepted and
 * ignored ("௦௦௧" is 1), matching normal numeric reading.
 *
 * Decimal strings such as "௧.௫" are NOT accepted here; use
 * {@link parseTamilDecimal} for those.
 *
 * @param {string} input Tamil digit string, e.g. "௧௨௩"
 * @returns {number} JavaScript Number (integer)
 * @throws {TypeError} when input is not a string
 * @throws {JsTamilError} when input contains invalid characters or is empty
 * @throws {RangeError} when the value exceeds Number.MAX_SAFE_INTEGER
 */
function toNumber(input) {
  if (typeof input !== 'string') {
    throw new TypeError(`toNumber() expects a string, got ${typeof input}`);
  }
  let s = input;
  if (s.startsWith('$')) s = s.slice(1);
  if (s.length === 0) {
    throw new JsTamilError('toNumber() received an empty Tamil numeral string.', {
      code: ErrorCodes.INVALID_NUMERAL_INPUT,
    });
  }
  let value = 0;
  for (const ch of s) {
    if (!isTamilDigit(ch)) {
      throw new JsTamilError(
        `Invalid Tamil numeral character ${JSON.stringify(ch)} in ${JSON.stringify(input)}. ` +
          'Only Tamil digits ௦-௯ are accepted. ' +
          'For decimal values such as "௧.௫", use parseTamilDecimal().',
        { code: ErrorCodes.INVALID_NUMERAL_INPUT }
      );
    }
    value = value * 10 + tamilDigitValue(ch);
    if (value > Number.MAX_SAFE_INTEGER) {
      throw new RangeError(
        `Tamil numeral ${JSON.stringify(input)} exceeds Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER}). ` +
          'Precision would be lost, so conversion is refused.'
      );
    }
  }
  return value;
}

/**
 * Convert a non-negative safe integer into a Tamil digit string.
 * Fractions are never accepted here (they throw); use
 * {@link toTamilDecimal} for floating-point values.
 *
 * @param {number} n non-negative integer
 * @returns {string} Tamil digit string, e.g. 123 -> "௧௨௩"
 * @throws {TypeError} when input is not a number
 * @throws {RangeError} when input is negative, fractional, NaN/Infinity, or unsafe
 */
function toTamilNumerals(n) {
  if (typeof n !== 'number') {
    throw new TypeError(`toTamilNumerals() expects a number, got ${typeof n}`);
  }
  if (!Number.isFinite(n)) {
    throw new RangeError('toTamilNumerals() expects a finite number.');
  }
  if (!Number.isInteger(n)) {
    throw new RangeError(`toTamilNumerals() expects an integer, got ${n}. For decimal values, use toTamilDecimal().`);
  }
  if (n < 0) {
    throw new RangeError(`toTamilNumerals() expects a non-negative integer, got ${n}. Negate the result with the unary minus operator instead.`);
  }
  if (n > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(
      `toTamilNumerals() value ${n} exceeds Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER}).`
    );
  }
  if (n === 0) return TAMIL_DIGITS[0];
  let out = '';
  let rest = n;
  while (rest > 0) {
    out = TAMIL_DIGITS[rest % 10] + out;
    rest = Math.floor(rest / 10);
  }
  return out;
}

module.exports = {
  TAMIL_DIGITS,
  TAMIL_ZERO,
  TAMIL_NINE,
  isTamilDigit,
  tamilDigitValue,
  toNumber,
  toTamilNumerals,
  parseTamilDecimal,
  toTamilDecimal,
};

/**
 * Convert a Tamil decimal string into a JavaScript Number.
 *
 * Grammar: optional leading `$`, one or more Tamil digits, a single ASCII
 * `.` (U+002E), then one or more Tamil digits — e.g. "௧௨.௫" (12.5) or
 * "$௦.௧௮" (0.18). Both sides are required: ".௫" and "௧." are rejected.
 * Mixed scripts ("௧.5", "1.௫") are rejected rather than guessed.
 *
 * The result follows IEEE 754 double-precision semantics exactly: it is
 * computed the same way JavaScript parses the equivalent ASCII decimal
 * literal, so `parseTamilDecimal("௧.௧") === 1.1` in the `===` sense,
 * including ordinary floating-point representation behavior.
 *
 * @param {string} input Tamil decimal string, e.g. "௧௨.௫"
 * @returns {number} JavaScript Number (may be fractional)
 * @throws {TypeError} when input is not a string
 * @throws {JsTamilError} when the grammar is violated
 */
function parseTamilDecimal(input) {
  if (typeof input !== 'string') {
    throw new TypeError(`parseTamilDecimal() expects a string, got ${typeof input}`);
  }
  let s = input;
  if (s.startsWith('$')) s = s.slice(1);
  const fail = (why) => {
    throw new JsTamilError(
      `Invalid Tamil decimal ${JSON.stringify(input)}: ${why} ` +
        'Expected Tamil digits, ".", Tamil digits (e.g. "௧௨.௫").',
      { code: ErrorCodes.INVALID_NUMERAL_INPUT }
    );
  };
  if (s.length === 0) fail('empty string.');
  const dot = s.indexOf('.');
  if (dot === -1) fail('missing "." separator.');
  if (s.indexOf('.', dot + 1) !== -1) fail('more than one "." separator.');
  const intPart = s.slice(0, dot);
  const fracPart = s.slice(dot + 1);
  if (intPart.length === 0) fail('missing integer digits before ".".');
  if (fracPart.length === 0) fail('missing fractional digits after ".".');
  const toAscii = (part, side) => {
    let out = '';
    for (const ch of part) {
      if (!isTamilDigit(ch)) fail(`invalid character ${JSON.stringify(ch)} in ${side} part.`);
      out += String(tamilDigitValue(ch));
    }
    return out;
  };
  const ascii = `${toAscii(intPart, 'integer')}.${toAscii(fracPart, 'fractional')}`;
  const value = Number(ascii);
  return value;
}

/**
 * Convert a non-negative finite JavaScript number into a Tamil decimal
 * string (e.g. 12.5 -> "௧௨.௫", 100 -> "௧௦௦").
 *
 * The conversion renders the number exactly as JavaScript's `String(n)`
 * does, then transliterates the digits; integers therefore round-trip
 * through {@link toTamilNumerals} identically.
 *
 * @param {number} n non-negative finite number
 * @returns {string} Tamil decimal string
 * @throws {TypeError} when input is not a number
 * @throws {RangeError} when input is negative, NaN/Infinity, or renders
 *   with exponent notation (e.g. 1e21), which has no exact decimal-digit
 *   representation to transliterate
 */
function toTamilDecimal(n) {
  if (typeof n !== 'number') {
    throw new TypeError(`toTamilDecimal() expects a number, got ${typeof n}`);
  }
  if (!Number.isFinite(n)) {
    throw new RangeError('toTamilDecimal() expects a finite number.');
  }
  if (n < 0) {
    throw new RangeError(`toTamilDecimal() expects a non-negative number, got ${n}. Represent the sign separately.`);
  }
  const text = String(n);
  if (/[eE]/.test(text)) {
    throw new RangeError(
      `toTamilDecimal() cannot represent ${n}: it renders as ${JSON.stringify(text)} (exponent notation).`
    );
  }
  let out = '';
  for (const ch of text) {
    if (ch === '.') {
      out += '.';
    } else if (ch >= '0' && ch <= '9') {
      out += TAMIL_DIGITS[ch.charCodeAt(0) - 48];
    } else {
      throw new RangeError(`toTamilDecimal() cannot represent ${n} (unexpected character ${JSON.stringify(ch)}).`);
    }
  }
  return out;
}
