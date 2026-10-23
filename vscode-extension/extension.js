'use strict';

// VS Code activation entry. All editor-touching behavior lives in
// makeHandlers(vscode, deps) so tests can inject a fake `vscode` object and
// run under plain node --test with no editor installed.

let realVscode = null;
try {
  realVscode = require('vscode');
} catch (err) {
  void err;
}

const path = require('node:path');
const lang = require('./tamilscriptLang');

const SUPPORTED_LANGUAGES = new Set(['javascript', 'tamilscript']);
const DIAGNOSTIC_SOURCE = 'tamilscript';

// Document schemes whose JavaScript documents this extension may move to the
// TamilScript language mode: real files, unsaved buffers, and remote/virtual
// workspaces. Synthetic or read-only documents (diff sides, output panels,
// notebook cells, ...) are never switched. Untitled buffers matter because
// the built-in validator flags `$`-literals from the first keystroke, long
// before a new file is ever saved.
const SWITCHABLE_SCHEMES = new Set(['file', 'untitled', 'vscode-remote', 'vscode-vfs']);

// VS Code reports a language-mode change as a close event immediately
// followed by an open event for the same document. A close followed by a
// reopen at least this much later is the user opening the file again.
const LANGUAGE_CHANGE_PAIR_MS = 1500;

function readConfig(vscode) {
  const defaults = {
    enableDiagnostics: true,
    debounceMs: 300,
    corePath: '',
    autoLanguageMode: true,
    tamilKeywords: false,
  };
  try {
    const ws = vscode && vscode.workspace;
    if (!ws || typeof ws.getConfiguration !== 'function') return defaults;
    const cfg = ws.getConfiguration('tamilscript') || {};
    const legacy = ws.getConfiguration('opentamizh') || {};
    // Values explicitly set by the user win over contributed defaults. The
    // pre-rename `opentamizh.*` keys are consulted only when the matching
    // `tamilscript.*` key has no explicit user value, so existing settings
    // survive the rename without hiding the new defaults.
    const explicit = (configuration, key) => {
      if (!configuration) return undefined;
      if (typeof configuration.inspect === 'function') {
        const info = configuration.inspect(key);
        if (info) {
          for (const value of [info.workspaceFolderValue, info.workspaceValue, info.globalValue]) {
            if (value !== undefined) return value;
          }
          return undefined;
        }
      }
      return typeof configuration.get === 'function' ? configuration.get(key) : configuration[key];
    };
    const get = (key) => {
      const current = explicit(cfg, key);
      return current !== undefined ? current : explicit(legacy, key);
    };
    const enableDiagnostics = get('enableDiagnostics');
    const debounceMs = get('debounceMs');
    const corePath = get('corePath');
    const autoLanguageMode = get('autoLanguageMode');
    const tamilKeywords = get('tamilKeywords');
    return {
      enableDiagnostics: enableDiagnostics !== undefined ? !!enableDiagnostics : true,
      debounceMs: Number.isFinite(debounceMs) && debounceMs >= 0 ? debounceMs : 300,
      tamilKeywords: tamilKeywords !== undefined ? !!tamilKeywords : false,
      corePath: typeof corePath === 'string' ? corePath : '',
      autoLanguageMode: autoLanguageMode !== undefined ? !!autoLanguageMode : true,
    };
  } catch (err) {
    void err;
    return defaults;
  }
}

function workspaceFolders(vscode) {
  try {
    const folders = vscode && vscode.workspace && vscode.workspace.workspaceFolders;
    if (!Array.isArray(folders)) return [];
    return folders.map((f) => (f && f.uri && f.uri.fsPath) || f).filter((p) => typeof p === 'string');
  } catch (err) {
    void err;
    return [];
  }
}

function documentKey(doc) {
  return String((doc.uri && (doc.uri.toString() || doc.uri.fsPath)) || doc.fileName);
}

/**
 * Build the command/diagnostic handlers with an injected vscode-like API.
 * @param {object} vscode minimal vscode API surface (window, workspace, languages, Uri)
 * @param {{ collection?: object, extensionDir?: string, warnOnce?: { warned: boolean } }} [deps]
 */
