# TamilScript API reference

> `JsTamilError` / `JsTamilSyntaxError` / `JST_*` names are unchanged public
> API. `TamilScriptError` / `TamilScriptSyntaxError` are aliases of the same
> constructors, so either name works with `instanceof`. Import from
> `"tamilscript"`.

Core entry points are exported from the package root and work with both
`require("tamilscript")` and `import ... from "tamilscript"`. Explicit runtime
helpers live in `tamilscript/runtime` (see [Runtime helpers](#runtime-helpers-tamilscriptruntime)).

```js
const { toNumber, toTamilNumerals, transform, transformFile, validate } = require("tamilscript");
// or:
import { toNumber, toTamilNumerals, transform, transformFile, validate } from "tamilscript";
```

## toNumber(input)

Convert a Tamil numeral string to a JavaScript `Number` (**integers only**;
unchanged since v0.1.0 — use `parseTamilDecimal` for fractions).

```js
toNumber("௧௨௩"); // 123
toNumber("௦");    // 0
toNumber("$௧௮");  // 18 (optional leading $ tolerated)
```

- `input: string` (required). Anything else throws `TypeError`.
- Only Tamil digits `௦-௯` (after the optional `$`) are accepted; letters,
  ASCII digits, punctuation, decimal points and whitespace throw
  `JsTamilError` (code `JST_INVALID_NUMERAL`).
- Empty strings throw `JsTamilError`. Leading zeros are accepted and
  ignored (`toNumber("௦௦௧") === 1`).
- Values above `Number.MAX_SAFE_INTEGER` throw `RangeError` (no silent
  precision loss).

## toTamilNumerals(n)

Convert a non-negative safe integer to Tamil digits (unchanged since
v0.1.0 — use `toTamilDecimal` for fractions).

```js
toTamilNumerals(123); // "௧௨௩"
toTamilNumerals(0);   // "௦"
```

- `n: number` (required). Non-numbers throw `TypeError`.
- Negative numbers, fractions, `NaN`/`Infinity` and values above
  `Number.MAX_SAFE_INTEGER` throw `RangeError`. Negation is the caller's
  job (`"-" + toTamilNumerals(18)` or the unary minus operator in code).

## parseTamilDecimal(input)

Convert a Tamil decimal string to a JavaScript `Number`.

```js
parseTamilDecimal("௧௨.௫");  // 12.5
parseTamilDecimal("$௦.௧௮"); // 0.18
```

- Grammar: optional `$`, Tamil digits, one `.`, Tamil digits. Both sides
  required; mixed scripts rejected with `JsTamilError`.
- Result follows IEEE 754 semantics exactly (same as parsing the ASCII
  equivalent: `parseTamilDecimal("௧.௧") === 1.1`).

## toTamilDecimal(n)

Convert a non-negative finite number to a Tamil decimal string.

```js
toTamilDecimal(12.5); // "௧௨.௫"
toTamilDecimal(100);  // "௧௦௦" (integers render without a fraction)
```

- Renders the number as `String(n)` does, then transliterates digits.
- Negative, `NaN`/`Infinity` and exponent-notation values (`1e21`) throw
  `RangeError`. Fractional values round-trip via `parseTamilDecimal`.

## transform(source, options?)

Transform TamilScript source into standard JavaScript. Never executes code.

```js
const { transform } = require("tamilscript");
transform("let age = $௧௮;"); // "let age = 18;"
```

- `source: string` (required). Non-strings throw `TypeError`.
- `options.filename?: string` — used only in error messages.
- `options.tamilKeywords?: boolean` — opt in to the documented Tamil keyword
  aliases (default `false`). Ranges are numeric literals and need no opt-in.
- Returns the transformed `string` (plain JavaScript for Node.js).
- Pure transformation: no runtime code is added. When the source mentions
  the Tamil print helper (`அச்சிடு`), the file APIs below and the `transform`
  CLI inline a standalone runtime prelude instead — see `transformFile()`.
- Malformed TamilScript throws `JsTamilSyntaxError` with `.line`, `.column`,
  `.filename` and stable `.code` properties (see Errors).
- `$` is reserved for Tamil numeric literals: the removed `$"..."` /
  `$'...'` string form throws `JST_TAMIL_STRING_REMOVED` (write an ordinary
  JavaScript string instead). Ordinary strings, comments, regexes, and
  template text pass through untouched.
- Ordinary identifiers pass through verbatim — including the Tamil print
  helper name, which is why `tamilscript/runtime` programs transform cleanly.
  With `tamilKeywords: true`, only the implemented words in
  [SYNTAX.md](SYNTAX.md#41-tamil-keywords-opt-in) are rewritten.
  Property names after `.`/`#`, object keys, and ordinary class/object member
  names keep their spelling.

## transformWithMap(source, options?)

Transform and return a Source Map v3 object alongside the code.

```js
const { code, map } = transformWithMap(src, { filename: "prog.js" });
// map: { version: 3, sources: ["prog.js"], sourcesContent: [...], mappings }
```

Line-accurate everywhere; column-accurate outside replaced literal spans
(columns snap to literal boundaries on other lines, as with most maps).
`options.filename` is recorded in `map.sources`; `options.tamilKeywords`
enables keyword aliases. Keyword and range replacements are recorded just
like numeric literals in the map.

## transformWithMeta(source, options?)

Transform and list the replaced custom literals (powers
`tamilscript transform --explain`).

```js
const { code, events } = transformWithMeta('let a = $௧.௫;');
// events: [{ type: "decimal", line: 1, column: 9, text: "$௧.௫", value: "1.5" }]

transformWithMeta('என்றால் (true) {}', { tamilKeywords: true }).events;
// [{ type: "keyword", line: 1, column: 1, text: "என்றால்", value: "if" }]

transformWithMeta('const a = $௧..$௩;').events;
// [{ type: "range", line: 1, column: 11, text: "$௧..$௩",
//    value: "(() => { const values = []; for (let i = 0; i < 3; i++) values[i] = 1 + i; return values; })()" }]
```

Event collection is strictly opt-in: plain `transform()` never records
source snippets. `type` is one of `"number"`, `"decimal"`, `"range"`, or
`"keyword"`; `text` is the original source span and `value` is the emitted
replacement.

## transformFile(inputPath, outputPath?, options?)

Async file variant. Never overwrites the input unless forced.

```js
const { transformFile } = require("tamilscript");
const js = await transformFile("program.js");                    // return only
await transformFile("program.js", "program.out.js");             // write file
await transformFile("a.js", "a.js", { force: true });            // explicit overwrite
```

- Resolves paths, reads UTF-8 (a leading BOM is preserved and tolerated),
  transforms, and — when `outputPath` is given — creates parent directories
  and writes UTF-8 **atomically** (temp sibling + rename, so a crash never
  leaves a half-written output).
- Same-file input/output without `{ force: true }` throws.
- Empty/non-string paths throw `TypeError`.
- `options.tamilKeywords` opts in to Tamil keyword aliases; it is off by
  default and applies to every file transformed by the call.
- `transformFile` is the file variant of `transform()` and is what the
  `transform` CLI uses. Standalone output: when the source mentions the
  Tamil print helper (`அச்சிடு`), the returned and written code starts with
  a small inlined runtime prelude (the same global `tamilscript run`
  installs), so the file executes under plain `node` with no installed
  package and no manual edit. The prelude goes after a leading hashbang and
  any `"use strict"` directive prologue, uses no `require`/`import` (so
  CommonJS and ESM outputs both work), and never overwrites an existing
  global. Programs that never mention the helper are byte-identical to
  `transform()`. With `--source-map` (CLI), the external map is adjusted
  for the inserted lines.
- Filesystem failures throw `Error` with `.code` (the OS code) and
  `.cause` (the original error) preserved.

## runFile / checkFile (also exported)

- `runFile(file, args?, options?) -> Promise<exitCode>`: transform
  (including relative JS dependencies), execute via a child `node` process
  with `--enable-source-maps` and inline maps, forward stdio/args/exit codes,
  clean up temp files. `options.tamilKeywords` opts in to keyword aliases and
  is propagated to the dependency tree. When the program mentions the Tamil
  print helper, the child additionally loads it via `node --import` (see
  below).
- `checkFile(file, options?) -> Promise<{ ok, errors }>`: transform and run
  `node --check` over the transformed program incl. dependencies.
  `options.tamilKeywords` is propagated the same way. `errors` are formatted
  multi-line diagnostics (see below). Missing files yield
  `{ ok: false, errors }` instead of throwing.

## Tamil print helper (`tamilscript/runtime`)

`அச்சிடு()` is the first official Tamil helper: it behaves like
`console.log()` for zero, one, or many arguments of any kind, with
identical formatting and error propagation. One deliberate difference: it
never emits ANSI color escapes, even when `FORCE_COLOR` is set or stdout is
a terminal — program output stays byte-exact for pipes, tests, and
generated projects (see `docs/LIMITATIONS.md`).

```js
const { அச்சிடு } = require("tamilscript/runtime");
// or:
import { அச்சிடு } from "tamilscript/runtime";
// also re-exported from the package root:
const { அச்சிடு } = require("tamilscript");

அச்சிடு("வணக்கம்:", $௧௮);
```

- The runtime module is side-effect free: importing it installs no globals
  and modifies no built-ins. `PRINT_HELPER_NAME` (the helper's name as a
  string) is exported alongside for programmatic access.
- `runFile()` (and `tamilscript run`, including `--watch`) installs the
  helper automatically via `node --import src/register.js`, but only when
  the program text mentions it; other programs spawn exactly as before.
  The installer never overwrites an existing global value.
- Automatic setup needs Node.js 18.19+ or 20.6+. On older supported Node
  versions, running such a program throws an `Error` naming the minimum
  versions and the explicit-import alternative (after temp cleanup, so no
  temp files leak).
- `checkFile()` needs no runtime: the helper is an ordinary identifier, so
  `node --check` accepts it without execution.

## Runtime helpers (`tamilscript/runtime`)

Four explicit helpers are exported next to `அச்சிடு`. They are ordinary
functions, not keywords and not globals; importing the runtime does not
install them:

```js
const { சேர், நீளம், எண், சொல் } = require("tamilscript/runtime");

const values = சேர்([1, 2], 3); // [1, 2, 3] (same array)
நீளம்(values);                  // 3
எண்("௧௮");                      // 18 (Tamil integer)
எண்("$௧.௫");                   // 1.5 (Tamil decimal)
எண்("-$௧௮");                   // -18 (optional leading + or -)
சொல்(18);                       // "18"
```

- `சேர்(collection, ...values)` mutates and returns the same Array or Set.
  Any other receiver throws `TypeError`; it never silently substitutes an
  immutable collection.
- `நீளம்(value)` returns a numeric `.length` or `.size`. A value with neither
  (or `null`/`undefined`) throws `TypeError`.
- `எண்(value)` parses Tamil integer/decimal strings (with an optional leading
  `+`/`-` sign and optional `$`) through the same numeral parser as the
  transformer; other inputs use JavaScript `Number()` coercion, including its
  `NaN` result for invalid text.
- `சொல்(value)` is JavaScript `String()` coercion.
- All four are exported from `tamilscript/runtime`; they are intentionally
  **not** exported from the package root, so `require("tamilscript")` keeps
  its existing surface. `அச்சிடு` continues to be re-exported from the root
  for backward compatibility.

## validate(source, options?)

Syntax-validate TamilScript without executing it. This is the parser-backed
check used by the VS Code extension.

```js
const { validate } = require("tamilscript");

validate("let x = $௧௮;");
// { ok: true, code: "let x = 18;" }

validate("let x = ;");
// { ok: false, diagnostic: { line: 1, column: 9, name: "SyntaxError",
//   code: "JST_JAVASCRIPT_SYNTAX", message: "Unexpected token" } }

validate("என்றால் (true) {}", { tamilKeywords: true }); // { ok: true, ... }
```

- `options.filename` is accepted for consistency with `transform()`; it does
  not change the syntax check. `options.tamilKeywords` opts in to Tamil
  keyword aliases.
- Malformed TamilScript keeps its lexical `JST_*` code. Invalid JavaScript in
  the transformed output uses `JST_JAVASCRIPT_SYNTAX`.
- `line` and `column` are 1-based and are mapped back through keyword, range,
  numeric, and decimal replacements to the original source position.
- The check is **syntax-only**. It does not resolve imports, check identifier
  existence, validate types, or prove runtime behavior. Use `run`/`check` for
  execution checks; Acorn is a parser, not a type checker.
- Non-string input throws `TypeError`.
- Validation never executes the source or modifies globals.

## inlineSourceMapComment(map)

- Renders the `\n//# sourceMappingURL=data:…` comment for a Source Map v3
  object. Non-object input throws `TypeError` (it no longer silently
  encodes `null`/garbage into a bogus comment).

## Errors

`JsTamilError` (base, with `.code`) and `JsTamilSyntaxError` (adds `line`,
`column`, `filename`, `.locationString()`) are exported as
`require("tamilscript").errors` and as named properties, alongside
`ErrorCodes` (stable `JST_*` constants) and `formatDiagnostic(err,
{ source?, maxWidth? })`, which renders:

```text
example.js:3:14
JsTamilSyntaxError [JST_BAD_NUMERIC_LITERAL]: <message>
  3 | <offending line, truncated>
    |               ^
```

`TamilScriptError` and `TamilScriptSyntaxError` are exported aliases with the
same identities as `JsTamilError` and `JsTamilSyntaxError`. The historical
names and the `JST_*` codes remain the stable wire format in diagnostics and
are kept for compatibility; new code may use either alias.

`ErrorCodes.JAVASCRIPT_SYNTAX` (`"JST_JAVASCRIPT_SYNTAX"`) is the code added
for parser failures from `validate()` and the VS Code bridge. It is returned
as data by `validate()` rather than thrown, so existing callers that only
catch lexical errors are unaffected.

Only the single offending line is shown. Columns count UTF-16 code units,
matching `node --check`.
