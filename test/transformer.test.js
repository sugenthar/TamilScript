'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { transform } = require('../src/index');
const { JsTamilSyntaxError } = require('../src/errors');

describe('transformer: Tamil numerics', () => {
  it('transforms a single Tamil integer', () => {
    assert.equal(transform('let age = $௧௮;'), 'let age = 18;');
  });

  it('transforms every single digit', () => {
    const digits = ['௦', '௧', '௨', '௩', '௪', '௫', '௬', '௭', '௮', '௯'];
    digits.forEach((d, n) => {
      assert.equal(transform(`let x = $${d};`), `let x = ${n};`);
    });
  });

  it('transforms multi-digit integers and zero', () => {
    assert.equal(transform('let p = $௧௦௦;'), 'let p = 100;');
    assert.equal(transform('let z = $௦;'), 'let z = 0;');
  });

  it('supports unary minus and mixed ASCII arithmetic', () => {
    assert.equal(transform('let n = -$௧௮;'), 'let n = -18;');
    assert.equal(transform('let m = $௧௦ + 20;'), 'let m = 10 + 20;');
  });

  it('preserves operator precedence textually', () => {
    assert.equal(transform('let t = $௧௦௦ + $௨௦௦;'), 'let t = 100 + 200;');
    assert.equal(transform('let q = $௨௦ / $௫;'), 'let q = 20 / 5;');
  });

  it('transforms Tamil decimal literals (v0.2.0 grammar)', () => {
    assert.equal(transform('let x = $௧௨.௫;'), 'let x = 12.5;');
    assert.equal(transform('let x = $௦.௧௮;'), 'let x = 0.18;');
  });

  it('rejects malformed or mixed-script decimals with a clear error', () => {
    assert.throws(() => transform('let x = $௧.5;'), /Mixed Tamil\/ASCII decimal/);
    assert.throws(() => transform('let x = $௧.௫.௬;'), /only one decimal separator/);
    assert.throws(() => transform('let x = $௧.௫n;'), /BigInt/);
    assert.throws(() => transform('let x = $௧.௫abc;'), /Malformed Tamil decimal literal/);
  });

  it('rejects BigInt Tamil syntax with a clear error', () => {
    assert.throws(() => transform('let x = $௧n;'), /BigInt/);
  });

  it('rejects malformed continuations', () => {
    assert.throws(() => transform('let x = $௧abc;'), /Malformed Tamil numeric literal/);
    assert.throws(() => transform('let x = $௧2;'), /Malformed Tamil numeric literal/);
  });

  it('rejects bare Tamil digits outside a $ literal', () => {
    for (const src of ['let x = ௧;', 'let x = 1௧;', 'let x = ௩௫;', 'let t = `${௧}`;']) {
      assert.throws(
        () => transform(src),
        (err) => {
          assert.ok(err instanceof JsTamilSyntaxError, src);
          assert.equal(err.code, 'JST_BAD_NUMERIC_LITERAL', src);
          assert.match(err.message, /not part of a "\$" numeric literal/, src);
          assert.match(err.message, /Did you mean "\$/, src);
          return true;
        },
        src
      );
    }
    try {
      transform('let a = 1;\nlet x = ௧;');
      assert.fail('should have thrown');
    } catch (err) {
      assert.equal(err.line, 2);
      assert.equal(err.column, 9);
    }
    // Tamil digits remain ordinary identifier characters inside identifiers...
    assert.equal(transform('let x௧ = 1;'), 'let x௧ = 1;');
    assert.equal(transform('let y = obj.அ௧;'), 'let y = obj.அ௧;');
    // ...and inert inside strings, comments, template text and regular expressions.
    const inert = 'const s = "௧"; // ௧\nconst t = `௧`;\nconst r = /௧/;\n';
    assert.equal(transform(inert), inert);
  });

  it('reports line/column for numeric errors', () => {
    try {
      transform('let a = 1;\nlet x = $௧.5;');
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof JsTamilSyntaxError);
      assert.equal(err.line, 2);
    }
  });

  it('leaves ordinary $ identifiers untouched', () => {
    assert.equal(transform('let $name = 1;'), 'let $name = 1;');
    assert.equal(transform('let a = $x + $;'), 'let a = $x + $;');
  });
});

