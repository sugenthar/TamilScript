'use strict';

// `tamilscript init` project scaffolding.
//
// Generates a minimal starter project that uses only syntax and APIs the
// current runtime actually supports:
//
//   package.json      npm scripts (start/check/test) + tamilscript devDependency
//   README.md         project overview and the exact sample output
//   src/app.ot.js     Tamil literals, Tamil identifiers, அச்சிடு() helper
//   test/app.test.js  node:test file that runs the sample via the tamilscript CLI
//
// Safety properties:
//   - the destination is validated before anything is written;
//   - existing files are never overwritten unless `force` is set, and even
//     then only the four template files are touched;
//   - every target path is verified to stay inside the destination;
//   - a failure rolls back the files this run created (never user files)
//     and removes empty directories it created.

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./transform-file');
const { PRINT_HELPER_NAME } = require('./runtime');

const VERSION = require('../package.json').version;

// The exact stdout of the generated sample program (asserted by the
// generated test, the README and this package's test suite alike).
const SAMPLE_OUTPUT = 'வணக்கம், தமிழ்! 36';

/**
 * Sanitize a directory name into a valid npm package name.
 * Falls back to `tamilscript-app` when nothing usable remains.
 * @param {string} destAbs absolute destination directory
 * @returns {string}
 */
function projectNameFor(destAbs) {
  const base = path.basename(destAbs);
  let name = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+/, '')
    .replace(/[-.]+$/, '');
  if (name.length > 214) name = name.slice(0, 214).replace(/[-.]+$/, '');
  if (!name || name === 'node_modules' || name === 'favicon.ico') name = 'tamilscript-app';
  return name;
}

/**
 * Whether `childAbs` is strictly inside `parentAbs` (both resolved paths).
 * @param {string} parentAbs
 * @param {string} childAbs
 * @returns {boolean}
 */
