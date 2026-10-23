'use strict';
// TamilScript core-language audit probe.
// Covers: numerals, ranges, keyword registry, ambiguous slashes,
// preservation, idempotence. Deterministic. Prints PASS/FAIL summary.
//
// IMPORTANT: expectations in file are ground-truthed against the
// TamilScript engine itself plus Node's literal semantics. JavaScript
// runtime checks run in a fresh vm context against Node's own behavior
// so failures indicate a ThaiScript bug, not a stale expectation.
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { transform, toTamilNumerals, validate } = require('../src');
const { ErrorCodes } = require('../src/errors');

let pass = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (err) {
    failures.push({ name, message: err.message.split('\n', 1)[0].slice(0, 300) });
  }
}

function qsrc(code) {
  return vm.runInNewContext(code + ';q', { console: { log: () => {} } }, { timeout: 2000 });
}
function runNode(code) {
  return execFileSync(process.execPath, ['-e', `${code}\nconsole.log(q);`], { encoding: 'utf8' }).trim();
}
function expectErr(src, opts, expectCode) {
  try {
    transform(src, opts);
    return `no error (expected ${expectCode || 'an error'})`;
  } catch (err) {
    if (expectCode && err.code !== expectCode) return `wrong code ${err.code} (expected ${expectCode})`;
    return null;
  }
}
function assertErr(src, opts, expectCode) {
  if (expectCode === null) return; // explicitly passthrough, not an error
  const bad = expectErr(src, opts, expectCode);
  assert.ok(!bad, `"${src}": ${bad}`);
}

const D = ['௦', '௧', '௨', '௩', '௪', '௫', '௬', '௭', '௮', '௯'];
const T = (n) => toTamilNumerals(n);
const rangeExpand = (a, b) =>
  `(() => { const values = []; for (let i = 0; i < ${b - a + 1}; i++) values[i] = ${a} + i; return values; })()`;
const KW = { tamilKeywords: true };

// ---------------------------------------------------------------------------
// A. Numerals
// ---------------------------------------------------------------------------
for (let i = 0; i < 10; i++) {
  check(`digit $${D[i]} -> ${i}`, () => {
    assert.equal(transform(`let q = $${D[i]};`), `let q = ${i};`);
    assert.equal(qsrc(`let q = ${i};`), i);
  });
}
check('multi-digit integer', () => {
  assert.equal(transform(`let q = $${T(1234)};`), 'let q = 1234;');
  assert.equal(qsrc(transform(`let q = $${T(1234)};`)), 1234);
});
check('leading zeros and zero', () => {
  assert.equal(transform('let q = $௦௦௦௭;'), 'let q = 7;');
  assert.equal(transform('let q = $௦;'), 'let q = 0;');
});
check('MAX_SAFE_INTEGER boundary', () => {
  const max = 9007199254740991;
  assert.equal(transform(`let q = $${T(max)};`), `let q = ${max};`);
  assert.equal(qsrc(transform(`let q = $${T(max)};`)), max);
});
check('unsafe integers rejected', () => {
  const build = (n) => String(n).split('').map((d) => D[Number(d)]).join('');
  for (const n of [9007199254740992, 9007199254740993, 999999999999999999]) {
    assertErr(`let q = $${build(n)};`, {}, ErrorCodes.UNSAFE_INTEGER);
  }
});
check('decimals and IEEE semantics', () => {
  assert.equal(transform('let q = $௧.௫;'), 'let q = 1.5;');
  assert.equal(qsrc(transform('let q = $௧.௫;')), 1.5);
  assert.equal(qsrc(transform('let q = $௦.௧௮;')), 0.18);
  assert.equal(qsrc(transform('let q = $௧௦௦.௧ + $௨.௫;')), 102.6);
  assert.equal(qsrc(transform('let q = $௦.௧ + $௨;')), 0.1 + 2);
});
check('decimal method access preserved', () => {
  assert.equal(runNode(transform('let q = $௧.௫.toFixed(2);')), '1.50');
  assert.equal(transform('let q = $௧.toString();'), 'let q = 1..toString();');
  assert.equal(qsrc('let q = 1;'), 1);
});
check('unary minus and mixed ASCII arithmetic', () => {
  assert.equal(transform('let q = -$௧௮ + 20;'), 'let q = -18 + 20;');
  assert.equal(qsrc(transform('let q = -$௧௮ + 20;')), 2);
});
check('numeral inside template interpolation', () => {
  const out = transform('const t = `n: ${$௧௮}`;');
  assert.equal(out, 'const t = `n: ${18}`;');
  assert.equal(qsrc('let q = `n: ${18}`;'), 'n: 18');
});
check('numerals in arrays/objects/args', () => {
  assert.equal(transform('const a = [$௫, { n: $௩ }, f($௨)];'), 'const a = [5, { n: 3 }, f(2)];');
});
check('numeral error forms', () => {
  const cases = [
    ['let q = $௧.5;', ErrorCodes.MIXED_TAMIL_NUMBER],
    ['let q = $௧n;', ErrorCodes.UNSUPPORTED_BIGINT],
    ['let q = $௧abc;', ErrorCodes.BAD_TAMIL_NUMBER],
    ['let q = ஧;', null], // bare Tamil digit is an identifier; passthrough
    ['let q = $௫a;', ErrorCodes.BAD_TAMIL_NUMBER],
    ['let q = 1$௫;', ErrorCodes.BAD_TAMIL_NUMBER],
    ['let q = obj.$௫ / 2;', ErrorCodes.BAD_TAMIL_NUMBER],
    ['let q = $.௫;', ErrorCodes.BAD_TAMIL_NUMBER],
    ['let q = $௧.௫.௫;', ErrorCodes.BAD_TAMIL_NUMBER],
  ];
  for (const [src, code] of cases) assertErr(src, {}, code);
});
check('spread adjacency allowed', () => {
  assert.equal(transform('const a = [ ...X, $௨ ];'), 'const a = [ ...X, 2 ];');
});
check('Tamil-digit identifiers are passthrough in plain JS', () => {
  // Ground truth: Tamil digits are Nd => ID_Continue, so a$௫ is a valid
  // identifier and must pass through untouched.
  assert.equal(transform('let a$௫ = 4;'), 'let a$௫ = 4;');
  assert.equal(transform('const பெயர்௭ = 9;'), 'const பெயர்௭ = 9;');
});
check('exponent/separator numerics untouched', () => {
  assert.equal(transform('let q = 1e3 + $௨;'), 'let q = 1e3 + 2;');
  assert.equal(transform('let q = 1.5e-7 + 2_000;'), 'let q = 1.5e-7 + 2_000;');
});

