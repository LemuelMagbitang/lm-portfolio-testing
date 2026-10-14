import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
const policyMatch = source.match(/function cmsUploadNeedsWebP\(file\)\s*\{([\s\S]*?)\n\}/);

assert.ok(policyMatch, 'CMS upload WebP policy must remain explicit.');
const policy = policyMatch[1];
assert.ok(
  policy.includes(String.raw`if(!/\.(jpe?g)$/i.test(name)) return false;`),
  'Only JPEG uploads should be considered for automatic WebP conversion.'
);
assert.doesNotMatch(
  policy,
  /image\/png|png\|jpe?g/i,
  'PNG artwork, transparent assets, and foil masks must be uploaded unchanged.'
);

const conversionGuard = source.indexOf("if(blob.type!=='image/webp' || blob.size>=file.size){");
assert.notEqual(conversionGuard, -1, 'CMS must preserve the original when WebP is unsupported or larger.');
const fallback = source.slice(conversionGuard, conversionGuard + 420);
assert.match(fallback, /cleanup\(\);[\s\S]*?resolve\(\{file,converted:false\}\)/);

console.log('CMS upload conversion policy passed.');
