/**
 * Site-settings data boundary.
 * Converts flexible CMS settings into a stable runtime configuration.
 * No DOM or vendor dependencies.
 */

const HERO_LOOP_MODES = new Set(['latest', 'manual', 'mixed']);
const HERO_TRANSITIONS = new Set(['kenburns', 'fade', 'none']);

export const DEFAULT_SITE_SETTINGS = Object.freeze({
  protectionEnabled: true,
  formsEnabled: Object.freeze({ project: true, review: true }),
  showReviews: false,
  showSoftwareLogos: false,
  heroTiming: Object.freeze({
    loopMode: 'latest',
    transitionStyle: 'kenburns',
    crossfadeMs: 3500
  }),
  web3forms: Object.freeze({ projectKey: '', reviewKey: '' }),
  redirectUrl: '',
  contactEmail: '',
  socials: Object.freeze({ instagram: '', tiktok: '', youtube: '' }),
  siteTitle: '',
  ogImage: '',
  ogImageVersion: '',
  ogImageAlt: ''
});

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function booleanValue(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeSiteSettings(raw, defaults = DEFAULT_SITE_SETTINGS) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const hero = source.heroTiming && typeof source.heroTiming === 'object'
    ? source.heroTiming
    : {};

  const forms = source.formsEnabled && typeof source.formsEnabled === 'object'
    ? source.formsEnabled
    : {};

  const web3forms = source.web3forms && typeof source.web3forms === 'object'
    ? source.web3forms
    : {};

  const socials = source.socials && typeof source.socials === 'object'
    ? source.socials
    : {};

  const loopMode = HERO_LOOP_MODES.has(hero.loopMode)
    ? hero.loopMode
    : defaults.heroTiming.loopMode;

  const transitionStyle = HERO_TRANSITIONS.has(hero.transitionStyle)
    ? hero.transitionStyle
    : defaults.heroTiming.transitionStyle;

  const numericCrossfade = Number(hero.crossfadeMs);
  const crossfadeMs = Number.isFinite(numericCrossfade) && numericCrossfade >= 500
    ? numericCrossfade
    : defaults.heroTiming.crossfadeMs;

  return {
    protectionEnabled: booleanValue(source.protectionEnabled, defaults.protectionEnabled),
    formsEnabled: {
      project: booleanValue(forms.project, defaults.formsEnabled.project),
      review: booleanValue(forms.review, defaults.formsEnabled.review)
    },
    showReviews: booleanValue(source.showReviews, defaults.showReviews),
    showSoftwareLogos: booleanValue(source.showSoftwareLogos, defaults.showSoftwareLogos),
    heroTiming: {
      loopMode,
      transitionStyle,
      crossfadeMs
    },
    web3forms: {
      projectKey: stringValue(web3forms.projectKey),
      reviewKey: stringValue(web3forms.reviewKey)
    },
    redirectUrl: stringValue(source.redirectUrl),
    contactEmail: stringValue(source.contactEmail),
    socials: {
      instagram: stringValue(socials.instagram),
      tiktok: stringValue(socials.tiktok),
      youtube: stringValue(socials.youtube)
    },
    siteTitle: stringValue(source.siteTitle),
    ogImage: stringValue(source.ogImage),
    ogImageVersion: stringValue(source.ogImageVersion),
    ogImageAlt: stringValue(source.ogImageAlt)
  };
}
