/**
 * Site-settings data boundary.
 * Converts flexible CMS settings into a stable runtime configuration.
 * No DOM or vendor dependencies.
 */

const HERO_LOOP_MODES = new Set(['latest', 'manual', 'mixed']);
const HERO_TRANSITIONS = new Set(['kenburns', 'fade', 'none']);

const DEFAULT_INTERACTION_FEEDBACK = Object.freeze({
  enabled: false,
  soundEnabled: true,
  hapticsEnabled: false,
  volume: 0.12,
  navigationSound: 'assets/projects/site/sounds/navigation.wav',
  selectionSound: 'assets/projects/site/sounds/selection.wav'
});

export const SOCIAL_PLATFORMS = Object.freeze([
  Object.freeze({ key: 'instagram', label: 'Instagram', icon: 'fa-brands fa-instagram' }),
  Object.freeze({ key: 'tiktok', label: 'TikTok', icon: 'fa-brands fa-tiktok' }),
  Object.freeze({ key: 'youtube', label: 'YouTube', icon: 'fa-brands fa-youtube' }),
  Object.freeze({ key: 'behance', label: 'Behance', icon: 'fa-brands fa-behance' }),
  Object.freeze({ key: 'artstation', label: 'ArtStation', icon: 'fa-brands fa-artstation' }),
  Object.freeze({ key: 'linkedin', label: 'LinkedIn', icon: 'fa-brands fa-linkedin-in' }),
  Object.freeze({ key: 'x', label: 'X', icon: 'fa-brands fa-x-twitter' }),
  Object.freeze({ key: 'facebook', label: 'Facebook', icon: 'fa-brands fa-facebook-f' }),
  Object.freeze({ key: 'dribbble', label: 'Dribbble', icon: 'fa-brands fa-dribbble' }),
  Object.freeze({ key: 'vimeo', label: 'Vimeo', icon: 'fa-brands fa-vimeo-v' })
]);

const SOCIAL_PLATFORM_KEYS = new Set(SOCIAL_PLATFORMS.map(platform => platform.key));

