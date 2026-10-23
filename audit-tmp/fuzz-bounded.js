'use strict';
// TamilScript audit probe (part 4): bounded differential fuzzing.
//
// Strategy:
//  1. Generate random TamilScript programs from a fixed grammar with a
//     deterministic seed (LCG). Programs are (a) pure JS passthrough (any
//     difference from input = bug) and (b) TamilScript mixtures (semantics
//     compared against an equivalent JS oracle).
//  2. Transform, then EITHER parse-check the output with the project's
//     validate() OR execute both oracle and transformed program with `node`
//     and compare printed values.
//  3. Also generate malformed inputs and assert every transform error has a
//     code and message (no internal crashes).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { transform, validate } = require('../src');

let seed = 0x2f6e2b1; // fixed seed for reproducibility
function rnd(n) {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
}
const D = ['௦', '௧', '௨', '௩', '௪', '௫', '௬', '௭', '௮', '௯'];

function tamilNumber(n) {
  return '$' + String(n).split('').map((d) => D[Number(d)]).join('');
}
function tamilNumberPrecise(n) {
  return '$' + String(n).split('').map((d) => D[Number(d)]).join('');
}

// Random JS passthrough candidates (must survive byte-identically).
const PASS_SNIPPETS = [
  () => `const v${rnd(100)} = ${'a'.repeat(rnd(5) + 1)} / ${rNd(1) + rnd(9) + 1};`,
  () => `/* comment ${rnd(999)} */ let x = ${rnd(50)} + 2.5 * ${rnd(9)};`,
  () => `let s = "தமிழ் ${rnd(99)} ${'$'.repeat(0)}text"; // trailing`,
  () => `if (true) { ${rnd(9)}; } else { /re${rnd(9)}/.test("r"); }`,
  () => `class C${rnd(20)} { get #p() { return ${rnd(3)}; } }`,
  () => 'for (const i of [1, 2, 3]) { throw `t${i}`.length ? 0 : new Set(); }',
  () => `let deep = [${Array.from({ length: 6 }, () => rnd(9)).join(', ')}].map(v => v * ${rnd(3)});`,
];
function rNd(_m) { return rnd(_m); }

// Grammar-built mixed TamilScript programs with JS oracle equivalents.
function genMixedPair() {
  const a = rnd(40), b = rnd(40) + a, c = rnd(9) + 1;
  const spread = Array.from({ length: b - a + 1 }, (_, i) => a + i).join(',');
  const forms = [
    () => ({
      src: `let q = ${tamilNumber(a)} + ${tamilNumber(b)};`,
      js: `let q = ${a} + ${b};`,
    }),
    // NOTE: [$a..$b] is an ARRAY containing a range (length 1); use the
    // parenthesized form for range length semantics.
    () => ({
      src: `let q = (${tamilNumber(a)}..${tamilNumber(b)}).length;`,
      js: `let q = [${spread}].length;`,
    }),
    () => ({
      src: `let q = ${tamilNumber(a * 10 + c)} / ${tamilNumber(c)};`,
      js: `let q = ${a * 10 + c} / ${c};`,
    }),
    // Numerals inside template TEXT are preserved verbatim; only
    // interpolations are executable. Compare text-preservation, not
    // transformation:
    () => ({
      src: `let q = ${JSON.stringify(`t${a}y${b}z`)}.length;`,
      js: `let q = ${JSON.stringify(`t${a}y${b}z`)}.length;`,
    }),
    () => ({
      src: `let q = \`x\${${tamilNumber(a)}}y\`.length;`,
      js: `let q = \`x\${${a}}y\`.length;`,
    }),
    () => ({
      src: `let q = (${tamilNumber(a)}..${tamilNumber(b)}).reduce((s, v) => s + v, ${tamilNumber(0)});`,
      js: `let q = [${spread}].reduce((s, v) => s + v, 0);`,
    }),
  ];
  return forms[rnd(forms.length)]();
}

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass += 1; }
  catch (err) { failures.push({ name, message: err.message.split('\n', 1)[0].slice(0, 300) }); }
}

// 1. Passthrough: transform(x) must equal x byte-for-byte.
for (let i = 0; i < 400; i++) {
  const s = PASS_SNIPPETS[rnd(PASS_SNIPPETS.length)]();
  check(`passthrough #${i}: ${s.slice(0, 60)}`, () => {
    const out = transform(s);
    if (out !== s) {
      throw new Error(`passthrough changed:\n  in : ${JSON.stringify(s)}\n  out: ${JSON.stringify(out)}`);
    }
  });
}

// 2. Mixed semantics: transformed program must print the oracle's value.
function evalBoth(src, js) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-fuzz-'));
  const base = path.join(dir, 'p');
  const run = (code) =>
    execFileSync(process.execPath, ['-e', `${code}\nconsole.log('OUT:' + String(q));`], {
      encoding: 'utf8',
    }).split('\n').find((l) => l.startsWith('OUT:'));
  try {
    const outSrc = run(transform(src));
    const outJs = run(js);
    if (outSrc !== outJs) {
      throw new Error(`oracle mismatch:\n  js  (${js}) -> ${outJs}\n  ts  (${src}) -> ${outSrc}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
for (let i = 0; i < 200; i++) {
  const pair = genMixedPair();
  check(`mixed #${i}: ${pair.src.slice(0, 60)}`, () => evalBoth(pair.src, pair.js));
}

// 3. Every transform() error on random malformed input has code+message.
const MALFORMED = [
  () => `let x = $${D[rnd(10)]}.5;`,
  () => `let x = $${D[rnd(10)]}n;`,
  () => `let x = 1$${D[rnd(10)]};`,
  () => `let x = $${D[rnd(10)]}abc;`,
  () => `let x = $${D[rnd(10)]}..$${D[rnd(10)]}; // descending forced? dependent`,
  () => `let x = "${'"'.repeat(1)}`,
  () => `let x = ${'{'.repeat(rnd(4) + 1)}`,
  () => `let x = /unterminated[`,
  () => `let x = \`${rnd(9)}\${${rnd(9)}`,
  () => `let x = செயல்;`,
];
for (let i = 0; i < 150; i++) {
  const s = MALFORMED[rnd(MALFORMED.length)]();
  check(`malformed #${i}: graceful failure for ${s.slice(0, 40)}`, () => {
    try {
      const out = transform(s);
      // Passthrough of plain-JS-invalid input is acceptable as long as
      // validate() reports it structurally (ok:false + diagnostic).
      let v;
      try { v = validate(out); } catch (verr) { throw new Error(`validate() threw after transform succeeded: ${verr}`); }
      if (v.ok === false) {
        assert.ok(v.diagnostic && typeof v.diagnostic.line === 'number' && typeof v.diagnostic.column === 'number', `bad diagnostic shape: ${JSON.stringify(v)}`);
      }
    } catch (err) {
      assert.ok(err.code && err.message, `uncoded error for ${JSON.stringify(s)}: ${err}`);
    }
  });
}

console.log(`fuzz: PASS=${pass} FAIL=${failures.length}`);
for (const f of failures.slice(0, 12)) {
  console.log(`  FAIL ${f.name}`);
  console.log(`       ${f.message}`);
}
if (failures.length > 12) console.log(`  ... and ${failures.length - 12} more`);
process.exitCode = failures.length ? 1 : 0;
