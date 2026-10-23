# OpenTamizh → TamilScript migration

This repository was previously named **OpenTamizh** and published as the npm
package `opentamizh`. It now builds the **TamilScript** project and the
`tamilscript` npm package.

## Mapping

| Before | After |
| --- | --- |
| Project name `OpenTamizh` | `TamilScript` |
| npm package `opentamizh` | `tamilscript` |
| CLI `opentamizh` | `tamilscript` |
| CLI entry `bin/opentamizh.js` | `bin/tamilscript.js` |
| Import `opentamizh` | `tamilscript` |
| Import `opentamizh/runtime` | `tamilscript/runtime` |
| Environment `OPENTAMIZH_LANG` | `TAMILSCRIPT_LANG` (legacy value still read) |
| Environment `OPENTAMIZH_TEST_DEPTH` | `TAMILSCRIPT_TEST_DEPTH` (legacy value still read) |
| Temp prefix `opentamizh-` | `tamilscript-` (old files are still swept) |
| VS Code extension display name `OpenTamizh` | `TamilScript` |
| VS Code extension package `opentamizh-vscode` | `tamilscript-vscode` |
| VS Code language id `opentamizh` | `tamilscript` |
| VS Code commands `opentamizh.*` | `tamilscript.*` (legacy ids still registered) |
| VS Code settings `opentamizh.*` | `tamilscript.*` (legacy values still read) |
| Grammar scope `source.opentamizh` | `source.tamilscript` |

## Compatibility decisions

- `JsTamilError`, `JsTamilSyntaxError`, and the `JST_*` error codes are a
  published public API. They are **not** renamed. `TamilScriptError` and
  `TamilScriptSyntaxError` are new aliases of the same constructors, so both
  `instanceof` checks work and existing switch statements keep working.
- Diagnostic text keeps the historical class names (`JsTamilSyntaxError`) and
  codes (`JST_*`) for machine compatibility; only the project branding in
  messages changes.
- Old temp-file prefixes (`opentamizh-`, `jstamil-`) are still recognized by
  the stale-file sweeper so upgrades do not leave debris.
- Legacy VS Code setting names are still read as fallbacks; legacy command
  ids are registered as aliases on activation.
- Historical changelog entries retain their original text, version numbers,
  and old command names. The OpenTamizh 0.2.0-0.6.0 entries are grouped as
  pre-rename development history and are not TamilScript releases. The first
  release under the `tamilscript` name is `0.1.0`; `0.2.0` is the next.
- The new package exposes **only** the `tamilscript` executable. There is no
  legacy `opentamizh` bin alias: update npm scripts and shell aliases to the
  new command. The separately published `opentamizh` package is untouched.
- The VS Code extension keeps the `opentamizh` Marketplace publisher id.
  Changing a publisher requires a Marketplace owner transfer, which is not
  part of this rename.
- **Tamil keyword mode is opt-in.** `tamilKeywords` / `--tamil-keywords` /
  `TAMILSCRIPT_KEYWORDS=1` must be requested explicitly. Default output stays
  byte-identical, and ordinary Tamil identifiers remain valid by default.
  Property names after `.`/`#` and ordinary object/class member names keep
  their Tamil spelling even in keyword mode.
- **Ranges are additive syntax inside the already-reserved `$` namespace.**
  `$௧..$௫` is inclusive and does not change existing numeric or decimal
  literals. There is no new prefix or global.
- **`validate()` is an additive root export.** It returns parser diagnostics
  instead of throwing. Acorn is now the single runtime dependency and is used
  only by parser-backed validation; transform/run behavior is unchanged.
- **Runtime helpers are explicit.** `சேர்`, `நீளம்`, `எண்`, and `சொல்` are
  exported from `tamilscript/runtime` only. They are not keywords, not
  globals, and not added to the root package exports.

## Registry status (re-audited 2026-10-23)

- `tamilscript@0.1.0` exists on the public npm registry and is the `latest`
  dist-tag. This audit did not publish, deprecate, or unpublish anything.
- The `0.2.0` release candidate in this checkout includes the keyword, range,
  validation, helper, and documentation changes. It is **not published**;
  do not describe it as published until a maintainer publishes the reviewed
  tarball.
- `opentamizh@0.1.0` also exists and was not modified or deprecated.
- The repository is now available at
  <https://github.com/sugenthar/TamilScript>; the local `origin`, package
  metadata, and registry `repository.url` all point there.

## Checklist

- [x] Audit repository, git state, old-name references, and published state
- [x] Back up the working tree
- [x] Rename package metadata, lockfile, and bin entry
- [x] Rename source branding, CLI output, env vars, temp prefixes, and docs
- [x] Add TamilScript public API aliases with regression tests
- [x] Rename and rebrand the VS Code extension safely
- [x] Regenerate the npm lockfile
- [x] Run the full core test suite
- [x] Run the extension test suite
- [x] Pack and install the tarball locally; verify every CLI command
- [x] Run the final case-insensitive old-name audit
- [x] Prepare the 0.2.0 release candidate (version, changelog, docs, tarball,
      declaration, security, and consumer checks)
- [ ] Publish `tamilscript@0.2.0` (requires explicit maintainer approval)

Not done (requires explicit maintainer approval): `npm publish`, publishing or
deprecating the old package, VS Code Marketplace publication/publisher
changes, and any Git commit, push, tag, or release.
