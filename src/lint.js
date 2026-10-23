'use strict';

// High-confidence TamilScript linter.
//
// Scope is deliberately small and honest: it reports only problems that
// can be established reliably without a full parser.
//
//   OT001  tamilscript-syntax   the core lexer rejects the source
//                              (malformed/unsupported TamilScript literal)
//   OT002  javascript-syntax   the transformed JavaScript fails
//                              `node --check` (same engine as execution)
//   OT000  file                the file cannot be read
//
// JavaScript-level problems are reported as OT002 with a distinct
// category, never mixed with TamilScript literal validation. Like the core
// transformer, the linter reports at most one problem per file (the first
// one) — it never guesses about content it cannot check.
//
// Directory targets are scanned recursively, sorted for determinism,
// skipping `node_modules` and `.git`, and never following symlinks.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { transformWithMap } = require('./transformer');
const { mapGeneratedPosition } = require('./sourcemap');
const { JsTamilSyntaxError } = require('./errors');
const { Category, suggestFix, label } = require('./diagnostics');
const { tempBasenameFor } = require('./imports');

const RULES = Object.freeze({
  OT000: 'file',
  OT001: 'tamilscript-syntax',
  OT002: 'javascript-syntax',
});

const JS_FILE_RE = /\.(js|mjs|cjs)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git']);

/**
 * Parse `node --check` stderr into a structured problem.
 * @param {string} stderr child stderr
 * @param {string} tempAbs temp file the check ran on
 * @param {string} originalAbs original file (replaces tempAbs in the text)
 * @returns {{ line: number, column: number, message: string, raw: string }}
 */
function parseNodeCheckError(stderr, tempAbs, originalAbs) {
  const text = String(stderr || '').split(tempAbs).join(originalAbs);
  const lines = text.split(/\r?\n/);
  let line = 1;
  let column = 1;
  const first = (lines[0] || '').trim();
  const m = /:(\d+)$/.exec(first);
  if (m) line = Number(m[1]);
  const caretIdx = lines.findIndex((l) => /^\s*\^\s*$/.test(l));
  if (caretIdx !== -1) {
    column = lines[caretIdx].indexOf('^') + 1;
  }
  const msgLine = lines.find((l) => /^(SyntaxError|ReferenceError|TypeError):/.test(l));
  const message = (msgLine || 'transformed JavaScript does not parse').trim();
  return { line, column, message, raw: text.trim() };
}

/**
 * Validate the transformed JavaScript with `node --check` on a temporary
 * sibling (the temp extension preserves module semantics exactly like
 * `tamilscript run`). The temp file is always removed. Reported positions
 * are mapped back to the original source via token anchors.
 *
 * @param {string} code transformed JavaScript
 * @param {string} absPath original file path
 * @param {Array} [positions] scanner token anchors for position mapping
 * @returns {Promise<object|null>} problem or null
 */
async function checkTransformedSyntax(code, absPath, positions) {
  const dir = path.dirname(absPath);
  const tempAbs = path.join(dir, await tempBasenameFor(absPath, code));
  // Exclusive create so a planted symlink at the random temp name is never
  // followed; 0o600 keeps source content private during the check.
  let handle;
  try {
    handle = await fs.promises.open(tempAbs, 'wx', 0o600);
    await handle.writeFile(code, 'utf8');
    await handle.close();
    handle = null;
  } catch (err) {
    if (handle) {
      try { await handle.close(); } catch (closeErr) { void closeErr; }
    }
    if (!err || err.code !== 'EEXIST') {
      try { await fs.promises.unlink(tempAbs); } catch (cleanupErr) { void cleanupErr; }
    }
    throw err;
  }
  try {
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['--check', tempAbs], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (d) => {
        stderr += String(d);
      });
      child.on('error', (err) => resolve({ code: 1, stderr: String((err && err.message) || err) }));
      child.on('close', (c) => resolve({ code: c == null ? 1 : c, stderr }));
    });
    if (result.code === 0) return null;
    const parsed = parseNodeCheckError(result.stderr, tempAbs, absPath);
    const mapped = mapGeneratedPosition(positions, parsed.line, parsed.column);
    return {
      rule: 'OT002',
      category: RULES.OT002,
      line: mapped.line,
      column: mapped.column,
      message: `${parsed.message} (error in the transformed JavaScript)`,
      code: null,
      hint: 'Fix this JavaScript syntax error; `tamilscript lint` checks the transformed program.',
      detail: parsed.raw,
    };
  } finally {
    try {
      await fs.promises.unlink(tempAbs);
    } catch (err) {
      void err;
    }
  }
}

