'use strict';
// Portable `npm test` runner.
//
// `node --test test/*.test.js` depends on the shell expanding the glob.
// cmd.exe and PowerShell pass the literal `test/*.test.js` through, and the
// `--test` runner only gained glob support in Node.js 21, so on Windows with
// Node.js 18/20 (the `engines` floor and CI matrix cells) the old script
// exited 1 with `Could not find '<glob>'`. This runner enumerates the test
// files itself and passes explicit paths to `node --test`, which every
// supported Node.js version accepts on every platform and shell.
//
// Usage: node scripts/run-tests.js [test-directory]   (default: ./test)
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = path.resolve(process.cwd(), process.argv[2] || 'test');

let entries;
try {
  entries = fs.readdirSync(dir, { withFileTypes: true });
} catch (err) {
  console.error(`run-tests: cannot read test directory ${dir}: ${(err && err.message) || err}`);
  process.exit(1);
}

const files = entries
  .filter((entry) => !entry.isDirectory() && entry.name.endsWith('.test.js'))
  .map((entry) => entry.name)
  .sort()
  .map((name) => path.join(dir, name));

if (files.length === 0) {
  console.error(`run-tests: no *.test.js files found in ${dir}`);
  process.exit(1);
}

// The test runner marks child test processes with NODE_TEST_CONTEXT and
// refuses to run again when it sees that marker (`skipping running files`,
// exit 0). This script is an explicit request to run the suite, so never
// inherit the marker — otherwise a nested call would silently run nothing.
function childEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env: childEnv() });
if (result.error) {
  console.error(`run-tests: could not start ${process.execPath}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
