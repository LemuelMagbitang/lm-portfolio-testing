import assert from 'node:assert/strict';
import { mountProjects } from '../js/features/projects/browser-runtime.js';
import { getProjectForCard, getCardForProject, getProjects } from '../js/features/projects/project-loader.js?v=20261008-10';
import { buildProjectCardElement } from '../js/features/projects/project-card.js';
import { getLightboxSwipeDirection } from '../js/features/lightbox/index.js';
import {
  applyProjectCardOrientation,
  getProjectCardOrientation,
  orientationFromAspectRatio,
  observeProjectCardOrientation
} from '../js/features/projects/card-presentation.js';
import { normalizeProjects } from '../js/data/project-normalizer.js?v=20261008-03';
import { parseYouTubeUrl } from '../js/infrastructure/youtube/url.js';
import { siteAssetUrl } from '../js/infrastructure/browser/site-paths.js';

const calls = [];
const children = [];
const fragment = {
  appendChild(node) {
    children.push(node);
    return node;
  }
};

const grid = {
  replaceChildren(next) {
    calls.push(['replaceChildren', next]);
  }
};

const fakeDocument = {
  getElementById(id) {
    assert.equal(id, 'portfolioGrid');
    return grid;
  },
  createDocumentFragment() {
    return fragment;
  }
};

const projects = [
  {
    id: 'runtime-test-project',
    title: 'Runtime Test Project',
    filters: ['3d-motion'],
    media: [
      { type: 'image', src: 'media/test.webp' }
    ]
  }
];

const mounted = await mountProjects({
  url: 'data/projects.json',
  documentRef: fakeDocument,
  loadJson: async url => {
    assert.equal(url, 'data/projects.json');
    return projects;
  },
  resolveAssetUrl: value => `/assets/${value}`,
  buildCard: project => ({ project })
});

assert.equal(mounted, true);
assert.equal(children.length, 1);
assert.equal(children[0].project.id, 'runtime-test-project');
assert.equal(calls.length, 1);
assert.equal(calls[0][0], 'replaceChildren');
assert.equal(calls[0][1], fragment);
assert.deepEqual(getProjectForCard(children[0]), {
  id: 'runtime-test-project',
  title: 'Runtime Test Project',
  subtitle: '',
  description: '',
  badge: '',
  badges: [],
  filters: ['3d-motion'],
  thumbnail: {},
  mediaCount: 1,
  capabilities: {
    hasImage: true,
    hasVideo: false,
    hasYouTube: false,
    hasLottie: false,
    hasModel: false
  },
  media: [{ type: 'image', src: 'media/test.webp' }]
});
assert.equal(getProjectForCard({}), null);
assert.equal(getCardForProject('runtime-test-project'), children[0]);
assert.deepEqual(getProjects().map(project => project.id), ['runtime-test-project']);

const partialBuild = await mountProjects({
  url: 'data/projects.json',
  documentRef: fakeDocument,
  loadJson: async () => [
    ...projects,
    {
      id: 'runtime-test-project-2',
      title: 'Partial Build Project',
      media: [{ type: 'image', src: 'media/test-2.webp' }]
    }
  ],
  resolveAssetUrl: value => `/assets/${value}`,
  buildCard: project => project.id === 'runtime-test-project' ? ({ project }) : null
});

assert.equal(partialBuild, false);
assert.deepEqual(getProjects().map(project => project.id), ['runtime-test-project']);
assert.equal(getCardForProject('runtime-test-project'), children[0]);

const missingUrl = await mountProjects({
  documentRef: fakeDocument,
  loadJson: async () => projects,
  buildCard: project => ({ project })
});

assert.equal(missingUrl, false);


const makeElement = () => ({
  className: '',
  dataset: {},
  children: [],
  attributes: new Map(),
  style: {
    objectPosition: '',
    transformOrigin: '',
    setProperty(name, value) { this[name] = String(value); }
  },
  classList: {
    values: new Set(),
    add(...names) { names.forEach(name => this.values.add(name)); },
    remove(...names) { names.forEach(name => this.values.delete(name)); }
  },
  append(...nodes) { this.children.push(...nodes); },
  appendChild(node) { this.children.push(node); return node; },
  setAttribute(name, value) { this.attributes.set(name, String(value)); },
  addEventListener() {},
  removeEventListener() {},
  textContent: '',
  innerHTML: ''
});

const cardDocument = {
  createElement() {
    return makeElement();
  }
};

