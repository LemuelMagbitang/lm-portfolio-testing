import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
const policyMatch = source.match(/function cmsUploadNeedsWebP\(file\)\s*\{([\s\S]*?)\n\}/);

assert.ok(policyMatch, 'CMS upload WebP policy must remain explicit.');
const policy = policyMatch[1];
assert.ok(
  policy.includes('if(!/\\.(jpe?g)$/i.test(name)) return false;'),
  'Only JPEG uploads should be considered for automatic WebP conversion.'
);
assert.doesNotMatch(
  policy,
  /image\/png|png\|jpe?g/i,
  'PNG artwork, transparent assets, and foil masks must be uploaded unchanged.'
);

const conversionGuard = source.indexOf("if(!blob || blob.type!=='image/webp' || blob.size>=file.size){");
assert.notEqual(conversionGuard, -1, 'CMS must preserve the original when WebP is unsupported or larger.');
const fallback = source.slice(conversionGuard, conversionGuard + 220);
assert.ok(fallback.includes('retainOriginal();'), 'Unsupported or larger conversion results must use the original file.');
assert.ok(
  source.includes("if(typeof URL?.createObjectURL!=='function' || typeof File!=='function'){") &&
    source.includes("return Promise.resolve({file,converted:false});"),
  'Unavailable WebP browser APIs must fall back to the original upload.'
);
assert.ok(
  source.includes('image.onerror=retainOriginal;'),
  'Image decode failure during optional conversion must not block the original upload.'
);
const targetSelection = source.indexOf('const desiredName=conversion.converted');
assert.notEqual(targetSelection, -1, 'Upload filename selection must follow the actual conversion outcome.');
const targetSelectionBlock = source.slice(targetSelection, targetSelection + 260);
assert.ok(
  targetSelectionBlock.includes('? cmsWebPTargetName(job.originalName)') &&
    targetSelectionBlock.includes(': job.originalName;') &&
    targetSelectionBlock.includes('job.targetName=uniqueCmsUploadName(desiredName,reservedNames);'),
  'JPEG fallback must retain its original extension instead of relabeling JPEG bytes as WebP.'
);

console.log('CMS upload conversion policy passed.');
