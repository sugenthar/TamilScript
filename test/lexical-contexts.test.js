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
