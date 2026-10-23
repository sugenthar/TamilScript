'use strict';

// Interactive TamilScript REPL.
//
// Design constraints (documented in docs/CLI.md):
//   - The same core transformer (`transform()`) handles every input, so the
//     REPL accepts exactly what `tamilscript run` accepts.
//   - Execution uses Node.js `vm` in the current process: the same V8
//     engine as `node`, no eval() and no second JavaScript implementation.
//   - Multiline input is detected two ways: the lexer's unterminated
//     constructs (template literals, block comments) and the JavaScript
//     parser's "Unexpected end of input".
//   - Errors never end the session; they are reported and reading continues.
//   - Piped (non-TTY) input produces no banner and no prompts, so output is
//     predictable for scripting and tests.
//
// Known limitations (deliberately not faked): top-level await and automatic
// promise unwrapping are not supported; REPL messages are English (like
// --help output) and are not translated by --tamil.

const readline = require('readline');
const vm = require('vm');
const path = require('path');
const util = require('util');
const { createRequire } = require('module');
const { transform } = require('./transformer');
const { formatDiagnostic, JsTamilSyntaxError } = require('./errors');
const { அச்சிடு } = require('./runtime');

const COMPILE_FILENAME = 'tamilscript-repl';
const PROMPT = '> ';
const CONTINUATION_PROMPT = '... ';

// How many evaluated inputs stay available for stack-frame snippets.
// Frames only carry `tamilscript-repl:line:column`, so a function defined in
// one input and called in a later one is matched against this history.
const INPUT_SOURCE_LIMIT = 100;

const WELCOME = `TamilScript REPL
Type JavaScript with Tamil numeric literals: $௧௮, $௧.௫ — and அச்சிடு() to print.
Multiline input is supported; .help lists commands, .exit (or Ctrl+D) leaves.
`;

const HELP = `TamilScript REPL commands:
  .help    Show this help.
  .clear   Clear the screen (interactive sessions only).
  .exit    Exit the REPL (Ctrl+D also exits at an empty prompt).

Notes:
  - Input is transformed with the same core transformer as \`tamilscript run\`
    and executed with Node.js (no eval, no second JavaScript engine).
  - Variables persist across inputs.
  - Multiline input is detected for template literals, block comments
    and unbalanced brackets/braces; the prompt shows "... " while a
    construct is still open.
  - Uncaught errors are reported and the session continues.
  - Not supported: top-level await, automatic promise unwrapping, loading
    files with .load. Wrap async code in an async function instead.
  - REPL messages stay English (like --help text); --tamil does not
    translate them.
`;

// Lexer codes that mean "the source may continue on the next line".
const MULTILINE_CODES = new Set([
  'JST_UNTERMINATED_TEMPLATE',
  'JST_UNTERMINATED_TEMPLATE_EXPR',
  'JST_UNTERMINATED_COMMENT',
]);

/**
 * Whether a transform() failure can be resolved by typing another line.
 * Only unterminated constructs qualify: they never change meaning by
 * continuing on the next line.
 * @param {Error} err
 * @returns {boolean}
 */
function isIncompleteTransformError(err) {
  if (!(err instanceof JsTamilSyntaxError)) return false;
  return MULTILINE_CODES.has(err.code);
}

/** Compile `code` as a script, or as a parenthesized expression. */
function compileAs(code, expression) {
  const source = expression ? `(${code}\n)` : code;
  try {
    return { ok: true, script: new vm.Script(source, { filename: COMPILE_FILENAME }), expression };
  } catch (err) {
    return { ok: false, error: err };
  }
}

/**
 * Decide what to do with the current buffer.
 *
 * @param {string} buffer input so far (lines joined with '\n', trailing '\n')
 * @param {{ tamilKeywords?: boolean }} [options]
 * @returns {{ more: true } | { error: Error } | { script: vm.Script, source: string }}
 *   `more` means the input is incomplete; `error` is reportable and clears
 *   the buffer; otherwise the compiled script is ready to run.
 */
