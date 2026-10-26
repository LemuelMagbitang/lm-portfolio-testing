/**
 * Tiny, best-effort previews of media that has already rendered successfully.
 * Never fetches a source or mounts a renderer; only downsamples a ready frame
 * and keeps a bounded, page-lifetime cache for later loading transitions.
 */
const MAX_PREVIEW_CACHE_ENTRIES = 40;
const MAX_PREVIEW_DATA_URL_LENGTH = 18000;
const MAX_PREVIEW_EDGE = 64;
const assetPreviewCache = new Map();

function previewKey(source = '') {
  return String(source || '').trim().replace(/#.*$/, '');
}

export function getAssetPreview(source = '') {
  const key = previewKey(source);
  if (!key || !assetPreviewCache.has(key)) return '';
  const value = assetPreviewCache.get(key);
  assetPreviewCache.delete(key);
  assetPreviewCache.set(key, value);
  return value;
}


/**
 * Replace a loading surface with a tiny frame captured from that exact asset.
 * It never fetches a thumbnail or mounts a renderer. With no matching cached
 * frame, callers retain their existing loader/fallback unchanged.
 */
export function installAssetPreviewOnFallback(fallback = null, source = '', {
  documentRef = fallback?.ownerDocument || globalThis.document,
  imageClass = ''
} = {}) {
  if (!fallback || !documentRef?.createElement) return false;
  const preview = getAssetPreview(source);
  if (!preview) return false;
  const currentImage = fallback.querySelector?.('img');
  if (fallback.dataset?.preview === 'true' && currentImage?.getAttribute('src') === preview) return true;
  // Preserve the existing status if a browser rejects the inlined preview.
  const previousChildren = Array.from(fallback.childNodes || []).map(node => node.cloneNode?.(true)).filter(Boolean);
  const image = documentRef.createElement('img');
  if (imageClass) image.className = imageClass;
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  image.loading = 'eager';
  image.decoding = 'async';
  const restoreFallback = () => {
    if (image.parentNode !== fallback) return;
    fallback.removeAttribute?.('data-preview');
    if (typeof fallback.replaceChildren === 'function') fallback.replaceChildren(...previousChildren);
    else {
      fallback.textContent = '';
      previousChildren.forEach(node => fallback.appendChild(node));
    }
  };
  image.addEventListener?.('error', restoreFallback, { once: true });
  fallback.dataset.preview = 'true';
  if (typeof fallback.replaceChildren === 'function') fallback.replaceChildren(image);
  else { fallback.textContent = ''; fallback.appendChild(image); }
  image.src = preview;
  return true;
}

function drawableFor(source, type = '') {
  if (!source) return null;
  const tag = String(source.tagName || '').toLowerCase();
  if (tag === 'canvas') return source;
  if (String(type).toLowerCase() === 'model') {
    const canvas = source.querySelector?.('canvas');
    return canvas?.width > 0 && canvas?.height > 0 ? canvas : null;
  }
  if (tag === 'img' && source.complete && source.naturalWidth > 0 && source.naturalHeight > 0) return source;
  if (tag === 'video' && source.readyState >= 2 && source.videoWidth > 0 && source.videoHeight > 0) return source;
  const nestedVideo = source.shadowRoot?.querySelector?.('video');
  if (nestedVideo?.readyState >= 2 && nestedVideo.videoWidth > 0 && nestedVideo.videoHeight > 0) return nestedVideo;
  const nestedCanvas = source.shadowRoot?.querySelector?.('canvas') || source.querySelector?.('canvas');
  return nestedCanvas?.width > 0 && nestedCanvas?.height > 0 ? nestedCanvas : null;
}

export function captureAssetPreview(source = '', mediaSource = null, {
  documentRef = mediaSource?.ownerDocument || globalThis.document,
  type = 'image'
} = {}) {
  const key = previewKey(source);
  if (!key || !documentRef?.createElement) return '';
  const cached = getAssetPreview(key);
  if (cached) return cached;
  const drawable = drawableFor(mediaSource, type);
  if (!drawable) return '';
  const width = Number(drawable.naturalWidth || drawable.videoWidth || drawable.width) || 0;
  const height = Number(drawable.naturalHeight || drawable.videoHeight || drawable.height) || 0;
  if (width < 1 || height < 1) return '';
  const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(width, height));
  const previewWidth = Math.max(1, Math.round(width * scale));
  const previewHeight = Math.max(1, Math.round(height * scale));
  let canvas;
  try {
    canvas = documentRef.createElement('canvas');
    canvas.width = previewWidth;
    canvas.height = previewHeight;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return '';
    context.drawImage(drawable, 0, 0, previewWidth, previewHeight);
    let dataUrl = '';
    try { dataUrl = canvas.toDataURL('image/webp', 0.42); } catch (_) {}
    if (!/^data:image\/webp;base64,/i.test(dataUrl)) {
      try { dataUrl = canvas.toDataURL('image/jpeg', 0.38); } catch (_) { dataUrl = ''; }
    }
    if (!/^data:image\/(?:webp|jpeg);base64,/i.test(dataUrl) || dataUrl.length > MAX_PREVIEW_DATA_URL_LENGTH) return '';
    assetPreviewCache.set(key, dataUrl);
    while (assetPreviewCache.size > MAX_PREVIEW_CACHE_ENTRIES) {
      const oldest = assetPreviewCache.keys().next().value;
      if (oldest === undefined) break;
      assetPreviewCache.delete(oldest);
    }
    return dataUrl;
  } catch (_) {
    // Tainted canvases, missing WebGL buffers, and unsupported media fail closed.
    return '';
  } finally {
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export function clearAssetPreviewCache() {
  assetPreviewCache.clear();
}
