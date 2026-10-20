'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { transform } = require('../src/index');
const { JsTamilSyntaxError } = require('../src/errors');

function runValue(src) {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(transform(`module.exports = (${src});`), sandbox);
  return sandbox.module.exports;
}

describe('decimals: grammar and values', () => {
  it('transforms the documented examples', () => {
    assert.equal(transform('const price = $௧௨.௫;'), 'const price = 12.5;');
    assert.equal(transform('const tax = $௦.௧௮;'), 'const tax = 0.18;');
    assert.equal(transform('const result = $௧௨.௫ + $௨.௫;'), 'const result = 12.5 + 2.5;');
  });

  it('evaluates to the expected runtime values', () => {
    assert.equal(runValue('$௧௨.௫'), 12.5);
    assert.equal(runValue('$௦.௧௮'), 0.18);
    assert.equal(runValue('$௧௨.௫ + $௨.௫'), 15);
    assert.equal(runValue('-$௧.௫'), -1.5);
  });

  it('handles zero, leading zeros and large numbers', () => {
    assert.equal(runValue('$௦.௦'), 0);
    assert.equal(runValue('$௦௦௧.௫௦'), 1.5);
    assert.equal(runValue('$௧௦௦௦.௦௦௧'), 1000.001);
    assert.equal(runValue('$௧௨௩௪௫.௬௭௮'), 12345.678);
  });

  it('follows IEEE 754 semantics like the ASCII equivalent', () => {
    // Same computation as plain JavaScript: 0.1 + 0.2 is not exactly 0.3.
    assert.equal(runValue('$௦.௧ + $௦.௨'), 0.1 + 0.2);
    assert.equal(runValue('$௧.௧'), 1.1);
    assert.equal(transform('let x = $௧.௧;'), 'let x = 1.1;');
  });

  it('does not emit the shadowable identifier Infinity for overflow', () => {
    const src = `let x = $${'௯'.repeat(400)}.௦;`;
    const out = transform(src);
    assert.doesNotMatch(out, /\bInfinity\b/);
    assert.equal(out, 'let x = 1e309;');
    const sandbox = { module: { exports: {} }, Infinity: 42 };
    vm.runInNewContext(`${out}\nmodule.exports = x;`, sandbox);
    assert.equal(sandbox.module.exports, Infinity);
    assert.equal(Number.isFinite(sandbox.module.exports), false);
  });

  it('supports decimals in expressions, calls, arrays and templates', () => {
    assert.equal(transform('let t = $௧.௫ * $௨;'), 'let t = 1.5 * 2;');
    assert.equal(transform('f($௧.௫, $௨.௫);'), 'f(1.5, 2.5);');
    assert.equal(transform('const a = [$௧.௫];'), 'const a = [1.5];');
    assert.equal(transform('const t = `v: ${$௧.௫}`;'), 'const t = `v: ${1.5}`;');
    assert.equal(transform('const o = { p: $௧.௫ };'), 'const o = { p: 1.5 };');
  });

  it('rejects missing integer or fractional digits', () => {
    // `$௧.` (no fraction) is an integer plus ordinary JavaScript.
    assert.equal(transform('let x = $௧.;'), 'let x = 1.;');
    // `$.௫` (no integer digits) can never be valid JavaScript: Tamil digits
    // cannot start a property name, so it is reported as the decimal
    // mistake it is — not blamed on the digit with a `$` suggestion.
    assert.throws(
      () => transform('let x = $.௫;'),
      (err) => {
        assert.equal(err.code, 'JST_BAD_NUMERIC_LITERAL');
        assert.equal(err.line, 1);
        assert.equal(err.column, 9);
        assert.match(err.message, /digits on both sides of "\."/);
        return true;
      }
    );
    // An ordinary `$`-identifier keeps working (jQuery-style `$.ajax`).
    assert.equal(transform('$.ajax();'), '$.ajax();');
    assert.throws(() => transform('let x = $௧.௫.௬;'), /only one decimal separator/);
  });

  it('rejects mixed-script decimals instead of guessing', () => {
    assert.throws(() => transform('let x = $௧.5;'), /Mixed Tamil\/ASCII decimal/);
    assert.throws(() => transform('let x = $௧.5;'), (err) => err.code === 'JST_MIXED_NUMERAL');
  });

  it('refuses literals glued to neighbouring tokens', () => {
    assert.throws(() => transform('let x = $௧க;'), /must not be directly followed/);
    assert.throws(
      () => transform('let x = 1$௧;'),
      (err) => err.code === 'JST_BAD_NUMERIC_LITERAL' && /must not be directly preceded/.test(err.message)
    );
    assert.throws(() => transform('let x = $௧$௨;'), /must not be directly followed/);
    assert.throws(() => transform('let x = $௧.$௨;'), /without the second "\$"/);
    // Spread legitimately ends in a dot and must keep working.
    assert.equal(transform('const xs = [...$௧];'), 'const xs = [...1];');
    assert.equal(transform('const ys = [...arr];'), 'const ys = [...arr];');
    // A two-dot prefix is not a spread: it can never be valid JavaScript.
    assert.throws(
      () => transform('let x = a..$௧;'),
      (err) => err.code === 'JST_BAD_NUMERIC_LITERAL' && /must not be directly preceded/.test(err.message)
    );
  });

  it('rejects trailing identifier characters and BigInt markers', () => {
    assert.throws(() => transform('let x = $௧.௫abc;'), /Malformed Tamil decimal literal/);
    assert.throws(() => transform('let x = $௧.௫n;'), /BigInt/);
  });

  it('preserves property access, ASCII decimals, spread and optional chaining', () => {
    // `$௧.toString()` must stay runnable: the replacement carries a
    // trailing dot so the user's dot becomes member access (`1..toString()`).
    assert.equal(transform('let a = $௧.toString();'), 'let a = 1..toString();');
    assert.equal(runValue('$௧.toString()'), '1');
    assert.equal(runValue('$௧..toString()'), '1');
    assert.equal(transform('let a2 = $௧.௦.toString();'), 'let a2 = 1..toString();');
    assert.equal(transform('let d = 1.5;'), 'let d = 1.5;');
    assert.equal(transform('let e = [...arr];'), 'let e = [...arr];');
    assert.equal(transform('let f = a?.b;'), 'let f = a?.b;');
    assert.equal(transform('let g = obj.$prop;'), 'let g = obj.$prop;');
    assert.equal(transform('let h = $௧ .5;'), 'let h = 1 .5;');
  });

  it('adds the property-access dot across comments on the same line', () => {
    // Regression: a block comment between the dot and the property name was
    // missed, so `$௧./*c*/toString()` became `1./*c*/toString()` and failed
    // to parse ("Unexpected identifier 'toString'").
    assert.equal(transform('let a = $௧. /*c*/ toString();'), 'let a = 1.. /*c*/ toString();');
    assert.equal(transform('let a = $௧./**/toString();'), 'let a = 1../**/toString();');
    assert.equal(runValue('$௧. /*c*/ toString()'), '1');
    assert.equal(runValue('$௧./**/toString()'), '1');
    // Decimals that normalize to an integer need the same treatment.
    assert.equal(transform('let b = $௧.௦. /*c*/ toString();'), 'let b = 1.. /*c*/ toString();');
    assert.equal(runValue('$௧.௦./*c*/toString()'), '1');
    // A line terminator (even inside a block comment or a line comment) ends
    // the member-access statement, so no extra dot is added.
    const blockNewline = 'let c = $௧. /*\n*/ toString();';
    assert.equal(transform(blockNewline), 'let c = 1. /*\n*/ toString();');
    const lineComment = 'let d = $௧. // c\n toString();';
    assert.equal(transform(lineComment), 'let d = 1. // c\n toString();');
    // `1. in x` / `1. instanceof x` are the numeric literal plus an operator;
    // adding the member-access dot would flip them into property access.
    assert.equal(
      transform('const x = $௧. /*c*/ instanceof Object;'),
      'const x = 1. /*c*/ instanceof Object;'
    );
    assert.equal(transform('const y = $௧. /*c*/ in {};'), 'const y = 1. /*c*/ in {};');
  });

  it('supports member access and methods on decimal literals', () => {
    // Regression: the replacement for a decimal already ends in digits, so
    // appending the integer-form property-access dot produced
    // `3.5..toFixed(1)` — a syntax error. The user's own dot is correct.
    assert.equal(transform('let g = $௩.௫.toFixed(1);'), 'let g = 3.5.toFixed(1);');
    assert.equal(transform('let h = $௩.௫.toString();'), 'let h = 3.5.toString();');
    assert.equal(runValue('$௩.௫.toFixed(1)'), '3.5');
    assert.equal(runValue('$௩.௫.toString()'), '3.5');
    assert.equal(runValue('$௧.௫.toFixed(2)'), '1.50');
    assert.equal(transform('let p = $௩.௫.மதிப்பு;'), 'let p = 3.5.மதிப்பு;');
    // A decimal that normalizes to an integer keeps the integer form's dot
    // trick so the source dot still becomes member access.
    assert.equal(transform('let i = $௧.௦.toString();'), 'let i = 1..toString();');
    assert.equal(runValue('$௧.௦.toString()'), '1');
    // Exponent-form replacements must not gain a second dot either.
    const tiny = '$௦.' + '௦'.repeat(19) + '௧';
    assert.equal(transform(`let e = ${tiny}.toString();`), 'let e = 1e-20.toString();');
    assert.equal(runValue(`${tiny}.toString()`), '1e-20');
  });

  it('reports dangling or repeated dots after a decimal literal', () => {
    const cases = [
      ['let x = $௩.௫.;', 'JST_BAD_NUMERIC_LITERAL', /decimal point is already part of the literal/],
      ['let x = $௩.௫..toString();', 'JST_BAD_NUMERIC_LITERAL', /decimal point is already part of the literal/],
      ['let x = $௩.௫.+$௧;', 'JST_BAD_NUMERIC_LITERAL', /decimal point is already part of the literal/],
      ['let x = $௩.௫.$௨;', 'JST_MIXED_NUMERAL', /without the second "\$"/],
      ['let x = $௩.௫.5;', 'JST_BAD_NUMERIC_LITERAL', /only one decimal separator/],
    ];
    for (const [src, code, pattern] of cases) {
      assert.throws(
        () => transform(src),
        (err) => {
          assert.ok(err instanceof JsTamilSyntaxError, src);
          assert.equal(err.code, code, src);
          assert.equal(err.line, 1, src);
          assert.equal(err.column, 9, src);
          assert.match(err.message, pattern, src);
          return true;
        },
        src
      );
    }
    // Whitespace before a property name, and Tamil property names, are
    // ordinary JavaScript and stay untouched.
    assert.equal(transform('let s = $௩.௫. toString();'), 'let s = 3.5. toString();');
    assert.equal(transform('let p = $௩.௫.மதிப்பு;'), 'let p = 3.5.மதிப்பு;');
  });

  it('does not touch decimals inside strings, comments or template text', () => {
    assert.equal(transform('const s = "$௧.௫";'), 'const s = "$௧.௫";');
    assert.equal(transform('// $௧.௫\nlet x = 1;'), '// $௧.௫\nlet x = 1;');
    assert.equal(transform('const t = `price $௧.௫`;'), 'const t = `price $௧.௫`;');
  });

  it('reports decimal errors with location and code', () => {
    try {
      transform('line one\nlet x = $௧.௫.௬;');
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof JsTamilSyntaxError);
      assert.equal(err.line, 2);
      assert.equal(err.code, 'JST_BAD_NUMERIC_LITERAL');
    }
  });
});

