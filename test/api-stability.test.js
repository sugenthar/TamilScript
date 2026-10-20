'use strict';

// API stability (Feature G): every public export is present with the right
// runtime shape over both module systems, and the packed tarball contains
// the artifacts users need (code, declarations, binary, docs, license).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const EXPECTED_EXPORTS = [
  'toNumber',
  'toTamilNumerals',
  'parseTamilDecimal',
  'toTamilDecimal',
  'transform',
  'transformWithMap',
  'transformWithMeta',
  'transformFile',
  'runFile',
  'checkFile',
  'inlineSourceMapComment',
  'errors',
  'ErrorCodes',
  'formatDiagnostic',
  'JsTamilError',
  'JsTamilSyntaxError',
  'TamilScriptError',
  'TamilScriptSyntaxError',
  'VERSION',
  'அச்சிடு',
];

describe('api stability', () => {
  it('CommonJS require exposes every documented export', () => {
    const api = require('../src/index.js');
    for (const name of EXPECTED_EXPORTS) {
      assert.ok(api[name] !== undefined, `missing export: ${name}`);
    }
    assert.equal(typeof api.transform, 'function');
    assert.equal(typeof api.transformWithMap, 'function');
    assert.equal(typeof api.transformWithMeta, 'function');
    assert.equal(typeof api.parseTamilDecimal, 'function');
    assert.equal(typeof api.toTamilDecimal, 'function');
    assert.equal(typeof api.formatDiagnostic, 'function');
    assert.equal(api.VERSION, require('../package.json').version);
  });

  it('TamilScript error aliases preserve the historical constructors', () => {
    const api = require('../src/index.js');
    assert.equal(api.TamilScriptError, api.JsTamilError);
    assert.equal(api.TamilScriptSyntaxError, api.JsTamilSyntaxError);
    assert.equal(api.errors.TamilScriptError, api.JsTamilError);
    assert.equal(api.errors.TamilScriptSyntaxError, api.JsTamilSyntaxError);
    const err = new api.TamilScriptSyntaxError('boom', { line: 2, column: 3 });
    assert.ok(err instanceof api.JsTamilSyntaxError);
    assert.ok(err instanceof api.JsTamilError);
    assert.equal(err.line, 2);
    assert.equal(err.column, 3);
    // The stable public name/code spelling is preserved for consumers that
    // match on strings.
    assert.equal(err.name, 'JsTamilSyntaxError');
  });

  it('ESM import exposes every documented export', async () => {
    const mod = await import('../src/index.js');
    const get = (name) => mod[name] || (mod.default && mod.default[name]);
    for (const name of EXPECTED_EXPORTS) {
      assert.ok(get(name) !== undefined, `missing ESM export: ${name}`);
    }
    assert.equal(get('transform')('let x = $௧.௫;'), 'let x = 1.5;');
    assert.equal(get('parseTamilDecimal')('௧.௫'), 1.5);
    assert.equal(get('toTamilDecimal')(1.5), '௧.௫');
  });

  it('async APIs return real promises', async () => {
    const api = require('../src/index.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-async-'));
    try {
      const file = path.join(dir, 'a.js');
      fs.writeFileSync(file, 'let x = $௧;\n', 'utf8');
      const transformed = api.transformFile(file);
      const running = api.runFile(file, []);
      const checking = api.checkFile(file);
      assert.ok(transformed instanceof Promise);
      assert.ok(running instanceof Promise);
      assert.ok(checking instanceof Promise);
      // Await every started promise before the temp dir disappears: an
      // unawaited runFile child would race the cleanup and fail noisily.
      assert.equal(typeof (await transformed), 'string');
      assert.equal(await running, 0);
      const checked = await checking;
      assert.equal(checked.ok, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('packed tarball contains code, declarations, binary, docs, examples and license', () => {
    // Single fixed command string (no interpolated input): safe with shell.
    const r = spawnSync('npm pack --dry-run --json', {
      encoding: 'utf8',
      cwd: ROOT,
      shell: true,
    });
    assert.equal(r.status, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    const files = (parsed[0] && parsed[0].files || parsed.files || []).map((f) => f.path || f);
    const names = files.map(String);
    for (const want of [
      'src/index.js',
      'src/index.d.ts',
      'src/lexer.js',
      'src/numerals.js',
      'src/sourcemap.js',
      'src/watch.js',
      'src/runtime.js',
      'src/runtime.d.ts',
      'src/register.js',
      'bin/tamilscript.js',
      'package.json',
      'README.md',
      'CHANGELOG.md',
      'MIGRATION.md',
      'LICENSE',
      'examples/basic.js',
      'examples/print-explicit.js',
      'examples/commonjs/main.js',
      'examples/esm/main.js',
    ]) {
      assert.ok(names.includes(want), `tarball missing ${want}; got ${names.join(', ')}`);
    }
    assert.ok(!names.some((n) => n.startsWith('test/')), 'dev tests must not ship');
    assert.ok(!names.some((n) => n.startsWith('bench/')), 'bench must not ship');
    assert.ok(!names.includes('bin/jstamil.js'), 'removed jstamil alias must not ship');
    assert.ok(!names.includes('bin/opentamizh.js'), 'old opentamizh alias must not ship');
  });
});
