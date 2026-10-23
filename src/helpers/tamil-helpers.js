'use strict';

// Explicit Tamil runtime helpers.
//
// These are ordinary exported functions, not globals and not keywords. Use
// them through `tamilscript/runtime`:
//
//   const { சேர், நீளம், எண், சொல் } = require('tamilscript/runtime');
//
// The `tamilscript run` prelude installs only அச்சிடு; it deliberately does
// not inject collection or conversion helpers into the global scope.

const { toNumber, parseTamilDecimal } = require('../numerals');

const TAMIL_INTEGER = /^[+-]?\$?[௦-௯]+$/;
const TAMIL_DECIMAL = /^[+-]?\$?[௦-௯]+\.[௦-௯]+$/;

/**
 * Append values to a mutable collection and return that same collection.
 * Arrays are appended with `push`; Sets use `add`. Strings and other
 * immutable values are rejected rather than silently replaced.
 *
 * @param {Array|Set} collection
 * @param {...unknown} values
 * @returns {Array|Set} the collection passed in
 */
function சேர்(collection, ...values) {
  if (Array.isArray(collection)) {
    collection.push(...values);
    return collection;
  }
  if (collection instanceof Set) {
    for (const value of values) collection.add(value);
    return collection;
  }
  throw new TypeError('சேர்() expects an Array or Set as its first argument.');
}

/**
 * Return the length of a string/array-like value or the size of a Map/Set.
 * @param {{ length?: unknown, size?: unknown }} value
 * @returns {number}
 */
function நீளம்(value) {
  if (value == null) {
    throw new TypeError('நீளம்() expects a string, array, Map, Set, or array-like value.');
  }
  if (typeof value.length === 'number') return value.length;
  if (typeof value.size === 'number') return value.size;
  throw new TypeError('நீளம்() could not find a numeric length or size.');
}

/**
 * Convert a value to a number. Tamil integer/decimal strings (with an optional
 * leading `+`/`-` sign and optional `$`) use the same parser as Tamil numeric
 * literals; everything else follows JavaScript's ordinary Number() coercion.
 * @param {unknown} value
 * @returns {number}
 */
function எண்(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (TAMIL_INTEGER.test(value) || TAMIL_DECIMAL.test(value)) {
      const sign = value.startsWith('-') ? -1 : 1;
      const unsigned = value.startsWith('+') || value.startsWith('-') ? value.slice(1) : value;
      const parsed = TAMIL_INTEGER.test(value) ? toNumber(unsigned) : parseTamilDecimal(unsigned);
      return sign * parsed;
    }
  }
  return Number(value);
}

/**
 * Convert a value to a string using JavaScript's String() coercion.
 * @param {unknown} value
 * @returns {string}
 */
function சொல்(value) {
  return String(value);
}

module.exports = {
  சேர்,
  நீளம்,
  எண்,
  சொல்,
};
