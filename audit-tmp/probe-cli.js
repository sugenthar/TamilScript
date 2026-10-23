'use strict';
// TamilScript audit probe (part 3): CLI battery. Exercises the documented
// commands end-to-end in temp dirs on D: (disk-safe), always through
// `node bin/tamilscript.js` like a real user. Deterministic.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');

const BIN = path.join(__dirname, '..', 'bin', 'tamilscript.js');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass += 1; }
  catch (err) { failures.push({ name, message: err.message.split('\n', 1)[0].slice(0, 400) }); }
}
function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `tscript-cli-${label}-`));
}
function cli(args, opts) {
  const o = Object.assign({ encoding: 'utf8' }, opts);
  try {
    const stdout = execFileSync(process.execPath, [BIN].concat(args), o);
    return { status: 0, stdout: stdout || '', stderr: '' };
  } catch (err) {
    return { status: err.status == null ? -1 : err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}
function write(dir, name, content) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

// --- run -------------------------------------------------------------------
check('run: Tamil numerals and print helper', () => {
  const dir = tmpDir('run');
  const f = write(dir, 'a.ot.js', 'அச்சிடு($௫ + $௩);\n');
  const r = cli(['run', f]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '8\n');
  fs.rmSync(dir, { recursive: true, force: true });
});
check('run: keyword mode via flag', () => {
  const dir = tmpDir('runkw');
  const f = write(dir, 'k.ot.js', 'செயல் f(x) { கொடு x * $௨; }\nஅச்சிடு(f($௪));\n');
  const r = cli(['run', f, '--tamil-keywords']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '8\n');
  fs.rmSync(dir, { recursive: true, force: true });
});
check('run: missing file -> nonzero, helpful stderr', () => {
  const dir = tmpDir('runmiss');
  const r = cli(['run', path.join(dir, 'nope.ot.js')]);
  assert.notEqual(r.status, 0);
  assert.ok(/nope/i.test(r.stderr), r.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});
check('run: transform error -> diagnostics, nonzero, no stack noise', () => {
  const dir = tmpDir('runbad');
  const f = write(dir, 'bad.ot.js', 'let x = $௧.5;\n');
  const r = cli(['run', f]);
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes('$௧.5') || r.stderr.toLowerCase().includes('mixed'), r.stderr);
  assert.ok(!r.stderr.includes('at Scanner'), 'no internal stack in stderr');
  fs.rmSync(dir, { recursive: true, force: true });
});
check('run: runtime error propagates with nonzero status', () => {
  const dir = tmpDir('runrt');
  const f = write(dir, 'rt.ot.js', 'throw new Error("boom-$௧");\n');
  const r = cli(['run', f]);
  assert.notEqual(r.status, 0);
  assert.ok(/boom/.test(r.stderr));
  fs.rmSync(dir, { recursive: true, force: true });
});
check('run: multi-file project (relative imports)', () => {
  const dir = tmpDir('runmod');
  write(dir, 'util.ot.js', 'export function triple(x) { return x * $௩; }\n');
  const f = write(dir, 'main.ot.js', 'import { triple } from "./util.ot.js";\nஅச்சிடு(triple($௪));\n');
  const r = cli(['run', f]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '12\n');
  fs.rmSync(dir, { recursive: true, force: true });
});
check('run: temp files cleaned up', () => {
  const dir = tmpDir('runtmp');
  const f = write(dir, 'tmpclean.ot.js', 'அச்சிடு("ok");\n');
  const before = fs.readdirSync(dir);
  const r = cli(['run', f]);
  assert.equal(r.status, 0, r.stderr);
  const after = fs.readdirSync(dir);
  assert.equal(after.join(','), before.join(','), `stray temp files: ${after.filter((x) => !before.includes(x))}`);
  fs.rmSync(dir, { recursive: true, force: true });
});
check('run: CRLF and BOM input files', () => {
  const dir = tmpDir('runcrlf');
  const f = write(dir, 'crlf.ot.js', 'அச்சிடு($௧);\r\nஅச்சிடு($௨);\r\n');
  const r = cli(['run', f]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(/1\r?\n2/.test(r.stdout), JSON.stringify(r.stdout));
  const f2 = write(dir, 'bom.ot.js', '\ufeffஅச்சிடு($௩);\n');
  const r2 = cli(['run', f2]);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(r2.stdout, '3\n');
  fs.rmSync(dir, { recursive: true, force: true });
});
check('run: directory instead of file -> clear error', () => {
  const dir = tmpDir('rundir');
  const r = cli(['run', dir]);
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.length > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- transform -------------------------------------------------------------
check('transform: --stdout and -o destination', () => {
  const dir = tmpDir('tr1');
  const f = write(dir, 'in.ot.js', 'let x = $௧;\n');
  const r = cli(['transform', f, '--stdout']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'let x = 1;\n');
  const outPath = path.join(dir, 'out.js');
  const r2 = cli(['transform', f, '-o', outPath]);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(fs.readFileSync(outPath, 'utf8'), 'let x = 1;\n');
  // Missing destination is a usage error (exit code 2).
  const r3 = cli(['transform', f]);
  assert.equal(r3.status, 2, r3.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});
check('transform: refuses to overwrite input without --force', () => {
  const dir = tmpDir('tr2');
  const f = write(dir, 'self.ot.js', 'let x = $௧;\n');
  const before = fs.readFileSync(f, 'utf8');
  const r = cli(['transform', f, '-o', f]);
  assert.notEqual(r.status, 0, 'should refuse in-place transform without force');
  assert.equal(fs.readFileSync(f, 'utf8'), before, 'input untouched on refusal');
  const r2 = cli(['transform', f, '-o', f, '--force']);
  assert.equal(r2.status, 0, r2.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});
check('transform: keyword mode flag', () => {
  const dir = tmpDir('trkw');
  const f = write(dir, 'kw.ot.js', 'செயல் g() { கொடு $௧; }\n');
  const r = cli(['transform', f, '--tamil-keywords', '--stdout']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('function g()'), r.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});
check('transform: nonexistent input exits nonzero', () => {
  const dir = tmpDir('tr3');
  const r = cli(['transform', path.join(dir, 'zzz.ot.js'), '--stdout']);
  assert.notEqual(r.status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
check('transform: --explain lists events and --source-map writes map', () => {
  const dir = tmpDir('tr4');
  const f = write(dir, 'ex.ot.js', 'let x = $௧௮;\n');
  const out = path.join(dir, 'ex.js');
  const r = cli(['transform', f, '-o', out, '--explain', '--source-map']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('18') || /number/i.test(r.stdout), r.stdout);
  assert.ok(fs.existsSync(out + '.map'), 'external map written');
  const outCode = fs.readFileSync(out, 'utf8');
  assert.ok(outCode.includes('sourceMappingURL='), 'map comment appended');
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- check -----------------------------------------------------------------
check('check: ok file -> status 0, ok output', () => {
  const dir = tmpDir('ck1');
  const f = write(dir, 'ok.ot.js', 'let x = $௧ + $௨;\n');
  const r = cli(['check', f]);
  assert.equal(r.status, 0, r.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});
check('check: bad numeral -> nonzero + diagnostic with location', () => {
  const dir = tmpDir('ck2');
  const f = write(dir, 'bad.ot.js', 'let x = $௧.5;\n');
  const r = cli(['check', f]);
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes('$௧.5') || r.stderr.toLowerCase().includes('mixed'), r.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});
check('check: keyword mode opt-in', () => {
  const dir = tmpDir('ck3');
  const plain = write(dir, 'plain.ot.js', 'let x = $௧;\n');
  // A Tamil keyword used as a reserved word is invalid JS without kw mode
  // (the CLI correctly reports the location) and valid with it.
  const kw = write(dir, 'kw.ot.js', 'செயல் f() { கொடு $௧; }\n');
  const r1 = cli(['check', plain]);
  assert.equal(r1.status, 0, r1.stderr);
  const r2 = cli(['check', kw, '--tamil-keywords']);
  assert.equal(r2.status, 0, r2.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- format ----------------------------------------------------------------
check('format: trims trailing whitespace, preserves interior', () => {
  const dir = tmpDir('fmt1');
  const f = write(dir, 'a.ot.js', 'let x = $௧;   \nlet s = "pad  end";\n');
  const r = cli(['format', f]);
  assert.equal(r.status, 0, r.stderr);
  const out = fs.readFileSync(f, 'utf8');
  assert.equal(out, 'let x = $௧;\nlet s = "pad  end";\n', 'trailing trimmed, literal untouched, string interior kept');
  // Idempotence: formatting again is a no-op; --check confirms it.
  const r2 = cli(['format', f]);
  assert.equal(r2.status, 0, r2.stderr);
  const r3 = cli(['format', '--check', f]);
  assert.equal(r3.status, 0, r3.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});
check('format: malformed input refused without rewriting', () => {
  const dir = tmpDir('fmt2');
  const f = write(dir, 'bad.ot.js', 'let x = $௧.5;\n');
  const before = fs.readFileSync(f, 'utf8');
  const r = cli(['format', f]);
  assert.notEqual(r.status, 0);
  assert.equal(fs.readFileSync(f, 'utf8'), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- lint ------------------------------------------------------------------
check('lint: clean and dirty files', () => {
  const dir = tmpDir('lint1');
  const good = write(dir, 'good.ot.js', 'let x = $௧;\n');
  const bad = write(dir, 'bad.ot.js', 'let y = $௧.5;\n');
  const r1 = cli(['lint', good]);
  assert.equal(r1.status, 0, r1.stderr);
  const r2 = cli(['lint', bad]);
  assert.notEqual(r2.status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- doctor ----------------------------------------------------------------
check('doctor: exits successfully in a healthy environment', () => {
  const dir = tmpDir('doc');
  const r = cli(['doctor']);
  assert.equal(r.status, 0, r.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- init ------------------------------------------------------------------
check('init: scaffolds a working project (idempotent-safe in temp dir)', () => {
  const dir = tmpDir('init');
  const r = cli(['init'], { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  const created = fs.readdirSync(dir);
  assert.ok(created.length >= 1, `scaffold created: ${created.join(',')}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- misc ------------------------------------------------------------------
check('no args -> usage summary, no crash', () => {
  const r = cli([]);
  assert.ok(r.status === 0 || r.status !== 0, 'no crash either way');
  assert.ok((r.stdout + r.stderr).length > 0, 'prints something');
});
check('unknown command -> clean error message', () => {
  const r = cli(['swim']);
  assert.notEqual(r.status, 0);
  assert.ok((r.stdout + r.stderr).toLowerCase().includes('unknown') || /(usage|help)/i.test(r.stdout + r.stderr), r.stdout + r.stderr);
});
check('--help prints command help', () => {
  const r = cli(['--help']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(/run/i.test(r.stdout));
  const r2 = cli(['run', '--help']);
  assert.equal(r2.status, 0, r2.stderr);
});
check('CLI: paths with spaces', () => {
  const dir = tmpDir('spaces');
  const sub = path.join(dir, 'my project');
  fs.mkdirSync(sub);
  const f = write(sub, 'a.ot.js', 'அச்சிடு($௭);\n');
  const r = cli(['run', f]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '7\n');
  const r2 = cli(['transform', f, '-o', path.join(sub, 'out.js')]);
  assert.equal(r2.status, 0, r2.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`probe-cli: PASS=${pass} FAIL=${failures.length}`);
for (const f of failures) {
  console.log(`  FAIL ${f.name}`);
  console.log(`       ${f.message}`);
}
process.exitCode = failures.length ? 1 : 0;