function makeHandlers(vscode, deps) {
  const d = deps || {};
  const collection =
    d.collection ||
    (vscode.languages && vscode.languages.createDiagnosticCollection
      ? vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE)
      : null);
  const state = {
    core: null,
    coreKey: null,
    warned: d.warnOnce || { warned: false },
    // Auto-switch bookkeeping, per document URI and session scope:
    switched: new Set(), // documents this extension switched to TamilScript mode
    sawTamilScript: new Set(), // documents observed in TamilScript mode
    excluded: new Set(), // documents the user (or an error) took back to JavaScript
    lastClose: new Map(), // URI -> close timestamp (language changes close+reopen)
    pending: new Set(), // switches in flight
    noticeShown: false,
  };
  const pairMs = Number.isFinite(d.languagePairMs) ? d.languagePairMs : LANGUAGE_CHANGE_PAIR_MS;

  function getCore() {
    const configKey = readConfig(vscode).corePath + '\n' + workspaceFolders(vscode).join('\n');
    if (state.core && state.coreKey === configKey) return { api: state.core };
    const found = lang.resolveCore({
      workspaceFolders: workspaceFolders(vscode),
      corePath: readConfig(vscode).corePath,
      localDir: d.extensionDir || __dirname,
    });
    if (found.api) {
      state.core = found.api;
      state.coreKey = configKey;
      return { api: found.api };
    }
    state.core = null;
    state.coreKey = null;
    state.coreError = found.error;
    return { error: found.error };
  }

  function toRange(doc, diag) {
    const line = Math.max(0, Math.min(diag.line, doc.lineCount - 1));
    let text = '';
    try {
      text = doc.lineAt(line).text;
    } catch (err) {
      void err;
    }
    const column = Math.max(0, Math.min(diag.column, text.length));
    return new vscode.Range(line, column, line, Math.min(text.length, column + 1));
  }

  function validateDocument(doc) {
    if (!doc) return { skipped: true };
    if (!SUPPORTED_LANGUAGES.has(doc.languageId)) {
      // A document that left a supported language (e.g. via "Change
      // Language Mode") must not keep stale TamilScript markers.
      if (collection) collection.delete(doc.uri);
      return { skipped: true };
    }
    if (!readConfig(vscode).enableDiagnostics) {
      if (collection) collection.delete(doc.uri);
      return { skipped: true };
    }
    const found = getCore();
    if (!found.api) {
      if (collection) collection.delete(doc.uri);
      if (!state.warned.warned) {
        state.warned.warned = true;
        if (vscode.window && vscode.window.showWarningMessage) {
          vscode.window.showWarningMessage(`TamilScript: ${found.error}`);
        }
      }
      return { ok: false, error: found.error };
    }
    const text = doc.getText();
    const name = (doc.uri && doc.uri.fsPath) || doc.fileName || 'untitled';
    const result = lang.validateText(found.api, text, name, {
      tamilKeywords: readConfig(vscode).tamilKeywords,
    });
    if (!collection) return result;
    if (result.ok) {
      collection.delete(doc.uri);
    } else {
      const diag = result.diagnostic;
      const codeSuffix = diag.code ? ` [${diag.code}]` : '';
      const entry = new vscode.Diagnostic(
        toRange(doc, diag),
        `${diag.name}${codeSuffix}: ${diag.message}`,
        vscode.DiagnosticSeverity.Error
      );
      entry.source = DIAGNOSTIC_SOURCE;
      collection.set(doc.uri, [entry]);
    }
    return result;
  }

  function clearDocument(doc) {
    if (collection && doc) collection.delete(doc.uri);
  }

  /**
   * Record a close event so the next open event can tell a language-mode
   * change (close+open microseconds apart) from the user reopening a file.
   */
  function noteDocumentClosed(doc) {
    if (!doc) return;
    const key = documentKey(doc);
    if (state.switched.has(key) || state.sawTamilScript.has(key)) {
      state.lastClose.set(key, Date.now());
    }
  }

  function showAutoSwitchNotice(doc) {
    if (state.noticeShown) return;
    state.noticeShown = true;
    const win = vscode.window;
    if (!win || typeof win.showInformationMessage !== 'function') return;
    const message =
      'TamilScript: switched this document to TamilScript language mode — Tamil literals are not ' +
      'plain JavaScript, so the built-in validator flagged them as errors. TamilScript ' +
      'diagnostics still run and file contents are untouched.';
    let answer;
    try {
      answer = win.showInformationMessage(message, 'Switch Back', 'Disable Auto-Switch');
    } catch (err) {
      return;
    }
    if (!answer || typeof answer.then !== 'function') return;
    answer
      .then((choice) => {
        if (choice === 'Switch Back') {
          const key = documentKey(doc);
          state.switched.delete(key);
          state.sawTamilScript.delete(key);
          state.excluded.add(key);
          if (vscode.languages && typeof vscode.languages.setTextDocumentLanguage === 'function') {
            Promise.resolve(vscode.languages.setTextDocumentLanguage(doc, 'javascript')).catch(() => {});
          }
        } else if (choice === 'Disable Auto-Switch') {
          try {
            const cfg =
              vscode.workspace && typeof vscode.workspace.getConfiguration === 'function'
                ? vscode.workspace.getConfiguration('tamilscript')
                : null;
            if (cfg && typeof cfg.update === 'function') {
              Promise.resolve(
                cfg.update(
                  'autoLanguageMode',
                  false,
                  vscode.ConfigurationTarget ? vscode.ConfigurationTarget.Global : undefined
                )
              ).catch(() => {});
            }
          } catch (err) {
            void err;
          }
        }
      })
      .catch(() => {});
  }

  /**
   * Switch a JavaScript document that contains TamilScript literals to the
   * dedicated `tamilscript` language mode. VS Code's built-in TypeScript
   * validator parses `$`-literals as plain JavaScript and reports false
   * syntax errors; it does not attach to the `tamilscript` language id, while
   * this extension's transformer-backed diagnostics still apply there.
   *
   * Never touches file contents. A document the user switches back to
   * JavaScript is remembered for the session (no fight, no loop).
   * Applies to every user-editable JavaScript document — saved files,
   * unsaved buffers, and remote/virtual workspaces — but never to synthetic
   * or read-only documents such as diff sides or output panels
   * (see SWITCHABLE_SCHEMES).
   * @returns {Promise<object>} outcome for tests/logging
   */
  async function maybeAutoSwitch(doc) {
    if (!doc) return { skipped: true, reason: 'no document' };
    if (!readConfig(vscode).autoLanguageMode) return { skipped: true, reason: 'disabled' };
    const key = documentKey(doc);
    if (doc.languageId === 'tamilscript') {
      state.lastClose.delete(key);
      state.sawTamilScript.add(key);
      return { skipped: true, reason: 'already tamilscript' };
    }
    if (doc.languageId !== 'javascript') return { skipped: true, reason: 'unsupported language' };
    const closedAt = state.lastClose.get(key);
    state.lastClose.delete(key);
    const reopened = closedAt !== undefined && Date.now() - closedAt >= pairMs;
    if (state.excluded.has(key)) return { skipped: true, reason: 'user chose javascript' };
    if (!reopened && (state.switched.has(key) || state.sawTamilScript.has(key))) {
      // The document left TamilScript mode while we were watching: treat it
      // as an explicit choice for this file and never fight it this session.
      state.switched.delete(key);
      state.sawTamilScript.delete(key);
      state.excluded.add(key);
      return { skipped: true, reason: 'user chose javascript' };
    }
    if (state.pending.has(key)) return { skipped: true, reason: 'switch in flight' };
    const scheme = doc.uri && doc.uri.scheme;
    if (!scheme || !SWITCHABLE_SCHEMES.has(scheme)) {
      return { skipped: true, reason: 'unsupported scheme' };
    }
    if (!vscode.languages || typeof vscode.languages.setTextDocumentLanguage !== 'function') {
      return { skipped: true, reason: 'language api unavailable' };
    }
    const found = getCore();
    if (!found.api) return { skipped: true, reason: 'core unavailable' };
    if (!lang.hasTamilLiterals(found.api, doc.getText(), {
      tamilKeywords: readConfig(vscode).tamilKeywords,
    })) {
      return { skipped: true, reason: 'no tamil literals' };
    }
    state.pending.add(key);
    try {
      await vscode.languages.setTextDocumentLanguage(doc, 'tamilscript');
    } catch (err) {
      state.pending.delete(key);
      // Do not hammer a failing switch on every keystroke.
      state.excluded.add(key);
      return { ok: false, error: (err && err.message) || String(err) };
    }
    state.pending.delete(key);
    state.switched.add(key);
    state.sawTamilScript.add(key);
    showAutoSwitchNotice(doc);
    return { ok: true, languageId: 'tamilscript' };
  }

  /** Auto-switch when needed, then (re)validate. Returns the validation. */
  async function processDocument(doc) {
    await maybeAutoSwitch(doc);
    return validateDocument(doc);
  }

  function activeDocument() {
    const editor =
      vscode.window && vscode.window.activeTextEditor ? vscode.window.activeTextEditor : null;
    return editor && editor.document ? editor.document : null;
  }

  async function checkFile() {
    const doc = activeDocument();
    if (!doc) {
      if (vscode.window) vscode.window.showErrorMessage('TamilScript: no active editor.');
      return { ok: false, error: 'no active editor' };
    }
    const found = getCore();
    if (!found.api) {
      if (vscode.window) vscode.window.showErrorMessage(`TamilScript: ${found.error}`);
      return { ok: false, error: found.error };
    }
    const name = (doc.uri && doc.uri.fsPath) || doc.fileName || 'untitled';
    const result = lang.validateText(found.api, doc.getText(), name, {
      tamilKeywords: readConfig(vscode).tamilKeywords,
    });
    if (result.ok) {
      if (collection) collection.delete(doc.uri);
      if (vscode.window) vscode.window.showInformationMessage('TamilScript: no syntax errors.');
    } else {
      if (collection && doc) {
        const diag = result.diagnostic;
        const codeSuffix = diag.code ? ` [${diag.code}]` : '';
        const entry = new vscode.Diagnostic(
          toRange(doc, diag),
          `${diag.name}${codeSuffix}: ${diag.message}`,
          vscode.DiagnosticSeverity.Error
        );
        entry.source = DIAGNOSTIC_SOURCE;
        collection.set(doc.uri, [entry]);
      }
      const at = `line ${result.diagnostic.line + 1}, column ${result.diagnostic.column + 1}`;
      if (vscode.window) vscode.window.showErrorMessage(`TamilScript: ${result.diagnostic.message} (${at})`);
    }
    return result;
  }

  async function transformFile() {
    const doc = activeDocument();
    if (!doc) {
      if (vscode.window) vscode.window.showErrorMessage('TamilScript: no active editor.');
      return { ok: false, error: 'no active editor' };
    }
    const found = getCore();
    if (!found.api) {
      if (vscode.window) vscode.window.showErrorMessage(`TamilScript: ${found.error}`);
      return { ok: false, error: found.error };
    }
    const name = (doc.uri && doc.uri.fsPath) || doc.fileName || 'untitled';
    const result = lang.transformText(found.api, doc.getText(), name, {
      tamilKeywords: readConfig(vscode).tamilKeywords,
    });
    if (!result.ok) {
      const at = `line ${result.diagnostic.line + 1}, column ${result.diagnostic.column + 1}`;
      if (vscode.window) vscode.window.showErrorMessage(`TamilScript: ${result.diagnostic.message} (${at})`);
      return result;
    }
    // Never overwrite the original: open the transformed code in a new
    // untitled preview the user can save wherever they choose.
    const preview = await vscode.workspace.openTextDocument({ content: result.code, language: 'javascript' });
    if (vscode.window && vscode.window.showTextDocument) {
      await vscode.window.showTextDocument(preview, { preview: true });
    }
    return { ok: true, preview };
  }

  async function showVersion() {
    const found = getCore();
    const text = found.api
      ? `TamilScript core ${lang.getVersion(found.api)} (via ${found.via || 'resolved core'})`
      : `TamilScript core not found: ${found.error}`;
    if (vscode.window) vscode.window.showInformationMessage(text);
    return { ok: !!found.api, text };
  }

  // Run the active file with the resolved core CLI. The extension never
  // spawns a process itself: the exact command is typed into a visible
  // integrated terminal, so output is complete and Ctrl+C still works.
  // The file must exist on disk (unsaved "Untitled" documents are refused),
  // and unsaved changes are saved first so the terminal never runs stale
  // content; if saving fails, nothing is run.
  async function runFile() {
    const doc = activeDocument();
    if (!doc) {
      if (vscode.window) vscode.window.showErrorMessage('TamilScript: no active editor.');
      return { ok: false, error: 'no active editor' };
    }
    const uri = doc.uri;
    const filePath = uri && uri.scheme === 'file' && uri.fsPath ? uri.fsPath : null;
    if (!filePath || doc.isUntitled === true) {
      const message =
        'TamilScript: save the file before running — the CLI runs files from disk, not untitled buffers.';
      if (vscode.window) vscode.window.showErrorMessage(message);
      return { ok: false, error: 'unsaved or untitled document' };
    }
    const found = lang.resolveCli({
      workspaceFolders: workspaceFolders(vscode),
      corePath: readConfig(vscode).corePath,
      localDir: d.extensionDir || __dirname,
    });
    if (!found.cliPath) {
      if (vscode.window) vscode.window.showErrorMessage(`TamilScript: ${found.error}`);
      return { ok: false, error: found.error };
    }
    if (doc.isDirty) {
      try {
        await doc.save();
      } catch (err) {
        const message = (err && err.message) || String(err);
        if (vscode.window) vscode.window.showErrorMessage(`TamilScript: could not save the file (${message}).`);
        return { ok: false, error: `could not save: ${message}` };
      }
      if (doc.isDirty) {
        if (vscode.window) vscode.window.showErrorMessage('TamilScript: save the file before running.');
        return { ok: false, error: 'document still dirty after save' };
      }
    }
    if (!vscode.window || typeof vscode.window.createTerminal !== 'function') {
      if (vscode.window) vscode.window.showErrorMessage('TamilScript: the VS Code terminal API is not available.');
      return { ok: false, error: 'terminal API unavailable' };
    }
    let command;
    try {
      command = lang.buildRunCommand({
        cliPath: found.cliPath,
        filePath,
        extraArgs: readConfig(vscode).tamilKeywords ? ['--tamil-keywords'] : [],
      });
    } catch (err) {
      const message = (err && err.message) || String(err);
      if (vscode.window) vscode.window.showErrorMessage(`TamilScript: ${message}`);
      return { ok: false, error: message };
    }
    let terminal;
    try {
      terminal = vscode.window.createTerminal({
        name: `TamilScript: ${path.basename(filePath)}`,
        cwd: path.dirname(filePath),
      });
      terminal.show();
      terminal.sendText(command, true);
    } catch (err) {
      const message = (err && err.message) || String(err);
      if (vscode.window) vscode.window.showErrorMessage(`TamilScript: could not start the terminal (${message}).`);
      return { ok: false, error: message };
    }
    return { ok: true, command, cliPath: found.cliPath, terminal };
  }

  // Switch the active editor to the TamilScript language mode. In that mode
  // the built-in TypeScript validator does not attach, so valid `$`-literals
  // show no false parser squiggles; only this extension's transformer-backed
  // diagnostics (source `tamilscript`) apply. Never touches file contents.
  async function setLanguageMode() {
    const doc = activeDocument();
    if (!doc) {
      if (vscode.window) vscode.window.showErrorMessage('TamilScript: no active editor.');
      return { ok: false, error: 'no active editor' };
    }
    if (doc.languageId === 'tamilscript') {
      if (vscode.window) vscode.window.showInformationMessage('TamilScript: already using TamilScript language mode.');
      return { ok: true, unchanged: true, languageId: 'tamilscript' };
    }
    if (!vscode.languages || typeof vscode.languages.setTextDocumentLanguage !== 'function') {
      if (vscode.window) vscode.window.showErrorMessage('TamilScript: language switching is not available.');
      return { ok: false, error: 'language switching unavailable' };
    }
    try {
      await vscode.languages.setTextDocumentLanguage(doc, 'tamilscript');
    } catch (err) {
      const message = (err && err.message) || String(err);
      if (vscode.window) vscode.window.showErrorMessage(`TamilScript: could not switch language mode (${message}).`);
      return { ok: false, error: message };
    }
    if (vscode.window) vscode.window.showInformationMessage('TamilScript: language mode set to TamilScript.');
    return { ok: true, languageId: 'tamilscript' };
  }

  return {
    validateDocument,
    clearDocument,
    noteDocumentClosed,
    maybeAutoSwitch,
    processDocument,
    checkFile,
    transformFile,
    runFile,
    showVersion,
    setLanguageMode,
    collection,
    SUPPORTED_LANGUAGES,
  };
}

