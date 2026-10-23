'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const runtime = require('../src/runtime');
const api = require('../src');

const { சேர், நீளம், எண், சொல் } = runtime;

describe('explicit Tamil runtime helpers', () => {
  it('exports exactly the documented runtime surface', () => {
    assert.deepEqual(
      Object.keys(runtime).sort(),
      ['PRINT_HELPER_NAME', 'அச்சிடு', 'எண்', 'சொல்', 'சேர்', 'நீளம்'].sort()
    );
    assert.equal(typeof சேர், 'function');
    assert.equal(typeof நீளம், 'function');
    assert.equal(typeof எண், 'function');
    assert.equal(typeof சொல், 'function');
  });

  it('does not install helper globals when the runtime is imported', () => {
    assert.equal(globalThis.சேர், undefined);
    assert.equal(globalThis.நீளம், undefined);
    assert.equal(globalThis.எண், undefined);
    assert.equal(globalThis.சொல், undefined);
    // The print helper is also not installed by a plain import.
    assert.equal(globalThis[runtime.PRINT_HELPER_NAME], undefined);
  });

  it('does not expose helpers from the package root', () => {
    assert.equal(api.சேர், undefined);
    assert.equal(api.நீளம், undefined);
    assert.equal(api.எண், undefined);
    assert.equal(api.சொல், undefined);
  });

  it('சேர் appends to arrays and Sets in place and returns the same collection', () => {
    const array = [1];
    assert.equal(சேர்(array, 2, 3), array);
    assert.deepEqual(array, [1, 2, 3]);

    const set = new Set([1]);
    assert.equal(சேர்(set, 2, 2, 3), set);
    assert.deepEqual([...set], [1, 2, 3]);

    assert.throws(() => சேர்('abc', 'd'), TypeError);
    assert.throws(() => சேர்({}, 1), TypeError);
    assert.throws(() => சேர்(undefined, 1), TypeError);
  });

  it('நீளம் reads length and size without coercing', () => {
    assert.equal(நீளம்('தமிழ்'), 'தமிழ்'.length);
    assert.equal(நீளம்([1, 2, 3]), 3);
    assert.equal(நீளம்(new Map([[1, 2]])), 1);
    assert.equal(நீளம்(new Set([1, 2])), 2);
    assert.equal(நீளம்({ length: 7 }), 7);
    assert.equal(நீளம்({ size: 9 }), 9);
    assert.throws(() => நீளம்(null), TypeError);
    assert.throws(() => நீளம்({}), TypeError);
    assert.throws(() => நீளம்(3), TypeError);
  });

  it('எண் accepts Tamil integers/decimals as well as ordinary Number() inputs', () => {
    assert.equal(எண்(1), 1);
    assert.equal(எண்(1.5), 1.5);
    assert.equal(எண்('௧௮'), 18);
    assert.equal(எண்('$௧.௫'), 1.5);
    assert.equal(எண்('18'), 18);
    assert.equal(எண்('18.5'), 18.5);
    assert.equal(எண்(true), 1);
    assert.equal(Number.isNaN(எண்('not-a-number')), true);
    // Non-Tamil strings retain ordinary Number() coercion.
    assert.equal(எண்(''), 0);
    assert.equal(எண்(' '), 0);
    assert.equal(எண்(' 18 '), 18);
    assert.equal(எண்('-18.5'), -18.5);
  });

  it('எண் accepts signed Tamil integers and decimals', () => {
    assert.equal(எண்('-$௧௮'), -18);
    assert.equal(எண்('+$௧௮'), 18);
    assert.equal(எண்('-$௧.௫'), -1.5);
    assert.equal(எண்('+$௧.௫'), 1.5);
    assert.ok(Object.is(எண்('-$௦'), -0), 'negative zero is preserved');
  });

  it('எண் rejects malformed signs and partially valid Tamil strings', () => {
    for (const bad of [
      '--$௧௮',
      '+-$௧௮',
      '-+$௧௮',
      '$-௧௮',
      '$+௧௮',
      '-$',
      '+$',
      '-',
      '+',
      '-$௧x',
      '-$௧.',
      '-.௫',
      '-$௧.௫.௧',
      ' -$௧௮',
      '-$௧௮ ',
      '-$௧-௮',
    ]) {
      assert.ok(Number.isNaN(எண்(bad)), `${JSON.stringify(bad)} must not be partially parsed`);
    }
  });

  it('சொல் uses ordinary String() coercion', () => {
    assert.equal(சொல்(18), '18');
    assert.equal(சொல்(null), 'null');
    assert.equal(சொல்(undefined), 'undefined');
    assert.equal(சொல்('தமிழ்'), 'தமிழ்');
    assert.equal(சொல்([1, 2]), '1,2');
  });
});
