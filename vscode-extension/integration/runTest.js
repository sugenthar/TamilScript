'use strict';

// Entry point for real-editor integration runs:
//   code --extensionDevelopmentPath=<ext> --extensionTestsPath=<this file> <folders...>
// Exports run() per the extension-test contract. Writes a JSON report to
// OT_INTEG_OUT and throws on failure so the CLI exits non-zero.
// All Tamil text is built with String.fromCodePoint (pure ASCII source).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const D = (n) => String.fromCodePoint(0x0be6 + n);
const T18 = D(1) + D(8);
const T12 = D(1) + D(2);
const T5 = D(5);
const T3 = D(3);
const T100 = D(1) + D(0) + D(0);
const T25 = D(2) + D(5);
const T1 = D(1);
const T2 = D(2);
const T6 = D(6);
const T7 = D(7);
const T11 = D(1) + D(1);
const T13 = D(1) + D(3);
const T21 = D(2) + D(1);
const T182 = D(1) + D(8) + D(2);
const T56 = D(5) + D(6);
// மதிப்பு ("value") — an ordinary Tamil identifier used as a property name.
const MATIPPU = String.fromCodePoint(0x0bae, 0x0ba4, 0x0bbf, 0x0baa, 0x0bcd, 0x0bc1);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'} integ: ${name}${detail ? ' — ' + detail : ''}`);
}

/** Write an auxiliary dump next to OT_INTEG_OUT; a no-op when it is unset. */
function writeAux(suffix, data) {
  const outPath = process.env.OT_INTEG_OUT;
  if (!outPath) return;
  fs.writeFileSync(outPath + suffix, typeof data === 'string' ? data : JSON.stringify(data, null, 1), 'utf8');
}

