import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SOCIAL_PLATFORMS, normalizeSiteSettings } from '../js/data/site-settings.js';

const keys = SOCIAL_PLATFORMS.map(platform => platform.key);
assert.equal(new Set(keys).size, keys.length, 'Social platform keys must be unique.');
assert.ok(keys.includes('instagram'));
assert.ok(keys.includes('behance'));
assert.ok(keys.includes('artstation'));
assert.ok(keys.includes('linkedin'));
assert.ok(keys.includes('x'));
assert.ok(keys.includes('facebook'));
assert.ok(keys.includes('dribbble'));
assert.ok(keys.includes('vimeo'));
assert.ok(SOCIAL_PLATFORMS.every(platform => platform.label && platform.icon));

const defaults = normalizeSiteSettings({});
assert.equal(defaults.showHeroMessage, true, 'Hero message should remain visible by default.');
assert.equal(defaults.showFooterMessage, false, 'Footer quote should remain opt-in by default.');
assert.equal(defaults.heroTiming.fadeMs, 600, 'Message fade timing should have a stable default.');
assert.equal(defaults.heroTiming.autoRotateMs, 9000, 'Message loop should rotate by default.');

assert.equal(defaults.interactionFeedback.enabled, false);
assert.equal(defaults.interactionFeedback.hapticsEnabled, false);
assert.equal(defaults.interactionFeedback.navigationSound, 'assets/projects/site/sounds/navigation.wav');
assert.equal(defaults.defaultVideoPoster, '', 'No configured default poster should leave the dark loading surface as the default.');
assert.equal(
  normalizeSiteSettings({ defaultVideoPoster: 'assets/projects/site/banner/hero-poster.webp' }).defaultVideoPoster,
  'assets/projects/site/banner/hero-poster.webp',
  'CMS image paths should be normalized and preserved.'
);
assert.equal(
  normalizeSiteSettings({ defaultVideoPoster: 'https://cdn.example.test/hero-poster' }).defaultVideoPoster,
  'https://cdn.example.test/hero-poster',
  'HTTPS image URLs should be supported.'
);
assert.equal(
  normalizeSiteSettings({ defaultVideoPoster: 'javascript:alert(1)' }).defaultVideoPoster,
  '',
  'Unsafe poster URL schemes must be rejected.'
);
assert.equal(
  normalizeSiteSettings({ defaultVideoPoster: 'assets/%2e%2e/private.webp' }).defaultVideoPoster,
  '',
  'Encoded parent-directory traversal must be rejected.'
);

const feedback = normalizeSiteSettings({ interactionFeedback: {
  enabled: true, soundEnabled: false, hapticsEnabled: true, volume: 0.8,
  navigationSound: 'assets/projects/site/sounds/custom.wav',
  selectionSound: 'javascript:alert(1)'
} }).interactionFeedback;
assert.equal(feedback.enabled, true);
assert.equal(feedback.soundEnabled, false);
assert.equal(feedback.hapticsEnabled, true);
assert.equal(feedback.volume, 0.3);
assert.equal(feedback.navigationSound, 'assets/projects/site/sounds/custom.wav');
assert.equal(feedback.selectionSound, '');
assert.equal(normalizeSiteSettings({
  interactionFeedback: { navigationSound: 'assets/../private/secret.wav' }
}).interactionFeedback.navigationSound, '');

