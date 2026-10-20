'use strict';

// Auto language-mode tests: a JavaScript document that contains TamilScript
// literals is switched to the dedicated `tamilscript` language mode (where
// VS Code's built-in TypeScript validator does not attach), plain JavaScript
// is never touched, and an explicit user switch back is respected.
// Tamil text is built with String.fromCodePoint so this file stays ASCII.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { activate, makeHandlers } = require('../extension');
const lang = require('../tamilscriptLang');
const { makeFakeVscode, makeDoc } = require('./fake-vscode');

const D = (n) => String.fromCodePoint(0x0be6 + n);
const T18 = D(1) + D(8);
const EXT_DIR = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The representative file from the red-squiggle report: Tamil identifiers,
// an ordinary string, a Tamil numeric literal, and the அச்சிடு helper.
const T = (...hex) => hex.map((h) => String.fromCodePoint(parseInt(h, 16))).join('');
const VANAKKAM = T('0BB5', '0BA3', '0B95', '0BCD', '0B95', '0BAE', '0BCD');
const THAMIL = T('0BA4', '0BAE', '0BBF', '0BB4', '0BCD');
const ENNIKKAI = T('0B8E', '0BA3', '0BCD', '0BA3', '0BBF', '0B95', '0BCD', '0B95', '0BC8');
const ACHCHIDU = T('0B85', '0B9A', '0BCD', '0B9A', '0BBF', '0B9F', '0BC1');
const REPRESENTATIVE =
  'const ' + THAMIL + ' = "' + VANAKKAM + ', ' + THAMIL + '!";\n' +
  'const ' + ENNIKKAI + ' = $' + T18 + ';\n' +
  ACHCHIDU + '(' + THAMIL + ');\n' +
  ACHCHIDU + '(' + ENNIKKAI + ');\n';

function setup(options) {
  const vscode = makeFakeVscode(options);
  const handlers = makeHandlers(vscode, { extensionDir: EXT_DIR });
  return { vscode, handlers };
}

const core = () => lang.resolveCore({ localDir: EXT_DIR }).api;

describe('hasTamilLiterals', () => {
  it('detects integer and decimal literals', () => {
    const api = core();
    assert.equal(lang.hasTamilLiterals(api, 'let a = $' + T18 + ';\n'), true);
    assert.equal(lang.hasTamilLiterals(api, 'let d = $' + D(1) + '.' + D(5) + ';\n'), true);
  });

  it('detects literals inside template substitutions', () => {
    assert.equal(lang.hasTamilLiterals(core(), 'const t = `sub ${$' + T18 + '} text`;\n'), true);
  });

  it('never counts $ in comments, strings, regex, or template text', () => {
    const text =
      '// $' + T18 + ' comment\n' +
      'const s = "$' + T18 + '";\n' +
      'const r = /$' + T18 + '/;\n' +
      'const t = `TPL $' + T18 + ' TXT`;\n';
    assert.equal(lang.hasTamilLiterals(core(), text), false);
  });

  it('counts malformed literals and removed $ strings (the source is still TamilScript)', () => {
    assert.equal(lang.hasTamilLiterals(core(), 'let s = $"oops;\n'), true);
    assert.equal(lang.hasTamilLiterals(core(), 'let s = $"x";\n'), true);
    assert.equal(lang.hasTamilLiterals(core(), 'let a = $' + T18 + 'abc;\n'), true);
    // Detection is keyed on the `$` marker: a bare Tamil digit with no `$`
    // anywhere is not enough evidence to take over a JavaScript file (the
    // built-in validator still flags it as an invalid character)...
    assert.equal(lang.hasTamilLiterals(core(), 'let x = ' + D(1) + ';\n'), false);
    // ...while the same mistake in a file that also uses `$` literals is ours.
    assert.equal(lang.hasTamilLiterals(core(), 'let a = $' + T18 + ';\nlet x = ' + D(1) + ';\n'), true);
  });

  it('never treats plain JavaScript or empty text as TamilScript', () => {
    assert.equal(lang.hasTamilLiterals(core(), 'const x = 1;\n'), false);
    assert.equal(lang.hasTamilLiterals(core(), ''), false);
    assert.equal(lang.hasTamilLiterals(core(), 'const money = $;\n'), false);
  });

  it('falls back to the transform diff for older cores', () => {
    const older = { transform: (t) => t.replace(/\$[\u0be6-\u0bef]+/g, '0') };
    assert.equal(lang.hasTamilLiterals(older, 'let a = $' + T18 + ';\n'), true);
    assert.equal(lang.hasTamilLiterals(older, 'const a = 1;\n'), false);
    const failing = {
      transform() {
        const err = new Error('unclosed');
        err.code = 'JST_UNCLOSED_STRING';
        throw err;
      },
    };
    assert.equal(lang.hasTamilLiterals(failing, 'let s = $"oops;\n'), true);
    const unrelated = {
      transform() {
        throw new TypeError('not a string');
      },
    };
    assert.equal(lang.hasTamilLiterals(unrelated, 'let x = 1;\n'), false);
  });
});