describe('transformer: the removed $ string form', () => {
  it('rejects $"..." with a migration diagnostic (JST_TAMIL_STRING_REMOVED)', () => {
    assert.throws(
      () => transform('let s = $"Tamil";'),
      (err) => {
        assert.ok(err instanceof JsTamilSyntaxError);
        assert.equal(err.code, 'JST_TAMIL_STRING_REMOVED');
        assert.match(err.message, /no longer supported/);
        assert.match(err.message, /ordinary JavaScript string/);
        return true;
      }
    );
  });

  it("rejects $'...' with the same diagnostic", () => {
    assert.throws(
      () => transform("let s = $'வணக்கம்';"),
      (err) => {
        assert.ok(err instanceof JsTamilSyntaxError);
        assert.equal(err.code, 'JST_TAMIL_STRING_REMOVED');
        assert.match(err.message, /\$'\.\.\.'/);
        return true;
      }
    );
  });

  it('reports line/column of the removed form', () => {
    try {
      transform('let a = 1;\nlet s = $"abc";');
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof JsTamilSyntaxError);
      assert.equal(err.line, 2);
      assert.equal(err.column, 9);
      assert.equal(err.code, 'JST_TAMIL_STRING_REMOVED');
    }
  });

  it('keeps ordinary JavaScript strings (the migration target) untouched', () => {
    assert.equal(transform('let n = "Tamil";'), 'let n = "Tamil";');
    assert.equal(transform("let g = 'வணக்கம்';"), "let g = 'வணக்கம்';");
    assert.equal(transform('let e = "";'), 'let e = "";');
    assert.equal(transform('let s = "a\\"b\\\\c\\n\\u0B85";'), 'let s = "a\\"b\\\\c\\n\\u0B85";');
  });

  it('never scans $ literals inside comments, ordinary strings, regex or template text', () => {
    const src =
      'const s = "$௧௮ in a string";\n' +
      '// $"வணக்கம்" in a line comment\n' +
      "/* $௧.௫ and $'x' in a block comment */\n" +
      'const r = /$௧௮/;\n' +
      'const t = `text $௧௮ and ${$௫} expr`;\n';
    const expected =
      'const s = "$௧௮ in a string";\n' +
      '// $"வணக்கம்" in a line comment\n' +
      "/* $௧.௫ and $'x' in a block comment */\n" +
      'const r = /$௧௮/;\n' +
      'const t = `text $௧௮ and ${5} expr`;\n';
    assert.equal(transform(src), expected);
  });

  it('evaluates ordinary strings to the exact value at runtime', () => {
    const vm = require('node:vm');
    const cases = [
      ['"Tamil"', 'Tamil'],
      ['"வணக்கம்"', 'வணக்கம்'],
      ['"a\\"b"', 'a"b'],
      ['"a\\\\b"', 'a\\b'],
      ['"a\\nb"', 'a\nb'],
      ["'it\\'s'", "it's"],
      ['""', ''],
    ];
    for (const [src, expected] of cases) {
      const js = transform(`module.exports = (${src});`);
      const sandbox = { module: { exports: {} } };
      vm.runInNewContext(js, sandbox);
      assert.equal(sandbox.module.exports, expected, src);
    }
  });
});

describe('transformer: expressions and compatibility', () => {
  it('never executes source during transform', () => {
    let touched = false;
    void touched;
    const out = transform('globalThis.__tamilscript_probe = 1;');
    assert.match(out, /__tamilscript_probe/);
    assert.equal(globalThis.__tamilscript_probe, undefined);
    delete globalThis.__tamilscript_probe;
  });

  it('throws TypeError for non-string input', () => {
    assert.throws(() => transform(123), TypeError);
    assert.throws(() => transform(null), TypeError);
  });

  it('supports custom literals in calls, arrays, objects, arrows, classes, async code', () => {
    const src = `
function add(a, b) { return a + b; }
const r = add($௧௦, $௨௦);
const arr = [$௧, $௨, $௩];
const obj = { name: "தமிழ்", age: $௧௮ };
const f = (n) => n * $௨;
class C { m() { return $௫; } }
async function g() { return $௧; }
`;
    const out = transform(src);
    assert.match(out, /add\(10, 20\)/);
    assert.match(out, /\[1, 2, 3\]/);
    assert.match(out, /name: "தமிழ்", age: 18/);
    assert.match(out, /n \* 2/);
    assert.match(out, /return 5;/);
    assert.match(out, /return 1;/);
  });

  it('executes a full program to the expected values', () => {
    const vm = require('node:vm');
    const src = `
let total = $௧௦௦ + $௨௦௦;
let message = "வணக்கம் " + "தமிழ்";
module.exports = { total, message };
`;
    const sandbox = { module: { exports: {} } };
    vm.runInNewContext(transform(src), sandbox);
    assert.equal(sandbox.module.exports.total, 300);
    assert.equal(sandbox.module.exports.message, 'வணக்கம் தமிழ்');
  });
});
