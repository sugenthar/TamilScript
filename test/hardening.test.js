'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');

function cli(args, options) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    ...options,
  });
}

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-hard-'));
}

describe('module hardening: specifiers left untouched', () => {
  it('never rewrites bare, node: or non-JS specifiers', () => {
    const dir = mktmp();
    try {
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        'const fs = require("fs");\n' +
          'const path = require("node:path");\n' +
          'const data = require("./data.json");\n' +
          'console.log(typeof fs, typeof path, data.v);\n',
        'utf8'
      );
      fs.writeFileSync(path.join(dir, 'data.json'), '{"v":7}', 'utf8');
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], {
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /object object 7/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('supports export * re-exports across files', () => {
    const dir = mktmp();
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
      fs.writeFileSync(path.join(dir, 'base.js'), 'export const n = $௪௨;\n', 'utf8');
      fs.writeFileSync(path.join(dir, 're.js'), 'export * from "./base.js";\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        'import { n } from "./re.js";\nconsole.log(n);\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], {
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), '42');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('supports circular CommonJS dependencies', () => {
    const dir = mktmp();
    try {
      fs.writeFileSync(
        path.join(dir, 'a.js'),
        'const b = require("./b.js");\nmodule.exports = { a: $௧, b: b.b };\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, 'b.js'),
        'const a = require("./a.js");\nmodule.exports = { b: $௨, a: a.a };\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        'const a = require("./a.js");\nconsole.log(a.a, a.b);\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], {
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), '1 2');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('supports mixed .mjs/.cjs extensions explicitly', () => {
    const dir = mktmp();
    try {
      fs.writeFileSync(path.join(dir, 'help.cjs'), 'module.exports = $௫;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'main.mjs'),
        'import v from "./help.cjs";\nconsole.log(v + $௧.௫);\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.mjs')], {
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), '6.5');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports missing dependencies via Node, not via rewriting', () => {
    const dir = mktmp();
    try {
      fs.writeFileSync(path.join(dir, 'main.js'), 'require("./nope.js");\n', 'utf8');
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], {
        encoding: 'utf8',
      });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /Cannot find module/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces dependency syntax errors with the dependency filename', () => {
    const dir = mktmp();
    try {
      fs.writeFileSync(path.join(dir, 'bad.js'), 'let s = $"oops;\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'main.js'), 'require("./bad.js");\n', 'utf8');
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], {
        encoding: 'utf8',
      });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /bad\.js/);
      assert.match(r.stderr, /no longer supported/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('cleans up temp files when a dependency fails', () => {
    const dir = mktmp();
    try {
      fs.writeFileSync(path.join(dir, 'ok.js'), 'module.exports = $௧;\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'bad.js'), 'let s = $"oops;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        'require("./ok.js");\nrequire("./bad.js");\n',
        'utf8'
      );
      const before = new Set(fs.readdirSync(dir));
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], {
        encoding: 'utf8',
      });
      assert.notEqual(r.status, 0);
      assert.deepEqual(new Set(fs.readdirSync(dir)), before);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removes temp files and stops the child when interrupted (SIGINT)', async () => {
    const dir = mktmp();
    try {
      const target = path.join(dir, 'alive.js');
      const marker = path.join(dir, 'started.flag');
      fs.writeFileSync(
        target,
        'const fs = require("node:fs");\n' +
          `process.stdout.write("ALIVE\\n", () => fs.writeFileSync(${JSON.stringify(marker)}, "1"));\n` +
          'setInterval(() => {}, 50);\n',
        'utf8'
      );
      const wrapper = path.join(dir, 'wrapper.js');
      fs.writeFileSync(
        wrapper,
        `const fs = require('node:fs');\n` +
          `const { runFile } = require(${JSON.stringify(path.join(ROOT, 'src', 'runner.js'))});\n` +
          `const marker = ${JSON.stringify(marker)};\n` +
          `let guard;\n` +
          `const poll = setInterval(() => {\n` +
          `  if (!fs.existsSync(marker)) return;\n` +
          `  clearInterval(poll);\n` +
          `  setTimeout(() => process.emit('SIGINT'), 100);\n` +
          `}, 25);\n` +
          `guard = setTimeout(() => {\n` +
          `  clearInterval(poll);\n` +
          `  process.stdout.write('FAILED child did not start\\n');\n` +
          `  process.exit(2);\n` +
          `}, 5000);\n` +
          `runFile(${JSON.stringify(target)}, [], {}).then((code) => {\n` +
          `  clearTimeout(guard);\n` +
          `  process.stdout.write('EXIT ' + code + '\\n');\n` +
          `  const left = require('node:fs').readdirSync(${JSON.stringify(dir)}).filter((f) => f.includes('tamilscript-'));\n` +
          `  process.stdout.write('TEMPS ' + left.length + '\\n');\n` +
          `}).catch((err) => {\n` +
          `  clearTimeout(guard);\n` +
          `  clearInterval(poll);\n` +
          `  process.stdout.write('FAILED ' + err.message + '\\n');\n` +
          `  process.exitCode = 2;\n` +
          `});\n`,
        'utf8'
      );
      const r = await new Promise((resolve) => {
        const child = spawn(process.execPath, [wrapper], { cwd: dir });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += String(d); });
        child.stderr.on('data', (d) => { stderr += String(d); });
        child.on('close', (code) => resolve({ code, stdout, stderr }));
      });
      assert.match(r.stdout, /ALIVE/);
      assert.match(r.stdout, /TEMPS 0/, r.stdout + r.stderr);
      const exit = Number((/EXIT (\d+)/.exec(r.stdout) || [])[1]);
      assert.ok(exit === 130 || exit === 1, `unexpected runFile code ${exit}`);
      assert.equal(r.code, 0, r.stderr);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('check cleans up temp files on invalid dependencies', () => {
    const dir = mktmp();
    try {
      fs.writeFileSync(path.join(dir, 'bad.js'), 'let s = $"oops;\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'main.js'), 'require("./bad.js");\n', 'utf8');
      const before = new Set(fs.readdirSync(dir));
      const r = cli(['check', path.join(dir, 'main.js')]);
      assert.equal(r.status, 1);
      assert.deepEqual(new Set(fs.readdirSync(dir)), before);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runFile read errors carry the filesystem code for diagnostics', async () => {
    const dir = mktmp();
    try {
      const { runFile } = require('../src/runner');
      await assert.rejects(
        () => runFile(dir),
        (err) => err.code === 'EISDIR' && /Cannot read file/.test(err.message)
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not treat strings/comments/regex as specifiers', () => {
    const dir = mktmp();
    try {
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        'const s = "require(./fake.js)";\n' +
          '// import x from "./comment.js"\n' +
          'const r = /require\\(\\)/;\n' +
          'const v = $௧;\n' +
          'console.log(s.length > 0 && v);\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], {
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), '1');
      // No temp-file resolution attempted: directory gains no new files.
      assert.ok(!fs.readdirSync(dir).some((f) => f.startsWith('tamilscript-')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('watch mode', () => {
  it('runs, reruns on change, and cleans up on graceful stop', async () => {
    const { Watcher } = require('../src/watch');
    const dir = mktmp();
    const file = path.join(dir, 'w.js');
    const resultFile = path.join(dir, 'result.txt');
    // Programs report via a result file: watch children inherit stdio.
    fs.writeFileSync(file, `require("fs").writeFileSync(${JSON.stringify(resultFile)}, String($௧));\n`, 'utf8');
    const quiet = { stdout: { write: () => true }, stderr: { write: () => true } };
    const watcher = new Watcher(file, [], quiet);
    const poll = (check, timeoutMs, what) => new Promise((resolve, reject) => {
      const start = Date.now();
      const t = setInterval(() => {
        let ok = false;
        try { ok = check(); } catch (err) { void err; }
        if (ok) {
          clearInterval(t);
          resolve();
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(t);
          reject(new Error(`timed out waiting for ${what}`));
        }
      }, 50);
    });
    try {
      // start() resolves after the initial run's child exits.
      await watcher.start();
      assert.equal(fs.readFileSync(resultFile, 'utf8'), '1');
      assert.deepEqual(watcher.watchedFiles(), [path.resolve(file)]);
      const firstTree = watcher.tree;
      assert.ok(firstTree && firstTree.tempFiles.length === 1);
      fs.writeFileSync(file, `require("fs").writeFileSync(${JSON.stringify(resultFile)}, String($௨));\n`, 'utf8');
      await poll(() => {
        try { return fs.readFileSync(resultFile, 'utf8') === '2'; } catch (err) { void err; return false; }
      }, 15000, 'rerun to write 2');
      // Rerun replaced the tree: exactly one generation watched, no dupes.
      assert.deepEqual(watcher.watchedFiles(), [path.resolve(file)]);
      assert.ok(watcher.tree !== null && watcher.tree !== firstTree);
      await watcher.stop();
      assert.deepEqual(watcher.watchedFiles(), []);
      assert.deepEqual(
        fs.readdirSync(dir).filter((f) => f.startsWith('tamilscript-')),
        []
      );
    } finally {
      await watcher.stop().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps watching across atomic replaces and delete + recreate', async () => {
    const { Watcher } = require('../src/watch');
    const dir = mktmp();
    const file = path.join(dir, 'w.js');
    const resultFile = path.join(dir, 'result.txt');
    const program = (digit) =>
      `require("fs").writeFileSync(${JSON.stringify(resultFile)}, String(${digit}));\n`;
    fs.writeFileSync(file, program('$௧'), 'utf8');
    const quiet = { stdout: { write: () => true }, stderr: { write: () => true } };
    const watcher = new Watcher(file, [], quiet);
    const poll = (want, what) => new Promise((resolve, reject) => {
      const start = Date.now();
      const t = setInterval(() => {
        let ok = false;
        try { ok = fs.readFileSync(resultFile, 'utf8') === want; } catch (err) { void err; }
        if (ok) {
          clearInterval(t);
          resolve();
        } else if (Date.now() - start > 15000) {
          clearInterval(t);
          reject(new Error(`timed out waiting for ${what}`));
        }
      }, 50);
    });
    try {
      await watcher.start();
      assert.equal(fs.readFileSync(resultFile, 'utf8'), '1');
      // Atomic replace (write temp + rename over the target): the common
      // editor/git save pattern, which breaks per-file watchers on POSIX.
      const tmp = path.join(dir, 'next.tmp');
      fs.writeFileSync(tmp, program('$௨'), 'utf8');
      fs.renameSync(tmp, file);
      await poll('2', 'rerun after atomic replace');
      assert.deepEqual(watcher.watchedFiles(), [path.resolve(file)]);
      // Delete then recreate: a per-file watcher would be gone for good.
      fs.unlinkSync(file);
      await new Promise((resolve) => setTimeout(resolve, 400));
      fs.writeFileSync(file, program('$௩'), 'utf8');
      await poll('3', 'rerun after delete and recreate');
    } finally {
      await watcher.stop().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sweeps stale same-pid temps left by unhandleable termination', async () => {
    const { Watcher } = require('../src/watch');
    const dir = mktmp();
    // Plant fake leftovers from "this process" and age them past the sweep
    // horizon: one with the current prefix, one with the retired prefix
    // (debris from older releases must still be cleaned up).
    const stale = path.join(dir, `tamilscript-w-${process.pid}-deadbeef.cjs`);
    fs.writeFileSync(stale, 'x', 'utf8');
    const staleLegacy = path.join(dir, `jstamil-w-${process.pid}-deadbeef.cjs`);
    fs.writeFileSync(staleLegacy, 'x', 'utf8');
    const staleRenamed = path.join(dir, `opentamizh-w-${process.pid}-deadbeef.cjs`);
    fs.writeFileSync(staleRenamed, 'x', 'utf8');
    const old = new Date(Date.now() - 120000);
    fs.utimesSync(stale, old, old);
    fs.utimesSync(staleLegacy, old, old);
    fs.utimesSync(staleRenamed, old, old);
    // A fresh file must NOT be swept.
    const fresh = path.join(dir, `tamilscript-w-${process.pid}-fresh123.cjs`);
    fs.writeFileSync(fresh, 'x', 'utf8');
    const file = path.join(dir, 'w.js');
    fs.writeFileSync(file, 'console.log(1);\n', 'utf8');
    const quiet = { stdout: { write: () => true }, stderr: { write: () => true } };
    const watcher = new Watcher(file, [], quiet);
    try {
      await watcher.start();
      assert.ok(!fs.existsSync(stale), 'stale temp swept on watch start');
      assert.ok(!fs.existsSync(staleLegacy), 'jstamil-prefix temp swept on watch start');
      assert.ok(!fs.existsSync(staleRenamed), 'opentamizh-prefix temp swept on watch start');
      assert.ok(fs.existsSync(fresh), 'fresh temp preserved');
      await watcher.stop();
    } finally {
      await watcher.stop().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('watch CLI runs and terminates on signal', async () => {
    const dir = mktmp();
    const file = path.join(dir, 'w.js');
    fs.writeFileSync(file, 'console.log($௧);\n', 'utf8');
    const child = spawn(process.execPath, [BIN, 'run', '--watch', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += String(d); });
    const exit = new Promise((resolve) => child.on('close', resolve));
    const start = Date.now();
    while (!stdout.includes('1') && Date.now() - start < 15000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.match(stdout, /1/);
    child.kill('SIGKILL');
    await exit;
    try { child.kill('SIGKILL'); } catch (err) { void err; }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports transform errors without crashing the watcher', async () => {
    const dir = mktmp();
    const file = path.join(dir, 'w.js');
    const resultFile = path.join(dir, 'result.txt');
    fs.writeFileSync(file, `require("fs").writeFileSync(${JSON.stringify(resultFile)}, String($௧));\n`, 'utf8');
    const child = spawn(process.execPath, [BIN, 'run', '--watch', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    const waitFor = (get, needle, timeoutMs) => new Promise((resolve, reject) => {
      const start = Date.now();
      const t = setInterval(() => {
        if (get().includes(needle)) {
          clearInterval(t);
          resolve();
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(t);
          reject(new Error(`timed out waiting for ${JSON.stringify(needle)}; stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`));
        }
      }, 50);
    });
    const readResult = () => {
      try { return fs.readFileSync(resultFile, 'utf8'); } catch (err) { void err; return ''; }
    };
    const exit = new Promise((resolve) => child.on('close', resolve));
    try {
      await waitFor(readResult, '1', 15000);
      fs.writeFileSync(file, 'let s = $"broken;\n', 'utf8');
      await waitFor(() => stderr, 'no longer supported', 15000);
      fs.writeFileSync(file, `require("fs").writeFileSync(${JSON.stringify(resultFile)}, String($௩));\n`, 'utf8');
      await waitFor(readResult, '3', 15000);
      child.kill('SIGKILL');
      await exit;
    } finally {
      try { child.kill('SIGKILL'); } catch (err) { void err; }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps watching a dependency that fails to transform', async () => {
    const dir = mktmp();
    const file = path.join(dir, 'w.js');
    const dep = path.join(dir, 'dep.js');
    const resultFile = path.join(dir, 'result.txt');
    fs.writeFileSync(dep, 'module.exports = String($௧);\n', 'utf8');
    fs.writeFileSync(
      file,
      `require("fs").writeFileSync(${JSON.stringify(resultFile)}, require("./dep.js"));\n`,
      'utf8'
    );
    const child = spawn(process.execPath, [BIN, 'run', '--watch', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += String(d); });
    const waitFor = (get, needle, timeoutMs) => new Promise((resolve, reject) => {
      const start = Date.now();
      const t = setInterval(() => {
        if (get().includes(needle)) {
          clearInterval(t);
          resolve();
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(t);
          reject(new Error(`timed out waiting for ${JSON.stringify(needle)}; stderr=${JSON.stringify(stderr)}`));
        }
      }, 50);
    });
    const readResult = () => {
      try { return fs.readFileSync(resultFile, 'utf8'); } catch (err) { void err; return ''; }
    };
    const exit = new Promise((resolve) => child.on('close', resolve));
    try {
      await waitFor(readResult, '1', 15000);
      // Break the dependency (not the entry): the diagnostic names it.
      fs.writeFileSync(dep, 'let s = $"broken;\n', 'utf8');
      await waitFor(() => stderr, 'no longer supported', 15000);
      // Fixing the dependency alone must trigger a rerun: without tracking
      // the failing dependency, watch would ignore this change.
      fs.writeFileSync(dep, 'module.exports = String($௩);\n', 'utf8');
      await waitFor(readResult, '3', 15000);
      child.kill('SIGKILL');
      await exit;
    } finally {
      try { child.kill('SIGKILL'); } catch (err) { void err; }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('explain and source-map flags', () => {
  it('transform --explain reports literals and locations', () => {
    const dir = mktmp();
    try {
      const input = path.join(dir, 'in.js');
      const output = path.join(dir, 'out.js');
      fs.writeFileSync(input, 'let a = $௧௮;\nlet b = $௧.௫;\nlet c = "hi";\n', 'utf8');
      const r = cli(['transform', input, '--explain', '-o', output]);
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /number.*\$௧௮ -> 18/);
      assert.match(r.stdout, /decimal.*\$௧\.௫ -> 1\.5/);
      assert.match(r.stdout, /Transformed 2 literals: 1 number, 1 decimal\./);
      assert.equal(fs.readFileSync(output, 'utf8'), 'let a = 18;\nlet b = 1.5;\nlet c = "hi";\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('transform --explain never dumps ordinary string contents', () => {
    const dir = mktmp();
    try {
      const input = path.join(dir, 'in.js');
      const output = path.join(dir, 'out.js');
      const long = 'x'.repeat(100);
      fs.writeFileSync(input, `const secret = "${long}";\nconst n = $௧;\n`, 'utf8');
      const r = cli(['transform', input, '--explain', '-o', output]);
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      // Only `$`-literals are reported; ordinary strings never appear.
      assert.doesNotMatch(r.stdout, new RegExp(long));
      assert.match(r.stdout, /Transformed 1 literal: 1 number, 0 decimal\./);
      assert.equal(fs.readFileSync(output, 'utf8'), `const secret = "${long}";\nconst n = 1;\n`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('transform rejects conflicting --explain --stdout', () => {
    const dir = mktmp();
    try {
      const input = path.join(dir, 'in.js');
      fs.writeFileSync(input, 'let a = 1;\n', 'utf8');
      const r = cli(['transform', input, '--stdout', '--explain']);
      assert.equal(r.status, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('transform --source-map writes an external map', () => {
    const dir = mktmp();
    try {
      const input = path.join(dir, 'in.js');
      const output = path.join(dir, 'out.js');
      fs.writeFileSync(input, 'let a = $௧௮;\nconsole.log(a);\n', 'utf8');
      const r = cli(['transform', input, '-o', output, '--source-map']);
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      const map = JSON.parse(fs.readFileSync(`${output}.map`, 'utf8'));
      assert.equal(map.version, 3);
      assert.ok(fs.readFileSync(output, 'utf8').includes('sourceMappingURL=out.js.map'));
      // The mapped output actually runs. This spawn executes the file
      // directly with node (not through TamilScript), so pin the
      // color-forcing environment: FORCE_COLOR would make Node's console
      // colorize the printed number and break this exact-output assertion.
      const env = { ...process.env };
      delete env.FORCE_COLOR;
      const run = spawnSync(process.execPath, [output], { encoding: 'utf8', env });
      assert.equal(run.status, 0);
      assert.equal(run.stdout.trim(), '18');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('documents every command in help with exit codes', () => {
    for (const args of [['--help'], ['run', '--help'], ['transform', '--help'], ['check', '--help']]) {
      const r = cli(args);
      assert.equal(r.status, 0, JSON.stringify(args));
      assert.match(r.stdout, /Usage:/);
    }
    assert.match(cli(['--help']).stdout, /Exit codes:/);
    assert.match(cli(['--help']).stdout, /--watch/);
    assert.match(cli(['--help']).stdout, /--explain/);
    assert.match(cli(['--help']).stdout, /--source-map/);
  });

  it('validates missing files and conflicts with clear errors', () => {
    assert.equal(cli(['run', 'does-not-exist-xyz.js']).status, 1);
    assert.equal(cli(['check', 'does-not-exist-xyz.js']).status, 1);
    assert.equal(cli(['transform', 'does-not-exist-xyz.js', '-o', 'o.js']).status, 1);
    assert.match(cli(['run', 'does-not-exist-xyz.js']).stderr, /file not found/);
  });
});
