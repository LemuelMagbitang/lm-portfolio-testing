import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const admin = fs.readFileSync(path.join(root, 'admin/admin.js'), 'utf8');
const saveStart = admin.indexOf('async function saveSectionsAtomic(files, message){');
const saveEnd = admin.indexOf('\n\n/* =====================================================================\n   6. RENDER ROUTER', saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, 'Atomic save helper must remain a self-contained unit.');
const saveSource = admin.slice(saveStart, saveEnd);

const commitStart = admin.indexOf('async commitFiles(files, message){');
const commitEnd = admin.indexOf('\n  async uploadBinary(', commitStart);
assert.ok(commitStart >= 0 && commitEnd > commitStart, 'GitHub atomic commit method must remain a self-contained unit.');
const commitSource = admin.slice(commitStart, commitEnd);

assert.match(admin, /async getFile\(path, ref=conn\.branch\)/,
  'GH.getFile must support reading a file from the exact parent commit.');
assert.match(commitSource, /GH\.getFile\(file\.path, parentSha\)/,
  'Atomic writes must compare expected file SHAs against their captured parent commit.');
assert.match(commitSource, /hasOwnProperty\.call\(file, 'expectedSha'\)/,
  'The atomic commit must distinguish absent preconditions from an explicitly missing file.');
assert.match(saveSource, /expectedSha: previous\.sha \?\? null/,
  'Atomic saves must pass the cached base SHA as a write precondition.');
assert.match(admin, /body:JSON\.stringify\(\{sha:commitSha,force:false\}\)/,
  'Atomic writes must retain non-forced branch updates.');
assert.match(saveSource, /JSON\.stringify\(fresh\.json\) !== JSON\.stringify\(parsed\)/,
  'Post-save verification must detect a newer write before pairing JSON with its SHA.');

const slash = String.fromCharCode(92);
for (const expression of [
  'JSON.stringify(obj.items||[],null,2)',
  'JSON.stringify(next,null,2)'
]) {
  assert.equal(admin.includes(expression + "+'" + slash + slash + "n'"), false,
    'Atomic JSON content must not use a literal backslash-n suffix.');
  assert.equal(admin.includes(expression + "+'" + slash + "n'"), true,
    'Atomic JSON content must use the actual newline escape used by other CMS saves.');
}

function makeHarness({freshFile, refreshError = null}) {
  const cache = { hero: { json: { title: 'before' }, sha: 'base-sha', missing: false } };
  const dirty = { hero: true };
  const calls = { files: null, dotUpdates: 0 };
  const GH = {
    async commitFiles(files, message) {
      calls.files = files;
      calls.message = message;
      return { sha: 'saved-commit-sha' };
    },
    async getFile(filePath) {
      if (refreshError) throw refreshError;
      assert.equal(filePath, 'data/hero.json');
      return freshFile;
    }
  };
  const updateDirtyDots = () => { calls.dotUpdates += 1; };
  const fn = vm.runInNewContext(saveSource + '\nsaveSectionsAtomic', {
    GH, cache, dirty, updateDirtyDots
  }, { filename: 'cms-atomic-save.js' });
  return { fn, cache, dirty, calls };
}

const intended = { title: 'after' };
const serialized = JSON.stringify(intended, null, 2) + '\n';
const success = makeHarness({
  freshFile: { json: intended, sha: 'saved-file-sha', missing: false }
});
assert.equal(await success.fn([
  { name: 'hero', path: 'data/hero.json', content: serialized, encoding: 'utf-8' }
], 'CMS: test atomic save'), 'saved-commit-sha');
assert.equal(success.calls.files[0].expectedSha, 'base-sha');
assert.equal(JSON.stringify(success.cache.hero.json), JSON.stringify(intended));
assert.equal(success.cache.hero.sha, 'saved-file-sha');
assert.equal(success.dirty.hero, false);
assert.equal(success.calls.dotUpdates, 1);

