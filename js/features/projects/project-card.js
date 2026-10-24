/**
 * Project card view.
 * Owns card DOM construction only. It does not fetch data or manage filtering.
 */

import { findProjectMediaBackground } from './project-media.js?v=20261004-03';
import { buildProjectThumbnailMedia, mediaTypeFromSrc } from './project-thumbnail.js?v=20261024-08';
import { observeProjectCardOrientation } from './card-presentation.js?v=20261005-02';

function getFallbackThumbnailSource(project = {}, thumbnail = {}, parseYouTube = null) {
  const media = Array.isArray(project.media) ? project.media : [];
  const presentation = {
    focus: thumbnail.focus || '',
    zoom: thumbnail.zoom,
    rotate: thumbnail.rotate,
    orientation: thumbnail.orientation || '',
    background: thumbnail.background && typeof thumbnail.background === 'object'
      ? thumbnail.background
      : null,
    holographic: thumbnail.holographic && typeof thumbnail.holographic === 'object' && !Array.isArray(thumbnail.holographic)
      ? thumbnail.holographic
      : null
  };

  for (const item of media) {
    if (!item?.src) continue;
    const type = String(item.type || mediaTypeFromSrc(item.src)).toLowerCase();
    if (['image', 'video', 'lottie', 'model'].includes(type)) {
      return {
        ...presentation,
        type,
        src: item.src,
        background: item.background && typeof item.background === 'object'
          ? item.background
          : presentation.background,
        ...(type === 'image' && item.holographic && typeof item.holographic === 'object'
          ? {holographic: item.holographic}
          : (type === 'image' && presentation.holographic ? {holographic: presentation.holographic} : {}))
      };
    }
  }

  const youtube = media.find(item => String(item?.type || '').toLowerCase() === 'youtube' && item?.src);
  const parsed = youtube && typeof parseYouTube === 'function' ? parseYouTube(youtube.src) : null;
  const id = parsed?.id || '';
  return id ? {
    // Keep the source type as YouTube even though the visible fallback is an
    // image. The card-presentation contract uses this metadata to avoid
    // classifying a generated YouTube preview by its unreliable thumbnail
    // aspect ratio (especially for Shorts).
    type: 'youtube',
    src: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    ...presentation
  } : null;
}

