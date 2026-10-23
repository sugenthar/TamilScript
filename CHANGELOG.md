# Changelog

> **Rename:** the project and npm package were renamed from **OpenTamizh** /
> `opentamizh` to **TamilScript** / `tamilscript`. TamilScript release entries
> use the current names. The pre-rename OpenTamizh development milestones are
> grouped at the bottom and retain their original names and versions.
> Compatibility details are in [MIGRATION.md](MIGRATION.md).

## 0.2.0 — 2026-10-23

This is the TamilScript 0.2.0 release candidate. It is not published until a
maintainer approves it.

**Breaking (syntax): `$` is reserved for Tamil numeric literals.**
`$"..."` / `$'...'` string literals were removed. Write ordinary JavaScript
strings instead — delete the `$`, the quoted text is unchanged. The
transformer reports `JST_TAMIL_STRING_REMOVED` with the exact location
instead of silently passing the old form through. `UNCLOSED_TAMIL_STRING`
and `BAD_ESCAPE` remain in `ErrorCodes` for API compatibility but are no
longer produced. `$` inside comments, ordinary strings, regex literals, and
template literal text is still never interpreted. Everything else below is
a backward-compatible CLI and diagnostics upgrade; other commands, flags,
output formats, and exit codes are preserved.

- **Opt-in Tamil keywords**: `--tamil-keywords`,
  `TAMILSCRIPT_KEYWORDS=1`, `{ tamilKeywords: true }`, and
  `tamilscript.tamilKeywords` enable aliases such as `என்றால்` → `if`,
  `செயல்` → `function`, `கொடு` → `return`, and `வகுப்பு` → `class`.
  The mode is off by default, so ordinary Tamil identifiers and default
  output are unchanged. Implemented words are reserved only in this mode;
  property names after `.`/`#`, object keys, and ordinary class/object
  member names keep their Tamil spelling. The registry is authoritative in
  `src/keywords/definitions.js`. Seven proposed words remain explicitly
  deferred because they need type/class/module grammar.
- **Inclusive Tamil ranges**: `$௧..$௫` becomes an ordinary
  ascending array expression. Endpoints are inclusive; decimal, mixed,
  descending, glued, or unsafe forms are diagnosed; a 100,000-element cap
  prevents typo-driven allocation. The expansion is self-contained and does
  not resolve a shadowable global `Array` binding. Ranges need no keyword
  opt-in.
- **Release review fixes**: `உருவாக்கு` is rewritten only as
  a bare class constructor; object methods, modified class methods
  (`static`/`async`/accessor/generator), and class fields keep their Tamil
  spelling. The range expansion is self-contained, so a local `Array` binding
  cannot change the result.
- **Parser-backed `validate()`**: new root API returns
  `{ ok, code }` or `{ ok, diagnostic }` without executing. Lexical `JST_*`
  codes are preserved; invalid generated JavaScript uses
  `JST_JAVASCRIPT_SYNTAX`; locations map back through keyword/range numerics.
  Acorn is the single runtime dependency (parser only, not a type checker).
- **Explicit runtime helpers**: `சேர்`, `நீளம்`, `எண்`, and
  `சொல்` are exported from `tamilscript/runtime`, with matching TypeScript
  declarations. They are not keywords or globals and are not added to the
  root export surface.
- **VS Code keyword mode**: `tamilscript.tamilKeywords` defaults
  to `false` and is passed to validation/transform; the bridge prefers
  `api.validate()` and falls back to transform for older core versions.
- **Diagnostics and docs corrections**: document the audited
  `tamilscript@0.1.0` registry baseline and the 0.2.0 release-candidate state,
  document Acorn, and align syntax/API/CLI/migration docs and tests with
  actual behavior.

- **New CLI commands**:
  - `init [directory] [--force]` — scaffolds a starter project
    (`package.json`, `README.md`, `src/app.ot.js`, `test/app.test.js`)
    with deterministic, atomic writes; refuses to overwrite existing files
    without `--force`; validates the destination; never writes outside it;
    rolls back files it created if generation fails; reports every file.
  - `test` — runs the project's npm `test` script with output and exit-code
    passthrough, clear configuration errors, and recursion protection.
  - `doctor` — reports the local Node.js/npm setup, the CLI entry, the
    tamilscript installation, `package.json` validity, and files referenced
    by npm scripts. Local-only: no network, registry, or integrity checks.
- **Tamil-aware diagnostics**: CLI failures now carry a category
  (`usage` / `file` / `validation` / `config` / `runtime`), preserve the
  original message, stack trace, and `cause` chain, and add accurate hints
  for known `JST_*` codes, filesystem codes, and usage errors.
