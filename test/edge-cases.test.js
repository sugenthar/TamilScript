'use strict';

// v0.3.0 audit gap coverage: BOM, empty/identity inputs, CLI filenames,
// --stdout newlines, atomic writes, API validation, declaration checks,
// determinism and performance smoke. Deterministic, no network, Node >= 18.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');
const api = require('../src/index.js');

let workdir;
before(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-edge-'));
});
after(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

function cli(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: ROOT });
}
function tmp(name, content) {
  const p = path.join(workdir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

describe('edge: BOM, empty and passthrough inputs', () => {
  it('preserves a UTF-8 BOM and still transforms literals after it', () => {
    assert.equal(api.transform('\uFEFFlet a = 1;\n'), '\uFEFFlet a = 1;\n');
    assert.equal(api.transform('\uFEFFlet a = $\u0BE7;\n'), '\uFEFFlet a = 1;\n');
  });
  it('keeps a leading BOM zero-width for diagnostics', () => {
    // Node.js strips the BOM before parsing and editors keep it out of
    // document text, so line-1 columns must not count it. `let x = ` is
    // eight characters: the `$` is 1-based column 9 in both worlds.
    assert.throws(
      () => api.transform('\uFEFFlet x = $\u0BE9.\u0BEB.;'),
      (err) => {
        assert.equal(err.code, 'JST_BAD_NUMERIC_LITERAL');
        assert.equal(err.line, 1);
        assert.equal(err.column, 9);
        return true;
      }
    );
    // Mid-file ZWNBSP is ordinary whitespace and still counts.
    assert.throws(
      () => api.transform('let a = 1;\uFEFFlet x = $\u0BE9.\u0BEB.;'),
      (err) => err.line === 1 && err.column > 9
    );
  });
  it('transforms empty source to empty source', () => {
    assert.equal(api.transform(''), '');
  });
  it('leaves files with no Tamil literals byte-identical', () => {
    const s = 'const x = 1 + 2;\nconsole.log(x);\n';
    assert.equal(api.transform(s), s);
  });
  it('keeps CRLF endings and hashbang lines intact', () => {
    assert.equal(api.transform('let a = $\u0BE7;\r\nconsole.log(a);\r\n'), 'let a = 1;\r\nconsole.log(a);\r\n');
    assert.equal(api.transform('#!/usr/bin/env node\nlet a = $\u0BE7;\n'), '#!/usr/bin/env node\nlet a = 1;\n');
  });
  it('runs BOM and CRLF files via the CLI', () => {
    const bom = tmp('bom.js', '\uFEFFlet a = $\u0BE7;\nconsole.log(a);\n');
    const r1 = cli(['run', bom]);
    assert.equal(r1.status, 0, r1.stderr);
    assert.equal(r1.stdout, '1\n');
    const crlf = tmp('crlf.js', 'let a = $\u0BE7;\r\nconsole.log(a);\r\n');
    const r2 = cli(['run', crlf]);
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(r2.stdout, '1\n');
  });
});

describe('edge: adjacent and repeated literals', () => {
  it('rejects glued literals deterministically with a stable code', () => {
    for (let k = 0; k < 2; k++) {
      assert.throws(() => api.transform('let a = $\u0BE7$\u0BE8;'), (e) => (
        e.name === 'JsTamilSyntaxError' && e.code === 'JST_BAD_NUMERIC_LITERAL' && e.line === 1 && e.column === 9
      ));
    }
  });
  it('handles many literals on one line and repeats deterministically', () => {
    const s = 'let a = [$\u0BE7, $\u0BE8, $\u0BE9];\n';
    assert.equal(api.transform(s), 'let a = [1, 2, 3];\n');
    assert.equal(api.transform(s), api.transform(s));
  });
  it('reports exact source columns for later literals on the same line', () => {
    // `let a = ` is 8 chars, `$௧௨` occupies cols 9-11, `,` + space follow,
    // so the second `$` is at column 14.
    try {
      api.transform('let a = $\u0BE7\u0BE8, $\u0BE7x;');
      assert.fail('should have thrown');
    } catch (e) {
      assert.equal(e.name, 'JsTamilSyntaxError');
      assert.equal(e.code, 'JST_BAD_NUMERIC_LITERAL');
      assert.equal(e.line, 1);
      assert.equal(e.column, 14);
    }
    const { events } = api.transformWithMeta('let a = $\u0BE7\u0BE8, $\u0BE9;');
    assert.equal(events.length, 2);
    assert.equal(events[0].column, 9);
    assert.equal(events[1].column, 14);
  });
});

describe('edge: removed $ strings and columns', () => {
  it('rejects the removed $ string forms with the migration code', () => {
    for (const src of ['let s = $"a\\"b";', "let s = $'it\\'s';", 'let s = $"";']) {
      assert.throws(() => api.transform(src), (e) => (
        e.name === 'JsTamilSyntaxError' && e.code === 'JST_TAMIL_STRING_REMOVED' && e.column === 9
      ), src);
    }
  });
  it('leaves ordinary JavaScript escapes to Node.js unchanged', () => {
    assert.equal(api.transform('let s = "a\\"b\\\\c\\n\\u0B85";'), 'let s = "a\\"b\\\\c\\n\\u0B85";');
    assert.equal(api.transform('let s = "\\x41\\u0042\\u{1F600}";'), 'let s = "\\x41\\u0042\\u{1F600}";');
    assert.equal(api.transform("let s = 'it\\'s';"), "let s = 'it\\'s';");
  });
  it('counts columns in UTF-16 units before reported errors', () => {
    // Emoji = 2 UTF-16 units, space = 1, so `$` sits at column 4.
    try {
      api.transform('\uD83D\uDE00 $\u0BE7x;');
      assert.fail('should have thrown');
    } catch (e) {
      assert.equal(e.name, 'JsTamilSyntaxError');
      assert.equal(e.column, 4);
    }
  });
});

describe('edge: CLI filenames and --stdout', () => {
  it('runs files with spaces and Unicode characters in the name', () => {
    const f = tmp('hello world \u0BA4\u0BAE\u0BBF\u0BB4\u0BCD.js', 'let a = $\u0BE7\u0BE8;\nconsole.log(a);\n');
    const r = cli(['run', f]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '12\n');
  });
  it('emits exactly one trailing newline on --stdout', () => {
    const withNl = tmp('o1.js', 'let a = $\u0BE7;\n');
    const r1 = cli(['transform', withNl, '--stdout']);
    assert.equal(r1.status, 0, r1.stderr);
    assert.equal(r1.stdout, 'let a = 1;\n');
    const withoutNl = tmp('o2.js', 'let a = $\u0BE7;');
    const r2 = cli(['transform', withoutNl, '--stdout']);
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(r2.stdout, 'let a = 1;\n');
  });
});

describe('edge: atomic writes leave no temp debris', () => {
  it('writes exact content and no .tamilscript-*.tmp files on success', async () => {
    const inp = tmp('a-in.js', 'let a = $\u0BE7\u0BE8;\n');
    const out = path.join(workdir, 'sub', 'a-out.js');
    const got = await api.transformFile(inp, out);
    assert.equal(got, 'let a = 12;\n');
    assert.equal(fs.readFileSync(out, 'utf8'), 'let a = 12;\n');
    assert.deepEqual(fs.readdirSync(path.join(workdir, 'sub')).filter((f) => f.includes('.tamilscript-')), []);
  });
  it('cleans its temp file when the destination cannot be written', async () => {
    const inp = tmp('b-in.js', 'let a = $\u0BE7;\n');
    const blocked = path.join(workdir, 'blocked');
    fs.mkdirSync(blocked, { recursive: true });
    await assert.rejects(() => api.transformFile(inp, blocked));
    assert.deepEqual(fs.readdirSync(workdir).filter((f) => f.includes('.tamilscript-')), []);
    assert.deepEqual(fs.readdirSync(blocked).filter((f) => f.includes('.tamilscript-')), []);
  });
});

describe('edge: API validation and declarations', () => {
  it('inlineSourceMapComment rejects non-map input with TypeError', () => {
    for (const bad of [null, undefined, 42, 'x', []]) {
      assert.throws(() => api.inlineSourceMapComment(bad), TypeError);
    }
    const { map } = api.transformWithMap('let a = $\u0BE7;\n', { filename: 'p.js' });
    assert.match(api.inlineSourceMapComment(map), /sourceMappingURL=data:/);
  });
  it('file APIs reject empty paths consistently', async () => {
    await assert.rejects(() => api.transformFile(''), TypeError);
    const bad = await api.checkFile(path.join(workdir, 'does-not-exist-xyz.js'));
    assert.equal(bad.ok, false);
  });
  it('TypeScript declarations describe the public surface', () => {
    const dts = fs.readFileSync(path.join(ROOT, 'src', 'index.d.ts'), 'utf8');
    for (const want of [
      'JsTamilError', 'JsTamilSyntaxError', 'TamilScriptError', 'TamilScriptSyntaxError',
      'ErrorCodes', 'formatDiagnostic',
      'toNumber', 'toTamilNumerals', 'parseTamilDecimal', 'toTamilDecimal',
      'transform', 'transformWithMap', 'transformWithMeta', 'transformFile',
      'runFile', 'checkFile', 'inlineSourceMapComment', 'VERSION',
    ]) {
      assert.match(dts, new RegExp(want), `index.d.ts missing ${want}`);
    }
    assert.match(dts, /extraArgs\?: string\[\]/, 'runFile options gap');
    assert.match(dts, /nodeFlags\?: string\[\]/, 'runFile nodeFlags gap');
  });
  it('package declares only the parser dependency needed for syntax validation', () => {
    const pkg = require('../package.json');
    // Acorn is deliberately the only runtime dependency: it provides
    // parser-backed diagnostics without evaluating user code and has no
    // transitive dependencies of its own.
    assert.deepEqual(Object.keys(pkg.dependencies || {}), ['acorn']);
    assert.equal(pkg.optionalDependencies, undefined);
    assert.equal(pkg.peerDependencies, undefined);
    assert.equal(pkg.name, 'tamilscript');
    // npm normalizes the bin path ("./bin/tamilscript.js" -> "bin/tamilscript.js");
    // both forms produce an identical installed shim. Assert the exact single
    // mapping and its target while tolerating the optional leading "./".
    assert.deepEqual(Object.keys(pkg.bin), ['tamilscript']);
    assert.match(pkg.bin.tamilscript, /^(\.\/)?bin\/tamilscript\.js$/);
  });
});

describe('edge: determinism and large-input smoke', () => {
  it('repeat transforms are byte-identical on a large input', () => {
    const line = 'let a = $\u0BE7\u0BE8 + $\u0BE9;\n';
    const src = line.repeat(2000);
    const once = api.transform(src);
    const twice = api.transform(src);
    assert.equal(once, twice);
    assert.match(once, /let a = 12 \+ 3;/);
  });
});
