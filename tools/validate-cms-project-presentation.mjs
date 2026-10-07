import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const admin = fs.readFileSync(path.join(root, 'admin/admin.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'admin/admin.css'), 'utf8');

for (const marker of [
  "project-list-item",
  "project-card-head",
  "project-collapsed-preview",
  "buildProjectListPreviewHtml(p)",
  "project-card-actions",
  "project-editor-body"
]) {
  assert.ok(admin.includes(marker), `admin.js is missing Projects presentation marker: ${marker}`);
}

for (const marker of [
  ".project-list-item",
  ".project-card-head",
  ".project-collapsed-preview",
  ".project-list-item.is-open .project-collapsed-preview",
  ".project-card-actions"
]) {
  assert.ok(css.includes(marker), `admin.css is missing Projects presentation rule: ${marker}`);
}

assert.ok(/loading="lazy"/.test(admin), 'Collapsed project image previews must be lazy-loaded.');
assert.ok(/decoding="async"/.test(admin), 'Collapsed project image previews must decode asynchronously.');
assert.ok(/computeFallbackThumb\(project\?\.media/.test(admin), 'Collapsed previews must reuse the existing thumbnail fallback contract.');

assert.ok(/let openUid\s*=\s*null/.test(admin), 'Projects must start with every project row closed.');
assert.ok(/isOpen \? ' is-open' : ' is-collapsed'/.test(admin) || /isOpen \? ' is-open' : ' is-collapsed'/.test(admin.replace(/\n/g,'')),
  'Projects renderer must expose explicit open/collapsed row state.');
assert.ok(css.includes('.project-list-item.is-collapsed .project-card-head'),
  'Closed Project rows need a dedicated card-shell header layout.');
assert.ok(css.includes('.project-list-item.is-open .project-card-head'),
  'Expanded Project rows need an explicit original-header layout.');
assert.ok(css.includes('corner-shape:squircle'),
  'CMS Project presentation should progressively enhance rounded surfaces as squircles.');

console.log('CMS Projects presentation contract validated.');
