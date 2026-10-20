'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { transform } = require('./transformer');
const { buildTransformedTree, cleanupTempFiles, sweepStalePidTemps } = require('./imports');
const { printRuntimeError, buildSpawnArgs, programEnv } = require('./runner');
const { formatDiagnostic } = require('./errors');

const DEBOUNCE_MS = 150;

/**
 * Watch mode: run a TamilScript entry file and rerun it whenever the entry or
 * any tracked relative dependency changes.
 *
 * Only files that participate in the transformed tree are watched (entry
 * plus resolved relative JS dependencies — never `node_modules`). Rapid
 * filesystem events are debounced so a single save triggers one rerun.
 * The previous child process is always terminated and its temp files
 * removed before the next run starts.
 */
class Watcher {
  /**
   * @param {string} filePath entry file
   * @param {string[]} [extraArgs] forwarded to the program
   * @param {{ stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream, nodeFlags?: string[] }} [streams]
   */
  constructor(filePath, extraArgs, streams) {
    this.entry = path.resolve(filePath);
    this.args = Array.isArray(extraArgs) ? extraArgs : [];
    this.stdout = (streams && streams.stdout) || process.stdout;
    this.stderr = (streams && streams.stderr) || process.stderr;
    this.nodeFlags = (streams && streams.nodeFlags) || [];
    this.dirWatchers = new Map(); // directory -> FSWatcher (survives file replace/delete)
    this.tracked = new Set(); // logical watched files (entry + resolved dependencies)
    this.child = null;
    this.tree = null;
    this.allTemps = new Set(); // every temp file ever written (swept on stop)
    this.timer = null;
    this.runId = 0;
    this.stopped = false;
    this.starting = null;
  }

  log(line) {
    this.stdout.write(`[tamilscript:watch] ${line}\n`);
  }

  errLine(line) {
    this.stderr.write(`[tamilscript:watch] ${line}\n`);
  }

  /** Start watching and perform the initial run. */
  async start() {
    if (this.starting) return this.starting;
    // Remove own-pid leftovers from a previous unhandleable termination.
    await sweepStalePidTemps([path.dirname(this.entry)], { except: this.allTemps });
    this.starting = this.rerun('initial run');
    return this.starting;
  }

  /** Absolute paths currently watched (entry + tracked dependencies). */
  watchedFiles() {
    return Array.from(this.tracked);
  }

  /**
   * Sync the logical watch set to exactly `files`. Watch events come from
   * per-directory watchers rather than per-file watchers: editors commonly
   * save by writing a temp file and renaming it over the target, and a
   * per-file watcher follows the replaced inode on Linux/macOS and then goes
   * silent; a deleted entry file could never be re-detected either. A
   * directory watcher keeps firing for every rewrite, rename, delete and
   * recreate of the tracked basenames.
   */
  syncWatchers(files) {
    const wanted = new Set(files.map((f) => path.resolve(f)));
    // A stop() can win the race against an in-flight rerun; never keep or
    // create watchers after the watcher was stopped.
    if (this.stopped) {
      this.tracked = new Set();
      return;
    }
    this.tracked = wanted;
    const dirs = new Set();
    for (const file of wanted) dirs.add(path.dirname(file));
    for (const [dir, w] of this.dirWatchers) {
      if (!dirs.has(dir)) {
        try { w.close(); } catch (err) { void err; }
        this.dirWatchers.delete(dir);
      }
    }
    for (const dir of dirs) {
      if (this.dirWatchers.has(dir)) continue;
      try {
        const w = fs.watch(dir, (event, filename) => this.onDirEvent(dir, filename));
        w.on('error', () => {
          // Directory vanished; drop it quietly.
          try { w.close(); } catch (err) { void err; }
          this.dirWatchers.delete(dir);
        });
        this.dirWatchers.set(dir, w);
      } catch (err) {
        // Unwatchable directory — skip; Node will report a proper error on
        // the next run if it matters.
        void err;
      }
    }
  }

  /** Schedule a rerun only for events naming a tracked file basename. */
  onDirEvent(dir, filename) {
    if (this.stopped) return;
    if (filename == null) {
      this.schedule();
      return;
    }
    const name = String(filename);
    for (const file of this.tracked) {
      if (path.dirname(file) === dir && path.basename(file) === name) {
        this.schedule();
        return;
      }
    }
  }

