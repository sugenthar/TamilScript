'use strict';

// Tamil keyword-mode regression tests. The public default is deliberately
// unchanged: Tamil words are ordinary identifiers unless tamilKeywords is
// explicitly enabled.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const api = require('../src');
const { transform } = api;
const { DEFINITIONS } = require('../src/keywords');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');

const PROPOSED = [
  'நிறுத்து', 'தொடர்', 'ஒவ்வொரு', 'என்றால்', 'இல்லை', 'செயல்', 'கொடு',
  'வகுப்பு', 'இடைமுகம்', 'உருவாக்கு', 'இது', 'மேல்', 'சேர்தல்',
  'செயல்படுத்து', 'பொது', 'தனி', 'எண்ணகம்', 'எண்', 'சொல்', 'வெற்று',
  'தொகுப்பு', 'சேர்', 'நீளம்',
];

const IMPLEMENTED = [
  'என்றால்', 'இல்லை', 'நிறுத்து', 'தொடர்', 'ஒவ்வொரு', 'செயல்', 'கொடு',
  'வகுப்பு', 'உருவாக்கு', 'இது', 'மேல்', 'சேர்தல்',
];

const IDENTIFIER_SOURCE = [
  'const நிறுத்து = 1;',
  'const தொடர் = 2;',
  'const ஒவ்வொரு = 3;',
  'const என்றால் = 4;',
  'const இல்லை = 5;',
  'const செயல் = 6;',
  'const கொடு = 7;',
  'const வகுப்பு = 8;',
  'const இடைமுகம் = 9;',
  'const உருவாக்கு = 10;',
  'const இது = 11;',
  'const மேல் = 12;',
  'const சேர்தல் = 13;',
  'const செயல்படுத்து = 14;',
  'const பொது = 15;',
  'const தனி = 16;',
  'const எண்ணகம் = 17;',
  'const எண் = 18;',
  'const சொல் = 19;',
  'const வெற்று = 20;',
  'const தொகுப்பு = 21;',
  'const சேர் = 22;',
  'const நீளம் = 23;',
  'module.exports = { நிறுத்து, தொடர், ஒவ்வொரு, என்றால், இல்லை, செயல், கொடு, வகுப்பு, இடைமுகம், உருவாக்கு, இது, மேல், சேர்தல், செயல்படுத்து, பொது, தனி, எண்ணகம், எண், சொல், வெற்று, தொகுப்பு, சேர், நீளம் };',
  '',
].join('\n');

function runCode(code) {
  const lines = [];
  const context = { console: { log: (...args) => lines.push(args.join(' ')) } };
  vm.runInNewContext(code, context, { filename: 'keyword-test.js' });
  return lines;
}

function cli(args, options) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    ...options,
  });
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tamilscript-keywords-'));
}

describe('Tamil keyword registry', () => {
  it('contains every proposed word exactly once', () => {
    const words = DEFINITIONS.map((entry) => entry.tamil);
    assert.deepEqual([...new Set(words)].sort(), [...PROPOSED].sort());
    assert.equal(words.length, PROPOSED.length);
  });

  it('has a single status and a JavaScript target for every implemented word', () => {
    for (const entry of DEFINITIONS) {
      assert.ok(['implemented', 'helper', 'deferred'].includes(entry.status), entry.tamil);
      if (entry.status === 'implemented' || entry.status === 'deferred') {
        assert.equal(typeof entry.js, 'string', entry.tamil);
      } else {
        assert.equal(entry.js, null, entry.tamil);
      }
    }
    assert.deepEqual(
      DEFINITIONS.filter((entry) => entry.status === 'implemented').map((entry) => entry.tamil),
      IMPLEMENTED
    );
  });
});

describe('keyword mode is opt-in', () => {
  it('leaves a source containing every proposed identifier byte-identical by default', () => {
    assert.equal(transform(IDENTIFIER_SOURCE), IDENTIFIER_SOURCE);
    const result = api.transformWithMeta(IDENTIFIER_SOURCE);
    assert.deepEqual(result.events, []);
  });

  it('does not rewrite deferred or helper words even in keyword mode', () => {
    for (const word of ['இடைமுகம்', 'செயல்படுத்து', 'பொது', 'தனி', 'எண்ணகம்', 'எண்', 'சொல்', 'வெற்று', 'தொகுப்பு', 'சேர்', 'நீளம்']) {
      const source = `const ${word} = 1;\n`;
      assert.equal(transform(source, { tamilKeywords: true }), source, word);
    }
  });

  it('turns an implemented word into its JavaScript keyword only when enabled', () => {
    assert.equal(transform('என்றால் (x) { y(); }'), 'என்றால் (x) { y(); }');
    assert.equal(
      transform('என்றால் (x) { y(); }', { tamilKeywords: true }),
      'if (x) { y(); }'
    );
  });
});

