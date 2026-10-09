/**
 * Project data normalization boundary.
 *
 * This module is deliberately DOM-free and CMS-provider agnostic. It turns
 * the flexible JSON shape accepted by the CMS into a predictable application
 * shape before project features render anything.
 */

const SUPPORTED_MEDIA_TYPES = new Set(['image', 'video', 'youtube', 'lottie', 'model']);
const ORIENTATIONS = new Set(['auto', 'landscape', 'portrait', 'square']);
const HOLOGRAPHIC_STYLES = new Set(['holographic', 'brushed', 'beams', 'crosshatch', 'shattered', 'glitter', 'waves', 'cat-eye', 'iridescent', 'aurora']);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFilters(filters) {
  if (!Array.isArray(filters)) return [];
  return [...new Set(filters.map(normalizeString).filter(Boolean))];
}

function normalizeBadges(badges, legacyBadge = '') {
  const source = Array.isArray(badges) ? badges : (legacyBadge ? [legacyBadge] : []);
  return [...new Set(source.map(normalizeString).filter(Boolean))];
}

function normalizeExtensions(extensions) {
  if (!extensions || typeof extensions !== 'object' || Array.isArray(extensions)) return undefined;
  const normalized = {};
  Object.entries(extensions).forEach(([key, value]) => {
    const name = normalizeString(key);
    if (!name || value === undefined) return;
    normalized[name] = value;
  });
  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeHolographicEffect(effect) {
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)) return undefined;

  const style = normalizeString(effect.style).toLowerCase();
  const intensityValue = Number(effect.intensity);
  const intensity = Number.isFinite(intensityValue)
    ? Math.max(0, Math.min(1, intensityValue))
    : 0.7;
  const texture = normalizeString(effect.texture);
  const textureModeValue = normalizeString(effect.textureMode).toLowerCase();
  const textureMode = ['tile', 'fill'].includes(textureModeValue) ? textureModeValue : 'fill';
  const back = normalizeString(effect.back);
  const mask = normalizeString(effect.mask);
  // Back-side foil settings are meaningful only with a custom reverse image.
  const backTexture = back ? normalizeString(effect.backTexture) : '';
  const backTextureModeValue = normalizeString(effect.backTextureMode).toLowerCase();
  const backTextureMode = ['tile', 'fill'].includes(backTextureModeValue) ? backTextureModeValue : 'fill';
  const backMask = back ? normalizeString(effect.backMask) : '';

  if (!HOLOGRAPHIC_STYLES.has(style) && !texture && !back && !mask && !backTexture && !backMask && effect.intensity === undefined) {
    return undefined;
  }

  return {
    style: HOLOGRAPHIC_STYLES.has(style) ? style : 'holographic',
    intensity,
    textureMode,
    ...(back ? { backTextureMode } : {}),
    ...(texture ? { texture } : {}),
    ...(back ? { back } : {}),
    ...(mask ? { mask } : {}),
    ...(backTexture ? { backTexture } : {}),
    ...(backMask ? { backMask } : {})
  };
}

function normalizeBackground(background) {
  if (!background || typeof background !== 'object' || Array.isArray(background)) return undefined;

  const normalized = {};
  if (normalizeString(background.type)) normalized.type = normalizeString(background.type);
  if (normalizeString(background.color)) normalized.color = normalizeString(background.color);
  if (normalizeString(background.image)) normalized.image = normalizeString(background.image);
  if (Number.isFinite(Number(background.opacity))) normalized.opacity = Number(background.opacity);

  return Object.keys(normalized).length ? normalized : undefined;
}