/**
 * Lint one file.
 * @param {string} absPath absolute path
 * @param {{ tamilKeywords?: boolean }} [options]
 * @returns {Promise<{ file: string, problems: Array }>}
 */
async function lintFile(absPath, options) {
  const opts = options || {};
  let source;
  try {
    source = await fs.promises.readFile(absPath, 'utf8');
  } catch (err) {
    return {
      file: absPath,
      problems: [
        {
          rule: 'OT000',
          category: RULES.OT000,
          line: 1,
          column: 1,
          message: err.message,
          code: err.code || null,
          hint: suggestFix(err, Category.FILE),
        },
      ],
    };
  }
  let code;
  let positions;
  try {
    // Keyword mode is opt-in for every command, including lint. The .ot.js
    // suffix selects the editor language mode; it does not enable keyword
    // rewriting by itself (docs/SYNTAX.md, docs/CLI.md).
    const first = transformWithMap(source, {
      filename: absPath,
      tamilKeywords: !!opts.tamilKeywords,
    });
    code = first.code;
    positions = first.positions;
  } catch (err) {
    if (!(err instanceof JsTamilSyntaxError)) throw err;
    return {
      file: absPath,
      problems: [
        {
          rule: 'OT001',
          category: RULES.OT001,
          line: err.line != null ? err.line : 1,
          column: err.column != null ? err.column : 1,
          message: err.message,
          code: err.code || null,
          hint: suggestFix(err, Category.VALIDATION),
        },
      ],
    };
  }
  const syntax = await checkTransformedSyntax(code, absPath, positions);
  return { file: absPath, problems: syntax ? [syntax] : [] };
}

/**
 * Recursively collect .js/.mjs/.cjs files under `dir` (sorted, no
 * symlinks, `node_modules` and `.git` skipped).
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function collectJsFiles(dir) {
  const out = [];
  const walk = async (current) => {
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full);
      } else if (entry.isFile() && JS_FILE_RE.test(entry.name)) {
        out.push(full);
      }
    }
  };
  await walk(dir);
  return out;
}

/**
 * Lint a file or a directory tree.
 * @param {string} targetAbs absolute path (caller checked existence)
 * @param {{ isDirectory?: boolean, tamilKeywords?: boolean }} [options]
 * @returns {Promise<{ scanned: number, problems: Array }>}
 */
async function lintPath(targetAbs, options) {
  const opts = options || {};
  const files = opts.isDirectory ? await collectJsFiles(targetAbs) : [targetAbs];
  const problems = [];
  for (const file of files) {
    const result = await lintFile(file, { tamilKeywords: !!opts.tamilKeywords });
    for (const p of result.problems) {
      problems.push(Object.assign({ file }, p));
    }
  }
  return { scanned: files.length, problems };
}

/**
 * Render the lint report for the CLI.
 * @param {{ scanned: number, problems: Array }} result
 * @param {{ tamil?: boolean }} [options] use the Tamil hint label with --tamil
 * @returns {string}
 */
function formatLintReport(result, options) {
  const tamil = !!(options && options.tamil);
  const hintLabel = tamil ? label('hint', true) : 'hint';
  const problems = result.problems || [];
  if (problems.length === 0) {
    return `No lint problems found (${result.scanned} file${result.scanned === 1 ? '' : 's'} scanned).\n`;
  }
  const lines = [];
  const files = new Set();
  for (const p of problems) {
    files.add(p.file);
    lines.push(`${p.file}:${p.line}:${p.column}: [${p.rule}] ${p.message} (${p.category})`);
    if (p.hint) lines.push(`  ${hintLabel}: ${p.hint}`);
  }
  lines.push(
    `Summary: ${problems.length} problem${problems.length === 1 ? '' : 's'} in ` +
      `${files.size} file${files.size === 1 ? '' : 's'} (${result.scanned} file${result.scanned === 1 ? '' : 's'} scanned).`
  );
  return `${lines.join('\n')}\n`;
}

module.exports = {
  RULES,
  lintFile,
  lintPath,
  collectJsFiles,
  formatLintReport,
  parseNodeCheckError,
  checkTransformedSyntax,
};
