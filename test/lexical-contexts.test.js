'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { transform } = require('../src/index');

describe('lexical contexts are preserved', () => {
  it('does not transform inside ordinary double-quoted strings', () => {
    const src = 'const text = "The symbol $௧௮ is just text here";';
    assert.equal(transform(src), src);
  });

  it('does not transform inside ordinary single-quoted strings', () => {
    const src = 'const text2 = \'This is also ordinary text: $"Tamil"\';';
    assert.equal(transform(src), src);
  });

  it('does not transform inside line comments', () => {
    const src = '// $௧௮ must remain unchanged in this comment\nlet x = 1;';
    assert.equal(transform(src), src);
  });

  it('does not transform inside block comments', () => {
    const src = '/*\n * $"தமிழ்" must remain unchanged in this comment.\n */\nlet x = $௧;';
    assert.equal(transform('/*\n * $"தமிழ்" must remain unchanged in this comment.\n */\nlet x = 1;').slice(0, 60), src.slice(0, 60));
    assert.equal(transform(src), '/*\n * $"தமிழ்" must remain unchanged in this comment.\n */\nlet x = 1;');
  });

  it('preserves regex literals and flags', () => {
    assert.equal(transform('const pattern = /\\$[0-9]+/;'), 'const pattern = /\\$[0-9]+/;');
    assert.equal(transform('const r = /ab+c/gi;'), 'const r = /ab+c/gi;');
    assert.equal(transform('const r = /[/]x/; let y = $௧;'), 'const r = /[/]x/; let y = 1;');
  });

  it('distinguishes division from regex', () => {
    assert.equal(transform('let q = $௨௦ / $௫;'), 'let q = 20 / 5;');
    assert.equal(transform('let q = a / b;'), 'let q = a / b;');
    assert.equal(transform('let q = (a) / b;'), 'let q = (a) / b;');
    assert.equal(transform('return /re/.test(s);'), 'return /re/.test(s);');
    assert.equal(transform('let r = x = /ab+c/gi;'), 'let r = x = /ab+c/gi;');
    // A regex statement directly after a control-flow condition is not
    // division; grouping must not confuse the same heuristic.
    assert.equal(transform('if (true) /$௧/.test("x");'), 'if (true) /$௧/.test("x");');
    assert.equal(transform('while (false) /["\']/.test("x");'), 'while (false) /["\']/.test("x");');
    assert.equal(transform('if ((a + 1) / 2 > 1) { ok(); }'), 'if ((a + 1) / 2 > 1) { ok(); }');
    assert.equal(transform('with (obj) /x/.test(s);'), 'with (obj) /x/.test(s);');
  });

  it('treats a regex after a block or declaration as a regex', () => {
    assert.equal(transform('if (true) {} /$௧/.test("x");'), 'if (true) {} /$௧/.test("x");');
    assert.equal(transform('function f() {} /$௧+/.test("x");'), 'function f() {} /$௧+/.test("x");');
    assert.equal(transform('try {} catch (e) {} /x/.test(s);'), 'try {} catch (e) {} /x/.test(s);');
    assert.equal(transform('class C {} /$௧/.test("x");'), 'class C {} /$௧/.test("x");');
  });

  it('treats for await and optional catch bindings as control headers', () => {
    // `for await (...)` ends a control header like `for (...)`; `await (...)`
    // on its own ends a value, so the two-word sequence needs its own state.
    const forAwait = 'async function f() { for await (const x of xs) /["\']/.test(x); }';
    assert.equal(transform(forAwait), forAwait);
    // `catch {}` (no binding) still opens a block, so a following regex is
    // a regex rather than division.
    const catchNoBinding = 'function f() { try {} catch {} /["\']/.test("x"); }';
    assert.equal(transform(catchNoBinding), catchNoBinding);
  });

  it('treats label and case blocks as blocks', () => {
    const label = 'function f() { label: {} /["\']/.test("x"); }';
    assert.equal(transform(label), label);
    const caseBlock = 'function f(x) { switch (x) { case 1: {} /["\']/.test("x"); break; } }';
    assert.equal(transform(caseBlock), caseBlock);
    const defaultBlock = 'function f(x) { switch (x) { default: {} /["\']/.test("x"); } }';
    assert.equal(transform(defaultBlock), defaultBlock);
    // Ternary colons inside a case expression must not end the case header.
    const caseTernary = 'function f(x) { switch (x) { case x ? 1 : 2: {} /["\']/.test("x"); } }';
    assert.equal(transform(caseTernary), caseTernary);
    const dollarLabel = 'function f() { $label: {} /["\']/.test("x"); }';
    assert.equal(transform(dollarLabel), dollarLabel);
  });

  it('keeps division after keyword-shaped property keys and class fields', () => {
    // Regression: `{ function: ... }` / `class C { class = ... }` used to
    // leave a stale pending header, turning the division after an arrow body
    // into a regex.
    const objectKeys = [
      'const o = { function: () => {} / 2 };',
      'const o = { class: () => {} / 2 };',
      'const o = { class: function () {} / 2 };',
      'const o = { function: class {} / 2 };',
    ];
    for (const src of objectKeys) assert.equal(transform(src), src, src);
    const classFields = [
      'class C { x = () => {} / 2; }',
      'class C { class = () => {} / 2; }',
      'class C { function = () => {} / 2; }',
      'class C { class; x = 1 / 2; }',
    ];
    for (const src of classFields) assert.equal(transform(src), src, src);
  });

  it('keeps division after object and function expressions', () => {
    assert.equal(transform('const q = ({}) / 2;'), 'const q = ({}) / 2;');
    const fnDiv = 'const f = function () {} / 2;';
    assert.equal(transform(fnDiv), fnDiv);
    const arrowDiv = 'const g = (() => {}) / 2;';
    assert.equal(transform(arrowDiv), arrowDiv);
  });

  it('does not transform the literal part of templates', () => {
    assert.equal(transform('const m = `Normal template text: $௧௮`;'), 'const m = `Normal template text: $௧௮`;');
  });

  it('transforms inside ${...} expressions', () => {
    assert.equal(transform('const v = `Actual value: ${$௧௮}`;'), 'const v = `Actual value: ${18}`;');
  });

  it('supports nested template literals', () => {
    const src = 'const v = `outer ${`inner ${$௧}`} end`;';
    assert.equal(transform(src), 'const v = `outer ${`inner ${1}`} end`;');
  });

  it('supports object literals inside template expressions', () => {
    const src = 'const v = `${({ n: $௨ }).n}`;';
    assert.equal(transform(src), 'const v = `${({ n: 2 }).n}`;');
  });

  it('does not change identifiers or property access', () => {
    const src = 'const o = { name: "தமிழ்", age: $௧௮ };\nconsole.log(o.name);\nconsole.log(o.age);';
    assert.equal(
      transform(src),
      'const o = { name: "தமிழ்", age: 18 };\nconsole.log(o.name);\nconsole.log(o.age);'
    );
  });

  it('handles $ followed by backtick (tagged template) without corruption', () => {
    const src = 'const t = $`hello`;';
    assert.equal(transform(src), src);
  });

  it('handles whitespace around operators consistently', () => {
    assert.equal(transform('let t=$௧+$௨;'), 'let t=1+2;');
    assert.equal(transform('let t = $௧ + $௨ ;'), 'let t = 1 + 2 ;');
    assert.equal(transform('let t = ( $௧ ) ;'), 'let t = ( 1 ) ;');
  });

  it('rejects unexpected unterminated constructs with locations', () => {
    assert.throws(() => transform('const s = "abc;'), /Unterminated string/);
    assert.throws(() => transform('/* abc'), /Unterminated block comment/);
    assert.throws(() => transform('const t = `abc;'), /Unterminated template/);
  });

  it('leaves plain JavaScript byte-identical (regression)', () => {
    const samples = [
      'let x = 1 + 2;\nconsole.log(x);\n',
      'function f(a, b) { return a * b; }\n',
      'const re = /foo(bar)?/i;\n',
      'const t = `hello ${name}!`;\n',
      '// comment\n/* block */\nlet $id = 5;\n',
      'let price = "$100";\n',
    ];
    for (const s of samples) {
      assert.equal(transform(s), s, JSON.stringify(s));
    }
  });
});

