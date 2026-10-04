/**
 * Project-card presentation contract.
 *
 * This module owns only the card's visual-size classification. It does not
 * decide filtering, project order, or grid structure.
 *
 * The runtime intentionally reduces arbitrary media ratios to three bounded
 * presentation tiers so one unusual artwork cannot create an extreme card.
 */

const ORIENTATIONS = new Set(['auto', 'landscape', 'portrait', 'square']);

export function normalizeCardOrientation(value) {
  const orientation = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ORIENTATIONS.has(orientation) ? orientation : 'auto';
}

export function orientationFromAspectRatio(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 'auto';

  const ratio = w / h;
  if (ratio < 0.82) return 'portrait';
  if (ratio > 1.22) return 'landscape';
  return 'square';
}

export function getProjectCardOrientation(
  project = {},
  {
    width = 0,
    height = 0,
    mediaType = ''
  } = {}
) {
  const thumbnail = project?.thumbnail || {};
  const thumbnailOrientation = normalizeCardOrientation(thumbnail.orientation);
  if (thumbnailOrientation !== 'auto') return thumbnailOrientation;

  // An explicit thumbnail is the visual source for the card. Its automatic
  // orientation must be resolved from that thumbnail's own intrinsic media
  // dimensions rather than inherited from another project-media item.
  if (thumbnail.src) {
    if (String(mediaType).toLowerCase() === 'youtube') return 'square';
    return orientationFromAspectRatio(width, height);
  }

  const firstMedia = Array.isArray(project?.media)
    ? project.media.find(item => item?.src)
    : null;
  const mediaOrientation = normalizeCardOrientation(firstMedia?.orientation);
  if (mediaOrientation !== 'auto') return mediaOrientation;

  // YouTube's generic thumbnail service is not a reliable source of Shorts
  // aspect ratio, so never classify a project from those generated previews.
  if (String(mediaType).toLowerCase() === 'youtube') return 'square';

  return orientationFromAspectRatio(width, height);
}

export function applyProjectCardOrientation(card, orientation = 'auto') {
  if (!card?.classList) return 'auto';

  const resolved = normalizeCardOrientation(orientation);
  const presentation = resolved === 'auto' ? 'square' : resolved;

  card.classList.remove(
    'card-orientation-square',
    'card-orientation-landscape',
    'card-orientation-portrait'
  );
  card.classList.add(`card-orientation-${presentation}`);
  card.dataset.cardOrientation = presentation;

  return presentation;
}

/**
 * Bind the card's presentation to the loaded thumbnail's intrinsic dimensions.
 * The listener is attached to the card's resolved thumbnail media, so no
 * document-level observer or gallery state is required.
 */
export function observeProjectCardOrientation(
  card,
  project = {},
  mediaElement,
  {
    mediaType = ''
  } = {}
) {
  if (!card) return () => {};

  const update = () => {
    const elementType = String(mediaElement?.tagName || mediaType || '').toLowerCase();

    if (elementType === 'img') {
      applyProjectCardOrientation(card, getProjectCardOrientation(project, {
        width: mediaElement?.naturalWidth,
        height: mediaElement?.naturalHeight,
        mediaType: elementType
      }));
      return;
    }

    if (elementType === 'video') {
      applyProjectCardOrientation(card, getProjectCardOrientation(project, {
        width: mediaElement?.videoWidth,
        height: mediaElement?.videoHeight,
        mediaType: elementType
      }));
      return;
    }

    applyProjectCardOrientation(card, getProjectCardOrientation(project, {
      mediaType: elementType
    }));
  };

  // Give the card a stable tier immediately, then refine once the browser
  // exposes intrinsic media dimensions.
  update();

  if (!mediaElement?.addEventListener) return () => {};

  const events = [];
  const elementType = String(mediaType || mediaElement?.tagName || '').toLowerCase();
  if (elementType === 'img') events.push('load');
  if (elementType === 'video') events.push('loadedmetadata');

  events.forEach(eventName => mediaElement.addEventListener(eventName, update));

  return () => {
    events.forEach(eventName => mediaElement.removeEventListener?.(eventName, update));
  };
}