  schedule() {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.rerun('change detected').catch((err) => {
        this.errLine(String((err && err.message) || err));
      });
    }, DEBOUNCE_MS);
    if (this.timer.unref) this.timer.unref();
  }

  async killChild() {
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => {
      const done = () => resolve();
      child.on('close', done);
      try {
        child.kill('SIGTERM');
      } catch (err) {
        void err;
        done();
      }
      const force = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (err) { void err; }
      }, 2000);
      if (force.unref) force.unref();
    });
  }

  async cleanupTree() {
    if (this.tree) {
      const files = this.tree.tempFiles;
      this.tree = null;
      await cleanupTempFiles(files);
    }
  }

  rememberTemps(files) {
    for (const f of files) this.allTemps.add(f);
  }

  async rerun(reason) {
    if (this.stopped) return -1;
    const id = ++this.runId;
    await this.killChild();
    await this.cleanupTree();
    if (this.stopped || id !== this.runId) return -1;
    this.log(`${reason} — running ${this.entry}`);
    let source;
    try {
      source = await fs.promises.readFile(this.entry, 'utf8');
    } catch (err) {
      this.errLine(`Cannot read ${this.entry}: ${err.message} (retrying on change)`);
      this.syncWatchers([this.entry]);
      return 1;
    }
    let transformed;
    try {
      transformed = transform(source, { filename: this.entry });
    } catch (err) {
      this.errLine(formatDiagnostic(err, { source }));
      this.errLine('Waiting for changes…');
      this.syncWatchers([this.entry]);
      return 1;
    }
    let tree;
    try {
      tree = await buildTransformedTree(this.entry, transformed, {
        entrySource: source,
        withMaps: true,
      });
    } catch (err) {
      this.errLine(formatDiagnostic(err, { source }));
      this.errLine('Waiting for changes…');
      // Keep watching every file the failed build reached: the broken
      // dependency must be fixed too, not just the entry file.
      const attempted =
        err && Array.isArray(err.tamilscriptSources) && err.tamilscriptSources.length > 0
          ? err.tamilscriptSources
          : [this.entry];
      this.syncWatchers(attempted);
      return 1;
    }
    if (this.stopped || id !== this.runId) {
      await cleanupTempFiles(tree.tempFiles);
      return -1;
    }
    const runtimeErr = printRuntimeError(tree);
    if (runtimeErr) {
      await cleanupTempFiles(tree.tempFiles);
      this.errLine(`${runtimeErr.message} (retrying on change)`);
      this.errLine('Waiting for changes…');
      this.syncWatchers([this.entry]);
      return 1;
    }
    this.tree = tree;
    this.rememberTemps(tree.tempFiles);
    this.syncWatchers(tree.sources);
    const spawnArgs = buildSpawnArgs(tree, {
      nodeFlags: this.nodeFlags,
      scriptPath: tree.entryTemp,
      programArgs: this.args,
    });
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, spawnArgs, {
        stdio: ['inherit', 'inherit', 'inherit'],
        // Same plain-output guarantee as `run` (see src/runner.js).
        env: programEnv(),
      });
      this.child = child;
      child.on('error', (err) => {
        this.errLine(String((err && err.message) || err));
        resolve(1);
      });
      child.on('close', (c) => {
        if (this.child === child) this.child = null;
        resolve(c == null ? 1 : c);
      });
    });
    if (!this.stopped && id === this.runId) {
      this.log(`process exited with code ${code} — waiting for changes…`);
    }
    return code;
  }

  /** Stop the watcher: kill the child, clear timers, remove temp files. */
  async stop() {
    this.stopped = true;
    this.runId += 1;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.killChild();
    await this.cleanupTree();
    for (const [, w] of this.dirWatchers) {
      try { w.close(); } catch (err) { void err; }
    }
    this.dirWatchers.clear();
    this.tracked.clear();
    // Final sweep: anything this watcher ever wrote is gone, even if a
    // rerun was mid-flight when stop() was called.
    await cleanupTempFiles(Array.from(this.allTemps));
    this.allTemps.clear();
  }
}

/**
 * Run watch mode until the process receives SIGINT/SIGTERM.
 * @returns {Promise<number>} exit code for the CLI
 */
async function watchAndRun(filePath, extraArgs, streams) {
  const watcher = new Watcher(filePath, extraArgs, streams);
  const stop = async () => {
    await watcher.stop();
  };
  process.on('SIGINT', () => {
    stop().then(() => process.exit(130), () => process.exit(130));
  });
  process.on('SIGTERM', () => {
    stop().then(() => process.exit(143), () => process.exit(143));
  });
  await watcher.start();
  // Park forever; reruns happen on fs events. The pending promise keeps
  // the event loop alive alongside the active fs watchers.
  await new Promise(() => {});
  return 0;
}

module.exports = {
  Watcher,
  watchAndRun,
  DEBOUNCE_MS,
};
