'use strict';

// Standalone `transform` output: programs that mention the Tamil print
// helper get a small inlined runtime prelude, so the transformed file runs
// under plain `node` — no installed tamilscript package, no manual edits.
// These tests spawn `node` directly in bare temp directories (no
// node_modules anywhere up the tree) and compare exact bytes. The helper
// name and Tamil text stay \u escapes so this file is pure ASCII.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');
const api = require('../src/index.js');
const { addStandaloneRuntime, preludeText, insertionOffset } = require('../src/standalone');
const { decodeMappings } = require('../src/sourcemap');

const PRINT = '\u0B85\u0B9A\u0BCD\u0B9A\u0BBF\u0B9F\u0BC1'; // அச்சிடு
const VANAKKAM = '\u0BB5\u0BA3\u0B95\u0BCD\u0B95\u0BAE\u0BCD'; // வணக்கம்
const D = (n) => String.fromCodePoint(0x0BE6 + n); // ௦..௯

const PRELUDE_HEADER = '// TamilScript standalone runtime:';

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-standalone-'));
}

function cli(args, options) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: ROOT, ...options });
}

function runNode(file, options) {
  return spawnSync(process.execPath, [file], { encoding: 'utf8', ...options });
}

// Shells, CI systems and editors set FORCE_COLOR; the prelude must not let
// Node's console colorize numbers or objects in captured output.
function colorForcedEnv() {
  return { ...process.env, FORCE_COLOR: '1' };
}