describe('auto language mode', () => {
  it('accepts the representative reported file and still flags malformed Tamil', async () => {
    const api = core();
    assert.equal(lang.hasTamilLiterals(api, REPRESENTATIVE), true);
    assert.deepEqual(lang.validateText(api, REPRESENTATIVE, 'rep.js'), { ok: true });
    const malformed = lang.validateText(api, 'let s = $"oops;\n', 'rep.js');
    assert.equal(malformed.ok, false);
    assert.equal(malformed.diagnostic.code, 'JST_TAMIL_STRING_REMOVED');
    const { vscode, handlers } = setup();
    const doc = makeDoc(REPRESENTATIVE, 'javascript', '/w/rep.js');
    const r = await handlers.maybeAutoSwitch(doc);
    assert.equal(r.ok, true);
    assert.equal(doc.languageId, 'tamilscript');
    assert.equal(vscode.languageSwitches.length, 1);
  });

  it('switches a JavaScript document that contains literals', async () => {
    const { vscode, handlers } = setup();
    const doc = makeDoc('let a = $' + T18 + ';\n', 'javascript', '/w/a.js');
    const r = await handlers.maybeAutoSwitch(doc);
    assert.equal(r.ok, true);
    assert.equal(doc.languageId, 'tamilscript');
    assert.equal(vscode.languageSwitches.length, 1);
  });

  it('shows one notice with switch-back actions per session', async () => {
    const { vscode, handlers } = setup();
    await handlers.maybeAutoSwitch(makeDoc('let a = $' + T18 + ';\n', 'javascript', '/w/a.js'));
    await handlers.maybeAutoSwitch(makeDoc('let b = $' + T18 + ';\n', 'javascript', '/w/b.js'));
    assert.equal(vscode.messages.info.length, 1);
    assert.match(vscode.messages.info[0], /TamilScript language mode/);
    assert.deepEqual(vscode.infoActions[0], ['Switch Back', 'Disable Auto-Switch']);
  });

  it('never switches plain JavaScript or inert $ text', async () => {
    const { vscode, handlers } = setup();
    const plain = makeDoc('const a = 1;\n', 'javascript', '/w/plain.js');
    const inert = makeDoc('// $' + T18 + '\nconst s = "$' + T18 + '";\n', 'javascript', '/w/inert.js');
    assert.equal((await handlers.maybeAutoSwitch(plain)).ok, undefined);
    assert.equal((await handlers.maybeAutoSwitch(inert)).ok, undefined);
    assert.equal(plain.languageId, 'javascript');
    assert.equal(inert.languageId, 'javascript');
    assert.equal(vscode.languageSwitches.length, 0);
  });

  it('honors tamilscript.autoLanguageMode=false', async () => {
    const { vscode, handlers } = setup({ config: { autoLanguageMode: false } });
    const doc = makeDoc('let a = $' + T18 + ';\n', 'javascript', '/w/a.js');
    const r = await handlers.maybeAutoSwitch(doc);
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'disabled');
    assert.equal(doc.languageId, 'javascript');
    assert.equal(vscode.languageSwitches.length, 0);
  });

  it('still honors the legacy opentamizh.autoLanguageMode=false', async () => {
    const { vscode, handlers } = setup({ legacyConfig: { autoLanguageMode: false } });
    const doc = makeDoc('let a = $' + T18 + ';\n', 'javascript', '/w/a.js');
    const r = await handlers.maybeAutoSwitch(doc);
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'disabled');
    assert.equal(doc.languageId, 'javascript');
    assert.equal(vscode.languageSwitches.length, 0);
  });

  it('prefers a new setting over the legacy fallback', async () => {
    const { vscode, handlers } = setup({
      config: { autoLanguageMode: true },
      legacyConfig: { autoLanguageMode: false },
    });
    const doc = makeDoc('let a = $' + T18 + ';\n', 'javascript', '/w/a.js');
    const r = await handlers.maybeAutoSwitch(doc);
    assert.equal(r.ok, true);
    assert.equal(doc.languageId, 'tamilscript');
    assert.equal(vscode.languageSwitches.length, 1);
  });

  it('switches untitled buffers that contain literals', async () => {
    const { vscode, handlers } = setup();
    const doc = makeDoc('let a = $' + T18 + ';\n', 'javascript', '/w/untitled');
    doc.uri.scheme = 'untitled';
    doc.isUntitled = true;
    const r = await handlers.maybeAutoSwitch(doc);
    assert.equal(r.ok, true);
    assert.equal(doc.languageId, 'tamilscript');
    assert.equal(vscode.languageSwitches.length, 1);
  });

  it('switches remote and virtual-workspace documents', async () => {
    for (const scheme of ['vscode-remote', 'vscode-vfs']) {
      const vscode = makeFakeVscode();
      const handlers = makeHandlers(vscode, { extensionDir: EXT_DIR });
      const doc = makeDoc('let a = $' + T18 + ';\n', 'javascript', '/w/a.js');
      doc.uri.scheme = scheme;
      const r = await handlers.maybeAutoSwitch(doc);
      assert.equal(r.ok, true, scheme);
      assert.equal(doc.languageId, 'tamilscript');
      assert.equal(vscode.languageSwitches.length, 1);
    }
  });

  it('never switches synthetic or read-only schemes', async () => {
    for (const scheme of ['git', 'output', 'vscode-notebook-cell']) {
      const vscode = makeFakeVscode();
      const handlers = makeHandlers(vscode, { extensionDir: EXT_DIR });
      const doc = makeDoc('let a = $' + T18 + ';\n', 'javascript', '/w/a.js');
      doc.uri.scheme = scheme;
      const r = await handlers.maybeAutoSwitch(doc);
      assert.equal(r.skipped, true, scheme);
      assert.equal(r.reason, 'unsupported scheme');
      assert.equal(doc.languageId, 'javascript');
      assert.equal(vscode.languageSwitches.length, 0);
    }
  });

  it('leaves documents already in TamilScript mode alone', async () => {
    const { vscode, handlers } = setup();
    const doc = makeDoc('let a = $' + T18 + ';\n', 'tamilscript', '/w/a.js');
    const r = await handlers.maybeAutoSwitch(doc);
    assert.equal(r.reason, 'already tamilscript');
    assert.equal(vscode.languageSwitches.length, 0);
  });

  it('respects a user switch back to JavaScript for the session', async () => {
    const { vscode, handlers } = setup();
    const doc = makeDoc('let a = $' + T18 + ';\n', 'javascript', '/w/a.js');
    await handlers.maybeAutoSwitch(doc);
    assert.equal(doc.languageId, 'tamilscript');
    doc.languageId = 'javascript'; // the user picked JavaScript again
    const first = await handlers.maybeAutoSwitch(doc);
    assert.equal(first.reason, 'user chose javascript');
    const second = await handlers.maybeAutoSwitch(doc);
    assert.equal(second.reason, 'user chose javascript');
    assert.equal(doc.languageId, 'javascript');
    assert.equal(vscode.languageSwitches.length, 1);
  });

  it('re-evaluates a file reopened long after a close instead of opting out', async () => {
    const vscode = makeFakeVscode();
    const handlers = makeHandlers(vscode, { extensionDir: EXT_DIR, languagePairMs: 0 });
    const doc = makeDoc('let a = $' + T18 + ';\n', 'javascript', '/w/a.js');
    await handlers.maybeAutoSwitch(doc);
    handlers.noteDocumentClosed(doc);
    doc.languageId = 'javascript'; // reopened later; the mode did not persist
    const r = await handlers.maybeAutoSwitch(doc);
    assert.equal(r.ok, true);
    assert.equal(doc.languageId, 'tamilscript');
  });

  it('does not retry a failing language switch on every event', async () => {
    const { vscode, handlers } = setup({ failLanguageSwitch: new Error('nope') });
    const doc = makeDoc('let a = $' + T18 + ';\n', 'javascript', '/w/a.js');
    const r = await handlers.maybeAutoSwitch(doc);
    assert.equal(r.ok, false);
    const again = await handlers.maybeAutoSwitch(doc);
    assert.equal(again.skipped, true);
    assert.equal(vscode.languageSwitches.length, 1);
  });

  it('switches back when the user picks Switch Back in the notice', async () => {
    const { vscode, handlers } = setup({ infoChoice: 'Switch Back' });
    const doc = makeDoc('let a = $' + T18 + ';\n', 'javascript', '/w/a.js');
    await handlers.maybeAutoSwitch(doc);
    await sleep(5);
    assert.equal(doc.languageId, 'javascript');
    const r = await handlers.maybeAutoSwitch(doc);
    assert.equal(r.reason, 'user chose javascript');
    assert.equal(vscode.languageSwitches.length, 2);
  });

  it('turns the setting off when the user picks Disable Auto-Switch', async () => {
    const config = {};
    const { vscode, handlers } = setup({ config, infoChoice: 'Disable Auto-Switch' });
    await handlers.maybeAutoSwitch(makeDoc('let a = $' + T18 + ';\n', 'javascript', '/w/a.js'));
    await sleep(5);
    assert.deepEqual(vscode.configUpdates, [{ key: 'autoLanguageMode', value: false, target: 1 }]);
    const doc = makeDoc('let b = $' + T18 + ';\n', 'javascript', '/w/b.js');
    const r = await handlers.maybeAutoSwitch(doc);
    assert.equal(r.reason, 'disabled');
    assert.equal(doc.languageId, 'javascript');
  });
});

