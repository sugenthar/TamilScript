'use strict';

// Debugging support: `tamilscript run --inspect[=host:port]` forwards the
// inspector flags to the child node process, ordinary runs are unchanged,
// and source-mapped stack traces keep working with the inspector enabled.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildSpawnArgs, supportsPrintRuntime } = require('../src/runner');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');

let workdir;
before(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-debug-'));
});
after(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

function cli(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: ROOT });
}

function write(name, content) {
  const p = path.join(workdir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

describe('run: node flag plumbing', () => {
  it('buildSpawnArgs puts node flags before --enable-source-maps', () => {
    const args = buildSpawnArgs(
      { usesPrintHelper: false },
      {
        nodeFlags: ['--inspect=127.0.0.1:0'],
        scriptPath: 'C:\\tmp\\t.js',
        programArgs: ['a', 'b'],
      }
    );
    assert.deepEqual(args, [
      '--inspect=127.0.0.1:0',
      '--enable-source-maps',
      'C:\\tmp\\t.js',
      'a',
      'b',
    ]);
  });

  it('buildSpawnArgs keeps the default ordering without node flags', () => {
    const args = buildSpawnArgs({ usesPrintHelper: false }, { scriptPath: 'x.js' });
    assert.deepEqual(args, ['--enable-source-maps', 'x.js']);
  });

  it('buildSpawnArgs inserts the print-helper --import after --enable-source-maps', () => {
    const args = buildSpawnArgs({ usesPrintHelper: true }, { scriptPath: 'x.js' });
    if (supportsPrintRuntime()) {
      assert.deepEqual(args.slice(0, 2), ['--enable-source-maps', '--import']);
      assert.equal(args[args.length - 1], 'x.js');
      assert.equal(args.length, 4);
    } else {
      assert.deepEqual(args, ['--enable-source-maps', 'x.js']);
    }
  });
});

describe('run: --inspect integration', () => {
  it('starts the inspector and runs the program with Tamil literals', () => {
    const file = write('inspected.js', 'let x = $௧௮;\nconsole.log("INSPECT-PROGRAM", x);\n');
    const r = cli(['run', '--inspect=127.0.0.1:0', file]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /INSPECT-PROGRAM 18/);
    assert.match(r.stderr, /Debugger listening on ws:\/\//);
    // Temp files are cleaned up even with the inspector enabled.
    const leftovers = fs.readdirSync(workdir).filter((n) => n.startsWith('tamilscript-'));
    assert.deepEqual(leftovers, []);
  });

  it('keeps source-mapped stack traces when the inspector is enabled', () => {
    const file = write(
      'inspected-boom.js',
      'let v = $௧;\nfunction boom() {\n  throw new Error("kaput-inspect");\n}\nboom();\n'
    );
    const r = cli(['run', '--inspect=127.0.0.1:0', file]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /kaput-inspect/);
    assert.match(r.stderr, /inspected-boom\.js:3/);
    assert.doesNotMatch(r.stderr, /tamilscript-inspected-boom-/);
  });

  it('does not consume inspector-like arguments after --', () => {
    const file = write('argv.js', 'console.log(JSON.stringify(process.argv.slice(2)));\n');
    const r = cli(['run', file, '--', '--inspect=1.2.3.4:9']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), '["--inspect=1.2.3.4:9"]');
    assert.doesNotMatch(r.stderr, /Debugger listening/);
  });

  it('consumes --inspect before the file and forwards only program arguments', () => {
    const file = write('argv2.js', 'console.log(JSON.stringify(process.argv.slice(2)));\n');
    const r = cli(['run', '--inspect=127.0.0.1:0', file, 'x']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), '["x"]');
    assert.match(r.stderr, /Debugger listening/);
  });

  it('does not treat an unrelated --inspect-* flag as a node flag', () => {
    // Unknown flags before the file are usage errors (exit 2): reported,
    // never forwarded to node and never silently dropped.
    const r = cli(['run', '--inspect-unknown']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unexpected argument "--inspect-unknown"/);
    assert.doesNotMatch(r.stderr, /Debugger listening/);
  });

  it('accepts a bracketed IPv6 inspector address', () => {
    const file = write('inspected-v6.js', 'console.log("V6-RAN");\n');
    const r = cli(['run', '--inspect=[::1]:0', file]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /V6-RAN/);
    assert.match(r.stderr, /Debugger listening/);
  });

  it('forwards --help and -h after the file to the program', () => {
    const file = write('argv3.js', 'console.log(JSON.stringify(process.argv.slice(2)));\n');
    const r = cli(['run', file, '--help']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), '["--help"]');
    const r2 = cli(['run', file, '-h']);
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(r2.stdout.trim(), '["-h"]');
  });

  it('run --help documents the inspector flags', () => {
    const r = cli(['run', '--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /--inspect\[=host:port\]/);
    assert.match(r.stdout, /--inspect-brk/);
  });
});
