'use strict';
// Regression tests for scripts/run-tests.js, the portable `npm test` runner.
//
// The previous scripts (`node --test test/*.test.js`) depended on shell glob
// expansion: cmd.exe and PowerShell pass the literal glob through, and
// Node.js < 21 has no `--test` glob support, so Windows + Node.js 18/20
// exited 1 with `Could not find '<glob>'`. The runner must work from any
// shell, on any supported Node.js version, using explicit file arguments.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUNNER = path.join(__dirname, '..', 'scripts', 'run-tests.js');

const PASSING = "const { test } = require('node:test');\ntest('fixture passes', () => {});\n";
const FAILING = "const { test } = require('node:test');\ntest('fixture fails', () => { throw new Error('fixture-boom'); });\n";

function useFixture(files, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-run-tests-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content, 'utf8');
    }
    return body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runRunner(dir) {
  // Node always propagates NODE_V8_COVERAGE to children
  // (child_process copyProcessEnvToEnv), so nested fixture runs would
  // otherwise contribute their own coverage to an outer report. Redirect it
  // to a throwaway sink for the duration of the spawn.
  const saved = process.env.NODE_V8_COVERAGE;
  const sink = saved ? fs.mkdtempSync(path.join(os.tmpdir(), 'ot-cov-sink-')) : null;
  try {
    if (saved) process.env.NODE_V8_COVERAGE = sink;
    const r = spawnSync(process.execPath, [RUNNER, dir], { encoding: 'utf8' });
    return { status: r.status, out: String(r.stdout) + String(r.stderr) };
  } finally {
    if (saved) {
      process.env.NODE_V8_COVERAGE = saved;
      fs.rmSync(sink, { recursive: true, force: true });
    }
  }
}

test('runner executes *.test.js files through node --test', () => {
  useFixture({ 'alpha.test.js': PASSING }, (dir) => {
    const r = runRunner(dir);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /fixture passes/);
  });
});

test('runner forwards a failing test exit code', () => {
  useFixture({ 'alpha.test.js': FAILING }, (dir) => {
    const r = runRunner(dir);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /fixture fails/);
  });
});

test('runner ignores files that are not *.test.js', () => {
  useFixture({
    'helper.js': "throw new Error('helper-must-not-run');\n",
    'alpha.test.js': PASSING,
  }, (dir) => {
    const r = runRunner(dir);
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.out, /helper-must-not-run/);
  });
});

test('runner fails clearly when the directory has no test files', () => {
  useFixture({ 'helper.js': 'module.exports = 1;\n' }, (dir) => {
    const r = runRunner(dir);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /no \*\.test\.js files found/);
  });
});

test('runner fails clearly for a missing directory', () => {
  const dir = path.join(os.tmpdir(), `ot-run-tests-missing-${Date.now()}`);
  const r = runRunner(dir);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /cannot read test directory/);
});

test('npm test scripts use the portable runner, not a shell glob', () => {
  const root = path.join(__dirname, '..');
  const packages = [
    JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(root, 'vscode-extension', 'package.json'), 'utf8')),
  ];
  for (const pkg of packages) {
    assert.match(pkg.scripts.test, /scripts[\\/]run-tests\.js/, 'scripts.test must use scripts/run-tests.js');
    assert.doesNotMatch(pkg.scripts.test, /\*/, 'scripts.test must not depend on shell glob expansion');
  }
});
