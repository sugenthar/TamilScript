# TamilScript CLI reference

The `tamilscript` binary is registered via `package.json` `bin`.

## Global option: `--tamil-keywords`

Tamil keywords are **off by default**. Enable them for `run`, `transform`,
`check`, `format`, `lint`, and `repl` with:

```bash
tamilscript --tamil-keywords run program.ot.js
tamilscript transform program.ot.js --tamil-keywords --stdout
TAMILSCRIPT_KEYWORDS=1 tamilscript check program.ot.js
```

- The flag is global and may appear before the command or after the command
  name, but must be before `--`. Everything after `--` is forwarded to the
  program untouched.
- `TAMILSCRIPT_KEYWORDS=1` (or `true`/`yes`/`on`, case-insensitive) enables
  the same mode; the flag always works even when the variable is unset.
- Only the implemented aliases in
  [SYNTAX.md](SYNTAX.md#41-tamil-keywords-opt-in) are rewritten.
  Deferred words and the runtime helper names remain identifiers.
- `--tamil` is unrelated: it localizes CLI messages and does not enable
  keyword rewriting.

## tamilscript run [--watch] \<file.js\> [-- args...]

Transform and execute a TamilScript file.

```bash
npx -y tamilscript run example.js
npx -y tamilscript run program.js -- arg1 "arg two"
npx -y tamilscript run program.js arg1 arg2   # same, without --
npx -y tamilscript run --watch program.js     # rerun on changes
npx -y tamilscript --tamil-keywords run program.ot.js  # opt-in keyword aliases
```

`--tamil-keywords` is parsed before the program arguments, so the transformed
program, every tracked relative dependency, and each watch rerun use the same
keyword mode. A literal `--tamil-keywords` after `--` is forwarded to the
program.

- Reads the file, transforms TamilScript literals, writes transformed output
  (entry **plus** relative JS dependencies, with specifiers rewritten) to
  unique temp siblings, and runs them with the same `node` binary
  (argument-array spawn — no shell, no `eval`).
- Inline source maps + `--enable-source-maps` keep stack traces pointed
  at the original files.
- Tamil print helper: when the program text mentions `அச்சிடு()`, `run`
  (including `--watch`) loads it automatically via `node --import`, so no
  import is needed. Programs that never mention it execute exactly as
  before. On Node.js older than 18.19 / 20.6, running such a program fails
  with a clear error instead; use an explicit
  `require('tamilscript/runtime')` / `import ... from 'tamilscript/runtime'`
  there — it works on every supported Node version.
- Forwards program arguments, stdio and the exit code.
- Program output stays plain text: `FORCE_COLOR` is removed from the
  executed program's environment, so numbers and objects keep byte-exact
  output when piped or captured (Node's console otherwise colorizes
  non-string arguments as soon as the stream reports color support). A real
  terminal still colorizes through normal Node.js detection, and programs
  can opt into color themselves.
- Never modifies the original file; temp files are always cleaned up
  (including after dependency failures).
- Module type is preserved: explicit `.mjs`/`.cjs` honored, otherwise the
  nearest `package.json` `type` wins (`.js` kept as-is), with parser-based
  content sniffing as a fallback when no `package.json` applies (the
  transformed source is compiled inside Node's CommonJS wrapper, never
  executed; ESM is chosen only when that parse fails).
- `--watch` (before the file, or anywhere before `--`) reruns when the
  entry or a tracked relative dependency changes: events are debounced,
  the previous child is terminated first, and errors are reported without
  stopping the watcher. Watchers are per directory and filtered to tracked
  file names, so atomic saves (write temp + rename), deletions, and
  recreations still trigger reruns. Ctrl+C in a console stops gracefully
  and removes temp files. To pass a literal `--watch` to the program, put
  it after `--`. Only watched files trigger reruns; `node_modules` is never
  watched. Note: an external kill signal on Windows terminates the
  process immediately (no handler runs); the next watch start sweeps
  same-process leftovers older than 60 seconds.
- `--inspect[=host:port]` / `--inspect-brk[=host:port]` (before the file,
  or anywhere before `--`) start the Node.js inspector for the run by
  forwarding the flag to the child `node` process. Default is
  `127.0.0.1:9229`; use port `0` for a random free port. `--inspect-brk`
  pauses before user code until a debugger attaches. Inline source maps
  keep debugger positions and stack traces on the original files; see
  `docs/LIMITATIONS.md` for map accuracy.

  ```bash
  npx -y tamilscript run --inspect program.js         # attach with any CDP client
  npx -y tamilscript run --inspect=127.0.0.1:0 program.js
  npx -y tamilscript run --inspect-brk program.js
  ```

  To pass a literal `--inspect…` to the program instead, put it after
  `--`.
- `--help`/`-h` before the file print this help; after the file they are
  forwarded to the program (same rule as `--`). Unknown flags before the
  file are usage errors (exit `2`), never treated as file names.
- Missing files are reported (`file not found`) with exit `1`.
- Exit codes: program's exit code on success; `1` on transform/runtime
  errors; `2` on usage errors.

## tamilscript transform \<input.js\> -o \<output.js\> [--explain] [--source-map]

Transform without executing.

```bash
npx -y tamilscript transform input.js -o output.js
npx -y tamilscript transform input.js --stdout
npx -y tamilscript transform input.js -o output.js --force   # allow same-file overwrite
npx -y tamilscript transform input.js --explain -o output.js # literal report
npx -y tamilscript transform input.js -o output.js --source-map  # external .map
npx -y tamilscript transform input.ot.js --tamil-keywords --stdout
```

- Requires `-o/--output` (or `--stdout`); the two destinations are
  mutually exclusive and `-o` rejects a flag-like value (both exit `2`).
  Refuses to overwrite the input
  unless `--force` is passed. Creates missing output directories. File
  output is written atomically (temp sibling + rename).
- `--stdout` writes the transformed code, ending with exactly one trailing
  newline.
- `--explain` prints one line per transformed literal or keyword
  (`file:line:col  type  source -> value`) plus a totals line. Types are
  `number`, `decimal`, `range`, and (with `--tamil-keywords`) `keyword`.
  Contents are truncated to 32 characters so reports stay safe to share.
  Conflicts with `--stdout` (exit `2`).
- `--source-map` writes `<output>.map` (Source Map v3) and appends a
  `sourceMappingURL` comment to the output. Requires `-o/--output`.
- Standalone output: when the input mentions the Tamil print helper
  (`அச்சிடு`), both destinations start with a small inlined runtime prelude
  that installs the same global `tamilscript run` installs — the transformed
  file then runs under plain `node` with no installed `tamilscript` package
  and no manual imports. The prelude goes after a leading hashbang line and
  any `"use strict"` directive prologue, uses no `require`/`import` (so
  `.cjs` and `.mjs` outputs both work), and `--source-map` mappings are
  adjusted for the inserted lines. Programs that never mention the helper
  are byte-identical to the pure transformation.
- Diagnostics use the `file:line:col` + snippet format.
- Exit `0` on success, `1` on transform/IO errors, `2` on usage errors.
- Note: `transform` converts one file; dependency rewriting happens in
  `run`/`check`, not here.

## tamilscript check \<file.js\>

Validate without executing.

```bash
npx -y tamilscript check program.js
npx -y tamilscript --tamil-keywords check program.ot.js
```

- Checks TamilScript syntax (with filename + line/column + snippet
  diagnostics) and then runs `node --check` over the transformed program
  incl. dependencies.
- Prints `OK: <file> …` and exits `0`, or prints diagnostics and exits `1`.
  (`JsTamilSyntaxError` / `JsTamilError` names appear in diagnostics for
  compatibility.)
- Unknown flags are usage errors (exit `2`).

## tamilscript format \<file.js\> [--check]

Conservative, parser-free whitespace normalization of one file, in place.

```bash
npx -y tamilscript format program.js            # rewrite in place if needed
npx -y tamilscript format program.js --check    # report only; never writes
npx -y tamilscript --tamil-keywords format program.ot.js
```

- Removes trailing spaces/tabs (and `\v`/`\f`) at end of line; lines that
  contain only such whitespace become empty; a missing final line break is
  added (CRLF files keep CRLF).
- Whitespace inside JavaScript strings, template literals, comments,
  regular expressions and Tamil literals is never touched — the core
  lexer records those protected spans, so Tamil content stays byte-intact.
- Files whose TamilScript syntax does not transform are refused unchanged;
  formatting is idempotent (formatted files stay byte-identical).
- This is deliberately **not** a full pretty-printer: without a parser,
  re-indenting or re-wrapping arbitrary JavaScript would be guesswork, so
  it is not done (see `docs/LIMITATIONS.md`).
- Output is `<file> is already formatted.` / `Formatted <file>` /
  `<file> would be reformatted.` (the last with exit `1`, after `--check`).
- Exit codes: `0` success/already formatted; `1` read/write/validation
  failure or `--check` difference; `2` usage errors.

## tamilscript lint \<file-or-directory\>

Report high-confidence problems, one file or a whole tree.

```bash
npx -y tamilscript lint program.js
npx -y tamilscript lint src/          # recursive; skips node_modules and .git
npx -y tamilscript --tamil-keywords lint src/   # parse Tamil keywords too
```

Keyword mode stays opt-in for lint. The `.ot.js` suffix selects the editor
language mode; it does not enable keyword rewriting by itself.

Rules (JavaScript problems are never mixed with literal problems):

| Rule | Category | Meaning |
| --- | --- | --- |
| `OT001` | `tamilscript-syntax` | The core lexer rejects the file (malformed or unsupported `$` literal), with the stable `JST_*` code and an accurate hint. |
| `OT002` | `javascript-syntax` | The transformed JavaScript fails `node --check` — the same engine used to execute. |
| `OT000` | `file` | The file cannot be read. |

- Output lines are `file:line:column: [rule] message (category)`, plus
  `hint:` lines (`குறிப்பு:` with `--tamil`) and a summary.
- Directories are scanned recursively in deterministic order;
  `node_modules` and `.git` are skipped and symlinks are not followed. Only
  `.js`/`.mjs`/`.cjs` are collected (a file path passed explicitly is
  checked whatever its extension).
- At most **one problem per file** is reported (the first), matching the
  transformer's throw-first behavior. No type checking or semantic
  analysis is performed.
- Nothing is executed and nothing is written; temporary `node --check`
  files (same naming/extension rules as `run`) are removed even on
  failure.
- Exit codes: `0` no problems; `1` problems or unreadable input; `2` usage
  errors. Unknown flags are usage errors, never treated as file names.

## tamilscript init [directory] [--force]

Create a starter project.

The current public registry release is `tamilscript@0.1.0`:

```bash
npx -y tamilscript@0.1.0 init my-app
cd my-app && npm install && npm start   # prints: வணக்கம், தமிழ்! 36
npx -y tamilscript@0.1.0 init --force   # re-scaffold the current directory
```

The `0.2.0` release candidate is not on the public registry. From a checkout
with the candidate tarball already packed, run the local CLI and point the
generated project at that tarball instead of resolving `^0.2.0` from the
registry:

```bash
node bin/tamilscript.js init my-app
cd my-app
npm install /absolute/path/to/tamilscript-0.2.0.tgz
npm start
```

- Creates four files: `package.json` (scripts `start`/`check`/`test` and an
  `tamilscript` devDependency), `README.md`, `src/app.ot.js` (Tamil
  literals, Tamil identifiers, the print helper), and `test/app.test.js`
  (`node:test` tests that run the sample through the real CLI).
- `[directory]` defaults to the current directory; missing directories
  (including parents) are created. A destination that is an existing file
  is rejected before anything is written.
- Refuses to overwrite existing template files unless `--force` is passed;
  `--force` touches only those four files — nothing else is deleted. On
  failure, files created by the failed run are removed and the exit code
  is `1`.
- Writes are atomic and deterministic, and every created/overwritten file
  is listed in the output, followed by a `Next steps` block.
- The generated `package.json` uses
  `engines.node: "^18.19.0 || >=20.6.0"` (the range where automatic
  `அச்சிடு()` registration exists) and a `^` dependency range starting at
  the running CLI version.

## tamilscript test

Run the project's configured test script.

```bash
npx -y tamilscript test     # the same command as npm test
```

- Reads `scripts.test` from the `package.json` in the current directory
  and runs `npm test` (argument-array spawn — no shell interpolation; on
  Windows via `cmd.exe /d /s /c`, because `npm.cmd` cannot be spawned
  directly).
- Streams output unchanged and exits with npm's exit code.
- Configuration problems exit `1` with an accurate hint: missing
  `package.json`, invalid JSON, or no `test` script. A depth guard refuses
  recursion when a test script calls `tamilscript test` again.

## tamilscript doctor

Report the local setup.

```bash
npx -y tamilscript doctor
```

`[OK]` / `[Warning]` / `[Error]` lines cover:

- Node.js version (and whether automatic `அச்சிடு()` registration is
  available on it),
- npm availability (used by `tamilscript test`),
- the running CLI entry,
- the tamilscript installation of the current project,
- `package.json` validity and its `test` script,
- files referenced by `tamilscript run/check` inside npm scripts.

Only local state is inspected — no network, registry, or dependency
integrity checks. Exit `1` only when an `[Error]` line is present;
warnings alone exit `0`.

## tamilscript repl

Start an interactive TamilScript session.

```bash
npx -y tamilscript repl
npx -y tamilscript --tamil-keywords repl   # accept the opt-in aliases
```

- Every input goes through the same core transformer as `tamilscript run`;
  execution uses the Node.js runtime (`node:vm`) — no `eval`, no second
  JavaScript engine. `$` literals and `அச்சிடு()` work like everywhere else.
  Keyword mode persists for the whole session when enabled at startup; the
  runtime helpers remain explicit imports inside the REPL.
- Expressions print their value (`undefined` results print nothing, strings
  are quoted, objects are inspected); variables persist across inputs, and
  errors are reported without ending the session.
- Multiline input is supported (template literals, block comments,
  unbalanced brackets): the prompt shows `... ` while a construct is
  still open.
- Commands: `.help`, `.clear` (interactive sessions only), `.exit`;
  Ctrl+D also exits; Ctrl+C clears the current input (press twice to exit).
- Piped input prints no banner and no prompts, so output is scriptable.
  A normal session end (EOF or `.exit`) exits `0`, even if earlier inputs
  failed.
- Not supported, stated honestly: top-level `await`, automatic promise
  unwrapping, `.load`. REPL messages stay English (like `--help` text);
  `--tamil` does not translate them.

## Tamil output: `--tamil`

```bash
npx -y tamilscript --tamil run missing.js
TAMILSCRIPT_LANG=tamil npx -y tamilscript doctor
```

- Translates the fixed CLI labels and error categories (`Error`, `Warning`,
  `OK`, `Hint`, `usage`/`file`/`validation`/`config`/`runtime`,
  `unknown command`, `file not found`, `missing file argument`).
- Messages, file paths, error codes, hints, help text, and stack traces
  stay English; anything without a tested translation falls back to
  English on purpose.
- Extracted from any position before an explicit `--` separator (before the
  command or after it). Arguments after `--` are never interpreted, so a
  program can still receive a literal `--tamil`.

## Diagnostics and exit codes

- CLI-authored failures are categorized consistently:
  `Error [file]: file not found: x.js`, followed by a `Hint:` line whenever
  an accurate suggestion exists (known `JST_*` codes, filesystem codes,
  usage errors).
- Validation errors keep the `file:line:col` + snippet format
  (`JsTamilSyntaxError [JST_…]: …`) and now add a hint.
- Runtime errors keep the original message, full stack trace, and `cause`
  chain. Expected guard failures (for example, refusing to overwrite files)
  omit internal stack frames.
- Exit codes are unchanged: `0` success (or the program's / npm's own
  code), `1` failure, `2` usage error.

## tamilscript --version / --help

```bash
npx -y tamilscript --version   # 0.2.0 for this release candidate
npx -y tamilscript --help
npx -y tamilscript run --help  # per-command help (also transform/check/format/lint/init/test/doctor/repl)
```

Every command documents its options and exit codes in `--help`.
