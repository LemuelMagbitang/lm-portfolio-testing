import assert from 'node:assert/strict';
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