describe('standalone transform output', () => {
  it('CLI `transform -o` output runs under plain node (the reported reproduction)', () => {
    const dir = mktmp();
    try {
      const input = path.join(dir, 'test.js');
      const output = path.join(dir, 'test.transformed.js');
      fs.writeFileSync(
        input,
        `const age = $${D(1)}${D(8)};\n${PRINT}(${JSON.stringify(VANAKKAM + ':')}, age);\n`,
        'utf8'
      );
      const r = cli(['transform', input, '-o', output]);
      assert.equal(r.status, 0, r.stderr);
      const generated = fs.readFileSync(output, 'utf8');
      assert.ok(generated.startsWith(PRELUDE_HEADER), 'prelude must precede the program');
      assert.ok(generated.includes(`${PRINT}(${JSON.stringify(VANAKKAM + ':')}, age);`), 'body survives');

      const run = runNode(output, { cwd: dir, env: colorForcedEnv() });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, `${VANAKKAM}: 18\n`);
      assert.doesNotMatch(run.stdout, /\u001b\[/);

      // The existing workflow keeps producing the same bytes.
      const viaRun = cli(['run', input], { env: colorForcedEnv() });
      assert.equal(viaRun.status, 0, viaRun.stderr);
      assert.equal(viaRun.stdout, run.stdout);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('transformFile() output runs under plain node too', async () => {
    const dir = mktmp();
    try {
      const input = path.join(dir, 'app.js');
      const output = path.join(dir, 'app.out.js');
      fs.writeFileSync(input, `${PRINT}(${JSON.stringify(VANAKKAM + '!')}, $${D(3)}${D(6)});\n`, 'utf8');
      const returned = await api.transformFile(input, output);
      assert.equal(returned, fs.readFileSync(output, 'utf8'));
      assert.ok(returned.includes(PRELUDE_HEADER));
      const run = runNode(output, { cwd: dir });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, `${VANAKKAM}! 36\n`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('CLI `transform --stdout` output runs when saved to a file', () => {
    const dir = mktmp();
    try {
      const input = path.join(dir, 'in.js');
      const output = path.join(dir, 'out.js');
      fs.writeFileSync(input, `${PRINT}(${JSON.stringify(VANAKKAM)});\n`, 'utf8');
      const r = cli(['transform', input, '--stdout']);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.startsWith(PRELUDE_HEADER));
      fs.writeFileSync(output, r.stdout, 'utf8');
      const run = runNode(output, { cwd: dir });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, `${VANAKKAM}\n`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('produces .mjs and .cjs outputs that run (the prelude has no module syntax)', () => {
    const dir = mktmp();
    try {
      const input = path.join(dir, 'src.js');
      fs.writeFileSync(input, `${PRINT}(${JSON.stringify(VANAKKAM + ':')}, $${D(1)}${D(8)});\n`, 'utf8');
      for (const ext of ['mjs', 'cjs']) {
        const output = path.join(dir, `out.${ext}`);
        const r = cli(['transform', input, '-o', output]);
        assert.equal(r.status, 0, r.stderr);
        const run = runNode(output, { cwd: dir, env: colorForcedEnv() });
        assert.equal(run.status, 0, `${ext}: ${run.stderr}`);
        assert.equal(run.stdout, `${VANAKKAM}: 18\n`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves programs without the helper byte-identical', async () => {
    const dir = mktmp();
    try {
      const input = path.join(dir, 'plain.js');
      const output = path.join(dir, 'plain.out.js');
      const source = `let a = $${D(1)}${D(2)};\nconsole.log(a);\n`;
      fs.writeFileSync(input, source, 'utf8');
      await api.transformFile(input, output);
      const expected = api.transform(source);
      assert.equal(fs.readFileSync(output, 'utf8'), expected);
      assert.ok(!expected.includes('globalThis'), 'no prelude for plain programs');
      const r = cli(['transform', input, '--stdout']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, expected);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps a leading hashbang line first and still runs', () => {
    const dir = mktmp();
    try {
      const input = path.join(dir, 'cli.js');
      const output = path.join(dir, 'cli.out.js');
      fs.writeFileSync(input, `#!/usr/bin/env node\n${PRINT}(${JSON.stringify(VANAKKAM)});\n`, 'utf8');
      const r = cli(['transform', input, '-o', output]);
      assert.equal(r.status, 0, r.stderr);
      const generated = fs.readFileSync(output, 'utf8');
      assert.ok(generated.startsWith('#!/usr/bin/env node\n'), 'hashbang must stay the first line');
      assert.ok(generated.includes(PRELUDE_HEADER));
      const run = runNode(output, { cwd: dir });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, `${VANAKKAM}\n`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps a leading 'use strict' directive active", () => {
    const dir = mktmp();
    try {
      const input = path.join(dir, 'strict.js');
      const output = path.join(dir, 'strict.out.js');
      // A plain function call has `this === undefined` only in strict mode.
      fs.writeFileSync(input, `'use strict';\n${PRINT}((function () { return this === undefined; })());\n`, 'utf8');
      const r = cli(['transform', input, '-o', output]);
      assert.equal(r.status, 0, r.stderr);
      const generated = fs.readFileSync(output, 'utf8');
      assert.ok(generated.startsWith("'use strict';\n"), 'prelude must come after the directive');
      const run = runNode(output, { cwd: dir });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, 'true\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a lone-CR prelude injection at the start of the next line', () => {
    const code = `'use strict';\r${PRINT}(1);\r`;
    const result = addStandaloneRuntime(code, code);
    assert.deepEqual(result.injection, {
      line: 1,
      column: 0,
      lines: preludeText().split('\n').length - 1,
    });
  });

  it('handles a directive and code on the same line, with an accurate map', () => {
    const dir = mktmp();
    try {
      const input = path.join(dir, 'mid.js');
      const output = path.join(dir, 'mid.out.js');
      fs.writeFileSync(input, `'use strict'; ${PRINT}((function () { return this === undefined; })());\n`, 'utf8');
      const r = cli(['transform', input, '-o', output, '--source-map']);
      assert.equal(r.status, 0, r.stderr);
      const generated = fs.readFileSync(output, 'utf8');
      assert.ok(generated.startsWith("'use strict';"), 'directive stays first');
      const map = JSON.parse(fs.readFileSync(`${output}.map`, 'utf8'));
      const body = generated.replace(/\n\/\/# sourceMappingURL=[^\n]*\n$/, '');
      const decoded = decodeMappings(map.mappings);
      assert.equal(decoded.length, body.split('\n').length, 'one mapping line per generated line');
      const tailLine = body.split('\n').findIndex((l) => l.includes('return this === undefined'));
      assert.ok(tailLine > 1, 'split tail is on a later generated line');
      assert.equal(decoded[tailLine][0].srcLine, 0, 'tail still points at source line 1');
      const run = runNode(output, { cwd: dir });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, 'true\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adjusts the external source map for the inserted prelude lines', () => {
    const dir = mktmp();
    try {
      const input = path.join(dir, 'map-src.js');
      const output = path.join(dir, 'map-out.js');
      fs.writeFileSync(
        input,
        `const age = $${D(1)}${D(8)};\n${PRINT}("mapped:", age);\nthrow new Error("boom-standalone");\n`,
        'utf8'
      );
      const r = cli(['transform', input, '-o', output, '--source-map']);
      assert.equal(r.status, 0, r.stderr);
      const generated = fs.readFileSync(output, 'utf8');
      const map = JSON.parse(fs.readFileSync(`${output}.map`, 'utf8'));
      const body = generated.replace(/\n\/\/# sourceMappingURL=[^\n]*\n$/, '');
      const decoded = decodeMappings(map.mappings);
      assert.equal(decoded.length, body.split('\n').length, 'one mapping line per generated line');
      const throwLine = body.split('\n').findIndex((l) => l.includes('throw new Error'));
      assert.equal(decoded[throwLine][0].srcLine, 2, 'throw maps to source line 3');
      const run = spawnSync(process.execPath, ['--enable-source-maps', output], {
        encoding: 'utf8',
        cwd: dir,
      });
      assert.notEqual(run.status, 0);
      assert.match(run.stderr, /boom-standalone/);
      assert.match(run.stderr, /map-src\.js:3/, 'stack trace points at the original file');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves a leading BOM and still runs', () => {
    const dir = mktmp();
    try {
      const input = path.join(dir, 'bom.js');
      const output = path.join(dir, 'bom.out.js');
      fs.writeFileSync(input, `\uFEFF${PRINT}(${JSON.stringify(VANAKKAM)});\n`, 'utf8');
      const r = cli(['transform', input, '-o', output]);
      assert.equal(r.status, 0, r.stderr);
      const generated = fs.readFileSync(output, 'utf8');
      assert.equal(generated.charCodeAt(0), 0xfeff, 'BOM preserved');
      const run = runNode(output, { cwd: dir });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, `${VANAKKAM}\n`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never overwrites a program-local helper', () => {
    const dir = mktmp();
    try {
      const input = path.join(dir, 'local.js');
      const output = path.join(dir, 'local.out.js');
      fs.writeFileSync(
        input,
        `function ${PRINT}() { process.stdout.write('local\\n'); }\n${PRINT}();\n`,
        'utf8'
      );
      const r = cli(['transform', input, '-o', output]);
      assert.equal(r.status, 0, r.stderr);
      const run = runNode(output, { cwd: dir });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, 'local\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the injected prelude behaves exactly like tamilscript/runtime in a child', () => {
    const dir = mktmp();
    try {
      const statements = [
        'P();',
        'P(18);',
        'P({ a: 1 }, [1, "x"], true, null, undefined);',
        'P("%s=%d %j", "x", 7, { a: 1 });',
      ].join('\n');
      const refPath = path.join(dir, 'reference.js');
      const standalonePath = path.join(dir, 'standalone.js');
      fs.writeFileSync(
        refPath,
        `const runtime = require(${JSON.stringify(path.join(ROOT, 'src', 'runtime.js'))});\n` +
          `const P = runtime[${JSON.stringify(PRINT)}];\n${statements}\n`,
        'utf8'
      );
      fs.writeFileSync(
        standalonePath,
        `${preludeText()}const P = globalThis[${JSON.stringify(PRINT)}];\n${statements}\n`,
        'utf8'
      );
      const ref = runNode(refPath, { cwd: dir, env: colorForcedEnv() });
      const standalone = runNode(standalonePath, { cwd: dir, env: colorForcedEnv() });
      assert.equal(ref.status, 0, ref.stderr);
      assert.equal(standalone.status, 0, standalone.stderr);
      assert.equal(standalone.stdout, ref.stdout);
      assert.doesNotMatch(standalone.stdout, /\u001b\[/, 'no ANSI even under FORCE_COLOR');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prelude uses no module syntax and installs only the helper global', () => {
    const text = preludeText();
    assert.doesNotMatch(text, /\brequire\s*\(/);
    assert.doesNotMatch(text, /^\s*import\b/m);
    assert.doesNotMatch(text, /^\s*export\b/m);
    assert.match(text, /globalThis\[/);
    assert.ok(text.endsWith('\n'));
  });

  it('never mistakes a string expression for a directive', () => {
    assert.equal(insertionOffset('"use strict" + x;\ncode();\n').offset, 0);
    assert.equal(insertionOffset('"use strict".length;\ncode();\n').offset, 0);
    assert.equal(insertionOffset('"use strict";\ncode();\n').offset, 14);
    assert.equal(insertionOffset('"use strict"\ncode();\n').offset, 13);
    assert.equal(insertionOffset('"a"; "b";\ncode();\n').offset, 10);
    assert.equal(insertionOffset('/* c */ "use strict";\ncode();\n').offset, 22);
  });
});
