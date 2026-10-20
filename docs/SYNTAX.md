# TamilScript syntax reference

TamilScript source is **ordinary JavaScript plus custom value-literal forms**.
A transformation step rewrites those forms into standard JavaScript
*before* Node.js parses or runs anything — Node.js itself never sees the
`$`-prefixed syntax.

## 1. Tamil numeric literals

`$` followed by one or more Tamil digits `௦-௯`:

| Tamil | Value |
|-------|-------|
| ௦ | 0 | ௧ | 1 | ௨ | 2 | ௩ | 3 | ௪ | 4 |
| ௫ | 5 | ௬ | 6 | ௭ | 7 | ௮ | 8 | ௯ | 9 |

```js
let age = $௧௮;      // -> let age = 18;
let price = $௧௦௦;    // -> let price = 100;
let zero = $௦;       // -> let zero = 0;
let negative = -$௧௮; // -> let negative = -18;  (normal unary minus)
let mixed = $௧௦ + 20; // -> let mixed = 10 + 20;
```

Grammar rules:

- Integers only in this form. Multi-digit values and leading zeros
  (`$௦௦௧` → `1`) are accepted.
- A literal must not be glued to ASCII letters/digits/`_`/`$`
  (`$௧2`, `$௧abc` are syntax errors, not guesses).
- BigInt is **not supported**: `$௧n` raises a clear error. Use `18n`.
- Integer values above `Number.MAX_SAFE_INTEGER` are rejected rather than
  silently rounded.
- Tamil digits are never thousands separators and no other numeral
  conventions are inferred.
- A Tamil digit that is not part of a `$` literal (`let x = ௧;`, `1௧`)
  cannot be valid JavaScript and is reported with a suggestion to write
  `$௧`. Tamil digits inside identifiers (`பெயர்௧`), strings, comments,
  regex literals, and template text are ordinary text and are never
  touched.

## 2. Tamil decimal literals (new in v0.2.0)

`$`, Tamil digits, one ASCII `.` (U+002E), then Tamil digits:

```text
TamilDecimal := '$' TamilDigit+ '.' TamilDigit+
```

```js
const price = $௧௨.௫;              // -> const price = 12.5;
const tax = $௦.௧௮;                // -> const tax = 0.18;
const result = $௧௨.௫ + $௨.௫;      // -> 15
```

Rules:

- **Both sides are required** and must both be Tamil digits. A fraction
  without its integer digits (`$.௫`) is reported
  (`JST_BAD_NUMERIC_LITERAL`) with the corrected shape — Tamil digits can
  never start a property name, so it cannot be valid JavaScript. `$௧.`
  followed by a non-digit is an integer plus ordinary JavaScript, e.g.
  `$௧.toString()` keeps working.
- **One separator only**: `$௧.௫.௬` is an error.
- **No mixed scripts**: `$௧.5` is an error suggesting all-Tamil
  (`$௧.௫`) or plain ASCII (`1.5`).
- Decimals follow **IEEE 754 double-precision semantics exactly**: the
  value is computed the way JavaScript parses the equivalent ASCII
  literal, so `$௦.௧ + $௦.௨` equals `0.1 + 0.2` (which famously is not
  exactly `0.3` — in either language).
- The `.` is a separator **only** when immediately followed by a Tamil
  digit. Property access (`$௧.toString()`, `$௩.௫.toFixed(1)`), ASCII
  decimals (`1.5`), spread (`...`), optional chaining (`?.`) and `$`
  identifiers are unaffected. A decimal whose normalized value has no
  fraction (`$௧.௦`) still gets the integer form's `1..toString()` output,
  and a Tamil property name after a decimal (`$௩.௫.மதிப்பு`) is ordinary
  JavaScript.
- A further `.` that cannot start property access
  (`$௩.௫..toString()`, `$௩.௫.`, `$௩.௫.+$௧`) is reported
  (`JST_BAD_NUMERIC_LITERAL`), and `$`+Tamil digits after a decimal point
  (`$௩.௫.$௨`) is reported like `$௧.$௨` (`JST_MIXED_NUMERAL`). A literal
  directly after a dot that is not a `...` spread (`obj.$௧`, `a..$௧`) is
  reported too; only a full three-dot spread may precede one
  (`[...$௧]` keeps working).
- Like integers, decimals work in expressions, calls, arrays, objects,
  template `${...}` and modules.

## 3. `$` is reserved: strings are ordinary JavaScript

`$` has exactly one meaning in TamilScript: it introduces a Tamil numeric
literal. Tamil text uses standard JavaScript strings, with no prefix:

```js
let name = "Tamil";
let greeting = "வணக்கம்";
let other = 'தமிழ் மொழி';   // single quotes work the same way
let empty = "";
let line = `count: ${$௧௮}`; // templates + ${...} literals work
```

- These are ordinary JavaScript strings: escapes (`\"`, `\\`, `\n`,
  `\xNN`, `\uNNNN`, `\u{...}`, …) behave exactly as Node.js defines them,
  and the text is preserved byte-for-byte.
- **Removed form.** Older versions accepted `$"..."` and `$'...'` string
  literals. Both are rejected now with `JST_TAMIL_STRING_REMOVED` and the
  exact location; the migration is to delete the `$` — the quoted text did
  not change. The transformer never silently passes the old form through,
  because `$` before a quote is not valid JavaScript either.
- `$` inside strings, comments, regex literals, and template literal text
  is never interpreted (see §5).

## 4. Variables stay normal JavaScript

Tamil identifiers are ordinary JavaScript identifiers and need no
transformation.

```js
let name = "தமிழ்";   // correct: ordinary string
let age = $௧௮;        // correct
let rate = $௧.௫;      // correct (v0.2.0 decimal)
let $name = 1;       // ordinary `$`-identifier, left alone
```

Only `$` + Tamil digits (optionally with a Tamil decimal fraction) is
transformed. `$name`, `$`, `$$`, `${...}`, `$` followed by a template,
jQuery-style `$()`, and every other `$` usage are preserved verbatim.

## 5. Lexical contexts

The transformer is a real scanner, not a global find-and-replace:

- Ordinary strings: `"price: $௧௮"` is never touched.
- Line/block comments are never touched.
- Regex literals (`/\$[0-9]+/gi`) are preserved; division (`a / b`)
  is distinguished with previous-token tracking.
- Template literal text is never touched, but `${...}` expressions are
  transformed (nesting supported):
  `` `value: ${$௧௮}` `` → `` `value: ${18}` ``.
- Identifiers, property names (`object.name`) and operators are unchanged.
- Plain JavaScript without TamilScript literals transforms byte-identical.
