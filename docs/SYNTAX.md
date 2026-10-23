# TamilScript syntax reference

TamilScript source is **ordinary JavaScript plus custom value-literal forms**.
An optional keyword mode can also rewrite a small, documented set of Tamil
words. A transformation step rewrites those forms into standard JavaScript
*before* Node.js parses or runs anything — Node.js itself never sees the
`$`-prefixed syntax or Tamil keyword spellings.

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

## 2. Tamil decimal literals

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

## 2.1 Inclusive Tamil ranges

```text
TamilRange := '$' TamilDigit+ '..' '$' TamilDigit+
```

```js
const oneToFive = $௧..$௫;
// generated:
// (() => { const values = []; for (let i = 0; i < 5; i++)
//   values[i] = 1 + i; return values; })()
const zeroToTwo = $௦..$௨; // -> [0, 1, 2]
```

- Both endpoints are included. The range must be ascending and both values
  must be safe integers.
- At most 100,000 values are allowed. A larger range is a
  `JST_BAD_NUMERIC_LITERAL` diagnostic rather than an allocation request.
- Both endpoints are Tamil integer literals. A decimal
  (`$௧.௫..$௨.௫`) is diagnosed by the decimal rules; an ASCII endpoint
  (`$௧..5`) is diagnosed as `JST_MIXED_NUMERAL`; a bare Tamil endpoint
  (`$௧..௫`) is diagnosed as a missing `$` rather than emitted as invalid
  JavaScript.
- A range is an expression yielding a fresh array, so it works in `for...of`,
  spread, calls, and templates. Property access after the closing endpoint
  stays attached: `$௧..$௫.toString()` calls `toString()` on the generated
  array.
- Ranges are part of the numeric literal layer and do not require
  `--tamil-keywords`.
- The generated expression is self-contained: it builds an array literal with
  a loop and does not resolve `Array` or another global identifier. A local
  binding named `Array` therefore cannot change the result.

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
let rate = $௧.௫;      // correct (Tamil decimal)
let $name = 1;       // ordinary `$`-identifier, left alone
```

Without keyword mode, Tamil numeric forms are transformed: `$` + Tamil digits
(optionally with a Tamil decimal fraction) and inclusive ranges such as
`$௧..$௫`. `$name`, `$`, `$$`, `${...}`, `$` followed by a template,
jQuery-style `$()`, and every other `$` usage are preserved verbatim.

## 4.1 Tamil keywords (opt-in)

Keyword mode is never implicit. Enable it with `--tamil-keywords`,
`TAMILSCRIPT_KEYWORDS=1`, `{ tamilKeywords: true }`, or the VS Code setting
`tamilscript.tamilKeywords`.

### Implemented

| Tamil | JavaScript |
| --- | --- |
| `என்றால்` | `if` |
| `இல்லை` | `else` |
| `நிறுத்து` | `break` |
| `தொடர்` | `continue` |
| `ஒவ்வொரு` | `for` |
| `செயல்` | `function` |
| `கொடு` | `return` |
| `வகுப்பு` | `class` |
| `உருவாக்கு` | `constructor` |
| `இது` | `this` |
| `மேல்` | `super` |
| `சேர்தல்` | `extends` |

```js
செயல் கூட்டு(a, b = $௧) { கொடு a + b; }

வகுப்பு வணக்கம் {
  உருவாக்கு(பெயர்) { இது.பெயர் = பெயர்; }
  பேசு() { கொடு "வணக்கம் " + இது.பெயர்; }
}

ஒவ்வொரு (const i of $௧..$௫) {
  என்றால் (i % $௨ === $௦) தொடர்;
  அச்சிடு(i);
}
```

- Implemented words are reserved in keyword mode. `const என்றால் = 1;`
  becomes `const if = 1;`, which `validate()` reports as
  `JST_JAVASCRIPT_SYNTAX`.
- Property names and private names are not rewritten: `obj.என்றால்`,
  `this.#தனி`, `{ என்றால்: 1 }`, class fields (including semicolonless fields
  without initializers), and ordinary object/class method names keep their
  Tamil spelling. This keeps `{ என்றால்: 1 }` consistent with
  `obj.என்றால்`. `உருவாக்கு(...)` is the intentional exception only when it is
  a class constructor member; the same spelling in an object literal remains
  an ordinary method/property name.
- The words are still ordinary identifiers when keyword mode is off (the
  default), so existing Tamil identifier code is unchanged.

### Deferred

These proposed words are **not** implemented and remain identifiers even in
keyword mode:

| Tamil | Would mean | Why deferred |
| --- | --- | --- |
| `செயல்படுத்து` | `implements` | JavaScript has no implements clause. |
| `பொது` | `public` | JavaScript has no public modifier. |
| `தனி` | `private` | Mapping to `#` fields needs class-member grammar. |
| `இடைமுகம்` | `interface` | Type-only; needs a type parser and erasure rules. |
| `எண்ணகம்` | `enum` | Needs defined runtime object semantics. |
| `வெற்று` | `void` | Type-only in the proposal. |
| `தொகுப்பு` | `package` | No JavaScript package declaration exists. |

### Runtime helpers, not keywords

`சேர்`, `நீளம்`, `எண்`, and `சொல்` are explicit exports of
`tamilscript/runtime`; they are not rewritten and are not globals. See
[docs/API.md](API.md#runtime-helpers-tamilscriptruntime).

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
  In keyword mode, property names after `.`/`#`, object literal keys, labels,
  and ordinary class/object member names are still left alone; only the
  implemented keyword spellings in expression/statement/keyword positions are
  rewritten.
- Keyword mode does not inspect comments, strings, regex literals, or raw
  template text either. A keyword spelling in template expressions is
  rewritten like any other expression.
- Plain JavaScript without TamilScript literals transforms byte-identical.
