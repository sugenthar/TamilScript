'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { makeHandlers } = require('../extension');
const lang = require('../tamilscriptLang');
const { makeFakeVscode, makeDoc } = require('./fake-vscode');

const EXT_DIR = require('node:path').resolve(__dirname, '..');
const api = lang.resolveCore({ localDir: EXT_DIR }).api;

const VALID = 'செயல் கூட்டு(a, b) { கொடு a + b; }\n';
const INVALID = 'என்றால் (true) { let x = ; }\n';

describe('VS Code Tamil keyword mode', () => {
  it('passes the option through validation and transformation', () => {
    assert.equal(lang.validateText(api, VALID, 'a.ot.js', { tamilKeywords: true }).ok, true);
    assert.equal(lang.validateText(api, VALID, 'a.ot.js', { tamilKeywords: false }).ok, false);

    const transformed = lang.transformText(api, VALID, 'a.ot.js', { tamilKeywords: true });
    assert.equal(transformed.ok, true);
    assert.match(transformed.code, /function கூட்டு/);
    assert.match(transformed.code, /return a \+ b/);

    const disabled = lang.transformText(api, VALID, 'a.ot.js');
    assert.equal(disabled.ok, false);
    assert.equal(disabled.diagnostic.code, 'JST_JAVASCRIPT_SYNTAX');
  });

  it('detects keyword-only sources for auto language switching when enabled', () => {
    assert.equal(lang.hasTamilLiterals(api, VALID), false);
    assert.equal(lang.hasTamilLiterals(api, VALID, { tamilKeywords: true }), true);
    assert.equal(lang.hasTamilLiterals(api, 'const ordinary = 1;\n', { tamilKeywords: true }), false);
  });

  it('reports parser errors at 0-based locations', () => {
    const result = lang.validateText(api, INVALID, 'bad.ot.js', { tamilKeywords: true });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.code, 'JST_JAVASCRIPT_SYNTAX');
    assert.equal(result.diagnostic.line, 0);
  });

  it('honors tamilscript.tamilKeywords in live diagnostics', () => {
    const enabled = makeFakeVscode({ config: { tamilKeywords: true } });
    const enabledHandlers = makeHandlers(enabled, { extensionDir: EXT_DIR });
    const validDoc = makeDoc(VALID, 'tamilscript', '/w/valid.ot.js');
    assert.equal(enabledHandlers.validateDocument(validDoc).ok, true);
    assert.equal(enabled.collection.get(validDoc.uri), undefined);

    const invalidDoc = makeDoc(INVALID, 'tamilscript', '/w/invalid.ot.js');
    assert.equal(enabledHandlers.validateDocument(invalidDoc).ok, false);
    assert.equal(enabled.collection.get(invalidDoc.uri).length, 1);

    const disabled = makeFakeVscode({ config: { tamilKeywords: false } });
    const disabledHandlers = makeHandlers(disabled, { extensionDir: EXT_DIR });
    const rejected = makeDoc(VALID, 'tamilscript', '/w/rejected.ot.js');
    assert.equal(disabledHandlers.validateDocument(rejected).ok, false);
    assert.equal(disabled.collection.get(rejected.uri).length, 1);
  });
});
