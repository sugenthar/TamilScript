'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { transformWithMap } = require('../src/index');
const { buildTransformedTree } = require('../src/imports');
const {
  encodeVlq,
  decodeVlq,
  buildSourceMap,
  decodeMappings,
  inlineSourceMapComment,
} = require('../src/sourcemap');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');

describe('sourcemap: VLQ codec', () => {
  it('round-trips representative values', () => {
    for (const n of [0, 1, 2, 7, 8, 15, 16, -1, -11, 100, 1000, 123456]) {
      const enc = encodeVlq(n);
      const dec = decodeVlq(enc, 0);
      assert.equal(dec.value, n, `vlq(${n})`);
      assert.equal(dec.next, enc.length);
    }
  });

  it('rejects invalid characters', () => {
    assert.throws(() => decodeVlq('!', 0), /Invalid VLQ/);
  });
});

describe('sourcemap: map structure', () => {
  it('builds a valid v3 map with identity line mapping', () => {
    const source = 'let a = $௧௮;\nlet b = "x";\nconsole.log(a, b);\n';
    const { code, map } = transformWithMap(source, { filename: 'ex.js' });
    assert.equal(code, 'let a = 18;\nlet b = "x";\nconsole.log(a, b);\n');
    assert.equal(map.version, 3);
    assert.deepEqual(map.sources, ['ex.js']);
    assert.deepEqual(map.sourcesContent, [source]);
    assert.deepEqual(map.names, []);
    const decoded = decodeMappings(map.mappings);
    assert.equal(decoded.length, code.split('\n').length);
    // Every output line maps back to the same source line.
    decoded.forEach((segments, outLine) => {
      assert.ok(segments.length > 0, `line ${outLine} has segments`);
      assert.equal(segments[0].gen, 0);
      assert.equal(segments[0].srcLine, outLine);
      assert.equal(segments[0].srcCol, 0);
    });
  });

  it('maps literal columns exactly outside replaced spans', () => {
    const source = 'let a = $௧௮;\n';
    const { map } = transformWithMap(source, { filename: 'ex.js' });
    const line0 = decodeMappings(map.mappings)[0];
    // Dense token anchors: gen 0/4/6/8 map 1:1, gen 8 ($ position) -> src
    // (0,8), gen 10 -> src (0,11) at the replacement end and the `;`.
    assert.deepEqual(line0.map((s) => [s.gen, s.srcLine, s.srcCol]), [
      [0, 0, 0],
      [4, 0, 4],
      [6, 0, 6],
      [8, 0, 8],
      [10, 0, 11],
    ]);
  });

  it('maps decimal literal columns exactly outside replaced spans', () => {
    const source = 'let b = $௩.௫;\n';
    const { code, map } = transformWithMap(source, { filename: 'ex.js' });
    assert.equal(code, 'let b = 3.5;\n');
    const line0 = decodeMappings(map.mappings)[0];
    assert.deepEqual(line0.map((s) => [s.gen, s.srcLine, s.srcCol]), [
      [0, 0, 0],
      [4, 0, 4],
      [6, 0, 6],
      [8, 0, 8],
      [11, 0, 12],
    ]);
  });

  it('keeps output line count identical to source', () => {
    const source = 'let a = $௧;\nlet b = $௧.௫;\nconsole.log(a, b);\n';
    const { code, map } = transformWithMap(source, {});
    assert.equal(code.split('\n').length, source.split('\n').length);
    assert.equal(decodeMappings(map.mappings).length, source.split('\n').length);
    // A literal on a crowded line must not disturb later lines.
    const long = 'const first = 1; const second = 2; const third = 3; const a = $௧;\nlet b = "x";\n';
    const r = transformWithMap(long, {});
    assert.equal(r.code.split('\n').length, long.split('\n').length);
    assert.equal(decodeMappings(r.map.mappings).length, long.split('\n').length);
  });

  it('keeps the line count for lone-CR line endings', () => {
    const source = 'let a = $௧;\rlet b = "x";\rconsole.log(a, b);\r';
    const { code, map } = transformWithMap(source, { filename: 'cr.js' });
    const lineCount = source.split(/\r\n|\r|\n/).length;
    assert.equal(code.split(/\r\n|\r|\n/).length, lineCount);
    assert.equal(decodeMappings(map.mappings).length, lineCount);
    decodeMappings(map.mappings).forEach((segments, outLine) => {
      assert.ok(segments.length > 0, `line ${outLine} has segments`);
      assert.equal(segments[0].srcLine, outLine);
    });
  });

  it('inline comment is a data URL Node understands', () => {
    const { map } = transformWithMap('let a = 1;\n', { filename: 'f.js' });
    const comment = inlineSourceMapComment(map);
    assert.match(comment.trim(), /^\/\/# sourceMappingURL=data:application\/json;charset=utf-8;base64,/);
    const decoded = JSON.parse(
      Buffer.from(comment.split('base64,')[1], 'base64').toString('utf8')
    );
    assert.equal(decoded.version, 3);
  });
});

describe('sourcemap: stack traces point at original files', () => {
  it('maps a runtime error in the entry file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-map-'));
    try {
      const file = path.join(dir, 'prog.js');
      fs.writeFileSync(
        file,
        'let x = $௧௮;\nfunction boom() {\n  throw new Error("kaput-entry");\n}\nconsole.log(x);\nboom();\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', file], { encoding: 'utf8' });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /kaput-entry/);
      // Original filename with the correct line — never a TamilScript-*
      // temp *file* (the temp *directory* prefix is fine and expected).
      assert.match(r.stderr, /prog\.js:3/);
      assert.doesNotMatch(r.stderr, /tamilscript-(prog|main|helper)-/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports exact stack columns at token starts on every line', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-map-'));
    try {
      const file = path.join(dir, 'columns.js');
      const src = 'let x = $௧;\nthrow new Error("cols");\n';
      fs.writeFileSync(file, src, 'utf8');
      // Line 2 has no replacement but must still map its own column, not 1.
      const r = spawnSync(process.execPath, [BIN, 'run', file], { encoding: 'utf8' });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /columns\.js:2:7/);
      // Same line: the literal shortens `1`, so the column after it must be
      // shifted by the replacement delta.
      const sameLine = 'const a = $௧; throw new Error("cols2");\n';
      fs.writeFileSync(file, sameLine, 'utf8');
      const expected = sameLine.split('\n')[0].indexOf('new Error') + 1;
      const r2 = spawnSync(process.execPath, [BIN, 'run', file], { encoding: 'utf8' });
      assert.equal(r2.status, 1);
      assert.match(r2.stderr, new RegExp(`columns\\.js:1:${expected}\\b`));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maps a runtime error in a lone-CR file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-map-'));
    try {
      const file = path.join(dir, 'crash.js');
      fs.writeFileSync(file, 'const a = 1;\rconst b = 2;\rthrow new Error("kaput-cr");\r', 'utf8');
      const r = spawnSync(process.execPath, [BIN, 'run', file], { encoding: 'utf8' });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /kaput-cr/);
      assert.match(r.stderr, /crash\.js:3/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports the removed string form at its own source line and column', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-map-'));
    try {
      const file = path.join(dir, 'removed.js');
      fs.writeFileSync(file, 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst s = $"x";\n', 'utf8');
      const r = spawnSync(process.execPath, [BIN, 'run', file], { encoding: 'utf8' });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /removed\.js:4:11/);
      assert.match(r.stderr, /JST_TAMIL_STRING_REMOVED/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maps a runtime error inside a relative dependency', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-map-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'helper.js'),
        'function fail() {\n  throw new Error("kaput-dep");\n}\nmodule.exports = { fail, n: $௪௨ };\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        'const h = require("./helper.js");\nconsole.log(h.n);\nh.fail();\n',
        'utf8'
      );
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], {
        encoding: 'utf8',
      });
      assert.equal(r.status, 1);
      assert.match(r.stdout, /42/);
      assert.match(r.stderr, /kaput-dep/);
      assert.match(r.stderr, /helper\.js:2/);
      assert.doesNotMatch(r.stderr, /tamilscript-(prog|main|helper)-/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maps ESM stack traces', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-map-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');
      fs.writeFileSync(dir + '/main.js', 'const v = $௧.௫;\nthrow new Error("kaput-esm");\n', 'utf8');
      const r = spawnSync(process.execPath, [BIN, 'run', path.join(dir, 'main.js')], {
        encoding: 'utf8',
      });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /main\.js:2/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shifts literal columns past rewritten specifiers on a lone-CR line', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-map-'));
    try {
      fs.writeFileSync(path.join(dir, 'dep.js'), 'module.exports = 1;\r', 'utf8');
      const entry = path.join(dir, 'main.js');
      const src =
        'const z = 1;\rconst d = require("./dep.js"); const a = $\u0BE7\u0BE8;\rconsole.log(d, a);\r';
      fs.writeFileSync(entry, src, 'utf8');
      const { transform } = require('../src/index');
      const tree = await buildTransformedTree(entry, transform(src, { filename: entry }), {
        entrySource: src,
        withMaps: true,
      });
      try {
        const body = fs.readFileSync(tree.entryTemp, 'utf8');
        const outLine = body.split(/\r\n|\r|\n/)[1];
        const m = body.match(/sourceMappingURL=data:application\/json;charset=utf-8;base64,([A-Za-z0-9+/=]+)/);
        assert.ok(m, 'inline map present');
        const map = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
        const segs = decodeMappings(map.mappings)[1];
        const srcLine = src.split(/\r\n|\r|\n/)[1];
        const anchor = 'const a = ';
        const anchorIdx = outLine.indexOf(anchor);
        assert.notEqual(anchorIdx, -1);
        const genCol = anchorIdx + anchor.length;
        const srcCol = srcLine.indexOf('$\u0BE7\u0BE8');
        assert.notEqual(srcCol, -1);
        const open = segs.find((s) => s.gen === genCol);
        assert.ok(open, `segment at generated col ${genCol}`);
        assert.equal(open.srcCol, srcCol, 'literal maps back to its source column');
      } finally {
        for (const f of tree.tempFiles) {
          try { fs.unlinkSync(f); } catch (err) { void err; }
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shifts literal columns past rewritten specifiers on the same line', async () => {
    // Regression: buildTransformedTree once dropped the rewrite-shift
    // (extra argument), leaving same-line literals mapped at their
    // pre-rewrite columns while the generated text had moved.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-map-'));
    try {
      fs.writeFileSync(path.join(dir, 'dep.js'), 'module.exports = 1;\n', 'utf8');
      const entry = path.join(dir, 'main.js');
      const src = 'const d = require("./dep.js"); const a = $\u0BE7\u0BE8; const b = $\u0BE9; console.log(d, a, b);\n';
      fs.writeFileSync(entry, src, 'utf8');
      const { transform } = require('../src/index');
      const tree = await buildTransformedTree(entry, transform(src, { filename: entry }), {
        entrySource: src,
        withMaps: true,
      });
      try {
        const body = fs.readFileSync(tree.entryTemp, 'utf8');
        const outLine = body.split('\n')[0];
        const m = body.match(/sourceMappingURL=data:application\/json;charset=utf-8;base64,([A-Za-z0-9+/=]+)/);
        assert.ok(m, 'inline map present');
        const map = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
        const segs = decodeMappings(map.mappings)[0];
        const srcLine = src.split('\n')[0];
        for (const [tamil, anchor] of [['$\u0BE7\u0BE8', 'const a = '], ['$\u0BE9', 'const b = ']]) {
          const anchorIdx = outLine.indexOf(anchor);
          assert.notEqual(anchorIdx, -1);
          const genCol = anchorIdx + anchor.length;
          const srcCol = srcLine.indexOf(tamil);
          assert.notEqual(srcCol, -1);
          const open = segs.find((s) => s.gen === genCol);
          assert.ok(open, `segment at generated col ${genCol}`);
          assert.equal(open.srcCol, srcCol, `literal ${tamil} maps back to its source column`);
        }
      } finally {
        for (const f of tree.tempFiles) {
          try { fs.unlinkSync(f); } catch (err) { void err; }
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
