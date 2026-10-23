'use strict';

// Tamil print helper for TamilScript programs.
//
// அச்சிடு behaves like console.log for the arguments it receives: zero, one,
// or many arguments of any kind (Tamil or English strings, numbers, objects,
// arrays). Formatting (including printf-style placeholders) is preserved,
// and errors raised while formatting propagate to the caller unchanged.
//
// One deliberate difference: output is never tinted with ANSI escapes, even
// when the environment forces color (FORCE_COLOR) or stdout is a terminal.
// Node's console colorizes non-string arguments through util.inspect as soon
// as the stream reports color support, which would silently change program
// output — breaking exact-output tests, generated projects, and pipes.
// Program output is data, so it stays byte-exact; call console.log or a
// color library directly when colored output is actually wanted.
//
// This module is deliberately side-effect free: importing it never installs
// globals and never executes user code. Programs executed with
// `tamilscript run` receive the helper automatically (see src/register.js);
// every other context uses it through an explicit import:
//
//   const { அச்சிடு } = require('tamilscript/runtime');
//   import { அச்சிடு } from 'tamilscript/runtime';

const { Console } = require('node:console');
const { சேர், நீளம், எண், சொல் } = require('./helpers/tamil-helpers');

const PRINT_HELPER_NAME = '\u0b85\u0b9a\u0bcd\u0b9a\u0bbf\u0b9f\u0bc1';

// `colorMode: false` (available since Node.js 18.0.0) disables ANSI color
// for every inspected argument while keeping console.log semantics:
// printf-style formatting, one line per call, and write errors ignored.
// `inspectOptions` must not be combined with `colorMode` (Node throws
// ERR_INCOMPATIBLE_OPTION_PAIR), which is why only colorMode is set.
const plainConsole = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  ignoreErrors: true,
  colorMode: false,
});

const அச்சிடு = (...args) => plainConsole.log(...args);

module.exports = { அச்சிடு, சேர், நீளம், எண், சொல், PRINT_HELPER_NAME };
