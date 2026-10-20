'use strict';

// Diagnostics regression test suite covering Phase 4 requirements:
// 1. Tamil integer literal $௧௮.
// 2. Tamil decimal literal $௧௨.௫.
// 3. Tamil decimal with a leading zero, $௦.௫.
// 4. The $-prefixed Tamil string syntax ($"..." migration diagnostic).
// 5. Tamil identifiers and the அச்சிடு() helper.
// 6. Automatic language switching for supported TamilScript file extensions.
// 7. Ordinary JavaScript files remaining in JavaScript mode.
// 8. Invalid TamilScript syntax producing an appropriate diagnostic.
// 9. Genuinely invalid JavaScript expression reporting where promised.
// 10. Diagnostic updates after a document is corrected.
// 11. Stale diagnostics being cleared.
// 12. Existing grammar and extension behavior remaining intact.
//
// Pure ASCII source; Tamil code points are constructed via String.fromCodePoint.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeHandlers } = require('../extension');
const lang = require('../tamilscriptLang');
const { makeFakeVscode, makeDoc } = require('./fake-vscode');

const EXT_DIR = path.resolve(__dirname, '..');
const CORE = () => lang.resolveCore({ localDir: EXT_DIR }).api;

// Unicode helpers for Tamil characters
const D = (n) => String.fromCodePoint(0x0be6 + n);
const T1 = D(1);
const T2 = D(2);
const T5 = D(5);
const T8 = D(8);
const T0 = D(0);
const T18 = T1 + T8;
const T12 = T1 + T2;

// Tamil words in Unicode
const U = (hex) => String.fromCodePoint(parseInt(hex, 16));
const VANAKKAM = ['0BB5', '0BA3', '0B95', '0BCD', '0B95', '0BAE', '0BCD'].map(U).join('');
const THAMIL = ['0BA4', '0BAE', '0BBF', '0BB4', '0BCD'].map(U).join('');
const ACHCHIDU = ['0B85', '0B9A', '0BCD', '0B9A', '0BBF', '0B9F', '0BC1'].map(U).join('');
const VALTHU = ['0BB5', '0BBE', '0BB4', '0BCD', '0BA4', '0BCD', '0BA4', '0BC1'].map(U).join('');

function setup(options) {
  const vscode = makeFakeVscode(options);
  const h = makeHandlers(vscode, { extensionDir: EXT_DIR });
  return { vscode, h };
}

