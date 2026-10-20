'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');

let workdir;
before(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-cli-'));
});
after(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

function cli(args, options) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    ...options,
  });
}

function writeTmp(name, content) {
  const p = path.join(workdir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

describe('CLI: version and help', () => {
  it('--version prints the package version', () => {
    const r = cli(['--version']);
    assert.equal(r.status, 0);
    assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  it('--help prints usage', () => {
    const r = cli(['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:/);
    assert.match(r.stdout, /tamilscript run/);
    // The public interface names only the tamilscript command.
    assert.doesNotMatch(r.stdout, /jstamil/);
  });

  it('unknown command exits 2', () => {
    const r = cli(['frobnicate']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown command/);
  });
});

describe('CLI: run', () => {
  it('runs the basic example with exact output', () => {
    const r = cli(['run', 'examples/basic.js']);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '18\n100\n3\n0\n');
  });

  it('runs expressions with exact output', () => {
    const r = cli(['run', 'examples/expressions.js']);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '300\n30\n30\n4\nவணக்கம் தமிழ்\nவணக்கம் உலகம்\n');
  });

  it('forwards runtime arguments after --', () => {
    const file = writeTmp('args.js', 'console.log(JSON.stringify(process.argv.slice(2)));');
    const r = cli(['run', file, '--', 'a', 'b c']);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '["a","b c"]');
  });

  it('forwards runtime arguments without --', () => {
    const file = writeTmp('args2.js', 'console.log(JSON.stringify(process.argv.slice(2)));');
    const r = cli(['run', file, 'x', 'y']);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '["x","y"]');
  });

  it('does not modify the original file', () => {
    const file = writeTmp('pure.js', 'let x = $௧;\nconsole.log(x);\n');
    const before = fs.readFileSync(file, 'utf8');
    const r = cli(['run', file]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '1');
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });

  it('propagates runtime errors and non-zero exit codes', () => {
    const file = writeTmp('boom.js', 'let x = $௧;\nthrow new Error("kaput");');
    const r = cli(['run', file]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /kaput/);
  });

  it('propagates process.exit codes', () => {
    const file = writeTmp('exit42.js', 'process.exit(42);');
    const r = cli(['run', file]);
    assert.equal(r.status, 42);
  });

  it('reports syntax errors without executing', () => {
    const file = writeTmp('bad.js', 'let s = $"abc;\nconsole.log("SHOULD NOT RUN");');
    const r = cli(['run', file]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /TamilScript string literals .* no longer supported/);
    assert.doesNotMatch(r.stderr + r.stdout, /SHOULD NOT RUN/);
  });

  it('exits 2 when file argument is missing', () => {
    const r = cli(['run']);
    assert.equal(r.status, 2);
  });

  it('run --help mentions the Tamil print helper', () => {
    const r = cli(['run', '--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Tamil print helper/);
    assert.match(r.stdout, /tamilscript\/runtime/);
  });
});

describe('CLI: transform', () => {
  it('transforms input to an explicit output file', () => {
    const input = writeTmp('t-in.js', 'let age = $௧௮;\n');
    const output = path.join(workdir, 't-out.js');
    const r = cli(['transform', input, '-o', output]);
    assert.equal(r.status, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), 'let age = 18;\n');
    assert.equal(fs.readFileSync(input, 'utf8'), 'let age = $௧௮;\n');
  });

  it('fails with non-zero exit on malformed input', () => {
    const input = writeTmp('t-bad.js', 'let s = $"abc;\n');
    const r = cli(['transform', input, '-o', path.join(workdir, 't-bad-out.js')]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no longer supported/);
  });

  it('requires an output path', () => {
    const input = writeTmp('t-noout.js', 'let x = 1;\n');
    const r = cli(['transform', input]);
    assert.equal(r.status, 2);
  });
});

describe('CLI: check', () => {
  it('accepts a valid file without executing it', () => {
    const file = writeTmp('check-ok.js', 'let x = $௧;\nconsole.log("RUN MARKER");\n');
    const r = cli(['check', file]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /OK/);
    assert.doesNotMatch(r.stdout, /RUN MARKER/);
  });

  it('rejects malformed TamilScript with location info', () => {
    const file = writeTmp('check-bad.js', 'let s = $"abc;\n');
    const r = cli(['check', file]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no longer supported/);
    assert.match(r.stderr, /JST_TAMIL_STRING_REMOVED/);
  });

  it('rejects invalid transformed JS', () => {
    const file = writeTmp('check-js.js', 'let x = ;\n');
    const r = cli(['check', file]);
    assert.equal(r.status, 1);
  });

  it('reports invalid transformed JS at the original column', () => {
    // `$௧` shrinks by one column; the error after it must still be reported
    // at its original source column (21), not at the generated column 20.
    const file = writeTmp('check-col.js', 'let a = $௧; let b = ;\n');
    const r = cli(['check', file]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /check-col\.js:1:21/);
  });
});
