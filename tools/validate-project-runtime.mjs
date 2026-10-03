import assert from 'node:assert/strict';
import { mountProjects } from '../js/features/projects/browser-runtime.js';
import { getProjectForCard, getCardForProject, getProjects } from '../js/features/projects/project-loader.js';
import { buildProjectCardElement } from '../js/features/projects/project-card.js';

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

console.log('Projects runtime boundary validation passed.');
