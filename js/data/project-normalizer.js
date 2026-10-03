/**
 * Project data normalization boundary.
 *
 * This module is deliberately DOM-free and CMS-provider agnostic. It turns
 * the flexible JSON shape accepted by the CMS into a predictable application
 * shape before project features render anything.
 */

const MEDIA_TYPES = new Set(['image', 'video', 'youtube', 'lottie', 'model']);
const ORIENTATIONS = new Set(['auto', 'landscape', 'portrait', 'square']);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeFilters(filters) {
  if (!Array.isArray(filters)) return [];
  return [...new Set(filters.map(normalizeString).filter(Boolean))];
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

  const type = normalizeString(media.type).toLowerCase();
  const orientation = normalizeString(media.orientation).toLowerCase();
  const normalized = {
    type: MEDIA_TYPES.has(type) ? type : 'image',
    src
  };

  const caption = normalizeString(media.caption);
  if (caption) normalized.caption = caption;

  if (ORIENTATIONS.has(orientation)) normalized.orientation = orientation;

  const background = normalizeBackground(media.background);
  if (background) normalized.background = background;

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

  const normalized = {
    id: normalizeString(project.id),
    title,
    subtitle: normalizeString(project.subtitle),
    description: normalizeString(project.description),
    badge: normalizeString(project.badge),
    filters: normalizeFilters(project.filters),
    thumbnail: {}
  };

  if (thumbnailSrc) {
    const thumbnailType = normalizeString(thumbnailSource.type).toLowerCase();
    normalized.thumbnail.src = thumbnailSrc;

    // Preserve an explicitly declared type. If CMS data omits it, leave the
    // field unset so the Projects card runtime can retain the legacy
    // extension-based inference for video/Lottie thumbnails.
    if (MEDIA_TYPES.has(thumbnailType)) {
      normalized.thumbnail.type = thumbnailType;
    }

    const focus = normalizeString(thumbnailSource.focus);
    if (focus) normalized.thumbnail.focus = focus;

    const zoom = Number(thumbnailSource.zoom);
    if (Number.isFinite(zoom) && zoom > 0) normalized.thumbnail.zoom = zoom;

    const rotate = Number(thumbnailSource.rotate);
    if (Number.isFinite(rotate)) normalized.thumbnail.rotate = rotate;

    const background = normalizeBackground(thumbnailSource.background);
    if (background) normalized.thumbnail.background = background;
  }

  normalized.media = media;
  return normalized;
}

export function normalizeProjects(payload) {
  const list = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.projects) ? payload.projects : []);

  return list.map(normalizeProject).filter(Boolean);
}