describe('activation wiring', () => {
  it('adopts documents that were already open at activation', async () => {
    const doc = makeDoc('let a = $' + T18 + ';\n', 'javascript', '/w/open.js');
    const vscode = makeFakeVscode({ textDocuments: [doc] });
    const handlers = activate({ subscriptions: [] }, vscode);
    assert.equal(typeof vscode.registered['tamilscript.checkFile'], 'function');
    assert.equal(
      vscode.registered['opentamizh.checkFile'],
      vscode.registered['tamilscript.checkFile'],
      'legacy command id must remain an alias'
    );
    await sleep(5);
    assert.equal(doc.languageId, 'tamilscript');
    assert.equal(handlers.collection.get(doc.uri), undefined);
  });

  it('re-evaluates open documents when a TamilScript setting changes', async () => {
    const config = { autoLanguageMode: false };
    const doc = makeDoc('let a = $' + T18 + ';\n', 'javascript', '/w/a.js');
    const vscode = makeFakeVscode({ config, textDocuments: [doc] });
    activate({ subscriptions: [] }, vscode);
    await sleep(5);
    assert.equal(doc.languageId, 'javascript');
    config.autoLanguageMode = true;
    // Unrelated settings are ignored ...
    vscode.fire.config({
      affectsConfiguration: (section) => section !== 'tamilscript' && section !== 'opentamizh',
    });
    await sleep(5);
    assert.equal(doc.languageId, 'javascript');
    // ... while tamilscript.* changes re-evaluate open documents right away.
    vscode.fire.config({ affectsConfiguration: (section) => section === 'tamilscript' });
    await sleep(5);
    assert.equal(doc.languageId, 'tamilscript');
  });

  it('re-evaluates open documents when a legacy setting changes', async () => {
    const legacyConfig = { autoLanguageMode: false };
    const doc = makeDoc('let a = $' + T18 + ';\n', 'javascript', '/w/legacy.js');
    const vscode = makeFakeVscode({ legacyConfig, textDocuments: [doc] });
    activate({ subscriptions: [] }, vscode);
    await sleep(5);
    assert.equal(doc.languageId, 'javascript');
    legacyConfig.autoLanguageMode = true;
    vscode.fire.config({ affectsConfiguration: (section) => section === 'opentamizh' });
    await sleep(5);
    assert.equal(doc.languageId, 'tamilscript');
  });

  it('switches on open and validates after debounced edits', async () => {
    const vscode = makeFakeVscode({ config: { debounceMs: 1 } });
    const handlers = activate({ subscriptions: [] }, vscode);
    const doc = makeDoc('let a = $' + T18 + ';\n', 'javascript', '/w/a.js');
    vscode.fire.open(doc);
    await sleep(5);
    assert.equal(doc.languageId, 'tamilscript');
    const bad = makeDoc('let s = $"oops;\n', 'tamilscript', '/w/bad.js');
    vscode.fire.change(bad);
    await sleep(30);
    const diags = handlers.collection.get(bad.uri);
    assert.equal(diags.length, 1);
    assert.match(diags[0].message, /JST_TAMIL_STRING_REMOVED/);
  });
});
