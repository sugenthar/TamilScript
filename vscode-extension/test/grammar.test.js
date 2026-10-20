'use strict';

// Grammar tests: JSON validity, TextMate metadata, pattern behavior.
// Tamil text is built with String.fromCodePoint so this file stays ASCII.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.resolve(__dirname, '..');
const FULL = path.join(DIR, 'syntaxes', 'tamilscript.tmLanguage.json');
const INJ = path.join(DIR, 'syntaxes', 'tamilscript.injection.tmLanguage.json');

const D = (n) => String.fromCodePoint(0x0be6 + n);
const T18 = D(1) + D(8);
const T12 = D(1) + D(2);
const T5 = D(5);
const K = String.fromCodePoint(0x0b95); // க — an ordinary Tamil letter (identifier)

function load(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('grammar files are valid and registered consistently', () => {
  it('both grammars parse and expose the same literal rules', () => {
    const full = load(FULL);
    const inj = load(INJ);
    assert.equal(full.scopeName, 'source.tamilscript');
    assert.equal(inj.scopeName, 'tamilscript.injection');
    assert.equal(inj.injectionSelector, 'L:source.js -comment -string, L:source.js.jsx -comment -string, L:source.tamilscript -comment -string');
    const fullRules = full.patterns.filter((p) => p.match).map((p) => `${p.name}::${p.match}`);
    const injRules = inj.patterns.map((p) => `${p.name}::${p.match}`);
    assert.deepEqual(injRules, fullRules);
    assert.ok(full.patterns.some((p) => p.include === 'source.js'), 'full grammar includes source.js');
  });

  it('keeps every invalid rule ahead of exactly two numeric rules', () => {
    for (const f of [FULL, INJ]) {
      const rules = load(f).patterns.filter((p) => p.match);
      const lastInvalid = rules.map((p) => p.name).lastIndexOf('invalid.illegal.tamilscript');
      const firstNumeric = rules.findIndex((p) => p.name === 'constant.numeric.tamilscript');
      assert.ok(lastInvalid >= 0, `${f}: invalid rules present`);
      assert.ok(firstNumeric > lastInvalid, `${f}: invalid rules must precede numeric rules`);
      assert.equal(rules.length - firstNumeric, 2, `${f}: exactly two numeric rules`);
      // One shared numeric scope for both forms so no theme can colour the
      // integer and decimal forms differently; decimal must be checked first.
      assert.match(rules[firstNumeric].match, /\\\./, `${f}: decimal rule first`);
      assert.doesNotMatch(rules[firstNumeric + 1].match, /\\\./, `${f}: integer rule second`);
      for (const rule of rules.slice(firstNumeric)) {
        assert.equal(rule.captures['1'].name, 'punctuation.definition.tamilscript', `${f}: sigil`);
      }
    }
  });

  it('guards every literal rule with the identifier lookbehind', () => {
    for (const f of [FULL, INJ]) {
      for (const p of load(f).patterns) {
        if (!p.match) continue;
        assert.ok(
          p.match.startsWith('(?<![A-Za-z0-9_$'),
          `${f}: rule must not fire after an identifier character: ${p.match}`
        );
      }
    }
  });

  it('every pattern compiles as a RegExp', () => {
    for (const f of [FULL, INJ]) {
      const g = load(f);
      for (const p of g.patterns) {
        if (p.match) assert.doesNotThrow(() => new RegExp(p.match, 'u'), `${f}: ${p.match}`);
        if (p.begin) assert.doesNotThrow(() => new RegExp(p.begin, 'u'));
        if (p.end) assert.doesNotThrow(() => new RegExp(p.end, 'u'));
      }
    }
  });
});

describe('grammar matches documented literals', () => {
  const pats = load(INJ).patterns.map((p) => new RegExp(p.match, 'u'));
  // indexes: 0 removed-string, 1 bigint, 2 mixed-ascii-fraction,
  //          3 glued-integer, 4 repeated-decimal-separator,
  //          5 integer-dollar-fraction, 6 decimal-dollar-fraction,
  //          7 glued-decimal, 8 dangling-dot, 9 doubled-prefix,
  //          10 decimal, 11 integer
  const INVALID = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const invalidAtZero = (s) =>
    INVALID.some((i) => {
      const m = s.match(pats[i]);
      return m && m.index === 0;
    });

  it('fully matches integers and decimals', () => {
    const cases = [
      ['$' + D(1), 11],
      ['$' + T18, 11],
      ['$' + D(1) + D(1), 11],
      ['$' + D(0), 11],
      ['$' + T12 + '.' + T5, 10],
      ['$' + D(0) + '.' + D(1) + D(8), 10],
      ['$' + D(1) + D(8) + D(2) + '.' + D(5) + D(6), 10],
    ];
    for (const [s, idx] of cases) {
      const m = s.match(pats[idx]);
      assert.ok(m && m[0] === s, `rule ${idx} must fully match ${JSON.stringify(s)}`);
    }
  });

  it('flags the removed $ string forms as invalid', () => {
    for (const s of ['$"vanakkam"', "$'vanakkam'", '$""', "$''"]) {
      const m = s.match(pats[0]);
      assert.ok(m && m.index === 0 && m[0] === s.slice(0, 2), `$['"] must be invalid in ${JSON.stringify(s)}`);
    }
  });

  it('flags malformed literals as invalid at position 0', () => {
    const cases = [
      ['$' + T18 + 'n', 1],
      ['$' + T12 + '.' + T5 + 'n', 1],
      ['$' + D(1) + '.5', 2],
      ['$' + D(1) + 'abc', 3],
      ['$' + D(1) + '2', 3],
      ['$' + T12 + '.' + T5 + '.' + D(6), 4],
      ['$' + D(1) + '.$' + D(2), 5],
      ['$' + T12 + '.' + T5 + '.$' + D(2), 6],
      ['$' + T12 + '.' + T5 + K, 7],
      ['$' + T12 + '.' + T5 + '.', 8],
      ['$' + T12 + '.' + T5 + '.5', 8],
      ['$$' + D(1), 9],
      ['$' + D(1) + D(1) + '$', 3],
    ];
    for (const [s, idx] of cases) {
      const m = s.match(pats[idx]);
      assert.ok(m && m.index === 0, `invalid rule ${idx} must match at 0 in ${JSON.stringify(s)}`);
    }
  });

  it('never matches a literal glued to an identifier on the left', () => {
    const cases = [
      'x$' + T18,
      'x$' + D(1) + 'n',
      'x$' + D(1) + '5',
      'x$' + T12 + '.' + T5 + '.toFixed(1)',
      '5$' + D(1),
      String.fromCodePoint(0x0b85) + '$' + T18, // அ$௧௮ — identifier, not a literal
    ];
    for (const s of cases) {
      for (let i = 0; i < pats.length; i++) {
        assert.ok(!s.match(pats[i]), `rule ${i} must not match ${JSON.stringify(s)}`);
      }
    }
  });

  it('keeps property access, spacing and Tamil property names valid', () => {
    const decimals = [
      '$' + T12 + '.' + T5 + '.toFixed(1)',
      '$' + T12 + '.' + T5 + '. toString()',
      '$' + T12 + '.' + T5 + '.' + K,
      '$' + T12 + '.' + T5 + '.$prop',
    ];
    for (const s of decimals) {
      assert.ok(!invalidAtZero(s), `an invalid rule must not fire in ${JSON.stringify(s)}`);
      const m = s.match(pats[10]);
      assert.ok(m && m.index === 0 && m[0] === '$' + T12 + '.' + T5, `decimal literal must match in ${JSON.stringify(s)}`);
    }
    const integers = ['$' + D(1) + '.toString()', '$' + D(1) + '..toString()', '$' + D(1) + '.' + K];
    for (const s of integers) {
      assert.ok(!invalidAtZero(s), `an invalid rule must not fire in ${JSON.stringify(s)}`);
      const m = s.match(pats[11]);
      assert.ok(m && m.index === 0 && m[0] === '$' + D(1), `integer literal must match in ${JSON.stringify(s)}`);
    }
  });

  it('leaves ordinary JavaScript alone', () => {
    for (const s of ['$x', '$$', '$', '18', '1.5', '${a}', 'object.name', '$5', '$prop']) {
      const full = pats.some((p) => {
        const m = s.match(p);
        return m && m.index === 0 && m[0] === s;
      });
      assert.ok(!full, `no rule should fully match ${JSON.stringify(s)}`);
    }
  });

  it('matches only the literal prefix before property access', () => {
    const src = '$' + D(1) + '.toString()';
    const m = src.match(pats[11]);
    assert.ok(m && m[0] === '$' + D(1));
    const dec = '$' + T12 + '.' + T5 + '.toFixed(1)';
    const dm = dec.match(pats[10]);
    assert.ok(dm && dm[0] === '$' + T12 + '.' + T5);
  });
});
