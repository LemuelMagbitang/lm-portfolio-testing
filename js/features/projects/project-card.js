/**
 * Project card view.
 * Owns card DOM construction only. It does not fetch data or manage filtering.
 */

import { findProjectMediaBackground, projectHas3D } from './project-media.js';
import { buildProjectThumbnailMedia, mediaTypeFromSrc } from './project-thumbnail.js';

function getYouTubeId(src = '') {
  const value = String(src).trim();
  const match = value.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/i);
  return match ? match[1] : '';
}

function getFallbackThumbnailSource(project = {}, thumbnail = {}) {
  const media = Array.isArray(project.media) ? project.media : [];
  const presentation = {
    focus: thumbnail.focus || '',
    zoom: thumbnail.zoom,
    rotate: thumbnail.rotate,
    orientation: thumbnail.orientation || ''
  };

  for (const item of media) {
    if (!item?.src) continue;
    const type = String(item.type || mediaTypeFromSrc(item.src)).toLowerCase();
    if (['image', 'video', 'lottie', 'model'].includes(type)) {
      return {
        type,
        src: item.src,
        background: item.background && typeof item.background === 'object' ? item.background : null,
        ...presentation
      };
    }
  }

  const youtube = media.find(item => String(item?.type || '').toLowerCase() === 'youtube' && item?.src);
  const id = youtube ? getYouTubeId(youtube.src) : '';
  return id ? {
    type: 'image',
    src: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    ...presentation
  } : null;
}

export function buildProjectCardElement(
  project = {},
  {
    resolveAssetUrl,
    applyMediaBackground,
    show3DIndicator = true,
    documentRef = globalThis.document,
    onActivate
  } = {}
) {
  const card = documentRef.createElement('div');
  card.className = 'project-card';
  card.dataset.component = 'project-card';
  if (project.id) card.dataset.projectId = String(project.id);

  const capabilities = project.capabilities && typeof project.capabilities === 'object'
    ? project.capabilities
    : {};
  Object.entries(capabilities).forEach(([key, enabled]) => {
    if (!enabled || !key.startsWith('has')) return;
    const type = key.slice(3).toLowerCase();
    if (type) card.classList.add(`has-media-${type}`);
  });
  if (Number(project.mediaCount) > 1) card.classList.add('has-multiple-media');

  const filters = Array.isArray(project.filters) ? project.filters.filter(Boolean) : [];
  card.dataset.filterIds = JSON.stringify(filters);

  if (project.badge) {
    const badges = documentRef.createElement('div');
    badges.className = 'card-badges';
    const span = documentRef.createElement('span');
    span.className = 'badge glass';
    span.textContent = String(project.badge);
    badges.appendChild(span);
    card.appendChild(badges);
  }

  const thumbnail = documentRef.createElement('div');
  thumbnail.className = 'card-thumbnail';
  const explicitThumbnail = project.thumbnail || {};
  const fallbackThumbnail = explicitThumbnail.src
    ? null
    : getFallbackThumbnailSource(project, explicitThumbnail);
  const t = explicitThumbnail.src ? explicitThumbnail : (fallbackThumbnail || explicitThumbnail);
  const inheritedBackground = t.src ? findProjectMediaBackground(project, t.src) : null;
  const background = t.background && typeof t.background === 'object' ? t.background : inheritedBackground;

  if (t.type) thumbnail.dataset.thumbnailType = String(t.type);
  if (t.orientation) thumbnail.dataset.thumbnailOrientation = String(t.orientation);
  if (t.src && typeof resolveAssetUrl === 'function') {
    const media = buildProjectThumbnailMedia(
      { type: t.type || mediaTypeFromSrc(t.src), src: t.src, background },
      project.title || 'Project artwork',
      { resolveAssetUrl, documentRef }
    );
    if (media) {
      // Apply CMS crop/zoom/rotation directly at card-build time. The old
      // monolith performed this as a second pass; the component now owns the
      // presentation contract itself so it also works after responsive
      // remounts and automatic fallback resolution.
      if (t.focus && 'objectPosition' in media.style) {
        media.style.objectPosition = String(t.focus);
        media.style.transformOrigin = String(t.focus);
      }
      if (t.zoom && Number(t.zoom) !== 1) {
        media.style.setProperty('--thumb-zoom', String(t.zoom));
      }
      if (t.rotate) {
        media.style.setProperty('--thumb-rotate', String(t.rotate) + 'deg');
      }
      if (background && typeof background === 'object') thumbnail.dataset.background = JSON.stringify(background);
      if (fallbackThumbnail?.type === 'video') media.setAttribute('data-video-thumb', '');
      if (fallbackThumbnail?.type === 'lottie') media.setAttribute('data-lottie-thumb', '');
      if (fallbackThumbnail?.type === 'model') media.setAttribute('data-model-thumb', '');
      thumbnail.appendChild(media);

      if (background && typeof applyMediaBackground === 'function') {
        Promise.resolve(applyMediaBackground(thumbnail, background, resolveAssetUrl))
          .catch(error => console.warn('Project card: media background could not be applied.', error));
      }
    }
  } else {
    if (t.focus) thumbnail.dataset.focus = String(t.focus);
    if (t.zoom && Number(t.zoom) !== 1) thumbnail.dataset.zoom = String(t.zoom);
    if (t.rotate) thumbnail.dataset.rotate = String(t.rotate);
  }

  if (show3DIndicator && projectHas3D(project)) {
    thumbnail.classList.add('has-3d-view');
    const indicator = documentRef.createElement('div');
    indicator.className = 'card-3d-indicator';
    indicator.innerHTML = '<i class="fa-solid fa-cube" aria-hidden="true"></i><span>3D VIEW AVAILABLE</span>';
    thumbnail.appendChild(indicator);
  }
  card.appendChild(thumbnail);

  const info = documentRef.createElement('div');
  info.className = 'glass-info';
  const title = documentRef.createElement('h3');
  title.textContent = project.title || '';
  const subtitle = documentRef.createElement('p');
  subtitle.textContent = project.subtitle || '';
  info.append(title, subtitle);
  card.appendChild(info);

  // Projects owns card activation semantics. Lightbox receives a small
  // activation contract instead of reaching into the card's DOM itself.
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', project.title ? `Open project: ${project.title}` : 'Open project');

  const activate = event => {
    if (event.type === 'keydown') {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
    }

    let initialMediaIndex = -1;
    if (event.target?.closest?.('.card-thumbnail [data-model-thumb]')) {
      initialMediaIndex = Array.isArray(project.media)
        ? project.media.findIndex(item => item?.type === 'model' && item?.src)
        : -1;
    }

    onActivate?.({ card, project, event, initialMediaIndex });
  };

  card.addEventListener('click', activate);
  card.addEventListener('keydown', activate);

  return card;
}
