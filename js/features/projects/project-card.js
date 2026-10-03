/**
 * Project card view.
 * Owns card DOM construction only. It does not fetch data or manage filtering.
 */

import { buildMediaItemElement, findProjectMediaBackground, projectHas3D } from './project-media.js';
import { buildProjectThumbnailMedia, mediaTypeFromSrc } from './project-thumbnail.js';

function getYouTubeId(src = '') {
  const value = String(src).trim();
  const match = value.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/i);
  return match ? match[1] : '';
}

function getFallbackThumbnailSource(project = {}) {
  const media = Array.isArray(project.media) ? project.media : [];

  for (const item of media) {
    if (!item?.src) continue;
    const type = String(item.type || mediaTypeFromSrc(item.src)).toLowerCase();
    if (['image', 'video', 'lottie', 'model'].includes(type)) {
      return {
        type,
        src: item.src,
        background: item.background && typeof item.background === 'object' ? item.background : null
      };
    }
  }

  const youtube = media.find(item => String(item?.type || '').toLowerCase() === 'youtube' && item?.src);
  const id = youtube ? getYouTubeId(youtube.src) : '';
  return id ? {
    type: 'image',
    src: `https://img.youtube.com/vi/${id}/hqdefault.jpg`
  } : null;
}

export function buildProjectCardElement(
  project = {},
  { resolveAssetUrl, show3DIndicator = true, documentRef = globalThis.document } = {}
) {
  const card = documentRef.createElement('div');
  const filters = Array.isArray(project.filters) ? project.filters.filter(Boolean) : [];
  card.className = ['project-card', ...filters].join(' ');
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
  const fallbackThumbnail = explicitThumbnail.src ? null : getFallbackThumbnailSource(project);
  const t = explicitThumbnail.src ? explicitThumbnail : (fallbackThumbnail || explicitThumbnail);
  const inheritedBackground = t.src ? findProjectMediaBackground(project, t.src) : null;
  const background = t.background && typeof t.background === 'object' ? t.background : inheritedBackground;

  if (explicitThumbnail.type) thumbnail.dataset.thumbnailType = String(explicitThumbnail.type);
  if (t.src && typeof resolveAssetUrl === 'function') {
    const media = buildProjectThumbnailMedia(
      { type: t.type || mediaTypeFromSrc(t.src), src: t.src, background },
      project.title || 'Project artwork',
      { resolveAssetUrl, documentRef }
    );
    if (media) {
      if (t.focus) media.dataset.focus = String(t.focus);
      if (t.zoom && Number(t.zoom) !== 1) media.dataset.zoom = String(t.zoom);
      if (t.rotate) media.dataset.rotate = String(t.rotate);
      if (background && typeof background === 'object') thumbnail.dataset.background = JSON.stringify(background);
      if (fallbackThumbnail?.type === 'video') media.setAttribute('data-video-thumb', '');
      if (fallbackThumbnail?.type === 'lottie') media.setAttribute('data-lottie-thumb', '');
      if (fallbackThumbnail?.type === 'model') media.setAttribute('data-model-thumb', '');
      thumbnail.appendChild(media);
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

  if (project.description) {
    const description = documentRef.createElement('div');
    description.className = 'project-description';
    description.style.display = 'none';
    const text = documentRef.createElement('p');
    text.textContent = project.description;
    description.appendChild(text);
    card.appendChild(description);
  }

  const mediaList = documentRef.createElement('div');
  mediaList.className = 'project-media-list';
  mediaList.style.display = 'none';
  (Array.isArray(project.media) ? project.media : []).forEach(media => {
    if (media?.src) mediaList.appendChild(buildMediaItemElement(media, { documentRef }));
  });
  card.appendChild(mediaList);

  return card;
}
