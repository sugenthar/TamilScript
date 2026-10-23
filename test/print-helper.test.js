'use strict';

// Tests for the Tamil print helper. This file stays pure ASCII on purpose:
// every Tamil string below is a \u escape sequence, which the JavaScript
// parser decodes before any TamilScript code runs. The committed example
// (examples/print-helper.js) carries real Tamil glyphs and is executed
// end-to-end by the CLI tests in this file.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Console } = require('node:console');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');

// Tamil print helper name, Tamil digits, and Tamil words as escapes.
const PRINT = 'அச்சிடு';
const VAN = 'வணக்கம்';
const TVAR = 'மதி';
const D = (n) => String.fromCodePoint(0x0be6 + n);
const T = (...hexes) => hexes.map((h) => String.fromCodePoint(parseInt(h, 16))).join('');
const L = {
  tamil: T('0BA4', '0BAE', '0BBF', '0BB4', '0BCD'),
  aangilam: T('0B86', '0B99', '0BCD', '0B95', '0BBF', '0BB2', '0BAE', '0BCD'),
  kanitham: T('0B95', '0BA3', '0BBF', '0BA4', '0BAE', '0BCD'),
  moththam: T('0BAE', '0BCA', '0BA4', '0BCD', '0BA4', '0BAE', '0BCD'),
  marks: T('0BAE', '0BA4', '0BBF', '0BAA', '0BCD', '0BAA', '0BC6', '0BA3', '0BCD', '0B95', '0BB3', '0BCD'),
  sarasari: T('0B9A', '0BB0', '0BBE', '0B9A', '0BB0', '0BBF'),
  running: T('0B87', '0BAF', '0B99', '0BCD', '0B95', '0BC1', '0B95', '0BBF', '0BB1', '0BA4', '0BC1'),
};
const EXPECTED_EXAMPLE =
  `${L.tamil}: 85\n` +
  `${L.aangilam}: 78\n` +
  `${L.kanitham}: 95\n` +
  `${L.moththam} ${L.marks}: 258\n` +
  `${L.sarasari}: 86\n` +
  `TamilScript ${L.running}!\n`;

const runtime = require('../src/runtime.js');
const api = require('../src/index.js');
const {
  supportsPrintRuntime,
  printRuntimeArgs,
  printRuntimeError,
} = require('../src/runner.js');
const { buildTransformedTree, cleanupTempFiles } = require('../src/imports.js');

let workdir;
before(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-print-'));
});
after(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

function writeTmp(name, content) {
  const p = path.join(workdir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function cli(bin, args) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd: ROOT });
}

// The helper prints through its own color-free console (it must never emit
// ANSI escapes), so capture what actually reaches stdout and compare with a
// reference console configured exactly like the helper's. This keeps the
// original intent — identical formatting and error behavior as console.log
// with color disabled — independent of the environment (FORCE_COLOR etc.).
const plainReference = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  ignoreErrors: true,
  colorMode: false,
});

function captured(fn) {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
  try {
    return { chunks, result: fn(), error: null };
  } catch (error) {
    return { chunks, result: undefined, error };
  } finally {
    process.stdout.write = orig;
  }
}