function isInside(parentAbs, childAbs) {
  const rel = path.relative(parentAbs, childAbs);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function scaffoldError(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  if (cause !== undefined) err.cause = cause;
  return err;
}

function packageJsonFor(name) {
  return {
    name,
    version: '0.1.0',
    private: true,
    description: 'A TamilScript starter project.',
    type: 'commonjs',
    engines: {
      // The range where `module.register` exists, which `tamilscript run`
      // uses to make அச்சிடு() available automatically.
      node: '^18.19.0 || >=20.6.0',
    },
    scripts: {
      start: 'tamilscript run src/app.ot.js',
      check: 'tamilscript check src/app.ot.js',
      test: 'node --test test/app.test.js',
    },
    devDependencies: {
      tamilscript: `^${VERSION}`,
    },
  };
}

function renderApp() {
  return [
    '// இது TamilScript மாதிரி நிரல்.',
    'const வாழ்த்து = "வணக்கம், தமிழ்!";',
    'const எண் = $௧௮;',
    '',
    'function இரட்டை(x) {',
    '  return x * $௨;',
    '}',
    '',
    `${PRINT_HELPER_NAME}(வாழ்த்து, இரட்டை(எண்));`,
    '',
  ].join('\n');
}

function renderReadme(name) {
  return [
    `# ${name}`,
    '',
    'A TamilScript starter project. TamilScript is JavaScript with Tamil',
    'literals (`$௧௮` becomes `18`), Tamil identifiers, and the',
    `\`${PRINT_HELPER_NAME}()\` print helper.`,
    '',
    '## Commands',
    '',
    '```bash',
    'npm install    # install the tamilscript CLI (devDependency)',
    'npm start      # run src/app.ot.js',
    'npm run check  # validate without executing',
    'npm test       # run the tests',
    '```',
    '',
    '`npm start` prints:',
    '',
    '```text',
    SAMPLE_OUTPUT,
    '```',
    '',
    '## Layout',
    '',
    '- `src/app.ot.js` — the sample program.',
    '- `test/app.test.js` — runs and validates the sample through the',
    '  `tamilscript` CLI.',
    '',
    '## Requirements',
    '',
    '- Node.js `^18.19.0 || >=20.6.0` so the print helper is registered',
    '  automatically by `tamilscript run`. On older supported Node.js',
    '  versions import it explicitly:',
    `  \`const { ${PRINT_HELPER_NAME} } = require('tamilscript/runtime');\`.`,
    '',
  ].join('\n');
}

function renderTest() {
  return [
    "'use strict';",
    '',
    '// இது உருவாக்கப்பட்ட சோதனைக் கோப்பு.',
    "const { describe, it } = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const { spawnSync } = require('node:child_process');",
    "const path = require('node:path');",
    '',
    "const APP = path.join(__dirname, '..', 'src', 'app.ot.js');",
    "const CLI = path.join(path.dirname(require.resolve('tamilscript')), '..', 'bin', 'tamilscript.js');",
    '',
    'function runCli(...args) {',
    "  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });",
    '}',
    '',
    "describe('app.ot.js', () => {",
    "  it('prints the Tamil greeting and the doubled number', () => {",
    "    const r = runCli('run', APP);",
    '    assert.equal(r.status, 0, r.stderr);',
    `    assert.equal(r.stdout.trim(), '${SAMPLE_OUTPUT}');`,
    '  });',
    '',
    "  it('passes tamilscript check', () => {",
    "    const r = runCli('check', APP);",
    '    assert.equal(r.status, 0, r.stderr);',
    '    assert.match(r.stdout, /OK/);',
    '  });',
    '});',
    '',
  ].join('\n');
}

const TEMPLATE_FILES = [
  { rel: 'package.json', make: (name) => `${JSON.stringify(packageJsonFor(name), null, 2)}\n` },
  { rel: 'README.md', make: (name) => renderReadme(name) },
  { rel: 'src/app.ot.js', make: () => renderApp() },
  { rel: 'test/app.test.js', make: () => renderTest() },
];

/**
 * Remove files/directories a failed init run created (never preexisting
 * content — overwritten files cannot be restored, which is why `--force`
 * is opt-in).
 */
async function rollbackInit(createdFiles, createdDirs, removeDest) {
  for (const f of createdFiles.slice().reverse()) {
    try {
      await fs.promises.unlink(f);
    } catch (err) {
      void err;
    }
  }
  const dirs = createdDirs.slice().reverse();
  if (removeDest) dirs.push(removeDest);
  for (const d of dirs) {
    try {
      await fs.promises.rmdir(d); // only removes empty directories
    } catch (err) {
      void err;
    }
  }
}

/**
 * Create a starter project in `destDir`.
 *
 * @param {string} destDir destination directory (created when missing)
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ dir: string, display: string, name: string,
 *   created: string[], overwritten: string[] }>}
 * @throws {Error} with a `SCAFFOLD_*` code on invalid destination, refused
 *   overwrite, or write failure (previous files are rolled back)
 */
async function initProject(destDir, options) {
  const opts = options || {};
  const display = typeof destDir === 'string' && destDir.length > 0 ? destDir : '.';
  const destAbs = path.resolve(display);

  let stat = null;
  try {
    stat = await fs.promises.stat(destAbs);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw scaffoldError(
        'SCAFFOLD_WRITE_FAILED',
        `cannot inspect destination ${JSON.stringify(destAbs)}: ${err.message}`,
        err
      );
    }
  }
  if (stat && !stat.isDirectory()) {
    throw scaffoldError(
      'SCAFFOLD_DEST_FILE',
      `destination ${JSON.stringify(destAbs)} exists and is not a directory`
    );
  }

  const targets = TEMPLATE_FILES.map((t) => ({
    rel: t.rel,
    abs: path.join(destAbs, t.rel),
    make: t.make,
  }));
  for (const t of targets) {
    if (!isInside(destAbs, t.abs)) {
      // Defensive only: the template paths are fixed constants, so this
      // cannot trigger unless the template list is changed incorrectly.
      throw scaffoldError(
        'SCAFFOLD_OUTSIDE',
        `refusing to write outside ${JSON.stringify(destAbs)}`
      );
    }
  }

  const existing = targets.filter((t) => fs.existsSync(t.abs));
  if (existing.length > 0 && !opts.force) {
    const err = scaffoldError(
      'SCAFFOLD_EEXIST',
      `refusing to overwrite existing file${existing.length === 1 ? '' : 's'}: ` +
        existing.map((t) => t.rel).join(', ')
    );
    err.files = existing.map((t) => t.rel);
    throw err;
  }

  const name = projectNameFor(destAbs);
  const preexisting = new Set(existing.map((t) => t.abs));
  const destExisted = fs.existsSync(destAbs);
  const created = [];
  const overwritten = [];
  const createdDirs = [];

  try {
    await fs.promises.mkdir(destAbs, { recursive: true });
    for (const t of targets) {
      const dirRel = path.dirname(t.rel);
      if (dirRel !== '.') {
        const dirAbs = path.join(destAbs, dirRel);
        const dirExisted = fs.existsSync(dirAbs);
        try {
          await fs.promises.mkdir(dirAbs, { recursive: true });
        } catch (err) {
          const blocked = err && (err.code === 'EEXIST' || err.code === 'ENOTDIR');
          const detail = blocked ? `a file already exists at ${JSON.stringify(dirAbs)}` : err.message;
          throw scaffoldError(
            'SCAFFOLD_WRITE_FAILED',
            `cannot create directory ${JSON.stringify(dirAbs)}: ${detail}`,
            err
          );
        }
        if (!dirExisted) createdDirs.push(dirAbs);
      }
      await writeFileAtomic(t.abs, t.make(name));
      if (preexisting.has(t.abs)) overwritten.push(t.abs);
      else created.push(t.abs);
    }
  } catch (err) {
    await rollbackInit(created, createdDirs, destExisted ? null : destAbs);
    if (err && typeof err.code === 'string' && err.code.startsWith('SCAFFOLD')) throw err;
    throw scaffoldError(
      'SCAFFOLD_WRITE_FAILED',
      `cannot create project files in ${JSON.stringify(destAbs)}: ${err.message}`,
      err
    );
  }

  return { dir: destAbs, display, name, created, overwritten };
}

module.exports = {
  initProject,
  projectNameFor,
  isInside,
  SAMPLE_OUTPUT,
  TEMPLATE_FILES,
};
