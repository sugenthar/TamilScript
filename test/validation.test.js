'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { validate } = require('../src');

describe('validate()', () => {
  it('accepts valid scripts and modules without executing either', () => {
    const key = `__tamilscript_validate_${process.pid}`;
    const script = `globalThis.${key} = 1;\nconst value = $௧௮;\n`;
    const result = validate(script);
    assert.equal(result.ok, true);
    assert.match(result.code, /const value = 18/);
    assert.equal(globalThis[key], undefined, 'validate() must never execute source');

    for (const source of [
      "import fs from 'node:fs';\nexport const x = 1;\n",
      'export default function () {}\n',
      'return 1;\n',
      'await Promise.resolve(1);\n',
    ]) {
      assert.equal(validate(source).ok, true, source);
    }
  });

  it('reports the first lexical error with 1-based positions and a stable code', () => {
    const result = validate('const x = $௧abc;\n', { filename: 'bad.ot.js' });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.code, 'JST_BAD_NUMERIC_LITERAL');
    assert.equal(result.diagnostic.name, 'JsTamilSyntaxError');
    assert.equal(result.diagnostic.line, 1);
    assert.equal(result.diagnostic.column, 11);
  });

  it('parser-reports invalid JavaScript with a stable code', () => {
    const result = validate('let b = ;\n', { filename: 'bad.js' });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.code, 'JST_JAVASCRIPT_SYNTAX');
    assert.equal(result.diagnostic.name, 'SyntaxError');
    assert.equal(result.diagnostic.line, 1);
    assert.equal(result.diagnostic.column, 9);
    assert.doesNotMatch(result.diagnostic.message, /\(\d+:\d+\)$/);
  });

  it('maps parser columns back through keyword and range replacements', () => {
    const keywordSource = 'என்றால் (true) { let y = ; }';
    const keywordColumn = keywordSource.indexOf(';', keywordSource.indexOf('let y')) + 1;
    const keywordResult = validate(keywordSource, { tamilKeywords: true });
    assert.equal(keywordResult.ok, false);
    assert.equal(keywordResult.diagnostic.line, 1);
    assert.equal(keywordResult.diagnostic.column, keywordColumn);

    const rangeSource = 'const xs = $௧..$௫; const y = ;';
    const rangeColumn = rangeSource.lastIndexOf(';') + 1;
    const rangeResult = validate(rangeSource);
    assert.equal(rangeResult.ok, false);
    assert.equal(rangeResult.diagnostic.line, 1);
    assert.equal(rangeResult.diagnostic.column, rangeColumn);
  });

  it('honors keyword mode rather than silently enabling it', () => {
    const source = 'const என்றால் = 1;\n';
    assert.equal(validate(source).ok, true);
    const enabled = validate(source, { tamilKeywords: true });
    assert.equal(enabled.ok, false);
    assert.equal(enabled.diagnostic.code, 'JST_JAVASCRIPT_SYNTAX');
  });

  it('rejects a non-string source with TypeError, like transform()', () => {
    assert.throws(() => validate(null), TypeError);
    assert.throws(() => validate(42), TypeError);
  });

  it('rejects a public method call with a missing receiver/argument', () => {
    assert.equal(validate('class C { constructor() { super(); } }').ok, false);
    assert.equal(validate('async function f() { await; }').ok, false);
    assert.equal(validate('const a = 1; const a = 2;').ok, false);
  });
});