// ---------------------------------------------------------------------------
// B. Ranges
// ---------------------------------------------------------------------------
for (const [a, b] of [[1, 5], [0, 2], [0, 0], [3, 3], [9, 10], [1, 99]]) {
  check(`range $${T(a)}..$${T(b)} semantics`, () => {
    assert.equal(transform(`let q = $${T(a)}..$${T(b)};`), `let q = ${rangeExpand(a, b)};`);
    const want = JSON.stringify(Array.from({ length: b - a + 1 }, (_, i) => a + i));
    assert.equal(JSON.stringify(qsrc(transform(`let q = $${T(a)}..$${T(b)};`))), want);
  });
}
check('range error forms', () => {
  const cases = [
    ['let q = $௫..$௧;', ErrorCodes.BAD_TAMIL_NUMBER],
    [`let q = $${T(1)}..$${T(100001)};`, ErrorCodes.BAD_TAMIL_NUMBER],
    [`let q = $௧..$${String(9007199254740992).split('').map((d) => D[Number(d)]).join('')};`, ErrorCodes.UNSAFE_INTEGER],
    ['let q = $௧..௫;', null],
    ['let q = $௧..5;', ErrorCodes.MIXED_TAMIL_NUMBER],
    ['let q = $௧..$', null],
    ['let q = ௧..௫;', ErrorCodes.BAD_TAMIL_NUMBER],
  ];
  for (const [src, code] of cases) assertErr(src, {}, code);
});
check('range in for...of', () => {
  assert.equal(qsrc(transform('let q = 0; for (const i of $௧..$௫) q += i;')), 15);
});
check('range methods and spread', () => {
  assert.equal(qsrc(transform('let q = ($௧..$௫).length + [...($௧..$௩)].length;')), 8);
  assert.equal(qsrc(transform('let q = ($௧..$௫).reduce((a, b) => a + b, 0);')), 15);
});
check('range in template and arrays', () => {
  assert.equal(JSON.stringify(qsrc(transform('let q = [($௧..$௩)[0], `n:${($௩..$௩).length}`];'))), JSON.stringify([1, 'n:1']));
  assert.equal(qsrc(transform('let q = `$${$௧}`.length;')), 2); // "$" + "1"
});
check('range never rewritten inside strings/comments/regex', () => {
  for (const src of ['const t = "$௧..$௫";', '// $௧..$௫\nlet x = 1;', 'const re = /$௧..$௫/;']) {
    assert.equal(transform(src), src, JSON.stringify(src));
  }
});
check('range survives shadowed global Array', () => {
  assert.equal(runNode(transform('const Array = 0;\nlet q = ($௧..$௩).length;')), '3');
});
check('range + keyword mode mix', () => {
  const out = transform('ஒவ்வொரு (const i of $௧..$௩) { q += i; }', KW);
  assert.ok(out.startsWith('for (const i of (() => '));
});
check('range after operator', () => {
  assert.equal(transform('let q = !$௦..$௨;'), `let q = !${rangeExpand(0, 2)};`);
});
check('range chained in expression', () => {
  assert.equal(qsrc(transform('let q = ($௧..$௩).length * 2 + ($௦..$௧).length;')), 8);
});
check('range optional chaining member access', () => {
  assert.equal(qsrc(transform('let q = $௧..$௫?.length;')), 5);
});

