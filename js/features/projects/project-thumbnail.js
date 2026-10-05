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
  { resolveAssetUrl, documentRef = globalThis.document, priority = false } = {}
) {
  if (!source?.src || typeof resolveAssetUrl !== 'function') return null;

  const type = String(source.type || mediaTypeFromSrc(source.src));
  const src = resolveAssetUrl(source.src);
  let media;

  if (type === 'video') {
    media = documentRef.createElement('video');
    media.muted = true;
    media.loop = true;
    media.autoplay = true;
    media.playsInline = true;
    media.preload = priority ? 'auto' : 'metadata';
    if (priority) media.fetchPriority = 'high';
    media.src = src;
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
    media.setAttribute('aria-label', `${altText} — 3D artwork`);

    const content = documentRef.createElement('div');
    content.className = 'project-thumb-model-content';

    const icon = documentRef.createElement('i');
    icon.className = 'fa-solid fa-cube';
    icon.setAttribute('aria-hidden', 'true');

    const label = documentRef.createElement('span');
    label.textContent = '3D ARTWORK';

    const hint = documentRef.createElement('small');
    hint.textContent = 'View project';

    content.append(icon, label, hint);
    media.appendChild(content);
  } else {
    media = documentRef.createElement('img');
    media.alt = altText;
    media.loading = priority ? 'eager' : 'lazy';
    media.decoding = 'async';
    if (priority) media.fetchPriority = 'high';
    media.src = src;
  }

  media.classList.add('project-thumb-media');
  if (type === 'model') media.dataset.modelThumb = String(source.src);
  if (source.background && typeof source.background === 'object') {
    media.dataset.background = JSON.stringify(source.background);
  }

  return media;
}


/**
 * Wait for the actual initial gallery thumbnail tier to have usable browser
 * media metadata. This keeps startup responsibility at the Projects boundary
 * instead of coupling the global loading gate to visual implementation details.
 */
export async function waitForProjectThumbnailReadiness(
  cards = [],
  {
    count = 6,
    timeoutMs = 2200,
    windowRef = globalThis.window
  } = {}
) {
  const targets = (Array.isArray(cards) ? cards : [])
    .slice(0, Math.max(0, Number(count) || 0))
    .map(card => card?.querySelector?.('.card-thumbnail img, .card-thumbnail video'))
    .filter(Boolean);

  if (!targets.length) return true;

  const waitForTarget = target => new Promise(resolve => {
    let settled = false;
    let timer = null;

    const finish = ready => {
      if (settled) return;
      settled = true;
      if (timer !== null) windowRef?.clearTimeout?.(timer);
      target.removeEventListener?.('load', onReady);
      target.removeEventListener?.('loadeddata', onReady);
      target.removeEventListener?.('canplay', onReady);
      target.removeEventListener?.('error', onFailure);
      resolve(ready);
    };

    const onReady = () => finish(true);
    const onFailure = () => finish(false);

    if (target.tagName === 'IMG') {
      if (target.complete) {
        finish(Number(target.naturalWidth) > 0);
        return;
      }
      target.addEventListener?.('load', onReady, { once: true });
      target.addEventListener?.('error', onFailure, { once: true });
    } else if (target.tagName === 'VIDEO') {
      if (Number(target.readyState) >= 2) {
        finish(true);
        return;
      }
      target.addEventListener?.('loadeddata', onReady, { once: true });
      target.addEventListener?.('canplay', onReady, { once: true });
      target.addEventListener?.('error', onFailure, { once: true });
    } else {
      finish(true);
      return;
    }

    const setTimer = typeof windowRef?.setTimeout === 'function'
      ? windowRef.setTimeout.bind(windowRef)
      : globalThis.setTimeout;
    timer = setTimer(() => finish(false), Math.max(0, Number(timeoutMs) || 0));
  });

  await Promise.allSettled(targets.map(waitForTarget));
  return true;
}