async function main() {
  const vscode = require('vscode');
  const outPath = process.env.OT_INTEG_OUT;
  const ws = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
  record('host workspace folders', ws.length >= 1, `folders=${ws.length}`);

  // 1. Extension under development is present and activates on JS.
  const ext = vscode.extensions.getExtension('opentamizh.tamilscript-vscode');
  record('extension found', !!ext, ext ? ext.id : 'missing');
  const probeDir = ws[0];
  const goodPath = path.join(probeDir, 'good.js');
  const goodDoc = await vscode.workspace.openTextDocument(goodPath);
  await vscode.window.showTextDocument(goodDoc);
  if (ext && !ext.isActive) await ext.activate();
  record('extension active on javascript doc', !!(ext && ext.isActive));

  // 2. Language and commands are contributed.
  const langs = await vscode.languages.getLanguages();
  record('tamilscript language registered', langs.includes('tamilscript'));
  const cmds = await vscode.commands.getCommands(true);
  for (const id of [
    'tamilscript.checkFile',
    'tamilscript.transformFile',
    'tamilscript.runFile',
    'tamilscript.showVersion',
    'tamilscript.setLanguageMode',
  ]) {
    record(`command registered: ${id}`, cmds.includes(id));
  }

  // 3. Snippet completions are offered in a JS document.
  const snipDoc = await vscode.workspace.openTextDocument({ content: 'ot', language: 'javascript' });
  await vscode.window.showTextDocument(snipDoc);
  const list = await vscode.commands.executeCommand(
    'vscode.executeCompletionItemProvider',
    snipDoc.uri,
    new vscode.Position(0, 2)
  );
  const items = (list && list.items ? list.items : []);
  const labels = items.map((i) => (typeof i.label === 'string' ? i.label : (i.label && i.label.label) || ''));
  const kinds = items.map((i) => i.kind);
  writeAux('.labels.json', {
    count: labels.length,
    ot: labels.filter((l) => /ot/i.test(l)),
    kinds: [...new Set(kinds)],
  });
  record('otint snippet offered', labels.some((l) => l === 'otint'), `count=${labels.length}`);
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

  // 4. Diagnostics appear for a bad file and clear after fix + close.
  const badPath = path.join(probeDir, 'bad.js');
  const badDoc = await vscode.workspace.openTextDocument(badPath);
  await vscode.window.showTextDocument(badDoc);
  await sleep(1800);
  const own = (uri) => vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'tamilscript');
  const allDump = vscode.languages.getDiagnostics(badDoc.uri).map((d) => `${d.source}:${d.message.split('\n')[0].slice(0, 80)}`);
  fs.writeFileSync(process.env.OT_INTEG_OUT + '.diags.json', JSON.stringify(allDump, null, 1), 'utf8');
  // NOTE: earlier runs created a second same-named diagnostic collection here
  // for isolation; that contaminated getDiagnostics counts, so it was removed.
  // Bridge-vs-wiring isolation is covered by unit tests instead.
  let diags = own(badDoc.uri);
  const hasJst = diags.some((d) => /JST_TAMIL_STRING_REMOVED/.test(d.message));
  record('diagnostic appears after debounce', hasJst, `own-diags=${diags.length} all-diags=${allDump.length}`);
  // Cross-check the validation path directly (independent of editor events).
  const direct = await vscode.commands.executeCommand('tamilscript.checkFile');
  record('checkFile reports the bad doc directly', !!(direct && direct.ok === false && direct.diagnostic && direct.diagnostic.code === 'JST_TAMIL_STRING_REMOVED'), JSON.stringify(direct && { ok: direct.ok, code: direct.diagnostic && direct.diagnostic.code }));
  const rangeOk = hasJst && diags[0].range.start.line === 0;
  record('diagnostic on line 1', !!rangeOk);
  // Fix the file -> diagnostics clear.
  const edit = new vscode.WorkspaceEdit();
  edit.replace(badDoc.uri, new vscode.Range(0, 0, 0, 1000), 'let s = "ok";\n');
  const applied = await vscode.workspace.applyEdit(edit);
  await sleep(1800);
  diags = own(badDoc.uri);
  record('diagnostic clears after fix', applied && diags.length === 0, `applied=${applied} own-diags=${diags.length}`);
  await badDoc.save();
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await sleep(400);
  const openPaths = vscode.workspace.textDocuments.map((d) => (d.uri && d.uri.fsPath) || '?');
  const activeAfterClose = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
  writeAux('.close.json', {
    openPaths,
    activePath: activeAfterClose && activeAfterClose.uri && activeAfterClose.uri.fsPath,
    remaining: vscode.languages.getDiagnostics(badDoc.uri).map((d) => `${d.source}:${d.message.split('\n')[0].slice(0, 100)}`),
  });
  // NOTE: workspace.textDocuments may still list the URI briefly after the
  // close event; the product contract is "no stale markers", asserted below.
  diags = own(badDoc.uri);
  record('diagnostic cleared after close', diags.length === 0, `own-diags=${diags.length}`);

  // 5. Check command on the good file (active editor required).
  await vscode.window.showTextDocument(goodDoc);
  const checkR = await vscode.commands.executeCommand('tamilscript.checkFile');
  record('checkFile returns ok:true', !!(checkR && checkR.ok === true));

  // 6. Transform opens a preview; the original file is byte-identical.
  const before = fs.readFileSync(goodPath, 'utf8');
  const tr = await vscode.commands.executeCommand('tamilscript.transformFile');
  record('transformFile returns ok:true', !!(tr && tr.ok === true));
  const active = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
  record('preview document is untitled javascript', !!active && active.isUntitled && active.languageId === 'javascript');
  const expectedPreview =
    'let age = 18;\n' +
    '// $' + T18 + ' in a comment is not code\n' +
    'const s = "$' + T18 + ' STRMARK";\n' +
    'const r = /$' + T18 + ' RXMARK/;\n' +
    'const t = `TPLMARK ${18} TPLTXT`;\n';
  record('preview holds transformed code', !!active && active.getText() === expectedPreview, JSON.stringify(active && active.getText()));
  record('original file untouched', fs.readFileSync(goodPath, 'utf8') === before);

  // 7. Version command reports the workspace-resolved core (multi-root first folder wins).
  const ver = await vscode.commands.executeCommand('tamilscript.showVersion');
  record('showVersion prefers workspace core', !!(ver && ver.ok && /9\.9\.9-integ/.test(ver.text)), ver && ver.text);

  // 8. Grammar token checks with literal-specific scopes (the base
  // language scope itself contains "tamilscript" for ot-mode docs, so match
  // only the literal scopes). ${...} expressions are a documented gap:
  // asserted nowhere (see README).
  let tokenVerdict = 'unavailable';
  try {
    const extInfo = vscode.extensions.getExtension('opentamizh.tamilscript-vscode');
    const contributed = extInfo && extInfo.packageJSON && extInfo.packageJSON.contributes;
    writeAux('.contrib.json', contributed && contributed.grammars);
    const LIT = /constant\.numeric|invalid\.illegal\.tamilscript/;
    const litScopes = (toks) =>
      (toks || []).filter((t) => LIT.test(String((t && (t.t || t.scope)) || '')));
    const otPath = path.join(probeDir, 'otmode.js');
    fs.writeFileSync(otPath, 'let age = $' + T18 + ';\n', 'utf8');
    const otFileDoc = await vscode.workspace.openTextDocument(otPath);
    await vscode.languages.setTextDocumentLanguage(otFileDoc, 'tamilscript');
    const otTokens = await vscode.commands.executeCommand('_workbench.captureSyntaxTokens', otFileDoc.uri);
    // good.js holds a literal inside a ${...} substitution, so the automatic
    // language switch may have moved it to TamilScript mode; the injection
    // grammar only applies while a document is in JavaScript mode.
    if (goodDoc.languageId !== 'javascript') {
      await vscode.languages.setTextDocumentLanguage(goodDoc, 'javascript');
      await sleep(300);
    }
    const jsTokens = await vscode.commands.executeCommand('_workbench.captureSyntaxTokens', goodDoc.uri);
    writeAux('.tokens.json', JSON.stringify({ otTokens, jsTokens, jsMode: goodDoc.languageId }).slice(0, 20000));
    const otLit = litScopes(otTokens);
    const jsLit = litScopes(jsTokens);
    const sigil = (toks) => toks.some((t) => t.c === '$');
    const cleanMarkers = (toks) =>
      toks.every((t) => !/comment|STRMARK|RXMARK|TPLMARK|TPLTXT/.test(t.c || ''));
    tokenVerdict = `otLit=${otLit.length} jsLit=${jsLit.length}`;
    record('full tamilscript grammar scopes literals', otLit.length > 0 && sigil(otTokens));
    record('injection grammar scopes literals in JS', jsLit.length > 0 && sigil(jsTokens));
    record('no literal scopes inside comment/string/regex/template text', cleanMarkers(otLit) && cleanMarkers(jsLit));
    // Numeric scope consistency (issue fix): integer and decimal literals must
    // wear one shared numeric scope category, the decimal point must stay
    // inside the literal token, and the real host's resolved per-theme
    // colours for both forms must be identical. A theme with a rule for
    // constant.numeric.integer / constant.numeric.decimal (a common pattern)
    // must not be able to colour the two TamilScript forms differently.
    const LITSCOPE = 'constant.numeric.tamilscript';
    const parts = (t) => String((t && t.t) || '').split(/\s+/);
    const colorSig = (t) =>
      JSON.stringify(Object.entries((t && t.r) || {}).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
    const lits = (toks) => (toks || []).filter((t) => parts(t).includes(LITSCOPE));
    const digits = (toks) =>
      lits(toks).filter((t) => {
        const p = parts(t);
        return p[p.length - 1] === LITSCOPE;
      });
    const numPath = path.join(probeDir, 'numeric-probe.js');
    // Covers the required set ($௧, $௧௧, $௩.௫, $௧௮௨.௫௬) and the required
    // contexts: start of an expression, after an operator, in call
    // arguments, in parentheses, adjacent operators without spaces, and a
    // decimal followed by member access (the trailing dot must not be
    // swallowed into the literal).
    fs.writeFileSync(
      numPath,
      'let a = $' + T18 + ';\n' +
        'let b = $' + T3 + '.' + T5 + ';\n' +
        'let c = $' + T100 + '.' + T25 + ';\n' +
        'let d = $' + T18 + ' + $' + T3 + '.' + T5 + ';\n' +
        'let e = $' + T1 + ';\n' +
        'let f = $' + T11 + ';\n' +
        'let g = $' + T182 + '.' + T56 + ';\n' +
        'console.log($' + T1 + ', $' + T3 + '.' + T5 + ', $' + T182 + '.' + T56 + ');\n' +
        'let i = ($' + T3 + '.' + T5 + ');\n' +
        'let j = $' + T1 + '+$' + T3 + '.' + T5 + ';\n' +
        'let k = $' + T3 + '.' + T5 + '.toFixed(1);\n' +
        '$' + T3 + '.' + T5 + ';\n',
      'utf8'
    );
    const numDoc = await vscode.workspace.openTextDocument(numPath);
    await vscode.window.showTextDocument(numDoc);
    await sleep(1800); // let the automatic language switch settle
    const numOtLang = numDoc.languageId;
    const numOtTokens = await vscode.commands.executeCommand('_workbench.captureSyntaxTokens', numDoc.uri);
    await vscode.languages.setTextDocumentLanguage(numDoc, 'javascript');
    await sleep(350);
    const numJsLang = numDoc.languageId;
    const numJsTokens = await vscode.commands.executeCommand('_workbench.captureSyntaxTokens', numDoc.uri);
    writeAux('.numeric.json', JSON.stringify({ numOtLang, numJsLang, numOtTokens, numJsTokens }).slice(0, 20000));
    const minDec = T3 + '.' + T5;
    const maxDec = T100 + '.' + T25;
    const bigDec = T182 + '.' + T56;
    const expectedSeq = [
      T18, minDec, maxDec, T18, minDec, // a-d
      T1, T11, bigDec, // e-g
      T1, minDec, bigDec, // function arguments
      minDec, // parentheses
      T1, minDec, // adjacent operator, no spaces
      minDec, // followed by member access
      minDec, // start of an expression statement
    ];
    const themeKind = vscode.window.activeColorTheme && vscode.window.activeColorTheme.kind;
    for (const [mode, toks] of [['ot', numOtTokens], ['js', numJsTokens]]) {
      const digitToks = digits(toks);
      const seq = digitToks.map((t) => String(t.c));
      const legacy = (toks || []).filter((t) =>
        /constant\.numeric\.(integer|decimal)\.tamilscript/.test(String((t && t.t) || ''))
      );
      const invalid = (toks || []).filter((t) => /invalid/.test(String((t && t.t) || '')));
      const litToks = lits(toks);
      const themes = litToks.length ? Object.keys(litToks[0].r || {}).length : 0;
      const sameColors =
        litToks.length > 0 && themes > 0 && litToks.every((t) => colorSig(t) === colorSig(litToks[0]));
      record(
        `numeric[${mode}]: integer and decimal digits tokenize with the dot inside`,
        JSON.stringify(seq) === JSON.stringify(expectedSeq),
        `seq=${seq.join(',')}`
      );
      record(`numeric[${mode}]: one numeric scope category, no split integer/decimal`, legacy.length === 0, `legacy=${legacy.length}`);
      record(`numeric[${mode}]: no invalid scopes on the probe`, invalid.length === 0, `invalid=${invalid.length}`);
      record(
        `numeric[${mode}]: every literal resolves to the same theme colour`,
        sameColors,
        `tokens=${litToks.length} themes=${themes} themeKind=${themeKind} sample=${litToks.length && litToks[0].r ? Object.values(litToks[0].r)[0] : '?'}`
      );
    }
    tokenVerdict += ` numeric=${numOtLang}/${numJsLang}`;
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

    // Malformed and identifier-glued numerics: the grammar must agree with
    // the lexer — never colour `x$௧`/`5$௧` as a literal, never colour any
    // malformed form with the valid numeric scope, and mark every malformed
    // form with the invalid scope. Also proves Oniguruma accepts the
    // identifier lookbehind in a real editor (a failed compile would leave
    // the valid contrast below unscoped).
    const gluedPath = path.join(probeDir, 'numeric-glued-probe.js');
    fs.writeFileSync(
      gluedPath,
      'let a = 5$' + T1 + ';\n' +
        'let b = x$' + T2 + ';\n' +
        'let c = ' + String.fromCodePoint(0x0b85) + '$' + T3 + ';\n',
      'utf8'
    );
    const gluedDoc = await vscode.workspace.openTextDocument(gluedPath);
    await vscode.window.showTextDocument(gluedDoc);
    await sleep(1200);
    const gluedOtTokens = await vscode.commands.executeCommand('_workbench.captureSyntaxTokens', gluedDoc.uri);
    await vscode.languages.setTextDocumentLanguage(gluedDoc, 'javascript');
    await sleep(350);
    const gluedJsTokens = await vscode.commands.executeCommand('_workbench.captureSyntaxTokens', gluedDoc.uri);
    writeAux('.glued.json', JSON.stringify({ gluedOtTokens, gluedJsTokens }).slice(0, 20000));
    for (const [mode, toks] of [['ot', gluedOtTokens], ['js', gluedJsTokens]]) {
      const numeric = (toks || []).filter((t) => /constant\.numeric\.tamilscript/.test(String((t && t.t) || '')));
      const invalid = (toks || []).filter((t) => /invalid\.illegal\.tamilscript/.test(String((t && t.t) || '')));
      record(
        `numeric[${mode}]: identifier-adjacent $ digits are never literals (5$._, x$._, அ$._)`,
        numeric.length === 0 && invalid.length === 0,
        `numeric=${numeric.length} invalid=${invalid.length}`
      );
    }
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

    const badNumPath = path.join(probeDir, 'numeric-bad-probe.js');
    fs.writeFileSync(
      badNumPath,
      'let a = $' + T18 + '$' + T2 + ';\n' +
        'let b = $' + T21 + '.' + T5 + '.' + T6 + ';\n' +
        'let c = $' + T1 + '.$' + T2 + ';\n' +
        'let d = $' + T3 + '.' + T5 + '.$' + T2 + ';\n' +
        'let e = $' + T13 + '.' + T7 + '.;\n',
      'utf8'
    );
    const badNumDoc = await vscode.workspace.openTextDocument(badNumPath);
    await vscode.window.showTextDocument(badNumDoc);
    await sleep(1200);
    const badNumOtTokens = await vscode.commands.executeCommand('_workbench.captureSyntaxTokens', badNumDoc.uri);
    await vscode.languages.setTextDocumentLanguage(badNumDoc, 'javascript');
    await sleep(350);
    const badNumJsTokens = await vscode.commands.executeCommand('_workbench.captureSyntaxTokens', badNumDoc.uri);
    writeAux('.badnum.json', JSON.stringify({ badNumOtTokens, badNumJsTokens }).slice(0, 20000));
    for (const [mode, toks] of [['ot', badNumOtTokens], ['js', badNumJsTokens]]) {
      const numeric = (toks || []).filter((t) => /constant\.numeric\.tamilscript/.test(String((t && t.t) || '')));
      const invalid = (toks || []).filter((t) => /invalid\.illegal\.tamilscript/.test(String((t && t.t) || '')));
      record(
        `numeric[${mode}]: every malformed form is flagged invalid`,
        invalid.length >= 5,
        `invalid=${invalid.length}`
      );
      record(
        `numeric[${mode}]: malformed forms never wear the valid numeric scope`,
        numeric.length === 0,
        `numeric=${numeric.length}`
      );
    }
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

    const goodNumPath = path.join(probeDir, 'numeric-good-probe.js');
    fs.writeFileSync(
      goodNumPath,
      'let a = $' + T3 + '.' + T5 + '.toFixed(1);\n' +
        'let b = $' + T1 + '..toString();\n' +
        'let c = $' + T3 + '.' + T5 + '.' + MATIPPU + ';\n' +
        'let d = $' + T3 + '.' + T5 + '. toString();\n',
      'utf8'
    );
    const goodNumDoc = await vscode.workspace.openTextDocument(goodNumPath);
    await vscode.window.showTextDocument(goodNumDoc);
    await sleep(1200);
    const goodNumOtTokens = await vscode.commands.executeCommand('_workbench.captureSyntaxTokens', goodNumDoc.uri);
    await vscode.languages.setTextDocumentLanguage(goodNumDoc, 'javascript');
    await sleep(350);
    const goodNumJsTokens = await vscode.commands.executeCommand('_workbench.captureSyntaxTokens', goodNumDoc.uri);
    writeAux('.goodnum.json', JSON.stringify({ goodNumOtTokens, goodNumJsTokens }).slice(0, 20000));
    for (const [mode, toks] of [['ot', goodNumOtTokens], ['js', goodNumJsTokens]]) {
      const numeric = (toks || []).filter((t) => /constant\.numeric\.tamilscript/.test(String((t && t.t) || '')));
      const invalid = (toks || []).filter((t) => /invalid\.illegal\.tamilscript/.test(String((t && t.t) || '')));
      record(
        `numeric[${mode}]: member access after a decimal stays a valid literal`,
        numeric.length >= 4 && invalid.length === 0,
        `numeric=${numeric.length} invalid=${invalid.length}`
      );
    }
    tokenVerdict += ' malformed=checked';
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  } catch (err) {
    tokenVerdict = `failed (${(err && err.message) || err})`;
    record('grammar token probing works', false, tokenVerdict);
  }

  // 9. Language-mode false-squiggle behavior: a file with literals arrives
  // in TamilScript mode automatically (section 10 covers that switch), where
  // no foreign markers may remain on valid literals; genuine mistakes are
  // still reported in javascript mode; malformed Tamil is still flagged.
  const U = (h) => String.fromCodePoint(parseInt(h, 16));
  const VANAKKAM = ['0BB5', '0BA3', '0B95', '0BCD', '0B95', '0BAE', '0BCD'].map(U).join('');
  const THAMIL = ['0BA4', '0BAE', '0BBF', '0BB4', '0BCD'].map(U).join('');
  const ENNIKKAI = ['0B8E', '0BA3', '0BCD', '0BA3', '0BBF', '0B95', '0BCD', '0B95', '0BC8'].map(U).join('');
  const THASAMAM = ['0BA4', '0B9A', '0BAE', '0BAE', '0BCD'].map(U).join('');
  const ACHCHIDU = ['0B85', '0B9A', '0BCD', '0B9A', '0BBF', '0B9F', '0BC1'].map(U).join('');
  const REPRESENTATIVE =
    'const ' + THAMIL + ' = "' + VANAKKAM + ', ' + THAMIL + '!";\n' +
    'const ' + ENNIKKAI + ' = $' + T18 + ';\n' +
    'const ' + THASAMAM + ' = $' + T3 + '.' + T5 + ';\n' +
    ACHCHIDU + '(' + THAMIL + ');\n' +
    ACHCHIDU + '(' + ENNIKKAI + ');\n' +
    ACHCHIDU + '(' + THASAMAM + ');\n';
  // The exact file from the red-squiggle report, verbatim.
  const MUZHU = ['0BAE', '0BC1', '0BB4', '0BC1'].map(U).join('');
  const USER_REPORT =
    'const ' + THAMIL + ' = "' + VANAKKAM + ', ' + THAMIL + '!";\n' +
    'const ' + MUZHU + ' = $' + T18 + ';\n' +
    'const ' + THASAMAM + ' = $' + T3 + '.' + T5 + ';\n' +
    '\n' +
    ACHCHIDU + '(' + THAMIL + ');\n' +
    ACHCHIDU + '(' + MUZHU + ');\n' +
    ACHCHIDU + '(' + THASAMAM + ');\n';
  async function pollLanguage(doc, want, timeoutMs) {
    const start = Date.now();
    for (;;) {
      if (doc.languageId === want) return true;
      if (Date.now() - start > timeoutMs) return doc.languageId === want;
      await sleep(250);
    }
  }
  async function pollForeign(uri, wantZero, timeoutMs) {
    const start = Date.now();
    let last = [];
    for (;;) {
      last = vscode.languages.getDiagnostics(uri).filter((d) => d.source !== 'tamilscript');
      const done = wantZero ? last.length === 0 : last.length > 0;
      if (done) return last;
      if (Date.now() - start > timeoutMs) return last;
      await sleep(500);
    }
  }
  const modePath = path.join(probeDir, 'mode.js');
  fs.writeFileSync(modePath,
    'console.log("' + VANAKKAM + '");\nconsole.log($' + T18 + ');\nconsole.log($' + T12 + '.' + T5 + ');\n', 'utf8');
  const modeDoc = await vscode.workspace.openTextDocument(modePath);
  await vscode.window.showTextDocument(modeDoc);
  await sleep(1800);
  record('literals file auto-switched to tamilscript', modeDoc.languageId === 'tamilscript', `languageId=${modeDoc.languageId}`);
  const foreignOt = await pollForeign(modeDoc.uri, true, 10000);
  record('no foreign diagnostics in tamilscript mode', foreignOt.length === 0, `foreign=${foreignOt.length}`);
  // The explicit command still switches documents that hold no literals.
  const cmdPath = path.join(probeDir, 'cmd-mode.js');
  fs.writeFileSync(cmdPath, 'let plain = 1;\n', 'utf8');
  const cmdDoc = await vscode.workspace.openTextDocument(cmdPath);
  await vscode.window.showTextDocument(cmdDoc);
  const switched = await vscode.commands.executeCommand('tamilscript.setLanguageMode');
  record('setLanguageMode switches to tamilscript', !!switched && switched.ok === true && cmdDoc.languageId === 'tamilscript', JSON.stringify(switched && { ok: switched.ok }));
  const bad2Path = path.join(probeDir, 'mode-bad.js');
  fs.writeFileSync(bad2Path, 'let s = $"oops;\n', 'utf8');
  const bad2Doc = await vscode.workspace.openTextDocument(bad2Path);
  await vscode.languages.setTextDocumentLanguage(bad2Doc, 'tamilscript');
  await sleep(1800);
  const ownBad2 = vscode.languages.getDiagnostics(bad2Doc.uri).filter((d) => d.source === 'tamilscript');
  record('malformed tamil flagged in tamilscript mode', ownBad2.some((d) => /JST_TAMIL_STRING_REMOVED/.test(d.message)), `own=${ownBad2.length}`);
  const jsBadPath = path.join(probeDir, 'plain-bad.js');
  fs.writeFileSync(jsBadPath, 'let x = ;\n', 'utf8');
  const jsBadDoc = await vscode.workspace.openTextDocument(jsBadPath);
  await vscode.window.showTextDocument(jsBadDoc);
  const foreignJs = await pollForeign(jsBadDoc.uri, false, 12000);
  record('plain js mistakes still reported in javascript mode', foreignJs.length > 0, `foreign=${foreignJs.length}`);
  await vscode.languages.setTextDocumentLanguage(modeDoc, 'javascript');
  record('mode switches back to javascript', modeDoc.languageId === 'javascript');
  // The extension must respect that choice: later edits must not re-switch.
  const respectEdit = new vscode.WorkspaceEdit();
  respectEdit.insert(modeDoc.uri, new vscode.Position(0, 0), '// edit after switch back\n');
  await vscode.workspace.applyEdit(respectEdit);
  await sleep(1500);
  record('manual switch back is respected (no auto-switch loop)', modeDoc.languageId === 'javascript', `languageId=${modeDoc.languageId}`);

  // 10. Automatic language mode: the original red-squiggle report is a file
  // with TamilScript literals opened as JavaScript, where the built-in
  // validator reports syntax errors it cannot avoid. Such files now switch
  // to the dedicated language mode; inert $ text and plain JavaScript stay
  // in JavaScript mode; *.ot.js opens in TamilScript mode; the setting
  // restores the previous behavior.
  const repoRoot = path.resolve(__dirname, '..', '..');
  const exprPath = path.join(repoRoot, 'examples', 'expressions.js');
  const exprBefore = fs.readFileSync(exprPath, 'utf8');
  const exprDoc = await vscode.workspace.openTextDocument(exprPath);
  await vscode.window.showTextDocument(exprDoc);
  const exprAuto = await pollLanguage(exprDoc, 'tamilscript', 8000);
  record('examples/expressions.js switches to tamilscript automatically', exprAuto, `languageId=${exprDoc.languageId}`);
  const foreignExpr = await pollForeign(exprDoc.uri, true, 10000);
  writeAux('.expr.json', {
    languageId: exprDoc.languageId,
    diags: vscode.languages.getDiagnostics(exprDoc.uri).map(
      (d) => `${d.source}:${d.code === undefined ? '' : d.code}:${d.message.split('\n')[0].slice(0, 80)}`
    ),
  });
  record('valid examples/expressions.js has no built-in parser squiggles', foreignExpr.length === 0, `foreign=${foreignExpr.length}`);
  const ownExpr = vscode.languages.getDiagnostics(exprDoc.uri).filter((d) => d.source === 'tamilscript');
  record('valid examples/expressions.js has no TamilScript errors', ownExpr.length === 0, `own=${ownExpr.length}`);
  record('language switch never modified examples/expressions.js', fs.readFileSync(exprPath, 'utf8') === exprBefore);
  // $ in comments, ordinary strings, regex, and template text is not a
  // literal: such files stay in JavaScript mode and stay clean.
  const inertPath = path.join(probeDir, 'inert.js');
  fs.writeFileSync(inertPath,
    '// $' + T18 + ' comment\nconst s = "$' + T18 + '";\nconst r = /$' + T18 + '/;\nconst t = `TPL $' + T18 + ' TXT`;\n', 'utf8');
  const inertDoc = await vscode.workspace.openTextDocument(inertPath);
  await vscode.window.showTextDocument(inertDoc);
  await sleep(1800);
  record('inert $ text never switches', inertDoc.languageId === 'javascript', `languageId=${inertDoc.languageId}`);
  const inertDiags = vscode.languages.getDiagnostics(inertDoc.uri).filter((d) => d.source !== 'tamilscript');
  record('inert file stays valid plain JavaScript', inertDiags.length === 0, `foreign=${inertDiags.length}`);
  // *.ot.js files open in the dedicated language mode by default.
  const assocPath = path.join(probeDir, 'assoc.ot.js');
  fs.writeFileSync(assocPath, 'let a = $' + T18 + ';\n', 'utf8');
  const assocDoc = await vscode.workspace.openTextDocument(assocPath);
  record('*.ot.js opens in tamilscript mode by default', assocDoc.languageId === 'tamilscript', `languageId=${assocDoc.languageId}`);
  const foreignAssoc = await pollForeign(assocDoc.uri, true, 8000);
  record('*.ot.js shows no built-in parser squiggles', foreignAssoc.length === 0, `foreign=${foreignAssoc.length}`);

  // 11. The representative file from the red-squiggle report — Tamil
  // identifiers, an ordinary string, Tamil numeric literals, and the அச்சிடு
  // helper — must collect no false diagnostics, saved or unsaved. Untitled
  // buffers matter because the built-in validator flags `$`-literals from the
  // first keystroke, before a new file has ever been saved; they are switched
  // by content like any other user-editable JavaScript document.
  const repPath = path.join(probeDir, 'red-squiggle-rep.js');
  fs.writeFileSync(repPath, REPRESENTATIVE, 'utf8');
  const repDoc = await vscode.workspace.openTextDocument(repPath);
  await vscode.window.showTextDocument(repDoc);
  const repSwitched = await pollLanguage(repDoc, 'tamilscript', 8000);
  const foreignRep = await pollForeign(repDoc.uri, true, 10000);
  const ownRep = vscode.languages.getDiagnostics(repDoc.uri).filter((d) => d.source === 'tamilscript');
  record('representative file: auto-switches to tamilscript', repSwitched, `languageId=${repDoc.languageId}`);
  record('representative file: no built-in parser squiggles', foreignRep.length === 0, `foreign=${foreignRep.length}`);
  record('representative file: no TamilScript errors', ownRep.length === 0, `own=${ownRep.length}`);
  // Valid Tamil content must also keep correct token scopes: no invalid
  // styling on the literals, and literal scopes present on $ forms.
  let repTokens = [];
  try {
    repTokens = await vscode.commands.executeCommand('_workbench.captureSyntaxTokens', repDoc.uri);
  } catch (err) {
    void err;
  }
  const repInvalid = (repTokens || []).filter((t) => /invalid/.test(String((t && t.t) || '')));
  const repLit = (repTokens || []).filter((t) =>
    /constant\.numeric/.test(String((t && t.t) || ''))
  );
  record('representative file: no invalid grammar scopes', repInvalid.length === 0, `invalid=${repInvalid.length}`);
  record('representative file: Tamil literal scopes present', repLit.length > 0, `lit=${repLit.length}`);
  const repUntitled = await vscode.workspace.openTextDocument({
    content: REPRESENTATIVE,
    language: 'javascript',
  });
  await vscode.window.showTextDocument(repUntitled);
  const untitledSwitched = await pollLanguage(repUntitled, 'tamilscript', 8000);
  const foreignUntitled = await pollForeign(repUntitled.uri, true, 10000);
  record('untitled buffer: auto-switches to tamilscript', untitledSwitched, `languageId=${repUntitled.languageId}`);
  record('untitled buffer: no built-in parser squiggles', foreignUntitled.length === 0, `foreign=${foreignUntitled.length}`);
  // Inert $ text in an untitled buffer is not a literal: no switch.
  const inertUntitled = await vscode.workspace.openTextDocument({
    content: '// $' + T18 + ' comment\nconst s = "$' + T18 + '";\n',
    language: 'javascript',
  });
  await vscode.window.showTextDocument(inertUntitled);
  await sleep(1800);
  record(
    'inert untitled buffer stays in javascript mode',
    inertUntitled.languageId === 'javascript',
    `languageId=${inertUntitled.languageId}`
  );
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  // Escape hatch: disabling the setting restores the previous behavior.
  const otCfg = vscode.workspace.getConfiguration('tamilscript');
  await otCfg.update('autoLanguageMode', false, vscode.ConfigurationTarget.Global);
  const offPath = path.join(probeDir, 'noauto.js');
  fs.writeFileSync(offPath, 'let s = $' + T12 + '.' + T5 + ';\n', 'utf8');
  const offDoc = await vscode.workspace.openTextDocument(offPath);
  await vscode.window.showTextDocument(offDoc);
  await sleep(1500);
  record('autoLanguageMode=false keeps the file in javascript mode', offDoc.languageId === 'javascript', `languageId=${offDoc.languageId}`);
  const foreignOff = await pollForeign(offDoc.uri, false, 12000);
  record('with auto-switch off the built-in validator flags literals again', foreignOff.length > 0, `foreign=${foreignOff.length}`);
  // The exact reported file, while the built-in validator is attached:
  // `$` + Tamil digits is a valid identifier, so its integer line parses;
  // only the fractional part after the dot is unparsable, which is why the
  // report shows exactly one red squiggle, on the decimal line. Capture the
  // diagnostic code and range as evidence for the root cause.
  const userPath = path.join(probeDir, 'user-report.js');
  fs.writeFileSync(userPath, USER_REPORT, 'utf8');
  const userDoc = await vscode.workspace.openTextDocument(userPath);
  await vscode.window.showTextDocument(userDoc);
  await sleep(1500);
  record('user report file stays in javascript mode while auto-switch is off', userDoc.languageId === 'javascript', `languageId=${userDoc.languageId}`);
  const foreignUser = await pollForeign(userDoc.uri, false, 12000);
  const userDump = foreignUser.map((d) => ({
    source: d.source,
    code: d.code === undefined ? null : d.code,
    message: String(d.message).split('\n')[0],
    line: d.range.start.line,
    column: d.range.start.character,
  }));
  writeAux('.user-ts-diags.json', userDump);
  const codeOf = (d) => String(d.code);
  const err1127 = foreignUser.filter((d) => codeOf(d) === '1127');
  record(
    'built-in validator reports ts(1127) on the decimal literal line',
    err1127.length > 0 && err1127.some((d) => d.range.start.line === 2),
    `codes=${userDump.map((d) => d.code).join(',')} lines=${userDump.map((d) => d.line).join(',')}`
  );
  record(
    'built-in validator accepts the integer literal line',
    !foreignUser.some((d) => d.range.start.line === 1),
    `lines=${userDump.map((d) => d.line).join(',')}`
  );
  // Re-enable the setting (explicit true: `update(key, undefined)` writes
  // null in this API, which is not the schema default the extension
  // expects). The extension re-evaluates open documents on tamilscript.*
  // configuration changes, so the still-open file must switch without an
  // edit or a reopen, and both the ts(1127) squiggle and any TamilScript
  // error must be gone.
  await otCfg.update('autoLanguageMode', true, vscode.ConfigurationTarget.Global);
  const userSwitched = await pollLanguage(userDoc, 'tamilscript', 8000);
  const foreignUser2 = await pollForeign(userDoc.uri, true, 10000);
  const ownUser2 = vscode.languages.getDiagnostics(userDoc.uri).filter((d) => d.source === 'tamilscript');
  const userCheck = await vscode.commands.executeCommand('tamilscript.checkFile');
  record(
    're-enabling the setting switches the open user report file',
    userSwitched,
    `languageId=${userDoc.languageId}`
  );
  record('user report file: ts(1127) false positive is gone', foreignUser2.length === 0, `foreign=${foreignUser2.length}`);
  record(
    'user report file: no TamilScript errors, checkFile ok',
    ownUser2.length === 0 && !!(userCheck && userCheck.ok === true),
    `own=${ownUser2.length} check=${userCheck && userCheck.ok}`
  );
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

  const failed = results.filter((r) => !r.ok && r.name !== 'captureSyntaxTokens available');
  const report = {
    ok: failed.length === 0,
    tokenNote: tokenVerdict,
    results,
  };
  if (outPath) fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`INTEG ${report.ok ? 'OK' : 'FAILED'} (${failed.length} failures)`);
  if (!report.ok) throw new Error(`integration failures: ${failed.map((f) => f.name).join('; ')}`);
}

async function run() {
  await main();
}

module.exports = { run };
