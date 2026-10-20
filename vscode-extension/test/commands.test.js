'use strict';

// Command behavior tests with a fake vscode API (no editor required).
// Tamil text is built with String.fromCodePoint so this file stays ASCII.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { makeHandlers } = require('../extension');
const lang = require('../tamilscriptLang');
const { makeFakeVscode, makeDoc, keyOf } = require('./fake-vscode');

const D = (n) => String.fromCodePoint(0x0be6 + n);
const T18 = D(1) + D(8);
const EXT_DIR = path.resolve(__dirname, '..');

function handlersWithDoc(text, languageId, fsPath) {
  const vscode = makeFakeVscode();
  const h = makeHandlers(vscode, { extensionDir: EXT_DIR });
  const doc = makeDoc(text, languageId, fsPath);
  vscode.window.activeTextEditor = { document: doc };
  return { vscode, h, doc };
}

describe('check command', () => {
  it('reports success for a valid file and clears diagnostics', async () => {
    const { vscode, h, doc } = handlersWithDoc('let a = $' + T18 + ';\n', 'javascript', '/w/a.js');
    const r = await h.checkFile();
    assert.equal(r.ok, true);
    assert.match(vscode.messages.info.join('\n'), /no syntax errors/i);
    assert.equal(vscode.collection.get(doc.uri), undefined);
  });

  it('reports errors with positions for a malformed file', async () => {
    const { vscode, h, doc } = handlersWithDoc('let s = $"oops;\n', 'javascript', '/w/bad.js');
    const r = await h.checkFile();
    assert.equal(r.ok, false);
    assert.match(vscode.messages.error.join('\n'), /no longer supported/);
    const diags = vscode.collection.get(doc.uri);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].range.start.line, 0);
    assert.equal(diags[0].source, 'tamilscript');
    assert.match(diags[0].message, /JST_TAMIL_STRING_REMOVED/);
  });

  it('errors gracefully with no active editor', async () => {
    const vscode = makeFakeVscode();
    const h = makeHandlers(vscode, { extensionDir: EXT_DIR });
    const r = await h.checkFile();
    assert.equal(r.ok, false);
    assert.match(vscode.messages.error.join('\n'), /no active editor/i);
  });
});

describe('transform command never overwrites', () => {
  it('opens the transformed code in a preview document', async () => {
    const src = 'let a = $' + T18 + ';\n';
    const { vscode, h, doc } = handlersWithDoc(src, 'javascript', '/w/prog.js');
    const r = await h.transformFile();
    assert.equal(r.ok, true);
    assert.equal(vscode.opened.length, 1);
    assert.equal(vscode.opened[0].getText(), 'let a = 18;\n');
    assert.equal(vscode.opened[0].languageId, 'javascript');
    assert.equal(vscode.shown.length, 1);
    // The original document is untouched.
    assert.equal(doc.getText(), src);
  });

  it('shows the diagnostic instead of a preview for malformed input', async () => {
    const { vscode, h } = handlersWithDoc('let s = $"oops;\n', 'javascript', '/w/bad.js');
    const r = await h.transformFile();
    assert.equal(r.ok, false);
    assert.equal(vscode.opened.length, 0);
    assert.match(vscode.messages.error.join('\n'), /no longer supported/);
  });
});

describe('language mode command', () => {
  it('switches the active editor to TamilScript mode', async () => {
    const { vscode, h, doc } = handlersWithDoc('let a = 1;\n', 'javascript', '/w/a.js');
    const r = await h.setLanguageMode();
    assert.equal(r.ok, true);
    assert.equal(r.languageId, 'tamilscript');
    assert.equal(doc.languageId, 'tamilscript');
    assert.match(vscode.messages.info.join('\n'), /language mode set to TamilScript/);
  });

  it('reports already being in TamilScript mode', async () => {
    const { vscode, h } = handlersWithDoc('let a = 1;\n', 'tamilscript', '/w/a.js');
    const r = await h.setLanguageMode();
    assert.equal(r.ok, true);
    assert.equal(r.unchanged, true);
    assert.match(vscode.messages.info.join('\n'), /already using TamilScript/);
  });

  it('errors gracefully with no active editor', async () => {
    const vscode = makeFakeVscode();
    const h = makeHandlers(vscode, { extensionDir: EXT_DIR });
    const r = await h.setLanguageMode();
    assert.equal(r.ok, false);
    assert.match(vscode.messages.error.join('\n'), /no active editor/i);
  });

  it('errors gracefully when language switching is unavailable', async () => {
    const vscode = makeFakeVscode();
    delete vscode.languages.setTextDocumentLanguage;
    const h = makeHandlers(vscode, { extensionDir: EXT_DIR });
    vscode.window.activeTextEditor = { document: makeDoc('let a = 1;\n', 'javascript', '/w/a.js') };
    const r = await h.setLanguageMode();
    assert.equal(r.ok, false);
    assert.match(vscode.messages.error.join('\n'), /not available/i);
  });
});