const capabilityCard = buildProjectCardElement({
  id: 'capability-regression',
  title: 'Capability Regression',
  filters: ['3d-motion'],
  mediaCount: 2,
  capabilities: {
    hasImage: true,
    hasVideo: false,
    hasYouTube: false,
    hasLottie: false,
    hasModel: true
  },
  thumbnail: { type: 'model', src: 'models/test.glb' },
  media: [
    { type: 'image', src: 'media/test.webp' },
    { type: 'model', src: 'models/test.glb' }
  ]
}, {
  documentRef: cardDocument,
  resolveAssetUrl: value => '/assets/' + value
});

assert.equal(capabilityCard.className, 'project-card');
assert.equal(capabilityCard.classList.values.has('has-media-image'), true);
assert.equal(capabilityCard.classList.values.has('has-media-model'), true);
assert.equal(capabilityCard.classList.values.has('has-multiple-media'), true);
assert.equal(capabilityCard.children[0]?.children[0]?.dataset?.modelThumb, 'models/test.glb');
assert.equal(capabilityCard.children[0]?.children?.length, 1);
assert.equal(capabilityCard.children[0]?.children[0]?.children[0]?.children[1]?.textContent, '3D ARTWORK');
assert.equal(capabilityCard.children[0]?.children[0]?.children[0]?.children[2]?.textContent, 'View project');

const presentationRegressionCard = buildProjectCardElement({
  id: 'presentation-regression',
  title: 'Presentation Regression',
  thumbnail: { type: 'image', src: 'media/presentation.webp', orientation: 'landscape' },
  media: [{ type: 'image', src: 'media/presentation.webp' }]
}, {
  documentRef: cardDocument,
  resolveAssetUrl: value => '/assets/' + value
});
assert.equal(presentationRegressionCard.dataset.cardOrientation, 'landscape');
assert.equal(presentationRegressionCard.classList.values.has('card-orientation-landscape'), true);

assert.equal(orientationFromAspectRatio(1000, 1000), 'square');
assert.equal(orientationFromAspectRatio(1600, 1000), 'landscape');
assert.equal(orientationFromAspectRatio(600, 1000), 'portrait');
assert.equal(orientationFromAspectRatio(0, 1000), 'auto');

assert.equal(getLightboxSwipeDirection(-120, 18), 1);
assert.equal(getLightboxSwipeDirection(120, -14), -1);
assert.equal(getLightboxSwipeDirection(40, 4), 0);
assert.equal(getLightboxSwipeDirection(-120, 110), 0);
assert.equal(getLightboxSwipeDirection(-120, 18, { threshold: 140 }), 0);

assert.equal(getProjectCardOrientation({
  thumbnail: { orientation: 'portrait' },
  media: [{ type: 'image', src: 'media/test.webp', orientation: 'landscape' }]
}), 'portrait');

assert.equal(getProjectCardOrientation({
  thumbnail: { orientation: 'auto' },
  media: [{ type: 'image', src: 'media/test.webp', orientation: 'landscape' }]
}), 'landscape');

assert.equal(getProjectCardOrientation({
  thumbnail: { src: 'media/thumb.webp', orientation: 'auto' },
  media: [{ type: 'image', src: 'media/test.webp', orientation: 'portrait' }]
}, {
  width: 1600,
  height: 1000,
  mediaType: 'image'
}), 'landscape');

assert.equal(getProjectCardOrientation({
  thumbnail: { orientation: 'auto' },
  media: [{ type: 'youtube', src: 'https://www.youtube.com/shorts/test' }]
}, {
  mediaType: 'youtube'
}), 'square');

const youtubeFallbackCard = buildProjectCardElement({
  id: 'youtube-fallback-regression',
  title: 'YouTube Fallback Regression',
  thumbnail: { type: 'image', src: '' },
  media: [{ type: 'youtube', src: 'https://www.youtube.com/shorts/abcdefgh' }]
}, {
  documentRef: cardDocument,
  resolveAssetUrl: value => value,
  parseYouTubeUrl
});
assert.equal(youtubeFallbackCard.children[0]?.dataset?.thumbnailType, 'youtube');
assert.equal(youtubeFallbackCard.dataset.cardOrientation, 'square');

const youtubeIntrinsicMedia = makeElement();
youtubeIntrinsicMedia.tagName = 'IMG';
youtubeIntrinsicMedia.naturalWidth = 1280;
youtubeIntrinsicMedia.naturalHeight = 720;
const youtubeIntrinsicCard = makeElement();

observeProjectCardOrientation(
  youtubeIntrinsicCard,
  {
    thumbnail: { src: '', orientation: 'auto' },
    media: [{ type: 'youtube', src: 'https://www.youtube.com/shorts/abcdefgh' }]
  },
  youtubeIntrinsicMedia,
  { mediaType: 'youtube' }
);

