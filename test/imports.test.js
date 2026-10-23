'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findSpecifierSpans, tempExtensionFor } = require('../src/imports');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');

describe('dependency rewriting', () => {
  it('finds static, dynamic and re-export specifiers only in code', () => {
    const spans = findSpecifierSpans(
      'import a from "./a.js";\nimport "./b.js";\nexport { x } from "./c.js";\nrequire("./d.js");\nimport("./e.js");\n'
    );
    assert.deepEqual(spans.map((s) => s.value), ['./a.js', './b.js', './c.js', './d.js', './e.js']);
    assert.deepEqual(findSpecifierSpans('const s = "require(./fake.js)";').length, 0);
    assert.deepEqual(findSpecifierSpans('// require("./c.js")').length, 0);
  });

  it('decodes string escapes in specifiers before resolving', () => {
    assert.deepEqual(
      findSpecifierSpans('const v = require("./hel\\x70er.js");').map((s) => s.value),
      ['./helper.js']
    );
    assert.deepEqual(
      findSpecifierSpans('import v from "./hel\\u0070er.js";').map((s) => s.value),
      ['./helper.js']
    );
    assert.deepEqual(
      findSpecifierSpans('import v from "./\\u{68}elper.js";').map((s) => s.value),
      ['./helper.js']
    );
    assert.deepEqual(
      findSpecifierSpans('require("./a\\tb.js"); require("./c\\u2028d.js");').map((s) => s.value),
      ['./a\tb.js', './c\u2028d.js']
    );
    // Line continuations contribute nothing to the cooked value.
    assert.deepEqual(findSpecifierSpans('require("./a\\\nb.js");').map((s) => s.value), ['./ab.js']);
  });

  it('rewrites escaped and backslash specifiers to the real dependency', { skip: process.platform !== 'win32' ? 'Windows-only specifier form' : false }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-esc-'));
    try {
      // A quoted directory name forces the rewritten temp path to contain a
      // quote; JSON-quoting the replacement keeps the program parseable.
      const sub = path.join(dir, "quo'te");
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(path.join(dir, 'helper.cjs'), 'module.exports = $௧ + 41;\n', 'utf8');
      fs.writeFileSync(path.join(sub, 'helper.cjs'), 'module.exports = $௨ + 40;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'main.cjs'),
        'const a = require("./hel\\x70er.cjs");\nconst b = require(".\\\\quo\'te\\\\helper.cjs");\nconsole.log(a, b);\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.cjs')], { encoding: 'utf8' });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), '42 42');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rewrites escaped ESM specifiers without a platform guard', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-esc-esm-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
      fs.writeFileSync(path.join(dir, 'helper.js'), 'export default $௧ + 41;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        'import v from "./hel\\u0070er.js?x=1";\nconsole.log(v);\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], { encoding: 'utf8' });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), '42');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rewrites optional require and plain template specifiers', () => {
    // `require?.('./x')` and static-template `` import(`./x`) `` are valid
    // Node calls; both used to run the raw Tamil dependency and fail.
    assert.deepEqual(
      findSpecifierSpans("require?.('./helper.cjs');").map((s) => s.value),
      ['./helper.cjs']
    );
    assert.deepEqual(
      findSpecifierSpans('import(`./helper.js`);').map((s) => s.value),
      ['./helper.js']
    );
    assert.deepEqual(
      findSpecifierSpans('require(`./helper.cjs`);').map((s) => s.value),
      ['./helper.cjs']
    );
    // Templates with substitutions stay dynamic: no static specifier.
    assert.deepEqual(findSpecifierSpans('import(`./${name}.js`);'), []);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-opt-'));
    try {
      fs.writeFileSync(path.join(dir, 'helper.cjs'), 'module.exports = $௧ + 41;\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'main.cjs'), "console.log(require?.('./helper.cjs'));\n", 'utf8');
      const cjs = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.cjs')], { encoding: 'utf8' });
      assert.equal(cjs.status, 0, `stderr: ${cjs.stderr}`);
      assert.equal(cjs.stdout.trim(), '42');

      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
      fs.writeFileSync(path.join(dir, 'helper.js'), 'export default $௨ + 40;\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'main.js'), 'const v = await import(`./helper.js`);\nconsole.log(v.default);\n', 'utf8');
      const esm = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], { encoding: 'utf8' });
      assert.equal(esm.status, 0, `stderr: ${esm.stderr}`);
      assert.equal(esm.stdout.trim(), '42');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips block comments when looking backwards for require context', () => {
    // `obj./*c*/require("./x")` is a method call, not Node's require.
    assert.deepEqual(findSpecifierSpans('obj./*c*/require("./x");'), []);
    // A commented `function /*c*/ require() {}` is a declaration, not a call.
    assert.deepEqual(findSpecifierSpans('function /*c*/ require("./x") {}'), []);
    // Leading comments do not hide a real require call.
    assert.deepEqual(
      findSpecifierSpans('/*c*/ require("./real.js");').map((s) => s.value),
      ['./real.js']
    );
    assert.deepEqual(
      findSpecifierSpans('function* /*c*/ gen() {}\nrequire("./real.js");').map((s) => s.value),
      ['./real.js']
    );
  });

  it('ignores module-looking text inside a regex after a block', () => {
    assert.deepEqual(findSpecifierSpans('if (true) {} /require("x")/.test(s);'), []);
    assert.deepEqual(findSpecifierSpans('function f() {} /import("x")/.test(s);'), []);
    const spans = findSpecifierSpans('if (true) {} /foo/; require("./real.js");');
    assert.deepEqual(spans.map((s) => s.value), ['./real.js']);
  });

  it('runs nested relative dependencies (a -> b -> c) with Tamil literals', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-nest-'));
    try {
      fs.writeFileSync(path.join(dir, 'c.js'), 'module.exports = $௩;\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'b.js'), 'const c = require("./c.js");\nmodule.exports = c + $௨;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'a.js'),
        'const b = require("./b.js");\nconsole.log(b + $௧);\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'a.js')], { encoding: 'utf8' });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), '6');
      // originals untouched
      assert.match(fs.readFileSync(path.join(dir, 'c.js'), 'utf8'), /\$௩/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs dynamic import() of a Tamil helper', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-dyn-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
      fs.writeFileSync(path.join(dir, 'helper.js'), 'export const n = $௨௧;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        'const { n } = await import("./helper.js");\nconsole.log(n);\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], { encoding: 'utf8' });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), '21');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sniffs CommonJS when import/export appear only inside comments and strings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-sniff-'));
    try {
      fs.writeFileSync(path.join(dir, 'helper.js'), 'module.exports = { value: $௭ };\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'comment.js'),
        '/*\nimport x from "./nope.js";\n*/\nconst h = require("./helper.js");\nconsole.log("CJS", h.value);\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, 'template.js'),
        'const doc = `\nexport const fake = 1;\n`;\nconst h = require("./helper.js");\nconsole.log("CJS", h.value, doc.length > 0);\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, 'dynamic.js'),
        'const h = require("./helper.js");\n(async () => {\n  const m = await import("./helper.js");\n  console.log("CJS", h.value, !!m.default);\n})();\n',
        'utf8'
      );
      for (const name of ['comment.js', 'template.js', 'dynamic.js']) {
        const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, name)], { encoding: 'utf8' });
        assert.equal(r.status, 0, `${name} stderr: ${r.stderr}`);
        assert.match(r.stdout, /CJS/);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still sniffs ES modules without a package.json (positive control)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-sniff-esm-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        'export const n = $௨௧;\nconsole.log("ESM", n);\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], { encoding: 'utf8' });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout, /ESM 21/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves relative specifiers for dependencies in subdirectories', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-subdir-'));
    try {
      fs.mkdirSync(path.join(dir, 'lib', 'deep'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'lib', 'deep', 'inner.js'), 'module.exports = $௧;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'lib', 'helper.js'),
        'module.exports = require("./deep/inner.js") + $௧;\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        'console.log(require("./lib/helper.js") + require("./lib/deep/inner.js"));\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], { encoding: 'utf8' });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), '3');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rewrites require() calls after keywords such as return', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-kw-'));
    try {
      fs.writeFileSync(path.join(dir, 't.js'), 'module.exports = $௨;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'entry.js'),
        'const f = function () { return require("./t.js"); };\nconsole.log(f() + $௧);\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'entry.js')], { encoding: 'utf8' });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), '3');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not rewrite computed require() arguments', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-computed-'));
    try {
      fs.writeFileSync(path.join(dir, 'helper.js'), 'module.exports = 21;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        'const suffix = ".js";\nconsole.log(require("./helper" + suffix));\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], { encoding: 'utf8' });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), '21');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps concise-arrow await import() as CommonJS', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-arrow-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        'const load = async () => await import("node:fs");\n' +
          'const fs = require("node:fs");\n' +
          'console.log(typeof load, typeof fs.readFileSync);\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], { encoding: 'utf8' });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), 'function function');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects a static import after a leading semicolon in a package-less directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-semi-'));
    try {
      fs.writeFileSync(path.join(dir, 'helper.js'), 'export const n = $௨௧;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        '; import { n } from "./helper.js";\nconsole.log(n);\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], { encoding: 'utf8' });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), '21');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still detects package-less top-level await as ESM', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-tla-'));
    try {
      fs.writeFileSync(path.join(dir, 'helper.js'), 'export const n = $௫;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        'const { n } = await import("./helper.js");\nconsole.log(n);\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], { encoding: 'utf8' });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.equal(r.stdout.trim(), '5');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves ?query and #fragment on rewritten ESM specifiers', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-query-'));
    try {
      fs.writeFileSync(path.join(dir, 'helper.js'), 'export default import.meta.url;\n', 'utf8');
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        'import url from "./helper.js?probe#frag";\nconsole.log(url);\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], { encoding: 'utf8' });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.match(r.stdout.trim(), /tamilscript-[^/\\]+\.mjs\?probe#frag$/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves no temp files behind after run', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-clean-'));
    try {
      fs.writeFileSync(path.join(dir, 'h.js'), 'module.exports = $௧;\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'm.js'), 'console.log(require("./h.js"));\n', 'utf8');
      const before = new Set(fs.readdirSync(dir));
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'm.js')], { encoding: 'utf8' });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.deepEqual(new Set(fs.readdirSync(dir)), before);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('temporary module extension selection', () => {
  it('preserves explicit syntax and package type, sniffing only package-less sources', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-ext-'));
    try {
      assert.equal(await tempExtensionFor(path.join(root, 'a.mjs'), 'module.exports = 1;\n'), '.mjs');
      assert.equal(await tempExtensionFor(path.join(root, 'a.cjs'), 'export const n = 1;\n'), '.cjs');

      const moduleDir = path.join(root, 'pkg-module');
      fs.mkdirSync(moduleDir);
      fs.writeFileSync(path.join(moduleDir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
      assert.equal(await tempExtensionFor(path.join(moduleDir, 'a.js'), 'export const n = 1;\n'), '.js');

      const commonjsDir = path.join(root, 'pkg-commonjs');
      fs.mkdirSync(commonjsDir);
      fs.writeFileSync(path.join(commonjsDir, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');
      assert.equal(await tempExtensionFor(path.join(commonjsDir, 'a.js'), 'export const n = 1;\n'), '.js');

      const plainDir = path.join(root, 'plain');
      fs.mkdirSync(plainDir);
      assert.equal(await tempExtensionFor(path.join(plainDir, 'cjs.js'), 'module.exports = 1;\n'), '.cjs');
      assert.equal(await tempExtensionFor(path.join(plainDir, 'esm.js'), 'export const n = 1;\n'), '.mjs');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