describe('version command and missing core', () => {
  it('shows the resolved core version', async () => {
    const { vscode, h } = handlersWithDoc('let a = 1;\n', 'javascript', '/w/a.js');
    const r = await h.showVersion();
    assert.equal(r.ok, true);
    assert.match(r.text, /[0-9]+\.[0-9]+\.[0-9]+/);
    assert.match(vscode.messages.info.join('\n'), /TamilScript core/);
  });

  it('re-resolves when the corePath setting changes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-corepath-'));
    try {
      const mkstub = (name, version) => {
        const pkg = path.join(dir, name, 'node_modules', 'tamilscript');
        fs.mkdirSync(path.join(pkg, 'src'), { recursive: true });
        fs.cpSync(path.resolve(EXT_DIR, '..', 'src'), path.join(pkg, 'src'), { recursive: true });
        fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'tamilscript', version, main: 'src/index.js' }));
        return path.join(dir, name);
      };
      const stubA = mkstub('a', '1.0.0-first');
      const stubB = mkstub('b', '2.0.0-second');
      const config = {};
      const vscode = makeFakeVscode({ config, workspaceFolders: [] });
      // extensionDir points at an empty dir so only corePath can resolve.
      const h = makeHandlers(vscode, { extensionDir: dir });
      config.corePath = path.join(stubA, 'node_modules', 'tamilscript');
      const first = await h.showVersion();
      assert.equal(first.ok, true);
      assert.match(first.text, /1\.0\.0-first/);
      config.corePath = path.join(stubB, 'node_modules', 'tamilscript');
      const second = await h.showVersion();
      assert.equal(second.ok, true);
      assert.match(second.text, /2\.0\.0-second/);
      // Unchanged configuration keeps working (and reuses the resolution).
      const third = await h.showVersion();
      assert.equal(third.ok, true);
      assert.match(third.text, /2\.0\.0-second/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles a missing installation gracefully', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-nocore-'));
    try {
      const vscode = makeFakeVscode();
      const h = makeHandlers(vscode, { extensionDir: empty });
      const doc = makeDoc('let a = 1;\n', 'javascript', '/w/a.js');
      vscode.window.activeTextEditor = { document: doc };
      const r = await h.checkFile();
      assert.equal(r.ok, false);
      assert.match(r.error + vscode.messages.error.join('\n'), /not found/i);
      const v = await h.showVersion();
      assert.equal(v.ok, false);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('run command', () => {
  const RUN_DIR = path.join(os.tmpdir(), 'ot run files');

  it('types the resolved CLI run command into a visible terminal', async () => {
    const filePath = path.join(RUN_DIR, 'prog.js');
    const { vscode, h } = handlersWithDoc('let a = 1;\n', 'javascript', filePath);
    const r = await h.runFile();
    assert.equal(r.ok, true, r.error);
    assert.equal(vscode.terminals.length, 1);
    const t = vscode.terminals[0];
    assert.equal(t.cwd, path.dirname(filePath));
    assert.match(t.name, /prog\.js$/);
    assert.equal(t.shownCount, 1);
    assert.equal(t.sent.length, 1);
    assert.equal(t.sent[0].text, lang.buildRunCommand({ cliPath: r.cliPath, filePath }));
    assert.equal(t.sent[0].addNewLine, true);
    assert.ok(fs.existsSync(r.cliPath), 'resolved CLI script exists');
  });

  it('handles shell-special characters in paths without executing them', async () => {
    const special = path.join(RUN_DIR, '$' + '(calc).js');
    const { vscode, h } = handlersWithDoc('let a = 1;\n', 'javascript', special);
    const r = await h.runFile();
    if (process.platform === 'win32') {
      assert.equal(r.ok, false);
      assert.match(r.error, /refusing to quote/);
      assert.match(vscode.messages.error.join('\n'), /refusing to quote/);
      assert.equal(vscode.terminals.length, 0);
    } else {
      assert.equal(r.ok, true, r.error);
      assert.equal(vscode.terminals.length, 1);
      // The WHOLE path must be single-quoted as one POSIX argument: quoting
      // only the basename would leave `$(calc)` expandable by the shell.
      // (The Windows branch refuses such paths instead; see quoteArg.)
      const quoted = `'${special.split("'").join(`'\\''`)}'`;
      assert.ok(
        vscode.terminals[0].sent[0].text.includes(quoted),
        `expected the full path to be quoted: ${vscode.terminals[0].sent[0].text}`
      );
    }
  });

  it('saves unsaved changes before running so the terminal never runs stale content', async () => {
    const filePath = path.join(RUN_DIR, 'dirty.js');
    const { vscode, h, doc } = handlersWithDoc('let a = 1;\n', 'javascript', filePath);
    doc.isDirty = true;
    const r = await h.runFile();
    assert.equal(r.ok, true, r.error);
    assert.equal(doc.savedCount, 1);
    assert.equal(vscode.terminals.length, 1);
  });

  it('runs nothing when saving fails', async () => {
    const { vscode, h, doc } = handlersWithDoc('let a = 1;\n', 'javascript', path.join(RUN_DIR, 'ro.js'));
    doc.isDirty = true;
    doc.save = () => Promise.reject(new Error('read-only file system'));
    const r = await h.runFile();
    assert.equal(r.ok, false);
    assert.match(r.error, /could not save/);
    assert.equal(vscode.terminals.length, 0);
    assert.match(vscode.messages.error.join('\n'), /read-only/);
  });

  it('refuses untitled or non-file documents with a clear message', async () => {
    const vscode = makeFakeVscode();
    const h = makeHandlers(vscode, { extensionDir: EXT_DIR });
    const untitled = makeDoc('let a = 1;\n', 'javascript', '');
    untitled.isUntitled = true;
    vscode.window.activeTextEditor = { document: untitled };
    const r = await h.runFile();
    assert.equal(r.ok, false);
    assert.match(vscode.messages.error.join('\n'), /save the file before running/);
    assert.equal(vscode.terminals.length, 0);

    const virtual = makeDoc('let a = 1;\n', 'javascript', 'prog.js');
    virtual.uri.scheme = 'untitled';
    vscode.window.activeTextEditor = { document: virtual };
    const r2 = await h.runFile();
    assert.equal(r2.ok, false);
    assert.equal(vscode.terminals.length, 0);
  });

  it('errors gracefully with no active editor', async () => {
    const vscode = makeFakeVscode();
    const h = makeHandlers(vscode, { extensionDir: EXT_DIR });
    const r = await h.runFile();
    assert.equal(r.ok, false);
    assert.match(vscode.messages.error.join('\n'), /no active editor/);
    assert.equal(vscode.terminals.length, 0);
  });

  it('gives install guidance when the CLI cannot be found', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-run-nocli-'));
    try {
      const vscode = makeFakeVscode();
      const h = makeHandlers(vscode, { extensionDir: empty });
      vscode.window.activeTextEditor = {
        document: makeDoc('let a = 1;\n', 'javascript', path.join(empty, 'prog.js')),
      };
      const r = await h.runFile();
      assert.equal(r.ok, false);
      assert.match(r.error, /CLI not found/);
      assert.match(r.error, /corePath/);
      assert.match(vscode.messages.error.join('\n'), /CLI not found/);
      assert.equal(vscode.terminals.length, 0);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('errors clearly when the terminal API is unavailable', async () => {
    const vscode = makeFakeVscode();
    delete vscode.window.createTerminal;
    const h = makeHandlers(vscode, { extensionDir: EXT_DIR });
    vscode.window.activeTextEditor = {
      document: makeDoc('let a = 1;\n', 'javascript', path.join(RUN_DIR, 'prog.js')),
    };
    const r = await h.runFile();
    assert.equal(r.ok, false);
    assert.match(vscode.messages.error.join('\n'), /terminal/i);
  });
});

describe('diagnostics lifecycle', () => {
  it('sets, clears, and scopes diagnostics per document', () => {
    const { h, doc } = handlersWithDoc('let s = $"oops;\n', 'javascript', '/w/a.js');
    const bad = h.validateDocument(doc);
    assert.equal(bad.ok, false);
    assert.equal(h.collection.get(doc.uri).length, 1);
    const fixed = makeDoc('let a = 1;\n', 'javascript', '/w/a.js');
    assert.equal(h.validateDocument(fixed).ok, true);
    assert.equal(h.collection.get(fixed.uri), undefined);
    h.clearDocument(fixed);
    const other = makeDoc('let x = 1;\n', 'plaintext', '/w/note.txt');
    assert.deepEqual(h.validateDocument(other), { skipped: true });
    assert.equal(keyOf(other.uri) === keyOf(doc.uri), false);
  });

  it('clears diagnostics when a document leaves the supported languages', () => {
    const { h, doc } = handlersWithDoc('let s = $"oops;\n', 'javascript', '/w/leave.js');
    assert.equal(h.validateDocument(doc).ok, false);
    assert.equal(h.collection.get(doc.uri).length, 1);
    doc.languageId = 'plaintext';
    assert.deepEqual(h.validateDocument(doc), { skipped: true });
    assert.equal(h.collection.get(doc.uri), undefined);
  });
});
