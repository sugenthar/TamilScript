'use strict';

// Bridge tests: core resolution, validation positions, transform safety.
// Tamil text is built with String.fromCodePoint so this file stays ASCII.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const lang = require('../tamilscriptLang');

const D = (n) => String.fromCodePoint(0x0be6 + n);
const T18 = D(1) + D(8);
const T12 = D(1) + D(2);
const T5 = D(5);

const EXT_DIR = path.resolve(__dirname, '..');

describe('resolveCore', () => {
  it('resolves the local checkout for repository development', () => {
    const r = lang.resolveCore({ localDir: EXT_DIR });
    assert.ok(r.api, r.error);
    assert.equal(typeof r.api.transform, 'function');
    assert.match(r.api.VERSION, /^\d+\.\d+\.\d+/);
  });

  it('resolves an installed workspace package', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-ws-'));
    try {
      fs.mkdirSync(path.join(dir, 'node_modules', 'tamilscript'), { recursive: true });
      fs.cpSync(
        path.resolve(EXT_DIR, '..', 'src'),
        path.join(dir, 'node_modules', 'tamilscript', 'src'),
        { recursive: true }
      );
      fs.writeFileSync(
        path.join(dir, 'node_modules', 'tamilscript', 'package.json'),
        JSON.stringify({ name: 'tamilscript', version: '0.0.0-test', main: 'src/index.js' })
      );
      // require() of the folder reads package.json main.
      const r = lang.resolveCore({ workspaceFolders: [dir] });
      assert.ok(r.api, r.error);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prefers an explicit corePath and the first workspace folder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-multi-'));
    try {
      const mkstub = (folder, version) => {
        const pkg = path.join(folder, 'node_modules', 'tamilscript');
        fs.mkdirSync(path.join(pkg, 'src'), { recursive: true });
        fs.cpSync(path.resolve(EXT_DIR, '..', 'src'), path.join(pkg, 'src'), { recursive: true });
        fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'tamilscript', version, main: 'src/index.js' }));
      };
      const a = path.join(dir, 'a');
      const b = path.join(dir, 'b');
      fs.mkdirSync(a, { recursive: true });
      fs.mkdirSync(b, { recursive: true });
      mkstub(a, '1.0.0-first');
      mkstub(b, '2.0.0-second');
      const multi = lang.resolveCore({ workspaceFolders: [a, b] });
      assert.ok(multi.api, multi.error);
      assert.equal(multi.api.VERSION, '1.0.0-first');
      const explicit = lang.resolveCore({ corePath: path.resolve(EXT_DIR, '..', 'src', 'index.js') });
      assert.ok(explicit.api, explicit.error);
      assert.equal(explicit.api.VERSION, require('../../package.json').version);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a usable error when nothing is installed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-empty-'));
    try {
      const r = lang.resolveCore({ workspaceFolders: [dir], localDir: dir });
      assert.ok(!r.api);
      assert.match(r.error, /not found/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects modules without the tamilscript API', () => {
    const r = lang.resolveCore({ corePath: path.join(EXT_DIR, 'package.json') });
    assert.ok(!r.api);
  });
});

describe('validateText', () => {
  const { api } = lang.resolveCore({ localDir: EXT_DIR });

  it('accepts integers and decimals; rejects the removed $ string form', () => {
    assert.deepEqual(lang.validateText(api, 'let a = $' + T18 + ';\n', 'a.js'), { ok: true });
    assert.deepEqual(lang.validateText(api, 'let a = $' + T12 + '.' + T5 + ';\n', 'a.js'), { ok: true });
    assert.deepEqual(lang.validateText(api, 'let s = "x";\n', 'a.js'), { ok: true });
    const removed = lang.validateText(api, 'let s = $"x";\n', 'a.js');
    assert.equal(removed.ok, false);
    assert.equal(removed.diagnostic.code, 'JST_TAMIL_STRING_REMOVED');
  });

  it('reports 0-based positions with stable codes', () => {
    // `let a = ` is 8 chars: second `$` sits at 1-based col 14 -> 0-based 13.
    const r = lang.validateText(api, 'let a = $' + T18 + ', $' + D(1) + 'x;', 'a.js');
    assert.equal(r.ok, false);
    assert.equal(r.diagnostic.line, 0);
    assert.equal(r.diagnostic.column, 13);
    assert.equal(r.diagnostic.code, 'JST_BAD_NUMERIC_LITERAL');
    assert.equal(r.diagnostic.name, 'JsTamilSyntaxError');
    const mixed = lang.validateText(api, 'let x = $' + D(1) + '.5;', 'a.js');
    assert.equal(mixed.diagnostic.code, 'JST_MIXED_NUMERAL');
  });

  it('reports the new numeric diagnostics with 0-based positions', () => {
    const dangling = lang.validateText(api, 'let x = $' + T12 + '.' + T5 + '.;', 'a.js');
    assert.equal(dangling.ok, false);
    assert.equal(dangling.diagnostic.code, 'JST_BAD_NUMERIC_LITERAL');
    assert.equal(dangling.diagnostic.line, 0);
    assert.equal(dangling.diagnostic.column, 8);
    assert.match(dangling.diagnostic.message, /decimal point is already part of the literal/);
    const bare = lang.validateText(api, 'let x = ' + D(1) + ';', 'a.js');
    assert.equal(bare.ok, false);
    assert.equal(bare.diagnostic.code, 'JST_BAD_NUMERIC_LITERAL');
    assert.equal(bare.diagnostic.column, 8);
    assert.match(bare.diagnostic.message, /Did you mean/);
    // Decimal member access is valid TamilScript and must not raise.
    assert.deepEqual(lang.validateText(api, 'let x = $' + T12 + '.' + T5 + '.toFixed(1);', 'a.js'), { ok: true });
  });

  it('never executes the source', () => {
    const key = '__ot_bridge_probe__';
    delete globalThis[key];
    const r = lang.validateText(api, `globalThis.${key} = 1;`, 'a.js');
    assert.equal(r.ok, true);
    assert.equal(globalThis[key], undefined);
  });
});

