'use strict';

const { mapGeneratedPosition } = require('../sourcemap');

/**
 * Convert a parser error location in transformed JavaScript back to the
 * original TamilScript source. Generated and source lines are identical by
 * design, but columns can differ after a keyword or literal replacement.
 *
 * @param {{ line: number, column: number }} location 1-based generated location
 * @param {Array<{ outLine: number, outCol: number, srcLine: number, srcCol: number }>} positions
 * @returns {{ line: number, column: number }} 1-based original location
 */
function mapGeneratedLocation(location, positions) {
  if (!location) return { line: 1, column: 1 };
  return mapGeneratedPosition(positions, location.line, location.column);
}

/**
 * Parser messages end with their own `(line:column)`; the structured
 * location is authoritative and the duplicate suffix would confuse editors.
 * @param {string} message
 * @returns {string}
 */
function cleanParserMessage(message) {
  return String(message || 'Invalid JavaScript syntax').replace(/\s*\(\d+:\d+\)\s*$/, '');
}

module.exports = {
  mapGeneratedLocation,
  cleanParserMessage,
};