describe('dotted reserved-word names keep division semantics', () => {
  const { execFileSync } = require('node:child_process');

  // Run transformed output in a fresh Node process so the assertions check
  // actual runtime semantics, not just that the transformer did not throw.
  function runNode(code) {
    return execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' }).trim();
  }

  it('divides by a dotted reserved-word property name (regression)', () => {
    // Before the markWord() fix these were misparsed as regex starts and
    // raised "Unterminated regular expression literal".
    const cases = [
      'obj.await / 2',
      'obj.do / 2',
      'obj.in / 2',
      'obj.if / 2',
      'obj.of / 2',
      'obj.as / 2',
      'obj.else / 2',
      'obj.new / 2',
      'obj.delete / 2',
      'obj.void / 2',
      'obj.typeof / 2',
      'obj.throw / 2',
      'obj.return / 2',
      'obj.yield / 2',
    ];
    for (const expr of cases) {
      const name = expr.split('.')[1].split(' ')[0];
      const src = `const obj = { ${name}: 10 };\nlet q = ${expr};`;
      assert.equal(transform(src), src, JSON.stringify(src));
      assert.equal(runNode(transform(src) + '\nconsole.log(q);'), '5', JSON.stringify(expr));
    }
  });

  it('divides by obj.in inside arithmetic (regression)', () => {
    const src = 'const obj = { in: 10 };\nlet q = obj.in / 2 + 1;';
    assert.equal(transform(src), src);
    assert.equal(runNode(transform(src) + '\nconsole.log(q);'), '6');
  });

  it('a later slash cannot turn an earlier division into a regex (regression)', () => {
    // Before the fix the lexer consumed `/ 2; … /` as one regex literal,
    // silently preserving byte-identical output while changing semantics.
    const src = 'let a = { await: 10 };\nlet q = a.await / 2;\nlet r = /ab+c/.test("xabcy");';
    assert.equal(transform(src), src);
    assert.equal(runNode(transform(src) + '\nconsole.log(q, r);'), '5 true');
  });

  it('divides by several dotted reserved-word properties in one expression', () => {
    const src = 'const obj = { do: 3, if: 4, in: 5 };\nlet q = obj.do + obj.if + obj.in;';
    assert.equal(transform(src), src);
    assert.equal(runNode(transform(src) + '\nconsole.log(q);'), '12');
  });

  it('divides after optional chaining and computed access with reserved names', () => {
    const optionalSrc = 'const obj = { do: 10 };\nlet q = obj?.do / 2;';
    assert.equal(transform(optionalSrc), optionalSrc);
    assert.equal(runNode(transform(optionalSrc) + '\nconsole.log(q);'), '5');

    const computedSrc = 'const obj = { do: 10 };\nlet q = obj["do"] / 2;';
    assert.equal(transform(computedSrc), computedSrc);
    assert.equal(runNode(transform(computedSrc) + '\nconsole.log(q);'), '5');
  });

  it('divides by an object-private field named like a keyword', () => {
    const src = [
      'class C {',
      '  #do = 10;',
      '  half() { return this.#do / 2; }',
      '}',
      'console.log(new C().half());',
    ].join('\n');
    assert.equal(transform(src), src);
    assert.equal(runNode(transform(src)), '5');
  });

  it('real regex literals after genuine keywords still work', () => {
    assert.equal(transform('return /re/.test(s);'), 'return /re/.test(s);');
    assert.equal(transform('throw /x/;'), 'throw /x/;');
    assert.equal(transform('else /re/;'), 'else /re/;');
    assert.equal(
      runNode(transform("function test(){ return /re/.test('re'); }\nconsole.log(test());")),
      'true'
    );
    assert.equal(
      runNode(transform("function test(){ return /\\bre\\b/.test('a re b'); }\nconsole.log(test());")),
      'true'
    );
    assert.equal(
      runNode(transform("function test(){ return /\\bre\\b/.test('xreb'); }\nconsole.log(test());")),
      'false'
    );
    assert.equal(
      runNode(transform("function test(){ return /\\bre\\b/.test('re'); }\nconsole.log(test());")),
      'true'
    );
  });

  it('ordinary division and nested expressions stay unchanged', () => {
    const samples = [
      'let q = a / b;',
      'let q = (a) / b;',
      'let q = obj.await / obj.in;',
      'let q = ((a.do + b.if) * c.in) / (d.else + 1);',
    ];
    for (const s of samples) {
      assert.equal(transform(s), s, JSON.stringify(s));
    }
    assert.throws(() => transform('/ 2'), /Unterminated regular expression literal/);
  });
});
