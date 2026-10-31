import assert from 'node:assert/strict';
import { preloadAboutAssets } from '../js/features/about/index.js?v=20261031-01';

function createImageDocument() {
  const requested = [];
  return {
    requested,
    documentRef: {
      createElement(tagName) {
        assert.equal(tagName, 'img');
        const image = {
          decoding: '',
          fetchPriority: '',
          onload: null,
          onerror: null,
          async decode() {}
        };
        let source = '';
        Object.defineProperty(image, 'src', {
          get() { return source; },
          set(value) {
            source = String(value || '');
            if (!source) return;
            requested.push(source);
            queueMicrotask(() => image.onload?.());
          }
        });
        return image;
      }
    }
  };
}

const aboutData = {
  photo: { src: 'assets/projects/site/profile.jpg' },
  softwareSkills: ['Blender', 'Krita']
};
const resolveAssetUrl = value => value;

const disabledImages = createImageDocument();
const disabledResult = await preloadAboutAssets({
  data: aboutData,
  documentRef: disabledImages.documentRef,
  resolveAssetUrl
});
assert.deepEqual(disabledImages.requested, ['assets/projects/site/profile.jpg']);
assert.deepEqual(disabledResult, { total: 1, ready: 1 },
  'Disabled logo mode must still warm the profile photo and skip every logo.');

const enabledImages = createImageDocument();
const enabledResult = await preloadAboutAssets({
  data: aboutData,
  documentRef: enabledImages.documentRef,
  resolveAssetUrl,
  includeSoftwareLogos: true
});
assert.equal(enabledResult.total, 3);
assert.equal(enabledResult.ready, 3);
assert.equal(enabledImages.requested.length, 3);
assert.ok(enabledImages.requested.includes('assets/projects/site/profile.jpg'));
assert.ok(enabledImages.requested.includes('assets/projects/site/logos/blender_icon_512x512.webp'));
assert.ok(enabledImages.requested.includes('assets/projects/site/logos/krita.webp'));

console.log('About profile and software-logo preload settings validated.');
