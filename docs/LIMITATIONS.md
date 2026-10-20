# TamilScript limitations — stated honestly

- **Transformation is required.** Node.js does not natively parse `$௧௮`;
  TamilScript is a source-to-source compiler, not a runtime patch.
- **Decimals use IEEE 754 doubles** (`$௧.௫` behaves exactly like `1.5`,
  including `0.1 + 0.2 !== 0.3`). BigInt Tamil literals remain
  unsupported and raise a diagnostic pointing at the ASCII alternative.
- **Safe-integer range.** Tamil *integer* values above
  `Number.MAX_SAFE_INTEGER` are rejected instead of rounded.
- **Input robustness.** Empty sources transform to empty output; files
  without Tamil literals pass through byte-identical. A leading UTF-8 BOM
  is preserved and tolerated; CRLF and LF both work; hashbang lines pass
  through. Gluing a literal directly to identifier characters — ASCII
  (`$௧2`, `$௧abc`, `$௧$௨`) or Unicode (`$௧க`) — is a
  `JST_BAD_NUMERIC_LITERAL` diagnostic rather than a guess. A bare Tamil
  digit outside a literal (`let x = ௧;`, `1௧`) is also diagnosed with a
  `$` suggestion, because it can never be valid JavaScript. Malformed
  decimal shapes are named with the same precision: a fraction without
  the integer (`$.௫`), a repeated separator (`$௧.௫.௬`), a dangling dot
  (`$௧.௫.`, `$௧.௫..toString()`), and `$`+digits after the decimal point
  (`$௧.௫.$௨`).
- **Tamil print helper availability (new in v0.4.0).** `அச்சிடு()` is an
  ordinary identifier, not syntax, and behaves like `console.log()`. It is
  installed automatically (and only) by `run`/`runFile` — including
  `--watch` — when the program mentions it; `transform` output instead
  carries a small inlined prelude that installs the same global, so a
  transformed file runs under plain `node` with no installed package and no
  manual import (the prelude goes after a leading hashbang and any
  `"use strict"` directive, is CommonJS/ESM-neutral, and `--source-map`
  mappings are adjusted for it). The installer is explicit, documented, and
  never overwrites an existing global or touches built-ins. `check` never
  installs anything (it never executes); `run`'s automatic setup needs
  Node.js 18.19+ / 20.6+, and explicit `tamilscript/runtime` imports keep
  working everywhere.
- **Program output is never colorized by the environment.** `அச்சிடு()`
  prints plain text even when `FORCE_COLOR` is set or stdout is a terminal,
  and `run`/`--watch` drop `FORCE_COLOR` from the executed program's
  environment (Node's console otherwise colorizes numbers and objects as
  soon as the stream reports color support, silently changing piped or
  captured output). `console.log()` inside a program is untouched, so
  programs that want color can use it or a color library.
- **One Tamil helper on purpose.** Only `அச்சிடு()` ships in v0.4.0; no
  warn/error/display siblings are included or planned for this release.
- **REPL scope.** `tamilscript repl` runs the same transformer and the same
  Node.js engine (`node:vm`, no `eval`, no second JavaScript engine) with a
  persistent context. It does not support top-level `await`, automatic
  promise unwrapping, or `.load`. Multiline detection is based on the
  transformer plus `vm.Script` ("unexpected end of input" means the input
  is incomplete) — it is not a full parser, so exotic edits may need an
  explicit retry. REPL messages stay English, like `--help` text.
- **Formatter scope.** `tamilscript format` is deliberately not a
  pretty-printer: without a parser, re-indenting or re-wrapping arbitrary
  JavaScript would be guesswork. It only removes trailing spaces/tabs (and
  `\v`/`\f`) outside lexer-recorded protected spans, turns
  whitespace-only lines into empty lines, and adds a missing final line
  break (`\r\n` for CRLF files, `\n` otherwise; lone-`\r` content is
  preserved). Whitespace inside strings, templates, comments, regexes and
  TamilScript strings is never touched, and formatting is idempotent.
  Malformed TamilScript is refused unchanged.
