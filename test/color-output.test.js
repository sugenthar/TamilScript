'use strict';

// Program output is data: it must stay plain text even when the ambient
// environment forces ANSI color. Node's console colorizes non-string
// console.log arguments (numbers, objects) as soon as the output stream
// reports color support, and FORCE_COLOR provides that support even for
// pipes — which is exactly how colored digits leaked into exact-output
// assertions, examples, generated projects, and piped runs.
//
// Two guards keep program output byte-exact (both regression-tested here):
//   1. the அச்சிடு() helper never colorizes (src/runtime.js);
//   2. `tamilscript run` / `--watch` execute programs without FORCE_COLOR
//      (src/runner.js programEnv, used by src/runner.js and src/watch.js).
//
// Fixtures build Tamil text from \u escapes/points so the assertions never
// depend on the source file's encoding.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { programEnv } = require('../src/runner');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');

// Tamil print helper name and Tamil numeral helper, as escapes/points.
const PRINT = '\u0b85\u0b9a\u0bcd\u0b9a\u0bbf\u0b9f\u0bc1';
const D = (n) => String.fromCodePoint(0x0be6 + n);

let workdir;
before(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-color-'));
});
after(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

function writeTmp(name, content) {
  const p = path.join(workdir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

// An environment that forces color in every child (the reported failure).
function forcedEnv() {
  return { ...process.env, FORCE_COLOR: '1' };
}

const ANSI = /\u001b\[/;

describe('program output stays plain when FORCE_COLOR forces color', () => {
  it('அச்சிடு never colorizes numbers, objects, or booleans', () => {
    const runtimePath = JSON.stringify(path.join(ROOT, 'src', 'runtime.js'));
    const file = writeTmp(
      'helper.js',
      `const { ${PRINT} } = require(${runtimePath});\n` +
        `${PRINT}(18);\n` +
        `${PRINT}({ n: 7 });\n` +
        `${PRINT}('plain', 3, true);\n`
    );
    const r = spawnSync(process.execPath, [file], { encoding: 'utf8', env: forcedEnv() });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, ANSI);
    assert.equal(r.stdout, '18\n{ n: 7 }\nplain 3 true\n');
  });

  it('tamilscript run executes programs without the forcing variable', () => {
    const file = writeTmp(
      'plain.js',
      `console.log($${D(1)}${D(8)});\n` +
        `console.log(process.env.FORCE_COLOR === undefined);\n`
    );
    const r = spawnSync(process.execPath, [BIN, 'run', file], {
      encoding: 'utf8',
      env: forcedEnv(),
    });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, ANSI);
    assert.equal(r.stdout, '18\ntrue\n');
  });

  it('programEnv drops FORCE_COLOR without mutating the current process', () => {
    const sentinel = 'OT_COLOR_TEST_SENTINEL';
    const savedForced = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = '1';
    process.env[sentinel] = 'yes';
    try {
      const env = programEnv();
      assert.equal(env.FORCE_COLOR, undefined);
      assert.equal(env[sentinel], 'yes');
      // The parent process keeps its own environment untouched.
      assert.equal(process.env.FORCE_COLOR, '1');
    } finally {
      if (savedForced === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = savedForced;
      delete process.env[sentinel];
    }
  });
});
