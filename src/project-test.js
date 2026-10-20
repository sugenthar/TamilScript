'use strict';

// `tamilscript test` integration: run the project's configured npm test
// script as a real child process and preserve its output and exit code.
//
// No shell interpolation is used for user input: the npm argument list is
// a fixed internal constant. On Windows `npm.cmd` cannot be spawned
// directly (EINVAL), so npm runs through `cmd.exe /d /s /c` with a
// constant command string; POSIX spawns `npm` directly.
//
// A depth counter (TAMILSCRIPT_TEST_DEPTH) refuses recursion when a
// project's test script calls `tamilscript test` again.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TEST_DEPTH_ENV = 'TAMILSCRIPT_TEST_DEPTH';
// Pre-rename spelling, still read so nested runs started by an older parent
// cannot recurse.
const LEGACY_TEST_DEPTH_ENV = 'OPENTAMIZH_TEST_DEPTH';

/**
 * Current recursion depth, accepting the legacy variable when the new one is
 * absent.
 * @returns {number}
 */
function testDepth() {
  const raw = process.env[TEST_DEPTH_ENV];
  const legacy = process.env[LEGACY_TEST_DEPTH_ENV];
  return Number(raw !== undefined ? raw : legacy !== undefined ? legacy : '0');
}

/**
 * How to invoke npm on this platform.
 * @param {string[]} args fixed npm arguments (never user input)
 * @returns {{ command: string, argv: string[] }}
 */
function npmInvocation(args) {
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      argv: ['/d', '/s', '/c', `npm ${args.join(' ')}`],
    };
  }
  return { command: 'npm', argv: args.slice() };
}

/**
 * Inspect the project's test setup without running anything.
 * @param {string} cwd project directory
 * @returns {{ ok: true, script: string } |
 *   { ok: false, category: string, message: string, hint: string }}
 */
function inspectTestSetup(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return {
      ok: false,
      category: 'config',
      message: `no package.json found in ${cwd}`,
      hint: 'Run `tamilscript init` to create a starter project, or `npm init -y` first.',
    };
  }
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      category: 'config',
      message: `package.json is not valid JSON: ${err.message}`,
      hint: 'Fix the JSON in package.json (a trailing comma or missing quote is the usual cause).',
    };
  }
  const script = pkg && pkg.scripts && pkg.scripts.test;
  if (typeof script !== 'string' || script.trim() === '') {
    return {
      ok: false,
      category: 'config',
      message: 'no "test" script defined in package.json',
      hint: 'Add one, for example: "test": "node --test test/".',
    };
  }
  if (testDepth() >= 1) {
    return {
      ok: false,
      category: 'config',
      message: 'refusing to run `tamilscript test` recursively',
      hint: 'The configured test script calls `tamilscript test`; use a concrete test command instead.',
    };
  }
  return { ok: true, script };
}

/**
 * Run the project's npm test script with stdio inherited.
 * @param {string} cwd project directory
 * @returns {Promise<{ code: number, problem?: { category: string, message: string, hint: string } }>}
 */
async function runProjectTest(cwd) {
  const setup = inspectTestSetup(cwd);
  if (!setup.ok) {
    return { code: 1, problem: setup };
  }
  const inv = npmInvocation(['test']);
  const depth = testDepth();
  const outcome = await new Promise((resolve) => {
    let child;
    try {
      child = spawn(inv.command, inv.argv, {
        cwd,
        stdio: ['inherit', 'inherit', 'inherit'],
        env: Object.assign({}, process.env, { [TEST_DEPTH_ENV]: String(depth + 1) }),
        windowsHide: true,
      });
    } catch (err) {
      resolve({ spawnError: err });
      return;
    }
    child.on('error', (err) => resolve({ spawnError: err }));
    child.on('close', (code) => resolve({ code: code == null ? 1 : code }));
  });
  if (outcome.spawnError) {
    return {
      code: 1,
      problem: {
        category: 'runtime',
        message: `could not start npm: ${outcome.spawnError.message}`,
        hint: 'Make sure npm is installed and on PATH (see `tamilscript doctor`).',
      },
    };
  }
  return { code: outcome.code };
}

module.exports = {
  npmInvocation,
  inspectTestSetup,
  runProjectTest,
  TEST_DEPTH_ENV,
};
