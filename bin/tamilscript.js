#!/usr/bin/env node
'use strict';
const { main } = require('../src/cli');
main(process.argv).then(
  (code) => process.exit(code == null ? 0 : code),
  (err) => {
    process.stderr.write(`${(err && err.stack) || String(err)}\n`);
    process.exit(1);
  }
);
