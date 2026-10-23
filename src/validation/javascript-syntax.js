'use strict';

const { ErrorCodes } = require('../errors');
const { mapGeneratedLocation, cleanParserMessage } = require('./source-locations');

/**
 * Parse transformed JavaScript without evaluating it. TamilScript files may
 * be scripts or modules, and the editor does not know the package type, so a
 * source is accepted when it parses as either. When both modes fail, the
 * error that made more progress is reported (this points at the real mistake
 * in a module instead of stopping at its first `import` keyword).
 *
 * @param {string} code transformed JavaScript
 * @param {Array<object>} positions generated-to-source token anchors
 * @returns {null | { line: number, column: number, message: string, code: string, name: string }}
 */
function parseJavaScript(code, positions) {
  // Lazy require keeps transform-only users working even in minimal copies of
  // the core tree; validate() needs the declared acorn dependency.
  // eslint-disable-next-line global-require
  const acorn = require('acorn');
  const errors = [];
  for (const sourceType of ['script', 'module']) {
    try {
      acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType,
        locations: true,
        allowHashBang: true,
        // Node's CommonJS wrapper permits top-level return; ESM does not.
        allowReturnOutsideFunction: sourceType === 'script',
      });
      return null;
    } catch (err) {
      errors.push({ sourceType, err });
    }
  }
  const chosen = errors.reduce((best, current) => {
    const bestPos = best && best.err && typeof best.err.pos === 'number' ? best.err.pos : -1;
    const currentPos = current && current.err && typeof current.err.pos === 'number' ? current.err.pos : -1;
    return currentPos >= bestPos ? current : best;
  }, null);
  const err = chosen && chosen.err ? chosen.err : {};
  const generated = {
    line: err.loc && err.loc.line ? err.loc.line : 1,
    column: err.loc && typeof err.loc.column === 'number' ? err.loc.column + 1 : 1,
  };
  const original = mapGeneratedLocation(generated, positions);
  return {
    line: original.line,
    column: original.column,
    message: cleanParserMessage(err.message),
    code: ErrorCodes.JAVASCRIPT_SYNTAX,
    name: 'SyntaxError',
  };
}

module.exports = {
  parseJavaScript,
};