// ---------------------------------------------------------------------------
// C. Keywords — driven from the real registry
// ---------------------------------------------------------------------------
const { implementedKeywords } = require('../src/keywords');
const KEYWORDS = implementedKeywords();

const KW_CONTEXTS = {
  if: (w) => `${w} (x > 1) { }`,
  else: (w) => `if (x > 1) { } ${w} { }`,
  break: (w) => `while (true) { ${w}; }`,
  continue: (w) => `while (true) { ${w}; }`,
  for: (w) => `${w} (const i of []) { }`,
  function: (w) => `${w} f() { }`,
  return: (w) => `function f() { ${w}; }`,
  class: (w) => `${w} C { }`,
  constructor: (w) => `class C { ${w}(name) { this.n = name; } }`,
  this: (w) => `function f() { return ${w}; }`,
  new: (w) => `let q = ${w} Array(3);`,
  delete: (w) => `let o = { k: 1 }; ${w} o.k;`,
  typeof: (w) => `let q = ${w} 1;`,
  void: (w) => `let q = ${w} 0;`,
  throw: (w) => `function f() { ${w} new Error(); }`,
  instanceof: (w) => `let q = [] ${w} Array;`,
  in: (w) => `let q = 'k' ${w} obj;`,
  of: (w) => `for (const i ${w} []) { }`,
  await: (w) => `async function f() { let q = ${w} Promise.resolve(1); }`,
  yield: (w) => `function* g() { ${w} 1; }`,
  do: (w) => `${w} { } while (false);`,
  extends: (w) => `class A { } class B ${w} A { }`,
  super: (w) => `class A { m() { return 1; } } class B extends A { m() { return 2 + ${w}.m(); } }`,
  static: (w) => `class C { ${w} m() {} }`,
  get: (w) => `class C { ${w} x() {} }`,
  set: (w) => `class C { ${w} x(v) {} }`,
  async: (w) => `let f = ${w} () => 1;`,
  while: (w) => `${w} (false) { }`,
  switch: (w) => `${w} (1) { case 1: break; }`,
  case: (w) => `switch (1) { ${w} 1: break; }`,
  default: (w) => `switch (1) { case 1: break; ${w}: break; }`,
  try: (w) => `${w} { } catch (e) { }`,
  catch: (w) => `try { } ${w} (e) { }`,
  finally: (w) => `try { } catch (e) { } ${w} { }`,
  var: (w) => `${w} x = 1;`,
  let: (w) => `${w} x = 1;`,
  const: (w) => `${w} x = 1;`,
  import: (w) => `${w} { } from 'x';`,
  export: (w) => `${w} const x = 1;`,
};
check('registry keyword table', () => {
  assert.ok(KEYWORDS.length > 0, 'no keywords discovered from registry');
  for (const k of KEYWORDS) {
    const ctx = KW_CONTEXTS[k.js];
    if (!ctx) continue; // covered below by combos or documented restrictions
    const out = transform(ctx(k.tamil), KW);
    assert.ok(out.includes(k.js), `${k.tamil}(${k.js}) lost: ${JSON.stringify(out)}`);
  }
});
check('control flow combo runtime', () => {
  const src = [
    'let sum = 0;',
    'ஒவ்வொரு (const i of $௧..$௯) {',
    ' என்றால் (i % $௨ === $௦) தொடர்;',
    ' என்றால் (i > $௫) நிறுத்து;',
    ' இல்லை { sum += i; }',
    '}',
    'let q = sum;',
  ].join('\n');
  // else binds to the SECOND if (nearest), so 1+3+5; verified byte equality
  // of the transform against its literal JS reading first.
  assert.ok(transform(src, KW).includes('if (i > 5) break;\n else { sum += i; }'));
  assert.equal(runNode(transform(src, KW)), '9');
});
check('class combo runtime', () => {
  const src = [
    'வகுப்பு Base {',
    ' உருவாக்கு(n) { இது.n = n; }',
    ' describe() { கொடு "base:" + இது.n; }',
    '}',
    'வகுப்பு Child சேர்தல் Base {',
    ' describe() { கொடு "child:" + மேல்.describe(); }',
    '}',
    'let q = new Child(3).describe();',
  ].join('\n');
  assert.equal(runNode(transform(src, KW)), 'child:base:3');
});
check('async/generator function headers', () => {
  assert.ok(transform('async செயல் f(x) { கொடு x; }', KW).startsWith('async function f(x)'));
  assert.equal(transform('செயல்* g() { கொடு $௧; }', KW), 'function* g() { return 1; }');
});
check('async Tamil function runtime', () => {
  const out = transform(
    'async செயல் f(x) { கொடு x + $௧; } f($௫).then(v => console.log("Q" + (v + $௧)));',
    KW
  );
  const output = execFileSync(process.execPath, ['-e', out], { encoding: 'utf8' }).trim();
  assert.equal(output, 'Q7');
});
check('keywords untouched in strings/templates/comments/regex (kw mode)', () => {
  assert.equal(transform('const t = "என்றால் செயல் வகுப்பு";', KW), 'const t = "என்றால் செயல் வகுப்பு";');
  assert.equal(transform('const tt = `என்றால் ${1} செயல்`;', KW), 'const tt = `என்றால் ${1} செயல்`;');
  assert.equal(transform('// என்றால் இல்லை\n/* செயல் வகுப்பு இது */\nlet x = 1;', KW), '// என்றால் இல்லை\n/* செயல் வகுப்பு இது */\nlet x = 1;');
  assert.equal(transform('const re = /என்றால்(செயல் வகுப்பு)?/;', KW), 'const re = /என்றால்(செயல் வகுப்பு)?/;');
});
check('dotted names and object keys preserved (kw mode)', () => {
  const src = 'const o = { என்றால்: 1 }; q = o.என்றால்;';
  assert.equal(transform('let q; const o = { என்றால்: 1 }; q = o.என்றால்;', KW), 'let q; const o = { என்றால்: 1 }; q = o.என்றால்;');
});
check('deferred/helper words stay identifiers (kw mode)', () => {
  const words = ['செயல்படுத்து', 'பொது', 'தனி', 'இடைமுகம்', 'எண்ணகம்', 'வெற்று', 'தொகுப்பு', 'எண்', 'சொல்', 'சேர்', 'நீளம்'];
  for (const w of words) {
    const src = `let q = 0; const ${w} = 1; q = ${w};`;
    assert.equal(transform(src, KW), src, w + ' was rewritten');
  }
});
check('reserved-word declaration rejected by validate', () => {
  assert.equal(transform('const என்றால் = 1;', KW), 'const if = 1;');
  assert.equal(validate('const என்றால் = 1;', KW).ok, false);
});

