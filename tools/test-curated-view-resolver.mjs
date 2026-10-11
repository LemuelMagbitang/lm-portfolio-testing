import assert from 'node:assert/strict';
import { resolveCuratedView, resolveCuratedViewSlug } from '../js/features/curated-views/resolver.js?v=20261011-01';

const mainProjects = [
  { id: 'main-one', title: 'Main One', media: [{ type: 'image', src: 'one.jpg' }] },
  { id: 'main-two', title: 'Main Two', media: [{ type: 'image', src: 'two.jpg' }] },
  { id: 'reserved-main-id', title: 'Keep Main Ownership', media: [{ type: 'image', src: 'three.jpg' }] }
];
const curatedOnly = { id: 'curated-only', title: 'Curated Only', filters: [], media: [{ type: 'image', src: 'curated.jpg' }] };
const views = [{
  id: 'test-portfolio',
  name: 'Test Portfolio',
  slug: 'test-portfolio',
  projects: [
    { source: 'main', projectId: 'main-two' },
    { source: 'curated', project: curatedOnly },
    { source: 'main', projectId: 'main-one' },
    { source: 'main', projectId: 'missing-main-project' },
    { source: 'curated', project: { id: 'reserved-main-id', title: 'Collision must be excluded' } },
    { source: 'curated', project: curatedOnly }
  ]
}];

assert.equal(resolveCuratedViewSlug('#test-portfolio', views), 'test-portfolio');
assert.equal(resolveCuratedViewSlug('#%74est-portfolio', views), 'test-portfolio');
assert.equal(resolveCuratedViewSlug('#unknown-portfolio', views), '');
assert.equal(resolveCuratedViewSlug('#contact-start', views), '');
const resolved = resolveCuratedView({ hash: '#test-portfolio', views, mainProjects });
assert.ok(resolved);
assert.equal(resolved.view.name, 'Test Portfolio');
assert.deepEqual(resolved.projects.map(project => project.id), ['main-two', 'curated-only', 'main-one']);
assert.deepEqual(mainProjects.map(project => project.id), ['main-one', 'main-two', 'reserved-main-id']);
assert.equal(resolveCuratedView({ hash: '#unknown-portfolio', views, mainProjects }), null);
assert.equal(resolveCuratedView({ hash: '#test-portfolio', views: [...views, ...views], mainProjects }), null);
console.log('Public Curated View resolver contracts passed.');