function classify(buffer, options) {
  let code;
  try {
    code = transform(buffer, { tamilKeywords: !!(options && options.tamilKeywords) });
  } catch (err) {
    if (isIncompleteTransformError(err)) return { more: true };
    return { error: err };
  }
  // A leading `{` is almost always an object-literal expression in a REPL
  // (a bare block is legal too, so this is only a preference).
  const trimmed = buffer.trimStart();
  if (trimmed.startsWith('{')) {
    const expr = compileAs(code, true);
    if (expr.ok) return { script: expr.script, source: buffer };
  }
  const direct = compileAs(code, false);
  if (direct.ok) return { script: direct.script, source: buffer };
  const expr = compileAs(code, true);
  if (expr.ok) return { script: expr.script, source: buffer };
  if (/Unexpected end of input/.test(direct.error.message)) return { more: true };
  return { error: direct.error };
}

/** `L | text` plus a caret line, matching the CLI diagnostic shape. */
function sourceSnippet(source, line, column) {
  const text = source.split(/\r\n|\r|\n/)[line - 1];
  if (text === undefined) return null;
  // Match the width of the `  L | ` gutter above, including multi-digit
  // line numbers.
  const caretPrefix = ' '.repeat(String(line).length + 3) + '| ';
  const caret =
    column != null ? `\n${caretPrefix}${' '.repeat(Math.max(0, column - 1))}^` : '';
  return `  ${line} | ${text}${caret}`;
}

/**
 * Find the recorded input a stack frame points into. `sources` is ordered
 * most recent first, so the current input wins; older inputs are searched
 * next because a function can be defined in one input and throw in a later
 * one. A frame only matches when its line exists and its column lies within
 * that line, so a snippet/caret is never drawn past the end of the text it
 * shows (or onto unrelated text).
 *
 * @param {string[]} sources input sources, most recent first
 * @param {number} line 1-based line from the stack frame
 * @param {number} column 1-based column from the stack frame
 * @returns {string|null} matching source text, or null when none fits
 */
function matchFrameSource(sources, line, column) {
  if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1) {
    return null;
  }
  for (const source of sources) {
    const text = source.split(/\r\n|\r|\n/)[line - 1];
    if (text !== undefined && column <= text.length) return source;
  }
  return null;
}

/**
 * Render a transform/lexer error (JsTamilSyntaxError) for the REPL.
 * @param {Error} err
 * @param {string} source
 * @returns {string}
 */
function formatInputError(err, source) {
  return formatDiagnostic(err, { source });
}

/**
 * Render a vm compile error. The stack already contains the annotated
 * source line and caret; the `at ...` frames are dropped because they only
 * point into Node.js internals.
 * @param {Error} err
 * @returns {string}
 */
function formatCompileError(err) {
  const lines = String((err && err.stack) || `${err && err.name}: ${err && err.message}`).split('\n');
  const firstFrame = lines.findIndex((l) => /^\s+at /.test(l));
  const head = (firstFrame === -1 ? lines : lines.slice(0, firstFrame)).slice();
  while (head.length > 0 && head[head.length - 1].trim() === '') head.pop();
  return head.join('\n');
}

/**
 * Render a runtime error: `Uncaught <name>: <message>`, the user frames,
 * and a caret snippet at the top-most REPL frame. The snippet is drawn
 * from the recorded input the frame really belongs to; when no recorded
 * input fits the reported location, the snippet is omitted instead of
 * pointing at the wrong text.
 * @param {Error} err
 * @param {string[]} sources input sources, most recent first
 * @returns {string}
 */
