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
    orientation: 'portrait',
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
  badges: [],
  filters: ['3d', 'motion'],
  thumbnail: {
    src: 'media/demo.glb',
    type: 'model',
    orientation: 'portrait',
    zoom: 1.25,
    rotate: 90,
    background: { type: 'color', color: '#fff', opacity: 0.8 }
  },
  media: [
    { type: 'image', src: 'art.jpg', orientation: 'portrait' },
    { type: 'image', src: 'fallback.jpg' }
  ],
  mediaCount: 2,
  capabilities: {
    hasImage: true,
    hasVideo: false,
    hasYouTube: false,
    hasLottie: false,
    hasModel: false
  }
});

const multiBadge = normalizeProject({
  id: 'multi-badge',
  badges: [' UI Design ', 'Branding', 'UI Design', ''],
  media: [{ type: 'image', src: 'badge-test.jpg' }]
});
assert.deepEqual(multiBadge.badges, ['UI Design', 'Branding']);
assert.equal(multiBadge.badge, '');

const legacyBadge = normalizeProject({
  id: 'legacy-badge',
  badge: '3D Design',
  media: [{ type: 'image', src: 'legacy-badge.jpg' }]
});
assert.deepEqual(legacyBadge.badges, ['3D Design']);
assert.equal(normalizeProjectMedia({ type: 'youtube', src: 'abc' }).type, 'youtube');
assert.equal(normalizeProjectMedia({ type: 'model', src: 'scene.glb' }).type, 'model');
assert.equal(normalizeProjectMedia({ type: 'image', src: '' }), null);
assert.deepEqual(normalizeProjects({ projects: [{ id: 'a' }, { id: 'b' }] }).map(item => item.id), ['a', 'b']);

const extensible = normalizeProject({
  id: 'extensible-project',
  title: 'Extensible Project',
  extensions: {
    experimentalFeature: { mode: 'storyboard', version: 2 },
    customThemeToken: 'future-ui-token'
  },
  media: [{ type: 'image', src: 'extensible.jpg' }]
});
assert.deepEqual(extensible.extensions, {
  experimentalFeature: { mode: 'storyboard', version: 2 },
  customThemeToken: 'future-ui-token'
});
assert.equal(normalizeProject({ id: 'bad-extensions', extensions: [] }).extensions, undefined);

const mixed = normalizeProject({
  id: 'mixed',
  media: [
    { type: 'video', src: 'clip.mp4' },
    { type: 'youtube', src: 'https://youtu.be/example' },
    { type: 'lottie', src: 'motion.json' },
    { type: 'model', src: 'scene.glb' }
  ]
});
assert.equal(mixed.mediaCount, 4);
assert.deepEqual(mixed.capabilities, {
  hasImage: false,
  hasVideo: true,
  hasYouTube: true,
  hasLottie: true,
  hasModel: true
});
assert.deepEqual(normalizeProjects({ filters: [] }), []);

console.log('Project data contract validated.');
