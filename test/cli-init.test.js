'use strict';

// `tamilscript init`: scaffolding behavior, safety (no overwrite, rollback,
// destination validation), byte-exact Tamil templates, determinism, and the
// end-to-end path: a generated project whose tests run the generated sample
// through the real CLI (via a node_modules link pointing at this checkout).

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');
const VERSION = require('../package.json').version;
const SAMPLE_OUTPUT = 'வணக்கம், தமிழ்! 36';
const TEMPLATE_FILES = ['package.json', 'README.md', 'src/app.ot.js', 'test/app.test.js'];

let workdir;
before(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-init-'));
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

function snapshot(dir) {
  const out = {};
  for (const rel of TEMPLATE_FILES) {
    out[rel] = fs.readFileSync(path.join(dir, rel));
  }
  return out;
}

describe('cli: init scaffolding', () => {
  it('creates the four documented files and reports every one', () => {
    const dest = path.join(workdir, 'fresh-app');
    const r = cli(['init', dest]);
    assert.equal(r.status, 0, r.stderr);
    for (const rel of TEMPLATE_FILES) {
      assert.ok(fs.existsSync(path.join(dest, rel)), `${rel} must exist`);
      assert.ok(r.stdout.includes(path.join(dest, rel)), `report must list ${rel}: ${r.stdout}`);
    }
    assert.match(r.stdout, /Created 4 files:/);
    assert.match(r.stdout, /Next steps:/);
    assert.match(r.stdout, /npm install/);
    assert.match(r.stdout, /npm start/);
  });

  it('writes a valid package.json pinned to this CLI version', () => {
    const dest = path.join(workdir, 'pkg-app');
    assert.equal(cli(['init', dest]).status, 0);
    const raw = fs.readFileSync(path.join(dest, 'package.json'), 'utf8');
    assert.ok(raw.endsWith('\n'), 'package.json must end with a newline');
    const pkg = JSON.parse(raw);
    assert.equal(pkg.name, 'pkg-app');
    assert.equal(pkg.private, true);
    assert.equal(pkg.version, '0.1.0');
    assert.equal(pkg.type, 'commonjs');
    assert.equal(pkg.devDependencies.tamilscript, `^${VERSION}`);
    assert.equal(pkg.engines.node, '^18.19.0 || >=20.6.0');
    assert.equal(pkg.scripts.start, 'tamilscript run src/app.ot.js');
    assert.equal(pkg.scripts.check, 'tamilscript check src/app.ot.js');
    assert.equal(pkg.scripts.test, 'node --test test/app.test.js');
    assert.ok(!raw.includes(workdir), 'generated files must not embed absolute local paths');
  });

  it('generates a sample that runs and passes check with the documented output', () => {
    const dest = path.join(workdir, 'run-app');
    assert.equal(cli(['init', dest]).status, 0);
    const app = path.join(dest, 'src', 'app.ot.js');
    const run = cli(['run', app]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, `${SAMPLE_OUTPUT}\n`);
    const check = cli(['check', app]);
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /^OK: /);
  });

  it('keeps the Tamil source byte-intact', () => {
    const dest = path.join(workdir, 'bytes-app');
    assert.equal(cli(['init', dest]).status, 0);
    const src = fs.readFileSync(path.join(dest, 'src', 'app.ot.js'), 'utf8');
    assert.ok(src.includes('$௧௮'), 'Tamil number literal must survive');
    assert.ok(src.includes('வாழ்த்து'), 'Tamil identifier must survive');
    assert.ok(src.includes('அச்சிடு'), 'print helper name must survive');
    const readme = fs.readFileSync(path.join(dest, 'README.md'), 'utf8');
    assert.ok(readme.includes(SAMPLE_OUTPUT), 'README must show the exact sample output');
    // Every non-ASCII character must be in the Tamil block (no mojibake).
    for (const ch of src) {
      const cp = ch.codePointAt(0);
      if (cp > 0x7f) {
        assert.ok(cp >= 0x0b80 && cp <= 0x0bff, `U+${cp.toString(16).toUpperCase()} is not Tamil`);
      }
    }
  });

  it('refuses a second init without --force and leaves files untouched', () => {
    const dest = path.join(workdir, 'twice-app');
    assert.equal(cli(['init', dest]).status, 0);
    const before = snapshot(dest);
    const r = cli(['init', dest]);
    assert.equal(r.status, 1);
    assert.match(
      r.stderr,
      /Error \[file\]: refusing to overwrite existing files: package\.json, README\.md, src\/app\.ot\.js, test\/app\.test\.js/
    );
    assert.match(r.stderr, /Hint: Pass --force to overwrite the listed files, or choose an empty directory\./);
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'guard failures must not dump stack frames');
    assert.deepEqual(snapshot(dest), before, 'refused init must not modify anything');
  });

  it('--force overwrites only the template files', () => {
    const dest = path.join(workdir, 'force-app');
    assert.equal(cli(['init', dest]).status, 0);
    const app = path.join(dest, 'src', 'app.ot.js');
    fs.appendFileSync(app, '// local marker\n', 'utf8');
    const extra = path.join(dest, 'extra.txt');
    fs.writeFileSync(extra, 'do not touch\n', 'utf8');
    const r = cli(['init', dest, '--force']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Overwrote 4 existing files \(--force\):/);
    assert.ok(!fs.readFileSync(app, 'utf8').includes('local marker'), 'template must be rewritten');
    assert.equal(fs.readFileSync(extra, 'utf8'), 'do not touch\n', 'unrelated files must survive --force');
  });

  it('scaffolds the current directory when no argument is given', () => {
    const dest = path.join(workdir, 'no-arg');
    fs.mkdirSync(dest);
    const r = cli(['init'], { cwd: dest });
    assert.equal(r.status, 0, r.stderr);
    for (const rel of TEMPLATE_FILES) {
      assert.ok(fs.existsSync(path.join(dest, rel)), rel);
    }
    assert.doesNotMatch(r.stdout, /^\s+cd /m, 'no cd step when the destination is the current directory');
  });

  it('supports destinations with spaces and Tamil names', () => {
    const dest = path.join(workdir, 'my app தமிழ்');
    const r = cli(['init', dest]);
    assert.equal(r.status, 0, r.stderr);
    const pkg = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'my-app', 'package name must be sanitized');
    const run = cli(['run', path.join(dest, 'src', 'app.ot.js')]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, `${SAMPLE_OUTPUT}\n`);
  });

  it('is deterministic: same directory name, identical bytes', () => {
    const a = path.join(workdir, 'det-a', 'proj');
    const b = path.join(workdir, 'det-b', 'proj');
    assert.equal(cli(['init', a]).status, 0);
    assert.equal(cli(['init', b]).status, 0);
    for (const rel of TEMPLATE_FILES) {
      assert.deepEqual(
        fs.readFileSync(path.join(a, rel)),
        fs.readFileSync(path.join(b, rel)),
        `${rel} must be byte-identical across destinations`
      );
    }
  });

  it('refuses a destination that is an existing file', () => {
    const dest = path.join(workdir, 'a-file');
    fs.writeFileSync(dest, 'i am a file\n', 'utf8');
    const r = cli(['init', dest]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /exists and is not a directory/);
    assert.match(r.stderr, /Hint: Choose a directory path, or remove the existing file first\./);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'i am a file\n');
  });

  it('rolls back created files when a directory name is blocked by a file', () => {
    const dest = path.join(workdir, 'blocked');
    fs.mkdirSync(dest);
    const blocker = path.join(dest, 'src');
    fs.writeFileSync(blocker, 'user file\n', 'utf8');
    const r = cli(['init', dest]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /cannot create directory/);
    assert.match(r.stderr, /already exists at/);
    assert.ok(!fs.existsSync(path.join(dest, 'package.json')), 'package.json must be rolled back');
    assert.ok(!fs.existsSync(path.join(dest, 'README.md')), 'README.md must be rolled back');
    assert.equal(fs.readFileSync(blocker, 'utf8'), 'user file\n', 'user file must survive');
  });

  it('generated project tests pass with an install-like node_modules layout', (t) => {
    const dest = path.join(workdir, 'junction-app');
    assert.equal(cli(['init', dest]).status, 0);
    fs.mkdirSync(path.join(dest, 'node_modules'), { recursive: true });
    try {
      fs.symlinkSync(
        ROOT,
        path.join(dest, 'node_modules', 'tamilscript'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
    } catch (err) {
      t.skip(`cannot create a directory link in this environment: ${err.message}`);
      return;
    }
    // A nested `node --test` must not inherit the outer test runner's
    // NODE_TEST_CONTEXT (that would put it in child-reporter mode, which
    // exits quietly without running anything).
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ['--test', 'test/app.test.js'], {
      cwd: dest,
      encoding: 'utf8',
      env,
    });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /pass 2/);
    assert.match(r.stdout, /fail 0/);
  });

  it('validates init arguments', () => {
    const help = cli(['init', '--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage: tamilscript init \[directory\] \[--force\]/);
    const bad = cli(['init', '--bogus']);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /unexpected argument "--bogus"/);
    const two = cli(['init', 'a', 'b']);
    assert.equal(two.status, 2);
    assert.match(two.stderr, /at most one directory argument/);
  });
});