- **Numeric pipeline fixes and diagnostics**: decimal member access is
  fixed — `$௩.௫.toFixed(1)` now transforms to `3.5.toFixed(1)` instead of
  the invalid `3.5..toFixed(1)` (the trailing-dot rewrite applies only to
  replacements without a fraction, which keeps `$௧.toString()` →
  `1..toString()`, keeps `$௧.௦.toString()` → `1..toString()`, and covers
  exponent forms like `1e-20.toString()`). New diagnostics: a bare Tamil
  digit outside a `$` literal (`let x = ௧;`), a dangling or repeated dot
  after a decimal (`$௩.௫.`, `$௩.௫..toString()`, `$௩.௫.+$௧`), and
  `$`+Tamil digits after a decimal point (`$௩.௫.$௨`, the
  `JST_MIXED_NUMERAL` case). A fraction with no integer digits (`$.௫`) is
  reported as the malformed decimal it is instead of being blamed on the
  digit with a `$` suggestion that would not fix the source; a two-dot
  prefix (`a..$௧`, not a spread) is rejected instead of transformed; and
  a leading UTF-8 BOM no longer shifts line-1 diagnostic columns (Node
  and editors strip it before parsing). No public `JST_*` code was
  renamed and every valid program transforms byte-identically to before.
- **Dependency and module-type fixes**: only a complete string-literal
  argument is rewritten, so computed specifiers like
  `require("./helper" + suffix)` keep their original behavior, and
  `?query`/`#fragment` suffixes survive rewriting for ESM module identity
  and `import.meta.url`. Module type sniffing (no `.mjs`/`.cjs` extension,
  no `package.json` `type`) now compiles the transformed source inside
  Node's CommonJS wrapper instead of matching text, so a static `import`
  after a leading `;`, `await import()` inside a concise arrow, and inert
  `import`/`export` words no longer misclassify; true top-level `await`
  still selects ESM. `--watch` watches directories filtered to the tracked
  file names, so editor atomic saves, deletions, and recreations keep
  triggering reruns.
- **Tamil output mode**: `--tamil` (or `TAMILSCRIPT_LANG=tamil`; the legacy
  `OPENTAMIZH_LANG` value is still read) translates
  the fixed CLI labels and categories using a tested catalogue; messages,
  paths, codes, hints, help, and stack traces stay English.
- **Safer CLI ergonomics**: directories passed to `run`/`check`/`transform`
  where a file is required are rejected up front with exit `1`; usage errors
  still exit `2`, runtime/program exit codes are untouched.
- **Interactive REPL** (`tamilscript repl`): expressions and statements run
  through the same core transformer on the same Node.js engine via
  `node:vm` — no `eval`, no second JavaScript engine. Variables persist,
  multiline input works (templates, block comments, unbalanced brackets),
  errors do not end the session, and piped
  input prints no banner/prompts. Commands: `.help`, `.clear`, `.exit`;
  Ctrl+C clears input (twice exits), Ctrl+D exits. Not supported (stated
  honestly): top-level `await`, promise unwrapping, `.load`; messages stay
  English like `--help`.
- **Debugging support**: `run --inspect[=host:port]` and
  `--inspect-brk[=host:port]` forward the Node.js inspector flags to the
  child process (before the file or `--`; default `127.0.0.1:9229`, port
  `0` = random). Inline source maps keep debugger positions and stack
  traces on the original files; `--watch` composes with both flags.
- **Conservative formatter** (`tamilscript format <file> [--check]`):
  removes trailing spaces/tabs/`\v`/`\f` outside lexer-recorded protected
  spans, empties whitespace-only lines, and adds a missing final line break
  (CRLF preserved). Never touches strings, templates, comments, regexes, or
  Tamil literals; refuses malformed input unchanged; idempotent.
  `--check` reports without writing (exit `1` when a change is needed). It
  is deliberately not a pretty-printer — re-indent/re-wrap need a parser
  and are documented as out of scope.
- **High-confidence linter** (`tamilscript lint <file-or-directory>`):
  `OT001` malformed/unsupported TamilScript literal (with `JST_*` code and
  hint), `OT002` JavaScript syntax error in the transformed output via
  `node --check` (a separate `javascript-syntax` category so the two are
  never mixed), `OT000` unreadable file. `file:line:column` output, at most
  one problem per file (the first), recursive directory scans that skip
  `node_modules`/`.git` and never follow symlinks, temporary check files
  always removed. Never executes or writes user files.
