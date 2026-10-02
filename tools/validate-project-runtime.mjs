import assert from 'node:assert/strict';
import { mountProjects } from '../js/features/projects/browser-runtime.js';

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

const missingUrl = await mountProjects({
  documentRef: fakeDocument,
  loadJson: async () => projects,
  buildCard: project => ({ project })
});

assert.equal(missingUrl, false);

console.log('Projects runtime boundary validation passed.');
