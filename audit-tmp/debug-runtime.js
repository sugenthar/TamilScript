'use strict';
const { transform } = require('../src');
const { execFileSync } = require('node:child_process');

function ev(code, type) {
  try {
    return execFileSync(
      'node',
      type ? ['--input-type=module', '--eval', code] : ['-e', code],
      { encoding: 'utf8' },
    ).trim();
  } catch (e) {
    return 'ERR ' + String(e.stderr || e.message).slice(-400);
  }
}

// Control flow: for-range with continue/break, while, do..while, switch.
const csrc = [
  'let s = 0;',
  'for (let i of $௧..$௫?) { if (i === 2) continue; s += i; }',
  'let j = 0; while (j < 3) { j++; if (j === 2) break; }',
  'do { j++; } while (j < 5);',
  'let v;',
  'switch ($ந) { case 1: v = 10; break; case 2: v = 20; break; default: v = 0; }',
  'console.log(s + "," + j + "," + v);',
].join('\n').replaceAll('$ந', '$௨');
console.log('--- control flow ---');
console.log('src:', JSON.stringify(csrc));
let ctr;
try { ctr = transform(csrc); console.log('trans:', JSON.stringify(ctr)); }
catch (e) { console.log('trans ERR:', e.code, e.message); }
if (ctr) console.log('run:', ev(ctr));

// Async: async function, await, promise, async iteration.
const asrc = [
  'async function main() {',
  '  const delay = (ms) => new Promise((r) => setTimeout(r, ms));',
  '  await delay(5);',
  '  return "done";',
  '}',
  'main().then((v) => console.log(v));',
].join('\n');
console.log('--- async ---');
console.log('src:', JSON.stringify(asrc));
let atr;
try { atr = transform(asrc); console.log('trans:', JSON.stringify(atr)); }
catch (e) { console.log('trans ERR:', e.code, e.message); }
if (atr) console.log('run:', '[need module eval because of top-level .then with import? plain node ok]', ev(atr));

// Module-form async (imports present).
const msrc = 'import fs from "node:fs";\n' + asrc;
console.log('--- async module ---');
let mtr;
try { mtr = transform(msrc); console.log('trans:', JSON.stringify(mtr)); }
catch (e) { console.log('trans ERR:', e.code, e.message); }
if (mtr) console.log('run module:', ev(mtr, true));