const feedbackSource = await readFile(new URL('../js/features/interaction-feedback/index.js', import.meta.url), 'utf8');
assert.ok(feedbackSource.includes('!event?.isTrusted'));
assert.ok(feedbackSource.includes("audio.preload = 'auto'"));
assert.ok(!feedbackSource.includes('localStorage'), 'Visitor feedback preferences must not persist.');
assert.ok(!feedbackSource.includes('interaction-feedback-toggle'), 'Feedback must not inject a public footer control.');
assert.ok(feedbackSource.includes("root.addEventListener('lm:filter-centered', handleCenteredFilter)"));
assert.ok(feedbackSource.includes('typeof nav?.vibrate === \'function\''));
const compositionSource = await readFile(new URL('../js/app/page-composition.js', import.meta.url), 'utf8');
assert.ok(compositionSource.includes("const routeDocumentTitle = String(root.title || '')"), 'The page composition must capture the route document title before applying shared CMS settings.');
assert.ok(compositionSource.includes('if (isAboutPage && routeDocumentTitle) root.title = routeDocumentTitle;'), 'About must keep its route-specific title while Design may use the CMS site title.');
const heroSource = await readFile(new URL('../js/features/hero/index.js', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('../admin/admin.js', import.meta.url), 'utf8');
assert.ok(compositionSource.includes('defaultVideoPoster: settings.defaultVideoPoster'), 'The composition root must pass the normalized CMS poster setting into the hero.');
assert.ok(heroSource.includes('const posterSource = source.poster || config.defaultVideoPoster;'), 'Per-item posters must take priority over the optional default poster.');
assert.ok(heroSource.includes("if (source.type === 'video' && !hasVideoPoster) {"), 'The dark loading surface should cover only video slides without a configured poster.');
assert.ok(adminSource.includes('id="s_default_video_poster"'), 'The CMS settings section must expose the optional default video poster.');
assert.ok(adminSource.includes("attachMediaBrowseButton(defaultVideoPosterInput, null, { kind: 'image', title: 'Choose default video poster' })"), 'The CMS poster field must provide the image Media Library picker.');
assert.ok(compositionSource.includes('settings.interactionFeedback?.enabled === true'));
assert.ok(compositionSource.includes("import('../features/interaction-feedback/index.js?v=20261018-03')"));
assert.ok(compositionSource.includes("import('../features/gallery/index.js?v=20261030-03')"));

const explicitMessageToggles = normalizeSiteSettings({ showHeroMessage: false, showFooterMessage: true });
assert.equal(explicitMessageToggles.showHeroMessage, false, 'CMS can disable the hero message.');
assert.equal(explicitMessageToggles.showFooterMessage, true, 'CMS can enable the footer message.');
const explicitMessageTiming = normalizeSiteSettings({ heroTiming: { fadeMs: 420, autoRotateMs: 7000 } });
assert.equal(explicitMessageTiming.heroTiming.fadeMs, 420, 'CMS message fade timing must be preserved.');
assert.equal(explicitMessageTiming.heroTiming.autoRotateMs, 7000, 'CMS message rotation timing must be preserved.');
assert.equal(normalizeSiteSettings({ heroTiming: { autoRotateMs: 0 } }).heroTiming.autoRotateMs, 0, 'CMS can explicitly disable message rotation.');

const settings = normalizeSiteSettings({
  contactEmail: 'artist@example.com',
  socials: {
    instagram: 'https://instagram.com/example',
    behance: 'https://www.behance.net/example',
    youtube: '',
    x: 'javascript:alert(1)'
  }
});

assert.equal(settings.socials.instagram, 'https://instagram.com/example');
assert.equal(settings.socials.behance, 'https://www.behance.net/example');
assert.equal(settings.socials.youtube, '');
assert.equal(settings.socials.x, '');
assert.equal(settings.socials.tiktok, '');
assert.equal(settings.contactEmail, 'artist@example.com');

const legacy = normalizeSiteSettings({
  socials: {
    instagram: 'https://instagram.com/legacy',
    tiktok: 'https://tiktok.com/@legacy',
    youtube: 'https://youtube.com/@legacy'
  }
});
assert.equal(legacy.socials.instagram, 'https://instagram.com/legacy');
assert.equal(legacy.socials.tiktok, 'https://tiktok.com/@legacy');
assert.equal(legacy.socials.youtube, 'https://youtube.com/@legacy');

console.log('Site settings contract validated.');
