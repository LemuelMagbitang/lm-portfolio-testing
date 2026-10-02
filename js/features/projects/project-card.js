/**
 * Project card view.
 * Owns card DOM construction only. It does not fetch data or manage filtering.
 */

import { buildMediaItemElement, findProjectMediaBackground, projectHas3D } from './project-media.js';
import { buildProjectThumbnailMedia } from './project-thumbnail.js';

export function buildProjectCardElement(
  project = {},
  { resolveAssetUrl, show3DIndicator = true } = {}
) {
  const card = document.createElement('div');
  const filters = Array.isArray(project.filters) ? project.filters.filter(Boolean) : [];
  card.className = ['project-card', ...filters].join(' ');
  card.dataset.filterIds = JSON.stringify(filters);

  if (project.badge) {
    const badges = document.createElement('div');
    badges.className = 'card-badges';
    const span = document.createElement('span');
    span.className = 'badge glass';
    span.textContent = String(project.badge);
    badges.appendChild(span);
    card.appendChild(badges);
  }

  const thumbnail = document.createElement('div');
  thumbnail.className = 'card-thumbnail';
  const t = project.thumbnail || {};
  const inheritedBackground = t.src ? findProjectMediaBackground(project, t.src) : null;
  const background = t.background && typeof t.background === 'object' ? t.background : inheritedBackground;

  if (t.type) thumbnail.dataset.thumbnailType = String(t.type);
  if (t.src && typeof resolveAssetUrl === 'function') {
    const media = buildProjectThumbnailMedia(
      { type: t.type || 'image', src: t.src, background },
      project.title || 'Project artwork',
      { resolveAssetUrl }
    );
    if (media) {
      if (t.focus) media.dataset.focus = String(t.focus);
      if (t.zoom && Number(t.zoom) !== 1) media.dataset.zoom = String(t.zoom);
      if (t.rotate) media.dataset.rotate = String(t.rotate);
      if (background && typeof background === 'object') thumbnail.dataset.background = JSON.stringify(background);
      thumbnail.appendChild(media);
    }
  } else {
    if (t.focus) thumbnail.dataset.focus = String(t.focus);
    if (t.zoom && Number(t.zoom) !== 1) thumbnail.dataset.zoom = String(t.zoom);
    if (t.rotate) thumbnail.dataset.rotate = String(t.rotate);
  }

  if (show3DIndicator && projectHas3D(project)) {
    thumbnail.classList.add('has-3d-view');
    const indicator = document.createElement('div');
    indicator.className = 'card-3d-indicator';
    indicator.innerHTML = '<i class="fa-solid fa-cube" aria-hidden="true"></i><span>3D VIEW AVAILABLE</span>';
    thumbnail.appendChild(indicator);
  }
  card.appendChild(thumbnail);

  const info = document.createElement('div');
  info.className = 'glass-info';
  const title = document.createElement('h3');
  title.textContent = project.title || '';
  const subtitle = document.createElement('p');
  subtitle.textContent = project.subtitle || '';
  info.append(title, subtitle);
  card.appendChild(info);

  if (project.description) {
    const description = document.createElement('div');
    description.className = 'project-description';
    description.hidden = true;
    const text = document.createElement('p');
    text.textContent = project.description;
    description.appendChild(text);
    card.appendChild(description);
  }

  const mediaList = document.createElement('div');
  mediaList.className = 'project-media-list';
  mediaList.hidden = true;
  (Array.isArray(project.media) ? project.media : []).forEach(media => {
    if (media?.src) mediaList.appendChild(buildMediaItemElement(media));
  });
  card.appendChild(mediaList);

  return card;
}