function buildProjectThumbnailFoil(holographic = {}, artworkSrc = '', {resolveAssetUrl, documentRef} = {}) {
  if (!holographic || typeof holographic !== 'object' || typeof resolveAssetUrl !== 'function') return null;
  const rawIntensity = holographic.intensity === '' || holographic.intensity == null ? NaN : Number(holographic.intensity);
  const intensity = Number.isFinite(rawIntensity) ? Math.max(0, Math.min(1, rawIntensity)) : 0.7;
  const style = String(holographic.style || 'holographic').trim().toLowerCase();
  const overlay = documentRef.createElement('span');
  overlay.className = 'project-thumb-foil';
  overlay.dataset.holoStyle = ['holographic','cosmos','brushed','beams','crosshatch','shattered','glitter','waves','cat-eye','iridescent','aurora'].includes(style) ? style : 'holographic';
  overlay.setAttribute('aria-hidden','true');
  overlay.style.setProperty('--thumb-holo-intensity',String(intensity));
  const safeUrl = value => String(value || '').replace(/"/g,'%22');
  const texture = holographic.texture ? resolveAssetUrl(holographic.texture) : '';
  const tile = holographic.textureMode === 'tile';
  const layers = [
    'conic-gradient(from 146deg at 34% 26%, #ffe87a 0deg, #adff67 42deg, #47f3ce 86deg, #57cfff 130deg, #8f7bff 176deg, #ef70f5 222deg, #ff75ac 266deg, #ff9a6b 316deg, #ffe87a 360deg)',
    'linear-gradient(124deg, transparent 24%, rgba(0,8,24,.34) 34%, rgba(255,255,255,.04) 39%, rgba(255,255,255,.48) 47%, rgba(174,245,255,.24) 51%, rgba(8,16,40,.16) 58%, transparent 70%)',
    'radial-gradient(ellipse 42% 36% at 34% 26%, rgba(255,255,255,.44), rgba(186,238,255,.12) 38%, transparent 74%)'
  ];
  overlay.style.backgroundImage=[...(texture?['url("'+safeUrl(texture)+'")']:[]),...layers].join(', ');
  overlay.style.backgroundRepeat=[...(texture?[tile?'repeat':'no-repeat']:[]),'no-repeat','no-repeat','no-repeat'].join(', ');
  overlay.style.backgroundSize=[...(texture?[tile?'auto':'100% 100%']:[]),'320% 280%','250% 220%','170% 170%'].join(', ');
  overlay.style.backgroundPosition=[...(texture?[tile?'0 0':'center']:[]),'50% 50%','50% 50%','34% 26%'].join(', ');
  const maskSource = holographic.mask ? resolveAssetUrl(holographic.mask) : (artworkSrc ? resolveAssetUrl(artworkSrc) : '');
  if (maskSource) {
    const image = 'url("'+safeUrl(maskSource)+'")';
    overlay.style.maskImage=image;
    overlay.style.webkitMaskImage=image;
    if (holographic.mask) {
      overlay.style.maskMode='luminance';
      overlay.style.webkitMaskMode='luminance';
    }
  }
  return overlay;
}

export function buildProjectCardElement(
  project = {},
  {
    resolveAssetUrl,
    applyMediaBackground,
    documentRef = globalThis.document,
    onActivate,
    priority = false,
    parseYouTubeUrl = null,
    ensureLottiePlayer = null,
    mountModelViewer = null
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

  const thumbnail = documentRef.createElement('div');
  thumbnail.className = 'card-thumbnail';
  const explicitThumbnail = project.thumbnail || {};
  const fallbackThumbnail = explicitThumbnail.src
    ? null
    : getFallbackThumbnailSource(project, explicitThumbnail, parseYouTubeUrl);
  const t = explicitThumbnail.src ? explicitThumbnail : (fallbackThumbnail || explicitThumbnail);
  const inheritedBackground = t.src ? findProjectMediaBackground(project, t.src) : null;
  const background = t.background && typeof t.background === 'object' ? t.background : inheritedBackground;

  if (t.type) thumbnail.dataset.thumbnailType = String(t.type);
  if (t.orientation) thumbnail.dataset.thumbnailOrientation = String(t.orientation);
  if (t.src && typeof resolveAssetUrl === 'function') {
    const thumbnailMediaType = String(t.type || mediaTypeFromSrc(t.src)).toLowerCase();
    const thumbnailHolographic = thumbnailMediaType === 'image' && t.holographic &&
      typeof t.holographic === 'object' && !Array.isArray(t.holographic) ? t.holographic : null;
    const media = buildProjectThumbnailMedia(
      { type: thumbnailMediaType, src: t.src, background },
      project.title || 'Project artwork',
      { resolveAssetUrl, documentRef, priority, ensureLottiePlayer, mountModelViewer }
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
      if (fallbackThumbnail?.type === 'model' || String(t.type || '').toLowerCase() === 'model') {
        media.setAttribute('data-model-thumb', '');
      }
      thumbnail.appendChild(media);
      if (thumbnailHolographic) {
        const foilOverlay = buildProjectThumbnailFoil(thumbnailHolographic, t.src, {resolveAssetUrl, documentRef});
        if (foilOverlay) {
          thumbnail.appendChild(foilOverlay);
          const revealFoil = () => foilOverlay.classList.add('is-foil-ready');
          const hideFoil = () => foilOverlay.classList.remove('is-foil-ready');
          media.addEventListener?.('load', revealFoil, {once:true});
          media.addEventListener?.('error', hideFoil, {once:true});
          if (media.dataset.mediaState === 'ready' || (media.complete && Number(media.naturalWidth)>0)) revealFoil();
        }
      }
      observeProjectCardOrientation(card, project, media, {
        mediaType: t.type || mediaTypeFromSrc(t.src)
      });
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
    const eventPath = typeof event.composedPath === 'function'
      ? event.composedPath()
      : [];
    const clickedInsideThumbnail =
      eventPath.includes(thumbnail) ||
      event.target?.closest?.('.card-thumbnail') === thumbnail;

    // The clicked node can be a custom element (for example <lottie-player>)
    // or a child inside its shadow/light DOM. Resolve the semantic model target
    // from the thumbnail itself instead of relying only on event.target.closest().
    // This keeps direct-open media intent stable across browser/custom-element
    // event retargeting and also supports multiple model assets by source.
    const modelTarget = clickedInsideThumbnail
      ? thumbnail.querySelector('[data-model-thumb]')
      : null;

    if (modelTarget) {
      const modelSource = String(
        modelTarget.getAttribute('data-model-thumb') || ''
      ).trim();
      const media = Array.isArray(project.media) ? project.media : [];
      initialMediaIndex = media.findIndex(item =>
        String(item?.type || '').toLowerCase() === 'model' &&
        item?.src &&
        (!modelSource || String(item.src).trim() === modelSource)
      );
      if (initialMediaIndex < 0) {
        initialMediaIndex = media.findIndex(item =>
          String(item?.type || '').toLowerCase() === 'model' && item?.src
        );
      }
    }

    onActivate?.({ card, project, event, initialMediaIndex });
  };

  card.addEventListener('click', activate);
  card.addEventListener('keydown', activate);

  return card;
}
