'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { transform } = require('../src/index');
const {
  JsTamilError,
  JsTamilSyntaxError,
  ErrorCodes,
  formatDiagnostic,
} = require('../src/errors');

describe('diagnostics: error codes', () => {
  it('exposes stable codes for every error category', () => {
    const cases = [
      ['let s = $"abc;', 'JST_TAMIL_STRING_REMOVED'],
      ['let x = $௧abc;', 'JST_BAD_NUMERIC_LITERAL'],
      ['let x = $௧.5;', 'JST_MIXED_NUMERAL'],
      ['let x = $௧n;', 'JST_UNSUPPORTED_BIGINT'],
      ['let $x = 1;', null], // plain `$` identifier: ordinary JavaScript
      ['/* abc', 'JST_UNTERMINATED_COMMENT'],
      ['const s = "abc;', 'JST_UNTERMINATED_STRING'],
      ['const t = `abc;', 'JST_UNTERMINATED_TEMPLATE'],
      ['const r = /abc;', 'JST_UNTERMINATED_REGEX'],
    ];
    for (const [src, code] of cases) {
      if (code === null) {
        assert.doesNotThrow(() => transform(src), src);
        continue;
      }
      try {
        transform(src);
        assert.fail(`should have thrown for ${src}`);
      } catch (err) {
        assert.ok(err instanceof JsTamilSyntaxError, src);
        assert.equal(err.code, code, src);
        assert.equal(err.code, ErrorCodes[code.replace(/^JST_/, '')] || err.code, src);
      }
    }
  });

  it('error codes are stable public constants', () => {
    // Retained for API compatibility after the `$"..."` string form was
    // removed (no longer produced).
    assert.equal(ErrorCodes.UNCLOSED_TAMIL_STRING, 'JST_UNCLOSED_STRING');
    assert.equal(ErrorCodes.TAMIL_STRING_REMOVED, 'JST_TAMIL_STRING_REMOVED');
    assert.equal(ErrorCodes.BAD_TAMIL_NUMBER, 'JST_BAD_NUMERIC_LITERAL');
    assert.equal(typeof ErrorCodes.INVALID_NUMERAL_INPUT, 'string');
  });
});

