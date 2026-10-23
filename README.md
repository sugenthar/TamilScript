# TamilScript

**Write JavaScript with Tamil letters and Tamil numbers.**

TamilScript is a Tamil-friendly JavaScript source transformer for Node.js. It lets Tamil developers and learners use Tamil identifiers and Tamil numeric literals while writing normal JavaScript code — making programming easier to understand for Tamil-speaking people without replacing JavaScript or the Node.js ecosystem.

```javascript
const தமிழ் = $௮௫;
const ஆங்கிலம் = $௭௮;
const மொத்தம் = தமிழ் + ஆங்கிலம்;

அச்சிடு("மொத்தம்:", மொத்தம்);
```

```text
மொத்தம்: 163
```

```bash
npx -y tamilscript run hello.js
```

> The release candidate in this checkout is `tamilscript@0.2.0`; the previously
> published registry release is `0.1.0`. The 0.2.0 additions are opt-in Tamil
> keywords, inclusive ranges, parser-backed `validate()`, and explicit runtime
> helpers. To try them before the 0.2.0 tarball is published, pack and install
> it as shown under [Installation](#installation). TamilScript was previously
> named **OpenTamizh**; see [MIGRATION.md](MIGRATION.md). Historical version
> numbers in the changelog are marked as OpenTamizh milestones and are not
> TamilScript releases.

> Custom TamilScript syntax (`$` literals) must be executed through `npx -y tamilscript run hello.js`, not directly through `node hello.js` — plain Node.js cannot parse `$` literals. To get a plain-JS file, transform first: `npx -y tamilscript transform hello.js -o hello.out.js` produces output that runs under `node` directly (when the program mentions `அச்சிடு()`, the output carries a small inlined runtime prelude, so no import or install is needed). Programs that avoid `$` literals (Tamil identifiers plus an explicit `tamilscript/runtime` import) also run under plain `node` unchanged; see [examples/print-explicit.js](examples/print-explicit.js).

## Quick start

These commands assume `tamilscript` is installed (published package or local
tarball — see [Installation](#installation)):

```bash
printf 'let age = $\u0BE7\u0BE8;\nconsole.log(age);\n' > hello.js
npx -y tamilscript run hello.js   # 18
npx -y tamilscript check hello.js # validate without executing
npx -y tamilscript transform hello.js --stdout  # see the plain JS output
```

Local development without publishing:

```bash
npm install          # installs the single parser dependency (acorn)
npm test             # full suite
npm pack --pack-destination .  # creates tamilscript-<version>.tgz
```

## Your first Tamil program

1. Create a file named `hello.js` with these contents:

   ```js
   const age = $௧௮;
   அச்சிடு("வணக்கம்:", age);
   ```

2. Run it:

   ```bash
   npx -y tamilscript run hello.js
   # வணக்கம்: 18
   ```

3. Validate without running, or inspect the plain JavaScript output:

   ```bash
   npx -y tamilscript check hello.js      # prints OK, runs nothing
   npx -y tamilscript transform hello.js --stdout
   ```

   Transformed output is standalone: `npx -y tamilscript transform hello.js -o hello.out.js`
   writes a file that runs with plain `node hello.out.js` (the helper's
   runtime prelude is inlined into the output when it is mentioned).

4. Need `அச்சிடு()` outside `tamilscript run` (plain `node`, editors,
   bundlers)? Import it explicitly — this works on every supported Node.js
   version, while automatic setup needs Node.js 18.19+ or 20.6+:

   ```js
   const { அச்சிடு } = require("tamilscript/runtime");
   ```

Next steps: functions in [examples/tamil-functions.js](examples/tamil-functions.js),
arrays/objects/loops in [examples/tamil-collections.js](examples/tamil-collections.js),
an explicit-import program that also runs under plain `node` in
[examples/print-explicit.js](examples/print-explicit.js), the full marks
report in [examples/print-helper.js](examples/print-helper.js), and opt-in
Tamil keywords with ranges/helpers in
[examples/tamil-keywords.ot.js](examples/tamil-keywords.ot.js)
(`npx -y tamilscript --tamil-keywords run examples/tamil-keywords.ot.js`).

## Why TamilScript exists

Tamil-speaking learners and developers can read and write numbers and text
in their own script while using 100% standard JavaScript for everything
else — variables, operators, functions, classes, modules. Node.js cannot
natively parse `$௧௮`, so TamilScript is a small source transformer: it rewrites
the custom literal forms into plain JS, then delegates execution to the
normal Node.js runtime. No JS semantics are reimplemented. The package has
one small runtime dependency, Acorn, used only for parser-backed syntax
validation in editors and `validate()`.

## Requirements

- Node.js >= 18 (LTS recommended; developed on Node 24)
  - Automatic Tamil print helper registration needs Node.js 18.19+ or
    20.6+; older supported versions require the explicit runtime import.
- npm
- Windows 11, macOS or Linux (path handling tested on Windows)

## Installation

The previously published registry release is `tamilscript@0.1.0`:

```bash
npm install tamilscript
npx -y tamilscript run hello.js
```

The `0.2.0` release candidate is not on the registry yet. Pack and install the
tarball in the project where you want to try it (replace the path with the
filename npm prints):

```bash
npm pack --pack-destination .
# in another project:
npm install /absolute/path/to/tamilscript-0.2.0.tgz
npx -y tamilscript run hello.js
```

`npm install -g /absolute/path/to/tamilscript-0.2.0.tgz` also exposes the
`tamilscript` executable globally.

## Supported syntax

### Tamil numerals — `$` + Tamil digits `௦-௯`

```js
let age = $௧௮;       // 18
let price = $௧௦௦;     // 100
let zero = $௦;        // 0
let negative = -$௧௮;  // -18 (ordinary unary minus)
let mixed = $௧௦ + 20; // 30  (mixes with ASCII numbers)
```

Integers above `Number.MAX_SAFE_INTEGER` are rejected, never rounded.
`$௧n` (BigInt) produces a clear error.

### Tamil decimals — `$` + Tamil digits + `.` + Tamil digits

```js
const price = $௧௨.௫;         // 12.5
const tax = $௦.௧௮;           // 0.18
const result = $௧௨.௫ + $௨.௫; // 15
```

Both sides required, Tamil digits only, one separator. `$௧.5`
(mixed scripts) is an error. Values follow IEEE 754 semantics exactly
like ASCII decimals. Property access (`$௧.toString()`) is unaffected —
`.` counts as a separator only before a Tamil digit.

### Inclusive Tamil ranges

A range is two Tamil integer literals separated by `..`; both endpoints are
included and the result is an ordinary array expression:

```js
const oneToFive = $௧..$௫;       // [1, 2, 3, 4, 5]
const zeroToTwo = $௦..$௨;       // [0, 1, 2]
for (const i of $௧..$௫) {
  // 1, 2, 3, 4, 5
}
```

Ranges must be ascending, both endpoints must be safe integers, and a range
may contain at most 100,000 values (a typo is diagnosed instead of allocating
an enormous array). Decimal endpoints and mixed-script or missing-`$`
endpoints are not range syntax and are reported as numeric diagnostics. A
range is a numeric literal feature, so it works with or without
`--tamil-keywords`.

### Strings are ordinary JavaScript

`$` is reserved for Tamil numeric literals, so text uses standard
JavaScript strings — there is no `$"..."` form:

```js
let name = "Tamil";
let greeting = "வணக்கம்";
let language = "தமிழ் மொழி";
let empty = "";
let alt = 'வணக்கம்';            // single quotes work the same way
let line = `count: ${$௧௮}`;     // templates and ${...} literals work too
```

If you have files written for the older `$"..."` / `$'...'` form, delete
the `$`: the quoted text is unchanged. The transformer reports
`JST_TAMIL_STRING_REMOVED` with the exact location instead of silently
passing the old form through. Because the strings are ordinary JavaScript,
escapes behave exactly as Node.js defines them and the text is left
byte-for-byte untouched.

### Variables and expressions stay normal JavaScript

Tamil identifiers are ordinary JavaScript identifiers — by default the
transformer leaves them untouched; only `$`-prefixed literals are custom
syntax. The opt-in keyword mode described below is the sole exception.

```js
let name = "தமிழ்";       // right: normal variable, ordinary string
let total = $௧௦௦ + $௨௦௦;  // right: custom literals in expressions
// let $name = …          // wrong: NOT part of TamilScript, left alone
```

Custom literals work in calls, arrays, objects, arrows, classes, loops,
template `${...}` expressions, ESM and CommonJS. Ordinary strings,
comments, regexes and template text are never modified.

### Tamil keywords are opt-in

By default every Tamil word is an ordinary JavaScript identifier. Keyword
mode is explicit: pass `--tamil-keywords` to the CLI, `{ tamilKeywords: true
}` to a core API, or enable `tamilscript.tamilKeywords` in the VS Code
extension. It never turns on implicitly.

```js
const { சேர் } = require("tamilscript/runtime");

செயல் கூட்டு(a, b) { கொடு a + b; }

வகுப்பு வணக்கம் {
  உருவாக்கு(பெயர்) { இது.பெயர் = பெயர்; }
}

const எண்கள் = [];
ஒவ்வொரு (const i of $௧..$௫) {
  என்றால் (i % $௨ === $௦) தொடர்;
  சேர்(எண்கள், i);
}
அச்சிடு(கூட்டு($௨, $௩), எண்கள்.join(","));
```

| Tamil | JavaScript | Meaning |
| --- | --- | --- |
| `என்றால்` | `if` | conditional |
| `இல்லை` | `else` | alternative branch |
| `நிறுத்து` | `break` | break a loop/switch |
| `தொடர்` | `continue` | next loop iteration |
| `ஒவ்வொரு` | `for` | loop header |
| `செயல்` | `function` | function declaration/expression |
| `கொடு` | `return` | return a value |
| `வகுப்பு` | `class` | class declaration/expression |
| `உருவாக்கு` | `constructor` | class constructor method |
| `இது` | `this` | current object |
| `மேல்` | `super` | parent class |
| `சேர்தல்` | `extends` | class inheritance |

Implemented words are reserved in keyword mode: declaring `const என்றால் = 1`
maps to the invalid `const if = 1` and `validate()`/`check` reports it.
Property names keep their spelling: `obj.என்றால்`, private `#தனி`, object keys
such as `{ என்றால்: 1 }`, class fields (including semicolonless fields without
initializers), and ordinary class/object method names are not rewritten, so
property access stays consistent. `உருவாக்கு(...)` is the intentional
constructor-member exception only when it is a bare class constructor; an
object literal method with the same spelling is preserved.

These proposed words are **not implemented** and remain ordinary identifiers:
`செயல்படுத்து` (`implements`), `பொது` (`public`), `தனி` (`private`),
`இடைமுகம்` (`interface`), `எண்ணகம்` (`enum`), `வெற்று` (`void`), and
`தொகுப்பு` (`package`). They need class/type/module grammar that TamilScript
does not have; silently erasing them would change program meaning.

`சேர்`, `நீளம்`, `எண்`, and `சொல்` are explicit runtime helpers, not keywords;
see [Runtime helpers](#runtime-helpers).

Full grammar: [docs/SYNTAX.md](docs/SYNTAX.md).

## API

```js
import { toNumber, toTamilNumerals, transform, transformFile, validate } from "tamilscript";

toNumber("௧௨௩");            // 123
toTamilNumerals(123);       // "௧௨௩"
parseTamilDecimal("௧.௫");   // 1.5
toTamilDecimal(1.5);        // "௧.௫"
transform("let a = $௧௮;");  // "let a = 18;" (never executes)
validate("let a = ;");      // { ok: false, diagnostic: { line: 1, column: 9, ... } }
validate("என்றால் (true) {}", { tamilKeywords: true }); // syntax-only, never executes

await transformFile("in.js", "out.js"); // file variant, never overwrites input
```

Full reference: [docs/API.md](docs/API.md).

## Tamil print helper

`அச்சிடு()` is the automatically installed Tamil print helper. It
behaves like `console.log()` for the arguments it receives: zero, one, or
many arguments of any kind (Tamil or English strings, numbers, objects,
arrays), with identical formatting. Formatting errors propagate exactly as
they would from `console.log()`.

One deliberate difference: `அச்சிடு()` never emits ANSI color escapes, even
when the environment forces color (`FORCE_COLOR`) or stdout is a terminal.
Program output stays byte-exact for pipes, tests, and generated projects;
call `console.log()` or a color library directly when colored output is
actually wanted.

```js
const age = $௧௮;
அச்சிடு("வணக்கம்:", age);
```

```text
வணக்கம்: 18
```

### Automatic availability vs explicit import

- Programs executed with `tamilscript run` (or `runFile`, including
  `--watch`) receive `அச்சிடு()` automatically when the program mentions
  it — no import needed. The full marks example lives in
  [examples/print-helper.js](examples/print-helper.js).
- Everywhere else (plain `node`, editors, bundlers), import it explicitly
  from the documented runtime entry point, which works in CommonJS and ESM:

```js
const { அச்சிடு } = require("tamilscript/runtime");
import { அச்சிடு } from "tamilscript/runtime";
```

Importing the runtime installs no globals and modifies no built-ins. Only
`அச்சிடு()` is installed automatically by `run`; the four explicit helpers
below are exported from the same runtime entry point but never become globals.

### Compatibility and limits

- `console.log()`, `console.warn()`, and `console.error()` are untouched.
- `அச்சிடு` is an ordinary JavaScript identifier, not new syntax: the
  transformer passes it through verbatim, and it works in CommonJS and ESM.
- Automatic availability needs Node.js 18.19+ or 20.6+ (the `node --import`
  mechanism). On older supported Node versions, `tamilscript run` reports a
  clear error naming the minimum versions; use the explicit import instead,
  which works on every supported Node version.
- `tamilscript check` validates programs using `அச்சிடு()` without
  executing them.

### Runtime helpers

Four explicit helpers ship alongside `அச்சிடு` in `tamilscript/runtime`.
They are ordinary exports, not keywords and not globals:

```js
const { சேர், நீளம், எண், சொல் } = require("tamilscript/runtime");

const values = சேர்([1, 2], 3); // appends in place, returns the array
நீளம்(values);                  // 3
எண்("௧௮");                      // 18 (also "$௧.௫" -> 1.5)
எண்("-$௧௮");                    // -18 (optional leading + or -)
சொல்(18);                       // "18"
```

- `சேர்(collection, ...values)` appends to an Array or Set and returns the same
  collection. Other values throw `TypeError`; it never silently replaces an
  immutable value.
- `நீளம்(value)` returns a numeric `.length` or `.size`; it throws for values
  without either.
- `எண்(value)` uses the Tamil integer/decimal parser for Tamil strings,
  including an optional leading `+`/`-` sign, and JavaScript `Number()`
  coercion for everything else.
- `சொல்(value)` uses JavaScript `String()` coercion.

The `tamilscript run` prelude installs only `அச்சிடு`. Import these helpers
explicitly (or use the REPL, where the same explicit import is available).

## CLI

```bash
npx -y tamilscript run program.js -- arg1 arg2   # transform + execute
npx -y tamilscript run --watch program.js        # rerun on changes
npx -y tamilscript run --inspect program.js      # Node.js inspector for the run
npx -y tamilscript --tamil-keywords run program.ot.js  # opt-in Tamil keywords
npx -y tamilscript --tamil-keywords check program.ot.js
npx -y tamilscript transform input.js -o output.js  # transform only
npx -y tamilscript transform input.js --explain -o output.js  # literal report
npx -y tamilscript check program.js              # validate, don't execute
npx -y tamilscript format program.js             # conservative whitespace format
npx -y tamilscript format program.js --check     # report only; never writes
npx -y tamilscript lint src/                     # high-confidence problems (OT001/OT002)
npx -y tamilscript repl                          # interactive session
npx -y tamilscript init my-app                   # scaffold a starter project
npx -y tamilscript test                          # run the project's npm test script
npx -y tamilscript doctor                        # report the local setup
npx -y tamilscript --tamil doctor                # Tamil CLI labels (or TAMILSCRIPT_LANG=tamil)
npx -y tamilscript --version
npx -y tamilscript --help
```

`run` also transforms relative JS dependencies (nested included),
preserves ESM/CommonJS semantics, and maps stack traces back to the
original files via inline source maps; `--inspect[=host:port]` and
`--inspect-brk[=host:port]` forward the Node.js inspector flags to the
child process. `format` is conservative whitespace cleanup outside
strings/comments/regex (idempotent; `--check` never writes). `lint`
reports only high-confidence problems — `OT001` malformed TamilScript
literals, `OT002` JavaScript syntax errors in the transformed output via
`node --check` — one problem per file, `node_modules`/`.git` skipped.
`repl` gives an interactive session on the same transformer (no `eval`, no
second engine; see `docs/LIMITATIONS.md` for its honest scope).
`--tamil-keywords` is a global opt-in for `run`, `transform`, `check`,
`format`, `lint`, and `repl`; `TAMILSCRIPT_KEYWORDS=1` enables the same mode
for tools that cannot pass flags. It must appear before `--`; arguments after
`--` are forwarded to the program untouched. Full reference:
[docs/CLI.md](docs/CLI.md).

`init` writes `package.json`, `README.md`, `src/app.ot.js`, and
`test/app.test.js`; it refuses to overwrite existing files without
`--force`, never writes outside the destination, and rolls back files it
created if generation fails. CLI failures are categorized
(`usage`/`file`/`validation`/`config`/`runtime`), keep original stack
traces and `cause` chains, and add accurate hints for known error codes.

## Transform vs run

- **Transform** (`transform()`, `transformFile()`, `tamilscript transform`)
  rewrites `$`-literals (and, when opted in, Tamil keywords) into plain
  JavaScript and never executes anything.
  Use it to inspect output, build artifacts, or validate syntax.
- **Run** (`runFile()`, `tamilscript run`) transforms the entry file *plus*
  its relative JS dependencies into temp siblings, then executes the result
  with the same `node` binary (`--enable-source-maps`, stdio/args/exit code
  forwarded). Originals are never modified; temp files are removed even on
  failure.
- **Check** (`checkFile()`, `tamilscript check`) transforms (incl.
  dependencies) and runs `node --check` on the result without executing it.

## ESM and CommonJS usage

```js
// CommonJS
const { transform } = require("tamilscript");
// ESM
import { transform } from "tamilscript";
```

Both load the same `src/index.js` (CommonJS with statically analyzable
exports, tested with `import` on Node 24). `tamilscript run` executes `.mjs`,
`.cjs` and `.js` (per nearest `package.json` `type`) correctly, including
relative `import`/`require` of other TamilScript files.

## Error handling

- `transform()` throws `JsTamilSyntaxError` (`.line`, `.column`,
  `.filename`, stable `.code`) on malformed literals — e.g. the removed
  `$"…"` / `$'…'` string form (`JST_TAMIL_STRING_REMOVED`), `$௧.5`, `$௧n`,
  `$௧abc`. `formatDiagnostic(err, { source })` renders `file:line:col` +
  snippet output.
- `validate()` returns a diagnostic instead of throwing: malformed
  TamilScript keeps its `JST_*` code, while a transformed-JavaScript parse
  failure uses `JST_JAVASCRIPT_SYNTAX`; both locations are 1-based and mapped
  back through keyword/range replacements. It is syntax-only and never
  executes code.
- `TamilScriptError` and `TamilScriptSyntaxError` are exported aliases of
  `JsTamilError` and `JsTamilSyntaxError` (same constructors, so both
  `instanceof` checks work). The historical names and `JST_*` codes remain
  stable public API.
- `toNumber` throws `JsTamilError` on invalid characters, `RangeError`
  past `MAX_SAFE_INTEGER`; `toTamilNumerals` throws `RangeError` for
  negatives/fractions/unsafe values, `TypeError` for wrong input types.
- CLI exit codes: `0` success (or the program's own code for `run`),
  `1` transform/runtime/check failures, `2` usage errors.

## Troubleshooting

- `TamilScript string literals ($"...") are no longer supported` — remove the
  `$` and write an ordinary JavaScript string; `$` is reserved for Tamil
  numeric literals such as `$௧௮`.
- `Mixed Tamil/ASCII decimal "$௧.5"` — use all-Tamil (`$௧.௫`) or plain ASCII (`1.5`).
- `BigInt Tamil literals are not supported` — write ASCII BigInt (`18n`).
- `exceeds Number.MAX_SAFE_INTEGER` — split the value or use decimals/strings.
- `Cannot find module` at `run` — only relative JS specifiers are rewritten;
  bare packages, JSON/assets, and computed specifiers are left for Node.
- Stale `tamilscript-*-<pid>-*` temp files after a kill — the next `run --watch`
  start sweeps same-process files older than 60 s.

## Limitations

Decimals are IEEE 754 doubles; integer safe-range enforced; Tamil keywords
are opt-in and reserved only in that mode; ranges are ascending, inclusive,
and capped at 100,000 values; `validate()` is syntax-only (no type checker or
module resolver); static-specifier dependency rewriting; source maps with
line accuracy; watch mode with documented kill semantics; the formatter is
whitespace-only (not a pretty-printer); the linter is deliberately
two-rule (no type or semantic analysis); the REPL has no top-level
`await`, promise unwrapping, or `.load`. See
[docs/LIMITATIONS.md](docs/LIMITATIONS.md) for the honest full list.

## Editor support

The `vscode-extension/` directory in this checkout provides Tamil-literal
syntax highlighting (inside ordinary `.js`/`.mjs`/`.cjs` files, without
taking over the JavaScript language), snippets, debounced diagnostics from
the real transformer, and check/transform/run/version commands. It is
unpublished side-load only — see `vscode-extension/README.md`. The core
package has no editor dependency.

Because syntax highlighting cannot change what VS Code's built-in
TypeScript validator accepts, valid `$`-literals would otherwise keep its
red squiggles in `javascript` mode. The extension therefore switches a
document (saved file, unsaved buffer, or remote/virtual-workspace file)
that contains TamilScript literals (or enabled Tamil keywords) to the
dedicated `tamilscript` language mode (setting
`tamilscript.autoLanguageMode`, default on), where only the extension's
transformer-backed diagnostics apply; `*.ot.js` files open in that mode
directly. Detection is transformer-backed, file contents are never touched,
and switching a document back to JavaScript is respected for the session.
The extension's optional `tamilscript.tamilKeywords` setting defaults to
off. See `vscode-extension/README.md` for trade-offs.

## Development

```bash
npm install
npm test            # full suite via scripts/run-tests.js
node bin/tamilscript.js run examples/basic.js
```

Project layout: `src/` (lexer, numerals, keyword registry, transformer,
sourcemap, validation, runtime helpers, imports, runner, watch, repl, format,
lint, CLI), `bin/tamilscript.js`, `test/`, `examples/`, `bench/`, `scripts/`,
`docs/`. One runtime dependency: Acorn, used only by parser-backed
`validate()`.

## Test instructions

```bash
npm test                  # full suite via scripts/run-tests.js
node bench/bench.js --quick  # benchmark smoke run
```

523 tests across numerals, decimals, inclusive ranges, transformer, keyword
registry/mode, lexical contexts, diagnostics, source maps, validation, runtime
helpers, API stability, CLI, ESM, CommonJS, dependency rewriting, hardening,
watch mode, print helper, REPL, formatter, linter, edge cases and examples —
all must pass. The extension has its own suite (`vscode-extension/`, 106
tests); real VS Code host integration is a separate manual check.

## Packaging and publishing (maintainer only)

`tamilscript@0.1.0` is the previously published registry release. This
checkout prepares `0.2.0`; do not describe it as published until the reviewed
tarball is published by a maintainer.

```bash
npm pack --dry-run   # verify contents
npm publish          # maintainer only, after review and explicit approval
```

## License

MIT — see [LICENSE](LICENSE).

## Roadmap

- ~~Source maps for transformed stacks~~ — done in the OpenTamizh 0.2.0
  milestone (stack traces)
- ~~Editor highlighting for `$`-literals~~ — done via `vscode-extension/`
  (unpublished side-load; injection grammar + opt-in language)
- ~~Opt-in Tamil keyword aliases~~ — included in the 0.2.0 release candidate
  with an authoritative registry; deferred words are documented
- `BigInt` Tamil literal design (only with unambiguous syntax)
- Loader (`--import tamilscript/loader`) so dependencies need no rewriting
- Parser-backed formatting/pretty-printing (the current `format` normalizes
  whitespace only, by design)
- Column-exact maps on untouched lines (full token tracking)
