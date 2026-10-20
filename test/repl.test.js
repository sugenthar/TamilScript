'use strict';

// `tamilscript repl` integration tests: piped stdin (non-TTY) keeps output
// deterministic (no banner, no prompts). Covers Tamil literals, identifiers
// and the print helper, persistent variables, multiline input, error
// recovery, commands, and exit behavior.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'tamilscript.js');

/**
 * Run the REPL with piped input. Returns the spawnSync result.
 * @param {string} input lines to feed (a trailing newline is added)
 * @param {string[]} [args] extra CLI arguments before `repl`
 */
function repl(input, args) {
  const text = input.endsWith('\n') ? input : `${input}\n`;
  return spawnSync(process.execPath, [BIN, ...(args || []), 'repl'], {
    encoding: 'utf8',
    cwd: ROOT,
    input: text,
  });
}

/**
 * Extract the trailing `L | text` / caret pair from REPL stderr.
 * @param {string} stderr full stderr text
 * @returns {{ line: number, text: string, column: number } | null}
 */
function lastSnippet(stderr) {
  const lines = stderr.trimEnd().split(/\r?\n/);
  const textLine = lines[lines.length - 2] || '';
  const caretLine = lines[lines.length - 1] || '';
  const m = /^ {2}(\d+) \| (.*)$/.exec(textLine);
  const caret = caretLine.indexOf('^');
  if (!m || caret === -1) return null;
  return { line: Number(m[1]), text: m[2], column: caret - 5 };
}

/**
 * Drive a live REPL session: one line, then wait before the next, and
 * `.exit` at the end. Async errors only surface while the session's own
 * event-loop handlers are installed, so piped all-at-once input cannot
 * observe them reliably.
 * @param {string[]} lines
 * @returns {Promise<{ status: number, stdout: string, stderr: string }>}
 */
function replSession(steps) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, 'repl'], { cwd: ROOT });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const finish = (status) => {
      if (finished) return;
      finished = true;
      resolve({ status, stdout, stderr });
    };
    child.stdout.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('close', finish);
    let i = 0;
    const waitFor = (pattern, onReady) => {
      const deadline = Date.now() + 5000;
      const poll = () => {
        if (pattern.test(stderr)) {
          setTimeout(onReady, 20);
        } else if (Date.now() >= deadline) {
          stderr += `\n[timed out waiting for ${pattern}]\n`;
          child.kill();
        } else {
          setTimeout(poll, 10);
        }
      };
      poll();
    };
    const sendNext = () => {
      if (i >= steps.length) {
        setTimeout(() => child.stdin.end('.exit\n'), 60);
        return;
      }
      const step = steps[i];
      i += 1;
      child.stdin.write(`${step.line}\n`);
      if (step.waitFor) waitFor(step.waitFor, sendNext);
      else setTimeout(sendNext, 60);
    };
    sendNext();
  });
}

describe('repl: evaluation', () => {
  it('evaluates expressions with Tamil literals', () => {
    const r = repl('$௧௨ + $௩');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '15\n');
  });

  it('keeps variables across inputs', () => {
    const r = repl('let x = $௫;\nx * $௩');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '15\n');
  });

  it('supports Tamil identifiers and the print helper', () => {
    const r = repl('const வாழ்த்து = "வணக்கம்";\nஅச்சிடு(வாழ்த்து)');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'வணக்கம்\n');
  });

  it('prints object literals instead of treating them as blocks', () => {
    const r = repl('{ a: $௨, b: "தமிழ்" }');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "{ a: 2, b: 'தமிழ்' }\n");
  });

  it('prints decimals and quoted strings distinctly', () => {
    const r = repl('$௧.௫\n"தமிழ்"');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '1.5\n"தமிழ்"\n');
  });

  it('does not print undefined results', () => {
    const r = repl('let unused = $௧;');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
  });

  it('accepts CRLF line endings', () => {
    const r = repl('$௧ + $௧\r\n');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '2\n');
  });

  it('prints no prompts or banner when stdin is not a terminal', () => {
    const r = repl('$௧');
    assert.equal(r.stdout, '1\n');
    assert.doesNotMatch(r.stdout, /> /);
    assert.doesNotMatch(r.stdout, /TamilScript REPL/);
  });
});

