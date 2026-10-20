'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');

describe('CommonJS support', () => {
  it('runs a CommonJS program with require() and Tamil literals', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-cjs-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ type: 'commonjs' }),
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, 'helper.js'),
        'module.exports = { step: $௫ };\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        'const { step } = require("./helper.js");\nconst total = $௧௦ + step;\nconsole.log(total);\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], {
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), '15');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('supports relative require() from the transformed file location', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-cjs-'));
    try {
      fs.writeFileSync(path.join(dir, 'data.js'), 'module.exports = "தமிழ்";\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        'const name = require("./data.js");\nconsole.log(name + "!");\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], {
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), 'தமிழ்!');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
