'use strict';

// Minimal vscode API double for command tests. No editor required.

function keyOf(uri) {
  return (uri && (uri.fsPath || uri.toString())) || String(uri);
}

function makeDoc(text, languageId, fsPath) {
  const lines = text.split(/\r\n|\r|\n/);
  const doc = {
    languageId: languageId || 'javascript',
    uri: {
      scheme: 'file',
      fsPath: fsPath || '/tmp/doc.js',
      toString() { return `file://${fsPath || '/tmp/doc.js'}`; },
    },
    fileName: fsPath || '/tmp/doc.js',
    isDirty: false,
    isUntitled: false,
    savedCount: 0,
    save() {
      doc.savedCount += 1;
      doc.isDirty = false;
      return Promise.resolve(true);
    },
    getText() { return text; },
    lineCount: lines.length,
    lineAt(i) { return { text: lines[i] !== undefined ? lines[i] : '' }; },
  };
  return doc;
}

function makeCollection() {
  return {
    store: new Map(),
    set(uri, diags) { this.store.set(keyOf(uri), diags); },
    get(uri) { return this.store.get(keyOf(uri)); },
    delete(uri) { this.store.delete(keyOf(uri)); },
    clear() { this.store.clear(); },
  };
}

function makeFakeVscode(options) {
  const opts = options || {};
  const messages = { info: [], warn: [], error: [] };
  const infoActions = [];
  const opened = [];
  const shown = [];
  const registered = {};
  const terminals = [];
  const languageSwitches = [];
  const configUpdates = [];
  const listeners = { open: [], change: [], save: [], close: [], config: [] };
  const collection = makeCollection();
  function configurationFor(section) {
    const store = section === 'opentamizh' ? opts.legacyConfig || {} : opts.config || {};
    return {
      get: (k) => store[k],
      update(key, value, target) {
        configUpdates.push({ key, value, target });
        store[key] = value;
        return Promise.resolve();
      },
    };
  }
  const config = configurationFor('tamilscript');
  const fire = {
    open(doc) { for (const fn of listeners.open) fn(doc); },
    change(doc) { for (const fn of listeners.change) fn({ document: doc }); },
    save(doc) { for (const fn of listeners.save) fn(doc); },
    close(doc) { for (const fn of listeners.close) fn(doc); },
    config(event) { for (const fn of listeners.config) fn(event); },
  };
  const vscode = {
    messages,
    infoActions,
    fire,
    listeners,
    opened,
    shown,
    registered,
    terminals,
    collection,
    languageSwitches,
    configUpdates,
    window: {
      activeTextEditor: null,
      showInformationMessage(m, ...actions) {
        messages.info.push(m);
        infoActions.push(actions);
        return Promise.resolve(opts.infoChoice);
      },
      showWarningMessage(m) { messages.warn.push(m); return Promise.resolve(); },
      showErrorMessage(m) { messages.error.push(m); return Promise.resolve(); },
      showTextDocument(doc) { shown.push(doc); return Promise.resolve(doc); },
      createTerminal(options) {
        const terminal = {
          name: options && options.name,
          cwd: options && options.cwd,
          shownCount: 0,
          sent: [],
          show() { terminal.shownCount += 1; },
          sendText(text, addNewLine) { terminal.sent.push({ text, addNewLine }); },
          dispose() {},
        };
        terminals.push(terminal);
        return terminal;
      },
    },
    workspace: {
      workspaceFolders: opts.workspaceFolders || [],
      textDocuments: opts.textDocuments || [],
      openTextDocument(args) {
        const doc = makeDoc(args.content, args.language, `/untitled-${opened.length}.js`);
        opened.push(doc);
        return Promise.resolve(doc);
      },
      getConfiguration(section) { return configurationFor(section); },
      onDidOpenTextDocument(fn) { listeners.open.push(fn); return { dispose() {} }; },
      onDidChangeTextDocument(fn) { listeners.change.push(fn); return { dispose() {} }; },
      onDidSaveTextDocument(fn) { listeners.save.push(fn); return { dispose() {} }; },
      onDidCloseTextDocument(fn) { listeners.close.push(fn); return { dispose() {} }; },
      onDidChangeConfiguration(fn) { listeners.config.push(fn); return { dispose() {} }; },
    },
    languages: {
      createDiagnosticCollection() { return collection; },
      setTextDocumentLanguage(doc, languageId) {
        languageSwitches.push({ doc, languageId });
        if (opts.failLanguageSwitch) return Promise.reject(opts.failLanguageSwitch);
        doc.languageId = languageId;
        return Promise.resolve(doc);
      },
    },
    commands: {
      registerCommand(id, fn) { registered[id] = fn; return { dispose() {} }; },
    },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    Range: class Range {
      constructor(a, b, c, d) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; }
    },
    Diagnostic: class Diagnostic {
      constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; }
    },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  };
  return vscode;
}

module.exports = { makeFakeVscode, makeDoc, makeCollection, keyOf };
