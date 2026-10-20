'use strict';

// `tamilscript doctor`: actionable, local-only diagnostics.
//
// Every check reports one of three levels:
//   ok     verified working
//   warn   usable, but something is missing or non-ideal
//   error  a real problem that should be fixed
//
// Doctor never claims to have checked network connectivity, the npm
// registry, or dependency integrity: it only inspects the local runtime,
// the current project's files, and whether npm can be executed.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { supportsPrintRuntime } = require('./runner');
const { PRINT_HELPER_NAME } = require('./runtime');
const { npmInvocation } = require('./project-test');
const { label } = require('./diagnostics');

const VERSION = require('../package.json').version;

const Level = Object.freeze({ OK: 'ok', WARN: 'warn', ERROR: 'error' });

function checkNode() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) {
    return {
      level: Level.ERROR,
      message: `Node.js v${process.versions.node} is unsupported (tamilscript requires >=18.0.0).`,
    };
  }
  if (!supportsPrintRuntime()) {
    return {
      level: Level.WARN,
      message:
        `Node.js v${process.versions.node} — automatic ${PRINT_HELPER_NAME}() setup needs ` +
        '^18.19.0 || >=20.6.0; import the helper from "tamilscript/runtime" explicitly.',
    };
  }
  return {
    level: Level.OK,
    message: `Node.js v${process.versions.node} (automatic ${PRINT_HELPER_NAME}() setup available)`,
  };
}

function runNpmVersion(timeout) {
  const inv = npmInvocation(['--version']);
  return spawnSync(inv.command, inv.argv, {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  });
}

function checkNpm() {
  let r = runNpmVersion(10000);
  if (r.error && r.error.code === 'ETIMEDOUT') {
    // A loaded machine can stall the first spawn; retry once with more time
    // before reporting npm as unavailable.
    const retry = runNpmVersion(20000);
    if (retry.error === undefined) r = retry;
  }
  if (r.status === 0 && String(r.stdout || '').trim() !== '') {
    return { level: Level.OK, message: `npm ${String(r.stdout).trim()} available (used by \`tamilscript test\`)` };
  }
  return {
    level: Level.WARN,
    message: 'npm is not available on PATH; `tamilscript test` cannot run project tests.',
  };
}

function checkCli() {
  const bin = path.join(__dirname, '..', 'bin', 'tamilscript.js');
  if (fs.existsSync(bin)) {
    return { level: Level.OK, message: `TamilScript ${VERSION} — CLI entry found at ${bin}` };
  }
  return { level: Level.WARN, message: `CLI entry not found at ${bin}` };
}

function readManifestSafe(file) {
  try {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    return pkg && typeof pkg === 'object' ? pkg : null;
  } catch (err) {
    void err;
    return null;
  }
}

function checkInstalled(cwd) {
  // The tamilscript repository itself is not "installed" as a dependency;
  // report it explicitly rather than emitting a false warning.
  const own = readManifestSafe(path.join(cwd, 'package.json'));
  if (own && own.name === 'tamilscript') {
    return { level: Level.OK, message: 'running inside the tamilscript package itself (no dependency needed)' };
  }
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', 'tamilscript', 'package.json');
    if (fs.existsSync(candidate)) {
      return {
        level: Level.OK,
        message: `tamilscript installed in ${path.join(dir, 'node_modules', 'tamilscript')}`,
      };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {
    level: Level.WARN,
    message: 'tamilscript is not a dependency of this project — run: npm install --save-dev tamilscript',
  };
}

function checkManifest(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return {
      checks: [
        { level: Level.WARN, message: `no package.json in ${path.resolve(cwd)} — run: tamilscript init` },
      ],
      pkg: null,
    };
  }
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    return {
      checks: [{ level: Level.ERROR, message: `package.json is not valid JSON: ${err.message}` }],
      pkg: null,
    };
  }
  const checks = [{ level: Level.OK, message: 'package.json is valid JSON' }];
  const test = pkg && pkg.scripts && pkg.scripts.test;
  if (typeof test === 'string' && test.trim() !== '') {
    checks.push({ level: Level.OK, message: `test script: ${test}` });
  } else {
    checks.push({
      level: Level.WARN,
      message: 'no "test" script in package.json — `tamilscript test` will not work',
    });
  }
  return { checks, pkg };
}

/**
 * Verify files referenced by `tamilscript run/check` inside npm scripts.
 * Only explicit references are checked; nothing is assumed.
 */
function checkEntryRefs(cwd, pkg) {
  const checks = [];
  const scripts = pkg && pkg.scripts;
  if (!scripts || typeof scripts !== 'object') return checks;
  // One command segment per `tamilscript run|check ...` occurrence, up to the
  // next shell separator. Only the first operand is the entry file: leading
  // flags such as --watch/--inspect (which are not files) are skipped, and
  // `--` ends the CLI's own arguments.
  const re = /(?:^|\s)tamilscript\s+(?:run|check)\s+([\s\S]*?)(?=\s*(?:&&|\|\||;|$))/g;
  for (const [name, value] of Object.entries(scripts)) {
    if (typeof value !== 'string') continue;
    for (const m of value.matchAll(re)) {
      const tokens = m[1].match(/"[^"]*"|'[^']*'|\S+/g) || [];
      let file = null;
      for (const token of tokens) {
        if (token === '--') break;
        if (token.startsWith('-')) continue;
        file = token.replace(/^["']|["']$/g, '');
        break;
      }
      if (file == null) continue;
      if (fs.existsSync(path.resolve(cwd, file))) {
        checks.push({ level: Level.OK, message: `scripts.${name} → ${file} exists` });
      } else {
        checks.push({ level: Level.WARN, message: `scripts.${name} → ${file} is missing` });
      }
    }
  }
  return checks;
}

/**
 * Run every doctor check for `cwd`.
 * @param {string} cwd project directory
 * @returns {Array<{ level: string, message: string }>}
 */
function runDoctor(cwd) {
  const manifest = checkManifest(cwd);
  return [
    checkNode(),
    checkNpm(),
    checkCli(),
    checkInstalled(cwd),
    ...manifest.checks,
    ...checkEntryRefs(cwd, manifest.pkg),
  ];
}

/**
 * Render the doctor report.
 * @param {Array<{ level: string, message: string }>} checks
 * @param {{ tamil?: boolean }} [options]
 * @returns {string}
 */
function formatReport(checks, options) {
  const o = options || {};
  const lines = [`tamilscript doctor — TamilScript ${VERSION}`, ''];
  const tag = (level) => {
    if (level === Level.ERROR) return label('error', o.tamil);
    if (level === Level.WARN) return label('warning', o.tamil);
    return label('ok', o.tamil);
  };
  for (const c of checks) lines.push(`[${tag(c.level)}] ${c.message}`);
  const count = (level) => checks.filter((c) => c.level === level).length;
  const ok = count(Level.OK);
  const warn = count(Level.WARN);
  const err = count(Level.ERROR);
  lines.push(
    '',
    `Summary: ${ok} ok, ${warn} warning${warn === 1 ? '' : 's'}, ${err} error${err === 1 ? '' : 's'}.`
  );
  return lines.join('\n') + '\n';
}

module.exports = {
  Level,
  runDoctor,
  formatReport,
};
