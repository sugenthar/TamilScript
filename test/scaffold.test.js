'use strict';

// Unit tests for the scaffolding module (src/scaffold.js): name
// sanitization, path containment, the initProject result contract, and
// rollback/no-overwrite safety guarantees — without spawning the CLI.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  initProject,
  projectNameFor,
  isInside,
  SAMPLE_OUTPUT,
  TEMPLATE_FILES,
} = require('../src/scaffold.js');

const RELS = TEMPLATE_FILES.map((t) => t.rel);

let workdir;
before(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-scaffold-'));
});
after(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe('scaffold: project names', () => {
  it('keeps valid names and sanitizes the rest', () => {
    assert.equal(projectNameFor(path.resolve('/x/my-app')), 'my-app');
    assert.equal(projectNameFor(path.resolve('/x/My App')), 'my-app');
    assert.equal(projectNameFor(path.resolve('/x/my_app')), 'my_app');
    assert.equal(projectNameFor(path.resolve('/x/app.')), 'app');
    assert.equal(projectNameFor(path.resolve('/x/.hidden')), 'hidden');
  });
  it('falls back for unusable, reserved, and root names', () => {
    assert.equal(projectNameFor(path.resolve('/x/தமிழ்')), 'tamilscript-app');
    assert.equal(projectNameFor(path.resolve('/x/---')), 'tamilscript-app');
    assert.equal(projectNameFor(path.resolve('/x/node_modules')), 'tamilscript-app');
    assert.equal(projectNameFor(path.resolve('/x/favicon.ico')), 'tamilscript-app');
    assert.equal(projectNameFor(path.resolve('/')), 'tamilscript-app');
  });
  it('caps the name at the npm length limit', () => {
    const name = projectNameFor(path.resolve('/x/' + 'a'.repeat(300)));
    assert.ok(name.length <= 214, name.length);
    assert.match(name, /^a+$/);
  });
});

describe('scaffold: path containment', () => {
  it('accepts only strictly nested paths', () => {
    const parent = path.resolve('/tmp/ot-parent');
    assert.equal(isInside(parent, path.join(parent, 'file.js')), true);
    assert.equal(isInside(parent, path.join(parent, 'a', 'b.js')), true);
    assert.equal(isInside(parent, parent), false);
    assert.equal(isInside(parent, path.resolve('/tmp/ot-parent-2/file.js')), false);
    assert.equal(isInside(parent, path.resolve('/tmp/elsewhere/file.js')), false);
  });
});

describe('scaffold: initProject', () => {
  it('creates exactly the template files and reports absolute paths', async () => {
    const dest = path.join(workdir, 'fresh');
    const result = await initProject(dest, {});
    assert.equal(result.dir, path.resolve(dest));
    assert.equal(result.display, dest);
    assert.equal(result.name, 'fresh');
    assert.deepEqual(
      result.created,
      RELS.map((rel) => path.join(path.resolve(dest), rel))
    );
    assert.deepEqual(result.overwritten, []);
    for (const rel of RELS) {
      assert.ok(fs.existsSync(path.join(dest, rel)), `${rel} must exist`);
    }
  });

  it('refuses to overwrite without force and reports the files', async () => {
    const dest = path.join(workdir, 'no-overwrite');
    await initProject(dest, {});
    await assert.rejects(initProject(dest, {}), (err) => {
      assert.equal(err.code, 'SCAFFOLD_EEXIST');
      assert.match(err.message, /refusing to overwrite existing files/);
      assert.deepEqual(err.files, RELS);
      return true;
    });
  });

  it('tracks overwritten files with force', async () => {
    const dest = path.join(workdir, 'with-force');
    await initProject(dest, {});
    const forced = await initProject(dest, { force: true });
    assert.deepEqual(forced.created, []);
    assert.deepEqual(
      forced.overwritten,
      RELS.map((rel) => path.join(path.resolve(dest), rel))
    );
  });

  it('rejects a destination that is an existing file', async () => {
    const dest = path.join(workdir, 'dest-is-file');
    fs.writeFileSync(dest, 'file\n', 'utf8');
    await assert.rejects(initProject(dest, {}), (err) => {
      assert.equal(err.code, 'SCAFFOLD_DEST_FILE');
      assert.match(err.message, /exists and is not a directory/);
      return true;
    });
  });

  it('rolls back created files when a directory name is blocked', async () => {
    const dest = path.join(workdir, 'blocked');
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'src'), 'user data\n', 'utf8');
    await assert.rejects(initProject(dest, {}), (err) => {
      assert.equal(err.code, 'SCAFFOLD_WRITE_FAILED');
      assert.match(err.message, /already exists at/);
      return true;
    });
    assert.ok(!fs.existsSync(path.join(dest, 'package.json')));
    assert.ok(!fs.existsSync(path.join(dest, 'README.md')));
    assert.equal(fs.readFileSync(path.join(dest, 'src'), 'utf8'), 'user data\n');
  });

  it('documents the exact sample output', () => {
    assert.equal(SAMPLE_OUTPUT, 'வணக்கம், தமிழ்! 36');
  });
});
