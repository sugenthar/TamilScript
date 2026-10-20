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
- Historical changelog entries are intentionally preserved verbatim, with a
  rename note added above them. They describe releases made under the old
  name.
- The new package exposes **only** the `tamilscript` executable. There is no
  legacy `opentamizh` bin alias: update npm scripts and shell aliases to the
  new command. The separately published `opentamizh` package is untouched.
- The VS Code extension keeps the `opentamizh` Marketplace publisher id.
  Changing a publisher requires a Marketplace owner transfer, which is not
  part of this rename.

## Registry status (audited 2026-10-20)

- `opentamizh@0.1.0` exists on the public npm registry. It was not modified,
  deprecated, or unpublished.
- The name `tamilscript` was available (the registry returned 404 for it).
  **Nothing has been published under the new name yet.** Do not describe the
  package as published until a maintainer actually publishes it.
- The GitHub repository URLs tried during the audit returned 404, so no
  replacement `repository`/`bugs` URL was invented. Add them once the real
  remote exists.

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

Not done (requires explicit maintainer approval): `npm publish`, publishing or
deprecating the old package, VS Code Marketplace publication/publisher
changes, and any Git commit, push, tag, or release.
