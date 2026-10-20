'use strict';

// Every file in examples/ is executed (or, for error-demo, checked) here,
// so documentation examples can never drift from actual behavior.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');
const EXAMPLES = path.join(ROOT, 'examples');

function run(args, options) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    ...options,
  });
}

describe('examples', () => {
  it('basic.js prints the documented integers', () => {
    const r = run(['run', 'examples/basic.js']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '18\n100\n3\n0\n');
  });

  it('tamil-strings.js prints the documented strings', () => {
    const r = run(['run', 'examples/tamil-strings.js']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(
      r.stdout,
      'Tamil\nவணக்கம்\nதமிழ் மொழி\nTamil programming is interesting\n\nவணக்கம்\nதமிழ் மொழி\n'
    );
  });

  it('tamil-numbers.js prints the documented numbers', () => {
    const r = run(['run', 'examples/tamil-numbers.js']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '0\n1\n9\n18\n100\n12345\n-18\n30\n');
  });

  it('decimals.js prints the documented decimals', () => {
    const r = run(['run', 'examples/decimals.js']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '12.5\n0.18\n15\n');
  });

  it('expressions.js prints the documented results', () => {
    const r = run(['run', 'examples/expressions.js']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '300\n30\n30\n4\nவணக்கம் தமிழ்\nவணக்கம் உலகம்\n');
  });

  it('objects-and-functions.js runs successfully', () => {
    const r = run(['run', 'examples/objects-and-functions.js']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /தமிழ்/);
    assert.match(r.stdout, /Actual value: 18/);
  });

  it('esm example runs with imports', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-ex-esm-'));
    try {
      fs.copyFileSync(path.join(EXAMPLES, 'esm', 'helper.js'), path.join(dir, 'helper.js'));
      fs.copyFileSync(path.join(EXAMPLES, 'esm', 'main.js'), path.join(dir, 'main.js'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
      const r = run(['run', path.join(dir, 'main.js')]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, 'தமிழ்\n15\ndecimal: 1.5\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('commonjs example runs with require', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-ex-cjs-'));
    try {
      fs.copyFileSync(path.join(EXAMPLES, 'commonjs', 'helper.js'), path.join(dir, 'helper.js'));
      fs.copyFileSync(path.join(EXAMPLES, 'commonjs', 'main.js'), path.join(dir, 'main.js'));
      const r = run(['run', path.join(dir, 'main.js')]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, 'தமிழ்\n15\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('error-demo.js fails check with a located diagnostic', () => {
    const r = run(['check', 'examples/error-demo.js']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /error-demo\.js:6:14/);
    assert.match(r.stderr, /JST_BAD_NUMERIC_LITERAL/);
  });

  it('tamil-functions.js runs functions with Tamil identifiers', () => {
    const r = run(['run', 'examples/tamil-functions.js']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(
      r.stdout,
      'மொத்தம்: 163\nசராசரி: 81.5\nவணக்கம்\n'
    );
  });

  it('tamil-collections.js runs arrays, objects, loops, and conditionals', () => {
    const r = run(['run', 'examples/tamil-collections.js']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(
      r.stdout,
      'மொத்தம்: 358\ncount: 4 rest: 3\nசராசரி 89.5 வணக்கம்\nfirst: 85 மொழி: தமிழ்\n'
    );
  });

  it('print-explicit.js runs under tamilscript run and plain node', () => {
    const expected = 'தமிழ்: 85\nஆங்கிலம்: 78\nமொத்தம்: 163\n';
    const viaRun = run(['run', 'examples/print-explicit.js']);
    assert.equal(viaRun.status, 0, viaRun.stderr);
    assert.equal(viaRun.stdout, expected);
    const viaNode = spawnSync(process.execPath, ['examples/print-explicit.js'], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    assert.equal(viaNode.status, 0, viaNode.stderr);
    assert.equal(viaNode.stdout, expected);
  });
});