// Exact regression program from the decimal/syntax-highlighting bug report.
const TASK_PROGRAM = [
  'const முழு = $௧௮;',
  'const தசமம் = $௩.௫;',
  'const மற்றொரு = $௧௦௦.௨௫;',
  '',
  'அச்சிடு(முழு);',
  'அச்சிடு(தசமம்);',
  'அச்சிடு(மற்றொரு);',
  '',
].join('\n');

const TASK_EXPECTED = [
  'const முழு = 18;',
  'const தசமம் = 3.5;',
  'const மற்றொரு = 100.25;',
  '',
  'அச்சிடு(முழு);',
  'அச்சிடு(தசமம்);',
  'அச்சிடு(மற்றொரு);',
  '',
].join('\n');

const TASK_OUTPUT = '18\n3.5\n100.25\n';

describe('decimals: task regression examples', () => {
  it('transforms the exact reported program', () => {
    assert.equal(transform(TASK_PROGRAM), TASK_EXPECTED);
  });

  it('evaluates the exact reported literals', () => {
    assert.equal(runValue('$௧௮'), 18);
    assert.equal(runValue('$௩.௫'), 3.5);
    assert.equal(runValue('$௧௦௦.௨௫'), 100.25);
  });

  it('keeps multi-digit integers and fractions exact', () => {
    assert.equal(transform('let x = $௧௦௦.௨௫;'), 'let x = 100.25;');
    assert.equal(transform('let y = $௧.௨௫;'), 'let y = 1.25;');
    assert.equal(transform('let z = $௧௦௦௦௦.௦௦௧;'), 'let z = 10000.001;');
  });

  it('transforms the required single- and multi-digit examples', () => {
    // Tamil digits map positionally to Arabic digits: ௧=1, ௮=8, ௨=2,
    // ௫=5, ௬=6. (`$௧௧` is 11; the "18" in the example list is `$௧௮`,
    // the integer from the original report, asserted alongside it.)
    assert.equal(transform('const a = $௧;'), 'const a = 1;');
    assert.equal(transform('const b = $௧௧;'), 'const b = 11;');
    assert.equal(transform('const b2 = $௧௮;'), 'const b2 = 18;');
    assert.equal(transform('const c = $௩.௫;'), 'const c = 3.5;');
    assert.equal(transform('const d = $௧௮௨.௫௬;'), 'const d = 182.56;');
    assert.equal(runValue('$௧'), 1);
    assert.equal(runValue('$௧௧'), 11);
    assert.equal(runValue('$௧௮'), 18);
    assert.equal(runValue('$௩.௫'), 3.5);
    assert.equal(runValue('$௧௮௨.௫௬'), 182.56);
  });

  it('handles several integer and decimal literals in one program', () => {
    const src = 'let s = $௧ + $௨௦ + $௩.௫ + $௧.௨;';
    assert.equal(transform(src), 'let s = 1 + 20 + 3.5 + 1.2;');
    assert.equal(runValue('$௧ + $௨௦ + $௩.௫ + $௧.௨'), 1 + 20 + 3.5 + 1.2);
  });

  it('reports malformed and incomplete decimals with code and location', () => {
    const cases = [
      ['$௩.5', 'JST_MIXED_NUMERAL'],
      ['$௩.$௫', 'JST_MIXED_NUMERAL'],
      ['$௩.௫5', 'JST_BAD_NUMERIC_LITERAL'],
      ['$௩.௫.௫', 'JST_BAD_NUMERIC_LITERAL'],
      ['$௩.௫_', 'JST_BAD_NUMERIC_LITERAL'],
      ['$௩.௫n', 'JST_UNSUPPORTED_BIGINT'],
    ];
    for (const [literal, code] of cases) {
      try {
        transform('let x = ' + literal + ';');
        assert.fail(`should have thrown for ${literal}`);
      } catch (err) {
        assert.ok(err instanceof JsTamilSyntaxError, `${literal}: error type`);
        assert.equal(err.code, code, `${literal}: code`);
        assert.equal(err.line, 1, `${literal}: line`);
        assert.equal(err.column, 9, `${literal}: column of the $`);
      }
    }
  });
});