assert.equal(
  youtubeIntrinsicCard.dataset.cardOrientation,
  'square',
  'YouTube fallback thumbnails must stay square even when the fallback image is 16:9'
);

const deferredImageListeners = {};
const deferredImage = {
  tagName: 'IMG',
  naturalWidth: 0,
  naturalHeight: 0,
  addEventListener(name, callback) {
    deferredImageListeners[name] = callback;
  },
  removeEventListener(name) {
    delete deferredImageListeners[name];
  }
};
const deferredImageCard = makeElement();
const disposeDeferredImage = observeProjectCardOrientation(
  deferredImageCard,
  {
    thumbnail: { src: 'media/deferred.webp', orientation: 'auto' },
    media: [{ type: 'image', src: 'media/deferred.webp' }]
  },
  deferredImage,
  { mediaType: 'image' }
);

assert.equal(
  deferredImageCard.dataset.cardOrientation,
  'square',
  'Unloaded image thumbnails should receive a stable square tier before dimensions are available'
);
assert.equal(typeof deferredImageListeners.load, 'function');

deferredImage.naturalWidth = 1600;
deferredImage.naturalHeight = 1000;
deferredImageListeners.load();

assert.equal(
  deferredImageCard.dataset.cardOrientation,
  'landscape',
  'Explicit image thumbnails must refine to their intrinsic landscape tier after <img> load'
);

disposeDeferredImage();
assert.equal(deferredImageListeners.load, undefined);

const fallbackImageListeners = {};
const fallbackImage = {
  tagName: 'IMG',
  naturalWidth: 0,
  naturalHeight: 0,
  addEventListener(name, callback) {
    fallbackImageListeners[name] = callback;
  },
  removeEventListener(name) {
    delete fallbackImageListeners[name];
  }
};
const fallbackImageCard = makeElement();
const disposeFallbackImage = observeProjectCardOrientation(
  fallbackImageCard,
  {
    thumbnail: { src: '', orientation: 'auto' },
    media: [{ type: 'image', src: 'media/fallback-intrinsic.webp' }]
  },
  fallbackImage,
  { mediaType: 'image' }
);

assert.equal(
  fallbackImageCard.dataset.cardOrientation,
  'square',
  'Fallback image thumbnails should receive a stable square tier before dimensions are available'
);
assert.equal(typeof fallbackImageListeners.load, 'function');

fallbackImage.naturalWidth = 1600;
fallbackImage.naturalHeight = 900;
fallbackImageListeners.load();

assert.equal(
  fallbackImageCard.dataset.cardOrientation,
  'landscape',
  'Fallback image thumbnails must refine to the first media item intrinsic landscape tier after load'
);

disposeFallbackImage();
assert.equal(fallbackImageListeners.load, undefined);

const presentationCard = makeElement();
assert.equal(applyProjectCardOrientation(presentationCard, 'landscape'), 'landscape');
assert.equal(presentationCard.dataset.cardOrientation, 'landscape');
assert.equal(presentationCard.classList.values.has('card-orientation-landscape'), true);
assert.equal(presentationCard.classList.values.has('card-orientation-square'), false);


// Regression: projects with no explicit thumbnail src still rely on thumbnail
// focus/zoom/rotation when the first media item becomes the fallback artwork.
const normalizedFallback = normalizeProjects([{
  id: 'fallback-presentation',
  title: 'Fallback Presentation',
  thumbnail: {
    type: 'image',
    src: '',
    focus: '50% 30%',
    zoom: 1.25,
    rotate: 2
  },
  media: [{ type: 'image', src: 'media/fallback.webp' }]
}])[0];

assert.deepEqual(normalizedFallback.thumbnail, {
  type: 'image',
  focus: '50% 30%',
  zoom: 1.25,
  rotate: 2
});

let fallbackBackgroundCalls = 0;
const fallbackCard = buildProjectCardElement(normalizedFallback, {
  documentRef: cardDocument,
  resolveAssetUrl: value => '/assets/' + value,
  applyMediaBackground: (element, background) => {
    fallbackBackgroundCalls += 1;
    assert.equal(element.className, 'card-thumbnail');
    assert.deepEqual(background, { type: 'color', color: '#222222' });
    return Promise.resolve(true);
  }
});

// Gallery cards no longer render a separate 3D availability badge.
const fallbackThumbnail = fallbackCard.children[0];
const fallbackMedia = fallbackThumbnail.children[0];
assert.equal(fallbackMedia.style.objectPosition, '50% 30%');
assert.equal(fallbackMedia.style.transformOrigin, '50% 30%');
assert.equal(fallbackMedia.style['--thumb-zoom'], '1.25');
assert.equal(fallbackMedia.style['--thumb-rotate'], '2deg');
assert.equal(fallbackBackgroundCalls, 0);

