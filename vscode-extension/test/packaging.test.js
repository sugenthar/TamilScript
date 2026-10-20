'use strict';

// Packaging tests: manifest wiring, snippets, language config, hygiene.
// Tamil text is built with String.fromCodePoint so this file stays ASCII.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'package.json'), 'utf8'));

function refExists(rel) {
  assert.ok(
    fs.existsSync(path.join(DIR, rel.replace(/^\.\//, ''))),
    `contributed file missing: ${rel}`
  );
}

describe('extension manifest', () => {
  it('declares a compatible engine and no runtime dependencies', () => {
    assert.match(manifest.engines.vscode, /\^1\.\d+/);
    assert.equal(manifest.dependencies, undefined);
    assert.equal(manifest.main, './extension.js');
    assert.ok(fs.existsSync(path.join(DIR, 'extension.js')));
    assert.ok(fs.existsSync(path.join(DIR, 'tamilscriptLang.js')));
    assert.equal(manifest.name, 'tamilscript-vscode');
    assert.equal(manifest.displayName, 'TamilScript');
    // The Marketplace publisher identity is deliberately unchanged.
    assert.equal(manifest.publisher, 'opentamizh');
  });

  it('registers languages, grammars, snippets, and commands consistently', () => {
    const langs = manifest.contributes.languages.map((l) => l.id);
    assert.ok(langs.includes('tamilscript'));
    for (const l of manifest.contributes.languages) {
      if (l.configuration) refExists(l.configuration);
    }
    // The only file-extension claim is the opt-in .ot.js suffix; bare
    // .js/.mjs/.cjs files are never taken over.
    const otLanguage = manifest.contributes.languages.find((l) => l.id === 'tamilscript');
    assert.deepEqual(otLanguage.extensions, ['.ot.js']);
    for (const l of manifest.contributes.languages) {
      for (const ext of l.extensions || []) {
        assert.ok(
          !['.js', '.mjs', '.cjs', '.jsx'].includes(ext),
          `must not claim global extension ${ext}`
        );
      }
    }
    for (const g of manifest.contributes.grammars) {
      refExists(g.path);
      JSON.parse(fs.readFileSync(path.join(DIR, g.path.replace(/^\.\//, '')), 'utf8'));
    }
    const inj = manifest.contributes.grammars.find((g) => g.scopeName === 'tamilscript.injection');
    assert.deepEqual(inj.injectTo, ['source.js', 'source.js.jsx', 'source.tamilscript']);
    for (const s of manifest.contributes.snippets) {
      refExists(s.path);
      JSON.parse(fs.readFileSync(path.join(DIR, s.path.replace(/^\.\//, '')), 'utf8'));
    }
    const cmds = manifest.contributes.commands.map((c) => c.command);
    for (const id of ['tamilscript.checkFile', 'tamilscript.transformFile', 'tamilscript.runFile', 'tamilscript.showVersion', 'tamilscript.setLanguageMode']) {
      assert.ok(cmds.includes(id), `missing command ${id}`);
      assert.ok(
        (manifest.activationEvents || []).some((e) => e === `onCommand:${id}`),
        `missing activation event for ${id}`
      );
      const legacyId = id.replace(/^tamilscript\./, 'opentamizh.');
      assert.ok(!cmds.includes(legacyId), `legacy command must not be contributed: ${legacyId}`);
      assert.ok(
        (manifest.activationEvents || []).some((e) => e === `onCommand:${legacyId}`),
        `missing legacy activation event for ${legacyId}`
      );
    }
  });

  it('exposes safe configuration defaults', () => {
    const props = manifest.contributes.configuration.properties;
    assert.equal(props['tamilscript.enableDiagnostics'].default, true);
    assert.equal(props['tamilscript.debounceMs'].default, 300);
    assert.equal(props['tamilscript.corePath'].default, '');
    assert.equal(props['tamilscript.autoLanguageMode'].default, true);
  });

  it('ships license, readme, changelog, and ignore rules', () => {
    for (const f of ['LICENSE', 'README.md', 'CHANGELOG.md', '.vscodeignore', 'language-configuration.json']) {
      assert.ok(fs.existsSync(path.join(DIR, f)), `missing ${f}`);
    }
    const ignore = fs.readFileSync(path.join(DIR, '.vscodeignore'), 'utf8');
    assert.match(ignore, /test/);
    assert.match(ignore, /integration/);
  });
});

describe('snippets', () => {
  const D = (n) => String.fromCodePoint(0x0be6 + n);
  const T18 = D(1) + D(8);

  it('every snippet has a prefix, body, and description', () => {
    const snip = JSON.parse(fs.readFileSync(path.join(DIR, 'snippets', 'tamilscript.json'), 'utf8'));
    const names = Object.keys(snip);
    assert.ok(names.length >= 8, `expected >= 8 snippets, got ${names.length}`);
    for (const [name, s] of Object.entries(snip)) {
      assert.ok(s.prefix && typeof s.prefix === 'string', `${name}: prefix`);
      assert.ok(s.body && (typeof s.body === 'string' || Array.isArray(s.body)), `${name}: body`);
      assert.ok(s.description, `${name}: description`);
    }
    const prefixes = Object.values(snip).map((s) => s.prefix);
    assert.equal(new Set(prefixes).size, prefixes.length, 'snippet prefixes must be unique');
    for (const want of ['otprint', 'otrequire', 'otimport']) {
      assert.ok(prefixes.includes(want), `missing snippet prefix: ${want}`);
    }
    // The `$"..."` string literal form was removed, so its snippets are gone.
    for (const gone of ['otstr', 'otstrs']) {
      assert.ok(!prefixes.includes(gone), `removed snippet prefix still present: ${gone}`);
    }
  });

  it('snippet bodies render Tamil literals after placeholder expansion', () => {
    const snip = JSON.parse(fs.readFileSync(path.join(DIR, 'snippets', 'tamilscript.json'), 'utf8'));
    const render = (body) => {
      const text = Array.isArray(body) ? body.join('\n') : body;
      return text
        .replace(/\\\$/g, '$')
        .replace(/\$\{\d+:([^}]*)\}/g, '$1')
        .replace(/\$\d+/g, '');
    };
    const bodies = Object.values(snip).map((s) => render(s.body)).join('\n');
    assert.ok(bodies.includes('$' + T18), 'some snippet renders a Tamil integer');
    assert.ok(bodies.includes('let ') && bodies.includes('console.log'), 'runnable example parts');
  });

  it('new helper snippets render code the core transformer accepts verbatim', () => {
    const snip = JSON.parse(fs.readFileSync(path.join(DIR, 'snippets', 'tamilscript.json'), 'utf8'));
    const byPrefix = {};
    for (const s of Object.values(snip)) byPrefix[s.prefix] = s;
    const vm = require('node:vm');
    const core = require('../../src/index.js');
    const T = (h) => String.fromCodePoint(parseInt(h, 16));
    const PRINT = ['0B85', '0B9A', '0BCD', '0B9A', '0BBF', '0B9F', '0BC1'].map(T).join('');
    // otprint renders a plain identifier call: the transformer must pass it
    // through byte-identically, and it must parse as JavaScript.
    const renderedPrint = `${PRINT}(value);`;
    assert.equal(byPrefix.otprint.body.replace(/\$\{\d+:([^}]*)\}/g, '$1'), renderedPrint);
    assert.equal(core.transform(renderedPrint), renderedPrint);
    new vm.Script(renderedPrint);
    // The import snippets must reference the documented entry point, name
    // the helper, and survive transformation untouched (import statements
    // are not executable scripts, so vm.Script does not apply to otimport).
    for (const prefix of ['otrequire', 'otimport']) {
      const body = byPrefix[prefix].body;
      assert.ok(body.includes('tamilscript/runtime'), `${prefix} references tamilscript/runtime`);
      assert.ok(body.includes(PRINT), `${prefix} names the helper`);
      assert.equal(core.transform(body), body);
    }
    new vm.Script(byPrefix.otrequire.body);
  });
});

describe('language configuration', () => {
  it('defines comments, brackets, and a Tamil-aware word pattern', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'language-configuration.json'), 'utf8'));
    assert.equal(cfg.comments.lineComment, '//');
    assert.deepEqual(cfg.comments.blockComment, ['/*', '*/']);
    assert.ok(cfg.brackets.some((b) => b[0] === '{' && b[1] === '}'));
    const re = new RegExp('^(?:' + cfg.wordPattern + ')$', 'u');
    const T = (h) => String.fromCodePoint(parseInt(h, 16));
    assert.ok(re.test('$abc'));
    assert.ok(re.test(T('0BE6')));
    assert.ok(re.test(T('0BEF')));
  });

  it('indents after open braces but not inside closed or quoted spans', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'language-configuration.json'), 'utf8'));
    const inc = new RegExp(cfg.indentationRules.increaseIndentPattern, 'u');
    const dec = new RegExp(cfg.indentationRules.decreaseIndentPattern, 'u');
    assert.ok(inc.test('function f() {'), 'open brace indents');
    assert.ok(!inc.test('if (x) { y(); }'), 'closed span does not indent');
    assert.ok(!inc.test('const s = "${x}";'), 'brace inside quotes does not indent');
    assert.ok(inc.test('const s = `${x'), 'open template substitution indents');
    assert.ok(!inc.test('let x = 1;'), 'plain code does not indent');
    assert.ok(dec.test('}'), 'close brace outdents');
    assert.ok(dec.test('  ]'), 'indented bracket outdents');
    assert.ok(!dec.test('let x = 1;'), 'plain code does not outdent');
    assert.ok(dec.test('} else {'), 'else line outdents first');
  });
});

describe('extension source hygiene', () => {
  it('never shells out or writes user files', () => {
    for (const f of ['extension.js', 'tamilscriptLang.js']) {
      const src = fs.readFileSync(path.join(DIR, f), 'utf8');
      assert.doesNotMatch(src, /child_process/, `${f} must not spawn processes`);
      assert.doesNotMatch(src, /spawnSync|execFile|exec\(/, `${f} must not execute commands`);
      assert.doesNotMatch(src, /writeFile/, `${f} must never write user files`);
    }
  });
});
