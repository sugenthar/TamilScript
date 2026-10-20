'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { transform, transformWithMap, transformWithMeta } = require('./transformer');
const { addStandaloneRuntime, adjustMappingsForInjection } = require('./standalone');

let tmpCounter = 0;

/**
 * Whether two resolved paths refer to the same file. Equal path strings are
 * not the only aliases: on Windows and macOS a differently-cased path is
 * still the same file, and symlinks/hard links alias on every platform.
 * Comparing filesystem identity (dev + inode) when both paths exist closes
 * those holes so the "never overwrite the input" guard cannot be bypassed.
 *
 * @param {string} a absolute path
 * @param {string} b absolute path
 * @returns {boolean}
 */
function isSameFile(a, b) {
  if (a === b) return true;
  if (process.platform === 'win32' || process.platform === 'darwin') {
    if (a.toLowerCase() === b.toLowerCase()) return true;
  }
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    return sa.ino !== 0 && sb.ino !== 0 && sa.dev === sb.dev && sa.ino === sb.ino;
  } catch (err) {
    void err;
    return false;
  }
}

/**
 * Write a file atomically: content lands in a uniquely-named sibling temp
 * file first, then is renamed over the destination. A crash mid-write can
 * therefore leave a stray `.tamilscript-*.tmp` file but never a half-written
 * output. Best-effort cleanup removes the temp file on failure.
 *
 * @param {string} absPath absolute destination path
 * @param {string} content UTF-8 text to write
 */
async function writeFileAtomic(absPath, content) {
  await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
  tmpCounter += 1;
  const rand = crypto.randomBytes(4).toString('hex');
  const tmpPath = `${absPath}.tamilscript-${process.pid}-${Date.now()}-${tmpCounter}-${rand}.tmp`;
  let handle;
  try {
    // Exclusive create so a planted symlink at the random temp path is never
    // followed (which could truncate the link target). 0o600 keeps output
    // content private during the brief temp-file window.
    handle = await fs.promises.open(tmpPath, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.close();
    handle = null;
    await fs.promises.rename(tmpPath, absPath);
  } catch (err) {
    if (handle) {
      try { await handle.close(); } catch (closeErr) { void closeErr; }
    }
    if (!err || err.code !== 'EEXIST') {
      try { await fs.promises.unlink(tmpPath); } catch (cleanupErr) { void cleanupErr; }
    }
    throw err;
  }
}

/**
 * Read a TamilScript source file, transform it, and optionally write the output.
 *
 * The original file is never overwritten unless `outputPath` explicitly
 * resolves to the same file AND `options.force` is true.
 *
 * When the source mentions the Tamil print helper அச்சிடு, the returned and
 * written code includes the inlined standalone runtime prelude, so the file
 * runs under plain `node` without an installed tamilscript package (see
 * src/standalone.js). Programs that never mention the helper are unchanged.
 *
 * @param {string} inputPath path to the `.js` source file
 * @param {string} [outputPath] optional destination for transformed output
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<string>} the transformed, standalone-runnable JavaScript
 */
async function transformFile(inputPath, outputPath, options) {
  if (typeof inputPath !== 'string' || inputPath.length === 0) {
    throw new TypeError('transformFile() expects inputPath as a non-empty string.');
  }
  const absIn = path.resolve(inputPath);
  let source;
  try {
    source = await fs.promises.readFile(absIn, 'utf8');
  } catch (err) {
    const wrapped = new Error(`Cannot read input file ${JSON.stringify(absIn)}: ${err.message}`);
    wrapped.code = err.code || 'JST_READ_ERROR';
    wrapped.cause = err;
    throw wrapped;
  }
  // File output is expected to be runnable under plain `node`, so programs
  // that mention the Tamil print helper receive the inlined standalone
  // runtime prelude (src/standalone.js).
  const { code: output } = addStandaloneRuntime(transform(source, { filename: absIn }), source);
  if (outputPath == null) {
    return output;
  }
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new TypeError('transformFile() expects outputPath as a non-empty string when provided.');
  }
  const absOut = path.resolve(outputPath);
  if (isSameFile(absOut, absIn) && !(options && options.force)) {
    const err = new Error(
      `Refusing to overwrite input file ${JSON.stringify(absIn)}. ` +
        'Choose a different output path or pass { force: true }.'
    );
    err.code = 'JST_WRITE_OVERWRITE';
    throw err;
  }
  try {
    await writeFileAtomic(absOut, output);
  } catch (err) {
    const wrapped = new Error(`Cannot write output file ${JSON.stringify(absOut)}: ${err.message}`);
    wrapped.code = err.code || 'JST_WRITE_ERROR';
    wrapped.cause = err;
    throw wrapped;
  }
  return output;
}

module.exports = {
  transformFile,
  transformFileWithOptions,
  writeFileAtomic,
};

/**
 * Extended file transformation with explain events and/or an external
 * source map (used by `tamilscript transform --explain/--source-map`). The
 * standalone runtime prelude is applied like in transformFile(), and `map`
 * mappings are adjusted for the inserted lines.
 *
 * @param {string} inputPath
 * @param {string} outputPath explicit destination (required)
 * @param {{ force?: boolean, explain?: boolean, sourceMap?: boolean }} [options]
 * @returns {Promise<{ code: string, events: Array, map: object|null }>}
 */
async function transformFileWithOptions(inputPath, outputPath, options) {
  const opts = options || {};
  if (typeof inputPath !== 'string' || inputPath.length === 0) {
    throw new TypeError('transformFile() expects inputPath as a non-empty string.');
  }
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new TypeError('transformFile() expects outputPath as a non-empty string when provided.');
  }
  const absIn = path.resolve(inputPath);
  const absOut = path.resolve(outputPath);
  let source;
  try {
    source = await fs.promises.readFile(absIn, 'utf8');
  } catch (err) {
    const wrapped = new Error(`Cannot read input file ${JSON.stringify(absIn)}: ${err.message}`);
    wrapped.code = err.code || 'JST_READ_ERROR';
    wrapped.cause = err;
    throw wrapped;
  }
  if (isSameFile(absOut, absIn) && !opts.force) {
    const err = new Error(
      `Refusing to overwrite input file ${JSON.stringify(absIn)}. ` +
        'Choose a different output path or pass { force: true }.'
    );
    err.code = 'JST_WRITE_OVERWRITE';
    throw err;
  }
  let code;
  let events = [];
  let map = null;
  if (opts.sourceMap) {
    const r = transformWithMap(source, { filename: absIn });
    code = r.code;
    map = r.map;
    events = opts.explain ? transformWithMeta(source, { filename: absIn }).events : [];
  } else if (opts.explain) {
    const r = transformWithMeta(source, { filename: absIn });
    code = r.code;
    events = r.events;
  } else {
    code = transform(source, { filename: absIn });
  }
  const packed = addStandaloneRuntime(code, source);
  code = packed.code;
  if (map && packed.injection) {
    map.mappings = adjustMappingsForInjection(map.mappings, packed.injection);
  }
  let body = code;
  if (map) {
    map.file = path.basename(absOut);
    body += `\n//# sourceMappingURL=${path.basename(absOut)}.map\n`;
  }
  try {
    await writeFileAtomic(absOut, body);
    if (map) {
      await writeFileAtomic(`${absOut}.map`, JSON.stringify(map));
    }
  } catch (err) {
    const wrapped = new Error(`Cannot write output file ${JSON.stringify(absOut)}: ${err.message}`);
    wrapped.code = err.code || 'JST_WRITE_ERROR';
    wrapped.cause = err;
    throw wrapped;
  }
  return { code: body, events, map };
}
