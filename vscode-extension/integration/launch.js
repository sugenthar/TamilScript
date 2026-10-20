'use strict';
// Real-editor integration launcher (run from the extension directory):
//   npm run test:integration
// Builds fixture workspaces in the OS temp dir, launches the VS Code
// Extension Development Host with --extensionTestsPath, prints the JSON
// report, and cleans up. Requires an installed `code`/`Code.exe` binary;
// set OT_CODE_BIN to override auto-detection. Pure ASCII source.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const D = (n) => String.fromCodePoint(0x0be6 + n);
const T18 = D(1) + D(8);

const EXT_DIR = path.resolve(__dirname, '..');
const CORE_SRC = path.resolve(EXT_DIR, '..', 'src');

function findCodeBin() {
  if (process.env.OT_CODE_BIN) return process.env.OT_CODE_BIN;
  const candidates = [];
  // Per-user install (the default on Windows) — resolved from the
  // environment, never a hard-coded user name.
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'));
  }
  candidates.push(
    'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    '/usr/bin/code',
    '/usr/local/bin/code',
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
  );
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch (err) {
      void err;
    }
  }
  return 'code';
}

function main() {
  const keep = process.argv.includes('--keep');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-integ-'));
  const ws1 = path.join(root, 'ws1');
  const ws2 = path.join(root, 'ws2');
  fs.mkdirSync(ws1, { recursive: true });
  fs.mkdirSync(ws2, { recursive: true });
  fs.writeFileSync(path.join(ws1, 'good.js'), 'let age = $' + T18 + ';\n// $' + T18 + ' in a comment is not code\nconst s = "$' + T18 + ' STRMARK";\nconst r = /$' + T18 + ' RXMARK/;\nconst t = `TPLMARK ${$' + T18 + '} TPLTXT`;\n', 'utf8');
  fs.writeFileSync(path.join(ws1, 'bad.js'), 'let s = $"oops;\n', 'utf8');
  fs.writeFileSync(path.join(ws2, 'other.js'), 'console.log(1);\n', 'utf8');
  // Workspace-local core stub with a marker version (proves resolution order).
  const stub = path.join(ws1, 'node_modules', 'tamilscript');
  fs.mkdirSync(path.join(stub, 'src'), { recursive: true });
  fs.cpSync(CORE_SRC, path.join(stub, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(stub, 'package.json'),
    JSON.stringify({ name: 'tamilscript', version: '9.9.9-integ', main: 'src/index.js' }),
    'utf8'
  );
  const userDir = path.join(root, 'user-data');
  const extDir = path.join(root, 'extensions');
  const outPath = path.join(root, 'report.json');

  const bin = findCodeBin();
  // OT_INTEG_ENTRY lets forensics runs substitute another entry file
  // (relative to the extension directory); defaults to the regression suite.
  const entry = process.env.OT_INTEG_ENTRY
    ? path.resolve(EXT_DIR, process.env.OT_INTEG_ENTRY)
    : path.join(EXT_DIR, 'integration', 'runTest.js');
  console.log('code binary: ' + bin);
  console.log('workspace: ' + root);
  const r = spawnSync(
    bin,
    [
      ws1, ws2,
      '--new-window',
      '--extensionDevelopmentPath=' + EXT_DIR,
      '--extensionTestsPath=' + entry,
      '--user-data-dir=' + userDir,
      '--extensions-dir=' + extDir,
      '--disable-gpu',
      '--disable-telemetry',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
    ],
    { encoding: 'utf8', timeout: 180000, env: { ...process.env, OT_INTEG_OUT: outPath } }
  );
  // Host logs are verbose; keep only our PASS/FAIL lines plus the tail.
  for (const line of String(r.stdout).split('\n')) {
    if (/^(PASS|FAIL) integ:|INTEG (OK|FAILED)/.test(line)) console.log(line);
  }
  console.log(String(r.stderr).split('\n').filter((l) => /PASS integ:|FAIL integ:|INTEG |Error: integration/.test(l)).join('\n'));
  console.log(`host exit=${r.status} signal=${r.signal} error=${r.error ? r.error.message : 'none'}`);
  let ok = false;
  if (fs.existsSync(outPath)) {
    const rep = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    console.log(`REPORT ok=${rep.ok} tokenNote=${rep.tokenNote}`);
    for (const t of rep.results) console.log(`  ${t.ok ? 'PASS' : 'FAIL'} ${t.name}${t.detail ? ' — ' + t.detail : ''}`);
    ok = rep.ok === true && r.status === 0;
  } else {
    console.log('NO REPORT FILE (host did not run tests)');
  }
  if (keep) {
    console.log('scratch kept at: ' + root);
  } else {
    // The dev host's child processes can hold file handles briefly after
    // exit; retry cleanup instead of failing an otherwise green run.
    let cleaned = false;
    for (let attempt = 0; attempt < 6 && !cleaned; attempt++) {
      try {
        if (attempt > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
        fs.rmSync(root, { recursive: true, force: true });
        cleaned = true;
      } catch (err) {
        if (attempt === 5) console.log(`WARNING: scratch cleanup failed at ${root}: ${(err && err.message) || err}`);
      }
    }
  }
  process.exit(ok ? 0 : 1);
}

main();
