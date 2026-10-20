# TamilScript for VS Code

Tamil numeric literals and Tamil identifiers for JavaScript — highlighting,
snippets, on-save/on-edit diagnostics, and transform commands, powered by the
`tamilscript` core transformer (never a second parser).

This extension was previously named **OpenTamizh**. Existing `opentamizh.*`
settings are still read as fallbacks, and the old `opentamizh.*` command ids
remain registered as aliases. The language id is now `tamilscript`; update any
`files.associations` entry that still names the old language id. The
Marketplace publisher identity (`opentamizh`) is intentionally unchanged.

Supported literal forms (Tamil digits U+0BE6–U+0BEF):

- `$` + Tamil digits — integer literal
- `$` + Tamil digits + `.` + Tamil digits — decimal literal

Text is written with ordinary JavaScript strings (`"..."` / `'...'`); `$` is
reserved for numeric literals. The old `$"..."` / `$'...'` string form is no
longer TamilScript syntax: it is flagged with `JST_TAMIL_STRING_REMOVED`, and the fix
is to drop the `$` (the strings themselves are unchanged). Integers past
`Number.MAX_SAFE_INTEGER`, `$`-plus-`n` BigInt attempts, and mixed-script
decimals are errors with stable `JST_*` codes (see the core
`docs/SYNTAX.md`).

## Install / run locally (unpublished)

This extension is **not** on the Marketplace. To try it from this checkout:

Requires VS Code 1.85.0 or newer (`engines.vscode` in `package.json`).
The current build was last verified on VS Code 1.142.0 (Windows x64),
both in an Extension Development Host and as a CLI-installed VSIX.

1. Install the core package resolution target (workspace `node_modules`
   or the sibling core checkout — the extension auto-detects both).
2. Open this folder in VS Code and use **Run Extension Development Host**
   (`F5`), or symlink/copy `vscode-extension/` into
   `~/.vscode/extensions/opentamizh.tamilscript-vscode-0.3.0/` and reload.
3. Open any `.js` file: Tamil literals highlight automatically via the
   injected grammar, and a file that contains them is switched to
   TamilScript language mode automatically (see below). Files named
   `*.ot.js` open in TamilScript mode directly; bare `.js`/`.mjs`/`.cjs`
   files are never taken over.

To build and install a VSIX instead:

```bash
cd vscode-extension
npx @vscode/vsce package --allow-missing-repository
code --install-extension tamilscript-vscode-0.3.0.vsix --force
```

The VSIX ships the runtime files only (`extension.js`,
`tamilscriptLang.js`, both grammars, `language-configuration.json`,
snippets, README, changelog, and license); `test/` and `integration/` are
excluded via `.vscodeignore`.

## Automated integration tests

`npm run test:integration` (from `vscode-extension/`) launches a real
Extension Development Host with `--extensionTestsPath`, using throwaway
temp workspaces and a fresh profile — your files and settings are untouched.
It verifies activation, snippets, diagnostics lifecycle, commands,
multi-root core resolution, real token scopes, and automatic language-mode
switching (the real `examples/expressions.js` file, the representative
red-squiggle report file, and unsaved buffers). Requires an
installed VS Code (`code`/`Code.exe`; override with `OT_CODE_BIN`). Pass
`--keep` to retain the temp workspace for forensics, or set
`OT_INTEG_ENTRY=<file>` to run an alternate entry script inside the host.

## File types

- Automatic highlighting/diagnostics/snippets: `javascript` language
  (covers `.js`, `.mjs`, `.cjs`).
