'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const api = require('../src/index');
const { transformFileWithOptions } = require('../src/transform-file');

describe('public API', () => {
  it('exports the documented functions', () => {
    assert.equal(typeof api.toNumber, 'function');
    assert.equal(typeof api.toTamilNumerals, 'function');
    assert.equal(typeof api.transform, 'function');
    assert.equal(typeof api.transformFile, 'function');
    assert.equal(typeof api.VERSION, 'string');
  });

  it('transform() returns standard JS without executing', () => {
    const out = api.transform('let age = $௧௮;');
    assert.equal(out, 'let age = 18;');
  });

  it('transformFile() reads, transforms, and writes to an explicit destination', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tamilscript-api-'));
    try {
      const input = path.join(dir, 'in.js');
      const output = path.join(dir, 'out.js');
      await fs.promises.writeFile(input, 'let age = $௧௮;\n', 'utf8');
      const returned = await api.transformFile(input, output);
      assert.equal(returned, 'let age = 18;\n');
      assert.equal(await fs.promises.readFile(output, 'utf8'), 'let age = 18;\n');
      // original untouched
      assert.equal(await fs.promises.readFile(input, 'utf8'), 'let age = $௧௮;\n');
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('transformFile() without output path returns the string and writes nothing', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tamilscript-api-'));
    try {
      const input = path.join(dir, 'in.js');
      await fs.promises.writeFile(input, 'let x = $௧;', 'utf8');
      const returned = await api.transformFile(input);
      assert.equal(returned, 'let x = 1;');
      assert.equal((await fs.promises.readdir(dir)).length, 1);
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('transformFile() refuses to overwrite the input by default', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tamilscript-api-'));
    try {
      const input = path.join(dir, 'in.js');
      await fs.promises.writeFile(input, 'let x = $௧;', 'utf8');
      await assert.rejects(() => api.transformFile(input, input), /Refusing to overwrite/);
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('transformFile() refuses same-file overwrites through path aliases', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tamilscript-api-'));
    try {
      const input = path.join(dir, 'alias.js');
      await fs.promises.writeFile(input, 'let x = $௧;', 'utf8');
      let alias;
      if (process.platform === 'win32' || process.platform === 'darwin') {
        // Case-insensitive filesystems treat the other casing as the same file.
        alias = path.join(dir, 'ALIAS.JS');
      } else {
        // A symlink (or hard link) is the same file under a different name.
        alias = path.join(dir, 'alias-link.js');
        fs.symlinkSync(input, alias);
      }
      await assert.rejects(() => api.transformFile(input, alias), /Refusing to overwrite/);
      assert.equal(await fs.promises.readFile(input, 'utf8'), 'let x = $௧;');
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('transformFile() reports missing files safely', async () => {
    await assert.rejects(
      () => api.transformFile(path.join(os.tmpdir(), 'tamilscript-does-not-exist-12345.js')),
      /Cannot read input file/
    );
  });

  it('CommonJS require() works', () => {
    const { transform } = require('../src/index.js');
    assert.equal(transform('let x = $௨;'), 'let x = 2;');
  });

  it('ESM import works', async () => {
    const mod = await import('../src/index.js');
    const fn = mod.transform || (mod.default && mod.default.transform);
    assert.equal(typeof fn, 'function');
    assert.equal(fn('let x = $௨;'), 'let x = 2;');
  });
});

// Regression test for Bug 3: transformFileWithOptions() error messages must
// name the correct function (not transformFile()).
describe('transformFileWithOptions() error messages', () => {
  it('names transformFileWithOptions in the inputPath error', async () => {
    await assert.rejects(
      () => transformFileWithOptions('', 'out.js'),
      (err) => {
        assert.ok(err instanceof TypeError);
        assert.equal(err.message, 'transformFileWithOptions() expects inputPath as a non-empty string.');
        return true;
      }
    );
  });

  it('names transformFileWithOptions and does not say outputPath is optional', async () => {
    await assert.rejects(
      () => transformFileWithOptions('in.js', ''),
      (err) => {
        assert.ok(err instanceof TypeError);
        assert.equal(err.message, 'transformFileWithOptions() expects outputPath as a non-empty string.');
        assert.doesNotMatch(err.message, /when provided/);
        return true;
      }
    );
  });
});