export function normalizeProjectMedia(media = {}) {
  if (!media || typeof media !== 'object' || Array.isArray(media)) return null;

  const src = normalizeString(media.src);
  if (!src) return null;

  const explicitType = normalizeString(media.type).toLowerCase();
  const inferredType = /\.(mp4|webm|mov|m4v|ogv|ogg)$/.test(src.split('?')[0].split('#')[0].toLowerCase())
    ? 'video'
    : /\.json$/.test(src.split('?')[0].split('#')[0].toLowerCase())
      ? 'lottie'
      : 'image';
  const type = explicitType || inferredType;
  const orientation = normalizeString(media.orientation).toLowerCase();
  const normalized = {
    // Preserve explicit future media types rather than coercing them into
    // images. Current validators still reject unsupported production types,
    // while the normalized contract remains forward-compatible for features
    // that add a renderer later.
    type,
    src
  };

  const caption = normalizeString(media.caption);
  if (caption) normalized.caption = caption;

  if (ORIENTATIONS.has(orientation)) normalized.orientation = orientation;

  const background = normalizeBackground(media.background);
  if (background) normalized.background = background;

  const holographic = normalizeHolographicEffect(media.holographic);
  if (holographic) normalized.holographic = holographic;

  return normalized;
}

export function normalizeProject(project = {}) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) return null;

  const title = normalizeString(project.title);
  const thumbnailSource = project.thumbnail && typeof project.thumbnail === 'object'
    ? project.thumbnail
    : {};
  const thumbnailSrc = normalizeString(thumbnailSource.src);

  const media = Array.isArray(project.media)
    ? project.media.map(normalizeProjectMedia).filter(Boolean)
    : [];

  const capabilities = {
    hasImage: media.some(item => item.type === 'image'),
    hasVideo: media.some(item => item.type === 'video'),
    hasYouTube: media.some(item => item.type === 'youtube'),
    hasLottie: media.some(item => item.type === 'lottie'),
    hasModel: media.some(item => item.type === 'model')
  };

  const extensions = normalizeExtensions(project.extensions);
  const normalized = {
    id: normalizeString(project.id),
    title,
    subtitle: normalizeString(project.subtitle),
    description: normalizeString(project.description),
    badge: normalizeString(project.badge),
    badges: normalizeBadges(project.badges, project.badge),
    filters: normalizeFilters(project.filters),
    thumbnail: {},
    mediaCount: media.length,
    capabilities
  };

  // Extensions are feature-owned content metadata. Keeping them outside the
  // core project shape lets future capabilities add data without forcing the
  // Gallery/Lightbox/presentation contracts to know about that feature.
  if (extensions) normalized.extensions = extensions;

  // Thumbnail presentation controls remain meaningful even when the CMS
  // leaves thumbnail.src empty and the Projects card chooses its first media
  // item automatically as the visible thumbnail.
  if (thumbnailSrc) {
    normalized.thumbnail.src = thumbnailSrc;
  }

  const thumbnailType = normalizeString(thumbnailSource.type).toLowerCase();
  // Preserve an explicitly declared type. If CMS data omits it, leave the
  // field unset so the Projects card runtime can retain extension inference.
  if (SUPPORTED_MEDIA_TYPES.has(thumbnailType)) {
    normalized.thumbnail.type = thumbnailType;
  }

  const focus = normalizeString(thumbnailSource.focus);
  if (focus) normalized.thumbnail.focus = focus;

  const orientation = normalizeString(thumbnailSource.orientation).toLowerCase();
  if (ORIENTATIONS.has(orientation)) normalized.thumbnail.orientation = orientation;

  const zoom = Number(thumbnailSource.zoom);
  if (Number.isFinite(zoom) && zoom > 0) normalized.thumbnail.zoom = zoom;

  const rotate = Number(thumbnailSource.rotate);
  if (Number.isFinite(rotate)) normalized.thumbnail.rotate = rotate;

  const background = normalizeBackground(thumbnailSource.background);
  if (background) normalized.thumbnail.background = background;

  normalized.media = media;
  return normalized;
}

export function normalizeProjects(payload) {
  const list = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.projects) ? payload.projects : []);

  return list.map(normalizeProject).filter(Boolean);
}
