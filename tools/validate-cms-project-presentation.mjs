import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const admin = fs.readFileSync(path.join(root, 'admin/admin.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'admin/admin.css'), 'utf8');
const siteCss = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

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
assert.ok(/holo-style-intensity holo-main-controls/.test(admin) &&
  /<summary>Advanced foil options/.test(admin),
  'CMS foil controls should keep style/strength visible and tuck texture/mask/reverse options into Advanced.');
assert.ok(/data-holo-intensity type="range" min="0" max="1" step="0\.01"/.test(admin) &&
  /Math\.round\(Number\(intensityInput\.value\)\*100\)\+'%'/ .test(admin),
  'CMS foil strength should have fine-grained control and a clear percentage label.');

assert.ok(
  siteCss.includes('url("../assets/holographic/cosmos-bottom.png")') &&
  siteCss.includes('url("../assets/holographic/cosmos-middle-trans.png")') &&
  siteCss.includes('url("../assets/holographic/cosmos-top-trans.png")'),
  'The Cosmos foil profile must use all three uploaded texture maps.');
assert.ok(siteCss.includes('--holo-visual-intensity:calc(var(--holo-intensity,.7) * .68)'),
  'The visual foil intensity must be scaled separately from the CMS value to avoid clipping layered highlights.');
assert.ok(/value="cosmos"/.test(admin) && /Cosmos galaxy foil/.test(admin),
  'CMS holographic style picker must expose the optional Cosmos finish.');
assert.ok(/data-holo-enabled/.test(admin), 'CMS Projects must expose an enable/disable control for holographic images.');
assert.ok(/data-holo-texture/.test(admin) && /data-holo-back/.test(admin),
  'CMS holographic images must support optional texture and back-image sources.');
assert.ok(/data-holo-mask/.test(admin) &&
  /white reveals foil; black hides it\. front only/i.test(admin) &&
  /data-holo-back-mask/.test(admin) &&
  /Leave both settings blank for a clean reverse/i.test(admin),
  'CMS holographic masks must be independent for the front and optional custom back.');
assert.ok(/data-holo-texture-mode/.test(admin) &&
  /Small motifs tile; full-card maps fill the surface/i.test(admin) &&
  /data-holo-back-texture-mode/.test(admin),
  'CMS holographic textures must support independent front/back tile or fill mapping.');
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
