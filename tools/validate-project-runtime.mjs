import assert from 'node:assert/strict';
import { mountProjects } from '../js/features/projects/browser-runtime.js';
import { getProjectForCard, getCardForProject, getProjects } from '../js/features/projects/project-loader.js';
import { buildProjectCardElement } from '../js/features/projects/project-card.js';
import {
  applyProjectCardOrientation,
  getProjectCardOrientation,
  orientationFromAspectRatio
} from '../js/features/projects/card-presentation.js';
import { normalizeProjects } from '../js/data/project-normalizer.js';
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

assert.equal(orientationFromAspectRatio(1000, 1000), 'square');
assert.equal(orientationFromAspectRatio(1600, 1000), 'landscape');
assert.equal(orientationFromAspectRatio(600, 1000), 'portrait');
assert.equal(orientationFromAspectRatio(0, 1000), 'auto');

assert.equal(getProjectCardOrientation({
  thumbnail: { orientation: 'portrait' },
  media: [{ type: 'image', src: 'media/test.webp', orientation: 'landscape' }]
}), 'portrait');

assert.equal(getProjectCardOrientation({
  thumbnail: { orientation: 'auto' },
  media: [{ type: 'image', src: 'media/test.webp', orientation: 'landscape' }]
}), 'landscape');

assert.equal(getProjectCardOrientation({
  thumbnail: { orientation: 'auto' },
  media: [{ type: 'youtube', src: 'https://www.youtube.com/shorts/test' }]
}, {
  mediaType: 'youtube'
}), 'square');

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

let backgroundCalls = 0;
const fallbackCard = buildProjectCardElement(normalizedFallback, {
  documentRef: cardDocument,
  resolveAssetUrl: value => '/assets/' + value,
  applyMediaBackground: (element, background) => {
    backgroundCalls += 1;
    assert.equal(element.className, 'card-thumbnail');
    assert.deepEqual(background, { type: 'color', color: '#222222' });
    return Promise.resolve(true);
  }
});

// No badge means the thumbnail is the first card child.
const fallbackThumbnail = fallbackCard.children[0];
const fallbackMedia = fallbackThumbnail.children[0];
assert.equal(fallbackMedia.style.objectPosition, '50% 30%');
assert.equal(fallbackMedia.style.transformOrigin, '50% 30%');
assert.equal(fallbackMedia.style['--thumb-zoom'], '1.25');
assert.equal(fallbackMedia.style['--thumb-rotate'], '2deg');
assert.equal(backgroundCalls, 0);

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

buildProjectCardElement(normalizedBackground, {
  documentRef: cardDocument,
  resolveAssetUrl: value => '/assets/' + value,
  applyMediaBackground: (element, background) => {
    backgroundCalls += 1;
    assert.equal(element.className, 'card-thumbnail');
    assert.deepEqual(background, { type: 'color', color: '#222222' });
    return Promise.resolve(true);
  }
});
assert.equal(backgroundCalls, 1);

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