describe('decimals: CLI run/check/transform end to end', () => {
  const BIN = path.join(__dirname, '..', 'bin', 'tamilscript.js');
  const node = (args, opts) => spawnSync(process.execPath, args, { encoding: 'utf8', ...opts });

  it('run, check, transform -o and transform --stdout agree with direct node', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-decimals-'));
    try {
      fs.writeFileSync(path.join(dir, 'prog.js'), TASK_PROGRAM, 'utf8');
      const run = node([BIN, 'run', 'prog.js'], { cwd: dir });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, TASK_OUTPUT);
      const check = node([BIN, 'check', 'prog.js'], { cwd: dir });
      assert.equal(check.status, 0, check.stderr);
      const stdout = node([BIN, 'transform', 'prog.js', '--stdout'], { cwd: dir });
      assert.equal(stdout.status, 0, stdout.stderr);
      assert.match(stdout.stdout, /const முழு = 18;/);
      assert.match(stdout.stdout, /const தசமம் = 3\.5;/);
      assert.match(stdout.stdout, /const மற்றொரு = 100\.25;/);
      fs.writeFileSync(path.join(dir, 'direct.js'), stdout.stdout, 'utf8');
      const direct = node(['direct.js'], { cwd: dir });
      assert.equal(direct.status, 0, direct.stderr);
      assert.equal(direct.stdout, TASK_OUTPUT);
      const toFile = node([BIN, 'transform', 'prog.js', '-o', 'out.js'], { cwd: dir });
      assert.equal(toFile.status, 0, toFile.stderr);
      const written = fs.readFileSync(path.join(dir, 'out.js'), 'utf8');
      assert.match(written, /100\.25/);
      const fromFile = node(['out.js'], { cwd: dir });
      assert.equal(fromFile.status, 0, fromFile.stderr);
      assert.equal(fromFile.stdout, TASK_OUTPUT);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