const raced = makeHarness({
  freshFile: { json: { title: 'changed in another tab' }, sha: 'newer-file-sha', missing: false }
});
await assert.rejects(
  raced.fn([{ name: 'hero', path: 'data/hero.json', content: serialized }], 'CMS: simulated race'),
  /commit was created.*different content.*Reload the CMS/i
);
assert.equal(raced.cache.hero.sha, 'base-sha',
  'A newer SHA must never be cached alongside this editor’s older JSON.');
assert.equal(JSON.stringify(raced.cache.hero.json), JSON.stringify({ title: 'before' }));
assert.equal(raced.dirty.hero, true,
  'A detected post-commit conflict must leave the editor dirty.');
assert.equal(raced.calls.dotUpdates, 1);

const unavailable = makeHarness({
  freshFile: null,
  refreshError: new Error('temporary GitHub read failure')
});
await assert.rejects(
  unavailable.fn([{ name: 'hero', path: 'data/hero.json', content: serialized }], 'CMS: simulated refresh error'),
  /temporary GitHub read failure/
);
assert.equal(unavailable.cache.hero.sha, 'base-sha');
assert.equal(unavailable.dirty.hero, true,
  'A failed verification read must not mark the editor as saved.');
assert.equal(unavailable.calls.dotUpdates, 1);

// Exercise the actual GitHub atomic-commit method with mocked network methods:
// a stale cached blob SHA must abort before any commit object is created.
async function runCommitPrecondition(currentSha, expectedSha) {
  const trace = { headReads: 0, refs: [], blobs: 0, branchUpdates: 0 };
  const conn = { owner: 'test-owner', repo: 'test-repo', branch: 'projects-runtime-cutover' };
  const GH = {
    async getBranchHead() { trace.headReads += 1; return 'parent-commit-sha'; },
    async getFile(filePath, ref) {
      trace.refs.push({ filePath, ref });
      return { json: {}, sha: currentSha, missing: currentSha == null };
    },
    async createBlob() { trace.blobs += 1; return 'new-blob-sha'; },
    async createTree() { return 'new-tree-sha'; },
    async createCommit() { return { sha: 'new-commit-sha' }; },
    async updateBranch() { trace.branchUpdates += 1; return { sha: 'new-commit-sha' }; }
  };
  const sandbox = {
    GH, conn,
    assertCmsWritablePath: value => value,
    authHeaders: () => ({}),
    githubFetch: async () => ({ ok: true, json: async () => ({ tree: { sha: 'parent-tree-sha' } }) })
  };
  const method = vm.runInNewContext('({' + commitSource + '}).commitFiles', sandbox,
    { filename: 'cms-github-commit.js' });
  GH.commitFiles = method;
  try {
    const result = await GH.commitFiles([
      { path: 'data/projects.json', content: '{}\n', expectedSha }
    ], 'CMS: simulated commit');
    return { trace, result };
  } catch (error) {
    return { trace, error };
  }
}

const commitOkay = await runCommitPrecondition('expected-blob-sha', 'expected-blob-sha');
assert.equal(commitOkay.result.sha, 'new-commit-sha');
assert.equal(commitOkay.trace.refs.length, 1);
assert.deepEqual(commitOkay.trace.refs[0], {
  filePath: 'data/projects.json',
  ref: 'parent-commit-sha'
});
assert.equal(commitOkay.trace.blobs, 1);
assert.equal(commitOkay.trace.branchUpdates, 1);
assert.equal(commitOkay.trace.headReads, 2);

const commitConflict = await runCommitPrecondition('newer-blob-sha', 'expected-blob-sha');
assert.match(commitConflict.error.message, /repository changed since this editor loaded.*Reload the CMS/i);
assert.equal(commitConflict.trace.blobs, 0,
  'A stale precondition must reject before any file blob is created.');
assert.equal(commitConflict.trace.branchUpdates, 0,
  'A stale precondition must not update the branch ref.');
assert.equal(commitConflict.trace.headReads, 1);

console.log('CMS atomic-save conflict handling contracts passed.');
