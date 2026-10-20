'use strict';

// Automatic runtime setup for `tamilscript run`.
//
// This module exists so the Tamil print helper is available to TamilScript
// programs without boilerplate imports. It installs the helper from
// src/runtime.js as a shared global the first time it is loaded, and never
// overwrites an existing value. It is loaded via `node --import` by the
// run/watch pipeline only when the program mentions the helper; it is NOT
// loaded by transform(), check(), or plain library imports, and it modifies
// no built-in objects.

const runtime = require('./runtime');

if (globalThis[runtime.PRINT_HELPER_NAME] === undefined) {
  globalThis[runtime.PRINT_HELPER_NAME] = runtime[runtime.PRINT_HELPER_NAME];
}