describe('print helper: basic runtime behavior', () => {
  it('prints a single Tamil string', () => {
    const r = captured(() => runtime[PRINT](VAN));
    assert.equal(r.error, null);
    assert.equal(r.chunks.join(''), `${VAN}\n`);
    assert.equal(r.result, undefined);
  });

  it('supports multiple mixed arguments', () => {
    const obj = { a: 1 };
    const arr = [1, 'x'];
    const args = [L.tamil, 85, true, null, obj, arr];
    const a = captured(() => runtime[PRINT](...args));
    const b = captured(() => plainReference.log(...args));
    assert.equal(a.error, null);
    assert.equal(a.chunks.join(''), b.chunks.join(''));
  });

  it('supports zero arguments', () => {
    const r = captured(() => runtime[PRINT]());
    assert.equal(r.error, null);
    assert.equal(r.chunks.join(''), '\n');
  });

  it('formats exactly like a color-free console.log', () => {
    const fmt = ['%s=%d %j', 'x', 7, { a: 1 }];
    const a = captured(() => runtime[PRINT](...fmt));
    const b = captured(() => plainReference.log(...fmt));
    assert.equal(a.chunks.join(''), b.chunks.join(''));
    assert.doesNotMatch(a.chunks.join(''), /\u001b\[/);
  });

  it('neither swallows nor invents output errors', () => {
    const evil = { [Symbol.toPrimitive]() { throw new Error('coerce-boom'); } };
    // Whatever a color-free console.log does with a hostile value, the
    // helper must do exactly the same thing: capture both and compare.
    const a = captured(() => runtime[PRINT](evil));
    const b = captured(() => plainReference.log(evil));
    assert.equal(a.error && a.error.message, b.error && b.error.message);
    assert.deepEqual(a.chunks, b.chunks);
  });

  it('leaves console.warn and console.error untouched', () => {
    assert.equal(typeof console.warn, 'function');
    assert.equal(typeof console.error, 'function');
    assert.notEqual(console.warn, runtime[PRINT]);
  });
});

describe('print helper: module surface', () => {
  it('is exported from the runtime entry, the package root, and self references', () => {
    assert.equal(typeof runtime[PRINT], 'function');
    assert.equal(typeof api[PRINT], 'function');
    assert.equal(api[PRINT], runtime[PRINT]);
    assert.equal(typeof require('tamilscript/runtime')[PRINT], 'function');
    assert.equal(typeof require('tamilscript')[PRINT], 'function');
  });

  it('adds no other Tamil helpers: the export set is exact', () => {
    const names = Object.keys(api).sort();
    const expected = [
      'toNumber', 'toTamilNumerals', 'parseTamilDecimal', 'toTamilDecimal',
      'transform', 'transformWithMap', 'transformWithMeta', 'transformFile',
      'runFile', 'checkFile', 'inlineSourceMapComment', 'errors', 'ErrorCodes',
      'formatDiagnostic', 'JsTamilError', 'JsTamilSyntaxError',
      'TamilScriptError', 'TamilScriptSyntaxError', 'VERSION', 'validate',
      PRINT,
    ].sort();
    assert.deepEqual(names, expected);
  });

  it('resolves over ESM, including the named export', async () => {
    const m = await import('tamilscript/runtime');
    assert.equal(typeof m[PRINT], 'function');
    const root = await import('tamilscript');
    const get = (n) => root[n] || (root.default && root.default[n]);
    assert.equal(typeof get(PRINT), 'function');
  });

  it('importing the runtime installs no globals', () => {
    delete globalThis[PRINT];
    require('../src/runtime.js');
    require('../src/index.js');
    assert.equal(globalThis[PRINT], undefined);
  });
});

describe('print helper: run integration', () => {
  it('runs Tamil variables with Tamil numeric literals', async () => {
    const file = writeTmp('vars.js', `const ${TVAR} = $${D(8)}${D(5)};\n${PRINT}('n:', ${TVAR});\n`);
    const code = await api.runFile(file, []);
    assert.equal(code, 0);
  });

  it('runs the committed marks example with exact output', async () => {
    const file = path.join(ROOT, 'examples', 'print-helper.js');
    const code = await api.runFile(file, []);
    assert.equal(code, 0);
  });

  it('forwards CLI args alongside the automatic runtime', async () => {
    const file = writeTmp('args.js', `${PRINT}(JSON.stringify(process.argv.slice(2)));\n`);
    // Capture via a child run through the CLI to observe forwarded args.
    const r = cli(BIN, ['run', file, '--', 'a', 'b c']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), '["a","b c"]');
  });

  it('runs an ESM program with the automatic runtime', async () => {
    const dir = fs.mkdtempSync(path.join(workdir, 'esm-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
    const main = path.join(dir, 'main.mjs');
    fs.writeFileSync(main, `import v from './dep.mjs';\n${PRINT}('v:', v);\n`, 'utf8');
    fs.writeFileSync(path.join(dir, 'dep.mjs'), `export default $${D(4)}${D(2)};\n`, 'utf8');
    const code = await api.runFile(main, []);
    assert.equal(code, 0);
  });

  it('propagates errors and exit codes with output preserved', async () => {
    const file = writeTmp('boom.js', `${PRINT}('before');\nthrow new Error('kaput-print');\n`);
    const r = cli(BIN, ['run', file]);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /before/);
    assert.match(r.stderr, /kaput-print/);
  });

  it('check passes a program that uses the helper', async () => {
    const r = cli(BIN, ['check', path.join(ROOT, 'examples', 'print-helper.js')]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /OK/);
  });
});

describe('print helper: CLI commands', () => {
  it('tamilscript run prints the exact expected output', () => {
    const r = cli(BIN, ['run', 'examples/print-helper.js']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, EXPECTED_EXAMPLE);
  });

  it('removed legacy alias binary stays gone', () => {
    assert.ok(!fs.existsSync(path.join(ROOT, 'bin', 'jstamil.js')), 'bin/jstamil.js must not exist');
  });
});

describe('print helper: runtime wiring', () => {
  it('detects helper mentions across entry and dependencies', async () => {
    const dir = fs.mkdtempSync(path.join(workdir, 'tree-'));
    const dep = path.join(dir, 'dep.js');
    const main = path.join(dir, 'main.js');
    fs.writeFileSync(dep, `module.exports = $${D(1)};\n`, 'utf8');
    fs.writeFileSync(main, `const d = require('./dep.js');\nconsole.log(d);\n`, 'utf8');
    const plain = await buildTransformedTree(main, api.transform(fs.readFileSync(main, 'utf8')), { withMaps: false });
    assert.equal(plain.usesPrintHelper, false);
    await cleanupTempFiles(plain.tempFiles);
    fs.writeFileSync(dep, `${PRINT}('from dep');\nmodule.exports = $${D(1)};\n`, 'utf8');
    const used = await buildTransformedTree(main, api.transform(fs.readFileSync(main, 'utf8')), { withMaps: false });
    assert.equal(used.usesPrintHelper, true);
    await cleanupTempFiles(used.tempFiles);
  });

  it('builds --import args only when needed and supported', () => {
    assert.equal(supportsPrintRuntime(), true);
    const withHelper = printRuntimeArgs({ usesPrintHelper: true });
    assert.equal(withHelper[0], '--import');
    assert.match(withHelper[1], /^file:.*register\.js$/);
    assert.deepEqual(printRuntimeArgs({ usesPrintHelper: false }), []);
    assert.deepEqual(printRuntimeArgs({}), []);
    assert.deepEqual(printRuntimeArgs(null), []);
    assert.equal(printRuntimeError({ usesPrintHelper: true }), null);
    const err = printRuntimeError({ usesPrintHelper: true }, false);
    assert.ok(err instanceof Error);
    assert.match(err.message, /18\.19|20\.6/);
    assert.match(err.message, /tamilscript\/runtime/);
    assert.equal(printRuntimeError({ usesPrintHelper: false }, false), null);
  });

  it('register module installs the helper without overwriting', async () => {
    const dir = fs.mkdtempSync(path.join(workdir, 'reg-'));
    const prog = path.join(dir, 'prog.cjs');
    fs.writeFileSync(prog, `${PRINT}('reg-ok');\n`, 'utf8');
    const { pathToFileURL: toURL } = require('node:url');
    const regURL = toURL(path.join(ROOT, 'src', 'register.js')).href;
    const r = spawnSync(process.execPath, ['--import', regURL, prog], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'reg-ok\n');
  });
});

describe('print helper: regressions', () => {
  it('transform preserves the helper call byte-identically', () => {
    const src = `${PRINT}("x");\n`;
    assert.equal(api.transform(src), src);
  });

  it('transform never executes the helper', () => {
    const key = '__ot_print_probe__';
    delete globalThis[key];
    const out = api.transform(`globalThis.${key} = 1;\n${PRINT}('x');\n`);
    assert.match(out, /globalThis/);
    assert.equal(globalThis[key], undefined);
    delete globalThis[key];
  });

  it('leaves the name alone inside comments and strings', () => {
    const src = `// ${PRINT} here\nconst s = "${PRINT}";\n`;
    assert.equal(api.transform(src), src);
  });

  it('watch mode runs a helper program and cleans up', async () => {
    const { Watcher } = require('../src/watch');
    const dir = fs.mkdtempSync(path.join(workdir, 'watch-'));
    const file = path.join(dir, 'w.js');
    const resultFile = path.join(dir, 'result.txt');
    fs.writeFileSync(file, `require("fs").writeFileSync(${JSON.stringify(resultFile)}, String($${D(2)}));\n${PRINT}('watch-tick');\n`, 'utf8');
    const quiet = { stdout: { write: () => true }, stderr: { write: () => true } };
    const watcher = new Watcher(file, [], quiet);
    try {
      await watcher.start();
      assert.equal(fs.readFileSync(resultFile, 'utf8'), '2');
      await watcher.stop();
      assert.deepEqual(watcher.watchedFiles(), []);
    } finally {
      await watcher.stop().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
