'use strict';

const { DEFINITIONS } = require('./definitions');

/**
 * Derived lookup tables. Keep the literal word-to-JavaScript mappings in
 * definitions.js only; everything here is computed from that registry.
 */
const IMPLEMENTED = Object.freeze(
  DEFINITIONS.filter((entry) => entry.status === 'implemented')
);

const BY_TAMIL = new Map(IMPLEMENTED.map((entry) => [entry.tamil, entry]));
const BY_JS = new Map(IMPLEMENTED.map((entry) => [entry.js, entry]));

/**
 * Look up an implemented Tamil keyword.
 * @param {string} word
 * @returns {object|null} registry entry, or null when the word is not an
 *   enabled keyword (including deferred and helper words)
 */
function getKeywordMapping(word) {
  return BY_TAMIL.get(word) || null;
}

/**
 * Look up a keyword by its JavaScript spelling. Used by scanner context
 * tests; the scanner itself normally works from the Tamil entry.
 * @param {string} word
 * @returns {object|null}
 */
function getKeywordByJavaScript(word) {
  return BY_JS.get(word) || null;
}

/** @returns {object[]} entries rewritten in keyword mode */
function implementedKeywords() {
  return IMPLEMENTED.slice();
}

/** @returns {object[]} entries intentionally not rewritten */
function deferredKeywords() {
  return DEFINITIONS.filter((entry) => entry.status === 'deferred');
}

/** @returns {object[]} explicit runtime helpers */
function helperKeywords() {
  return DEFINITIONS.filter((entry) => entry.status === 'helper');
}

module.exports = {
  getKeywordMapping,
  getKeywordByJavaScript,
  implementedKeywords,
  deferredKeywords,
  helperKeywords,
};
