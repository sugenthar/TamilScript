'use strict';

// High-confidence linter (`tamilscript lint`): OT001 (TamilScript literal
// rejected by the lexer) is always distinct from OT002 (transformed
// JavaScript fails `node --check`), at most one problem per file, directory
// scans skip node_modules/.git/symlinks, temporary check files are removed,
// nothing is written or executed, exit codes are 0/1/2 as documented.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  lintFile,
  lintPath,
  collectJsFiles,
  formatLintReport,
  parseNodeCheckError,
} = require('../src/lint');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');

let workdir;
before(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-lint-'));
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

function write(name, content) {
  const p = path.join(workdir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function listTempLeftovers(dir) {
  return fs.readdirSync(dir).filter((name) => name.startsWith('tamilscript-'));
}

const GOOD_SOURCE = 'const வாழ்த்து = "வணக்கம்";\nஅச்சிடு(வாழ்த்து, $௧.௫);\n';
const BAD_LITERAL_SOURCE = 'let x = $௧abc;\n';
const BAD_JS_SOURCE = 'let a = $௧;\nlet b = ;\n';

describe('lint: lintFile / lintPath', () => {
  it('reports no problems for a valid Tamil program', async () => {
    const file = write('api/good.js', GOOD_SOURCE);
    const result = await lintFile(file);
    assert.deepEqual(result.problems, []);
    assert.equal(fs.readFileSync(file, 'utf8'), GOOD_SOURCE);
  });

  it('reports OT001 with rule, category, line, column and a hint', async () => {
    const file = write('api/bad-literal.js', BAD_LITERAL_SOURCE);
    const result = await lintFile(file);
    assert.equal(result.problems.length, 1);
    const p = result.problems[0];
    assert.equal(p.rule, 'OT001');
    assert.equal(p.category, 'tamilscript-syntax');
    assert.equal(p.line, 1);
    assert.equal(p.column, 9, 'column points at the $ of the malformed literal');
    assert.match(p.message, /Malformed Tamil numeric literal/);
    assert.equal(typeof p.hint, 'string');
    assert.ok(p.hint.length > 0);
  });

  it('reports OT002 for a transformed-JavaScript syntax error', async () => {
    const file = write('api/bad-js.js', BAD_JS_SOURCE);
    const result = await lintFile(file);
    assert.equal(result.problems.length, 1);
    const p = result.problems[0];
    assert.equal(p.rule, 'OT002');
    assert.equal(p.category, 'javascript-syntax');
    assert.equal(p.line, 2);
    assert.equal(p.column, 9);
    assert.match(p.message, /SyntaxError/);
    assert.match(p.message, /transformed JavaScript/);
    assert.match(p.hint, /JavaScript syntax error/);
  });

  it('reports OT002 at the original column after a shortened literal', async () => {
    // `$௧` (2 source columns) becomes `1` (1 generated column). A syntax
    // error later on the same line must be reported at its original column,
    // not shifted left by the replacement delta.
    const file = write('api/bad-js-same-line.js', 'let a = $௧; let b = ;\n');
    const result = await lintFile(file);
    assert.equal(result.problems.length, 1);
    const p = result.problems[0];
    assert.equal(p.rule, 'OT002');
    assert.equal(p.line, 1);
    assert.equal(p.column, 21);
  });

  it('keeps OT001 and OT002 separate: at most one problem per file, the first', async () => {
    const file = write('api/both.js', `let x = $௧abc;\nlet b = ;\n`);
    const result = await lintFile(file);
    assert.equal(result.problems.length, 1);
    assert.equal(result.problems[0].rule, 'OT001');
  });

  it('reports OT000 when the file cannot be read', async () => {
    const result = await lintFile(path.join(workdir, 'api', 'missing.js'));
    assert.equal(result.problems.length, 1);
    const p = result.problems[0];
    assert.equal(p.rule, 'OT000');
    assert.equal(p.category, 'file');
    assert.equal(p.code, 'ENOENT');
    assert.equal(typeof p.hint, 'string');
  });

  it('preserves module semantics for .mjs files (export parses)', async () => {
    const file = write('api/esm.mjs', 'export const n = $௨;\n');
    const result = await lintFile(file);
    assert.deepEqual(result.problems, []);
  });

  it('checks an explicitly named non-JS file as given', async () => {
    const file = write('api/weird.txt', BAD_LITERAL_SOURCE);
    const result = await lintPath(file, { isDirectory: false });
    assert.equal(result.scanned, 1);
    assert.equal(result.problems.length, 1);
    assert.equal(result.problems[0].rule, 'OT001');
  });

  it('removes temporary check files after linting', async () => {
    const file = write('api/tempcheck.js', BAD_JS_SOURCE);
    await lintFile(file);
    assert.deepEqual(listTempLeftovers(path.dirname(file)), []);
  });

  it('lints a directory tree: sorted, only .js/.mjs/.cjs, node_modules/.git/symlinks skipped', async () => {
    const dir = path.join(workdir, 'scan');
    write('scan/real/a.js', GOOD_SOURCE);
    write('scan/b.mjs', 'export const n = $௨;\n');
    write('scan/c.cjs', 'module.exports = $௫;\n');
    write('scan/d.txt', BAD_LITERAL_SOURCE);
    write('scan/sub/e.js', GOOD_SOURCE);
    write('scan/node_modules/nested.js', BAD_LITERAL_SOURCE);
    write('scan/.git/old.js', BAD_LITERAL_SOURCE);
    try {
      fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'), 'junction');
    } catch (err) {
      // Some platforms refuse links without extra privileges; the skip
      // assertion below holds either way (a link is never in the list).
      void err;
    }

    const files = await collectJsFiles(dir);
    const rel = files.map((f) => path.relative(dir, f).split(path.sep).join('/'));
    assert.deepEqual(rel, ['b.mjs', 'c.cjs', 'real/a.js', 'sub/e.js']);

    const result = await lintPath(dir, { isDirectory: true });
    assert.equal(result.scanned, 4);
    assert.deepEqual(result.problems, []);
  });
});

describe('lint: helpers', () => {
  it('parseNodeCheckError maps the temp path back and reads line/column', () => {
    const tempAbs = 'C:\\t\\tamilscript-a-123.js';
    const originalAbs = 'C:\\t\\a.js';
    const stderr =
      'C:\\t\\tamilscript-a-123.js:2\nlet b = ;\n        ^\n\nSyntaxError: Unexpected token \';\'\n';
    const parsed = parseNodeCheckError(stderr, tempAbs, originalAbs);
    assert.equal(parsed.line, 2);
    assert.equal(parsed.column, 9);
    assert.equal(parsed.message, "SyntaxError: Unexpected token ';'");
    assert.ok(!parsed.raw.includes('tamilscript-a-123'));
    assert.ok(parsed.raw.includes('C:\\t\\a.js:2'));
  });

  it('parseNodeCheckError falls back to 1:1 and a generic message', () => {
    const parsed = parseNodeCheckError('something odd happened\n', 'T', 'O');
    assert.equal(parsed.line, 1);
    assert.equal(parsed.column, 1);
    assert.equal(parsed.message, 'transformed JavaScript does not parse');
  });

  it('formatLintReport renders the clean message with correct pluralization', () => {
    assert.equal(formatLintReport({ scanned: 1, problems: [] }), 'No lint problems found (1 file scanned).\n');
    assert.equal(formatLintReport({ scanned: 3, problems: [] }), 'No lint problems found (3 files scanned).\n');
  });

  it('formatLintReport renders problems, hints and the summary', () => {
    const out = formatLintReport({
      scanned: 2,
      problems: [
        {
          file: 'a.js',
          line: 1,
          column: 2,
          rule: 'OT001',
          category: 'tamilscript-syntax',
          message: 'm',
          hint: 'h',
        },
      ],
    });
    assert.equal(
      out,
      'a.js:1:2: [OT001] m (tamilscript-syntax)\n' +
        '  hint: h\n' +
        'Summary: 1 problem in 1 file (2 files scanned).\n'
    );
  });
});

describe('lint: CLI', () => {
  it('exits 0 with a clean report for a valid file', () => {
    const file = write('cli/good.js', GOOD_SOURCE);
    const r = cli(['lint', file]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /No lint problems found \(1 file scanned\)\./);
    assert.equal(fs.readFileSync(file, 'utf8'), GOOD_SOURCE, 'lint never writes');
  });

  it('uses the Tamil hint label with --tamil', () => {
    const file = write('cli/bad-tamil.js', BAD_LITERAL_SOURCE);
    const r = cli(['--tamil', 'lint', file]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /குறிப்பு: /);
    assert.doesNotMatch(r.stdout, /hint: /);
  });

  it('exits 1 and reports OT001 in file:line:column form', () => {
    const file = write('cli/bad-literal.js', BAD_LITERAL_SOURCE);
    const r = cli(['lint', file]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, new RegExp(`^${file.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}:1:9: \\[OT001\\]`));
    assert.match(r.stdout, /hint:/);
    assert.match(r.stdout, /Summary: 1 problem in 1 file \(1 file scanned\)\./);
    assert.equal(fs.readFileSync(file, 'utf8'), BAD_LITERAL_SOURCE);
  });

  it('exits 1 and reports OT002 for a JavaScript syntax error', () => {
    const file = write('cli/bad-js.js', BAD_JS_SOURCE);
    const r = cli(['lint', file]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /\[OT002\]/);
    assert.match(r.stdout, /javascript-syntax/);
  });

  it('scans a directory, skips node_modules/.git, and exits 0 when clean', () => {
    write('cli/dirtree/a-good.js', GOOD_SOURCE);
    write('cli/dirtree/b-clean.mjs', 'export const n = $௨;\n');
    write('cli/dirtree/node_modules/in.js', BAD_LITERAL_SOURCE);
    write('cli/dirtree/.git/old.js', BAD_LITERAL_SOURCE);
    const r = cli(['lint', path.join(workdir, 'cli', 'dirtree')]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /No lint problems found \(2 files scanned\)\./);
  });

  it('reports the first problem per file across a directory with exit 1', () => {
    write('cli/dirty/a-good.js', GOOD_SOURCE);
    write('cli/dirty/z-bad.js', BAD_LITERAL_SOURCE);
    write('cli/dirty/node_modules/in.js', BAD_LITERAL_SOURCE);
    const dir = path.join(workdir, 'cli', 'dirty');
    const r = cli(['lint', dir]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /z-bad\.js:1:9: \[OT001\]/);
    assert.ok(!r.stdout.includes('node_modules'), 'node_modules is skipped');
    assert.match(r.stdout, /Summary: 1 problem in 1 file \(2 files scanned\)\./);
    assert.deepEqual(listTempLeftovers(path.join(dir, 'node_modules')), []);
  });

  it('handles a missing path gracefully (exit 1, stderr)', () => {
    const missing = path.join(workdir, 'cli', 'nope.js');
    const r = cli(['lint', missing]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /file not found/);
  });

  it('validates arguments with exit code 2', () => {
    const none = cli(['lint']);
    assert.equal(none.status, 2);
    assert.match(none.stderr, /missing file or directory argument/);

    const two = cli(['lint', 'a.js', 'b.js']);
    assert.equal(two.status, 2);
    assert.match(two.stderr, /exactly one file or directory argument/);
  });

  it('lint --help prints usage and exits 0', () => {
    const r = cli(['lint', '--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage: tamilscript lint/);
    assert.match(r.stdout, /OT001/);
    assert.match(r.stdout, /OT002/);
  });

  it('works on Windows paths containing spaces', () => {
    const file = write('cli/dir with spaces/prog.js', BAD_LITERAL_SOURCE);
    const r = cli(['lint', file]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /\[OT001\]/);
  });
});