describe('repl: multiline input', () => {
  it('reads a function across lines and calls it', () => {
    const r = repl('function add(a, b) {\n  return a + b + $௧;\n}\nadd($௨, $௩)');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '6\n');
  });

  it('reads a block statement across lines', () => {
    const r = repl('if (true) {\n  அச்சிடு("ஆம்");\n}');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'ஆம்\n');
  });

  it('reads template literals across lines without rewriting their text', () => {
    const r = repl('`line1\nline2 $௧`');
    assert.equal(r.status, 0, r.stderr);
    // $௧ inside template text stays literal (documented transformer rule).
    assert.equal(r.stdout, '"line1\\nline2 $௧"\n');
  });

  it('reads block comments across lines', () => {
    const r = repl('/* comment\nstill comment */ $௨');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '2\n');
  });
});

describe('repl: error recovery', () => {
  it('reports malformed Tamil literals and continues', () => {
    const r = repl('let bad = $௧abc;\n$௨ + $௩');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /JST_BAD_NUMERIC_LITERAL/);
    assert.match(r.stderr, /Malformed Tamil numeric literal/);
    assert.equal(r.stdout, '5\n');
  });

  it('reports the removed $ string form and continues', () => {
    const r = repl('let s = $"oops;\n2 + 2');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /no longer supported/);
    assert.match(r.stderr, /JST_TAMIL_STRING_REMOVED/);
    assert.equal(r.stdout, '4\n');
  });

  it('reports JavaScript syntax errors and continues', () => {
    const r = repl('let q = ;\n2 + 2');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /SyntaxError/);
    assert.equal(r.stdout, '4\n');
  });

  it('reports runtime errors and continues', () => {
    const r = repl('throw new Error("kaput-repl");\n$௧');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /Uncaught Error: kaput-repl/);
    assert.equal(r.stdout, '1\n');
  });

  it('draws the snippet from the input where a function was defined', () => {
    const r = repl('function boom() { throw new Error("kaput-earlier"); }\nboom();');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /Uncaught Error: kaput-earlier/);
    assert.match(r.stderr, /at boom \(tamilscript-repl:1:\d+\)/);
    const snippet = lastSnippet(r.stderr);
    assert.ok(snippet, r.stderr);
    assert.equal(snippet.line, 1);
    assert.equal(snippet.text, 'function boom() { throw new Error("kaput-earlier"); }');
    // Regression: the caret used to be placed at the earlier input's column
    // on the later input's line, far past the end of "boom();".
    assert.ok(
      snippet.column >= 1 && snippet.column <= snippet.text.length,
      `caret ${snippet.column} outside "${snippet.text}"`
    );
  });

  it('keeps the caret inside the current input for ordinary runtime errors', () => {
    const r = repl('undefinedFn();');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /Uncaught ReferenceError: undefinedFn is not defined/);
    const snippet = lastSnippet(r.stderr);
    assert.ok(snippet, r.stderr);
    assert.equal(snippet.line, 1);
    assert.equal(snippet.text, 'undefinedFn();');
    assert.ok(
      snippet.column >= 1 && snippet.column <= snippet.text.length,
      `caret ${snippet.column} outside "${snippet.text}"`
    );
  });

  it('aligns the caret on multi-digit REPL line numbers', () => {
    const body = Array.from({ length: 10 }, (_, i) => `  const v${i} = ${i};`).join('\n');
    const input = `function boom() {\n${body}\n  throw new Error("kaput-multidigit");\n}\nboom();`;
    const r = repl(input);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /kaput-multidigit/);
    const lines = r.stderr.trimEnd().split(/\r?\n/);
    const textLine = lines[lines.length - 2];
    const caretLine = lines[lines.length - 1];
    assert.match(textLine, /^ {2}12 \| /);
    assert.equal(textLine.indexOf('|'), caretLine.indexOf('|'));
    assert.ok(caretLine.indexOf('^') > textLine.indexOf('|'), 'caret is inside the shown line');
  });

  it('keeps Tamil lines and carets aligned when an earlier input throws', () => {
    const r = repl('function சொல்() { $௧; throw new Error("kaput-tamil"); }\nசொல்();');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /Uncaught Error: kaput-tamil/);
    const snippet = lastSnippet(r.stderr);
    assert.ok(snippet, r.stderr);
    assert.equal(snippet.text, 'function சொல்() { $௧; throw new Error("kaput-tamil"); }');
    assert.ok(
      snippet.column >= 1 && snippet.column <= snippet.text.length,
      `caret ${snippet.column} outside "${snippet.text}"`
    );
    // The later input's own line must not be shown as the failing line.
    assert.doesNotMatch(r.stderr, /\| சொல்\(\);/);
  });

  it('reports unknown dot commands without ending the session', () => {
    const r = repl('.frobnicate\n$௧');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Unknown REPL command/);
    assert.equal(r.stdout, '1\n');
  });

  it('reports incomplete input at end of input instead of executing it', () => {
    const r = repl('function f() {');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /incomplete input ignored at end of input/);
    assert.equal(r.stdout, '');
  });
});

