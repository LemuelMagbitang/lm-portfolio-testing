import assert from 'node:assert/strict';
import {
  normalizeProject,
  normalizeProjectMedia,
  normalizeProjects
} from '../js/data/project-normalizer.js';

const project = normalizeProject({
  id: '  demo-project  ',
  title: '  Demo Project  ',
  subtitle: 42,
  filters: ['3d', '3d', '', ' motion '],
  thumbnail: {
    type: 'MODEL',
    src: ' media/demo.glb ',
    zoom: '1.25',
    rotate: '90',
    background: { type: 'color', color: ' #fff ', opacity: '0.8' }
  },
  media: [
    { type: 'IMAGE', src: 'art.jpg', orientation: 'portrait' },
    { type: 'unsupported', src: 'fallback.jpg' },
    { type: 'video', src: '' },
    null
  ]
});

assert.deepEqual(project, {
  id: 'demo-project',
  title: 'Demo Project',
  subtitle: '',
  description: '',
  badge: '',
  filters: ['3d', 'motion'],
  thumbnail: {
    src: 'media/demo.glb',
    type: 'model',
    zoom: 1.25,
    rotate: 90,
    background: { type: 'color', color: '#fff', opacity: 0.8 }
  },
  media: [
    { type: 'image', src: 'art.jpg', orientation: 'portrait' },
    { type: 'image', src: 'fallback.jpg' }
  ]
});

assert.equal(normalizeProjectMedia({ type: 'youtube', src: 'abc' }).type, 'youtube');
assert.equal(normalizeProjectMedia({ type: 'model', src: 'scene.glb' }).type, 'model');
assert.equal(normalizeProjectMedia({ type: 'image', src: '' }), null);
assert.deepEqual(normalizeProjects({ projects: [{ id: 'a' }, { id: 'b' }] }).map(item => item.id), ['a', 'b']);
assert.deepEqual(normalizeProjects({ filters: [] }), []);

console.log('Project data contract validated.');