describe('diagnostics regression suite (Phase 4)', () => {
  const api = CORE();

  // 1. Tamil integer literal $௧௮
  it('1. accepts Tamil integer literal $௧௮ without diagnostics', () => {
    const src = 'const value = $' + T18 + ';\n';
    const res = lang.validateText(api, src, 'int.js');
    assert.deepEqual(res, { ok: true });
    assert.equal(api.transform(src), 'const value = 18;\n');

    const { h } = setup();
    const doc = makeDoc(src, 'tamilscript', '/w/int.ot.js');
    const docRes = h.validateDocument(doc);
    assert.equal(docRes.ok, true);
    assert.equal(h.collection.get(doc.uri), undefined);
  });

  // 2. Tamil decimal literal $௧௨.௫
  it('2. accepts Tamil decimal literal $௧௨.௫ without diagnostics in tamilscript mode', () => {
    const src = 'const price = $' + T12 + '.' + T5 + ';\n';
    const res = lang.validateText(api, src, 'dec.js');
    assert.deepEqual(res, { ok: true });
    assert.equal(api.transform(src), 'const price = 12.5;\n');

    const { h } = setup();
    const doc = makeDoc(src, 'tamilscript', '/w/dec.ot.js');
    const docRes = h.validateDocument(doc);
    assert.equal(docRes.ok, true);
    assert.equal(h.collection.get(doc.uri), undefined);
  });

  // 3. Tamil decimal with a leading zero, $௦.௫
  it('3. accepts Tamil decimal with a leading zero ($௦.௫) without diagnostics', () => {
    const src = 'const fraction = $' + T0 + '.' + T5 + ';\n';
    const res = lang.validateText(api, src, 'zero-dec.js');
    assert.deepEqual(res, { ok: true });
    assert.equal(api.transform(src), 'const fraction = 0.5;\n');

    const { h } = setup();
    const doc = makeDoc(src, 'tamilscript', '/w/frac.ot.js');
    const docRes = h.validateDocument(doc);
    assert.equal(docRes.ok, true);
    assert.equal(h.collection.get(doc.uri), undefined);
  });

  // 4. The $-prefixed Tamil string syntax ($"..." migration diagnostic)
  it('4. reports JST_TAMIL_STRING_REMOVED for removed $"..." string syntax', () => {
    const src = 'const message = $"' + VANAKKAM + '";\n';
    const res = lang.validateText(api, src, 'string.js');
    assert.equal(res.ok, false);
    assert.equal(res.diagnostic.code, 'JST_TAMIL_STRING_REMOVED');
    assert.equal(res.diagnostic.name, 'JsTamilSyntaxError');
    assert.equal(res.diagnostic.line, 0);
    assert.equal(res.diagnostic.column, 16); // position of `$"..."`
    assert.match(res.diagnostic.message, /no longer supported/);

    const { h } = setup();
    const doc = makeDoc(src, 'tamilscript', '/w/string.ot.js');
    const docRes = h.validateDocument(doc);
    assert.equal(docRes.ok, false);
    const diags = h.collection.get(doc.uri);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].source, 'tamilscript');
    assert.match(diags[0].message, /JST_TAMIL_STRING_REMOVED/);
  });

  // 5. Tamil identifiers and the அச்சிடு() helper
  it('5. accepts Tamil identifiers and the அச்சிடு() print helper as valid JavaScript', () => {
    const src =
      'const ' + VALTHU + ' = "' + VANAKKAM + '";\n' +
      ACHCHIDU + '(' + VALTHU + ');\n';
    const res = lang.validateText(api, src, 'tamil-id.js');
    assert.deepEqual(res, { ok: true });
    // Identifiers and helper calls pass through untouched
    assert.equal(api.transform(src), src);

    const { h } = setup();
    const doc = makeDoc(src, 'tamilscript', '/w/tamil-id.ot.js');
    const docRes = h.validateDocument(doc);
    assert.equal(docRes.ok, true);
    assert.equal(h.collection.get(doc.uri), undefined);
  });

  // 6. Automatic language switching for supported TamilScript file extensions
  it('6. auto-switches JavaScript files containing Tamil literals to tamilscript', async () => {
    const { vscode, h } = setup();
    const doc = makeDoc('const price = $' + T12 + '.' + T5 + ';\n', 'javascript', '/w/app.js');
    const res = await h.maybeAutoSwitch(doc);
    assert.equal(res.ok, true);
    assert.equal(res.languageId, 'tamilscript');
    assert.equal(doc.languageId, 'tamilscript');
    assert.equal(vscode.languageSwitches.length, 1);
    assert.equal(vscode.languageSwitches[0].languageId, 'tamilscript');
  });

  // 7. Ordinary JavaScript files remaining in JavaScript mode
  it('7. leaves ordinary JavaScript files in JavaScript mode without auto-switching', async () => {
    const { vscode, h } = setup();
    const plainSrc = 'const count = 18;\nconst message = "Hello";\nconsole.log(count, message);\n';
    const doc = makeDoc(plainSrc, 'javascript', '/w/plain.js');
    const res = await h.maybeAutoSwitch(doc);
    assert.equal(res.skipped, true);
    assert.equal(res.reason, 'no tamil literals');
    assert.equal(doc.languageId, 'javascript');
    assert.equal(vscode.languageSwitches.length, 0);
  });

  // 8. Invalid TamilScript syntax producing an appropriate diagnostic
  it('8. flags invalid TamilScript syntax with accurate location and diagnostic code', () => {
    const cases = [
      {
        src: 'let a = $' + T1 + '2;\n',
        expectedCode: 'JST_BAD_NUMERIC_LITERAL',
        col: 8,
      },
      {
        src: 'let b = $' + T1 + '.5;\n',
        expectedCode: 'JST_MIXED_NUMERAL',
        col: 8,
      },
      {
        src: 'let c = $' + T12 + '.' + T5 + '.;\n',
        expectedCode: 'JST_BAD_NUMERIC_LITERAL',
        col: 8,
      },
      {
        src: 'let d = $' + T1 + 'n;\n',
        expectedCode: 'JST_UNSUPPORTED_BIGINT',
        col: 8,
      },
    ];

    for (const c of cases) {
      const res = lang.validateText(api, c.src, 'invalid.js');
      assert.equal(res.ok, false, `must reject: ${c.src}`);
      assert.equal(res.diagnostic.code, c.expectedCode);
      assert.equal(res.diagnostic.column, c.col);

      const { h } = setup();
      const doc = makeDoc(c.src, 'tamilscript', '/w/test.ot.js');
      h.validateDocument(doc);
      const diags = h.collection.get(doc.uri);
      assert.equal(diags.length, 1);
      assert.equal(diags[0].source, 'tamilscript');
      assert.match(diags[0].message, new RegExp(c.expectedCode));
    }
  });

  // 9. Genuinely invalid JavaScript expression reporting where promised
  it('9. ordinary JavaScript files with syntax errors stay in javascript mode for built-in validator', async () => {
    const { vscode, h } = setup();
    // Genuinely invalid JavaScript syntax without Tamil literals:
    const invalidJs = 'const value = ;\n';
    const doc = makeDoc(invalidJs, 'javascript', '/w/invalid-js.js');

    // The extension does not claim or auto-switch this file:
    const switchRes = await h.maybeAutoSwitch(doc);
    assert.equal(switchRes.skipped, true);
    assert.equal(doc.languageId, 'javascript');
    assert.equal(vscode.languageSwitches.length, 0);
    // In JavaScript mode, the built-in TypeScript/JavaScript validator attaches
    // and reports syntax errors (such as ts(1109) Expression expected).
  });

  // 10. Diagnostic updates after a document is corrected
  it('10. updates and clears diagnostics after a document is corrected', () => {
    const { h } = setup();
    // Step 1: document has an error
    const badDoc = makeDoc('const s = $"' + VANAKKAM + '";\n', 'tamilscript', '/w/file.ot.js');
    const badRes = h.validateDocument(badDoc);
    assert.equal(badRes.ok, false);
    assert.equal(h.collection.get(badDoc.uri).length, 1);

    // Step 2: document is corrected
    const fixedDoc = makeDoc('const s = "' + VANAKKAM + '";\n', 'tamilscript', '/w/file.ot.js');
    const fixedRes = h.validateDocument(fixedDoc);
    assert.equal(fixedRes.ok, true);
    // Diagnostic collection for this URI is now empty/undefined
    assert.equal(h.collection.get(fixedDoc.uri), undefined);
  });

  // 11. Stale diagnostics being cleared
  it('11. clears diagnostics when document is closed or changes to unsupported mode', () => {
    const { h } = setup();
    const doc = makeDoc('const s = $"' + VANAKKAM + '";\n', 'tamilscript', '/w/close.ot.js');
    h.validateDocument(doc);
    assert.equal(h.collection.get(doc.uri).length, 1);

    // Document closed:
    h.clearDocument(doc);
    assert.equal(h.collection.get(doc.uri), undefined);

    // Re-set error, then change language mode to plaintext:
    h.validateDocument(doc);
    assert.equal(h.collection.get(doc.uri).length, 1);
    doc.languageId = 'plaintext';
    const plainRes = h.validateDocument(doc);
    assert.deepEqual(plainRes, { skipped: true });
    assert.equal(h.collection.get(doc.uri), undefined);
  });

  // 12. Existing grammar and extension behavior remaining intact
  it('12. full and injection grammars compile and scope Tamil literals properly', () => {
    const fullGrammar = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'syntaxes', 'tamilscript.tmLanguage.json'), 'utf8'));
    const injGrammar = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'syntaxes', 'tamilscript.injection.tmLanguage.json'), 'utf8'));

    // Check scope names and injection selectors
    assert.equal(fullGrammar.scopeName, 'source.tamilscript');
    assert.equal(injGrammar.scopeName, 'tamilscript.injection');
    assert.match(injGrammar.injectionSelector, /source\.js/);

    // Verify all patterns compile as valid RegExp
    for (const g of [fullGrammar, injGrammar]) {
      for (const p of g.patterns) {
        if (p.match) assert.doesNotThrow(() => new RegExp(p.match, 'u'));
      }
    }

    // Verify numeric literal patterns exist
    const fullNumeric = fullGrammar.patterns.filter((p) => p.name === 'constant.numeric.tamilscript');
    assert.equal(fullNumeric.length, 2); // decimal and integer rules
  });
});