describe('transformText and version', () => {
  const { api } = lang.resolveCore({ localDir: EXT_DIR });

  it('transforms without executing and preserves filenames in errors', () => {
    const r = lang.transformText(api, 'let a = $' + T18 + ';\n', 'a.js');
    assert.equal(r.ok, true);
    assert.equal(r.code, 'let a = 18;\n');
    const bad = lang.transformText(api, 'let s = $"oops;\n', 'a.js');
    assert.equal(bad.ok, false);
    assert.equal(bad.diagnostic.code, 'JST_TAMIL_STRING_REMOVED');
  });

  it('exposes the core version', () => {
    assert.equal(lang.getVersion(api), api.VERSION);
  });
});

describe('resolveCli', () => {
  it('resolves the local checkout for repository development', () => {
    const r = lang.resolveCli({ localDir: EXT_DIR });
    assert.ok(r.cliPath, r.error);
    assert.equal(r.cliPath, path.resolve(EXT_DIR, '..', 'bin', 'tamilscript.js'));
    assert.ok(fs.existsSync(r.cliPath));
  });

  it('resolves a workspace node_modules install', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-cli-ws-'));
    try {
      const bin = path.join(dir, 'node_modules', 'tamilscript', 'bin');
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, 'tamilscript.js'), '// stub\n');
      const r = lang.resolveCli({ workspaceFolders: [dir] });
      assert.ok(r.cliPath, r.error);
      assert.equal(r.cliPath, path.join(bin, 'tamilscript.js'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a corePath pointing at the package dir or at src/index.js', () => {
    const pkgDir = lang.resolveCli({ corePath: path.resolve(EXT_DIR, '..') });
    assert.ok(pkgDir.cliPath, pkgDir.error);
    const entry = lang.resolveCli({ corePath: path.resolve(EXT_DIR, '..', 'src', 'index.js') });
    assert.ok(entry.cliPath, entry.error);
    assert.equal(entry.cliPath, pkgDir.cliPath);
  });

  it('reports a usable error when the CLI is not installed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-cli-none-'));
    try {
      const r = lang.resolveCli({ workspaceFolders: [dir], localDir: path.join(dir, 'empty') });
      assert.ok(!r.cliPath);
      assert.match(r.error, /CLI not found/);
      assert.match(r.error, /corePath/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildRunCommand', () => {
  it('quotes paths with spaces for Windows shells', () => {
    const cmd = lang.buildRunCommand({
      cliPath: 'C:\\a b\\bin\\tamilscript.js',
      filePath: 'C:\\c d\\prog.js',
      platform: 'win32',
    });
    assert.equal(cmd, 'node "C:\\a b\\bin\\tamilscript.js" run "C:\\c d\\prog.js"');
  });

  it('quotes POSIX paths, escaping embedded single quotes', () => {
    const cmd = lang.buildRunCommand({
      cliPath: '/tmp/a b/bin/tamilscript.js',
      filePath: "/tmp/it's/prog.js",
      platform: 'linux',
    });
    assert.equal(cmd, "node '/tmp/a b/bin/tamilscript.js' run '/tmp/it'\\''s/prog.js'");
  });

  it('places extra arguments after the run subcommand', () => {
    const cmd = lang.buildRunCommand({
      cliPath: 'C:\\x\\tamilscript.js',
      filePath: 'C:\\y\\prog.js',
      extraArgs: ['--inspect=127.0.0.1:0'],
      platform: 'win32',
    });
    assert.equal(cmd, 'node "C:\\x\\tamilscript.js" run "--inspect=127.0.0.1:0" "C:\\y\\prog.js"');
  });

  it('refuses Windows paths containing shell-expandable characters', () => {
    for (const filePath of ['C:\\x\\$env.js', 'C:\\x\\100%done%.js', 'C:\\x\\`tick`.js']) {
      assert.throws(
        () => lang.buildRunCommand({ cliPath: 'C:\\x\\tamilscript.js', filePath, platform: 'win32' }),
        /refusing to quote/
      );
    }
  });

  it('keeps POSIX quoting safe for shell-special characters', () => {
    const cmd = lang.buildRunCommand({
      cliPath: '/tmp/x/tamilscript.js',
      filePath: '/tmp/$(calc).js',
      platform: 'linux',
    });
    assert.equal(cmd, "node '/tmp/x/tamilscript.js' run '/tmp/$(calc).js'");
  });

  it('refuses to build an incomplete command', () => {
    assert.throws(() => lang.buildRunCommand({ filePath: 'a.js' }), TypeError);
    assert.throws(() => lang.buildRunCommand({ cliPath: 'cli.js' }), TypeError);
  });
});