describe('repl: commands and exit behavior', () => {
  it('.help lists the available commands', () => {
    const r = repl('.help');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\.help/);
    assert.match(r.stdout, /\.clear/);
    assert.match(r.stdout, /\.exit/);
  });

  it('.clear stays silent for piped input and the session continues', () => {
    const r = repl('.clear\n$௧');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '1\n');
    assert.doesNotMatch(r.stdout, /\x1Bc/);
  });

  it('.exit stops processing the remaining input', () => {
    const r = repl('.exit\n$௧');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
  });

  it('EOF ends the session with exit code 0', () => {
    const r = repl('$௧');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '1\n');
  });

  it('repl --help prints usage and exits 0', () => {
    const help = spawnSync(process.execPath, [BIN, 'repl', '--help'], { encoding: 'utf8', cwd: ROOT });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage: tamilscript repl/);
    assert.match(help.stdout, /\.exit/);
  });

  it('repl rejects unexpected arguments with exit code 2', () => {
    const r = spawnSync(process.execPath, [BIN, 'repl', 'now'], { encoding: 'utf8', cwd: ROOT });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /repl takes no arguments/);
  });

  it('--tamil keeps REPL messages English (help text behavior)', () => {
    const r = repl('.frobnicate\n$௧', ['--tamil']);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Unknown REPL command/);
    assert.doesNotMatch(r.stderr, /தெரியாத/);
    assert.equal(r.stdout, '1\n');
  });
});

describe('repl: async errors and hostile values', () => {
  it('reports a thrown value with a hostile stack getter and continues', () => {
    const r = repl(
      'throw { get stack() { throw new Error("nope"); }, name: "Custom", message: "hostile" }\n$௧'
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /Uncaught Custom: hostile/);
    assert.equal(r.stdout, '1\n');
  });

  it('reports timer throws and rejected promises without ending the session', async () => {
    const r = await replSession([
      {
        line: 'void setTimeout(() => { throw new Error("timer-boom"); }, 20)',
        waitFor: /Uncaught Error: timer-boom/,
      },
      {
        line: 'void Promise.reject(new Error("reject-boom"))',
        waitFor: /Uncaught Error: reject-boom/,
      },
      { line: '$௧ + $௧' },
    ]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /Uncaught Error: timer-boom/);
    assert.match(r.stderr, /Uncaught Error: reject-boom/);
    assert.equal(r.stdout.trim(), '2');
  });
});