describe('diagnostics: formatDiagnostic', () => {
  it('formats filename:line:column header with code and snippet', () => {
    const source = 'let a = 1;\nlet x = $௧abc;\nlet b = 2;\n';
    let caught = null;
    try {
      transform(source, { filename: 'example.js' });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof JsTamilSyntaxError);
    const text = formatDiagnostic(caught, { source });
    const lines = text.split('\n');
    assert.equal(lines[0], 'example.js:2:9');
    assert.match(lines[1], /JsTamilSyntaxError \[JST_BAD_NUMERIC_LITERAL\]/);
    assert.match(text, /let x = \$௧abc;/);
    assert.match(text, /\^/);
  });

  it('matches the documented shape: file:line:col then named error', () => {
    const source = 'a\nb\nlet s = $"oops;\n';
    let caught = null;
    try {
      transform(source, { filename: 'example.js' });
    } catch (err) {
      caught = err;
    }
    const text = formatDiagnostic(caught, { source });
    assert.match(text, /^example\.js:3:9\nJsTamil(Syntax)?Error/);
  });

  it('works without filename or source', () => {
    let caught = null;
    try {
      transform('let s = $"abc;');
    } catch (err) {
      caught = err;
    }
    const text = formatDiagnostic(caught);
    assert.match(text, /^line 1, column 9\n/);
    assert.doesNotMatch(text, /\|/);
  });

  it('handles CRLF line endings with correct line numbers', () => {
    const source = 'let a = 1;\r\nlet x = $௧abc;\r\n';
    let caught = null;
    try {
      transform(source, { filename: 'crlf.js' });
    } catch (err) {
      caught = err;
    }
    assert.equal(caught.line, 2);
    const text = formatDiagnostic(caught, { source });
    assert.match(text, /^crlf\.js:2:9\n/);
    assert.match(text, /let x = \$௧abc;/);
  });

  it('handles lone-CR line endings', () => {
    const source = 'let a = 1;\rlet x = $௧abc;\r';
    let caught = null;
    try {
      transform(source);
    } catch (err) {
      caught = err;
    }
    assert.equal(caught.line, 2);
  });

  it('counts columns in UTF-16 units after Unicode content', () => {
    // Two Tamil chars (BMP, 1 unit each) precede the error on line 2.
    const source = 'let t = "தமிழ்";\nlet x = $௧abc;\n';
    let caught = null;
    try {
      transform(source);
    } catch (err) {
      caught = err;
    }
    assert.equal(caught.line, 2);
    assert.equal(caught.column, 9);
  });

  it('locates errors inside nested template expressions', () => {
    const source = 'const t = `a ${`b ${$௧abc}`} c`;\n';
    let caught = null;
    try {
      transform(source, { filename: 'tpl.js' });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof JsTamilSyntaxError);
    assert.equal(caught.line, 1);
    const text = formatDiagnostic(caught, { source });
    assert.match(text, /^tpl\.js:1:\d+\n/);
  });

  it('truncates huge lines instead of dumping files', () => {
    const source = `let pad = "${'x'.repeat(500)}";\nlet x = $௧abc;\n`;
    let caught = null;
    try {
      transform(source);
    } catch (err) {
      caught = err;
    }
    const text = formatDiagnostic(caught, { source, maxWidth: 60 });
    assert.ok(text.length < 500, `diagnostic too long: ${text.length}`);
    assert.match(text, /\^/);
  });

  it('aligns the caret on multi-digit line numbers', () => {
    for (const lineNo of [12, 123]) {
      const source =
        Array.from({ length: lineNo - 1 }, (_, i) => `let v${i} = ${i};`).join('\n') +
        '\nlet x = $௧abc;\n';
      const err = new JsTamilSyntaxError('boom', { line: lineNo, column: 9, filename: 'lines.js' });
      const lines = formatDiagnostic(err, { source }).split('\n');
      const shown = lines[lines.length - 2];
      const caret = lines[lines.length - 1];
      assert.equal(shown.indexOf('|'), caret.indexOf('|'), `gutter for line ${lineNo}`);
      assert.equal(caret.indexOf('^'), shown.indexOf('$௧abc'), `caret for line ${lineNo}`);
    }
  });

  it('clamps the caret to the shown line for absurd or past-end columns', () => {
    const source = 'let x = $௧abc;\n';
    const huge = new JsTamilSyntaxError('boom', { line: 1, column: 1e9, filename: 'big.js' });
    const text = formatDiagnostic(huge, { source });
    const caretLine = text.split('\n').pop();
    assert.ok(caretLine.length <= source.length + 8, `caret line too long: ${caretLine.length}`);
    assert.match(caretLine, /\^$/);

    const pastEnd = new JsTamilSyntaxError('boom', { line: 1, column: 999, filename: 'big.js' });
    const text2 = formatDiagnostic(pastEnd, { source });
    const errorLine = source.split('\n')[0];
    assert.equal(text2.split('\n').pop(), `    | ${' '.repeat(errorLine.length)}^`);

    const wide = `let x = "${'x'.repeat(500)}";\n`;
    const text3 = formatDiagnostic(huge, { source: wide, maxWidth: 60 });
    assert.match(text3, /\^$/);
    assert.ok(text3.split('\n').pop().length < 100);
  });

  it('preserves CRLF endings through transformation', () => {
    const vm = require('node:vm');
    const source = 'let a = $௧௮;\r\nlet b = $௧.௫;\r\nmodule.exports = a + b;\r\n';
    const out = transform(source);
    assert.ok(out.includes('\r\n'), 'CRLF preserved');
    const sandbox = { module: { exports: {} } };
    vm.runInNewContext(out, sandbox);
    assert.equal(sandbox.module.exports, 19.5);
  });

  it('formats a locationless base error without a snippet', () => {
    const err = new JsTamilError('boom', { code: ErrorCodes.INVALID_NUMERAL_INPUT });
    assert.equal(formatDiagnostic(err), 'JsTamilError [JST_INVALID_NUMERAL]: boom');
  });

  it('passes through unknown errors as strings', () => {
    assert.match(formatDiagnostic(new Error('plain')), /plain/);
  });
});
