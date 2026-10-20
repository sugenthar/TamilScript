'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  toNumber,
  toTamilNumerals,
  parseTamilDecimal,
  toTamilDecimal,
} = require('../src/numerals');
const { JsTamilError } = require('../src/errors');

describe('decimal numeral utilities', () => {
  it('parseTamilDecimal converts every fractional digit', () => {
    assert.equal(parseTamilDecimal('௦.௦'), 0);
    assert.equal(parseTamilDecimal('௧.௫'), 1.5);
    assert.equal(parseTamilDecimal('௧௨.௫'), 12.5);
    assert.equal(parseTamilDecimal('௦.௧௮'), 0.18);
    assert.equal(parseTamilDecimal('$௧௨.௫'), 12.5);
  });

  it('parseTamilDecimal matches the ASCII equivalent exactly', () => {
    assert.equal(parseTamilDecimal('௧.௧'), 1.1);
    assert.equal(parseTamilDecimal('௦.௧') + parseTamilDecimal('௦.௨'), 0.1 + 0.2);
  });

  it('parseTamilDecimal rejects malformed input strictly', () => {
    for (const bad of ['', '.', '.௫', '௧.', '௧', '௧.௫.௬', '௧.5', '1.௫', ' ௧.௫', '௧.௫ ', '$', '-௧.௫', '௧a.௫', '௧.௫b', '௧,௫']) {
      assert.throws(() => parseTamilDecimal(bad), JsTamilError, JSON.stringify(bad));
    }
    assert.throws(() => parseTamilDecimal(12.5), TypeError);
    assert.throws(() => parseTamilDecimal(null), TypeError);
  });

  it('toTamilDecimal converts finite non-negative numbers', () => {
    assert.equal(toTamilDecimal(0), '௦');
    assert.equal(toTamilDecimal(12.5), '௧௨.௫');
    assert.equal(toTamilDecimal(0.18), '௦.௧௮');
    assert.equal(toTamilDecimal(100), '௧௦௦');
    assert.equal(toTamilDecimal(1.5), '௧.௫');
  });

  it('toTamilDecimal round-trips through parseTamilDecimal', () => {
    // Only fractional values round-trip: integers render without a
    // fraction part (toTamilDecimal(100) === "௧௦௦", parsed by toNumber).
    for (const n of [0.5, 1.5, 12.5, 0.18, 12345.678]) {
      assert.equal(parseTamilDecimal(toTamilDecimal(n)), n, String(n));
    }
    assert.equal(toNumber(toTamilDecimal(100)), 100);
  });

  it('toTamilDecimal rejects negatives, non-finite and exponent forms', () => {
    assert.throws(() => toTamilDecimal(-1.5), RangeError);
    assert.throws(() => toTamilDecimal(NaN), RangeError);
    assert.throws(() => toTamilDecimal(Infinity), RangeError);
    assert.throws(() => toTamilDecimal(1e21), RangeError);
    assert.throws(() => toTamilDecimal('1.5'), TypeError);
  });

  it('integer utilities keep their v0.1.0 contracts', () => {
    // toNumber stays integer-only; decimals have their own function.
    assert.throws(() => toNumber('௧.௫'), JsTamilError);
    assert.throws(() => toTamilNumerals(1.5), RangeError);
    // Leading zeros documented: accepted and ignored.
    assert.equal(toNumber('௦௦௧'), 1);
    // Whitespace rejected, never trimmed.
    assert.throws(() => toNumber(' ௧ '), JsTamilError);
    assert.throws(() => toNumber('௧\n'), JsTamilError);
    // Invalid Unicode rejected with a clear message.
    assert.throws(() => toNumber('௧२'), JsTamilError); // Devanagari २
    assert.throws(() => toNumber('௧๑'), JsTamilError); // Thai ๑
  });
});