export const DEFAULT_SITE_SETTINGS = Object.freeze({
  protectionEnabled: true,
  formsEnabled: Object.freeze({ project: true, review: true }),
  showReviews: false,
  showSoftwareLogos: false,
  showHeroMessage: true,
  showFooterMessage: false,
  interactionFeedback: DEFAULT_INTERACTION_FEEDBACK,
  heroTiming: Object.freeze({
    loopMode: 'latest',
    transitionStyle: 'kenburns',
    crossfadeMs: 3500,
    fadeMs: 600,
    autoRotateMs: 9000,
    kenBurnsFromScale: 1,
    kenBurnsToScale: 1.15,
    kenBurnsDurationS: 14
  }),
  web3forms: Object.freeze({ projectKey: '', reviewKey: '' }),
  redirectUrl: '',
  contactEmail: '',
  socials: Object.freeze({ instagram: '', tiktok: '', youtube: '' }),
  siteTitle: '',
  defaultVideoPoster: '',
  ogImage: '',
  ogImageVersion: '',
  ogImageAlt: ''
});

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeVideoPosterSource(value) {
  const source = stringValue(value);
  const forbidden = source.includes(String.fromCharCode(92))
    || Array.from(source).some(character => character.charCodeAt(0) < 32);
  if (!source || forbidden) return '';
  if (/^https:\/\//i.test(source)) {
    try {
      const url = new URL(source);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch (_) { return ''; }
  }
  if (!source.startsWith('assets/')) return '';
  const localPath = source.split(/[?#]/, 1)[0];
  let decodedPath = localPath;
  try { decodedPath = decodeURIComponent(localPath); }
  catch (_) { return ''; }
  if ([localPath, decodedPath].some(candidate => candidate.split('/').some(part => !part || part === '.' || part === '..'))) return '';
  if (!/\.(?:apng|avif|gif|jpe?g|png|svg|webp)$/i.test(localPath)) return '';
  return source;
}

function booleanValue(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function safeSocialUrl(value) {
  const href = stringValue(value);
  if (!href) return '';
  try {
    const parsed = new URL(href);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.href
      : '';
  } catch (_) {
    return '';
  }
}

function safeSoundSource(value) {
  const source = stringValue(value);
  const forbidden = source.includes(String.fromCharCode(92))
    || Array.from(source).some(character => character.charCodeAt(0) < 32);
  if (!source || forbidden) return '';
  if (/^https:\/\//i.test(source)) {
    try {
      const url = new URL(source);
      return url.protocol === 'https:' ? url.href : '';
    } catch (_) { return ''; }
  }
  if (!source.startsWith('assets/')) return '';
  const localPath = source.split(/[?#]/, 1)[0];
  if (localPath.split('/').some(part => !part || part === '.' || part === '..')) return '';
  if (!/\.(?:wav|mp3|ogg|m4a|aac|flac|webm)$/i.test(localPath)) return '';
  return source;
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
  const feedback = source.interactionFeedback && typeof source.interactionFeedback === 'object'
    && !Array.isArray(source.interactionFeedback) ? source.interactionFeedback : {};
  const feedbackDefaults = defaults.interactionFeedback || DEFAULT_INTERACTION_FEEDBACK;
  const feedbackVolumeInput = Object.prototype.hasOwnProperty.call(feedback, 'volume')
    ? Number(feedback.volume) : Number(feedbackDefaults.volume);
  const feedbackVolume = Number.isFinite(feedbackVolumeInput)
    ? Math.max(0, Math.min(0.3, feedbackVolumeInput))
    : DEFAULT_INTERACTION_FEEDBACK.volume;
  const feedbackSource = key => Object.prototype.hasOwnProperty.call(feedback, key)
    ? safeSoundSource(feedback[key]) : safeSoundSource(feedbackDefaults[key]);

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
  const numericFade = Number(hero.fadeMs);
  const fadeMs = Number.isFinite(numericFade) && numericFade >= 0
    ? numericFade
    : defaults.heroTiming.fadeMs;
  const numericAutoRotate = Number(hero.autoRotateMs);
  const autoRotateMs = Number.isFinite(numericAutoRotate) && numericAutoRotate >= 0
    ? numericAutoRotate
    : defaults.heroTiming.autoRotateMs;

  // Preserve the shared Ken Burns settings consumed by the footer renderer.
  // These values live in settings.json already, so dropping them here would
  // silently reset CMS changes to the renderer's own defaults.
  const numericKenBurnsFrom = Number(hero.kenBurnsFromScale);
  const kenBurnsFromScale = Number.isFinite(numericKenBurnsFrom) && numericKenBurnsFrom > 0
    ? numericKenBurnsFrom
    : (defaults.heroTiming.kenBurnsFromScale ?? 1);
  const numericKenBurnsTo = Number(hero.kenBurnsToScale);
  const kenBurnsToScale = Number.isFinite(numericKenBurnsTo) && numericKenBurnsTo > 0
    ? numericKenBurnsTo
    : (defaults.heroTiming.kenBurnsToScale ?? 1.15);
  const numericKenBurnsDuration = Number(hero.kenBurnsDurationS);
  const kenBurnsDurationS = Number.isFinite(numericKenBurnsDuration) && numericKenBurnsDuration >= 1
    ? numericKenBurnsDuration
    : (defaults.heroTiming.kenBurnsDurationS ?? 14);

  return {
    protectionEnabled: booleanValue(source.protectionEnabled, defaults.protectionEnabled),
    formsEnabled: {
      project: booleanValue(forms.project, defaults.formsEnabled.project),
      review: booleanValue(forms.review, defaults.formsEnabled.review)
    },
    showReviews: booleanValue(source.showReviews, defaults.showReviews),
    showSoftwareLogos: booleanValue(source.showSoftwareLogos, defaults.showSoftwareLogos),
    showHeroMessage: booleanValue(source.showHeroMessage, defaults.showHeroMessage),
    showFooterMessage: booleanValue(source.showFooterMessage, defaults.showFooterMessage),
    interactionFeedback: {
      enabled: booleanValue(feedback.enabled, feedbackDefaults.enabled),
      soundEnabled: booleanValue(feedback.soundEnabled, feedbackDefaults.soundEnabled),
      hapticsEnabled: booleanValue(feedback.hapticsEnabled, feedbackDefaults.hapticsEnabled),
      volume: feedbackVolume,
      navigationSound: feedbackSource('navigationSound'),
      selectionSound: feedbackSource('selectionSound')
    },
    heroTiming: {
      loopMode,
      transitionStyle,
      crossfadeMs,
      fadeMs,
      autoRotateMs,
      kenBurnsFromScale,
      kenBurnsToScale,
      kenBurnsDurationS
    },
    web3forms: {
      projectKey: stringValue(web3forms.projectKey),
      reviewKey: stringValue(web3forms.reviewKey)
    },
    redirectUrl: stringValue(source.redirectUrl),
    contactEmail: stringValue(source.contactEmail),
    socials: Object.fromEntries(
      SOCIAL_PLATFORMS
        .filter(platform => SOCIAL_PLATFORM_KEYS.has(platform.key))
        .map(platform => [
          platform.key,
          Object.prototype.hasOwnProperty.call(socials, platform.key)
            ? safeSocialUrl(socials[platform.key])
            : safeSocialUrl(defaults.socials?.[platform.key])
        ])
    ),
    siteTitle: stringValue(source.siteTitle),
    defaultVideoPoster: safeVideoPosterSource(source.defaultVideoPoster),
    ogImage: stringValue(source.ogImage),
    ogImageVersion: stringValue(source.ogImageVersion),
    ogImageAlt: stringValue(source.ogImageAlt)
  };
}
