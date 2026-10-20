'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { toNumber, toTamilNumerals } = require('../src/numerals');
const { JsTamilError } = require('../src/errors');

describe('toNumber', () => {
  it('converts every Tamil digit ௦-௯', () => {
    const cases = [['௦', 0], ['௧', 1], ['௨', 2], ['௩', 3], ['௪', 4], ['௫', 5], ['௬', 6], ['௭', 7], ['௮', 8], ['௯', 9]];
    for (const [input, expected] of cases) {
      assert.equal(toNumber(input), expected, `toNumber(${input})`);
    }
  });

  it('converts multi-digit numerals', () => {
    assert.equal(toNumber('௧௨௩'), 123);
    assert.equal(toNumber('௧௮'), 18);
    assert.equal(toNumber('௧௦௦'), 100);
    assert.equal(toNumber('௧௦'), 10);
  });

  it('handles zero and leading zeros', () => {
    assert.equal(toNumber('௦'), 0);
    assert.equal(toNumber('௦௦௧'), 1);
    assert.equal(toNumber('௦௦௦'), 0);
  });

  it('tolerates an optional leading $', () => {
    assert.equal(toNumber('$௧௮'), 18);
  });

  it('rejects invalid characters', () => {
    assert.throws(() => toNumber(''), JsTamilError);
    assert.throws(() => toNumber('abc'), JsTamilError);
    assert.throws(() => toNumber('12'), JsTamilError);
    assert.throws(() => toNumber('௧2'), JsTamilError);
    assert.throws(() => toNumber('௧a'), JsTamilError);
    assert.throws(() => toNumber(' ௧'), JsTamilError);
    assert.throws(() => toNumber('௧.௫'), JsTamilError);
    assert.throws(() => toNumber('-௧'), JsTamilError);
  });

  it('rejects non-string input', () => {
    assert.throws(() => toNumber(123), TypeError);
    assert.throws(() => toNumber(null), TypeError);
    assert.throws(() => toNumber(undefined), TypeError);
  });

  it('refuses values beyond MAX_SAFE_INTEGER', () => {
    // 2^53 = 9007199254740992 -> one over the safe limit
    assert.throws(() => toNumber('௯௦௦௭௧௯௯௨௫௪௭௪௦௯௯௨'), RangeError);
    assert.equal(toNumber('௯௦௦௭௧௯௯௨௫௪௭௪௦௯௯௧'), Number.MAX_SAFE_INTEGER);
  });

  it('returns a JS Number', () => {
    assert.equal(typeof toNumber('௧௨௩'), 'number');
  });
});

describe('toTamilNumerals', () => {
  it('converts 0-9', () => {
    const expected = ['௦', '௧', '௨', '௩', '௪', '௫', '௬', '௭', '௮', '௯'];
    for (let n = 0; n <= 9; n++) {
      assert.equal(toTamilNumerals(n), expected[n], `toTamilNumerals(${n})`);
    }
  });

  it('converts multi-digit numbers', () => {
    assert.equal(toTamilNumerals(123), '௧௨௩');
    assert.equal(toTamilNumerals(0), '௦');
    assert.equal(toTamilNumerals(18), '௧௮');
    assert.equal(toTamilNumerals(100), '௧௦௦');
    assert.equal(toTamilNumerals(Number.MAX_SAFE_INTEGER), '௯௦௦௭௧௯௯௨௫௪௭௪௦௯௯௧');
  });

  it('round-trips with toNumber', () => {
    for (const n of [0, 1, 9, 10, 18, 100, 12345, 1000000]) {
      assert.equal(toNumber(toTamilNumerals(n)), n);
    }
  });

  it('rejects negatives, decimals, and non-finite values', () => {
    assert.throws(() => toTamilNumerals(-1), RangeError);
    assert.throws(() => toTamilNumerals(1.5), RangeError);
    assert.throws(() => toTamilNumerals(NaN), RangeError);
    assert.throws(() => toTamilNumerals(Infinity), RangeError);
    assert.throws(() => toTamilNumerals(Number.MAX_SAFE_INTEGER + 1), RangeError);
  });

  it('rejects non-number input', () => {
    assert.throws(() => toTamilNumerals('123'), TypeError);
    assert.throws(() => toTamilNumerals(null), TypeError);
  });
});