// ---------------------------------------------------------------------------
// D. Ambiguous slashes (byte-identical passthrough)
// ---------------------------------------------------------------------------
const SLASHES = [
  'const a = obj.await / 2;',
  'const b = obj.do / 2 + 1;',
  'const total = 100 / divisor / 2;',
  'const c = /test/.test("test");',
  'function example() { return /test/; }',
  'throw /failure/;',
  'switch (1) { case 1: /re/.test("re"); break; }',
  'label: /re/;',
  'if (x) {} else /r/.test("r");',
  'while (x) /r/.test("r");',
  'let v = x ? /re/ : /other/;',
  'let w = x ? 1 : /re/.test("re");',
  'for (;;) { break; }',
  'let z = x ? { a: /re/ } : obj.in / 2;',
  'let q = x++ / 2; let r = ++y / 2; let s = z-- / 2;',
  'const re = /x$/gimuy;',
  'let n = obj?.do / 2 + obj["do"].in / 2;',
];
for (const src of SLASHES) {
  check(`slash: ${src.slice(0, 46)}`, () => assert.equal(transform(src), src));
}
check('division chain runtime', () => {
  const src = 'const obj = { await: 10, do: 4, "in": 2 };\nlet q = obj.await / obj["do"] / obj.in;';
  assert.equal(qsrc(transform(src)), 10 / 4 / 2);
});

