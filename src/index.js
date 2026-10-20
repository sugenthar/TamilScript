'use strict';

const { toNumber, toTamilNumerals, parseTamilDecimal, toTamilDecimal } = require('./numerals');
const { transform, transformWithMap, transformWithMeta } = require('./transformer');
const { transformFile } = require('./transform-file');
const { runFile, checkFile } = require('./runner');
const { அச்சிடு } = require('./runtime');
const { inlineSourceMapComment } = require('./sourcemap');
const errors = require('./errors');
const {
  ErrorCodes,
  formatDiagnostic,
  JsTamilError,
  JsTamilSyntaxError,
  TamilScriptError,
  TamilScriptSyntaxError,
} = errors;

const VERSION = require('../package.json').version;

// Keep this object literal to plain shorthand entries only:
// cjs-module-lexer stops collecting named exports after a
// `name: object.property` entry, which would leave VERSION, the error
// classes, formatDiagnostic and அச்சிடு unreachable from ESM named imports
// (`import { VERSION } from 'tamilscript'`). The historical key order is
// preserved and the new TamilScript error aliases are inserted just before
// the helper; test/esm-exports.test.js pins the documented order.
module.exports = {
  toNumber,
  toTamilNumerals,
  parseTamilDecimal,
  toTamilDecimal,
  transform,
  transformWithMap,
  transformWithMeta,
  transformFile,
  runFile,
  checkFile,
  inlineSourceMapComment,
  errors,
  ErrorCodes,
  formatDiagnostic,
  JsTamilError,
  JsTamilSyntaxError,
  TamilScriptError,
  TamilScriptSyntaxError,
  அச்சிடு,
  VERSION,
};
