'use strict';
// TamilScript audit probe (part 2): public API numerals, validate/diagnose
// quality (locations with Tamil preceding, caret, colors, exit behavior),
// runtime helpers, module handling, source maps. Deterministic.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const {
  transform, validate, toNumber, toTamilNumerals, parseTamilDecimal, toTamilDecimal,
  transformWithMap, transformWithMeta, transformFile, formatDiagnostic,
  ErrorCodes, அச்சிடு, VERSION,
} = require('../src');
const { சேர், நீளம், எண், சொல் } = require('../src/runtime');
const { inlineSourceMapComment } = require('../src/sourcemap');

let pass = 0;
const failures = [];
function check(name, fn) {
  let result;
  try { result = fn(); }
  catch (err) { failures.push({ name, message: err.message.split('\n', 1)[0].slice(0, 300) }); return; }
  if (result && typeof result.catch === 'function') {
    result.then(
      () => { pass += 1; },
      (err) => failures.push({ name, message: String(err && err.message).split('\n', 1)[0].slice(0, 300) })
    ).then(finishIfPending);
    return;
  }
  pass += 1;
}
let flushed = false;
let asyncDone = 0;
let asyncExpected = 2; // two async checks (transformFile + module tree)
function finishIfPending() {
  asyncDone += 1;
  flushIfReady();
}
function flushIfReady() {
  if (!flushed && asyncDone >= asyncExpected) flush();
}
function flush() {
  flushed = true;
  console.log(`probes-2: PASS=${pass} FAIL=${failures.length}`);
  for (const f of failures) {
    console.log(`  FAIL ${f.name}`);
    console.log(`       ${f.message}`);
  }
  process.exitCode = failures.length ? 1 : 0;
}
function tmpDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tscript-audit-${label}-`));
  return dir;
}
function runNode(code, args) {
  return execFileSync(process.execPath, ['-e', code].concat(args || []), { encoding: 'utf8' }).trim();
}

// ---------------------------------------------------------------------------
// A. Numerals module (toNumber / toTamilNumerals / parseTamilDecimal / toTamilDecimal)
// ---------------------------------------------------------------------------
check('toNumber accepts leading $ and integer strings', () => {
  assert.equal(toNumber('$௧௮'), 18);
  assert.equal(toNumber('௧௮'), 18);
  assert.equal(toNumber('$௦'), 0);
  assert.equal(toNumber('$௦௦௦௭'), 7);
  assert.equal(toNumber('$௨௧'), 21);
  assert.equal(toNumber('$' + toTamilNumerals(9007199254740991)), 9007199254740991);
  assert.throws(() => toNumber('5'), (e) => e.code === ErrorCodes.INVALID_NUMERAL_INPUT);
  assert.throws(() => toNumber('௧.௫'), (e) => e.code === ErrorCodes.INVALID_NUMERAL_INPUT);
  assert.throws(() => toNumber(18), TypeError);
  assert.throws(() => toNumber('௧௨'.repeat(10)), RangeError);
});
check('parseTamilDecimal semantics and refusals', () => {
  assert.equal(parseTamilDecimal('$௧.௫'), 1.5);
  assert.equal(parseTamilDecimal('௧௨.௫'), 12.5);
  assert.equal(parseTamilDecimal('$௦.௧௮'), 0.18);
  for (const bad of ['oids', '௧.', '.௫', '௧.௫.௫', '௧.௫ ']) {
    assert.throws(() => parseTamilDecimal(bad), (e) => e.code === ErrorCodes.INVALID_NUMERAL_INPUT, `"${bad}"`);
  }
  assert.throws(() => parseTamilDecimal('oids', TypeError));
});
check('toTamilNumerals round-trip and refusals', () => {
  for (const n of [0, 1, 7, 9, 10, 18, 2026, 9999999, 9007199254740991]) {
    assert.equal(toNumber('$' + toTamilNumerals(n)), n, `round-trip ${n}`);
  }
  assert.throws(() => toTamilNumerals(-1), RangeError);
  assert.throws(() => toTamilNumerals(1.5), RangeError);
  assert.throws(() => toTamilNumerals(9007199254740992), RangeError);
  assert.throws(() => toTamilNumerals('1'), TypeError);
  assert.throws(() => toTamilNumerals(NaN), RangeError);
});
check('toTamilDecimal round-trip and refusals', () => {
  assert.equal(toTamilDecimal(12.5), '௧௨.௫');
  assert.equal(parseTamilDecimal(toTamilDecimal(12.5)), 12.5);
  assert.equal(toTamilDecimal(0.125), '௦.௧௨௫');
  assert.throws(() => toTamilDecimal(-1), RangeError);
  assert.throws(() => toTamilDecimal(1e21), RangeError); // exponent notation
  assert.throws(() => toTamilDecimal('x'), TypeError);
});

// ---------------------------------------------------------------------------
// B. Diagnostics quality
// ---------------------------------------------------------------------------
function validateHelper(src, opts) {
  try { return validate(src, opts); } catch (err) { return { ok: false, err }; }
}
function diag(src) {
  try { transform(src); return null; }
  catch (err) { return err; }
}
check('diagnostic location with Tamil before the error', () => {
  const src = 'const பெயர் = "வழக்கமான";\nlet q = $௧.5;\n';
  let err;
  try { transform(src); } catch (e) { err = e; }
  assert.ok(err, 'expected a transform error');
  assert.equal(err.line, 2, `line ${err.line}`);
  assert.equal(err.column, 9, `column ${err.column}`);
});
check('diagnostic caret in formatted output', () => {
  const src = 'let x = $௧;\nlet y = $௧க; // error here\n';
  let err;
  try { transform(src); } catch (e) { err = e; }
  assert.ok(err);
  const f = formatDiagnostic(err, { source: src, maxWidth: 120 });
  const lines = f.split('\n');
  assert.ok(lines.some((l) => /\^/.test(l)), `caret line missing: ${f}`);
  // The source option must not change the diagnostic text (no ANSI codes).
  assert.ok(!f.includes('\u001b['), 'no ANSI codes');
  const f2 = formatDiagnostic(err, {});
  assert.ok(!f2.includes('^'), 'no caret without source');
});
check('validate() returns structured result for bad JS output', () => {
  const v = validate('const என்றால் = 1;', { tamilKeywords: true });
  assert.equal(v.ok, false);
  const v2 = validate('let q = $௧;', {});
  assert.equal(v2.ok, true);
  const v3 = validate('let q = $௧5;', {});
  assert.equal(v3.ok, false);
});
check('no internal stack leakage in validate result', () => {
  const v = validate('let q = $௧.5;', {});
  assert.ok(!('stack' in v) || typeof v.stack !== 'string' || v.stack.length === 0 ? !(v.errorMessage && v.errorMessage.includes('at Scanner')) : true, JSON.stringify(Object.keys(v)));
});

// ---------------------------------------------------------------------------
// C. Runtime helpers
// ---------------------------------------------------------------------------
check('அச்சிடு formatting parity with console.log (no color codes)', () => {
  const snippets = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { snippets.push(String(chunk)); return true; };
  try {
    அச்சிடு('x', 1, { a: [1] });
    அச்சிடு('n=%d', 5);
    அச்சிடு();
  } finally {
    process.stdout.write = origWrite;
  }
  const out = snippets.join('');
  assert.ok(!out.includes('\u001b['), 'no ANSI escapes');
});
check('சேர் positive and negative', () => {
  const a = [1]; assert.equal(சேர்(a, 2, 3), a); assert.deepEqual([...a], [1, 2, 3]);
  const s = new Set(); assert.equal(சேர்(s, 'x'), s); assert.ok(s.has('x'));
  assert.throws(() => சேர்('str', 1), TypeError);
  assert.throws(() => சேர்(null, 1), TypeError);
});
check('நீளம் positive and negative', () => {
  assert.equal(நீளம்('தமிழ்'), 5);
  assert.equal(நீளம்([1, 2]), 2);
  assert.equal(நீளம்(new Set([1, 'a'])), 2);
  assert.equal(நீளம்(new Map([['a', 1]])), 1);
  assert.equal(நீளம்({ length: 7 }), 7);
  assert.throws(() => நீளம்(null), TypeError);
  assert.throws(() => நீளம்(42), TypeError);
});
check('எண் Tamil coercion and passthrough', () => {
  assert.equal(எண்('$௧௮'), 18);
  assert.equal(எண்('௨.௫'), 2.5);
  assert.equal(எண்('42'), 42);
  assert.ok(Number.isNaN(எண்('42px'))); // Number coercion is binary
  assert.equal(எண்(true), 1);
  assert.equal(எண்(null), 0);
  assert.equal(எண்('௧.௨'), 1.2); // accept Tamil decimals
});
check('சொல் passthrough', () => {
  assert.equal(சொல்(123), '123');
  assert.equal(சொல்('தமிழ்'), 'தமிழ்');
  assert.equal(சொல்({ x: 1 }), '[object Object]');
});
check('runtime helpers have no global side effects', () => {
  delete globalThis.அச்சிடு;
  delete globalThis.சேர்;
  delete globalThis.நீளம்;
  delete globalThis.எண்;
  delete globalThis.சொல்;
  require('..\\src\\runtime'); // eslint-disable-line
  assert.ok(!('அச்சிடு' in globalThis), 'no global அச்சிடு injection');
});

// ---------------------------------------------------------------------------
// D. Module handling (imports.js) via node CLI on disk
// ---------------------------------------------------------------------------
check('module handling: relative import transforms and runs', () => {
  const projectDir = tmpDir('mod');
  fs.writeFileSync(path.join(projectDir, 'util.ot.js'), 'export function double(x) { return x * $௨; }\n');
  fs.writeFileSync(path.join(projectDir, 'main.ot.js'), 'import { double } from "./util.ot.js";\nconsole.log(double($௫));\n');
  const { buildTransformedTree, cleanupTempFiles } = require('../src/imports');
  const entryCode = transform(fs.readFileSync(path.join(projectDir, 'main.ot.js'), 'utf8'));
  return buildTransformedTree(path.join(projectDir, 'main.ot.js'), entryCode, {}).then((tree) => {
    assert.ok(tree && tree.entryTemp && Array.isArray(tree.tempFiles), 'tree shape');
    const mainCode = fs.readFileSync(tree.entryTemp, 'utf8');
    assert.equal(/\bdouble\b/.test(mainCode), true, `transformed main keeps double: ${mainCode}`);
    assert.ok(!/\$௫/.test(mainCode), 'numeral transformed in main');
    assert.ok(tree.tempFiles.length >= 1, 'imported module temp file exists');
    const utilOut = fs.readFileSync(tree.tempFiles[tree.tempFiles.length - 1], 'utf8');
    assert.ok(!/\$௨/.test(utilOut), 'numeral transformed in imported module');
    return cleanupTempFiles(tree.tempFiles);
  }).finally(() => fs.rmSync(projectDir, { recursive: true, force: true }));
});

check('module handling: missing import diagnosed or noted', () => {
  const projectDir = tmpDir('mod-missing');
  fs.writeFileSync(path.join(projectDir, 'main.ot.js'), 'import x from "./nope.ot.js";\nconsole.log(x);\n');
  const { buildTransformedTree } = require('../src/imports');
  const entryCode = transform(fs.readFileSync(path.join(projectDir, 'main.ot.js'), 'utf8'));
  return buildTransformedTree(path.join(projectDir, 'main.ot.js'), entryCode, {}).then(
    (tree) => {
      console.log(`      note: missing module transformed without error (entryTemp=${tree.entryTemp}, temps=${tree.tempFiles.length})`);
      return cleanupTempFilesReq(tree.tempFiles);
    },
    (err) => {
      assert.ok(/ENOENT|no such|not found|Cannot|not registered/i.test(err.message) || err.code === 'JST_READ_ERROR', `got: ${err.code} ${err.message}`);
    }
  ).finally(() => fs.rmSync(projectDir, { recursive: true, force: true }));
});

function cleanupTempFilesReq(files) {
  return require('../src/imports').cleanupTempFiles(files || []);
}

// ---------------------------------------------------------------------------
// E. Source maps via transformWithMap
// ---------------------------------------------------------------------------
check('transformWithMap maps numerals and lines', () => {
  const src = 'let q = $௧௮;\nlet w = $௨.௫;\n';
  const wm = transformWithMap(src);
  assert.ok(wm.map && typeof wm.map.mappings === 'string');
  assert.ok(wm.map.sources.length === 1 && wm.map.sources[0] === '');
  const wm2 = transformWithMap(src, { filename: 'a.ot.js' });
  assert.equal(wm2.map.sources[0], 'a.ot.js');
});

// ---------------------------------------------------------------------------
// F. transformFile / transformWithMeta / inlineSourceMapComment
// ---------------------------------------------------------------------------
check('transformFile basic + atomic write', () => {
  const dir = tmpDir('file');
  const file = path.join(dir, 'a.ot.js');
  const out = path.join(dir, 'a.js');
  fs.writeFileSync(file, 'let q = $௧;\n');
  return require('../src/transform-file').transformFile(file, out, {}).then(() => {
    assert.equal(fs.readFileSync(out, 'utf8'), 'let q = 1;\n');
  }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
});
check('transformWithMeta events', () => {
  const m = transformWithMeta('let q = $௧௮ + $௧.௫; const a = [$௧..$௩];', {});
  assert.deepEqual(
    m.events.map((e) => e.type),
    ['number', 'decimal', 'range']
  );
});
check('inlineSourceMapComment', () => {
  const wm = transformWithMap('let q = $௧;', {});
  const comment = inlineSourceMapComment(wm.map);
  assert.ok(comment.includes('sourceMappingURL=data:application/json;'));
});

// ---------------------------------------------------------------------------
// G. VERSION
// ---------------------------------------------------------------------------
check('VERSION is exported and matches package.json', () => {
  assert.equal(VERSION, require('../package.json').version);
});

console.log(`probes-2: PASS=${pass} FAIL=${failures.length}`);
for (const f of failures) {
  console.log(`  FAIL ${f.name}`);
  console.log(`       ${f.message}`);
}
process.exitCode = failures.length ? 1 : 0;
