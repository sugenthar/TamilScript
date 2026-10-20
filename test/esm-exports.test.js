'use strict';

// ESM interop for the package root: every runtime export declared in
// src/index.d.ts must be importable by name from 'tamilscript'. This pins a
// real cjs-module-lexer trap — it stops collecting named exports after a
// `name: object.property` entry, which previously hid VERSION, the error
// classes, formatDiagnostic and அச்சிடு from ESM importers.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function node(args) {
  return spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT });
}

describe('ESM named exports', () => {
  it('every runtime export declared in index.d.ts is importable by name', () => {
    const dts = fs.readFileSync(path.join(ROOT, 'src', 'index.d.ts'), 'utf8');
    const declared = [];
    const re = /^export (?:declare )?(?:const|function|class) ([^\s(:<]+)/gm;
    let m;
    while ((m = re.exec(dts)) !== null) declared.push(m[1]);
    assert.equal(declared.length, 20, `declared runtime exports changed: ${declared.join(', ')}`);
    assert.ok(declared.includes('அச்சிடு'), 'Tamil helper must stay part of the API');
    const script = [
      "import * as ns from 'tamilscript';",
      `const declared = ${JSON.stringify(declared)};`,
      'const missing = declared.filter((n) => !(n in ns));',
      'console.log(JSON.stringify(missing));',
    ].join('\n');
    const r = node(['--input-type=module', '-e', script]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), [], 'ESM namespace is missing declared exports');
  });

  it('static ESM named imports work for the lexer-hidden names', () => {
    const script =
      "import { VERSION, formatDiagnostic, JsTamilError, JsTamilSyntaxError, TamilScriptError, TamilScriptSyntaxError, அச்சிடு } from 'tamilscript';" +
      'console.log(typeof VERSION, typeof formatDiagnostic, typeof JsTamilError, typeof JsTamilSyntaxError, typeof TamilScriptError, typeof TamilScriptSyntaxError, typeof அச்சிடு);';
    const r = node(['--input-type=module', '-e', script]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'string function function function function function function');
  });

  it('CommonJS keeps the documented key order and values', () => {
    const expected = [
      'toNumber', 'toTamilNumerals', 'parseTamilDecimal', 'toTamilDecimal',
      'transform', 'transformWithMap', 'transformWithMeta', 'transformFile',
      'runFile', 'checkFile', 'inlineSourceMapComment', 'errors',
      'ErrorCodes', 'formatDiagnostic', 'JsTamilError', 'JsTamilSyntaxError',
      'TamilScriptError', 'TamilScriptSyntaxError', 'அச்சிடு', 'VERSION',
    ];
    const r = node(['-e', 'console.log(JSON.stringify(Object.keys(require("tamilscript"))))']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), expected);
  });

  it('the runtime entry point exports the Tamil helper over ESM', () => {
    const r = node([
      '--input-type=module',
      '-e',
      "import { அச்சிடு } from 'tamilscript/runtime'; console.log(typeof அச்சிடு);",
    ]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'function');
  });
});
