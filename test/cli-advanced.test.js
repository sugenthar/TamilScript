'use strict';

// `tamilscript test` (runs the project's npm test script) and
// `tamilscript doctor` (local setup report): success and failure paths,
// exit-code propagation, configuration errors with accurate hints,
// recursion protection, Tamil labels, and argument validation.

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
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-adv-'));
});
after(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

function cli(args, options) {
  const env = { ...process.env };
  // Never inherit recursion state from the surrounding environment.
  delete env.TAMILSCRIPT_TEST_DEPTH;
  delete env.OPENTAMIZH_TEST_DEPTH;
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env,
    ...options,
    ...(options && options.env ? { env: { ...env, ...options.env } } : {}),
  });
}

function project(name, pkg, files) {
  const dir = path.join(workdir, name);
  fs.mkdirSync(dir, { recursive: true });
  if (pkg !== null) {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  }
  for (const [rel, content] of Object.entries(files || {})) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

describe('cli: doctor', () => {
  it('skips script flags when checking entry-file references', () => {
    const dir = project(
      'flagged',
      {
        name: 'flagged',
        scripts: {
          start: 'tamilscript run --watch src/app.ot.js',
          inspect: 'tamilscript run --inspect=127.0.0.1:0 src/app.ot.js',
          broken: 'tamilscript check --tamil nope.js',
          passthrough: 'tamilscript run --watch src/app.ot.js -- --help',
        },
      },
      { 'src/app.ot.js': '1;\n' }
    );
    const r = cli(['doctor'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[OK\] scripts\.start → src\/app\.ot\.js exists/);
    assert.match(r.stdout, /\[OK\] scripts\.inspect → src\/app\.ot\.js exists/);
    assert.match(r.stdout, /\[Warning\] scripts\.broken → nope\.js is missing/);
    assert.match(r.stdout, /\[OK\] scripts\.passthrough → src\/app\.ot\.js exists/);
    assert.doesNotMatch(r.stdout, /--watch is missing/);
    assert.doesNotMatch(r.stdout, /--tamil is missing/);
  });

  it('reports ok lines and a summary for a healthy project', () => {
    const dir = project(
      'healthy',
      {
        name: 'healthy',
        scripts: {
          start: 'tamilscript run src/app.ot.js',
          check: 'tamilscript check src/app.ot.js',
          test: 'node -e "process.exit(0)"',
        },
      },
      { 'src/app.ot.js': '1;\n' }
    );
    const r = cli(['doctor'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[OK\] Node\.js v/);
    // npm availability is environment-dependent (and slow machines can stall
    // the probe); the contract is that doctor reports the npm status line.
    assert.match(r.stdout, /\[(?:OK|Warning)\] npm /);
    assert.match(r.stdout, /\[OK\] package\.json is valid JSON/);
    assert.match(r.stdout, /\[OK\] test script: node -e/);
    assert.match(r.stdout, /\[OK\] scripts\.start → src\/app\.ot\.js exists/);
    assert.match(r.stdout, /\[OK\] scripts\.check → src\/app\.ot\.js exists/);
    assert.match(r.stdout, /\[Warning\] tamilscript is not a dependency of this project/);
    assert.match(r.stdout, /Summary: \d+ ok, \d+ warnings?, \d+ errors?\./);
  });

  it('warns (without failing) when package.json is missing', () => {
    const dir = project('no-manifest', null);
    const r = cli(['doctor'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[Warning\] no package\.json/);
    assert.match(r.stdout, /run: tamilscript init/);
    assert.match(r.stdout, /0 errors/);
  });

  it('reports invalid package.json as an error with exit code 1', () => {
    const dir = project('bad-json', null);
    fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "x",, }\n', 'utf8');
    const r = cli(['doctor'], { cwd: dir });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /\[Error\] package\.json is not valid JSON/);
    assert.match(r.stdout, /1 error\./);
  });

  it('warns about a missing test script and missing entry files', () => {
    const dir = project('incomplete', { name: 'incomplete', scripts: { start: 'tamilscript run missing.js' } });
    const r = cli(['doctor'], { cwd: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[Warning\] no "test" script in package\.json/);
    assert.match(r.stdout, /\[Warning\] scripts\.start → missing\.js is missing/);
  });

  it('translates doctor labels in Tamil mode', () => {
    const dir = project('bad-json-tamil', null);
    fs.writeFileSync(path.join(dir, 'package.json'), '{ nope\n', 'utf8');
    const r = cli(['--tamil', 'doctor'], { cwd: dir });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /\[பிழை\] package\.json is not valid JSON/);
    assert.match(r.stdout, /\[சரி\] Node\.js v/);
  });

  it('validates doctor arguments', () => {
    const help = cli(['doctor', '--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage: tamilscript doctor/);
    const extra = cli(['doctor', 'now']);
    assert.equal(extra.status, 2);
    assert.match(extra.stderr, /doctor takes no arguments/);
  });
});

describe('cli: test', () => {
  it('runs the configured npm test script and preserves its output', () => {
    const dir = project('test-ok', {
      name: 'test-ok',
      version: '1.0.0',
      scripts: { test: 'node -e "console.log(\'PROJECT-TEST-OK\')"' },
    });
    const r = cli(['test'], { cwd: dir });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /tamilscript test: running "npm test" in /);
    assert.match(r.stdout, /PROJECT-TEST-OK/);
  });

  it('propagates a failing test script exit code unchanged', () => {
    const dir = project('test-fail', {
      name: 'test-fail',
      version: '1.0.0',
      scripts: { test: 'node -e "process.exit(3)"' },
    });
    const r = cli(['test'], { cwd: dir });
    assert.equal(r.status, 3);
  });

  it('explains missing project configuration with accurate hints', () => {
    const none = project('test-none', null);
    const r1 = cli(['test'], { cwd: none });
    assert.equal(r1.status, 1);
    assert.match(r1.stderr, /Error \[config\]: no package\.json found in /);
    assert.match(r1.stderr, /Hint: Run `tamilscript init`/);

    const bad = project('test-bad', null);
    fs.writeFileSync(path.join(bad, 'package.json'), '{ broken\n', 'utf8');
    const r2 = cli(['test'], { cwd: bad });
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /Error \[config\]: package\.json is not valid JSON/);

    const noScript = project('test-noscript', { name: 'x' });
    const r3 = cli(['test'], { cwd: noScript });
    assert.equal(r3.status, 1);
    assert.match(r3.stderr, /Error \[config\]: no "test" script defined in package\.json/);
    assert.match(r3.stderr, /Hint: Add one, for example: "test": "node --test test\/"\./);
  });

  it('refuses to recurse when a test script calls tamilscript test', () => {
    const dir = project('test-loop', {
      name: 'test-loop',
      version: '1.0.0',
      scripts: { test: 'tamilscript test' },
    });
    const r = cli(['test'], { cwd: dir, env: { TAMILSCRIPT_TEST_DEPTH: '1' } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to run `tamilscript test` recursively/);
    assert.match(r.stderr, /use a concrete test command instead/);
  });

  it('honors the legacy OPENTAMIZH_TEST_DEPTH recursion guard', () => {
    const dir = project('test-loop-legacy', {
      name: 'test-loop-legacy',
      version: '1.0.0',
      scripts: { test: 'tamilscript test' },
    });
    const r = cli(['test'], { cwd: dir, env: { OPENTAMIZH_TEST_DEPTH: '1' } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to run `tamilscript test` recursively/);
  });

  it('works from a project directory containing spaces', () => {
    const dir = project('proj with space', {
      name: 'spaced',
      version: '1.0.0',
      scripts: { test: 'node -e "console.log(\'SPACED-OK\')"' },
    });
    const r = cli(['test'], { cwd: dir });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /SPACED-OK/);
  });

  it('validates test arguments', () => {
    const help = cli(['test', '--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage: tamilscript test/);
    const extra = cli(['test', 'now']);
    assert.equal(extra.status, 2);
    assert.match(extra.stderr, /test takes no arguments/);
  });
});