function formatRuntimeError(err, sources) {
  let stack = '';
  try {
    stack = String((err && err.stack) || '');
  } catch (accessErr) {
    // A thrown value may have a `stack` getter that throws (or a Proxy that
    // rejects access): report the error itself instead of ending the session.
    void accessErr;
  }
  const lines = stack.split('\n');
  // err.stack's first line is not reliable inside vm scripts, so build the
  // header from the error itself. Cross-realm errors (thrown inside the vm
  // context) are not `instanceof Error`, so detect the shape structurally.
  // Property reads are guarded for the same reason as `stack` above.
  let head;
  try {
    const errorLike =
      err !== null &&
      typeof err === 'object' &&
      typeof err.name === 'string' &&
      typeof err.message === 'string';
    head = errorLike
      ? `Uncaught ${err.name}: ${err.message}`
      : `Uncaught ${util.inspect(err, { depth: 1 })}`;
  } catch (accessErr) {
    void accessErr;
    head = 'Uncaught <error with unprintable properties>';
  }
  const frames = lines
    .slice(1)
    .filter((l) => /^\s+at /.test(l))
    // Drop Node internals and this REPL's own plumbing: only user frames
    // (REPL inputs and required modules) are interesting.
    .filter((l) => !/node:|\bnew Script\b|[\\/]repl\.js/.test(l))
    .slice(0, 10);
  const out = [head, ...frames];
  const top = frames.find((l) => l.includes(COMPILE_FILENAME));
  if (top) {
    const m = /:(\d+):(\d+)\)?$/.exec(top.trim());
    if (m) {
      const line = Number(m[1]);
      const column = Number(m[2]);
      const owner = matchFrameSource(sources, line, column);
      const snippet = owner === null ? null : sourceSnippet(owner, line, column);
      if (snippet) out.push(snippet);
    }
  }
  return out.join('\n');
}

/** Print values like the Node.js REPL: strings quoted, objects inspected. */
function formatValue(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  try {
    return util.inspect(value, { depth: 2, maxArrayLength: 100, breakLength: 80, colors: false });
  } catch (err) {
    // A Proxy with throwing traps can make inspect() itself throw; printing
    // something ugly beats ending the session.
    void err;
    return '<value with unprintable properties>';
  }
}

/** Globals exposed to REPL input, matching what `node` scripts expect. */
function createReplContext() {
  const cwd = process.cwd();
  const context = vm.createContext({});
  const moduleObject = { exports: {} };
  const sandbox = {
    console,
    process,
    Buffer,
    require: createRequire(path.join(cwd, `${COMPILE_FILENAME}.js`)),
    module: moduleObject,
    exports: moduleObject.exports,
    __filename: path.join(cwd, `${COMPILE_FILENAME}.js`),
    __dirname: cwd,
    அச்சிடு,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
    queueMicrotask,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    AbortController,
  };
  if (typeof fetch === 'function') sandbox.fetch = fetch;
  if (typeof structuredClone === 'function') sandbox.structuredClone = structuredClone;
  Object.assign(context, sandbox);
  return context;
}

/**
 * Run the interactive REPL until EOF / `.exit` / double Ctrl+C.
 *
 * @param {{ input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream, error?: NodeJS.WritableStream, tamilKeywords?: boolean }} [options]
 * @returns {Promise<number>} exit code (always 0: a session is not a run)
 */