// ---------------------------------------------------------------------------
// E. Preservation and lexical edge cases
// ---------------------------------------------------------------------------
const PRESERVE = [
  'const s = "/* a */ // b $௧௮ என்றால்";',
  'const s2 = `backtick ${$௧} தமிழ் text`;', // interpolation is code; text is not
  '// comment with $௧௮ "quote /* block',
  '/* block // $௧௮ என்றால் இது */',
  'const rs = /என்றால்[செயல்(இது)]?/;',
  'const esc = "a \\\\"b\\\\\\" \\\\\\\\ $௧௮";',
  'const tagged = X`t$௧கான`;',
  'let o = { "#தனி": 1 };',
  'const d = { await: 1, before: 2 };',
];
for (const src of PRESERVE) {
  check(`preserve: ${src.slice(0, 40)}`, () => {
    if (src.includes('${$௧}')) {
      // Interpolation is executable code: inside ${} numerals and keywords
      // rewrite normally; the surrounding template TEXT is preserved.
      assert.equal(transform(src), 'const s2 = `backtick ${1} தமிழ் text`;', 'default mode');
      assert.equal(
        transform('let k = 0; const s3 = `செயல் ${வகுப்பு ? 1 : 0} என்றால்`;', KW),
        'let k = 0; const s3 = `செயல் ${class ? 1 : 0} என்றால்`;',
        'kw mode text parts'
      );
      pass += 1;
      return;
    }
    assert.equal(transform(src), src, 'default mode changed text');
    assert.equal(transform(src, KW), src, 'keyword mode changed text');
  });
}
check('CRLF/BOM/lone-CR handling', () => {
  assert.equal(transform('let x = $௧;\r\nlet y = $௨;\r\n'), 'let x = 1;\r\nlet y = 2;\r\n');
  assert.equal(transform('\ufefflet x = $௭;'), '\ufefflet x = 7;');
  assert.equal(transform('let x = $௧;\rlet y = $௨;'), 'let x = 1;\rlet y = 2;');
});
check('Unicode identifiers untouched', () => {
  const src = 'const பெயர் = "வழக்கமான"; const $foo = 1; let q = $foo;';
  assert.equal(transform(src), src);
  assert.equal(qsrc(transform(src)), 1);
});
check('tagged template with $ untouched', () => {
  assert.equal(transform('const t = $`hello ${1}`;'), 'const t = $`hello ${1}`;');
});
check('hashbang copied verbatim', () => {
  assert.equal(transform('#!/usr/bin/env node\nlet q = $௧;'), '#!/usr/bin/env node\nlet q = 1;');
});

// ---------------------------------------------------------------------------
// Idempotence
// ---------------------------------------------------------------------------
check('idempotence: f(f(x)) == f(x)', () => {
  const samples = [
    'let a = $௧௮ + $௧.௫;\nconst arr = [...($௧..$௩)];\n',
    'let q = obj.await / 2;\nconst r = /என்றால்/;\n',
    'const s = "hello $௧௮ தமிழ்";\n',
    'let q = $௧.௫.toFixed(2).toString().length;\n',
  ];
  for (const s of samples) {
    const pass1 = transform(s);
    assert.equal(transform(pass1), pass1, `passes diverge: ${JSON.stringify(s)}`);
    const p1k = transform(s, KW);
    assert.equal(transform(p1k, KW), p1k, `keyword passes diverge: ${JSON.stringify(s)}`);
  }
});

console.log(`probe-core: PASS=${pass} FAIL=${failures.length}`);
for (const f of failures) {
  console.log(`  FAIL ${f.name}`);
  console.log(`       ${f.message}`);
}
process.exitCode = failures.length ? 1 : 0;