function activate(context, injectedVscode) {
  const vscode = injectedVscode || realVscode;
  if (!vscode) throw new Error('TamilScript extension requires the VS Code API.');
  const handlers = makeHandlers(vscode, { extensionDir: __dirname });
  const timers = new Map();
  const schedule = (doc) => {
    if (!doc || !SUPPORTED_LANGUAGES.has(doc.languageId)) return;
    const key = documentKey(doc);
    if (timers.has(key)) clearTimeout(timers.get(key));
    const wait = readConfig(vscode).debounceMs;
    const t = setTimeout(() => {
      timers.delete(key);
      handlers.processDocument(doc).catch(() => {});
    }, wait);
    if (t.unref) t.unref();
    timers.set(key, t);
  };
  const subs = (context && context.subscriptions) || [];
  const reg = (disposable) => subs.push(disposable);
  if (vscode.commands) {
    const commands = {
      checkFile: () => handlers.checkFile(),
      transformFile: () => handlers.transformFile(),
      runFile: () => handlers.runFile(),
      showVersion: () => handlers.showVersion(),
      setLanguageMode: () => handlers.setLanguageMode(),
    };
    for (const [name, handler] of Object.entries(commands)) {
      reg(vscode.commands.registerCommand(`tamilscript.${name}`, handler));
      // Pre-rename command ids stay registered so existing keybindings keep
      // working; only the `tamilscript.*` ids are contributed in the manifest.
      reg(vscode.commands.registerCommand(`opentamizh.${name}`, handler));
    }
  }
  if (vscode.workspace) {
    if (vscode.workspace.onDidOpenTextDocument) {
      reg(vscode.workspace.onDidOpenTextDocument((doc) => handlers.processDocument(doc).catch(() => {})));
    }
    if (vscode.workspace.onDidChangeTextDocument) {
      reg(vscode.workspace.onDidChangeTextDocument((e) => e && e.document && schedule(e.document)));
    }
    if (vscode.workspace.onDidSaveTextDocument) {
      reg(vscode.workspace.onDidSaveTextDocument((doc) => handlers.processDocument(doc).catch(() => {})));
    }
    // Apply tamilscript.* setting changes to already-open documents: turning
    // auto-switch (or diagnostics) back on must recover open files without
    // an edit or a reopen. Other extensions' settings are ignored.
    if (vscode.workspace.onDidChangeConfiguration) {
      reg(
        vscode.workspace.onDidChangeConfiguration((event) => {
          const relevant =
            !event ||
            typeof event.affectsConfiguration !== 'function' ||
            event.affectsConfiguration('tamilscript') ||
            event.affectsConfiguration('opentamizh');
          if (!relevant) return;
          for (const doc of vscode.workspace.textDocuments || []) {
            handlers.processDocument(doc).catch(() => {});
          }
        })
      );
    }
    if (vscode.workspace.onDidCloseTextDocument) {
      reg(vscode.workspace.onDidCloseTextDocument((doc) => {
        handlers.noteDocumentClosed(doc);
        handlers.clearDocument(doc);
        const key = documentKey(doc);
        if (timers.has(key)) {
          clearTimeout(timers.get(key));
          timers.delete(key);
        }
      }));
    }
    // Adopt documents that were already open when activation ran (for
    // example a restored window): their open events fired before our
    // listeners existed, so they would otherwise never be considered.
    for (const doc of vscode.workspace.textDocuments || []) {
      handlers.processDocument(doc).catch(() => {});
    }
  }
  return handlers;
}

function deactivate() {}

module.exports = { activate, deactivate, makeHandlers, SUPPORTED_LANGUAGES };
