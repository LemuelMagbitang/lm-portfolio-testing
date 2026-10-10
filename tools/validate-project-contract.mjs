import assert from 'node:assert/strict';
import {
  normalizeProject,
  normalizeProjectMedia,
  normalizeProjects
} from '../js/data/project-normalizer.js?v=20261010-04';

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
    { type: 'future-format', src: 'future.bin' },
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
    { type: 'future-format', src: 'future.bin' }
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

const holographic = normalizeProjectMedia({
  type: 'image',
  src: 'front.png',
  holographic: {
    style: ' IRIDESCENT ',
    intensity: 1.4,
    texture: ' assets/foil.svg ',
    textureMode: ' TILE ',
    back: ' assets/back.png ',
    mask: ' assets/front-mask.png '
  }
});
assert.deepEqual(holographic.holographic, {
  style: 'iridescent',
  intensity: 1,
  glitterLayer: false,
  grainLayer: true,
  texture: 'assets/foil.svg',
  textureMode: 'tile',
  backTextureMode: 'fill',
  back: 'assets/back.png',
  backFoilEnabled: false,
  mask: 'assets/front-mask.png'
});
const supportedHolographicStyles = [
  'holographic',
  'cosmos',
  'brushed',
  'beams',
  'crosshatch',
  'shattered',
  'glitter',
  'waves',
  'cat-eye',
  'iridescent',
  'aurora'
];
for (const style of supportedHolographicStyles) {
  const normalizedStyle = normalizeProjectMedia({
    type: 'image',
    src: style + '.png',
    holographic: { style: ' ' + style.toUpperCase() + ' ', intensity: 0.65 }
  });
  assert.equal(normalizedStyle?.holographic?.style, style,
    'Supported holographic finish "' + style + '" must survive project normalization.');
  assert.equal(normalizedStyle?.holographic?.intensity, 0.65,
    'Supported holographic finish "' + style + '" must retain its configured intensity.');
}
const orphanedBackEffects = normalizeProjectMedia({
  type: 'image',
  src: 'front.png',
  holographic: {
    style: 'aurora',
    backTexture: 'assets/orphaned-back-foil.svg',
    backTextureMode: 'tile',
    backMask: 'assets/orphaned-back-mask.svg'
  }
});
assert.equal(orphanedBackEffects.holographic.style, 'aurora');
assert.equal('back' in orphanedBackEffects.holographic, false);
assert.equal('backTexture' in orphanedBackEffects.holographic, false);
assert.equal('backTextureMode' in orphanedBackEffects.holographic, false);
assert.equal('backMask' in orphanedBackEffects.holographic, false);

const explicitlyDisabledBackFoil = normalizeProjectMedia({
  type: 'image',
  src: 'front.png',
  holographic: { style: 'holographic', back: 'assets/back.png', backTexture: 'assets/back-foil.svg', backFoilEnabled: false }
});
assert.equal(explicitlyDisabledBackFoil.holographic.backFoilEnabled, false,
  'An explicit reverse-side foil opt-out must survive normalization.');
const explicitlyEnabledBackFoil = normalizeProjectMedia({
  type: 'image',
  src: 'front.png',
  holographic: { style: 'holographic', back: 'assets/back.png', backFoilEnabled: true }
});
assert.equal(explicitlyEnabledBackFoil.holographic.backFoilEnabled, true,
  'An explicit reverse-side foil opt-in must survive normalization.');
const legacyBackFoilDefault = normalizeProjectMedia({
  type: 'image',
  src: 'front.png',
  holographic: { style: 'holographic', back: 'assets/back.png', backTexture: 'assets/back-foil.svg' }
});
assert.equal(legacyBackFoilDefault.holographic.backFoilEnabled, true,
  'Legacy records with a back texture must keep their implied reverse-side foil behavior.');

assert.equal(normalizeProjectMedia({
  type: 'image',
  src: 'plain.png',
  holographic: { intensity: -2 }
}).holographic.intensity, 0);

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
