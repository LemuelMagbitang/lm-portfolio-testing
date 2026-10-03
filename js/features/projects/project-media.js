/**
 * Project media primitives.
 * Pure DOM builders for project content; no CMS fetching and no global state.
 */

export function buildMediaItemElement(media = {}, { documentRef = globalThis.document } = {}) {
  const el = documentRef.createElement('div');
  el.className = 'media-item';

  const type = String(media.type || 'image').toLowerCase();
  const src = String(media.src || '');

  if (type === 'video') el.dataset.video = src;
  else if (type === 'youtube') el.dataset.youtube = src;
  else if (type === 'lottie') el.dataset.lottie = src;
  else if (type === 'model') el.dataset.model = src;
  else el.dataset.image = src;

  const description = media.caption ?? media.description;
  if (description) el.dataset.description = String(description);
  if (media.orientation) el.dataset.orientation = String(media.orientation);
  if (media.background && typeof media.background === 'object') {
    el.dataset.background = JSON.stringify(media.background);
  }

  return el;
}

export function findProjectMediaBackground(project, src) {
  if (!project || !src || !Array.isArray(project.media)) return null;
  const match = project.media.find(media => media && media.src === src && media.background && typeof media.background === 'object');
  return match?.background || null;
}

export function projectHas3D(project) {
  return !!(project && Array.isArray(project.media) && project.media.some(media => media && media.type === 'model' && media.src));
}
