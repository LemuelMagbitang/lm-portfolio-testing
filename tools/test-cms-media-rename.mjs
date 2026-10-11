import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const admin = fs.readFileSync(path.join(root, 'admin/admin.js'), 'utf8');
const start = admin.indexOf('const MEDIA_REFERENCE_FILES = [');
const end = admin.indexOf('async function ghCommitTreeEntries(entries,message){', start);
assert.ok(start >= 0 && end > start, 'Media rename reference list and operation must remain testable together.');
const source = admin.slice(start, end) + '\n({ MEDIA_REFERENCE_FILES, renameMediaFolder })';

const oldPath = 'assets/projects/old';
const newPath = 'assets/projects/new';
const curatedViews = JSON.stringify([{
  id: 'test-view',
  name: 'Test view',
  slug: 'test-view',
  projects: [{
    source: 'curated',
    project: {
      id: 'test-project',
      thumbnail: { type: 'image', src: oldPath + '/thumb.webp' },
      media: [{ type: 'image', src: oldPath + '/art.webp' }]
    }
  }]
}], null, 2);
const footerLoop = JSON.stringify({
  mode: 'manual',
  manual: { src: oldPath + '/footer-animation.json' }
}, null, 2);
const referenceContents = {
  'data/curated-views.json': curatedViews,
  'data/footer-loop.json': footerLoop
};
const blobs = new Map();
const calls = { entries: null, message: '', refreshed: false, toast: [] };
let blobNumber = 0;
const tree = [{
  type: 'blob',
  path: oldPath + '/thumb.webp',
  sha: 'thumb-sha',
  mode: '100644'
}, {
  type: 'blob',
  path: oldPath + '/art.webp',
  sha: 'art-sha',
  mode: '100644'
}, {
  type: 'blob',
  path: oldPath + '/footer-animation.json',
  sha: 'footer-sha',
  mode: '100644'
}];

const GH = {
  async getTextFile(filePath) {
    return { text: referenceContents[filePath] || '{}', sha: 'sha-' + filePath };
  },
  async createBlob(content) {
    blobNumber += 1;
    const sha = 'generated-blob-' + blobNumber;
    blobs.set(sha, content);
    return sha;
  }
};
const cache = {};
const context = {
  GH,
  cache,
  mediaCurrentPath: oldPath,
  mediaPickerPath: oldPath,
  prompt: () => 'new',
  confirm: () => true,
  safeFolderName: value => String(value || '').trim(),
  joinRepoPath: (parent, name) => parent ? parent + '/' + name : name,
  loadMediaTree: async () => tree,
  ghCommitTreeEntries: async (entries, message) => {
    calls.entries = entries;
    calls.message = message;
    return { sha: 'test-commit-sha' };
  },
  setMediaTreeCache: () => { calls.refreshed = true; },
  remapNestedPath: (value, from, to) => value === from || value.startsWith(from + '/')
    ? to + value.slice(from.length)
    : value,
  toast: message => calls.toast.push(message)
};
const harness = vm.runInNewContext(source, context, { filename: 'cms-media-rename.js' });
assert.ok(harness.MEDIA_REFERENCE_FILES.includes('data/curated-views.json'),
  'Folder renames must scan curated-only project thumbnail and media paths.');
assert.ok(harness.MEDIA_REFERENCE_FILES.includes('data/footer-loop.json'),
  'Folder renames must scan the manually selected footer animation source.');

await harness.renameMediaFolder(oldPath, () => {});
assert.ok(Array.isArray(calls.entries), 'Rename should create one tree commit containing moves and reference updates.');

for (const filePath of ['data/curated-views.json', 'data/footer-loop.json']) {
  const entry = calls.entries.find(item => item.path === filePath);
  assert.ok(entry, filePath + ' should be updated in the same commit as moved assets.');
  assert.ok(blobs.has(entry.sha), filePath + ' should point to a replacement blob.');
  const rewritten = blobs.get(entry.sha);
  assert.ok(rewritten.includes(newPath), filePath + ' should contain the new media folder path.');
  assert.ok(!rewritten.includes(oldPath), filePath + ' should not retain the old media folder path.');
}
const rewrittenCurated = JSON.parse(blobs.get(calls.entries.find(item => item.path === 'data/curated-views.json').sha));
assert.equal(rewrittenCurated[0].projects[0].project.thumbnail.src, newPath + '/thumb.webp');
assert.equal(rewrittenCurated[0].projects[0].project.media[0].src, newPath + '/art.webp');
const rewrittenFooter = JSON.parse(blobs.get(calls.entries.find(item => item.path === 'data/footer-loop.json').sha));
assert.equal(rewrittenFooter.manual.src, newPath + '/footer-animation.json');
assert.ok(calls.message.includes(oldPath) && calls.message.includes(newPath));
assert.equal(calls.refreshed, true);

console.log('CMS Media Library folder rename reference contracts passed.');
