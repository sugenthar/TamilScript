# Changelog (VS Code extension)

> **Rename:** the extension is now **TamilScript** (`tamilscript-vscode`).
> Entries below are retained as written at the time; old language ids,
> command ids, settings and `opentamizh` package names in this file are
> historical. See the repository's `MIGRATION.md`.

## Unreleased

- Breaking (core syntax): `$` is now reserved for Tamil numeric literals.
  Text uses ordinary JavaScript strings; the `$"..."` / `$'...'` form was
  removed and is flagged with the new `JST_TAMIL_STRING_REMOVED` diagnostic
  (drop the `$` to migrate — the quoted text is unchanged). The grammars
  classify `$"` / `$'` as `invalid.illegal`, the `otstr`/`otstrs` snippets
  are gone, and `$` inside comments, ordinary strings, regex literals, and
  template literal text is still never matched.
- Grammar: every literal rule is now guarded by an identifier lookbehind,
  so `x$௧`, `5$௧`, and `$$௧` are no longer coloured like literals (the
  core lexer treats `x$௧` as an identifier and rejects the rest). New
  `invalid.illegal` rules cover repeated and dangling decimal points
  (`$௩.௫.௬`, `$௩.௫.`), `$`+digits after a decimal point (`$௩.௫.$௨`),
  and decimal/Unicode glue (`$௩.௫க`), while valid decimal member access
  (`$௩.௫.toFixed(1)`, `$௩.௫.மதிப்பு`) stays one numeric literal. Verified
  in the real tokenizer in both language modes.
- The extension's own diagnostics gain the new core errors automatically
  (bare Tamil digits, fractions without integer digits like `$.௫`,
  dangling/repeated decimal dots, two-dot prefixes like `a..$௧`,
  `$`+digits after a decimal point) with 0-based positions and stable
  `JST_*` codes; a bare Tamil digit alone (no `$` anywhere) still does
  not trigger the automatic language switch.
- Fixed: Tamil integer and decimal literals now share one numeric scope
  category, `constant.numeric.opentamizh` (previously the integer rule used
  `constant.numeric.integer.opentamizh` and the decimal rule
  `constant.numeric.decimal.opentamizh`). Themes that style
  `constant.numeric.integer` or `constant.numeric.decimal` (a common
  pattern) could colour the two forms differently; with a single shared
  category they always render identically. The decimal point stays inside
  the literal token, and the `$` sigil capture is unchanged.
- Automatic language mode: a JavaScript document that contains OpenTamizh
  literals is switched to the `opentamizh` language mode, where the
  built-in TypeScript validator does not attach — so valid `$`-literals no
  longer carry its false parser squiggles, while this extension's own
  `JST_*` diagnostics still run. Detection uses the core lexer (inert `$`
  in comments, ordinary strings, regex, and template literal text never
  triggers), file contents are never touched, and plain JavaScript files
  are never switched. Covers every user-editable JavaScript document —
  local saved files, unsaved buffers (clean from the first literal, not
  only after saving), and remote/virtual workspaces — but never synthetic
  or read-only documents (diff sides, output panels, notebook cells). The
  first switch shows a one-time notice with
  **Switch Back** / **Disable Auto-Switch** actions, and a manual switch
  back is respected for the session. New setting
  `opentamizh.autoLanguageMode` (default `true`); set it to `false` to
  restore the previous behavior. Changing any `opentamizh.*` setting
  re-evaluates the documents that are already open, so turning
  auto-switch (or diagnostics) back on recovers open files immediately
  instead of waiting for an edit or a reopen.
- `*.ot.js` files open in the `opentamizh` language mode by default (the
  language contribution now claims that suffix); other filename patterns
  stay user-mapped with `files.associations`, and bare `.js`/`.mjs`/`.cjs`
  files are never taken over.
- New command `opentamizh.runFile` (**OpenTamizh: Run Current File**): runs
  the active file with the resolved core CLI in an integrated terminal
  (`node <cli> run <file>`, starting in the file's directory). Saves unsaved
  changes first, refuses untitled buffers, and shows install guidance when
  no CLI can be resolved. The extension still never spawns processes itself.
  Windows paths containing `$`, `%`, a backtick, or a line break are refused
  with a clear message before anything runs: cmd.exe and PowerShell expand
  those characters even inside double quotes, so typing them into a terminal
  cannot be made safe. POSIX paths are unaffected; run `opentamizh run`
  manually for such Windows files.
- New command `opentamizh.setLanguageMode` (**OpenTamizh: Use OpenTamizh
  Language Mode**): switches the active editor to OpenTamizh mode, where
  the built-in TypeScript validator does not attach, so valid `$`-literals
  show no false parser squiggles. Never touches file contents.
- Documented red-squiggle root cause (highlighting cannot change what the
  built-in validator accepts), the two supported language modes with
  trade-offs, and a `files.associations` recipe that avoids any global
  `.js` takeover.
- Editor indentation rules: Enter after an open `{` indents, a line
  starting with `}` or `]` outdents; closed and quoted spans are unaffected.
- New snippets: `otprint` (Tamil print statement), `otrequire` / `otimport`
  (explicit `opentamizh/runtime` import for CommonJS / ESM).
- The resolved core is re-detected when `opentamizh.corePath` or the
  workspace folders change instead of being cached forever.

## 0.3.0

Initial extension release, tracking core `opentamizh` 0.3.0. Unpublished
(side-load only).

- Injection grammar: Tamil integer/decimal/string highlighting inside
  JavaScript files without taking over the built-in language.
- Opt-in `opentamizh` language id with configuration (no filename
  associations).
- Snippets for literals, variables, functions, and runnable examples.
- Debounced diagnostics via the core public API (no execution, no child
  processes), with `JST_*` codes and exact positions.
- Commands: check, transform-to-preview (never overwrites), version.
- Settings: `enableDiagnostics`, `debounceMs`, `corePath`.
- Diagnostics set `source: opentamizh` so they stay distinguishable from
  the built-in JavaScript validator.
