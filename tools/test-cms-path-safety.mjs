import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const admin = fs.readFileSync(path.join(root, 'admin/admin.js'), 'utf8');
const start = admin.indexOf('function hasUnsafeCmsPathSegments(');
const end = admin.indexOf('\nfunction githubFetch(', start);
assert.ok(start >= 0 && end > start, 'CMS path safety helpers must remain a self-contained synchronous boundary.');

const helperSource = admin.slice(start, end);
const helpers = vm.runInNewContext(
  helperSource + '\n({ hasUnsafeCmsPathSegments, normalizeCmsPath, apiPath, isCmsWritablePath, assertCmsWritablePath })',
  {},
  { filename: 'admin-cms-path-safety.js' }
);

const sectionStart = admin.indexOf('const SECTIONS = {');
const sectionEnd = admin.indexOf('\n};', sectionStart);
assert.ok(sectionStart >= 0 && sectionEnd > sectionStart, 'CMS section file map must remain a readable static contract.');
const sections = vm.runInNewContext(
  admin.slice(sectionStart, sectionEnd + 3) + '\nSECTIONS',
  {},
  { filename: 'admin-cms-sections.js' }
);
for (const [name, section] of Object.entries(sections)) {
  assert.equal(
    helpers.isCmsWritablePath(section.file),
    true,
    'CMS section "' + name + '" must allow writes to ' + section.file
  );
}

for (const path of ['admin/index.html', 'admin/admin.css', 'admin/admin.js']) {
  assert.equal(
    helpers.isCmsWritablePath(path),
    false,
    'CMS must not be able to overwrite its own admin shell or controller: ' + path
  );
}

for (const value of [
  '../data/projects.json',
  'assets/../data/projects.json',
  'assets/../../admin/admin.js',
  'assets\\..\\data\\projects.json',
  'assets/%2e%2e/data/projects.json',
  'assets%2F%2e%2e%2Fdata/projects.json',
  'assets/%252e%252e/data/projects.json',
  'assets/%25252e%25252e/data/projects.json',
  'assets/%2e%2e%5cdata/projects.json',
  'assets/%00/hidden.webp'
]) {
  assert.equal(helpers.hasUnsafeCmsPathSegments(value), true, 'Traversal/control path should be rejected: ' + value);
  assert.equal(helpers.normalizeCmsPath(value), null, 'Unsafe CMS path must not normalize: ' + value);
  assert.equal(helpers.isCmsWritablePath(value), false, 'Unsafe path must not pass the write allowlist: ' + value);
  assert.throws(() => helpers.assertCmsWritablePath(value), /CMS write blocked/, 'Unsafe write should throw: ' + value);
  assert.throws(() => helpers.apiPath(value), /Invalid GitHub repository path/, 'Unsafe API path should throw: ' + value);
}

for (const [input, expected] of [
  ['assets/project-art/cover.webp', 'assets/project-art/cover.webp'],
  ['/assets/project-art/cover.webp', 'assets/project-art/cover.webp'],
  ['assets\\project-art\\cover.webp', 'assets/project-art/cover.webp'],
  ['data/projects.json', 'data/projects.json'],
  ['assets//project-art///cover.webp', 'assets/project-art/cover.webp']
]) {
  assert.equal(helpers.normalizeCmsPath(input), expected, 'Valid path should normalize: ' + input);
}

assert.equal(helpers.isCmsWritablePath('assets/project-art/cover.webp'), true);
assert.equal(helpers.isCmsWritablePath('data/projects.json'), true);
assert.equal(helpers.isCmsWritablePath('admin/admin.js'), false);
assert.equal(helpers.assertCmsWritablePath('/data/projects.json'), 'data/projects.json');
assert.equal(helpers.apiPath('assets/project art/cover image.webp'), 'assets/project%20art/cover%20image.webp');
assert.equal(helpers.apiPath('assets/%ZZ/file.webp'), 'assets/%25ZZ/file.webp',
  'A literal percent sign must be encoded as a filename character, not treated as URL syntax.');

assert.match(admin, /file\?\.mode !== undefined && file\.mode !== '100644'/,
  'Git tree saves must reject symlink/executable modes supplied by a caller.');
assert.match(admin, /return \{ \.\.\.file, path: safePath, mode: '100644' \};/,
  'Git tree writes must use normalized paths and regular-file mode only.');

console.log('CMS path traversal and write-boundary contracts passed.');
