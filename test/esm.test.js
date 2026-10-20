'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');

describe('ESM support', () => {
  it('runs an ESM program with import/export and Tamil literals', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-esm-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ type: 'module' }),
        'utf8'
      );
      fs.writeFileSync(path.join(dir, 'helper.js'), 'export const step = $௫;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        'import { step } from "./helper.js";\nconst total = $௧௦ + step;\nconsole.log(total);\n',
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

  it('checks an ESM file without executing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-esm-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'm.js'),
        'export const x = $௧;\nconsole.log("NO RUN");\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'check', path.join(dir, 'm.js')], {
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.doesNotMatch(r.stdout, /NO RUN/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