function runRepl(options) {
  const opts = options || {};
  const tamilKeywords = !!opts.tamilKeywords;
  const input = opts.input || process.stdin;
  const output = opts.output || process.stdout;
  const error = opts.error || process.stderr;
  const interactive = !!(input.isTTY && output.isTTY);

  const rl = readline.createInterface({
    input,
    output,
    terminal: interactive,
    prompt: PROMPT,
  });
  const context = createReplContext();

  let buffer = '';
  let sawSigint = false;
  let exiting = false;
  // Sources of evaluated inputs, most recent first (bounded): a stack frame
  // can point into an earlier input, and the snippet needs that text.
  const recentSources = [];

  const write = (text) => output.write(text);

  const prompt = (continuation) => {
    if (!interactive) return;
    rl.setPrompt(continuation ? CONTINUATION_PROMPT : PROMPT);
    rl.prompt();
  };

  const evaluate = (script, source) => {
    try {
      const result = script.runInContext(context);
      if (result !== undefined) write(`${formatValue(result)}\n`);
    } catch (err) {
      error.write(`${formatRuntimeError(err, [source, ...recentSources])}\n`);
    }
    recentSources.unshift(source);
    if (recentSources.length > INPUT_SOURCE_LIMIT) recentSources.length = INPUT_SOURCE_LIMIT;
  };

  // Async code started in the REPL (timers, promises) runs on the real event
  // loop, outside `evaluate()`'s synchronous try/catch. Node's own REPL
  // reports those errors and keeps the session alive; without a handler the
  // whole process would exit instead (the documented contract is "errors
  // never end the session"). Handlers are session-scoped and removed on
  // close so a programmatic runRepl() caller gets normal behavior back.
  const reportAsyncError = (err) => {
    try {
      error.write(`${formatRuntimeError(err, [...recentSources])}\n`);
    } catch (formatErr) {
      void formatErr;
      let name = 'error';
      try {
        if (err && typeof err.name === 'string') name = err.name;
      } catch (accessErr) {
        void accessErr;
      }
      error.write(`Uncaught ${name} (unprintable).\n`);
    }
    prompt(false);
  };
  const onUncaughtException = (err) => reportAsyncError(err);
  const onUnhandledRejection = (reason) => reportAsyncError(reason);
  process.on('uncaughtException', onUncaughtException);
  process.on('unhandledRejection', onUnhandledRejection);

  const handleLine = (line) => {
    // `rl.close()` does not stop already-buffered lines from being
    // delivered, so ignore them once an exit has been requested.
    if (exiting) return;
    sawSigint = false;
    if (!buffer && line.trim().startsWith('.')) {
      const command = line.trim();
      if (command === '.exit') {
        exiting = true;
        rl.close();
        return;
      }
      if (command === '.help') {
        write(HELP);
        prompt(false);
        return;
      }
      if (command === '.clear') {
        // Only meaningful on a terminal: reset it when interactive and
        // stay silent otherwise so piped output stays clean.
        if (interactive) write('\x1Bc');
        prompt(false);
        return;
      }
      error.write(`Unknown REPL command ${JSON.stringify(command)}. Type .help for commands.\n`);
      prompt(false);
      return;
    }
    buffer += `${line}\n`;
    const outcome = classify(buffer, { tamilKeywords });
    if (outcome.more) {
      prompt(true);
      return;
    }
    const source = buffer;
    buffer = '';
    if (outcome.error) {
      if (outcome.error instanceof JsTamilSyntaxError) {
        error.write(`${formatInputError(outcome.error, source)}\n`);
      } else {
        error.write(`${formatCompileError(outcome.error)}\n`);
      }
    } else {
      evaluate(outcome.script, source);
    }
    prompt(false);
  };

  rl.on('line', handleLine);
  rl.on('SIGINT', () => {
    if (buffer) {
      buffer = '';
      sawSigint = false;
      write('\n');
      prompt(false);
      return;
    }
    if (sawSigint) {
      exiting = true;
      rl.close();
      return;
    }
    sawSigint = true;
    write('\n(To exit, press Ctrl+C again or Ctrl+D)\n');
    prompt(false);
  });

  if (interactive) write(WELCOME);
  prompt(false);

  return new Promise((resolve) => {
    rl.on('close', () => {
      exiting = true;
      process.removeListener('uncaughtException', onUncaughtException);
      process.removeListener('unhandledRejection', onUnhandledRejection);
      if (buffer) {
        // Piped input ended mid-construct: say so instead of exiting silently.
        error.write('(incomplete input ignored at end of input)\n');
      }
      if (interactive) write('\n');
      resolve(0);
    });
  });
}

module.exports = { runRepl };