- **Linter scope.** `tamilscript lint` reports only high-confidence
  problems: `OT001` (the lexer rejects the source), `OT002` (the
  transformed JavaScript fails `node --check`), `OT000` (unreadable file).
  There is no type checking, no style checking, and no semantic analysis;
  at most one problem per file is reported (the first). Directory scans
  skip `node_modules`/`.git` and never follow symlinks. Lint never executes
  or writes user files; temporary check files are removed even on failure.
- **Inspector (`--inspect`/`--inspect-brk`).** The flags are forwarded to
  the child `node` process; TamilScript itself implements no debugger
  protocol. Verified: the inspector starts and source-mapped stack traces
  still point at the original files. Because maps are line-accurate and
  column-accurate only outside replaced spans (untouched lines snap to the
  line start), column-exact stepping inside untouched code is not claimed.
- **Transformed code is still just JavaScript.** Transformation does not
  sandbox anything: treat TamilScript sources with the same caution as any
  executable JS. `transform()`/`check` never execute; `run` executes
  exactly like `node` would.
- **Dependency rewriting covers static string specifiers** in `import`,
  `export ... from` (including `export *`), `require()` and `import()` —
  including nested and circular dependencies (reserved temp names) and
  `.js`/`.mjs`/`.cjs` mixes, but only when the string literal is the
  complete argument, so `require("./helper" + suffix)` and other computed
  or concatenated arguments keep their exact text. Only relative JS files
  are transformed; `` require(`./${name}`) ``, `createRequire` tricks,
  JSON/asset imports and bare package imports are left for Node to resolve,
  and `node_modules` is never entered. `?query` and `#fragment` suffixes
  are preserved on rewritten specifiers for ESM module identity and
  `import.meta.url`. A local `require` binding (`const require = ...`,
  including in ESM-classified files) is not detected, so those call
  arguments are still rewritten.
- **Module type sniffing is parser-based.** With no `.mjs`/`.cjs` extension
  and no `package.json` `type`, the transformed source is compiled (never
  executed) inside Node's CommonJS wrapper; it is treated as ESM only when
  that parse fails. Comments, strings, templates, leading semicolons, and
  concise arrow bodies can no longer flip the decision.
- **Temp files sit next to their originals** (required for relative
  resolution) with unique `tamilscript-<name>-<pid>-<time>-<rand>` names and
  are removed after `run`/`check`, even on failure. Temp files left by
  older releases are swept too. An unhandleable kill
  (`SIGKILL`, or a Windows kill signal) can orphan one; the next watch
  start sweeps same-process files older than 60 s, and names never
  collide.
- **Line numbers are preserved exactly**: replacements never add or remove
  line breaks. Columns shift where a literal changes width.
- **Source maps (new in v0.2.0).** `run` attaches inline maps and stack
  traces point at the original files (verified by tests for entry,
  dependency and ESM failures); `transform --source-map` writes an
  external `.map`. Maps are line-accurate everywhere and column-accurate
  outside replaced spans; on untouched lines columns snap to the line
  start (standard for token-less maps). Full debugger stepping is not
  claimed — stack traces are. No third-party map library is used.
- **Regex/division disambiguation** uses previous-token tracking (the
  standard heuristic). Pathological cases (e.g. regex after `return` split
  across exotic ASI boundaries) follow the same rule consistently.
- **Watch mode** watches only tracked tree files with 150 ms debouncing.
  Events come from per-directory watchers filtered to the tracked file
  names, so an editor's atomic save (write temp + rename), a delete, and a
  later recreate are all still detected (a per-file watcher would follow a
  replaced inode or disappear with the deleted file). Real Ctrl+C stops
  gracefully, but externally killed processes rely on the stale-temp sweep
  described above.
- **No TypeScript transformation.** `.d.ts` declarations describe the
  JavaScript API only; TypeScript *source* parsing/execution is not
  implemented and not claimed.
- **No framework/build-tool integration** is claimed; ESM + CommonJS
  execution paths are tested, everything else is out of scope for 0.2.0.