describe('implemented keyword aliases', () => {
  it('maps control flow, functions, classes, this, and super', () => {
    const source = [
      'செயல் கூட்டு(a, b = $௧) {',
      '  கொடு a + b;',
      '}',
      'வகுப்பு விலங்கு {',
      '  உருவாக்கு(name) { இது.name = name; }',
      '  பேசு() { கொடு இது.name; }',
      '}',
      'வகுப்பு நாய் சேர்தல் விலங்கு {',
      '  உருவாக்கு(name) { மேல்(name); }',
      '  பேசு() { கொடு மேல்.பேசு() + "!"; }',
      '}',
      'const values = [];',
      'ஒவ்வொரு (const i of $௧..$௫) {',
      '  என்றால் (i === $௩) தொடர்;',
      '  என்றால் (i === $௪) நிறுத்து;',
      '  values.push(i);',
      '}',
      'const dog = new நாய்("ராமு");',
      'அச்சிடு(கூட்டு($௨, $௩), values.join(","), dog.பேசு());',
    ].join('\n');
    const code = transform(source, { tamilKeywords: true });
    assert.match(code, /function கூட்டு/);
    assert.match(code, /class விலங்கு/);
    assert.match(code, /constructor\(name\)/);
    assert.match(code, /extends விலங்கு/);
    assert.match(code, /super\(name\)/);
    assert.match(code, /for \(const i of \(\(\) =>/);
    assert.match(code, /if \(i === 3\) continue;/);
    assert.match(code, /if \(i === 4\) break;/);
    const output = [];
    vm.runInNewContext(code, {
      அச்சிடு: (...args) => output.push(args.join(' ')),
    });
    assert.deepEqual(output, ['5 1,2 ராமு!']);
  });

  it('supports nested functions, recursion, default parameters, and returns', () => {
    const source = [
      'செயல் factorial(n) {',
      '  என்றால் (n <= $௧) கொடு $௧;',
      '  கொடு n * factorial(n - $௧);',
      '}',
      'செயல் outer(x) {',
      '  செயல் inner(y) { கொடு y + $௧; }',
      '  கொடு inner(x) * $௨;',
      '}',
      'console.log(factorial($௫), outer($௨));',
    ].join('\n');
    assert.deepEqual(runCode(transform(source, { tamilKeywords: true })), ['120 6']);
  });

  it('keeps dotted property names and private names as identifiers', () => {
    const source = [
      'const obj = { என்றால்: 1 };',
      'obj.என்றால்;',
      'obj?.என்றால்;',
      'const cls = class { #தனி = 1; get() { return this.#தனி; } };',
      'console.log(obj.என்றால், new cls().get());',
    ].join('\n');
    assert.equal(transform(source, { tamilKeywords: true }), source);
    assert.deepEqual(runCode(transform(source, { tamilKeywords: true })), ['1 1']);
  });

  it('keeps dotted names across whitespace, newlines, and comments', () => {
    const source = [
      'const obj = { என்றால்: 1 };',
      'const a = obj.',
      '  என்றால்;',
      'const b = obj?.',
      '  என்றால்;',
      'const c = obj./* gap */என்றால்;',
      'const d = obj. // gap',
      '  என்றால்;',
      'console.log(a, b, c, d, obj.என்றால்);',
    ].join('\n');
    const transformed = transform(source, { tamilKeywords: true });
    assert.equal(transformed, source);
    assert.deepEqual(runCode(transformed), ['1 1 1 1 1']);
  });

  it('maps keywords inside class static initialization blocks', () => {
    const source = [
      'class C {',
      '  static {',
      '    செயல் value() { கொடு $௭; }',
      '    என்றால் (value() === $௭) {',
      '      console.log(value());',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const transformed = transform(source, { tamilKeywords: true });
    assert.doesNotMatch(transformed, /என்றால்|செயல்|கொடு/);
    assert.match(transformed, /if \(value\(\) === 7\)/);
    assert.deepEqual(runCode(transformed), ['7']);
  });

  it('maps constructor only in class bodies, not object methods', () => {
    const source = [
      'const obj = {',
      '  உருவாக்கு(value) { return value; },',
      '  பேசு() { return this.உருவாக்கு($௭); },',
      '};',
      'class C {',
      '  marker = $௧',
      '  உருவாக்கு(value) { இது.value = value; }',
      '}',
      'console.log(obj.பேசு(), new C($௫).value);',
    ].join('\n');
    const transformed = transform(source, { tamilKeywords: true });
    assert.equal(
      transformed,
      [
        'const obj = {',
        '  உருவாக்கு(value) { return value; },',
        '  பேசு() { return this.உருவாக்கு(7); },',
        '};',
        'class C {',
        '  marker = 1',
        '  constructor(value) { this.value = value; }',
        '}',
        'console.log(obj.பேசு(), new C(5).value);',
      ].join('\n')
    );
    assert.deepEqual(runCode(transformed), ['7 5']);
  });

  it('keeps modified class methods named உருவாக்கு as identifiers', () => {
    const source = [
      'class Static { static உருவாக்கு() { return $௧; } }',
      'class Async { async உருவாக்கு() { return $௨; } }',
      'class Getter { get உருவாக்கு() { return $௩; } }',
      'class Generator { *உருவாக்கு() { yield $௪; } }',
    ].join('\n');
    const transformed = transform(source, { tamilKeywords: true });
    assert.equal(
      transformed,
      [
        'class Static { static உருவாக்கு() { return 1; } }',
        'class Async { async உருவாக்கு() { return 2; } }',
        'class Getter { get உருவாக்கு() { return 3; } }',
        'class Generator { *உருவாக்கு() { yield 4; } }',
      ].join('\n')
    );
    assert.equal(api.validate(source, { tamilKeywords: true }).ok, true);
  });

  it('keeps object/class keys, fields, and ordinary methods as identifiers', () => {
    const source = [
      'const obj = {',
      '  என்றால்: 1,',
      '  செயல்() { return 2; },',
      '  get கொடு() { return 3; },',
      '};',
      'class C {',
      '  என்றால் = 4',
      '  செயல்() { return 5; }',
      '}',
      'console.log(obj.என்றால், obj.செயல்(), obj.கொடு, new C().என்றால், new C().செயல்());',
    ].join('\n');
    const transformed = transform(source, { tamilKeywords: true });
    assert.equal(transformed, source);
    assert.deepEqual(runCode(transformed), ['1 2 3 4 5']);
  });

  it('keeps class fields without initializers as identifiers', () => {
    const source = [
      'class C {',
      '  உருவாக்கு',
      '  செயல்',
      '  என்றால் = $௧',
      '  method() { return this.என்றால்; }',
      '}',
      'const c = new C();',
      'console.log(String(c.உருவாக்கு), String(c.செயல்), c.method());',
    ].join('\n');
    const transformed = transform(source, { tamilKeywords: true });
    assert.equal(
      transformed,
      [
        'class C {',
        '  உருவாக்கு',
        '  செயல்',
        '  என்றால் = 1',
        '  method() { return this.என்றால்; }',
        '}',
        'const c = new C();',
        'console.log(String(c.உருவாக்கு), String(c.செயல்), c.method());',
      ].join('\n')
    );
    assert.deepEqual(runCode(transformed), ['undefined undefined 1']);
  });

  it('maps keyword expressions inside class field initializers', () => {
    const source = [
      'class C {',
      '  x = (1,',
      '    வகுப்பு',
      '    { static method() { return $௨; } })',
      '  y = (1,',
      '    செயல்',
      '    () { return $௩; })',
      '}',
      'const c = new C();',
      'console.log(c.x.method(), c.y());',
    ].join('\n');
    const transformed = transform(source, { tamilKeywords: true });
    assert.match(transformed, /class\s+\{ static method\(\)/);
    assert.match(transformed, /function\s+\(\)/);
    assert.equal(api.validate(source, { tamilKeywords: true }).ok, true);
    assert.deepEqual(runCode(transformed), ['2 3']);
  });

  it('does not rewrite comments, strings, regexes, or template text', () => {
    const source = [
      '// என்றால் செயல்',
      '/* வகுப்பு */',
      'const a = "என்றால்";',
      'const b = /என்றால்/g;',
      'const c = `என்றால் ${$௧}`;',
      'console.log(a, b.source, c);',
    ].join('\n');
    const code = transform(source, { tamilKeywords: true });
    assert.match(code, /\/\/ என்றால் செயல்/);
    assert.match(code, /\/\* வகுப்பு \*\//);
    assert.match(code, /"என்றால்"/);
    assert.match(code, /\/என்றால்\/g/);
    assert.match(code, /`என்றால் \$\{1\}`/);
  });

  it('maps keywords inside template expressions but not raw template text', () => {
    assert.equal(
      transform('const x = `raw என்றால் ${என்றால் ? $௧ : $௨}`;', { tamilKeywords: true }),
      'const x = `raw என்றால் ${if ? 1 : 2}`;'
    );
  });
});

describe('keyword mode diagnostics and source positions', () => {
  it('reports invalid JavaScript produced by keyword mode', () => {
    const source = 'என்றால் (true) {\n  let b = ;\n}\n';
    const result = api.validate(source, { tamilKeywords: true, filename: 'bad.js' });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.code, 'JST_JAVASCRIPT_SYNTAX');
    assert.equal(result.diagnostic.line, 2);
    assert.equal(result.diagnostic.column, 11);
  });

  it('rejects declaring an implemented word as a binding in keyword mode', () => {
    const result = api.validate('const என்றால் = 1;\n', { tamilKeywords: true });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.code, 'JST_JAVASCRIPT_SYNTAX');
  });

  it('records keyword and range transformation events', () => {
    const result = api.transformWithMeta('என்றால் (true) { const x = $௧..$௨; }', {
      tamilKeywords: true,
    });
    assert.deepEqual(result.events.map((event) => event.type), ['keyword', 'range']);
    assert.equal(result.events[0].text, 'என்றால்');
    assert.equal(result.events[0].value, 'if');
    assert.equal(result.events[1].text, '$௧..$௨');
  });
});

describe('keyword mode through the CLI', () => {
  it('runs, checks, and transforms a keyword program with --tamil-keywords', () => {
    const dir = tempDir();
    const file = path.join(dir, 'program.ot.js');
    fs.writeFileSync(
      file,
      [
        'செயல் twice(x) { கொடு x * $௨; }',
        'என்றால் (twice($௨) === $௪) {',
        '  அச்சிடு("ok", twice($௩));',
        '} இல்லை {',
        '  அச்சிடு("bad");',
        '}',
        '',
      ].join('\n')
    );
    try {
      const ran = cli(['--tamil-keywords', 'run', file]);
      assert.equal(ran.status, 0, ran.stderr);
      assert.equal(ran.stdout, 'ok 6\n');

      const checked = cli(['check', '--tamil-keywords', file]);
      assert.equal(checked.status, 0, checked.stderr);
      assert.match(checked.stdout, /^OK:/);

      const transformed = cli(['transform', file, '--tamil-keywords', '--stdout']);
      assert.equal(transformed.status, 0, transformed.stderr);
      assert.match(transformed.stdout, /function twice/);
      assert.match(transformed.stdout, /if \(twice\(2\) === 4\)/);
      assert.doesNotMatch(transformed.stdout, /செயல் twice/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('supports TAMILSCRIPT_KEYWORDS=1 and leaves ordinary identifier files alone without it', () => {
    const dir = tempDir();
    const keywordFile = path.join(dir, 'env.ot.js');
    const identifierFile = path.join(dir, 'identifiers.ot.js');
    fs.writeFileSync(keywordFile, 'என்றால் (true) { அச்சிடு("env"); }\n');
    fs.writeFileSync(identifierFile, 'const என்றால் = 1; அச்சிடு(என்றால்);\n');
    try {
      const envRun = cli(['run', keywordFile], {
        env: { ...process.env, TAMILSCRIPT_KEYWORDS: '1' },
      });
      assert.equal(envRun.status, 0, envRun.stderr);
      assert.equal(envRun.stdout, 'env\n');

      const defaultRun = cli(['run', identifierFile]);
      assert.equal(defaultRun.status, 0, defaultRun.stderr);
      assert.equal(defaultRun.stdout, '1\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('propagates keyword mode through format, lint, and the REPL', () => {
    const dir = tempDir();
    const file = path.join(dir, 'tooling.ot.js');
    fs.writeFileSync(file, 'செயல் twice(x) { கொடு x * $௨; }   \n');
    try {
      const wouldChange = cli(['format', file, '--tamil-keywords', '--check']);
      assert.equal(wouldChange.status, 1, wouldChange.stderr);
      assert.match(wouldChange.stdout, /would be reformatted/);

      const formatted = cli(['format', file, '--tamil-keywords']);
      assert.equal(formatted.status, 0, formatted.stderr);
      assert.equal(fs.readFileSync(file, 'utf8'), 'செயல் twice(x) { கொடு x * $௨; }\n');

      const lint = cli(['lint', file, '--tamil-keywords']);
      assert.equal(lint.status, 0, lint.stderr);

      const repl = cli(['--tamil-keywords', 'repl'], {
        input: 'என்றால் (true) { console.log("repl-ok"); }\n.exit\n',
      });
      assert.equal(repl.status, 0, repl.stderr);
      assert.match(repl.stdout, /repl-ok/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not consume --tamil-keywords after --', () => {
    const dir = tempDir();
    const file = path.join(dir, 'args.ot.js');
    fs.writeFileSync(file, 'அச்சிடு(process.argv.slice(2).join(","));\n');
    try {
      const r = cli(['run', file, '--', '--tamil-keywords']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '--tamil-keywords\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps keyword mode enabled across watch reruns', async () => {
    const { Watcher } = require('../src/watch');
    const dir = tempDir();
    const file = path.join(dir, 'watch.ot.js');
    const resultFile = path.join(dir, 'result.txt');
    const program = (value) => [
      'செயல் value() { கொடு ' + value + '; }',
      `require("fs").writeFileSync(${JSON.stringify(resultFile)}, String(value()));`,
      '',
    ].join('\n');
    fs.writeFileSync(file, program('$௧'), 'utf8');
    const quiet = { stdout: { write: () => true }, stderr: { write: () => true } };
    const watcher = new Watcher(file, [], { ...quiet, tamilKeywords: true });
    const poll = (want) => new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        let actual = '';
        try { actual = fs.readFileSync(resultFile, 'utf8'); } catch (err) { void err; }
        if (actual === want) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - start > 15000) {
          clearInterval(timer);
          reject(new Error(`timed out waiting for watch result ${want}; got ${JSON.stringify(actual)}`));
        }
      }, 50);
    });
    try {
      await watcher.start();
      assert.equal(fs.readFileSync(resultFile, 'utf8'), '1');
      fs.writeFileSync(file, program('$௨'), 'utf8');
      await poll('2');
    } finally {
      await watcher.stop().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Tamil keyword mode keeps dotted names as ordinary properties', () => {
  const { execFileSync } = require('node:child_process');

  function runNode(code) {
    return execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' }).trim();
  }

  it('never rewrites a dotted Tamil keyword name into its JavaScript spelling', () => {
    const cases = ['என்றால்', 'செயல்', 'வகுப்பு', 'இது', 'கொடு', 'உருவாக்கு', 'இல்லை', 'ஒவ்வொரு', 'நிறுத்து', 'தொடர்', 'மேல்', 'சேர்தல்'];
    for (const word of cases) {
      const src = `const obj = { "${word}": 10 };\nlet q = obj.${word};`;
      const out = transform(src, { tamilKeywords: true });
      assert.equal(out, src, JSON.stringify(src));
      assert.equal(runNode(out + '\nconsole.log(q);'), '10', JSON.stringify(word));
    }
  });

  it('keeps division after a dotted Tamil keyword name (regression)', () => {
    // Under keyword mode a dotted Tamil name still reaches markWord() as a
    // plain identifier, so a following `/` is division, never a regex start.
    const src = 'const obj = { செயல்: 10 };\nlet q = obj.செயல் / 2;';
    const out = transform(src, { tamilKeywords: true });
    assert.equal(out, src);
    assert.equal(runNode(out + '\nconsole.log(q);'), '5');
  });

  it('still rewrites keywords in value position after property access', () => {
    const src = 'const obj = { இது: $௨ };\nif (obj.இது > $௧) { அச்சிடு("எண்", obj.இது); }';
    const out = transform(src, { tamilKeywords: true });
    assert.equal(out, 'const obj = { இது: 2 };\nif (obj.இது > 1) { அச்சிடு("எண்", obj.இது); }');
    assert.ok(out.includes('if (obj.இது > 1)'));
  });
});
