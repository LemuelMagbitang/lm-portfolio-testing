/**
 * Project thumbnail renderer.
 *
 * Owns only the visual media element used by a project card thumbnail.
 * Asset resolution is injected so the feature does not know how the site
 * resolves repository-relative paths.
 */

export function mediaTypeFromSrc(src = '') {
  const clean = String(src).split('?')[0].split('#')[0].toLowerCase();
  if (/\.(mp4|webm|mov|m4v|ogv|ogg)$/.test(clean)) return 'video';
  if (/\.json$/.test(clean)) return 'lottie';
  return 'image';
}

export function buildProjectThumbnailMedia(
  source = {},
  altText = 'Project artwork',
  { resolveAssetUrl, documentRef = globalThis.document } = {}
) {
  if (!source?.src || typeof resolveAssetUrl !== 'function') return null;

  const type = String(source.type || mediaTypeFromSrc(source.src));
  const src = resolveAssetUrl(source.src);
  let media;

  if (type === 'video') {
    media = documentRef.createElement('video');
    media.src = src;
    media.muted = true;
    media.loop = true;
    media.autoplay = true;
    media.playsInline = true;
    media.preload = 'metadata';
  } else if (type === 'lottie') {
    media = documentRef.createElement('lottie-player');
    media.setAttribute('src', src);
    media.setAttribute('autoplay', '');
    media.setAttribute('loop', '');
    media.setAttribute('background', 'transparent');
    media.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  } else if (type === 'model') {
    media = documentRef.createElement('div');
    media.className = 'project-thumb-model';
    media.setAttribute('role', 'img');
    media.setAttribute('aria-label', `${altText} — interactive 3D view available`);

    const content = documentRef.createElement('div');
    content.className = 'project-thumb-model-content';

    const icon = documentRef.createElement('i');
    icon.className = 'fa-solid fa-cube';
    icon.setAttribute('aria-hidden', 'true');

    const label = documentRef.createElement('span');
    label.textContent = 'INTERACTIVE 3D';

    const hint = documentRef.createElement('small');
    hint.textContent = 'Open artwork to explore';

    content.append(icon, label, hint);
    media.appendChild(content);
  } else {
    media = documentRef.createElement('img');
    media.src = src;
    media.alt = altText;
    media.loading = 'lazy';
    media.decoding = 'async';
  }

  media.classList.add('project-thumb-media');
  if (type === 'model') media.dataset.modelThumb = String(source.src);
  if (source.background && typeof source.background === 'object') {
    media.dataset.background = JSON.stringify(source.background);
  }

  return media;
}
