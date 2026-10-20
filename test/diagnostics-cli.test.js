'use strict';

// Diagnostics layer: error categories, accurate hints, preserved
// messages/stacks/causes, and the optional Tamil mode. The Tamil strings
// are asserted literally so a mistranslation or encoding regression fails
// the suite instead of shipping.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  Category,
  categorizeError,
  suggestFix,
  label,
  isTamilLanguage,
  formatProblem,
  formatCliError,
} = require('../src/diagnostics.js');
const { JsTamilSyntaxError, ErrorCodes } = require('../src/errors.js');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');

let workdir;
before(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-diag-'));
});
after(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

function cli(args, options) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    ...options,
  });
}

function tmp(name, content) {
  const p = path.join(workdir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

describe('diagnostics: categories', () => {
  it('classifies Tamil syntax errors as validation', () => {
    const err = new JsTamilSyntaxError('x', { code: ErrorCodes.TAMIL_STRING_REMOVED, line: 1, column: 1 });
    assert.equal(categorizeError(err), Category.VALIDATION);
    assert.equal(categorizeError(err, Category.RUNTIME), Category.VALIDATION);
  });
  it('classifies reader/writer and filesystem codes as file', () => {
    assert.equal(categorizeError({ code: 'JST_READ_ERROR' }), Category.FILE);
    assert.equal(categorizeError({ code: 'JST_WRITE_ERROR' }), Category.FILE);
    assert.equal(categorizeError({ code: 'ENOENT' }), Category.FILE);
    assert.equal(categorizeError({ code: 'EISDIR' }), Category.FILE);
    assert.equal(categorizeError({ code: 'EACCES' }), Category.FILE);
  });
  it('classifies scaffold guard codes as file', () => {
    assert.equal(categorizeError({ code: 'SCAFFOLD_EEXIST' }), Category.FILE);
    assert.equal(categorizeError({ code: 'SCAFFOLD_DEST_FILE' }), Category.FILE);
  });
  it('classifies other JST codes as validation', () => {
    assert.equal(categorizeError({ code: 'JST_UNCLOSED_STRING' }), Category.VALIDATION);
  });
  it('defaults to runtime and honours an explicit fallback', () => {
    assert.equal(categorizeError(new Error('x')), Category.RUNTIME);
    assert.equal(categorizeError({ code: 'WEIRD_CODE' }), Category.RUNTIME);
    assert.equal(categorizeError({ code: 'WEIRD_CODE' }, Category.USAGE), Category.USAGE);
    assert.equal(categorizeError(null, Category.CONFIG), Category.CONFIG);
  });
});

describe('diagnostics: suggestions', () => {
  it('gives the exact hint for a known TamilScript code', () => {
    assert.equal(
      suggestFix({ code: 'JST_TAMIL_STRING_REMOVED' }, Category.VALIDATION),
      'Remove the $ before the quote: write an ordinary JavaScript string.'
    );
  });
  it('gives file hints keyed by filesystem code', () => {
    assert.match(suggestFix({ code: 'ENOENT' }, Category.FILE), /Check the path/);
    assert.match(suggestFix({ code: 'EISDIR' }, Category.FILE), /not a directory/);
    assert.match(suggestFix({}, Category.FILE), /Check the path and file permissions/);
  });
  it('points usage errors at the help output', () => {
    assert.equal(suggestFix(new Error('x'), Category.USAGE), 'Run `tamilscript --help` to see the available commands.');
  });
  it('never invents hints for runtime errors', () => {
    assert.equal(suggestFix(new Error('boom'), Category.RUNTIME), null);
    assert.equal(suggestFix(null, Category.RUNTIME), null);
  });
});

describe('diagnostics: Tamil catalogue', () => {
  it('has exact English labels', () => {
    assert.equal(label('error', false), 'Error');
    assert.equal(label('warning', false), 'Warning');
    assert.equal(label('hint', false), 'Hint');
    assert.equal(label('ok', false), 'OK');
    assert.equal(label('usage', false), 'usage');
    assert.equal(label('file', false), 'file');
    assert.equal(label('validation', false), 'validation');
    assert.equal(label('config', false), 'config');
    assert.equal(label('runtime', false), 'runtime');
    assert.equal(label('unknownCommand', false), 'unknown command');
    assert.equal(label('fileNotFound', false), 'file not found');
    assert.equal(label('missingFileArgument', false), 'missing file argument');
  });
  it('has exact Tamil labels', () => {
    assert.equal(label('error', true), 'பிழை');
    assert.equal(label('warning', true), 'எச்சரிக்கை');
    assert.equal(label('hint', true), 'குறிப்பு');
    assert.equal(label('ok', true), 'சரி');
    assert.equal(label('usage', true), 'பயன்பாட்டுப் பிழை');
    assert.equal(label('file', true), 'கோப்புப் பிழை');
    assert.equal(label('validation', true), 'சரிபார்ப்புப் பிழை');
    assert.equal(label('config', true), 'அமைப்புப் பிழை');
    assert.equal(label('runtime', true), 'இயக்கநேரப் பிழை');
    assert.equal(label('unknownCommand', true), 'தெரியாத கட்டளை');
    assert.equal(label('fileNotFound', true), 'கோப்பு கிடைக்கவில்லை');
    assert.equal(label('missingFileArgument', true), 'கோப்பு குறிப்பிடப்படவில்லை');
  });
  it('Tamil strings are well-formed Tamil code points (no mojibake)', () => {
    for (const key of ['error', 'warning', 'hint', 'ok', 'usage', 'file', 'validation', 'config', 'runtime']) {
      for (const ch of label(key, true)) {
        const cp = ch.codePointAt(0);
        assert.ok(
          cp === 0x20 || (cp >= 0x0b80 && cp <= 0x0bff),
          `${key}: U+${cp.toString(16).toUpperCase()} is neither a space nor a Tamil block code point`
        );
      }
    }
  });
  it('falls back to the key for unknown labels', () => {
    assert.equal(label('not-a-key', true), 'not-a-key');
  });
  it('recognises only exact Tamil language values', () => {
    for (const v of ['tamil', 'Tamil', 'TAMIL', 'ta', 'TA', '  tamil  ']) {
      assert.equal(isTamilLanguage(v), true, String(v));
    }
    for (const v of ['en', '', 'tamils', 'ta-IN', undefined, null]) {
      assert.equal(isTamilLanguage(v), false, String(v));
    }
  });
});

describe('diagnostics: formatting', () => {
  it('formats English problems with category and hint', () => {
    assert.equal(
      formatProblem(Category.FILE, 'file not found: x.js', { hint: 'H' }),
      'Error [file]: file not found: x.js\nHint: H'
    );
  });
  it('formats Tamil labels but leaves uncatalogued messages in English', () => {
    assert.equal(
      formatProblem(Category.FILE, 'file not found: x.js', { tamil: true, hint: 'H' }),
      'பிழை [கோப்புப் பிழை]: file not found: x.js\nகுறிப்பு: H'
    );
  });
  it('omits the hint line when there is no hint', () => {
    assert.equal(formatProblem(Category.USAGE, 'bad', {}), 'Error [usage]: bad');
  });
  it('keeps the established syntax diagnostic shape and appends a hint', () => {
    const source = 'let s = $"தமிழ்";\n';
    const err = new JsTamilSyntaxError('TamilScript string literals ($"...") are no longer supported', {
      code: ErrorCodes.TAMIL_STRING_REMOVED,
      line: 1,
      column: 9,
    });
    const text = formatCliError(err, { source });
    assert.match(text, /^line 1, column 9\n/);
    assert.match(text, /JST_TAMIL_STRING_REMOVED/);
    assert.match(text, /தமிழ்/);
    assert.match(text, /\^/);
    assert.match(text, /\nHint: Remove the \$ before the quote: write an ordinary JavaScript string\.$/);
  });
  it('preserves message, full stack, and cause chain for runtime errors', () => {
    const err = new Error('boom', { cause: new TypeError('inner') });
    const text = formatCliError(err, {});
    assert.match(text, /^Error \[runtime\]: boom$/m);
    assert.match(text, /\n\s+at /, 'stack frames must be preserved');
    assert.match(text, /^caused by: inner$/m);
    assert.doesNotMatch(text, /Hint:/, 'runtime errors must not get invented hints');
  });
  it('keeps non-Error names and adds the category marker to the first line', () => {
    const text = formatCliError(new TypeError('bad thing'), { category: Category.VALIDATION });
    assert.match(text, /^TypeError \[validation\]: bad thing$/m);
  });
  it('omits internal stack frames for expected guard failures', () => {
    const err = new Error('refusing to overwrite existing files: package.json');
    err.code = 'SCAFFOLD_EEXIST';
    const text = formatCliError(err, {});
    assert.match(text, /^Error \[file\]: refusing to overwrite existing files: package\.json$/m);
    assert.doesNotMatch(text, /\n\s+at /, 'guard failures must not dump stack frames');
    assert.match(text, /^Hint: Pass --force/m);
  });
  it('can force Tamil labels and hint label around an English message', () => {
    const text = formatCliError(new Error('boom'), { tamil: true });
    assert.match(text, /^பிழை \[இயக்கநேரப் பிழை\]: boom$/m);
  });
});

describe('diagnostics: CLI error output', () => {
  it('reports unknown commands as usage errors with a hint', () => {
    const r = cli(['definitely-not-a-command']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Error \[usage\]: unknown command "definitely-not-a-command"/);
    assert.match(r.stderr, /Hint: Run `tamilscript --help`/);
    assert.match(r.stderr, /Usage:/);
  });
  it('reports unknown commands in Tamil with --tamil', () => {
    const r = cli(['--tamil', 'definitely-not-a-command']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /பிழை \[பயன்பாட்டுப் பிழை\]: தெரியாத கட்டளை "definitely-not-a-command"/);
  });
  it('reports a missing file as a file error with an accurate hint', () => {
    const r = cli(['run', 'no-such-file-here.js']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Error \[file\]: file not found: no-such-file-here\.js/);
    assert.match(r.stderr, /Hint: Check the path/);
  });
  it('reports a missing file in Tamil via TAMILSCRIPT_LANG', () => {
    const r = cli(['run', 'no-such-file-here.js'], {
      env: { ...process.env, TAMILSCRIPT_LANG: 'tamil' },
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /பிழை \[கோப்புப் பிழை\]: கோப்பு கிடைக்கவில்லை: no-such-file-here\.js/);
    assert.match(r.stderr, /குறிப்பு: Check the path/);
  });
  it('still honors the legacy OPENTAMIZH_LANG variable', () => {
    const env = { ...process.env, OPENTAMIZH_LANG: 'tamil' };
    delete env.TAMILSCRIPT_LANG;
    const r = cli(['run', 'no-such-file-here.js'], { env });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /பிழை \[கோப்புப் பிழை\]: கோப்பு கிடைக்கவில்லை: no-such-file-here\.js/);
  });
  it('rejects a directory passed where a file is required', () => {
    const run = cli(['run', 'src']);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Error \[file\]: not a file \(directory\): src/);
    assert.match(run.stderr, /Hint: Pass the path of a source file, not a directory\./);
    const check = cli(['check', 'src']);
    assert.equal(check.status, 1);
    assert.match(check.stderr, /not a file \(directory\): src/);
    const transform = cli(['transform', 'src', '--stdout']);
    assert.equal(transform.status, 1);
    assert.match(transform.stderr, /not a file \(directory\): src/);
  });
  it('shows the Tamil source line and a hint for syntax errors', () => {
    const file = tmp('bad-tamil.js', 'let s = $"தமிழ்;\n');
    const r = cli(['run', file]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /JST_TAMIL_STRING_REMOVED/);
    assert.match(r.stderr, /:\d+:\d+/);
    assert.match(r.stderr, /தமிழ்/);
    assert.match(r.stderr, /Hint: Remove the \$ before the quote: write an ordinary JavaScript string\./);
  });
  it('uses the Tamil hint label with --tamil for syntax errors', () => {
    const file = tmp('bad-tamil-2.js', 'let s = $"தமிழ்;\n');
    const r = cli(['--tamil', 'run', file]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /JST_TAMIL_STRING_REMOVED/);
    assert.match(r.stderr, /குறிப்பு: Remove the \$ before the quote: write an ordinary JavaScript string\./);
    assert.doesNotMatch(r.stderr, /Hint:/);
  });
  it('strips --tamil before the command but forwards it after --', () => {
    const file = tmp('argv.js', 'console.log(process.argv.slice(2).join("|"));\n');
    const stripped = cli(['--tamil', 'run', file, 'x']);
    assert.equal(stripped.status, 0);
    assert.equal(stripped.stdout, 'x\n');
    const forwarded = cli(['run', file, '--', '--tamil']);
    assert.equal(forwarded.status, 0);
    assert.equal(forwarded.stdout, '--tamil\n');
  });
  it('reports transform usage errors with the usage category and help', () => {
    const file = tmp('usage-in.js', 'let a = 1;\n');
    const cases = [
      [['transform', file], /Error \[usage\]: missing output path\. Pass -o <output\.js> or --stdout\./],
      [['transform', file, '--stdout', '--explain'], /Error \[usage\]: --explain conflicts with --stdout/],
      [['transform', file, '--stdout', '--source-map'], /Error \[usage\]: --source-map requires -o\/--output/],
      [['transform', file, '-o'], /Error \[usage\]: -o\/--output requires a file argument\./],
    ];
    for (const [args, expected] of cases) {
      const r = cli(args);
      assert.equal(r.status, 2, `exit for ${args.join(' ')}`);
      assert.match(r.stderr, expected);
      assert.match(r.stderr, /Hint: Run `tamilscript --help` to see the available commands\./);
      assert.match(r.stderr, /Usage:/);
    }
  });
  it('reports unknown flags as usage errors instead of files', () => {
    const file = tmp('usage-flags.js', 'let a = 1;\n');
    const cases = [
      [['transform', file, '-o', '--force'], /-o\/--output requires a file argument\./],
      [
        ['transform', file, '-o', path.join(workdir, 'out-flags.js'), '--stdout'],
        /--stdout conflicts with -o\/--output/,
      ],
      [['check', '--watch'], /unexpected argument "--watch"\./],
      [['lint', '--fix'], /unexpected argument "--fix"\./],
      [['run', '--bogus', file], /unexpected argument "--bogus"\./],
    ];
    for (const [args, expected] of cases) {
      const r = cli(args);
      assert.equal(r.status, 2, `exit for ${args.join(' ')}`);
      assert.match(r.stderr, expected);
      assert.match(r.stderr, /Error \[usage\]:/);
      assert.match(r.stderr, /Usage:/);
    }
    // Nothing was written by any of the rejected invocations.
    assert.equal(fs.existsSync(path.join(workdir, 'out-flags.js')), false);
  });
  it('reports the overwrite guard as a categorized file error without stack frames', () => {
    const file = tmp('guard-overwrite.js', 'let a = 1;\n');
    const r = cli(['transform', file, '-o', file]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Error \[file\]: Refusing to overwrite input file/);
    assert.match(r.stderr, /Hint: Choose a different output path or pass --force/);
    assert.doesNotMatch(r.stderr, /transform-file\.js|at transformFile/);
  });
  it('uses the Tamil usage category for transform usage errors with --tamil', () => {
    const file = tmp('usage-tamil.js', 'let a = 1;\n');
    const r = cli(['--tamil', 'transform', file]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /பிழை \[பயன்பாட்டுப் பிழை\]: missing output path/);
    assert.match(r.stderr, /குறிப்பு: Run `tamilscript --help` to see the available commands\./);
  });
  it('does not mangle a program\u2019s own error output or exit code', () => {
    const file = tmp(
      'throws.js',
      'throw new Error("outer boom", { cause: new TypeError("inner cause") });\n'
    );
    const r = cli(['run', file]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /outer boom/);
    assert.match(r.stderr, /TypeError: inner cause/);
  });
});
