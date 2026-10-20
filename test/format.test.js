'use strict';

// Conservative formatter (`tamilscript format`): whitespace normalization
// outside protected spans only, idempotence, byte-preservation of Tamil
// content, BOM/CRLF handling, --check semantics, and safe failure modes.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { formatSource, mergeSpans } = require('../src/format');
const { JsTamilSyntaxError } = require('../src/errors');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');

let workdir;
before(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-format-'));
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

describe('format: formatSource', () => {
  it('removes trailing whitespace outside protected spans and keeps it inside', () => {
    const src =
      'let a = $௧;\t  \n' +
      '// note  \n' +
      'let b = "x  ";\n' +
      '\t \n' +
      'const c = `t  `;\n' +
      'const r = /a b/;   \n';
    const expected =
      'let a = $௧;\n' +
      '// note  \n' +
      'let b = "x  ";\n' +
      '\n' +
      'const c = `t  `;\n' +
      'const r = /a b/;\n';
    assert.equal(formatSource(src), expected);
  });

  it('adds a missing final line break (LF and CRLF)', () => {
    assert.equal(formatSource('let a = $௧;'), 'let a = $௧;\n');
    assert.equal(formatSource('let a = 1;\r\nlet b = 2;'), 'let a = 1;\r\nlet b = 2;\r\n');
  });

  it('trims trailing whitespace before CRLF and keeps CRLF', () => {
    assert.equal(formatSource('let a = 1;   \r\n'), 'let a = 1;\r\n');
  });

  it('preserves a leading UTF-8 BOM', () => {
    assert.equal(formatSource('\uFEFFlet a = $௧;  '), '\uFEFFlet a = $௧;\n');
  });

  it('preserves multiline template content byte-for-byte', () => {
    const src = 'const t = `a  \nb  ${$௧}  c`;  \n';
    const out = formatSource(src);
    assert.equal(out, 'const t = `a  \nb  ${$௧}  c`;\n');
    assert.equal(formatSource(out), out);
  });

  it('preserves Tamil literals and content exactly', () => {
    const src = 'const வாழ்த்து = "வணக்கம், உலகம்!  ";\nஅச்சிடு(வாழ்த்து, $௧.௫, $௧௮);   \n';
    const out = formatSource(src);
    assert.equal(out, 'const வாழ்த்து = "வணக்கம், உலகம்!  ";\nஅச்சிடு(வாழ்த்து, $௧.௫, $௧௮);\n');
  });

  it('is idempotent', () => {
    const samples = [
      'let a = $௧;  \n\n\n',
      '/* c  */\nlet b = 2;',
      'let s = "a\\\nb  ";  \n',
      'if (x) {  \n\ty();\t\n}\n',
    ];
    for (const src of samples) {
      const once = formatSource(src);
      assert.equal(formatSource(once), once, JSON.stringify(src));
    }
  });

  it('returns the empty string for empty input', () => {
    assert.equal(formatSource(''), '');
  });

  it('refuses malformed TamilScript without changing it', () => {
    assert.throws(
      () => formatSource('let s = $"oops;\n'),
      (err) => err instanceof JsTamilSyntaxError && err.code === 'JST_TAMIL_STRING_REMOVED'
    );
  });

  it('merges nested protected spans', () => {
    const merged = mergeSpans([
      { kind: 'template', start: 0, end: 10 },
      { kind: 'string', start: 3, end: 6 },
      { kind: 'string', start: 20, end: 22 },
    ]);
    assert.deepEqual(merged, [
      { start: 0, end: 10 },
      { start: 20, end: 22 },
    ]);
  });
});

describe('format: CLI', () => {
  it('formats a file in place and reports the change', () => {
    const file = write('dirty.js', 'let a = $௧;  \nlet b = "x";\t\n');
    const r = cli(['format', file]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Formatted /);
    assert.equal(fs.readFileSync(file, 'utf8'), 'let a = $௧;\nlet b = "x";\n');
  });

  it('reports already formatted files and writes nothing', () => {
    const file = write('clean.js', 'let a = $௧;\n');
    const before = fs.statSync(file).mtimeMs;
    const r = cli(['format', file]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /is already formatted/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'let a = $௧;\n');
    assert.equal(fs.statSync(file).mtimeMs, before);
  });

  it('--check reports differences with exit 1 and never writes', () => {
    const file = write('check-dirty.js', 'let a = $௧;   \n');
    const r = cli(['format', file, '--check']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /would be reformatted/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'let a = $௧;   \n');
  });

  it('--check exits 0 for an already formatted file', () => {
    const file = write('check-clean.js', 'let a = $௧;\n');
    const r = cli(['format', file, '--check']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /is already formatted/);
  });

  it('does not modify unrelated files', () => {
    const target = write('touched.js', 'let a = 1;  \n');
    const other = write('untouched.js', 'let b = 2;  \n');
    const r = cli(['format', target]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(target, 'utf8'), 'let a = 1;\n');
    assert.equal(fs.readFileSync(other, 'utf8'), 'let b = 2;  \n');
  });

  it('refuses malformed input and leaves it byte-identical', () => {
    const bad = 'let s = $"oops;\n';
    const file = write('bad.js', bad);
    const r = cli(['format', file]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no longer supported/);
    assert.equal(fs.readFileSync(file, 'utf8'), bad);
  });

  it('handles missing files and directories gracefully', () => {
    const missing = cli(['format', path.join(workdir, 'nope.js')]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /file not found/);

    const dir = cli(['format', workdir]);
    assert.equal(dir.status, 1);
    assert.match(dir.stderr, /not a file \(directory\)/);
  });

  it('validates arguments with exit code 2', () => {
    const none = cli(['format']);
    assert.equal(none.status, 2);
    assert.match(none.stderr, /missing file argument/);

    const two = cli(['format', 'a.js', 'b.js']);
    assert.equal(two.status, 2);
    assert.match(two.stderr, /exactly one file argument/);

    const bogus = cli(['format', '--bogus', 'a.js']);
    assert.equal(bogus.status, 2);
    assert.match(bogus.stderr, /unexpected argument/);
  });

  it('format --help prints usage and exits 0', () => {
    const r = cli(['format', '--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage: tamilscript format/);
    assert.match(r.stdout, /--check/);
  });

  it('works on Windows paths containing spaces', () => {
    const file = write('dir with spaces/prog.js', 'let a = $௧;  \n');
    const r = cli(['format', file]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(file, 'utf8'), 'let a = $௧;\n');
  });
});
