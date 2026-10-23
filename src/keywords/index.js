'use strict';

const { DEFINITIONS } = require('./definitions');
const {
  getKeywordMapping,
  getKeywordByJavaScript,
  implementedKeywords,
  deferredKeywords,
  helperKeywords,
} = require('./mappings');
const {
  keywordOptions,
  isDottedName,
  isKeywordEligible,
  isPropertyNamePosition,
} = require('./context');

module.exports = {
  DEFINITIONS,
  getKeywordMapping,
  getKeywordByJavaScript,
  implementedKeywords,
  deferredKeywords,
  helperKeywords,
  keywordOptions,
  isDottedName,
  isKeywordEligible,
  isPropertyNamePosition,
};