- **VS Code run command** (`tamilscript.runFile`, "TamilScript: Run Current
  File"): resolves the core CLI (setting, workspace `node_modules`, then
  the sibling checkout) and types `node <cli> run <file>` into an
  integrated terminal rooted at the file's directory. Saves unsaved
  changes first, refuses untitled buffers, and shows install guidance when
  no CLI is found. The extension still never spawns processes itself and
  reuses the CLI instead of duplicating transformer logic.
- **Portable `npm test`**: core and extension suites run through
  `scripts/run-tests.js`, which enumerates test files and passes explicit
  paths to `node --test`. Windows shells do not expand globs and Node.js
  18/20 lack `--test` glob support, so the previous `test/*.test.js`
  scripts failed with `Could not find ...` on those CI matrix cells.
- **Plain program output**: `அச்சிடு()` never emits ANSI color escapes and
  `run`/`--watch` no longer propagate `FORCE_COLOR` to the executed
  program. Node's console colorizes non-string arguments (numbers,
  objects) as soon as the output stream reports color support, so a shell,
  CI system, or editor that sets `FORCE_COLOR` used to change exact
  program output through pipes and captured test runs; numeric output now
  stays byte-exact. `console.log()` behavior on a real terminal is
  unchanged.
- **Standalone transform output**: `tamilscript transform` (both `-o` and
  `--stdout`, including `--explain`/`--source-map`) and `transformFile()`
  prepend a small inlined runtime prelude when the source mentions the
  Tamil print helper, so the transformed file runs under plain `node` with
  no installed `tamilscript` package and no manual import. The prelude
  installs the same global `run` installs (never overwriting one), keeps a
  leading hashbang and `"use strict"` directive intact, uses no
  `require`/`import` (CommonJS and ESM outputs both work), and external
  source-map mappings are adjusted for the inserted lines. Programs that do
  not mention the helper are byte-identical to the pure transformation;
  `run`/`check` and `transform()` are unchanged.

## 0.1.0 — 2026-10-13

Initial public release under the TamilScript name. This is the first version
published to the registry; no prior TamilScript version was ever published.
It contains the complete Tamil-first feature set developed through the
OpenTamizh 0.6.0 milestone: Tamil identifiers, `$`-prefixed Tamil
integer/decimal/string literals, the `அச்சிடு()` print helper (automatic via
`tamilscript run`, explicit via `tamilscript/runtime`), `transform`/`run`/
`check` CLI plus `--watch`, ESM/CommonJS support, inline and external source
maps, and the VS Code extension (unpublished side-load). Zero runtime
dependencies; Node.js >= 18 (automatic helper registration needs 18.19+ or
20.6+; older supported versions use the explicit import).

## OpenTamizh pre-rename development history

These entries are preserved from before the rename. They use the original
OpenTamizh version numbers and command names and were not published as
TamilScript releases. The TamilScript 0.2.0 release-candidate entry is at the
top of this file.

### OpenTamizh 0.6.0

Editor experience and verification upgrade on top of 0.5.0. No syntax
changes, no existing API changes, no new Tamil helpers. Core transformer,
lexer, and runtime untouched.

- **Editor indentation**: the `opentamizh` language configuration now
  indents after an open `{` and outdents on `}`/`]`, while leaving closed,
  quoted, and template-literal spans alone.
- **New snippets**: `otprint` (Tamil print statement), `otrequire` and
  `otimport` (explicit `opentamizh/runtime` import for CommonJS / ESM).
- **Reliable core detection**: the extension re-resolves the core API when
  `opentamizh.corePath` or the workspace folders change instead of reusing
  a stale cached resolution.
- **Verified highlighting**: token scopes re-checked with the real
  tokenizer — Tamil literals scoped in code, comments/strings/regex/template
  text untouched, Tamil identifiers keep base-JS variable scopes.
- **CI**: matrix adds Node.js 24 and runs the extension suite alongside the
  core suite on Windows, Ubuntu, and macOS.
- **Single public identity**: the `opentamizh` CLI is the only command;
  historical `jstamil` alias references are removed from help, docs, and
  packaging (error class names and `JST_*` codes unchanged).
- **False-squiggle workflow**: new `opentamizh.setLanguageMode` command
  (**OpenTamizh: Use OpenTamizh Language Mode**) switches the active editor
  to OpenTamizh mode, where the built-in TypeScript validator does not
  attach — valid `$`-literals show no false parser squiggles while the
  extension's transformer-backed diagnostics still apply. Documented
  trade-offs and a `files.associations` recipe; nothing is disabled
  globally and file contents are never touched.