const normalizedThumbnailBackground = normalizeProjects([{
  id: 'fallback-thumbnail-background',
  title: 'Fallback Thumbnail Background',
  thumbnail: {
    src: '',
    background: { type: 'color', color: '#111111' }
  },
  media: [{
    type: 'image',
    src: 'media/fallback-thumbnail-background.webp'
  }]
}])[0];

let thumbnailBackgroundCalls = 0;
buildProjectCardElement(normalizedThumbnailBackground, {
  documentRef: cardDocument,
  resolveAssetUrl: value => '/assets/' + value,
  applyMediaBackground: (element, background) => {
    thumbnailBackgroundCalls += 1;
    assert.equal(element.className, 'card-thumbnail');
    assert.deepEqual(background, { type: 'color', color: '#111111' });
  }
});

assert.equal(
  thumbnailBackgroundCalls,
  1,
  'Thumbnail background should survive when the first media item supplies the fallback thumbnail'
);

const normalizedBackground = normalizeProjects([{
  id: 'fallback-background',
  title: 'Fallback Background',
  thumbnail: {
    src: '',
    focus: '50% 50%',
    zoom: 1
  },
  media: [{
    type: 'image',
    src: 'media/background.webp',
    background: { type: 'color', color: '#222222' }
  }]
}])[0];

let mediaBackgroundCalls = 0;
buildProjectCardElement(normalizedBackground, {
  documentRef: cardDocument,
  resolveAssetUrl: value => '/assets/' + value,
  applyMediaBackground: (element, background) => {
    mediaBackgroundCalls += 1;
    assert.equal(element.className, 'card-thumbnail');
    assert.deepEqual(background, { type: 'color', color: '#222222' });
    return Promise.resolve(true);
  }
});
assert.equal(mediaBackgroundCalls, 1);

const normalizedBackgroundPrecedence = normalizeProjects([{
  id: 'fallback-background-precedence',
  title: 'Fallback Background Precedence',
  thumbnail: {
    src: '',
    background: { type: 'color', color: '#111111' }
  },
  media: [{
    type: 'image',
    src: 'media/background-precedence.webp',
    background: { type: 'color', color: '#222222' }
  }]
}])[0];

let precedenceBackground = null;
buildProjectCardElement(normalizedBackgroundPrecedence, {
  documentRef: cardDocument,
  resolveAssetUrl: value => '/assets/' + value,
  applyMediaBackground: (element, background) => {
    precedenceBackground = background;
    return Promise.resolve(true);
  }
});

assert.deepEqual(
  precedenceBackground,
  { type: 'color', color: '#222222' },
  'Media background should override thumbnail background when the media item is the fallback source'
);

assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/watch?v=abcdefgh'), {
  id: 'abcdefgh',
  isShort: false
});
assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/shorts/abcdefgh?si=test'), {
  id: 'abcdefgh',
  isShort: true
});
assert.deepEqual(parseYouTubeUrl('https://youtu.be/abcdefgh'), {
  id: 'abcdefgh',
  isShort: false
});
assert.deepEqual(parseYouTubeUrl('https://example.com/watch?v=abcdefgh'), {
  id: null,
  isShort: false
});
assert.deepEqual(parseYouTubeUrl('not-a-url'), {
  id: null,
  isShort: false
});

const pathDocument = {
  baseURI: 'https://example.com/portfolio/',
  scripts: []
};
const pathWindow = {
  location: { href: 'https://example.com/portfolio/' }
};
const pathOptions = { documentRef: pathDocument, windowRef: pathWindow };

assert.equal(
  siteAssetUrl('assets/artwork.webp', pathOptions),
  'https://example.com/portfolio/assets/artwork.webp'
);
assert.equal(
  siteAssetUrl('https://cdn.example.com/artwork.webp', pathOptions),
  'https://cdn.example.com/artwork.webp'
);
assert.equal(
  siteAssetUrl('//cdn.example.com/artwork.webp', pathOptions),
  '//cdn.example.com/artwork.webp'
);
assert.equal(
  siteAssetUrl('data:image/png;base64,AAA', pathOptions),
  'data:image/png;base64,AAA'
);
assert.equal(siteAssetUrl('javascript:alert(1)', pathOptions), '');
assert.equal(siteAssetUrl('vbscript:msgbox(1)', pathOptions), '');
assert.equal(siteAssetUrl('ftp://example.com/file.zip', pathOptions), '');
assert.equal(siteAssetUrl('file:///etc/passwd', pathOptions), '');

console.log('Projects runtime boundary validation passed.');
