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

assert.ok(/function holographicControlHtml\(/.test(admin), 'CMS Projects must expose the holographic image control.');
assert.ok(/data-holo-enabled/.test(admin), 'CMS Projects must expose an enable/disable control for holographic images.');
assert.ok(/data-holo-texture/.test(admin) && /data-holo-back/.test(admin),
  'CMS holographic images must support optional texture and back-image sources.');
assert.ok(/data-holo-mask/.test(admin) &&
  /white reveals foil, black hides it/i.test(admin) &&
  /front only; the back image is never masked/i.test(admin),
  'CMS holographic images must expose a front-only black/white luminance mask with a clear usage hint.');
assert.ok(/attachMediaBrowseButton\(row\.querySelector\('\[data-holo-mask\]'\)/.test(admin),
  'CMS holographic masks must use the existing upload-capable Media Library picker.');
assert.ok(/attachMediaBrowseButton\([^\n]+\n(?:.|\n){0,700}data-holo-texture/.test(admin) ||
  /data-holo-texture/.test(admin) && /kind:\s*'image'/.test(admin),
  'CMS holographic source fields must use the existing Media Library image picker.');
assert.ok(/holographic:normalizeEditorHolographic\(media\.holographic\)/.test(admin),
  'CMS project serialization must preserve per-media holographic settings.');
assert.ok(/m\.holographic/.test(admin),
  'CMS project hydration must preserve per-media holographic settings.');

console.log('CMS Projects presentation contract validated.');