- **Automatic OpenTamizh mode in VS Code**: the editor extension now
  switches a JavaScript document that contains OpenTamizh literals to the
  dedicated `opentamizh` language mode on its own, so the built-in
  validator cannot flag valid literals even before the user runs a
  command. Detection is transformer-backed (inert `$` text in comments,
  ordinary strings, regex, and template literal text never triggers),
  `*.ot.js` opens in OpenTamizh mode by default, the first switch offers
  Switch Back / Disable Auto-Switch, a manual switch back is respected
  for the session, file contents are never touched, and
  `opentamizh.autoLanguageMode: false` restores the previous behavior.

### OpenTamizh 0.5.0

Beginner-focused usability upgrade on top of 0.4.0. No syntax changes, no
existing API changes, no new Tamil helpers; the `jstamil` CLI remains as a
legacy alias.

- **Examples collection**: new runnable programs — `tamil-functions.js`
  (functions and arrow functions with Tamil identifiers),
  `tamil-collections.js` (arrays, objects, loops, conditionals, spread,
  destructuring, template literals), and `print-explicit.js` (explicit
  `require('opentamizh/runtime')`, runnable under both `opentamizh run`
  and plain `node`).
- **Beginner tutorial**: README "Your first Tamil program" walks through
  creating, running, checking, and transforming a file, plus when an
  explicit runtime import is needed and which Node.js versions support
  automatic registration.
- **CLI guidance**: `run --help` now mentions automatic Tamil print helper
  setup, the Node.js version floor, and the explicit-import alternative.

### OpenTamizh 0.4.0

New capability on top of the 0.3.0 package identity. No syntax changes; no
existing API renames; the `jstamil` CLI remains as a legacy alias.

- **`அச்சிடு()` Tamil print helper**: behaves exactly like `console.log()`
  for zero, one, or many arguments of any kind, with identical formatting
  and error propagation. Available automatically to programs executed with
  `opentamizh run` / `runFile` (including `--watch`) when mentioned — via
  `node --import` of a side-effect setup module that never overwrites an
  existing global and touches no built-ins — and via explicit
  `require('opentamizh/runtime')` / `import ... from 'opentamizh/runtime'`
  (also re-exported from the package root) everywhere else, including plain
  `node`. New `opentamizh/runtime` export entry with TypeScript
  declarations; `examples/print-helper.js` demonstrates the marks-report
  workflow end to end.
- **Old-Node clarity**: automatic setup needs Node.js 18.19+ / 20.6+; on
  older supported versions `run` fails with an actionable error (after temp
  cleanup) instead of a bare `ReferenceError`. The explicit import works on
  every supported Node version. Zero runtime dependencies retained.

### OpenTamizh 0.3.0

Upgrade from the JsTamil-derived `opentamizh` 0.2.0 package identity. No syntax
changes; no public API renames; the `jstamil` CLI remains as a legacy alias.

- **Source-map column corrections**: literals sharing a line with a rewritten
  relative import now map to their true generated and original columns
  (previously the specifier-length shift was silently dropped).
- **Improved lexer position tracking**: error diagnostics, `--explain`
  positions, and map source columns stay exact for second and later literals
  on the same line after width-changing replacements (output columns are now
  tracked separately from source columns).
- **Safer atomic output writes**: `transform` file output (and `.map` files)
  is written to a sibling temp file and renamed, so a crash never leaves a
  half-written destination; temp files are cleaned up on failure and existing
  destinations are preserved when transformation fails.
- **Source-map input validation**: `inlineSourceMapComment()` throws
  `TypeError` for non-map input instead of encoding a bogus comment.
- **Corrected TypeScript declarations**: `exports` now carries a `types`
  condition; `errors` exposes `ErrorCodes`/`formatDiagnostic`;
  `JsTamilError`/`JsTamilSyntaxError` declare accurate constructors;
  `runFile` declares its options parameter. Verified with `tsc` under
  NodeNext and Bundler resolution.
- **CLI output consistency**: `transform --stdout` ends with exactly one
  trailing newline.
- **Regression tests and packaging**: same-line column/map tests, atomic-write
  debris tests, declaration and zero-dependency assertions; CI also runs
  `npm pack --dry-run`. Zero runtime dependencies retained.

### OpenTamizh 0.2.0

JsTamil-derived baseline: Tamil integer/decimal/string literals, safe-integer
validation, ESM/CommonJS `run` with nested relative dependencies, inline and
external source maps, watch mode, `run`/`transform`/`check` CLI with `jstamil`
legacy alias, MIT license, Node.js >= 18.
