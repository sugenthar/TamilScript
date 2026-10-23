'use strict';

// Inclusive Tamil integer ranges: `$start..$end` becomes an array expression.
// This is part of the numeric-literal layer, so it works without keyword mode.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { transform, transformWithMeta, validate } = require('../src');

const RANGE_1_TO_5 = '(() => { const values = []; for (let i = 0; i < 5; i++) values[i] = 1 + i; return values; })()';

function run(code) {
  const lines = [];
  vm.runInNewContext(code, {
    console: { log: (...args) => lines.push(args.join(' ')) },
    JSON,
  });
  return lines;
}

describe('Tamil inclusive ranges', () => {
  it('materializes both endpoints in ascending order', () => {
    const code = transform('console.log(JSON.stringify($௧..$௫));');
    assert.equal(code, `console.log(JSON.stringify(${RANGE_1_TO_5}));`);
    assert.deepEqual(run(code), ['[1,2,3,4,5]']);
  });

  it('does not depend on a shadowed Array binding', () => {
    const source = [
      'function range(Array) { return $௧..$௫; }',
      'console.log(JSON.stringify(range({ from() { return ["shadowed"]; } })));',
    ].join('\n');
    const code = transform(source);
    assert.doesNotMatch(code, /Array\.from/);
    assert.deepEqual(run(code), ['[1,2,3,4,5]']);
  });

  it('handles single-element and zero-inclusive ranges', () => {
    assert.deepEqual(run(transform('console.log(JSON.stringify($௦..$௦));')), ['[0]']);
    assert.deepEqual(run(transform('console.log(JSON.stringify($௦..$௨));')), ['[0,1,2]']);
    assert.deepEqual(run(transform('console.log(JSON.stringify($௧௦..$௧௨));')), ['[10,11,12]']);
  });

  it('works in for...of loops and keeps following member access attached to the array', () => {
    const source = [
      'const seen = [];',
      'for (const i of $௧..$௪) seen.push(i);',
      'console.log(JSON.stringify(seen), $௧..$௫.toString());',
    ].join('\n');
    assert.deepEqual(run(transform(source)), ['[1,2,3,4] 1,2,3,4,5']);
  });

  it('works after spread and inside template expressions', () => {
    const source = [
      'const xs = [...$௧..$௩];',
      'console.log(xs.join(","), `${$௨..$௩}`);',
    ].join('\n');
    const code = transform(source);
    assert.match(code, /\[\.\.\.\(\(\) =>/);
    assert.match(code, /\$\{\(\(\) =>/);
    assert.deepEqual(run(code), ['1,2,3 2,3']);
  });

  it('does not rewrite ranges in strings, comments, regex literals, or raw template text', () => {
    const source = [
      '// $௧..$௫',
      '/* $௨..$௩ */',
      'const a = "$௧..$௫";',
      'const b = /$௧\\.\\.\\$௫/;',
      'const c = `$௧..$௫`;',
    ].join('\n');
    assert.equal(transform(source), source);
  });

  it('records a range event with the original spelling', () => {
    const result = transformWithMeta('const xs = $௧..$௫;');
    assert.equal(result.code, `const xs = ${RANGE_1_TO_5};`);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].type, 'range');
    assert.equal(result.events[0].text, '$௧..$௫');
    assert.equal(result.events[0].value, RANGE_1_TO_5);
  });

  it('rejects descending ranges with a stable diagnostic code', () => {
    assert.throws(
      () => transform('const xs = $௫..$௧;'),
      (err) => {
        assert.equal(err.code, 'JST_BAD_NUMERIC_LITERAL');
        assert.match(err.message, /descending/);
        assert.equal(err.line, 1);
        assert.equal(err.column, 12);
        return true;
      }
    );
  });

  it('rejects unsafe endpoints and an explicitly bounded oversized range', () => {
    assert.throws(
      () => transform('const xs = $௯௯௯௯௯௯௯௯௯௯௯௯௯௯௯௯..$௯௯௯௯௯௯௯௯௯௯௯௯௯௯௯௯;'),
      (err) => {
        assert.equal(err.code, 'JST_UNSAFE_INTEGER');
        assert.match(err.message, /MAX_SAFE_INTEGER/);
        return true;
      }
    );
    assert.throws(
      () => transform('const xs = $௦..$௧௦௦௦௦௧;'),
      (err) => {
        assert.equal(err.code, 'JST_BAD_NUMERIC_LITERAL');
        assert.match(err.message, /maximum is 100000/);
        return true;
      }
    );
  });

  it('rejects mixed-script and non-$ endpoints with source diagnostics', () => {
    assert.throws(
      () => transform('const xs = $௧..5;'),
      (err) => err.code === 'JST_MIXED_NUMERAL' && /ASCII range endpoint/.test(err.message)
    );
    assert.throws(
      () => transform('const xs = $௧..$05;'),
      (err) => err.code === 'JST_MIXED_NUMERAL' && /digits after "\$" must be Tamil/.test(err.message)
    );
    assert.throws(
      () => transform('const xs = $௧..௫;'),
      (err) => err.code === 'JST_BAD_NUMERIC_LITERAL' && /needs "\$"/.test(err.message)
    );
    assert.throws(
      () => transform('const xs = $௧..$௨.௫;'),
      (err) => err.code === 'JST_BAD_NUMERIC_LITERAL' && /decimal fraction/.test(err.message)
    );
    assert.throws(
      () => transform('const xs = $௧..$௨.5;'),
      (err) => err.code === 'JST_MIXED_NUMERAL' && /decimal fraction/.test(err.message)
    );
    const mixed = validate('const xs = $௧..5;');
    assert.equal(mixed.ok, false);
    assert.equal(mixed.diagnostic.code, 'JST_MIXED_NUMERAL');

    assert.throws(
      () => transform('const xs = $௧.௫..$௨.௫;'),
      (err) => err.code === 'JST_BAD_NUMERIC_LITERAL' && /decimal point/.test(err.message)
    );
    assert.equal(validate('const xs = $௧.௫..$௨.௫;').ok, false);
  });

  it('diagnoses a glued range and a glued trailing identifier', () => {
    assert.throws(
      () => transform('const xs = x.$௧..$௫;'),
      (err) => err.code === 'JST_BAD_NUMERIC_LITERAL' && /preceded/.test(err.message)
    );
    assert.throws(
      () => transform('const xs = $௧..$௫abc;'),
      (err) => err.code === 'JST_BAD_NUMERIC_LITERAL' && /directly followed/.test(err.message)
    );
  });
});