- Automatic language mode: a JavaScript document that contains TamilScript
  literals — a saved file, an unsaved buffer, or a remote/virtual-workspace
  file — is switched to the `tamilscript` language mode
  (`tamilscript.autoLanguageMode`, default `true`) — see
  [Red squiggles](#red-squiggles-why-they-appear-and-how-they-are-cleared).
- Explicit language id: `tamilscript`, claimed for `*.ot.js` files by
  default; map other patterns with `files.associations` if you prefer
  (never a global `.js` takeover).
- TypeScript files are intentionally **not** targeted: the core transformer
  does not support TypeScript syntax (see core `docs/LIMITATIONS.md`).

## How highlighting works

`syntaxes/tamilscript.injection.tmLanguage.json` injects into `source.js`,
`source.js.jsx`, and `source.tamilscript` with selector
`L:source.js -comment -string, L:source.js.jsx -comment -string,
L:source.tamilscript -comment -string`. The `L:` prefix is load-bearing:
without it the injection loses ties against the built-in variable rule and
never fires (verified with the real tokenizer). Literal-like text inside
comments, ordinary strings, regex literals, and template literal text is
never matched, while `${...}` expressions keep working as JavaScript.

Known gap: literals inside template `${...}` substitutions do not get
Tamil-specific scopes (the `string` exclusion necessarily covers template
subtrees). The core transformer still handles them, and diagnostics still
validate them — only the extra color is missing there. Malformed attempts
(mixed-script decimals, `n`-suffixed BigInt, glued identifiers, repeated
or dangling decimal points, `$`+digits after a decimal point) get
`invalid.illegal` styling. Every literal rule is guarded by an identifier
lookbehind, so `x$௧`, `5$௧`, and `$$௧` are never coloured like literals
(the core lexer treats `x$௧` as an identifier and rejects the rest).
Integer and decimal forms share the single `constant.numeric.tamilscript`
scope (the decimal point is part of the literal token), so every theme
renders both in the same colour. The standalone `source.tamilscript`
grammar (literals + `include: source.js`) backs the opt-in language id.

## How diagnostics work

`tamilscriptLang.js` resolves the core API (`workspace/node_modules`,
`tamilscript.corePath` setting, or the sibling checkout) and calls the
public `transform()` — the same lexer and `JST_*` codes as the CLI.
Validation never executes code, never spawns processes, is debounced
(`tamilscript.debounceMs`, default 300 ms), and clears stale markers on
change/close. Diagnostics carry `source: tamilscript` and the stable
`JST_*` code. A missing core shows one warning, never a crash.

Note: `$`-literals are not valid plain JavaScript, so while a file sits in
JavaScript mode VS Code's built-in validator underlines them alongside ours.
The extension avoids that by switching files that contain TamilScript
literals to TamilScript mode automatically (see below); our markers stay
distinguishable anywhere via `source: tamilscript` and `JST_*` codes.

## Commands

- **TamilScript: Check Current File** — validate, show errors with
  `line:column`, set diagnostics.
- **TamilScript: Transform Current File** — open the transformed code in a
  new untitled preview (the original is **never** overwritten).
- **TamilScript: Run Current File** — run the active file with the resolved
  core CLI in an integrated terminal (see below).
- **TamilScript: Show Version** — resolved core version or a missing-core
  message with install guidance.
- **TamilScript: Use TamilScript Language Mode** — switch the active editor
  to TamilScript mode (see below). Never touches file contents.

### How running works

**Run Current File** types the exact command into a visible terminal and
starts in the file's directory, so output is complete, standard input
works, and Ctrl+C still stops the program:

```text
node "<resolved>/bin/tamilscript.js" run "<your file>"
```

- The **CLI script** is resolved like the core API: `tamilscript.corePath`,
  workspace `node_modules/tamilscript/bin/tamilscript.js`, then the sibling
  checkout. If none exists, the command shows install guidance instead of
  failing silently.
- The extension itself never spawns processes or executes your code — it
  only sends this one command to the terminal, and only when you invoke the
  command.
- **Unsaved changes are saved first** (like VS Code's own run/debug
  actions), because the CLI runs files from disk. If saving fails, nothing
  runs. Untitled buffers are refused with a clear message; save the file
  first.
- **Shell-expanding characters in the path are refused with a message**:
  on Windows, `$`, `%`, a backtick, or a line break inside a path would be
  expanded by cmd.exe/PowerShell even inside double quotes, so Run Current
  File refuses such paths instead of risking running something else (POSIX
  quoting is unaffected). Run the file manually in that case.
- Errors in your program are the normal `tamilscript run` diagnostics in the
  terminal with exit code 1; the editor is not blocked.

## Red squiggles: why they appear and how they are cleared

TextMate grammars only assign colors; they cannot change what VS Code's
built-in TypeScript validator accepts. In `javascript` language mode the
validator parses files as standard JavaScript, where `$`-prefixed literals
are syntax errors — so valid TamilScript code gets red squiggles from the
built-in validator no matter how highlighting is configured. No grammar
change can fix that; only the language mode determines which validator runs.

The extension therefore switches a document to the dedicated `tamilscript`
language mode as soon as it contains TamilScript literals
(`tamilscript.autoLanguageMode`, default `true`). Unsaved buffers are
switched the same way, so a brand-new file is clean from its first literal
instead of only after it is saved:

- Detection uses the same lexer as diagnostics, so `$` inside comments,
  ordinary strings, regex literals, and template literal text is never
  mistaken for a literal — plain JavaScript files are never switched.
- The built-in validator does not attach to the `tamilscript` language id:
  the false parser squiggles disappear, while this extension's
  transformer-backed markers (`source: tamilscript`, `JST_*` codes) still
  run, and malformed Tamil is still flagged.
- The first switch shows a one-time notice with **Switch Back** and
  **Disable Auto-Switch** actions. Switching a file back to JavaScript
  (notice or picker) is remembered for the session — the extension does
  not fight you.
- File contents are never touched; the language mode is editor state, and
  `*.ot.js` files open in TamilScript mode directly by default.
- Applies to user-editable documents: local saved files, unsaved buffers,
  and remote/virtual-workspace files. Synthetic or read-only documents
  (diff sides, output panels, notebook cells) are never switched.

Trade-offs while a file is in TamilScript mode:

- The built-in TypeScript service does not attach to the `tamilscript`
  language id (measured in a real host): completion falls back to document
  words plus the bundled snippets, and TypeScript hover/definitions are
  unavailable. Keeping a file in JavaScript mode restores full
  IntelliSense, but the built-in validator reports a false `ts(1127)`
  squiggle on `$`-decimals.
- Plain JavaScript mistakes (e.g. `let x = ;`) are not flagged while a file
  is in TamilScript mode — run **TamilScript: Check Current File** or
  `tamilscript check` (which runs `node --check` on the transformed output)
  before running.
- Built-in JavaScript formatting does not apply; use `tamilscript format`
  from the core CLI for Tamil-aware formatting.

To switch one file explicitly, run **TamilScript: Use TamilScript Language
Mode** (or the built-in **Change Language Mode** picker). To open other
filename patterns in TamilScript mode without affecting other `.js` files,
map a pattern in settings — never a global `.js` takeover:

```json
{
  "files.associations": {
    "*.tamil.js": "tamilscript"
  }
}
```

Set `tamilscript.autoLanguageMode` to `false` (or pick **Disable
Auto-Switch** in the notice) to keep every file in JavaScript mode: the
extension's markers still apply, and valid literals carry the built-in
false positives alongside them — the previous behavior. The extension
never disables JavaScript validation globally and never hides other
providers' markers. Changing any `tamilscript.*` setting re-evaluates the
documents that are already open, so turning auto-switch back on recovers
open files immediately — no edit or reopen needed.

## Snippets

Snippet prefixes (available in `javascript` and `tamilscript` files):

- `otint`, `otdec` — Tamil integer and decimal literals.
- `otvar`, `otfunc`, `otexample` — variables, functions, and a minimal
  runnable program.
- `otprint` — print statement using the Tamil print helper
  (same formatting as `console.log`).
- `otrequire`, `otimport` — explicit `tamilscript/runtime` import of the
  Tamil print helper, for CommonJS and ESM respectively. Use these when
  running outside `tamilscript run` (plain `node`, editors, bundlers).

## Editing behavior

- Bracket matching, auto-closing pairs, and `//` + `/* */` comments follow
  normal JavaScript conventions.
- Pressing Enter after an open `{` indents one level; a line starting with
  `}` or `]` outdents. Lines already closed on the same line, and braces
  inside quoted spans, do not trigger extra indentation, so template
  literals and nested expressions are left intact.
- Word navigation treats `$`, Tamil digits, and identifiers as word
  characters.
- The resolved core is re-detected whenever `tamilscript.corePath` or the
  workspace folders change, so installing the core (or switching projects)
  takes effect without reloading the window.

## Core CLI

For terminal workflows use the core package directly:

```bash
npx -y tamilscript run program.js
npx -y tamilscript transform input.js -o output.js
npx -y tamilscript check program.js
```

## Known limitations

- One diagnostic per file (first error), matching core `transform()` behavior.
- Columns count UTF-16 units, matching `node --check` conventions.
- Automatic mode switching does not apply to synthetic or read-only
  documents (diff sides, output panels, notebook cells); those stay in
  JavaScript mode, where the built-in validator's false parser squiggles on
  `$`-literals can still appear.
- In JavaScript mode with semantic checking enabled (`checkJs`/`allowJs`),
  TypeScript does not know the `அச்சிடு` runtime global that
  `tamilscript run` installs; use the explicit, typed
  `tamilscript/runtime` import or let the file use TamilScript mode. Files
  that contain Tamil literals switch automatically, so this only affects
  helper-only files kept in JavaScript mode.
- No TypeScript, no `${...}`-outside-JS, no bare-package dependency
  rewriting in validation (same scope as the core).
- Literals that follow a dot which is not a `...` spread (`obj.$௧`,
  `a..$௧`) are diagnosed by the core (`JST_BAD_NUMERIC_LITERAL`) but get
  no Tamil scope: the member-access construct is tokenized as JavaScript
  with `$௧` as an ordinary identifier, so the text keeps ordinary
  colouring (same family as `x$௧`). The spread form (`[...$௧]`) keeps
  its numeric scope. `x$௧`/`5$௧`/`$$௧` are likewise never coloured like
  literals (identifier lookbehind; all verified in the real tokenizer).
- Live editor (integration) runs are automated via `npm run test:integration`
  (see above); fast logic coverage comes from `node --test` unit tests.

## Contributing

- Keep `vscode-extension/` dependency-free (zero runtime dependencies).
- Grammar rule changes must update **both** `syntaxes/*.tmLanguage.json`
  files; `test/grammar.test.js` asserts rule parity.
- The extension itself must never spawn processes, execute user code, or
  write user files. `runFile` only sends one resolved CLI command to a
  visible terminal after the user invokes it; keep it that way.
- Run `npm test` in `vscode-extension/` and the core `npm test` before
  proposing changes.
