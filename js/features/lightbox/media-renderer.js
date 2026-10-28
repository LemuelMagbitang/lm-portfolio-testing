/**
 * Lightbox media presentation boundary.
 *
 * Converts normalized project media into viewer DOM. Navigation, modal state,
 * and project selection remain in the Lightbox controller.
 */

import { createFoilNormalRenderer } from './foil-normal-renderer.js?v=20261027-07';
import { FOIL_AUTO_MOTION_FRAME_INTERVAL_MS, getFoilAutoPose, getFoilPointerPose, isCompactFoilTarget, prefersReducedFoilMotion, resolveFoilIntensity, shouldAutoRotateFoil, supportsFoilHover } from './foil-interaction.js?v=20261028-02';

import { captureAssetPreview, getAssetPreview, installAssetPreviewOnFallback } from '../../infrastructure/media/asset-preview.js?v=20261027-01';

const MUX_PLAYER_MODULE_URL = '../../infrastructure/mux/player.js?v=20261027-02';
let muxPlayerModulePromise = null;
let muxPlayerModuleAttempt = 0;

async function loadMuxPlayerModule() {
  if (!muxPlayerModulePromise) {
    muxPlayerModuleAttempt += 1;
    const moduleUrl = muxPlayerModuleAttempt === 1
      ? MUX_PLAYER_MODULE_URL
      : `${MUX_PLAYER_MODULE_URL}&retry=${muxPlayerModuleAttempt}`;
    const pending = import(moduleUrl);
    const guarded = pending.catch(error => {
      if (muxPlayerModulePromise === guarded) muxPlayerModulePromise = null;
      throw error;
    });
    muxPlayerModulePromise = guarded;
  }
  return muxPlayerModulePromise;
}

// Mux is an optional media capability. Its helper must never be a static edge
// in the feature graph: a transient hosting/CDN failure should fall back to a
// poster, not reject page-composition.js before the site can initialize.
async function ensureMuxPlayer(...args) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const module = await loadMuxPlayerModule();
      return await module.ensureMuxPlayer(...args);
    } catch (_) {
      if (attempt === 1) return false;
    }
  }
  return false;
}

const YOUTUBE_PLAYER_ORIGIN = 'https://www.youtube.com';

function mediaSourceIdentity(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(?:data|blob):/i.test(raw)) return raw;
  try {
    const url = new URL(raw, globalThis.document?.baseURI || globalThis.location?.href);
    return url.origin + url.pathname;
  } catch (_) {
    return raw.split(/[?#]/, 1)[0];
  }
}

export function createLightboxMediaRenderer({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  resolveAssetUrl = value => value,
  parseYouTube = () => ({ id: null, isShort: false }),
  applyMediaBackground = null,
  mountModelViewer = null,
  protectionEnabled = () => true,
  lightbox = null,
  lightboxControls = null
} = {}) {
  let youtubeMessageCleanup = null;
  const holographicCleanups = new Set();
  const holographicNormalControllers = new WeakMap();
  const holographicNormalRecords = new WeakMap();
  const holographicMotionStates = new WeakMap();
  const artworkVisibilityStates = new WeakMap();
  let artworkVisibilityObserver = null;
  const youtubeFrameCache = new Map();
  const MAX_CACHED_YOUTUBE_FRAMES = 2;
  const imageDimensionCache = new Map();
  const videoDimensionCache = new Map();
  const lottieDimensionCache = new Map();
  const lottieDimensionRequests = new Map();
  const lottieDimensionAbortControllers = new Map();
  let youtubePreloadRoot = null;
  let mediaPreloadRoot = null;
  let destroyed = false;
  let activeInspector = null;
  const artworkGroupLayoutCleanups = new Set();
  const artworkGroupInteractionCleanups = new Set();
  const activePreloadCleanups = new Set();
  const lightboxMediaCleanups = new WeakMap();
  const activeLightboxMediaCleanups = new Set();
  const MEDIA_PRELOAD_TIMEOUT_MS = 9000;
  // External model-viewer module imports can wait on the Three.js CDN. Bound
  // how long they hold the startup gate; a pending import can still complete
  // later and populate the browser module cache.
  const MODEL_MODULE_PRELOAD_TIMEOUT_MS = 3500;
  // Full-size secondary artwork can exceed 30 MiB. Give it a short startup
  // grace period on ordinary links, but never make a constrained connection
  // wait for the entire secondary queue before the page becomes interactive.
  const SECONDARY_MEDIA_STARTUP_WAIT_MS = 4000;
  const STARTUP_PRIMARY_MEDIA_PROJECT_LIMIT = 4;
  const withPreloadTimeout = (promise, timeoutMs = MEDIA_PRELOAD_TIMEOUT_MS, onTimeout = null) => new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = windowRef?.setTimeout?.(() => {
      try { onTimeout?.(); } catch (_) {}
      finish(false);
    }, timeoutMs);
    Promise.resolve(promise)
      .then(value => {
        if (timer !== undefined && timer !== null) windowRef?.clearTimeout?.(timer);
        finish(value);
      })
      .catch(() => {
        if (timer !== undefined && timer !== null) windowRef?.clearTimeout?.(timer);
        finish(false);
      });
  });

  function registerPreloadCleanup(cleanup) {
    if (typeof cleanup !== 'function') return () => {};
    if (destroyed) {
      try { cleanup(); } catch (_) {}
      return () => {};
    }
    activePreloadCleanups.add(cleanup);
    return () => activePreloadCleanups.delete(cleanup);
  }

  function ensureYouTubePreloadRoot() {
    if (youtubePreloadRoot?.isConnected) return youtubePreloadRoot;
    youtubePreloadRoot = documentRef.createElement('div');
    youtubePreloadRoot.className = 'lightbox-youtube-preload-root';
    youtubePreloadRoot.setAttribute('aria-hidden', 'true');
    Object.assign(youtubePreloadRoot.style, {
      position: 'fixed',
      left: '-10000px',
      top: '-10000px',
      width: '320px',
      height: '180px',
      overflow: 'hidden',
      opacity: '0.001',
      pointerEvents: 'none',
      contain: 'strict'
    });
    (documentRef.body || documentRef.documentElement)?.appendChild(youtubePreloadRoot);
    return youtubePreloadRoot;
  }

  function buildYouTubeEmbedUrl(src) {
    const parsed = parseYouTube(src);
    if (!parsed?.id) return '';
    const params = new URLSearchParams();
    params.set('enablejsapi', '1');
    params.set('playsinline', '1');
    if (windowRef?.location?.origin) params.set('origin', windowRef.location.origin);
    return 'https://www.youtube.com/embed/' + parsed.id + '?' + params.toString();
  }

  function cacheYouTubeFrame(embedSrc, iframe) {
    if (!embedSrc || !iframe || destroyed) return;
    youtubeFrameCache.delete(embedSrc);
    youtubeFrameCache.set(embedSrc, iframe);
    // Retained iframe documents can hold substantial memory even off-screen.
    // Evict only hidden cached frames; never interrupt a visible Lightbox player.
    while (youtubeFrameCache.size > MAX_CACHED_YOUTUBE_FRAMES) {
      const oldest = youtubeFrameCache.entries().next().value;
      if (!oldest) break;
      const [oldKey, oldFrame] = oldest;
      youtubeFrameCache.delete(oldKey);
      if (youtubePreloadRoot && oldFrame?.parentNode === youtubePreloadRoot) {
        try { oldFrame.remove(); } catch (_) {}
      }
    }
  }

  function ensureMediaPreloadRoot() {
    if (mediaPreloadRoot?.isConnected) return mediaPreloadRoot;
    mediaPreloadRoot = documentRef.createElement('div');
    mediaPreloadRoot.className = 'lightbox-media-preload-root';
    mediaPreloadRoot.setAttribute('aria-hidden', 'true');
    Object.assign(mediaPreloadRoot.style, {
      position: 'fixed',
      left: '-10000px',
      top: '-10000px',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      opacity: '0.001',
      pointerEvents: 'none',
      contain: 'strict'
    });
    (documentRef.body || documentRef.documentElement)?.appendChild(mediaPreloadRoot);
    return mediaPreloadRoot;
  }

  // Removing a video node alone does not reliably stop its resource selection
  // or release buffered media. Releasing the source and calling load() aborts
  // pending work; the helper is safe to call from timeout, destroy, or dispose.
  function releasePreloadedVideo(video) {
    if (!video) return;
    try { video.pause(); } catch (_) {}
    try { video.removeAttribute('src'); } catch (_) {}
    try {
      video.querySelectorAll?.('source').forEach(source => source.removeAttribute('src'));
    } catch (_) {}
    try { video.load(); } catch (_) {}
    try { video.remove(); } catch (_) {}
  }

  function setAspectRatio(surface, width, height) {
    const w = Number(width);
    const h = Number(height);
    if (!surface || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
    surface.style.setProperty('--lightbox-artwork-ratio', String(w / h));
    surface.style.aspectRatio = String(w) + ' / ' + String(h);
  }

  function preloadImage(url, { fetchPriority = 'low' } = {}) {
    if (!url || destroyed) return Promise.resolve(false);
    let image = null;
    let finishPreload = () => {};
    const preload = new Promise(resolve => {
      finishPreload = resolve;
      image = new Image();
      image.decoding = 'async';
      // Background warm-up yields to critical first-screen media.
      image.fetchPriority = fetchPriority === 'high' ? 'high' : 'low';
      image.onload = async () => {
        try { await image.decode?.(); } catch (_) {}
        const width = Number(image.naturalWidth);
        const height = Number(image.naturalHeight);
        if (!destroyed && width > 0 && height > 0) {
          imageDimensionCache.set(url, { width, height });
          // This image is already downloaded and decoded by the preload queue.
          // Capture its own tiny frame now so the first Lightbox open can use it
          // instead of substituting the project's CMS thumbnail.
          captureAssetPreview(url, image, { documentRef, type: 'image' });
        }
        resolve(true);
      };
      image.onerror = () => resolve(false);
      image.src = url;
    });
    const cleanup = () => {
      if (!image) return;
      image.onload = null;
      image.onerror = null;
      image.src = '';
      finishPreload(false);
    };
    const unregister = registerPreloadCleanup(cleanup);
    return withPreloadTimeout(preload, MEDIA_PRELOAD_TIMEOUT_MS, cleanup).finally(unregister);
  }

  function resolveLottieDimensions(url, { fetchPriority = 'low' } = {}) {
    if (!url || destroyed || typeof globalThis.fetch !== 'function') return Promise.resolve(null);
    const cached = lottieDimensionCache.get(url);
    if (cached) return Promise.resolve(cached);

    const pending = lottieDimensionRequests.get(url);
    if (pending) return pending;

    const controller = typeof globalThis.AbortController === 'function'
      ? new globalThis.AbortController()
      : null;
    const request = globalThis.fetch(url, {
      credentials: 'omit',
      cache: 'force-cache',
      ...(fetchPriority === 'high' ? { priority: 'high' } : {}),
      signal: controller?.signal
    }).then(async response => {
      if (!response.ok) return null;
      const payload = await response.json();
      const width = Number(payload?.w);
      const height = Number(payload?.h);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
      }
      const dimensions = { width, height };
      if (!destroyed) lottieDimensionCache.set(url, dimensions);
      return dimensions;
    }).catch(() => null).finally(() => {
      if (lottieDimensionRequests.get(url) === request) lottieDimensionRequests.delete(url);
      if (lottieDimensionAbortControllers.get(url) === controller) {
        lottieDimensionAbortControllers.delete(url);
      }
    });

    lottieDimensionRequests.set(url, request);
    if (controller) lottieDimensionAbortControllers.set(url, controller);
    return request;
  }

  async function preloadLottie(url, { fetchPriority = 'low' } = {}) {
    if (!url || destroyed || typeof globalThis.fetch !== 'function') return false;
    try {
      const dimensions = await withPreloadTimeout(
        resolveLottieDimensions(url, { fetchPriority }),
        MEDIA_PRELOAD_TIMEOUT_MS,
        // Abort a stalled dimensions fetch so its pending request can settle and
        // later preloads do not inherit a request that never finishes.
        () => lottieDimensionAbortControllers.get(url)?.abort()
      );
      return !!dimensions;
    } catch (_) {
      return false;
    }
  }

  async function preloadVideo(url, { fetchPriority = 'low' } = {}) {
    if (!url || destroyed) return false;
    const root = ensureMediaPreloadRoot();
    const video = documentRef.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.controls = false;
    video.fetchPriority = fetchPriority === 'high' ? 'high' : 'low';
    video.setAttribute('aria-hidden', 'true');
    video.setAttribute('tabindex', '-1');
    video.style.position = 'absolute';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0.001';
    video.style.pointerEvents = 'none';

    let settled = false;
    let finishPreload = () => {};
    const preload = new Promise(resolve => {
      const finish = ready => {
        if (settled) return;
        settled = true;
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('error', onError);
        if (!ready) releasePreloadedVideo(video);
        resolve(ready);
      };
      finishPreload = finish;
      const onReady = () => {
        // Use the decoded frame already acquired by this preload operation.
        // If the browser cannot draw it safely, normal loading UI remains.
        captureAssetPreview(url, video, { documentRef, type: 'video' });
        finish(true);
      };
      const onError = () => finish(false);
      video.addEventListener('loadeddata', onReady, { once: true });
      video.addEventListener('canplay', onReady, { once: true });
      video.addEventListener('error', onError, { once: true });
    });

    // On renderer destruction or timeout, remove listeners, stop playback,
    // clear the source, and resolve the pending preload exactly once.
    const cleanup = () => finishPreload(false);
    const unregister = registerPreloadCleanup(cleanup);
    root.appendChild(video);
    video.src = url;
    video.load();

    const result = await withPreloadTimeout(
      preload,
      MEDIA_PRELOAD_TIMEOUT_MS,
      cleanup
    ).finally(unregister);

    if (!result) releasePreloadedVideo(video);
    return result;
  }

  async function preloadYouTube(url) {
    const embedSrc = buildYouTubeEmbedUrl(url);
    if (!embedSrc || destroyed) return false;
    const existing = takeCachedYouTubeFrame(embedSrc);
    if (existing) return true;

    const root = ensureYouTubePreloadRoot();
    const iframe = documentRef.createElement('iframe');
    iframe.dataset.lmYoutube = 'true';
    iframe.dataset.lmYoutubeCacheKey = embedSrc;
    iframe.frameBorder = '0';
    iframe.loading = 'eager';
    iframe.fetchPriority = 'low';
    iframe.tabIndex = -1;
    iframe.title = 'Preloaded project video';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';

    let settled = false;
    let resolveReady = () => {};
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const finish = value => {
      if (settled) return false;
      settled = true;
      iframe.removeEventListener('load', onLoad);
      iframe.removeEventListener('error', onError);
      resolveReady(value);
      return true;
    };
    const cleanup = () => {
      if (youtubeFrameCache.get(embedSrc) === iframe) youtubeFrameCache.delete(embedSrc);
      iframe.removeEventListener('load', onLoad);
      iframe.removeEventListener('error', onError);
      // Explicitly cancel a pending navigation before removing the iframe.
      // Removing only the DOM node can leave its document/resource work alive
      // until the browser completes the abandoned navigation.
      try { iframe.removeAttribute('src'); } catch (_) {}
      try { iframe.remove(); } catch (_) {}
      finish(false);
    };
    const onLoad = () => {
      if (destroyed) {
        cleanup();
        return;
      }
      iframe.dataset.lmYoutubeLoaded = 'true';
      primeYouTubeFrame(iframe);
      cacheYouTubeFrame(embedSrc, iframe);
      finish(true);
    };
    const onError = () => cleanup();
    iframe.addEventListener('load', onLoad, { once: true });
    iframe.addEventListener('error', onError, { once: true });
    const unregister = registerPreloadCleanup(cleanup);
    root.appendChild(iframe);
    iframe.src = embedSrc;
    const result = await withPreloadTimeout(ready, MEDIA_PRELOAD_TIMEOUT_MS, cleanup).finally(unregister);
    if (!result) cleanup();
    return result;
  }

  async function preloadFetch(url, { fetchPriority = 'low' } = {}) {
    if (!url || destroyed || typeof globalThis.fetch !== 'function') return false;
    const controller = typeof globalThis.AbortController === 'function'
      ? new globalThis.AbortController()
      : null;
    const cleanup = () => controller?.abort();
    const unregister = registerPreloadCleanup(cleanup);
    try {
      // Include response-body consumption in the timeout. Bounding only fetch()
      // leaves arrayBuffer() able to stall indefinitely on an incomplete stream.
      const preload = (async () => {
        const response = await globalThis.fetch(url, {
          method: 'GET',
          credentials: 'omit',
          cache: 'force-cache',
          ...(fetchPriority === 'high' ? { priority: 'high' } : {}),
          signal: controller?.signal
        });
        if (!response?.ok) return false;
        await response.arrayBuffer();
        return true;
      })();
      return await withPreloadTimeout(preload, MEDIA_PRELOAD_TIMEOUT_MS, cleanup);
    } catch (_) {
      return false;
    } finally {
      unregister();
    }
  }

  async function runPreloadPool(jobs, concurrency = 8) {
    const queue = Array.isArray(jobs) ? jobs : [];
    let cursor = 0;
    const results = new Array(queue.length).fill(false);
    const workers = Array.from(
      { length: Math.min(Math.max(1, concurrency), queue.length) },
      async () => {
        while (cursor < queue.length) {
          if (destroyed) break;
          const index = cursor++;
          const job = queue[index];
          try {
            results[index] = (await job()) !== false;
          } catch (_) {
            results[index] = false;
          }
        }
      }
    );
    await Promise.all(workers);
    return results;
  }

  async function preloadProjectsMedia(projects = [], { preloadModelModule = null } = {}) {
    if (destroyed) return { total: 0, ready: 0 };

    // De-duplicate by media identity without losing priority semantics.
    // A shared asset may be secondary in one project but critical in another;
    // the critical use must promote the shared job rather than being discarded.
    const scheduledJobs = new Map();
    const scheduleJob = (key, job, critical = false, nonBlocking = false) => {
      if (!key || typeof job !== 'function') return;
      // Reserve startup work for critical primary media and small nonblocking
      // warm-ups. Everything else loads near the viewport or on project open.
      if (!critical && !nonBlocking) return;
      const existing = scheduledJobs.get(key);
      if (!existing || (critical && !existing.critical) || (!nonBlocking && existing.nonBlocking)) {
        scheduledJobs.set(key, { job, critical, nonBlocking });
      }
    };
    let hasModel = false;
    const youtubeWarmupKeys = new Set();

    const connection = globalThis.navigator?.connection ||
      globalThis.navigator?.mozConnection ||
      globalThis.navigator?.webkitConnection;
    // Keep startup work small on every connection type. The first four
    // projects' primary media are eligible; secondary assets load when cards
    // approach the viewport or when the visitor opens a project.
    const effectiveType = String(connection?.effectiveType || '').trim().toLowerCase();
    const downlink = Number(connection?.downlink);
    const roundTripTime = Number(connection?.rtt);
    const slowBandwidth = Number.isFinite(downlink) && downlink > 0 && downlink < 1.5;
    const highLatency = Number.isFinite(roundTripTime) && roundTripTime > 500;
    const constrainedNetwork = Boolean(
      connection?.saveData ||
      /^(?:slow-)?[23]g$/.test(effectiveType) ||
      slowBandwidth ||
      highLatency
    );
    const scheduleYouTubeWarmup = (key, url) => {
      if (constrainedNetwork || !key || !url || youtubeWarmupKeys.has(key)) return;
      if (youtubeWarmupKeys.size >= MAX_CACHED_YOUTUBE_FRAMES) return;
      youtubeWarmupKeys.add(key);
      scheduleJob(key, () => preloadYouTube(url), false, true);
    };

    (Array.isArray(projects) ? projects : []).forEach((project, projectIndex) => {
      const thumbnail = project?.thumbnail;
      if (thumbnail?.src) {
        const thumbnailIsStartupCritical = projectIndex < STARTUP_PRIMARY_MEDIA_PROJECT_LIMIT;
        const cleanSrc = String(thumbnail.src).split('?')[0].split('#')[0].toLowerCase();
        const type = String(thumbnail.type || (
          /\.(mp4|webm|mov|m4v)$/.test(cleanSrc) ? 'video' :
          /\.json$/.test(cleanSrc) ? 'lottie' :
          /\.(glb|gltf|obj|fbx|usdz)$/.test(cleanSrc) ? 'model' : 'image'
        )).toLowerCase();
        const url = resolveAssetUrl(thumbnail.src);
        const key = type + ':' + url;
        if (type === 'model') {
          hasModel = true;
          scheduleJob(key, () => preloadFetch(url, { fetchPriority: 'high' }), thumbnailIsStartupCritical);
        } else if (type === 'video') {
          scheduleJob(key, () => preloadVideo(url, { fetchPriority: 'high' }), thumbnailIsStartupCritical);
        } else if (type === 'lottie') {
          scheduleJob(key, () => preloadLottie(url, { fetchPriority: 'high' }), thumbnailIsStartupCritical);
        } else if (type === 'youtube') {
          scheduleYouTubeWarmup(key, url);
        } else {
          scheduleJob(key, () => preloadImage(url, { fetchPriority: 'high' }), thumbnailIsStartupCritical);
        }
      }

      const media = Array.isArray(project?.media) ? project.media : [];
      const criticalIndex = media.findIndex(item => {
        const type = String(item?.type || '').toLowerCase();
        return ['image', 'video', 'lottie', 'model'].includes(type) && item?.src;
      });
      const firstMediaIndex = media.findIndex(item => item?.src);
      const firstMediaType = firstMediaIndex >= 0
        ? String(media[firstMediaIndex]?.type || '').toLowerCase()
        : '';
      const primaryIndex = !constrainedNetwork && firstMediaType === 'youtube'
        ? firstMediaIndex
        : criticalIndex;
      const primaryMediaIsStartupCritical =
        projectIndex < STARTUP_PRIMARY_MEDIA_PROJECT_LIMIT;
      media.forEach((item, mediaIndex) => {
        if (!item?.src) return;
        const type = String(item.type || '').toLowerCase();
        const url = resolveAssetUrl(item.src);
        const key = type + ':' + url;

        // On constrained networks, only the first four projects' primary
        // media stay startup-critical. Models remain an intentional exception:
        // warming the 3D binary avoids a first-open fetch after its module graph
        // is ready.
        const critical =
          (mediaIndex === primaryIndex && primaryMediaIsStartupCritical) ||
          type === 'model';

        const fetchPriority = critical ? 'high' : 'low';

        if (type === 'image') {
          const holo = normalizeHolographicConfig(item.holographic);
          if (holo?.back) {
            const backUrl = resolveAssetUrl(holo.back);
            scheduleJob('holographic-back:' + backUrl, () => preloadImage(backUrl, { fetchPriority: 'low' }), false);
          }
          if (!isCompactFoilTarget(windowRef)) {
            if (holo?.texture) {
              const textureUrl = resolveAssetUrl(holo.texture);
              scheduleJob('holographic-texture:' + textureUrl, () => preloadImage(textureUrl, { fetchPriority: 'low' }), false);
            }
            if (holo?.mask) {
              const maskUrl = resolveAssetUrl(holo.mask);
              scheduleJob('holographic-mask:' + maskUrl, () => preloadImage(maskUrl, { fetchPriority: 'low' }), false);
            }
            if (holo?.backTexture) {
              const backTextureUrl = resolveAssetUrl(holo.backTexture);
              scheduleJob('holographic-back-texture:' + backTextureUrl, () => preloadImage(backTextureUrl, { fetchPriority: 'low' }), false);
            }
            if (holo?.backMask) {
              const backMaskUrl = resolveAssetUrl(holo.backMask);
              scheduleJob('holographic-back-mask:' + backMaskUrl, () => preloadImage(backMaskUrl, { fetchPriority: 'low' }), false);
            }
            const sharedFoilAssets = [
              ...(holo?.style === 'cosmos' ? ['assets/holographic/cosmos-bottom.webp','assets/holographic/cosmos-middle-trans.webp','assets/holographic/cosmos-top-trans.webp'] : []),
              ...(holo?.grainLayer !== false ? ['assets/holographic/grain.webp'] : []),
              ...(holo?.glitterLayer === true ? ['assets/holographic/glitter.webp'] : [])
            ];
            sharedFoilAssets.forEach(path => {
              const layerUrl = resolveAssetUrl(path);
              scheduleJob('holographic-layer:' + layerUrl, () => preloadImage(layerUrl, { fetchPriority: 'low' }), false);
            });
          }
        }

        if (type === 'model') {
          hasModel = true;
          scheduleJob(key, () => preloadFetch(url, { fetchPriority }), critical);
        } else if (type === 'image') {
          scheduleJob(key, () => preloadImage(url, { fetchPriority }), critical);
        } else if (type === 'lottie') {
          scheduleJob(key, () => preloadLottie(url, { fetchPriority }), critical);
        } else if (type === 'video') {
          scheduleJob(key, () => preloadVideo(url, { fetchPriority }), critical);
        } else if (type === 'youtube') {
          // Warm only a small number of players; other embeds load on demand.
          // We do not intercept the user's native player interaction.
          scheduleYouTubeWarmup(key, url);
        } else {
          // Future media types still get a cache warm-up when they expose a
          // repository/network source. Unsupported renderers can therefore
          // benefit from the same startup loading phase without coupling this
          // preloader to their eventual viewer implementation.
          scheduleJob(key, () => preloadFetch(url, { fetchPriority }), critical);
        }
      });

      const background = project?.background;
      if (background?.src) {
        const type = String(background.type || '').toLowerCase();
        const url = resolveAssetUrl(background.src);
        const key = 'background:' + type + ':' + url;
        scheduleJob(
          key,
          () => type === 'video'
            ? preloadVideo(url, { fetchPriority: 'high' })
            : preloadImage(url, { fetchPriority: 'high' }),
          true
        );
      }
    });

    // Keep the 3D viewer module in the startup-critical tier too. The Works
    // document also modulepreloads it, so this closes the remaining race where
    // the first 3D open beats the module graph.
    if (hasModel && typeof preloadModelModule === 'function') {
      scheduleJob(
        'viewer-module',
        () => withPreloadTimeout(
          Promise.resolve().then(preloadModelModule),
          MODEL_MODULE_PRELOAD_TIMEOUT_MS
        ),
        true
      );
    }

    const criticalJobs = [];
    const secondaryJobs = [];
    const nonBlockingJobs = [];
    for (const { job, critical, nonBlocking } of scheduledJobs.values()) {
      if (critical) criticalJobs.push(job);
      else if (nonBlocking) nonBlockingJobs.push(job);
      else secondaryJobs.push(job);
    }

    // Only primary media for the startup tier and the viewer module are critical.
    // Secondary gallery assets are loaded by viewport behavior or on project open.
    // Limited YouTube warm-ups remain explicitly nonblocking.
    if (!constrainedNetwork) {
      void runPreloadPool(nonBlockingJobs, 2).catch(() => {});
    }
    const secondaryPreloadPromise = constrainedNetwork
      ? Promise.resolve([])
      : runPreloadPool(secondaryJobs, 6).catch(() => []);
    const secondaryWaitPromise = constrainedNetwork
      ? Promise.resolve(null)
      : withPreloadTimeout(
          secondaryPreloadPromise,
          SECONDARY_MEDIA_STARTUP_WAIT_MS
        );

    const [criticalResults, secondaryOutcome] = await Promise.all([
      runPreloadPool(criticalJobs, constrainedNetwork ? 3 : 6),
      secondaryWaitPromise
    ]);
    // null or false means this tier is still running in the background.
    const secondaryResults = Array.isArray(secondaryOutcome) ? secondaryOutcome : [];

    return {
      total: criticalJobs.length + secondaryJobs.length + nonBlockingJobs.length,
      ready: [...criticalResults, ...secondaryResults].filter(Boolean).length,
      criticalTotal: criticalJobs.length,
      criticalReady: criticalResults.filter(Boolean).length,
      secondaryTotal: secondaryJobs.length + nonBlockingJobs.length,
      secondaryReady: secondaryResults.filter(Boolean).length
    };
  }

  function takeCachedYouTubeFrame(embedSrc) {
    const frame = youtubeFrameCache.get(embedSrc);
    if (!frame) return null;
    if (!frame.isConnected) {
      youtubeFrameCache.delete(embedSrc);
      return null;
    }
    youtubeFrameCache.delete(embedSrc);
    youtubeFrameCache.set(embedSrc, frame);
    return frame;
  }


  function buildImageMedia(imgUrl, altText = 'Project artwork', { eager = false } = {}) {
    const img = documentRef.createElement('img');
    img.alt = String(altText || 'Project artwork').trim() || 'Project artwork';
    img.draggable = false;
    img.loading = eager ? 'eager' : 'lazy';
    img.decoding = 'async';
    if (eager) img.fetchPriority = 'high';
    img.src = imgUrl;

    if (protectionEnabled()) {
      img.classList.add('no-save');
      img.addEventListener('contextmenu', event => event.preventDefault());
      img.addEventListener('dragstart', event => event.preventDefault());
    }

    return img;
  }

  function clampHolographic(value, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function normalizeHolographicConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const style = String(value.style || '').trim().toLowerCase();
    const intensityValue = value.intensity === '' || value.intensity == null ? NaN : Number(value.intensity);
    const intensity = Number.isFinite(intensityValue)
      ? Math.round(Math.max(0, Math.min(1, intensityValue)) * 100) / 100
      : 0.7;
    const rawBackIntensity = value.backIntensity === '' || value.backIntensity == null ? intensity : Number(value.backIntensity);
    const backIntensity = Number.isFinite(rawBackIntensity)
      ? Math.round(Math.max(0, Math.min(1, rawBackIntensity)) * 100) / 100
      : intensity;
    const texture = String(value.texture || '').trim();
    const textureModeValue = String(value.textureMode || 'fill').trim().toLowerCase();
    const textureMode = ['tile', 'fill'].includes(textureModeValue) ? textureModeValue : 'fill';
    const back = String(value.back || '').trim();
    const mask = String(value.mask || '').trim();
    const backTexture = String(value.backTexture || '').trim();
    const backTextureModeValue = String(value.backTextureMode || 'fill').trim().toLowerCase();
    const backTextureMode = ['tile', 'fill'].includes(backTextureModeValue) ? backTextureModeValue : 'fill';
    const backMask = String(value.backMask || '').trim();
    const backFoilEnabled = Boolean(back) && (
      value.backFoilEnabled === true ||
      (value.backFoilEnabled == null && Boolean(backTexture || backMask))
    );
    return {
      style: ['holographic', 'cosmos', 'brushed', 'beams', 'crosshatch', 'shattered', 'glitter', 'waves', 'cat-eye', 'iridescent', 'aurora'].includes(style) ? style : 'holographic',
      intensity, backIntensity, textureMode, backTextureMode,
      glitterLayer: value.glitterLayer === true,
      grainLayer: value.grainLayer !== false,
      ...(texture ? { texture } : {}), ...(back ? { back, backFoilEnabled } : {}), ...(mask ? { mask } : {}),
      ...(backTexture ? { backTexture } : {}), ...(backMask ? { backMask } : {})
    };
  }

  const HOLOGRAPHIC_COSMOS_MAPS = {
    'cosmos-bottom': 'assets/holographic/cosmos-bottom.webp',
    'cosmos-middle': 'assets/holographic/cosmos-middle-trans.webp',
    'cosmos-top': 'assets/holographic/cosmos-top-trans.webp'
  };
  // Only mask overlays that the selected finish actually renders. Keeping
  // hidden overlays unmasked avoids needless alpha/luminance-mask compositing.
  const HOLOGRAPHIC_MASK_LAYERS = {
    holographic: ['prism', 'ribbons', 'sheen'],
    cosmos: ['sheen'],
    brushed: ['prism', 'sheen'],
    beams: ['prism', 'sheen'],
    crosshatch: ['diffraction'],
    shattered: ['prism', 'diffraction'],
    glitter: ['sparkles'],
    waves: ['diffraction'],
    'cat-eye': ['prism', 'sheen'],
    iridescent: ['prism', 'ribbons', 'sheen'],
    aurora: ['prism', 'ribbons', 'sheen']
  };

  function syncHolographicNormalRendering(surface, enabled) {
    const records = holographicNormalRecords.get(surface) || [];
    if (!records.length) return;
    const active = new Set(holographicNormalControllers.get(surface) || []);

    records.forEach(record => {
      if (enabled && !record.controller) {
        if (record.canvas.width === 0 && record.canvas.height === 0) {
          const replacement = documentRef.createElement('canvas');
          replacement.className = 'lightbox-holographic-normal-map';
          replacement.setAttribute('aria-hidden', 'true');
          record.applyMask(replacement);
          record.canvas.replaceWith(replacement);
          record.canvas = replacement;
        }
        const controller = createFoilNormalRenderer(record.canvas, record.patternUrls, record.options);
        record.controller = controller;
        active.add(controller);
        controller.setLight(0.34, 0.74);
      } else if (!enabled && record.controller) {
        try { record.controller.destroy(); } catch (_) {}
        active.delete(record.controller);
        record.controller = null;
      }
      record.canvas.dataset.foilNormalState = enabled ? 'active' : 'suspended';
    });

    if (active.size) holographicNormalControllers.set(surface, Array.from(active));
    else holographicNormalControllers.delete(surface);
  }

  function updateHolographicTilt(surface, x, y, rotation = 0) {
    if (!surface) return;
    const clampedX = clampHolographic(x);
    const clampedY = clampHolographic(y);
    const pointerPose = getFoilPointerPose(clampedX, clampedY);
    const rx = pointerPose.rx;
    const ry = pointerPose.ry;
    const rotationValue = (Number(rotation) || 0).toFixed(2) + 'deg';
    const motion = holographicMotionStates.get(surface);

    // Compact targets keep only the transform values required for 3D parallax.
    // Foil layers are hidden and the WebGL normal renderer is suspended there,
    // so do not recalculate light/mask state or issue per-frame light updates.
    surface.style.setProperty('--holo-rx', rx.toFixed(2) + 'deg');
    surface.style.setProperty('--holo-ry', ry.toFixed(2) + 'deg');
    surface.style.setProperty('--holo-shift-x', pointerPose.shiftX.toFixed(2) + 'px');
    surface.style.setProperty('--holo-shift-y', pointerPose.shiftY.toFixed(2) + 'px');
    surface.style.setProperty('--holo-rotation', rotationValue);
    if (motion?.compactTarget) return;

    const angle = Math.atan2(clampedY - 50, clampedX - 50) * (180 / Math.PI);
    const foilX = 100 - clampedX;
    const foilY = 100 - clampedY;
    // Fine-pointer desktop retains the full foil response and moving light.
    const lightBaseX = motion?.autoRotate ? 34 : 50;
    const lightBaseY = motion?.autoRotate ? 26 : 50;
    const lightX = clampHolographic(lightBaseX + ((50 - clampedX) * 0.68), 16, 84);
    const lightY = clampHolographic(lightBaseY + ((50 - clampedY) * 0.68), 16, 84);
    const tiltStrength = clampHolographic(Math.hypot(clampedX - 50, clampedY - 50) / 70, 0, 1);

    surface.style.setProperty('--holo-x', clampedX + '%');
    surface.style.setProperty('--holo-y', clampedY + '%');
    surface.style.setProperty('--holo-foil-x', foilX.toFixed(2) + '%');
    surface.style.setProperty('--holo-foil-y', foilY.toFixed(2) + '%');
    surface.style.setProperty('--holo-light-x', lightX.toFixed(2) + '%');
    surface.style.setProperty('--holo-light-y', lightY.toFixed(2) + '%');
    surface.style.setProperty('--holo-tilt-strength', tiltStrength.toFixed(3));
    surface.style.setProperty('--holo-angle', angle.toFixed(2) + 'deg');
    holographicNormalControllers.get(surface)?.forEach(controller => controller.setLight(lightX / 100, 1 - (lightY / 100)));
  }

  function setHolographicTarget(surface, x, y, rotation = 0) {
    if (!surface) return;
    const motion = holographicMotionStates.get(surface);
    const targetX = clampHolographic(x);
    const targetY = clampHolographic(y);
    const targetRotation = Math.max(-2.5, Math.min(2.5, Number(rotation) || 0));
    if (!motion || typeof windowRef?.requestAnimationFrame !== 'function') {
      updateHolographicTilt(surface, targetX, targetY, targetRotation);
      return;
    }

    motion.targetX = targetX;
    motion.targetY = targetY;
    motion.targetRotation = targetRotation;
    if (motion.frame !== null) return;

    const animate = timestamp => {
      motion.frame = null;
      const previousTime = motion.lastTime || (timestamp - 16.67);
      const elapsed = Math.max(1, Math.min(50, timestamp - previousTime));
      const alpha = 1 - Math.exp(-elapsed / 42);
      motion.lastTime = timestamp;
      motion.x += (motion.targetX - motion.x) * alpha;
      motion.y += (motion.targetY - motion.y) * alpha;
      motion.rotation += (motion.targetRotation - motion.rotation) * alpha;

      const dx = motion.targetX - motion.x;
      const dy = motion.targetY - motion.y;
      const dr = motion.targetRotation - motion.rotation;
      if (Math.abs(dx) < 0.04 && Math.abs(dy) < 0.04 && Math.abs(dr) < 0.04) {
        motion.x = motion.targetX;
        motion.y = motion.targetY;
        motion.rotation = motion.targetRotation;
        motion.lastTime = 0;
        updateHolographicTilt(surface, motion.x, motion.y, motion.rotation);
        return;
      }

      updateHolographicTilt(surface, motion.x, motion.y, motion.rotation);
      motion.frame = windowRef.requestAnimationFrame(animate);
    };

    motion.frame = windowRef.requestAnimationFrame(animate);
  }

  function startFoilAutoRotation(surface) {
    const motion = holographicMotionStates.get(surface);
    if (!motion || motion.autoRotate || typeof windowRef?.requestAnimationFrame !== 'function') return;
    if (motion.frame !== null) {
      try { windowRef.cancelAnimationFrame?.(motion.frame); } catch (_) {}
      motion.frame = null;
    }
    motion.lastTime = 0;
    motion.autoRotate = true;
    motion.autoStartTime = null;
    motion.lastAutoFrame = -Infinity;
    const animate = timestamp => {
      motion.autoFrame = null;
      if (!motion.autoRotate || destroyed) return;
      if (motion.autoStartTime === null) motion.autoStartTime = timestamp;
      if (timestamp - motion.lastAutoFrame >= FOIL_AUTO_MOTION_FRAME_INTERVAL_MS) {
        const pose = getFoilAutoPose((timestamp - motion.autoStartTime) / 1000);
        motion.x = motion.targetX = pose.x;
        motion.y = motion.targetY = pose.y;
        motion.rotation = motion.targetRotation = pose.rotation;
        updateHolographicTilt(surface, motion.x, motion.y, motion.rotation);
        motion.lastAutoFrame = timestamp;
      }
      motion.autoFrame = windowRef.requestAnimationFrame(animate);
    };
    motion.autoFrame = windowRef.requestAnimationFrame(animate);
  }

  function stopFoilAutoRotation(surface) {
    const motion = holographicMotionStates.get(surface);
    if (!motion) return;
    motion.autoRotate = false;
    if (motion.autoFrame !== null && motion.autoFrame !== undefined) {
      try { windowRef?.cancelAnimationFrame?.(motion.autoFrame); } catch (_) {}
    }
    motion.autoFrame = null;
    motion.autoStartTime = null;
    motion.lastAutoFrame = -Infinity;
  }

  function resetFoilMotionImmediately(surface) {
    stopFoilAutoRotation(surface);
    const motion = holographicMotionStates.get(surface);
    if (motion?.frame !== null && motion?.frame !== undefined) {
      try { windowRef?.cancelAnimationFrame?.(motion.frame); } catch (_) {}
      motion.frame = null;
    }
    if (motion) {
      motion.x = motion.targetX = 50;
      motion.y = motion.targetY = 50;
      motion.rotation = motion.targetRotation = 0;
      motion.lastTime = 0;
    }
    updateHolographicTilt(surface, 50, 50, 0);
  }

  function setHolographicReflection(surface, event) {
    const rect = surface.getBoundingClientRect?.();
    if (!rect || !rect.width || !rect.height) return;
    const x = ((Number(event.clientX) - rect.left) / rect.width) * 100;
    const y = ((Number(event.clientY) - rect.top) / rect.height) * 100;
    const pose = getFoilPointerPose(x, y);
    setHolographicTarget(surface, pose.x, pose.y, pose.rotation);
  }

  // Luminance masks are front-face-only by design. White reveals foil;
  // black suppresses it; gray allows partial foil coverage.
  function applyHolographicMask(layer, maskUrl, artworkUrl = '', detailMaskUrl = '', detailOptions = {}) {
    if (!layer?.style || (!maskUrl && !artworkUrl && !detailMaskUrl && !detailOptions.clipMaskUrl)) return;
    const asCssUrl = value => 'url("' + String(value).split('"').join('%22') + '")';
    const images = [];
    const modes = [];
    const sizes = [];
    const repeats = [];
    const positions = [];
    if (detailMaskUrl) {
      images.push(asCssUrl(detailMaskUrl));
      modes.push('luminance');
      sizes.push(detailOptions.size || '100% 100%');
      repeats.push(detailOptions.repeat || 'no-repeat');
      positions.push(detailOptions.position || 'center');
    }
    if (detailOptions.clipMaskUrl) {
      images.push(asCssUrl(detailOptions.clipMaskUrl));
      modes.push('alpha');
      sizes.push(detailOptions.clipMaskSize || '100% 100%');
      repeats.push(detailOptions.clipMaskRepeat || 'no-repeat');
      positions.push(detailOptions.clipMaskPosition || 'center');
    }
    if (maskUrl) {
      images.push(asCssUrl(maskUrl));
      modes.push('luminance');
      sizes.push('100% 100%');
      repeats.push('no-repeat');
      positions.push('center');
    }
    if (artworkUrl) {
      images.push(asCssUrl(artworkUrl));
      modes.push('alpha');
      sizes.push('contain');
      repeats.push('no-repeat');
      positions.push('center');
    }
    const imageList = images.join(', ');
    const modeList = modes.join(', ');
    const sizeList = sizes.join(', ');
    const repeatList = repeats.join(', ');
    const positionList = positions.join(', ');
    const intersections = images.slice(1).map(() => 'intersect').join(', ');
    const webkitIntersections = images.slice(1).map(() => 'source-in').join(', ');
    layer.style.maskImage = imageList;
    layer.style.webkitMaskImage = imageList;
    layer.style.maskMode = modeList;
    layer.style.webkitMaskSourceType = modeList;
    layer.style.maskComposite = intersections || 'add';
    layer.style.webkitMaskComposite = webkitIntersections || 'source-over';
    layer.style.maskRepeat = repeatList;
    layer.style.webkitMaskRepeat = repeatList;
    layer.style.maskPosition = positionList;
    layer.style.webkitMaskPosition = positionList;
    layer.style.maskSize = sizeList;
    layer.style.webkitMaskSize = sizeList;
  }

  function buildHolographicImage(frontImage, item, project) {
    const config = normalizeHolographicConfig(item?.holographic);
    if (!config || !frontImage?.src) return null;

    const surface = documentRef.createElement('div');
    surface.className = 'lightbox-holographic';
    surface.dataset.holoStyle = config.style;
    surface.dataset.holoTextureMode = config.textureMode;
    let compactTarget = isCompactFoilTarget(windowRef);
    surface.dataset.holoFoil = compactTarget ? 'disabled' : 'enabled';
    let hoverAvailable = supportsFoilHover(windowRef) && !prefersReducedFoilMotion(windowRef);
    let autoRotationAvailable = shouldAutoRotateFoil(windowRef);
    let frontStrength = resolveFoilIntensity(config.intensity, compactTarget);
    let backStrength = resolveFoilIntensity(config.backIntensity, compactTarget);
    surface.dataset.holoInput = hoverAvailable ? 'hover-edge' : 'tap-only';
    surface.dataset.holoMotion = autoRotationAvailable ? 'auto-rotate' : (hoverAvailable ? 'pointer' : 'static');
    const backHasCustomArtwork = Boolean(String(config.back || '').trim());
    const backFoilEnabled = backHasCustomArtwork && Boolean(config.backFoilEnabled);
    surface.dataset.holoHasCustomBack = backHasCustomArtwork ? 'true' : 'false';
    surface.dataset.holoHasBackEffects = backFoilEnabled ? 'true' : 'false';
    surface.style.setProperty('--holo-intensity', String(frontStrength));
    surface.style.setProperty('--holo-x', '50%');
    surface.style.setProperty('--holo-y', '50%');
    surface.style.setProperty('--holo-foil-x', '50%');
    surface.style.setProperty('--holo-foil-y', '50%');
    surface.style.setProperty('--holo-light-x', '34%');
    surface.style.setProperty('--holo-light-y', '26%');
    surface.style.setProperty('--holo-tilt-strength', '0');
    surface.style.setProperty('--holo-shift-x', '0px');
    surface.style.setProperty('--holo-shift-y', '0px');
    holographicMotionStates.set(surface, {
      x: 50, y: 50, targetX: 50, targetY: 50, rotation: 0, targetRotation: 0,
      compactTarget, frame: null, lastTime: 0, autoRotate: false,
      autoFrame: null, autoStartTime: null, lastAutoFrame: -Infinity
    });
    surface.style.setProperty('--holo-rx', '0deg');
    surface.style.setProperty('--holo-ry', '0deg');
    surface.style.setProperty('--holo-angle', '0deg');
    surface.style.setProperty('--holo-rotation', '0deg');
    surface.tabIndex = 0;
    surface.setAttribute('role', 'button');
    surface.setAttribute('aria-label', project.title
      ? `Flip holographic artwork: ${project.title}`
      : 'Flip holographic artwork');
    surface.setAttribute('aria-pressed', 'false');

    const hint = documentRef.createElement('div');
    hint.className = 'lightbox-holographic-hint';
    hint.style.justifyContent = 'center';
    hint.setAttribute('aria-live', 'polite');
    const faceLabel = documentRef.createElement('span');
    faceLabel.className = 'lightbox-holographic-face-status';
    faceLabel.dataset.holoFaceLabel = '';
    faceLabel.textContent = 'FRONT';
    const separator = documentRef.createElement('span');
    separator.className = 'lightbox-holographic-hint-separator';
    separator.textContent = '•';
    separator.setAttribute('aria-hidden', 'true');
    const desktopAction = documentRef.createElement('span');
    desktopAction.className = 'lightbox-holographic-desktop-action';
    desktopAction.textContent = 'HOVER EDGE / CLICK';
    const touchAction = documentRef.createElement('span');
    touchAction.className = 'lightbox-holographic-touch-action';
    touchAction.textContent = 'TAP TO FLIP';
    const desktopRecommendation = documentRef.createElement('span');
    desktopRecommendation.className = 'lightbox-holographic-desktop-recommendation';
    desktopRecommendation.textContent = 'Switch to desktop for the full effect.';
    hint.append(faceLabel, separator, desktopAction, touchAction, desktopRecommendation);
    surface.__lightboxHoloHint = hint;

    const inner = documentRef.createElement('div');
    inner.className = 'lightbox-holographic-inner';
    const flip = documentRef.createElement('div');
    flip.className = 'lightbox-holographic-flip';

    const front = documentRef.createElement('div');
    front.className = 'lightbox-holographic-face lightbox-holographic-front';
    front.appendChild(frontImage);

    const back = documentRef.createElement('div');
    back.className = 'lightbox-holographic-face lightbox-holographic-back';
    const backUrl = backHasCustomArtwork ? resolveAssetUrl(config.back) : resolveAssetUrl(item.src);
    const backImage = buildImageMedia(
      backUrl,
      backHasCustomArtwork
        ? (project.title ? `${project.title} — reverse artwork` : 'Reverse artwork')
        : (project.title ? `${project.title} — holographic reverse` : 'Holographic reverse'),
      { eager: true }
    );
    if (!backHasCustomArtwork) backImage.classList.add('lightbox-holographic-default-reverse');
    back.appendChild(backImage);

    const setHolographicAspect = () => {
      const width = Number(frontImage.naturalWidth) || 0;
      const height = Number(frontImage.naturalHeight) || 0;
      if (width > 0 && height > 0) surface.style.setProperty('--holo-aspect', width + ' / ' + height);
    };
    setHolographicAspect();
    frontImage.addEventListener('load', setHolographicAspect, { once: true });

    const frontTextureUrl = config.texture ? resolveAssetUrl(config.texture) : '';
    const frontMaskUrl = config.mask ? resolveAssetUrl(config.mask) : '';
    const backTextureUrl = backFoilEnabled && config.backTexture ? resolveAssetUrl(config.backTexture) : '';
    const backMaskUrl = backFoilEnabled && config.backMask ? resolveAssetUrl(config.backMask) : '';
    [front, back].forEach(face => {
      const isFront = face === front;
      if (!isFront && !backFoilEnabled) return;
      const faceMaskUrl = isFront ? frontMaskUrl : backMaskUrl;
      const faceTextureUrl = isFront ? frontTextureUrl : backTextureUrl;
      const faceTextureMode = isFront ? config.textureMode : config.backTextureMode;
      const faceImage = isFront ? frontImage : backImage;
      const faceStrength = isFront ? frontStrength : backStrength;
      // Keep the front strength inherited from the surface so existing live
      // intensity interactions continue to respond; only the reverse overrides it.
      if (!isFront) {
        face.style.setProperty('--holo-intensity', String(faceStrength));
        face.style.setProperty('--holo-visual-intensity', 'calc(var(--holo-intensity,.7) * .68)');
      }
      const faceArtworkUrl = faceImage.currentSrc || faceImage.src;
      const cosmosClipUrl = config.style === 'cosmos'
        ? resolveAssetUrl(HOLOGRAPHIC_COSMOS_MAPS['cosmos-top'])
        : '';
      const applyFaceHolographicMask = (layer, detailMaskUrl = '', detailOptions = {}) => {
        const options = cosmosClipUrl
          ? {
              ...detailOptions,
              clipMaskUrl: cosmosClipUrl,
              clipMaskSize: '50% 50%',
              clipMaskRepeat: 'repeat',
              clipMaskPosition: '0 0'
            }
          : detailOptions;
        applyHolographicMask(layer, faceMaskUrl, faceArtworkUrl, detailMaskUrl, options);
      };
      const spectrum = documentRef.createElement('span');
      spectrum.className = 'lightbox-holographic-spectrum'; spectrum.setAttribute('aria-hidden','true');
      const environment = documentRef.createElement('span');
      environment.className = 'lightbox-holographic-environment'; environment.setAttribute('aria-hidden','true');
      const glare = documentRef.createElement('span');
      glare.className = 'lightbox-holographic-glare'; glare.setAttribute('aria-hidden','true');
      const prism = documentRef.createElement('span');
      prism.className = 'lightbox-holographic-prism'; prism.setAttribute('aria-hidden','true');
      const ribbons = documentRef.createElement('span');
      ribbons.className = 'lightbox-holographic-ribbons'; ribbons.setAttribute('aria-hidden','true');
      const diffraction = documentRef.createElement('span');
      diffraction.className = 'lightbox-holographic-diffraction'; diffraction.setAttribute('aria-hidden','true');
      const sparkles = documentRef.createElement('span');
      sparkles.className = 'lightbox-holographic-sparkles'; sparkles.setAttribute('aria-hidden','true');
      const sheen = documentRef.createElement('span');
      sheen.className = 'lightbox-holographic-sheen'; sheen.setAttribute('aria-hidden','true');
      const cosmosLayers = config.style === 'cosmos'
        ? [
            ['cosmos-bottom', 'lightbox-holographic-cosmos-layer lightbox-holographic-cosmos-bottom'],
            ['cosmos-middle', 'lightbox-holographic-cosmos-layer lightbox-holographic-cosmos-middle'],
            ['cosmos-top', 'lightbox-holographic-cosmos-layer lightbox-holographic-cosmos-top']
          ].map(([layerName, className]) => {
            const layer = documentRef.createElement('span');
            layer.className = className;
            layer.dataset.holoLayer = layerName;
            layer.setAttribute('aria-hidden', 'true');
            return layer;
          })
        : [];
      const grainLayer = config.grainLayer ? documentRef.createElement('span') : null;
      if (grainLayer) {
        grainLayer.className = 'lightbox-holographic-grain-layer';
        grainLayer.dataset.holoLayer = 'grain';
        grainLayer.setAttribute('aria-hidden', 'true');
      }
      const glitterLayer = config.glitterLayer ? documentRef.createElement('span') : null;
      if (glitterLayer) {
        glitterLayer.className = 'lightbox-holographic-glitter-layer';
        glitterLayer.dataset.holoLayer = 'glitter';
        glitterLayer.setAttribute('aria-hidden', 'true');
      }
      const maskedLayers = new Set([
        'spectrum',
        'environment',
        'glare',
        ...(HOLOGRAPHIC_MASK_LAYERS[config.style] || [])
      ]);
      if (maskedLayers.has('spectrum')) applyFaceHolographicMask(spectrum);
      if (maskedLayers.has('environment')) applyFaceHolographicMask(environment);
      if (maskedLayers.has('glare')) applyFaceHolographicMask(glare);
      if (maskedLayers.has('prism')) applyFaceHolographicMask(prism);
      if (maskedLayers.has('ribbons')) applyFaceHolographicMask(ribbons);
      if (maskedLayers.has('diffraction')) applyFaceHolographicMask(diffraction);
      if (maskedLayers.has('sparkles')) applyFaceHolographicMask(sparkles);
      if (maskedLayers.has('sheen')) applyFaceHolographicMask(sheen);
      cosmosLayers.forEach(layer => {
        const mapPath = HOLOGRAPHIC_COSMOS_MAPS[layer.dataset.holoLayer];
        const mapUrl = mapPath ? resolveAssetUrl(mapPath) : '';
        applyFaceHolographicMask(layer, mapUrl, { size: '50% 50%', repeat: 'repeat', position: '0 0' });
      });
      [grainLayer, glitterLayer].filter(Boolean).forEach(layer => applyFaceHolographicMask(layer));
      face.append(
        spectrum, ...cosmosLayers, ...(grainLayer ? [grainLayer] : []), ...(glitterLayer ? [glitterLayer] : []),
        environment, glare, prism, ribbons, diffraction, sparkles, sheen
      );
      if (faceTextureUrl) {
        const texture = documentRef.createElement('span');
        texture.className = 'lightbox-holographic-texture';
        texture.dataset.holoTextureMode = faceTextureMode;
        texture.setAttribute('aria-hidden','true');
        // Black suppresses the foil, white reveals it, and gray yields partial strength.
        texture.style.backgroundImage =
          'url("' + faceTextureUrl.split('"').join('%22') + '"), ' +
          'conic-gradient(from calc(146deg + var(--holo-angle,0deg)) at var(--holo-light-x,34%) var(--holo-light-y,26%), #ffe87a 0deg, #adff67 42deg, #47f3ce 86deg, #57cfff 130deg, #8f7bff 176deg, #ef70f5 222deg, #ff75ac 266deg, #ff9a6b 316deg, #ffe87a 360deg), ' +
          'linear-gradient(calc(124deg + var(--holo-angle,0deg)), transparent 24%, rgba(0,8,24,.34) 34%, rgba(255,255,255,.04) 39%, rgba(255,255,255,.48) 47%, rgba(174,245,255,.24) 51%, rgba(8,16,40,.16) 58%, transparent 70%), ' +
          'radial-gradient(ellipse 42% 36% at var(--holo-light-x,34%) var(--holo-light-y,26%), rgba(255,255,255,.44), rgba(186,238,255,.12) 38%, transparent 74%)';
        const cosmosTextureTile = config.style === 'cosmos';
        texture.style.backgroundRepeat = cosmosTextureTile
          ? 'repeat, no-repeat, no-repeat, no-repeat'
          : faceTextureMode === 'tile'
            ? 'repeat, no-repeat, no-repeat, no-repeat'
            : 'no-repeat, no-repeat, no-repeat, no-repeat';
        texture.style.backgroundSize = cosmosTextureTile
          ? '50% 50%, 180% 160%, 220% 190%, 145% 145%'
          : faceTextureMode === 'tile'
            ? 'auto, 320% 280%, 250% 220%, 170% 170%'
            : '100% 100%, 320% 280%, 250% 220%, 170% 170%';
        texture.style.backgroundPosition = cosmosTextureTile
          ? '0 0, var(--holo-foil-x,50%) var(--holo-foil-y,50%), var(--holo-foil-x,50%) var(--holo-foil-y,50%), var(--holo-light-x,34%) var(--holo-light-y,26%)'
          : 'center, var(--holo-foil-x,50%) var(--holo-foil-y,50%), var(--holo-foil-x,50%) var(--holo-foil-y,50%), var(--holo-light-x,34%) var(--holo-light-y,26%)';
        texture.style.opacity = 'calc(.08 + (var(--holo-visual-intensity,var(--holo-intensity,.7)) * .38) + (var(--holo-tilt-strength,0) * .10))';
        texture.style.mixBlendMode = 'color-dodge';
        texture.style.filter = 'contrast(1.42) saturate(1.55) brightness(1.04)';
        applyFaceHolographicMask(texture, faceTextureUrl, {
          size: cosmosTextureTile ? '50% 50%' : (faceTextureMode === 'tile' ? 'auto' : '100% 100%'),
          repeat: cosmosTextureTile || faceTextureMode === 'tile' ? 'repeat' : 'no-repeat',
          position: cosmosTextureTile ? '0 0' : 'center'
        });
        face.appendChild(texture);
      }

      // Blend all available Cosmos maps and the custom foil pattern into one relief normal.
      const normalPatternUrls = [
        ...(config.style === 'cosmos' ? Object.values(HOLOGRAPHIC_COSMOS_MAPS).map(path => resolveAssetUrl(path)) : []),
        ...(faceTextureUrl ? [faceTextureUrl] : [])
      ].filter(Boolean).slice(0, 4);
      if (normalPatternUrls.length) {
        const normalCanvas = documentRef.createElement('canvas');
        normalCanvas.className = 'lightbox-holographic-normal-map';
        normalCanvas.setAttribute('aria-hidden', 'true');
        applyFaceHolographicMask(normalCanvas);
        face.appendChild(normalCanvas);
        const records = holographicNormalRecords.get(surface) || [];
        normalCanvas.dataset.foilNormalState = 'suspended';
        records.push({
          face,
          canvas: normalCanvas,
          patternUrls: normalPatternUrls,
          applyMask: layer => applyFaceHolographicMask(layer),
          options: {
            intensity: isFront ? config.intensity : config.backIntensity,
            phase: isFront ? 0.17 : 0.43,
            uvScale: config.style === 'cosmos' ? 2 : (faceTextureMode === 'tile' ? 2 : 1)
          },
          controller: null
        });
        holographicNormalRecords.set(surface, records);
      }
    });

    syncHolographicNormalRendering(surface, !compactTarget);
    flip.append(front, back);
    inner.appendChild(flip);
    surface.appendChild(inner);

    let pointerFrame = null;
    let pendingPointer = null;
    const responsiveFoilCleanups = [];
    const syncResponsiveFoilIntensity = () => {
      const nextCompactTarget = isCompactFoilTarget(windowRef);
      if (nextCompactTarget === compactTarget) return;

      compactTarget = nextCompactTarget;
      frontStrength = resolveFoilIntensity(config.intensity, compactTarget);
      backStrength = resolveFoilIntensity(config.backIntensity, compactTarget);
      surface.style.setProperty('--holo-intensity', String(frontStrength));
      if (backFoilEnabled) back.style.setProperty('--holo-intensity', String(backStrength));
      surface.dataset.holoFoil = compactTarget ? 'disabled' : 'enabled';
      syncHolographicNormalRendering(surface, !compactTarget);
      const motion = holographicMotionStates.get(surface);
      if (motion) {
        motion.compactTarget = compactTarget;
        // Reapply the current pointer state immediately so an on-edge desktop
        // tilt cannot remain above the compact visual-strength cap after resize.
        updateHolographicTilt(surface, motion.x, motion.y, motion.rotation);
      }
    };
    const bindResponsiveFoilQuery = (query, handler = syncResponsiveFoilIntensity) => {
      let mediaQuery;
      try { mediaQuery = windowRef?.matchMedia?.(query); } catch (_) {}
      if (!mediaQuery) return;
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handler);
        responsiveFoilCleanups.push(() => mediaQuery.removeEventListener?.('change', handler));
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handler);
        responsiveFoilCleanups.push(() => mediaQuery.removeListener?.(handler));
      }
    };
    const cancelQueuedPointer = () => {
      if (pointerFrame !== null) {
        try { windowRef?.cancelAnimationFrame?.(pointerFrame); } catch (_) {}
        pointerFrame = null;
      }
      pendingPointer = null;
    };

    const cleanup = () => {
      cancelQueuedPointer();
      surface.classList.remove('is-flipped');
      surface.setAttribute('aria-pressed', 'false');
      const faceLabel = surface.__lightboxHoloHint?.querySelector('[data-holo-face-label]');
      if (faceLabel) faceLabel.textContent = 'FRONT';
      const motion = holographicMotionStates.get(surface);
      stopFoilAutoRotation(surface);
      if (motion?.frame !== null && motion?.frame !== undefined) {
        windowRef?.cancelAnimationFrame?.(motion.frame);
      }
      holographicMotionStates.delete(surface);
      responsiveFoilCleanups.splice(0).forEach(dispose => { try { dispose(); } catch (_) {} });
      syncHolographicNormalRendering(surface, false);
      holographicNormalControllers.delete(surface);
      holographicNormalRecords.delete(surface);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerleave', onPointerLeave);
      surface.removeEventListener('click', toggleFlip);
      surface.removeEventListener('keydown', toggleFlip);
      surface.__lightboxHoloHint?.remove();
      surface.replaceChildren();
    };

    const onPointerMove = event => {
      // Only fine hover pointers can drive the optical response. Touch never
      // enters a hold/drag mode, preserving native scrolling and tap-to-flip.
      if (!hoverAvailable || event.pointerType !== 'mouse') return;
      pendingPointer = {
        clientX: Number(event.clientX) || 0,
        clientY: Number(event.clientY) || 0,
        pointerType: 'mouse'
      };
      if (pointerFrame !== null) return;
      const requestFrame = windowRef?.requestAnimationFrame;
      if (typeof requestFrame !== 'function') {
        const latest = pendingPointer;
        pendingPointer = null;
        setHolographicReflection(surface, latest);
        return;
      }
      pointerFrame = requestFrame.call(windowRef, () => {
        pointerFrame = null;
        const latest = pendingPointer;
        pendingPointer = null;
        if (!latest || destroyed) return;
        setHolographicReflection(surface, latest);
      });
    };

    const onPointerLeave = () => {
      cancelQueuedPointer();
      setHolographicTarget(surface, 50, 50, 0);
    };

    const syncFoilMotionMode = () => {
      const reducedMotion = prefersReducedFoilMotion(windowRef);
      const nextHoverAvailable = supportsFoilHover(windowRef) && !reducedMotion;
      const nextAutoRotationAvailable = shouldAutoRotateFoil(windowRef);
      const previousHoverAvailable = hoverAvailable;
      const previousAutoRotationAvailable = autoRotationAvailable;
      if (nextHoverAvailable === previousHoverAvailable &&
          nextAutoRotationAvailable === previousAutoRotationAvailable) return;

      hoverAvailable = nextHoverAvailable;
      autoRotationAvailable = nextAutoRotationAvailable;
      surface.dataset.holoInput = hoverAvailable ? 'hover-edge' : 'tap-only';
      surface.dataset.holoMotion = autoRotationAvailable ? 'auto-rotate' : (hoverAvailable ? 'pointer' : 'static');

      if (previousHoverAvailable !== hoverAvailable) {
        if (hoverAvailable) {
          surface.addEventListener('pointermove', onPointerMove, { passive: true });
          surface.addEventListener('pointerleave', onPointerLeave);
        } else {
          surface.removeEventListener('pointermove', onPointerMove);
          surface.removeEventListener('pointerleave', onPointerLeave);
          cancelQueuedPointer();
        }
      }

      if (autoRotationAvailable) {
        if (!previousAutoRotationAvailable) startFoilAutoRotation(surface);
      } else {
        if (previousAutoRotationAvailable) stopFoilAutoRotation(surface);
        if (reducedMotion) resetFoilMotionImmediately(surface);
        else if (previousAutoRotationAvailable || previousHoverAvailable !== hoverAvailable) {
          setHolographicTarget(surface, 50, 50, 0);
        }
      }
    };

    const toggleFlip = event => {
      if (event?.type === 'keydown') {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
      }
      surface.classList.toggle('is-flipped');
      const isBack = surface.classList.contains('is-flipped');
      surface.setAttribute('aria-pressed', isBack ? 'true' : 'false');
      const faceLabel = surface.__lightboxHoloHint?.querySelector('[data-holo-face-label]');
      if (faceLabel) faceLabel.textContent = isBack ? 'BACK' : 'FRONT';
    };

    // Passive, frame-coalesced hover input avoids layout/GPU work for every
    // raw pointer event. Touch-only devices attach no hover listeners.
    // Keep foil intensity in sync if orientation or viewport size crosses the
    // compact breakpoint. Media-query listeners also catch capability changes.
    windowRef?.addEventListener?.('resize', syncResponsiveFoilIntensity, { passive: true });
    responsiveFoilCleanups.push(() => windowRef?.removeEventListener?.('resize', syncResponsiveFoilIntensity));
    windowRef?.addEventListener?.('resize', syncFoilMotionMode, { passive: true });
    responsiveFoilCleanups.push(() => windowRef?.removeEventListener?.('resize', syncFoilMotionMode));
    bindResponsiveFoilQuery('(max-width: 760px)');
    bindResponsiveFoilQuery('(max-width: 760px)', syncFoilMotionMode);
    bindResponsiveFoilQuery('(hover: none) and (pointer: coarse)');
    bindResponsiveFoilQuery('(hover: none) and (pointer: coarse)', syncFoilMotionMode);
    bindResponsiveFoilQuery('(any-hover: hover) and (any-pointer: fine)', syncFoilMotionMode);
    bindResponsiveFoilQuery('(prefers-reduced-motion: reduce)', syncFoilMotionMode);

    if (hoverAvailable) {
      surface.addEventListener('pointermove', onPointerMove, { passive: true });
      surface.addEventListener('pointerleave', onPointerLeave);
    }
    if (autoRotationAvailable) startFoilAutoRotation(surface);
    surface.addEventListener('click', toggleFlip);
    surface.addEventListener('keydown', toggleFlip);



    holographicCleanups.add(cleanup);
    return surface;
  }

  function pauseYouTubeFrame(iframe) {
    if (!iframe?.contentWindow || iframe.dataset.lmYoutubeLoaded !== 'true') return;
    iframe.dataset.lmYoutubePauseRequested = String(Date.now());
    try {
      iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "pauseVideo", args: [] }), YOUTUBE_PLAYER_ORIGIN);
    } catch (_) {}
  }

  function pauseOtherPlayback(container, activeElement = null) {
    if (container) {
      container.querySelectorAll("video, mux-player").forEach(video => {
        if (video === activeElement) return;
        /* pause() is idempotent; calling it even on an already-paused element
           makes playback handoff deterministic when media state is changing
           asynchronously across devices. */
        try { video.pause(); } catch (_) {}
      });
    }

    // The active Lightbox subtree is only one part of the YouTube lifecycle.
    // A successfully preloaded frame can live in the hidden cache root after
    // the previous project is closed. Pause every known cached frame too so a
    // stale player can never retain audio across project opens/navigation.
    const knownFrames = new Set([
      ...(container ? Array.from(container.querySelectorAll("iframe[data-lm-youtube]")) : []),
      ...Array.from(youtubeFrameCache.values()),
      ...(youtubePreloadRoot
        ? Array.from(youtubePreloadRoot.querySelectorAll("iframe[data-lm-youtube]"))
        : [])
    ]);
    knownFrames.forEach(iframe => {
      if (iframe === activeElement) return;
      pauseYouTubeFrame(iframe);
    });
  }

  function parseYouTubeMessage(data) {
    if (!data) return null;
    if (typeof data === 'object') return data;
    if (typeof data !== 'string') return null;
    try { return JSON.parse(data); } catch (_) { return null; }
  }

  function isTrustedYouTubeOrigin(origin) {
    try {
      const hostname = new URL(origin).hostname.toLowerCase();
      return hostname === 'youtube.com' ||
        hostname.endsWith('.youtube.com') ||
        hostname === 'youtube-nocookie.com' ||
        hostname.endsWith('.youtube-nocookie.com');
    } catch (_) {
      return false;
    }
  }

  function primeYouTubeFrame(iframe) {
    if (!iframe?.contentWindow || iframe.dataset.lmYoutubeLoaded !== 'true') return;
    try {
      iframe.contentWindow.postMessage(JSON.stringify({
        event: 'command',
        func: 'addEventListener',
        args: ['onStateChange']
      }), YOUTUBE_PLAYER_ORIGIN);
      iframe.dataset.lmYoutubeApi = 'ready';
    } catch (_) {}
  }

  function bindYouTubeStateHandoff(container) {
    if (!container || !windowRef?.addEventListener) return;
    youtubeMessageCleanup?.();
    youtubeMessageCleanup = null;

    const handler = event => {
      if (!isTrustedYouTubeOrigin(event?.origin)) return;
      const message = parseYouTubeMessage(event?.data);
      if (message?.event !== 'onStateChange' || Number(message.info) !== 1) return;

      const activeFrame = Array.from(
        container.querySelectorAll('iframe[data-lm-youtube]')
      ).find(frame => frame.contentWindow === event.source);

      // Cross-origin pointer/focus events are not reliable enough to be the
      // sole source of truth on mobile. YouTube's state message fires after
      // the player actually starts, so the previous player is paused here.
      if (activeFrame) {
        activeFrame.dataset.lmYoutubeState = 'playing';
        pauseOtherPlayback(container, activeFrame);
      }
    };

    windowRef.addEventListener('message', handler);
    youtubeMessageCleanup = () => windowRef.removeEventListener('message', handler);
  }

  function bindPlaybackHandoff(container, mediaElement, type) {
    if (!container || !mediaElement) return;
    if (type === "video" || type === "mux") {
      mediaElement.addEventListener("play", () => pauseOtherPlayback(container, mediaElement));
      mediaElement.addEventListener("pointerdown", () => pauseOtherPlayback(container, mediaElement), { capture: true });
      return;
    }
    if (type === "youtube") {
      // Do not intercept the user's gesture here. The iframe must receive the
      // first tap/click directly so YouTube's native play control activates on
      // the first interaction. Cross-player cleanup is handled from the
      // authoritative YouTube playing-state message instead.
      return;
    }
  }

  function buildMediaCaption(text) {
    const value = String(text || '').trim();
    if (!value) return null;

    const p = documentRef.createElement('p');
    p.className = 'media-caption';
    p.textContent = value;
    return p;
  }

  function registerLightboxMediaCleanup(media, cleanup) {
    if (!media || typeof cleanup !== 'function') return () => {};
    let active = true;
    const record = {
      media,
      run() {
        if (!active) return;
        active = false;
        activeLightboxMediaCleanups.delete(record);
        lightboxMediaCleanups.delete(media);
        try { cleanup(); } catch (_) {}
      }
    };
    lightboxMediaCleanups.set(media, record);
    activeLightboxMediaCleanups.add(record);
    return () => record.run();
  }

  function cleanupLightboxMediaIn(container) {
    if (!container) return;
    const nodes = [];
    if (container.matches?.('img,video,mux-player,lottie-player')) nodes.push(container);
    container.querySelectorAll?.('img,video,mux-player,lottie-player').forEach(node => nodes.push(node));
    nodes.forEach(node => lightboxMediaCleanups.get(node)?.run());
  }

  function getStaticImageFallback(project = {}, failedSrc = '') {
    const failed = String(failedSrc || '').trim();
    const items = Array.isArray(project.media) ? project.media : [];
    for (const item of items) {
      const raw = String(item?.src || '').trim();
      if (!raw || raw === failed) continue;
      const type = String(item?.type || '').toLowerCase();
      const knownNonImage = /\.(mp4|webm|mov|m4v|ogv|ogg|json|obj|gltf|glb|fbx)(?:[?#]|$)/i.test(raw);
      if (type ? type !== 'image' : knownNonImage) continue;
      const resolved = resolveAssetUrl(raw);
      if (resolved && resolved !== failed) return resolved;
    }
    const thumbnail = project.thumbnail || {};
    const rawThumbnail = String(thumbnail.src || '').trim();
    const thumbnailType = String(thumbnail.type || 'image').toLowerCase();
    if (rawThumbnail && thumbnailType === 'image' && rawThumbnail !== failed) {
      const resolved = resolveAssetUrl(rawThumbnail);
      if (resolved && resolved !== failed) return resolved;
    }
    return '';
  }

  function showLightboxMediaFallback(artwork, project = {}, failedSrc = '', mediaType = 'image', status = 'error', explicitFallback = '') {
    if (!artwork || !documentRef?.createElement) return;
    let fallback = artwork.querySelector?.('.lightbox-media-fallback');
    if (!fallback) {
      fallback = documentRef.createElement('div');
      fallback.className = 'lightbox-media-fallback';
      artwork.appendChild(fallback);
    }
    fallback.classList.remove('is-preview-exiting');
    if (typeof fallback.replaceChildren === 'function') fallback.replaceChildren();
    else fallback.textContent = '';
    const type = String(mediaType || 'image').toLowerCase();
    const isLoading = status === 'loading';
    const labels = { image: 'PROJECT ARTWORK', video: 'VIDEO ARTWORK', lottie: 'ANIMATED ARTWORK', youtube: 'PROJECT VIDEO' };
    const labelText = labels[type] || (type === 'model' ? '3D ARTWORK' : 'PROJECT ARTWORK');
    fallback.dataset.state = isLoading ? 'loading' : 'error';
    fallback.removeAttribute('data-preview');
    fallback.setAttribute('role', 'img');
    fallback.setAttribute('aria-label', labelText);
    const failedRaw = String(failedSrc || '').trim();
    const resolvedFailedSrc = failedRaw ? resolveAssetUrl(failedRaw) : '';
    const explicitRaw = String(explicitFallback || '').trim();
    const explicitSrc = explicitRaw
      ? (/^(?:data:|blob:|https?:\/\/|\/\/)/i.test(explicitRaw) ? explicitRaw : resolveAssetUrl(explicitRaw))
      : '';
    const thumbnailValue = project?.thumbnail;
    const thumbnailRaw = String(
      (typeof thumbnailValue === 'string' ? thumbnailValue : thumbnailValue?.src) || ''
    ).trim();
    const projectThumbnailSrc = thumbnailRaw ? resolveAssetUrl(thumbnailRaw) : '';
    const sourceIdentity = value => {
      const raw = String(value || '').trim();
      if (!raw) return '';
      if (/^(?:data|blob):/i.test(raw)) return raw;
      try {
        const url = new URL(raw, documentRef?.baseURI || windowRef?.location?.href);
        return url.origin + url.pathname;
      } catch (_) {
        return raw.split(/[?#]/, 1)[0];
      }
    };
    const projectThumbnailIdentity = sourceIdentity(projectThumbnailSrc);
    const explicitCandidate = explicitSrc &&
      sourceIdentity(explicitSrc) !== sourceIdentity(resolvedFailedSrc) &&
      (!projectThumbnailIdentity || sourceIdentity(explicitSrc) !== projectThumbnailIdentity)
      ? explicitSrc : '';
    // Loading prefers this exact asset's cached low-quality frame. Never use
    // the project's CMS thumbnail or another artwork as the loading preview.
    const cachedAssetPreview = isLoading ? getAssetPreview(resolvedFailedSrc || failedRaw) : '';
    const imageSrc = isLoading
      ? (cachedAssetPreview || explicitCandidate)
      : (explicitCandidate || getStaticImageFallback(project, failedRaw));
    const appendLabel = () => {
      if (!fallback?.isConnected && !artwork.contains?.(fallback)) return;
      fallback.removeAttribute('data-preview');
      fallback.replaceChildren?.();
      const icon = documentRef.createElement('i');
      icon.className = type === 'video' || type === 'youtube' ? 'fa-solid fa-film' :
        type === 'lottie' ? 'fa-solid fa-wand-magic-sparkles' :
        type === 'model' ? 'fa-solid fa-cube' : 'fa-regular fa-image';
      icon.setAttribute('aria-hidden', 'true');
      const label = documentRef.createElement('span');
      label.textContent = isLoading ? 'LOADING ' + labelText : labelText;
      fallback.append(icon, label);
    };
    if (imageSrc && imageSrc !== resolvedFailedSrc) {
      if (isLoading) fallback.dataset.preview = 'true';
      const image = documentRef.createElement('img');
      image.className = 'lightbox-media-fallback-image';
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      image.decoding = 'async';
      // Inlined, size-bounded snapshots are already available locally; real preview/poster URLs stay deferred.
      image.loading = isLoading && /^data:image\/(?:webp|jpeg);base64,/i.test(imageSrc) ? 'eager' : 'lazy';
      image.addEventListener('error', () => appendLabel(), { once: true });
      image.src = imageSrc;
      fallback.appendChild(image);
      if (!isLoading) {
        const badge = documentRef.createElement('span');
        badge.className = 'lightbox-media-fallback-label';
        badge.textContent = labelText;
        fallback.appendChild(badge);
      }
    } else appendLabel();
    return fallback;
  }

  function clearLightboxMediaFallback(artwork) {
    const fallback = artwork?.querySelector?.('.lightbox-media-fallback');
    if (!fallback) return;
    if (artwork.dataset.mediaState === 'ready' && artwork.isConnected &&
        !fallback.classList.contains('is-preview-exiting')) {
      fallback.classList.add('is-preview-exiting');
      const finish = event => {
        if (event && event.target !== fallback) return;
        fallback.remove();
      };
      fallback.addEventListener('transitionend', finish, { once: true });
      const timer = windowRef?.setTimeout || globalThis.setTimeout;
      timer?.call(windowRef || globalThis, () => finish(), 420);
      return;
    }
    fallback.remove();
  }

  function ensureArtworkVisibilityObserver() {
    if (artworkVisibilityObserver) return artworkVisibilityObserver;
    if (windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return null;
    const Observer = windowRef?.IntersectionObserver || globalThis.IntersectionObserver;
    if (typeof Observer !== 'function') return null;
    artworkVisibilityObserver = new Observer(entries => {
      entries.forEach(entry => {
        const state = artworkVisibilityStates.get(entry.target);
        if (!state) {
          artworkVisibilityObserver?.unobserve(entry.target);
          return;
        }
        state.isVisible = Boolean(entry.isIntersecting && entry.intersectionRatio > 0);
        if (state.isVisible && state.ready && !state.revealed) revealArtworkWhenVisible(entry.target);
      });
    }, { root: null, rootMargin: '-24px 0px -24px 0px', threshold: 0.01 });
    return artworkVisibilityObserver;
  }

  function observeArtworkVisibility(artwork) {
    const observer = ensureArtworkVisibilityObserver();
    const state = { isVisible: !observer, ready: false, revealed: false };
    artworkVisibilityStates.set(artwork, state);
    observer?.observe(artwork);
  }

  function revealArtworkWhenVisible(artwork) {
    if (!artwork || artwork.dataset.mediaState !== 'ready') return;
    const state = artworkVisibilityStates.get(artwork);
    if (state?.revealed || artwork.dataset.mediaRevealStarted === 'true') return;
    const entry = artwork.closest?.('.lightbox-media-item');
    if (state && !state.isVisible) {
      artwork.classList.add('is-media-awaiting-viewport');
      if (entry) entry.dataset.mediaReveal = 'pending';
      return;
    }
    artwork.classList.remove('is-media-awaiting-viewport');
    artwork.dataset.mediaRevealStarted = 'true';
    artwork.classList.add('is-media-reveal-ready');
    if (entry) entry.dataset.mediaReveal = 'ready';
    if (state) state.revealed = true;
  }

  function markArtworkReady(artwork) {
    if (!artwork) return;
    artwork.dataset.mediaState = 'ready';
    const state = artworkVisibilityStates.get(artwork);
    if (state) state.ready = true;
    revealArtworkWhenVisible(artwork);
  }

  function markArtworkError(artwork) {
    if (!artwork || artwork.dataset.mediaState === 'ready') return;
    artwork.dataset.mediaState = 'error';
    artwork.classList.remove('is-media-awaiting-viewport', 'is-media-reveal-ready');
    const state = artworkVisibilityStates.get(artwork);
    if (state) {
      state.ready = false;
      state.revealed = true;
    }
    const entry = artwork.closest?.('.lightbox-media-item');
    if (entry) entry.dataset.mediaReveal = 'error';
  }

  function buildMediaEntry(mediaEl, captionText, background) {
    const wrap = documentRef.createElement('div');
    wrap.className = 'lightbox-media-item';
    wrap.dataset.mediaReveal = 'pending';

    // Keep media backgrounds scoped to the artwork surface. The caption is a
    // sibling of this surface, so fills never paint behind or tint captions.
    const artwork = documentRef.createElement('div');
    artwork.className = 'lightbox-artwork';
    artwork.dataset.mediaState = 'loading';

    // Carry the viewer's known orientation onto the artwork surface itself.
    // This is especially important for Lottie because its custom element
    // uses height:100%; the wrapper must own the aspect-ratio box.
    const orientationClass = ['yt-landscape', 'yt-portrait', 'yt-square']
      .find(className => mediaEl.classList?.contains?.(className));
    if (orientationClass) artwork.classList.add(orientationClass);

    artwork.appendChild(mediaEl);
    wrap.appendChild(artwork);
    observeArtworkVisibility(artwork);

    if (background && applyMediaBackground) {
      Promise.resolve(applyMediaBackground(artwork, background, resolveAssetUrl))
        .catch(error => console.warn('Lightbox: media background could not be applied.', error));
    }

    const caption = buildMediaCaption(captionText);
    if (caption) wrap.appendChild(caption);

    return wrap;
  }

  function applyVideoOrientation(video, orientation, artwork = null) {
    const syncClasses = resolved => {
      video.classList.remove('yt-landscape', 'yt-portrait', 'yt-square');
      artwork?.classList.remove('yt-landscape', 'yt-portrait', 'yt-square');

      if (resolved === 'portrait') {
        video.classList.add('yt-portrait');
        artwork?.classList.add('yt-portrait');
      } else if (resolved === 'square') {
        video.classList.add('yt-square');
        artwork?.classList.add('yt-square');
      } else {
        video.classList.add('yt-landscape');
        artwork?.classList.add('yt-landscape');
      }
    };

    // CMS orientation is an initial hint only. Once local video metadata is
    // available, the actual dimensions own the final Lightbox surface ratio.
    // This prevents stale orientation metadata from forcing a portrait or
    // landscape box around media that was exported at a different ratio.
    const cached = videoDimensionCache.get(video.src || resolveAssetUrl(video.currentSrc || ''));
    if (cached) {
      syncClasses(cached.width / cached.height < 0.85
        ? 'portrait'
        : cached.width / cached.height > 1.15 ? 'landscape' : 'square');
      video.style.aspectRatio = cached.width + ' / ' + cached.height;
      if (artwork) setAspectRatio(artwork, cached.width, cached.height);
    } else {
      syncClasses(
        orientation === 'portrait' || orientation === 'square' || orientation === 'landscape'
          ? orientation
          : 'square'
      );
    }
    const syncIntrinsicRatio = () => {
      const width = Number(video.videoWidth);
      const height = Number(video.videoHeight);
      const ratio = width / height;
      if (!Number.isFinite(ratio) || ratio <= 0) return;

      const cacheKey = video.currentSrc || video.src;
      if (cacheKey) videoDimensionCache.set(cacheKey, { width, height });
      const resolved = ratio < 0.85 ? 'portrait' : ratio > 1.15 ? 'landscape' : 'square';
      syncClasses(resolved);
      const exactRatio = `${width} / ${height}`;
      video.style.aspectRatio = exactRatio;
      if (artwork) setAspectRatio(artwork, width, height);
    };

    syncIntrinsicRatio();
    video.addEventListener('loadedmetadata', syncIntrinsicRatio);
  }

  function renderImage(item, project, index = 0) {
    const image = buildImageMedia(
      resolveAssetUrl(item.src),
      item.caption || item.description || project.title || 'Project artwork',
      { eager: index === 0 }
    );
    const entry = buildMediaEntry(image, item.caption || item.description, item.background);
    const artwork = entry.querySelector('.lightbox-artwork');
    const sourceUrl = resolveAssetUrl(item.src);
    let imageSettled = false;
    const applyIntrinsicRatio = () => {
      const cached = imageDimensionCache.get(sourceUrl);
      setAspectRatio(
        artwork,
        cached?.width || image.naturalWidth,
        cached?.height || image.naturalHeight
      );
    };
    const onImageLoad = () => {
      if (artwork.dataset.mediaState === 'ready') return;
      imageSettled = true;
      applyIntrinsicRatio();
      // load can precede the browser's decode/paint work. Keep the loading
      // treatment until decode settles so cached and network images share the
      // same successful-ready handoff.
      Promise.resolve()
        .then(() => typeof image.decode === 'function' ? image.decode() : undefined)
        .catch(() => {})
        .then(() => {
          if (destroyed || artwork.dataset.mediaState === 'error') return;
          applyIntrinsicRatio();
          captureAssetPreview(sourceUrl, image, { documentRef, type: 'image' });
          installAssetPreviewOnFallback(
            artwork.querySelector?.('.lightbox-media-fallback'),
            sourceUrl,
            { documentRef, imageClass: 'lightbox-media-fallback-image' }
          );
          markArtworkReady(artwork);
          clearLightboxMediaFallback(artwork);
        });
    };
    const onImageError = () => {
      imageSettled = true;
      markArtworkError(artwork);
      showLightboxMediaFallback(artwork, project, item.src, 'image', 'error');
    };
    image.addEventListener('load', onImageLoad);
    image.addEventListener('error', onImageError);
    if (image.complete) {
      if (Number(image.naturalWidth) > 0) onImageLoad();
      else onImageError();
    } else {
      applyIntrinsicRatio();
    }
    registerLightboxMediaCleanup(image, () => {
      image.removeEventListener('load', onImageLoad);
      image.removeEventListener('error', onImageError);
      clearLightboxMediaFallback(artwork);
    });

    if (normalizeHolographicConfig(item.holographic)) {
      const holographic = buildHolographicImage(image, item, project);
      if (holographic) {
        artwork.classList.add('has-holographic');
        artwork.replaceChildren(holographic);
        const hint = holographic.__lightboxHoloHint;
        if (hint) {
          const caption = entry.querySelector('.media-caption');
          if (caption) caption.before(hint);
          else entry.appendChild(hint);
        }
      }
    }

    if (imageSettled && !(Number(image.naturalWidth) > 0)) {
      // Applying the holographic wrapper can replace artwork children. Reassert
      // the error fallback afterward for an already-failed cached image.
      markArtworkError(artwork);
      showLightboxMediaFallback(artwork, project, item.src, 'image', 'error');
    } else if (artwork.dataset.mediaState !== 'ready') {
      showLightboxMediaFallback(artwork, project, item.src, 'image', 'loading', item.preview || '');
    }

    return entry;
  }

  function renderYouTube(item, project, index = 0) {
    const parsed = parseYouTube(item.src);
    const isShort = Boolean(parsed?.isShort);
    // Use only a CMS-provided preview for embedded videos. Do not introduce
    // a new external thumbnail request during Lightbox loading.
    const youtubePreview = String(item.preview || '').trim();
    const embedSrc = buildYouTubeEmbedUrl(item.src);
    if (!embedSrc) return renderUnsupported(item, project);

    // Promote the newly requested player to the sole playback owner before
    // reusing a cached iframe. This covers the hidden-preload lifecycle as well
    // as the active Lightbox subtree, preventing stale audio overlap on reopen.
    pauseOtherPlayback(null);

    let iframe = takeCachedYouTubeFrame(embedSrc);

    if (!iframe) {
      iframe = documentRef.createElement('iframe');
      iframe.dataset.lmYoutube = 'true';
      iframe.dataset.lmYoutubeCacheKey = embedSrc;
      iframe.frameBorder = '0';
      // Lightbox media is opened only after explicit user intent. Keep every
      // YouTube iframe eager so a secondary-media tap never races a lazy-load
      // decision on mobile; fetch priority still favors the first item.
      iframe.loading = 'eager';
      if (index === 0) iframe.fetchPriority = 'high';
      iframe.tabIndex = 0;
      iframe.title = item.caption || item.description || project.title || 'Project video';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.addEventListener('load', () => {
        iframe.dataset.lmYoutubeLoaded = 'true';
        const artwork = iframe.closest?.('.lightbox-artwork');
        if (artwork) {
          markArtworkReady(artwork);
          clearLightboxMediaFallback(artwork);
        }
        primeYouTubeFrame(iframe);
        // A newly created frame is cached only after a successful load. This
        // prevents a failed player from becoming a poisoned cache entry.
        cacheYouTubeFrame(embedSrc, iframe);
      }, { once: true });
      iframe.addEventListener('error', () => {
        if (youtubeFrameCache.get(embedSrc) === iframe) youtubeFrameCache.delete(embedSrc);
        iframe.dataset.lmYoutubeLoadError = 'true';
        const artwork = iframe.closest?.('.lightbox-artwork');
        if (artwork) showLightboxMediaFallback(artwork, project, item.src, 'youtube', 'error', youtubePreview);
      }, { once: true });
      iframe.src = embedSrc;
    } else {
      iframe.tabIndex = 0;
      iframe.title = item.caption || item.description || project.title || 'Project video';
      // Explicit Lightbox entry is already user intent. Keep cached
      // players eager on reuse too, so the first tap/click never re-enters a
      // lazy-loading state after the frame has been moved through the cache.
      iframe.loading = 'eager';
      iframe.fetchPriority = index === 0 ? 'high' : 'auto';
    }

    const orientation = String(item.orientation || '').toLowerCase();
    const resolvedOrientation = isShort ? 'portrait' : (orientation || 'landscape');
    iframe.classList.remove('yt-landscape', 'yt-portrait', 'yt-square');
    if (resolvedOrientation === 'portrait') iframe.classList.add('yt-portrait');
    else if (resolvedOrientation === 'square') iframe.classList.add('yt-square');
    else iframe.classList.add('yt-landscape');

    const entry = buildMediaEntry(iframe, item.caption || item.description, item.background);
    const artwork = entry.querySelector('.lightbox-artwork');
    artwork?.classList.add('is-youtube-artwork');
    artwork?.setAttribute('data-youtube-orientation', resolvedOrientation);
    if (iframe.dataset.lmYoutubeLoaded !== 'true' && iframe.dataset.lmYoutubeLoadError !== 'true') {
      showLightboxMediaFallback(artwork, project, item.src, 'youtube', 'loading', youtubePreview);
    }
    if (iframe.dataset.lmYoutubeLoadError === 'true') {
      markArtworkError(artwork);
      showLightboxMediaFallback(artwork, project, item.src, 'youtube', 'error');
    } else if (iframe.dataset.lmYoutubeLoaded === 'true') {
      markArtworkReady(artwork);
    }
    if (resolvedOrientation === 'portrait') setAspectRatio(artwork, 9, 16);
    else if (resolvedOrientation === 'square') setAspectRatio(artwork, 1, 1);
    else setAspectRatio(artwork, 16, 9);
    return entry;
  }

  function renderVideo(item, index = 0, project = {}) {
    const video = documentRef.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = index === 0 ? 'auto' : 'metadata';
    if (index === 0) video.fetchPriority = 'high';
    video.controlsList = 'nodownload';
    video.disablePictureInPicture = true;
    video.src = resolveAssetUrl(item.src);

    if (protectionEnabled()) {
      video.classList.add('no-save');
      video.addEventListener('contextmenu', event => event.preventDefault());
    }

    const entry = buildMediaEntry(video, item.caption || item.description, item.background);
    const artwork = entry.querySelector('.lightbox-artwork');
    artwork?.classList.add('is-local-video-artwork');
    applyVideoOrientation(
      video,
      String(item.orientation || '').toLowerCase(),
      artwork
    );
    const onVideoReady = () => {
      const sourceUrl = resolveAssetUrl(item.src);
      captureAssetPreview(sourceUrl, video, { documentRef, type: 'video' });
      installAssetPreviewOnFallback(
        artwork.querySelector?.('.lightbox-media-fallback'),
        sourceUrl,
        { documentRef, imageClass: 'lightbox-media-fallback-image' }
      );
      markArtworkReady(artwork);
      clearLightboxMediaFallback(artwork);
    };
    const onVideoError = () => {
      markArtworkError(artwork);
      showLightboxMediaFallback(artwork, project, item.src, 'video', 'error');
    };
    video.addEventListener('loadeddata', onVideoReady);
    video.addEventListener('canplay', onVideoReady);
    video.addEventListener('error', onVideoError);
    showLightboxMediaFallback(artwork, project, item.src, 'video', 'loading', item.preview || item.poster || '');
    if (video.error) onVideoError();
    else if (video.readyState >= 2) onVideoReady();
    registerLightboxMediaCleanup(video, () => {
      video.removeEventListener('loadeddata', onVideoReady);
      video.removeEventListener('canplay', onVideoReady);
      video.removeEventListener('error', onVideoError);
      clearLightboxMediaFallback(artwork);
    });
    return entry;
  }

  function renderMuxVideo(item, index = 0, project = {}) {
    const playbackId = String(item?.playbackId || '').trim();
    if (!playbackId) return renderUnsupported(item, project);
    const player = documentRef.createElement('mux-player');
    player.classList.add('lightbox-mux-player');
    player.setAttribute('stream-type', 'on-demand');
    player.setAttribute('metadata-video-title', String(item.caption || item.description || project.title || 'Portfolio video'));
    player.setAttribute('playsinline', '');
    player.setAttribute('preload', index === 0 ? 'auto' : 'metadata');
    player.controls = true;
    player.playsInline = true;
    const poster = String(item.poster || item.src || '').trim();
    const previewSource = `https://stream.mux.com/${playbackId}.m3u8`;
    const thumbnailValue = project?.thumbnail;
    const thumbnailRaw = String(
      (typeof thumbnailValue === 'string' ? thumbnailValue : thumbnailValue?.src) || ''
    ).trim();
    const projectThumbnailIdentity = thumbnailRaw
      ? mediaSourceIdentity(resolveAssetUrl(thumbnailRaw))
      : '';
    const resolvedPoster = poster ? resolveAssetUrl(poster) : '';
    const safePoster = resolvedPoster && mediaSourceIdentity(resolvedPoster) !== projectThumbnailIdentity
      ? poster
      : '';
    if (safePoster) player.setAttribute('poster', resolveAssetUrl(safePoster));
    if (protectionEnabled()) {
      player.classList.add('no-save');
      player.addEventListener('contextmenu', event => event.preventDefault());
    }

    const entry = buildMediaEntry(player, item.caption || item.description, item.background);
    const artwork = entry.querySelector('.lightbox-artwork');
    artwork?.classList.add('is-mux-video-artwork');
    const ratio = String(item.aspectRatio || '').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (ratio && Number(ratio[1]) > 0 && Number(ratio[2]) > 0) {
      setAspectRatio(artwork, Number(ratio[1]), Number(ratio[2]));
    } else {
      const orientation = String(item.orientation || '').toLowerCase();
      if (orientation === 'portrait') setAspectRatio(artwork, 9, 16);
      else if (orientation === 'square') setAspectRatio(artwork, 1, 1);
      else setAspectRatio(artwork, 16, 9);
    }

    let disposed = false;
    let loadTimer = null;
    const onReady = () => {
      if (disposed || destroyed || !player.isConnected) return;
      if (loadTimer !== null) {
        windowRef?.clearTimeout?.(loadTimer);
        loadTimer = null;
      }
      captureAssetPreview(previewSource, player, { documentRef, type: 'video' });
      installAssetPreviewOnFallback(
        artwork.querySelector?.('.lightbox-media-fallback'),
        previewSource,
        { documentRef, imageClass: 'lightbox-media-fallback-image' }
      );
      markArtworkReady(artwork);
      clearLightboxMediaFallback(artwork);
    };
    const onError = () => {
      if (disposed || destroyed) return;
      markArtworkError(artwork);
      if (loadTimer !== null) {
        windowRef?.clearTimeout?.(loadTimer);
        loadTimer = null;
      }
      showLightboxMediaFallback(artwork, project, poster || item.src || '', 'video', 'error', poster);
    };
    player.addEventListener('loadeddata', onReady);
    player.addEventListener('canplay', onReady);
    player.addEventListener('playing', onReady);
    player.addEventListener('error', onError);
    // Use a playback-specific key so a cached project thumbnail can never be
    // mistaken for a preview frame of the Mux video itself.
    showLightboxMediaFallback(artwork, project, previewSource, 'video', 'loading', safePoster);

    const activatePlayer = async () => {
      try {
        const ready = await ensureMuxPlayer();
        if (disposed || destroyed || !player.isConnected) return;
        if (!ready || !windowRef?.customElements?.get?.('mux-player')) {
          onError();
          return;
        }
        player.setAttribute('playback-id', playbackId);
        loadTimer = windowRef?.setTimeout?.(() => {
          loadTimer = null;
          if (!disposed && !destroyed && player.isConnected) onError();
        }, 15000) ?? null;
      } catch (_) {
        onError();
      }
    };
    // The grid only carries a poster. The Mux player is initialized after an
    // explicit project-card activation mounts the lightbox media.
    void activatePlayer();
    registerLightboxMediaCleanup(player, () => {
      disposed = true;
      if (loadTimer !== null) {
        windowRef?.clearTimeout?.(loadTimer);
        loadTimer = null;
      }
      player.removeEventListener('loadeddata', onReady);
      player.removeEventListener('canplay', onReady);
      player.removeEventListener('playing', onReady);
      player.removeEventListener('error', onError);
      try { player.pause?.(); } catch (_) {}
      player.removeAttribute('playback-id');
      clearLightboxMediaFallback(artwork);
    });
    return entry;
  }

  function renderModel(item, project) {
    const modelWrap = documentRef.createElement('div');
    modelWrap.className = 'model-viewer-shell lightbox-model-viewer';
    const orientation = String(item.orientation || '').toLowerCase() || 'auto';
    modelWrap.setAttribute('data-orientation', orientation);
    modelWrap.setAttribute('aria-label', `${project.title || 'Project'} — 3D artwork preview`);

    // 3D owns its own background because the model shell becomes fixed
    // during focus. The caption remains outside the full-screen model shell.
    const modelEntry = buildMediaEntry(modelWrap, item.caption || item.description, null);
    modelEntry.classList.add('is-3d-media-item');
    const modelArtwork = modelEntry.querySelector('.lightbox-artwork');
    const modelSourceUrl = resolveAssetUrl(item.src);
    // Cached previews are optional; first loads retain the current 3D loader.
    if (getAssetPreview(modelSourceUrl)) showLightboxMediaFallback(modelArtwork, project, item.src, 'model', 'loading');
    let modelFocusPlaceholder = null;
    let modelFocusOverlay = null;
    let modelFocusScrollTop = 0;
    let previousOverflowAnchor = null;
    let modelFocusScrollSpacer = null;
    const restoreModelFocusScroll = targetScrollTop => {
      if (!lightbox?.isConnected) return;
      const desired = Math.max(0, Number(targetScrollTop) || 0);
      let maximum = Math.max(0, lightbox.scrollHeight - lightbox.clientHeight);
      if (desired > maximum + 1) {
        const mediaContainer = documentRef.getElementById('lightboxMediaContainer');
        if (mediaContainer?.isConnected) {
          if (!modelFocusScrollSpacer?.isConnected) {
            modelFocusScrollSpacer = documentRef.createElement('div');
            modelFocusScrollSpacer.className = 'lightbox-3d-scroll-preservation-spacer';
            modelFocusScrollSpacer.setAttribute('aria-hidden', 'true');
            modelFocusScrollSpacer.style.width = '100%';
            modelFocusScrollSpacer.style.height = '0px';
            modelFocusScrollSpacer.style.flex = '0 0 auto';
            modelFocusScrollSpacer.style.visibility = 'hidden';
            modelFocusScrollSpacer.style.pointerEvents = 'none';
            mediaContainer.appendChild(modelFocusScrollSpacer);
          }
          const currentSpacerHeight = Number.parseFloat(modelFocusScrollSpacer.style.height) || 0;
          modelFocusScrollSpacer.style.height = (currentSpacerHeight + desired - maximum) + 'px';
          maximum = Math.max(0, lightbox.scrollHeight - lightbox.clientHeight);
          const remaining = desired - maximum;
          if (remaining > 1) {
            const adjustedSpacerHeight = Number.parseFloat(modelFocusScrollSpacer.style.height) || 0;
            modelFocusScrollSpacer.style.height = (adjustedSpacerHeight + remaining) + 'px';
          }
        }
      }
      lightbox.scrollTop = desired;
    };

    if (typeof mountModelViewer !== 'function') {
      modelWrap.innerHTML = '<div class="model-viewer-error model-viewer-fallback" role="img" aria-label="3D artwork"><i class="fa-solid fa-cube" aria-hidden="true"></i><span>3D ARTWORK</span></div>';
      markArtworkError(modelEntry.querySelector('.lightbox-artwork'));
      return modelEntry;
    }

    Promise.resolve()
      .then(() => {
        if (!modelWrap.isConnected || !lightbox?.classList.contains('active')) return null;

        return mountModelViewer(modelWrap, resolveAssetUrl(item.src), {
          autoRotate: false,
          background: item.background || null,
          orientation,
          resolveUrl: resolveAssetUrl,
          onAspectRatioDetected: (width, height) => {
            setAspectRatio(modelEntry.querySelector('.lightbox-artwork'), width, height);
          },
          onActivate: () => {
            modelFocusScrollTop = Number(lightbox?.scrollTop) || 0;
            if (lightbox && previousOverflowAnchor === null) {
              previousOverflowAnchor = lightbox.style.overflowAnchor;
              lightbox.style.overflowAnchor = 'none';
            }
            // Keep a same-size in-flow placeholder while the viewer becomes
            // viewport-fixed. That preserves the Lightbox's scroll geometry
            // instead of letting its scrollTop clamp when this item leaves flow.
            if (!modelFocusPlaceholder && modelEntry.parentNode) {
              const rect = modelEntry.getBoundingClientRect();
              const placeholder = documentRef.createElement('div');
              placeholder.className = 'lightbox-3d-focus-placeholder';
              placeholder.setAttribute('aria-hidden', 'true');
              placeholder.style.width = Math.ceil(rect.width) + 'px';
              placeholder.style.height = Math.ceil(rect.height) + 'px';
              placeholder.style.flex = '0 0 auto';
              placeholder.style.boxSizing = 'border-box';
              placeholder.style.visibility = 'hidden';
              placeholder.style.pointerEvents = 'none';
              modelFocusPlaceholder = placeholder;
              modelEntry.parentNode.insertBefore(placeholder, modelEntry);
            }
            if (!modelFocusOverlay) {
              modelFocusOverlay = documentRef.createElement('div');
              modelFocusOverlay.className = 'lightbox-3d-focus-overlay';
              modelFocusOverlay.setAttribute('role', 'dialog');
              modelFocusOverlay.setAttribute('aria-modal', 'true');
              modelFocusOverlay.setAttribute('aria-label', `Inspect ${project.title || '3D artwork'}`);
              documentRef.body.appendChild(modelFocusOverlay);
            }
            modelFocusOverlay.appendChild(modelEntry);
            lightbox.classList.add('is-3d-focused');
            modelEntry.classList.add('is-3d-focus-target');
            if (lightboxControls) {
              lightboxControls.classList.add('is-3d-controls-disabled');
              lightboxControls.inert = true;
            }
            documentRef.documentElement.classList.add('lm-3d-focus-open');
            documentRef.body.classList.add('lm-3d-focus-open');
          },
          onDeactivate: () => {
            const scrollTarget = modelFocusScrollTop;
            modelEntry.classList.remove('is-3d-focus-target');
            if (modelFocusPlaceholder?.parentNode) modelFocusPlaceholder.replaceWith(modelEntry);
            modelFocusPlaceholder = null;
            modelFocusOverlay?.remove();
            modelFocusOverlay = null;
            lightbox?.classList.remove('is-3d-focused');
            if (lightboxControls) {
              lightboxControls.classList.remove('is-3d-controls-disabled');
              lightboxControls.inert = false;
            }
            documentRef.documentElement.classList.remove('lm-3d-focus-open');
            documentRef.body.classList.remove('lm-3d-focus-open');

            // A loaded model can refine its passive aspect ratio while it is
            // focused. If that shortens the gallery near its bottom, retain a
            // hidden trailing spacer so the original scroll offset remains
            // reachable instead of clamping to the new maximum.
            restoreModelFocusScroll(scrollTarget);
            windowRef.requestAnimationFrame(() => {
              restoreModelFocusScroll(scrollTarget);
              windowRef.requestAnimationFrame(() => {
                restoreModelFocusScroll(scrollTarget);
                if (lightbox && previousOverflowAnchor !== null) {
                  lightbox.style.overflowAnchor = previousOverflowAnchor;
                  previousOverflowAnchor = null;
                }
              });
            });
          }
        });
      })
      .then(cleanup => {
        if (!cleanup) {
          if (modelWrap.isConnected) markArtworkError(modelEntry.querySelector('.lightbox-artwork'));
          return;
        }
        // mountModelViewer is async. The Lightbox may have navigated or closed
        // while the model loader was waiting on the asset. Never keep a WebGL
        // viewer alive for a detached media item.
        if (!modelWrap.isConnected || !lightbox?.classList.contains('active')) {
          try { cleanup?.(); } catch (_) {}
          return;
        }
        captureAssetPreview(modelSourceUrl, modelWrap, { documentRef, type: 'model' });
        // The initial heavy 3D load keeps its normal viewer loader; use a
        // same-source raster only when a safely drawable frame exists.
        installAssetPreviewOnFallback(
          modelArtwork.querySelector?.('.lightbox-media-fallback'),
          modelSourceUrl,
          { documentRef, imageClass: 'lightbox-media-fallback-image' }
        );
        markArtworkReady(modelArtwork);
        clearLightboxMediaFallback(modelArtwork);
      })
      .catch(error => {
        if (!modelWrap.isConnected) return;
        modelWrap.innerHTML = '<div class="model-viewer-error model-viewer-fallback" role="img" aria-label="3D artwork"><i class="fa-solid fa-cube" aria-hidden="true"></i><span>3D ARTWORK</span></div>';
        markArtworkError(modelEntry.querySelector('.lightbox-artwork'));
        console.warn('3D model viewer:', error);
      });

    return modelEntry;
  }

  function renderLottie(item, project = {}) {
    const resolvedSrc = resolveAssetUrl(item.src);
    const player = documentRef.createElement('lottie-player');
    player.setAttribute('autoplay', '');
    player.setAttribute('loop', '');
    player.setAttribute('background', 'transparent');

    const orientation = String(item.orientation || '').toLowerCase();
    if (orientation === 'portrait') player.classList.add('yt-portrait');
    else if (orientation === 'square') player.classList.add('yt-square');
    else player.classList.add('yt-landscape');

    // The artwork surface owns the intrinsic aspect-ratio box. Do not set src
    // until the upgraded custom element is connected; lottie-player measures
    // its viewport during initialization. Use its public load() after src is
    // assigned so an already-upgraded element reliably starts fetching JSON.
    player.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    player.preserveAspectRatio = 'xMidYMid meet';
    const entry = buildMediaEntry(player, item.caption || item.description, item.background);
    const artwork = entry.querySelector('.lightbox-artwork');
    artwork?.classList.add('is-lottie-artwork');
    showLightboxMediaFallback(artwork, project, item.src, 'lottie', 'loading');

    const dimensions = lottieDimensionCache.get(resolvedSrc);
    if (dimensions) {
      setAspectRatio(artwork, dimensions.width, dimensions.height);
    } else {
      void resolveLottieDimensions(resolvedSrc).then(resolved => {
        if (!resolved || destroyed || !artwork?.isConnected) return;
        setAspectRatio(artwork, resolved.width, resolved.height);
      });
    }

    let disposed = false;
    let frameId = null;
    let frameIsTimer = false;
    let loadTimer = null;
    let playerTimer = null;
    let startAttempts = 0;
    const clearLoadTimer = () => {
      if (loadTimer !== null) {
        (windowRef?.clearTimeout || globalThis.clearTimeout)?.call(windowRef || globalThis, loadTimer);
        loadTimer = null;
      }
      if (playerTimer !== null) {
        (windowRef?.clearTimeout || globalThis.clearTimeout)?.call(windowRef || globalThis, playerTimer);
        playerTimer = null;
      }
    };
    const clearFrame = () => {
      if (frameId === null) return;
      if (frameIsTimer) (windowRef?.clearTimeout || globalThis.clearTimeout)?.call(windowRef || globalThis, frameId);
      else windowRef?.cancelAnimationFrame?.(frameId);
      frameId = null;
      frameIsTimer = false;
    };
    const onReady = () => {
      if (disposed || destroyed || !player.isConnected || !artwork?.isConnected) return;
      const animation = player.getLottie?.();
      const svg = player.shadowRoot?.querySelector?.('svg');
      if (!animation || !svg) {
        // Some player versions dispatch ready before the first SVG paint. Retry
        // briefly without marking the thumbnail visible while the surface is blank.
        scheduleReadyCheck();
        return;
      }
      clearLoadTimer();
      // Some renderers expose a drawable canvas; SVG-only or tainted paths
      // simply keep the existing lightweight loading surface.
      captureAssetPreview(resolvedSrc, player, { documentRef, type: 'lottie' });
      installAssetPreviewOnFallback(
        artwork.querySelector?.('.lightbox-media-fallback'),
        resolvedSrc,
        { documentRef, imageClass: 'lightbox-media-fallback-image' }
      );
      markArtworkReady(artwork);
      clearLightboxMediaFallback(artwork);
      const loadedDimensions = lottieDimensionCache.get(resolvedSrc);
      if (loadedDimensions) setAspectRatio(artwork, loadedDimensions.width, loadedDimensions.height);
    };
    const onError = () => {
      if (disposed || destroyed) return;
      clearLoadTimer();
      markArtworkError(artwork);
      showLightboxMediaFallback(artwork, project, item.src, 'lottie', 'error');
    };
    let readyAttempts = 0;
    let readyFrameId = null;
    const scheduleReadyCheck = () => {
      if (disposed || destroyed || readyFrameId !== null) return;
      const check = () => {
        readyFrameId = null;
        readyAttempts += 1;
        onReady();
        if (readyAttempts < 8 && artwork?.querySelector?.('.lightbox-media-fallback')) {
          readyFrameId = typeof windowRef?.requestAnimationFrame === 'function'
            ? windowRef.requestAnimationFrame(check)
            : (windowRef?.setTimeout || globalThis.setTimeout).call(windowRef || globalThis, check, 80);
        }
      };
      readyFrameId = typeof windowRef?.requestAnimationFrame === 'function'
        ? windowRef.requestAnimationFrame(check)
        : (windowRef?.setTimeout || globalThis.setTimeout).call(windowRef || globalThis, check, 80);
    };
    player.addEventListener('ready', onReady);
    player.addEventListener('error', onError);

    const activate = () => {
      frameId = null;
      frameIsTimer = false;
      if (disposed || destroyed) return;
      if (!player.isConnected || !artwork?.isConnected) {
        startAttempts += 1;
        if (startAttempts < 120) {
          frameIsTimer = typeof windowRef?.requestAnimationFrame !== 'function';
          frameId = frameIsTimer
            ? (windowRef?.setTimeout || globalThis.setTimeout).call(windowRef || globalThis, activate, 16)
            : windowRef.requestAnimationFrame(activate);
        } else {
          onError();
        }
        return;
      }
      const loadPlayer = async () => {
        let available = Boolean(windowRef?.customElements?.get?.('lottie-player'));
        if (!available) {
          try {
            const { ensureLottiePlayer } = await import('../../infrastructure/lottie/player.js');
            const loader = Promise.resolve().then(() => ensureLottiePlayer());
            playerTimer = (windowRef?.setTimeout || globalThis.setTimeout).call(windowRef || globalThis, () => {
              playerTimer = null;
              if (disposed || destroyed || !player.isConnected || !artwork?.isConnected) return;
              markArtworkError(artwork);
              showLightboxMediaFallback(artwork, project, item.src, 'lottie', 'error');
              artwork.dataset.mediaState = 'error';
            }, 6000);
            // Do not race the loader against a terminal false value. The timer
            // only exposes a fallback; if the shared player loads late, keep
            // going and let the normal Lottie ready/error lifecycle settle it.
            available = await loader;
            if (playerTimer !== null) {
              (windowRef?.clearTimeout || globalThis.clearTimeout)?.call(windowRef || globalThis, playerTimer);
              playerTimer = null;
            }
          } catch (_) {
            available = false;
          }
        }
        if (disposed || destroyed || !player.isConnected || !artwork?.isConnected) return;
        if (!available || !windowRef?.customElements?.get?.('lottie-player')) {
          onError();
          return;
        }
        artwork.dataset.mediaState = 'loading';
        player.setAttribute('src', resolvedSrc);
        try { player.load?.(resolvedSrc); } catch (_) {}
        loadTimer = (windowRef?.setTimeout || globalThis.setTimeout).call(windowRef || globalThis, onError, 12000);
      };
      void loadPlayer().catch(onError);
    };
    frameIsTimer = typeof windowRef?.requestAnimationFrame !== 'function';
    frameId = frameIsTimer
      ? (windowRef?.setTimeout || globalThis.setTimeout).call(windowRef || globalThis, activate, 0)
      : windowRef.requestAnimationFrame(activate);

    registerLightboxMediaCleanup(player, () => {
      disposed = true;
      clearLoadTimer();
      clearFrame();
      if (readyFrameId !== null) {
        if (typeof windowRef?.cancelAnimationFrame === 'function') windowRef.cancelAnimationFrame(readyFrameId);
        else (windowRef?.clearTimeout || globalThis.clearTimeout)?.call(windowRef || globalThis, readyFrameId);
        readyFrameId = null;
      }
      player.removeEventListener('ready', onReady);
      player.removeEventListener('error', onError);
      try { player.pause?.(); } catch (_) {}
      try { player.removeAttribute('src'); } catch (_) {}
      clearLightboxMediaFallback(artwork);
    });
    return entry;
  }

  function renderUnsupported(item, project) {
    const placeholder = documentRef.createElement('div');
    placeholder.className = 'lightbox-unsupported-media';
    const entry = buildMediaEntry(
      placeholder,
      item?.caption || item?.description,
      item?.background
    );
    const artwork = entry.querySelector('.lightbox-artwork');
    // Keep the gallery item present even when its media type is unknown or the
    // record is malformed. Reuse project artwork when available; otherwise
    // the shared helper renders a stable local artwork placeholder.
    showLightboxMediaFallback(artwork, project, item?.src || '', 'unsupported', 'error');
    markArtworkError(artwork);
    return entry;
  }

  function renderItem(item, project, index = 0) {
    if (!item || typeof item !== 'object') return null;

    const type = String(item.type || 'image').trim().toLowerCase();
    if (type === 'mux') return renderMuxVideo(item, index, project);
    if (!String(item.src || '').trim()) return renderUnsupported(item, project);
    if (type === 'image') return renderImage(item, project, index);
    if (type === 'youtube') return renderYouTube(item, project, index);
    if (type === 'video') return renderVideo(item, index, project);
    if (type === 'model') return renderModel(item, project);
    if (type === 'lottie') return renderLottie(item, project);
    return renderUnsupported(item, project);
  }

  function buildInspectTransform(fromRect, toRect) {
    const from=fromRect||{},to=toRect||{};
    const fw=Number(from.width)||0,fh=Number(from.height)||0,tw=Number(to.width)||0,th=Number(to.height)||0;
    if(!(fw>0&&fh>0&&tw>0&&th>0))return 'translate3d(0,0,0) scale(1,1)';
    const fx=(Number(from.left)||0)+fw/2,fy=(Number(from.top)||0)+fh/2;
    const tx=(Number(to.left)||0)+tw/2,ty=(Number(to.top)||0)+th/2;
    return 'translate3d('+(fx-tx).toFixed(2)+'px,'+(fy-ty).toFixed(2)+'px,0) scale('+(fw/tw).toFixed(4)+','+(fh/th).toFixed(4)+')';
  }
  function prefersReducedInspectMotion() {
    return Boolean(windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  }
  function closeArtworkInspect(options = {}) {
    const active=activeInspector;
    if(!active||active.isClosing)return;
    const immediate=options===true||options?.immediate===true;

    // Inspect Mode is a temporary magnified view, not a persistent flip state.
    // Return grouped artwork to FRONT whenever Inspect is exited via Back,
    // Escape, or the backdrop.
    const foilSurface=active.entry?.querySelector('.lightbox-holographic');
    if(foilSurface){
      foilSurface.classList.remove('is-flipped');
      foilSurface.setAttribute('aria-pressed','false');
    }
    const faceLabel=active.foilHint?.querySelector('[data-holo-face-label]');
    if(faceLabel)faceLabel.textContent='FRONT';

    const finishClose=()=>{
      if(activeInspector!==active)return;
      activeInspector=null;
      active.overlay.removeEventListener('click',active.onBackdropClick);
      active.overlay.removeEventListener('keydown',active.onKeyDown);
      try{active.openAnimation?.cancel?.();}catch(_){}
      try{active.overlayAnimation?.cancel?.();}catch(_){}
      if(active.placeholder?.parentNode)active.placeholder.replaceWith(active.entry);
      if(active.foilHintPlaceholder?.parentNode&&active.foilHint)active.foilHintPlaceholder.replaceWith(active.foilHint);
      active.overlay.remove();
      active.restoreLightboxScroll?.();
      windowRef.requestAnimationFrame(()=>{active.restoreLightboxScroll?.();windowRef.requestAnimationFrame(()=>active.restoreLightboxScroll?.());});

      // Keyboard closure returns focus to the originating group item. Avoid a
      // persistent card-sized ring at that handoff, but restore normal focus
      // indication as soon as the user navigates or interacts again.
      const focusTarget=active.focusTarget;
      if(options?.viaKeyboard&&focusTarget?.classList?.contains('is-grouped-artwork-interactive')){
        focusTarget.classList.add('is-inspect-focus-return');
        const clearFocusReturn=()=>{
          focusTarget.classList.remove('is-inspect-focus-return');
          focusTarget.removeEventListener('keydown',clearFocusReturn,true);
          focusTarget.removeEventListener('pointerdown',clearFocusReturn,true);
          focusTarget.removeEventListener('focusout',clearFocusReturn);
        };
        focusTarget.addEventListener('keydown',clearFocusReturn,true);
        focusTarget.addEventListener('pointerdown',clearFocusReturn,true);
        focusTarget.addEventListener('focusout',clearFocusReturn,{once:true});
      }
      try{focusTarget?.focus?.({preventScroll:true});}
      catch(_){try{focusTarget?.focus?.();}catch(__){}}
    };
    if(!immediate&&!prefersReducedInspectMotion()&&typeof active.frame?.animate==='function'&&active.placeholder?.isConnected){
      const currentRect=active.frame.getBoundingClientRect?.(),returnRect=active.placeholder.getBoundingClientRect?.();
      if(currentRect?.width>0&&returnRect?.width>0){
        active.isClosing=true;
        try{
          try{active.openAnimation?.cancel?.();}catch(_){}
          active.overlay.classList.add('is-closing');
          try{active.overlayAnimation=active.overlay.animate([{opacity:1},{opacity:0}],{duration:300,easing:'cubic-bezier(.4,0,1,1)',fill:'both'});}catch(_){}
          const animation=active.frame.animate([
            {transform:'translate3d(0,0,0) scale(1,1)'},
            {transform:buildInspectTransform(returnRect,currentRect)}
          ],{duration:300,easing:'cubic-bezier(.4,0,1,1)',fill:'both'});
          active.closeAnimation=animation;
          animation.onfinish=finishClose;
          animation.oncancel=finishClose;
          return;
        }catch(_){}
      }
    }
    finishClose();
  }
  function openArtworkInspect(container, entry, project, focusTarget) {
    if(!entry?.parentNode||!container)return;
    if(activeInspector)closeArtworkInspect({immediate:true});
    const parent=entry.parentNode,originRect=entry.getBoundingClientRect?.();
    const lightbox=container.closest?.('#lightbox')||documentRef.getElementById('lightbox');
    const lightboxScrollTop=Number(lightbox?.scrollTop)||0;
    const restoreLightboxScroll=()=>{if(lightbox&&lightbox.isConnected)lightbox.scrollTop=lightboxScrollTop;};
    const foilHint=entry.querySelector('.lightbox-holographic-hint');
    let foilHintPlaceholder=null;
    if(foilHint?.parentNode){
      foilHintPlaceholder=documentRef.createElement('span');
      foilHintPlaceholder.className='lightbox-inspect-hint-placeholder';
      foilHintPlaceholder.hidden=true;
      foilHintPlaceholder.setAttribute('aria-hidden','true');
      foilHint.parentNode.insertBefore(foilHintPlaceholder,foilHint);
    }
    const placeholder=documentRef.createElement('div');
    placeholder.className='lightbox-inspect-placeholder';

    // The Inspector moves the original media item out of its flex/grid group.
    // Keep the placeholder's *layout box* (not the transformed visual bounds)
    // and the layout properties that determine wrapping/overlap. getBoundingClientRect
    // includes rotation and hover transforms, so using it as width/height makes
    // a layered foil card consume extra flex space and can wrap the last sibling.
    const entryStyle=windowRef?.getComputedStyle?.(entry);
    const layoutWidth=Number(entry.offsetWidth)||Number.parseFloat(entryStyle?.width)||originRect?.width||0;
    const layoutHeight=Number(entry.offsetHeight)||Number.parseFloat(entryStyle?.height)||originRect?.height||0;
    placeholder.style.boxSizing='border-box';
    if(layoutWidth>0)placeholder.style.width=layoutWidth+'px';
    if(layoutHeight>0)placeholder.style.height=layoutHeight+'px';
    if(entryStyle){
      placeholder.style.flex=entryStyle.flex;
      placeholder.style.order=entryStyle.order;
      placeholder.style.alignSelf=entryStyle.alignSelf;
      placeholder.style.justifySelf=entryStyle.justifySelf;
      placeholder.style.minWidth=entryStyle.minWidth;
      placeholder.style.maxWidth=entryStyle.maxWidth;
      placeholder.style.minHeight=entryStyle.minHeight;
      placeholder.style.maxHeight=entryStyle.maxHeight;
      placeholder.style.marginBlockStart=entryStyle.marginBlockStart;
      placeholder.style.marginBlockEnd=entryStyle.marginBlockEnd;
      placeholder.style.marginInlineStart=entryStyle.marginInlineStart;
      placeholder.style.marginInlineEnd=entryStyle.marginInlineEnd;
      // Transform doesn't affect flex sizing, but keeps the invisible placeholder's
      // visual rectangle aligned with the card for the closing transition.
      placeholder.style.transform=entryStyle.transform;
      placeholder.style.transformOrigin=entryStyle.transformOrigin;
    }
    placeholder.setAttribute('aria-hidden','true');
    parent.insertBefore(placeholder,entry);

    const overlay=documentRef.createElement('div');
    overlay.className='lightbox-inspect-mode';
    overlay.dataset.inspectMode='true';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-label','Inspect artwork in '+String(project.title||'this project'));
    const panel=documentRef.createElement('div');
    panel.className='lightbox-inspect-panel';
    const stage=documentRef.createElement('div');
    stage.className='lightbox-inspect-stage';
    const frame=documentRef.createElement('div');
    frame.className='lightbox-inspect-frame';
    frame.appendChild(entry);

    const footer=documentRef.createElement('div');
    footer.className='lightbox-inspect-footer';
    const caption=String(entry.querySelector('.media-caption')?.textContent||'').trim();
    const description=documentRef.createElement('p');
    description.className='lightbox-inspect-description';
    // A grouped artwork owns its own caption. Do not fall back to project title
    // or project description, and do not repeat the same caption in two fields.
    description.textContent=caption;
    description.hidden=!caption;
    const back=documentRef.createElement('button');
    back.type='button';
    back.className='model-viewer-back lightbox-inspect-back';
    back.innerHTML='<i class="fa-solid fa-arrow-left" aria-hidden="true"></i>';
    back.setAttribute('aria-label','Close Inspect Mode and return to the artwork group');
    back.addEventListener('click',event=>closeArtworkInspect({viaKeyboard:event.detail===0}));
    stage.appendChild(frame);
    if(foilHint)footer.appendChild(foilHint);
    footer.append(description,back);
    panel.append(stage,footer);
    overlay.appendChild(panel);
    const onBackdropClick=event=>{if(event.target===overlay)closeArtworkInspect();};
    const onKeyDown=event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeArtworkInspect({viaKeyboard:true});return;}
      if(event.key!=='Tab')return;
      event.stopPropagation();
      const focusables=Array.from(overlay.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]'))
        .filter(node=>!node.closest('[hidden],[inert]'));
      if(!focusables.length){event.preventDefault();back.focus();return;}
      const first=focusables[0],last=focusables[focusables.length-1];
      if(event.shiftKey&&documentRef.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&documentRef.activeElement===last){event.preventDefault();first.focus();}
    };
    overlay.addEventListener('click',onBackdropClick);
    overlay.addEventListener('keydown',onKeyDown);
    const active={container,entry,placeholder,foilHint,foilHintPlaceholder,overlay,frame,lightbox,lightboxScrollTop,restoreLightboxScroll,focusTarget:focusTarget||back,onBackdropClick,onKeyDown,openAnimation:null,overlayAnimation:null,closeAnimation:null,isClosing:false};
    activeInspector=active;
    documentRef.body.appendChild(overlay);
    restoreLightboxScroll();
    windowRef.requestAnimationFrame(()=>{restoreLightboxScroll();windowRef.requestAnimationFrame(restoreLightboxScroll);});
    try{back.focus({preventScroll:true});}catch(_){back.focus?.();}
    const animateOpen=()=>{
      if(activeInspector!==active||prefersReducedInspectMotion())return;
      const targetRect=frame.getBoundingClientRect?.();
      if(!(originRect?.width>0&&targetRect?.width>0)||typeof frame.animate!=='function')return;
      try{
        try{
          active.overlayAnimation=overlay.animate([{opacity:0},{opacity:1}],{duration:360,easing:'cubic-bezier(.16,1,.3,1)',fill:'both'});
          active.overlayAnimation.onfinish=()=>{try{active.overlayAnimation?.cancel?.();}catch(_){}active.overlayAnimation=null;};
        }catch(_){}
        const animation=frame.animate([
          {transform:buildInspectTransform(originRect,targetRect)},
          {transform:'translate3d(0,0,0) scale(1,1)'}
        ],{duration:460,easing:'cubic-bezier(.16,1,.3,1)',fill:'both'});
        active.openAnimation=animation;
        animation.onfinish=()=>{if(activeInspector!==active)return;try{animation.cancel();}catch(_){}active.openAnimation=null;};
      }catch(_){}
    };
    if(typeof windowRef?.requestAnimationFrame==='function')windowRef.requestAnimationFrame(animateOpen);
    else animateOpen();
  }

  function applyStickerCardVariation(record) {
    record.entries.forEach((entry,index) => {
      const source = entry.querySelector('.lightbox-holographic-face img, img, video, iframe')?.getAttribute('src') || '';
      const seedText = String(record.section.dataset.artworkGroup || '') + ':' + index + ':' + source;
      let seed = 2166136261;
      for (let i=0;i<seedText.length;i+=1) {
        seed ^= seedText.charCodeAt(i);
        seed = Math.imul(seed,16777619);
      }
      const stableSeed = seed >>> 0;
      // Map the stable per-card hash across a wider pseudo-random range.
      // The same group/index/source tuple always yields the same angle, even
      // when the group is resized or the surrounding UI re-renders.
      const rotation = Number((((stableSeed / 0xFFFFFFFF) * 2 - 1) * 14).toFixed(2));
      const mobileRotation = Number((rotation * 0.8).toFixed(2));
      const x = ((stableSeed >>> 8) % 9) - 4;
      const y = ((stableSeed >>> 16) % 11) - 5;
      entry.style.setProperty('--artwork-sticker-rotation', rotation + 'deg');
      entry.style.setProperty('--artwork-sticker-rotation-mobile', mobileRotation + 'deg');
      entry.style.setProperty('--artwork-sticker-x', x + 'px');
      entry.style.setProperty('--artwork-sticker-y', y + 'px');
    });
  }

  function centerArtworkGroupRows(record, effectiveLayout, narrowViewport, tabletViewport) {
    const items = record?.items;
    if (!items) return;
    const slots = Array.from(items.children);
    slots.forEach(slot => {
      slot.style.removeProperty('grid-column-start');
      slot.style.removeProperty('--artwork-row-center-shift');
      slot.style.removeProperty('--artwork-layout-layer');
    });
    if (effectiveLayout !== 'cards' && effectiveLayout !== 'sticker') return;

    const columns = effectiveLayout === 'cards'
      ? (narrowViewport ? 3 : (tabletViewport ? 4 : 5))
      : (narrowViewport ? 2 : 3);
    slots.forEach((slot, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const centerBias = Math.round(columns - Math.abs(column - ((columns - 1) / 2)));
      slot.style.setProperty('--artwork-layout-layer', String(row * 10 + centerBias));
    });

    const remainder = slots.length % columns;
    if (!remainder) return;
    const lastRowStart = slots.length - remainder;
    const startColumn = Math.floor((columns - remainder) / 2);
    const shiftHalfTrack = (columns - remainder) % 2 === 1;
    slots.slice(lastRowStart).forEach((slot, index) => {
      slot.style.gridColumnStart = String(startColumn + index + 1);
      if (shiftHalfTrack) slot.style.setProperty('--artwork-row-center-shift', '50%');
    });
  }

  function measureArtworkGroupLayout(record) {
    const {section, items, requestedLayout, entries} = record;
    if (!section?.isConnected || !items) return;

    // Keep the CMS-selected presentation active at every viewport width.
    // The responsive CSS changes column counts; only a single-item group needs
    // a grid fallback because no stack/collage can be formed from one piece.
    const supportedLayouts = new Set(['grid','stack','cards','sticker']);
    const domRequestedLayout = String(section.dataset.artworkLayout || '').trim().toLowerCase();
    const layout = supportedLayouts.has(domRequestedLayout)
      ? domRequestedLayout
      : (supportedLayouts.has(requestedLayout) ? requestedLayout : 'grid');
    const narrowViewport = Boolean(windowRef?.matchMedia?.('(max-width: 760px)')?.matches);
    const tabletViewport = Boolean(windowRef?.matchMedia?.('(max-width: 1000px) and (min-width: 761px)')?.matches);
    const hasEnoughItems = entries.length > 1;

    section.dataset.artworkAllFoil = entries.length > 0 &&
      entries.every(entry => entry.dataset.artworkFoil === 'true') ? 'true' : 'false';

    let effectiveLayout = layout;
    if ((layout === 'cards' || layout === 'sticker') && !hasEnoughItems) {
      effectiveLayout = 'grid';
    }
    section.dataset.artworkEffectiveLayout = effectiveLayout;
    centerArtworkGroupRows(record, effectiveLayout, narrowViewport, tabletViewport);
  }

  function watchArtworkGroupLayout(container, record) {
    const apply = () => measureArtworkGroupLayout(record);
    const onResize = () => apply();
    const Observer = windowRef?.ResizeObserver;
    let observer = null;
    if (typeof Observer === 'function') {
      observer = new Observer(apply);
      observer.observe(record.items);
      record.entries.forEach(entry => {
        const stage = entry.querySelector('.lightbox-artwork');
        if (stage) observer.observe(stage);
      });
    }
    windowRef?.addEventListener?.('resize', onResize, {passive:true});
    const frame = windowRef?.requestAnimationFrame?.(apply);
    const cleanup = () => {
      observer?.disconnect();
      windowRef?.removeEventListener?.('resize', onResize);
      if (frame !== undefined) windowRef?.cancelAnimationFrame?.(frame);
    };
    artworkGroupLayoutCleanups.add({container, cleanup});
    apply();
  }

  function disposeArtworkGroupLayouts(container = null) {
    Array.from(artworkGroupLayoutCleanups).forEach(record => {
      if (container && record.container !== container) return;
      try { record.cleanup(); } catch (_) {}
      artworkGroupLayoutCleanups.delete(record);
    });
  }

  function selectGroupedArtworkEntry(entry, section) {
    if (!entry || !section) return;
    section.querySelectorAll('.lightbox-media-item.is-artwork-selected').forEach(previous => {
      if (previous !== entry) previous.classList.remove('is-artwork-selected');
    });
    entry.classList.add('is-artwork-selected');
  }

  function bindGroupedArtworkInteractions(container, entry, project, section) {
    entry.classList.add('is-grouped-artwork-interactive');
    entry.tabIndex=0;
    const label=String(entry.querySelector('img')?.alt||entry.querySelector('iframe')?.title||entry.querySelector('.media-caption')?.textContent||project.title||'Artwork');
    entry.setAttribute('aria-label',label+'. Activate to view artwork details.');
    const onEntryClick=event=>{
      // In Inspect the foil surface's own click handler is active, so flipping
      // stays available there. In the group, one tap/click opens Inspect.
      if(activeInspector?.entry===entry)return;
      const target=event.target;
      if(target.closest?.('button,a,input,select,textarea,video,mux-player,iframe,.model-viewer-shell,.lightbox-inspect-back'))return;
      event.preventDefault?.();
      event.stopPropagation?.();
      selectGroupedArtworkEntry(entry, section);
      openArtworkInspect(container,entry,project,entry);
    };
    const onEntryKeydown=event=>{
      if(event.target!==entry||!['Enter',' '].includes(event.key))return;
      event.preventDefault();
      selectGroupedArtworkEntry(entry, section);
      openArtworkInspect(container,entry,project,entry);
    };
    entry.addEventListener('click',onEntryClick,true);
    entry.addEventListener('keydown',onEntryKeydown);
    artworkGroupInteractionCleanups.add(()=>{
      entry.removeEventListener('click',onEntryClick,true);
      entry.removeEventListener('keydown',onEntryKeydown);
    });
  }

  function renderProjectMedia(container, project = {}) {
    if (!container) return 0;
    const mediaList = Array.isArray(project.media) && project.media.length
      ? project.media
      : (project.thumbnail?.src ? [{ ...project.thumbnail }] : []);
    const groups = new Map(
      (Array.isArray(project.mediaGroups) ? project.mediaGroups : [])
        .filter(group => group && typeof group === 'object' && String(group.id || '').trim())
        .map(group => [String(group.id), {
          id:String(group.id), name:String(group.name || group.id),
          layout:['grid','stack','cards','sticker'].includes(group.layout) ? group.layout : 'grid'
        }])
    );
    const groupRecords = new Map();
    let rendered = 0;
    container.dataset.mediaDensity = mediaList.length > 2 ? 'multi' : 'single';
    container.setAttribute(
      'data-has-youtube',
      mediaList.some(item => String(item?.type || '').toLowerCase() === 'youtube') ? 'true' : 'false'
    );

    mediaList.forEach((item, index) => {
      const entry = renderItem(item, project, index);
      if (!entry) return;
      const group = groups.get(String(item.groupId || ''));
      let destination = container;

      if (group) {
        let record = groupRecords.get(group.id);
        if (!record) {
          const section = documentRef.createElement('section');
          section.className = 'lightbox-artwork-group';
          section.dataset.artworkGroup = group.id;
          section.dataset.artworkLayout = group.layout;
          section.dataset.artworkEffectiveLayout = 'grid';
          section.setAttribute('role', 'region');
          section.setAttribute('aria-label', 'Artwork Group: ' + group.name);
          const items = documentRef.createElement('div');
          items.className = 'lightbox-artwork-group-items';
          section.appendChild(items);
          container.appendChild(section);
          record = {section,items,requestedLayout:group.layout,entries:[]};
          groupRecords.set(group.id,record);
        }
        record.entries.push(entry);
        entry.dataset.artworkFoil = entry.querySelector('.lightbox-holographic') ? 'true' : 'false';
        bindGroupedArtworkInteractions(container, entry, project, record.section);
        destination = record.items;
      }

      destination.appendChild(entry);
      const video = entry.querySelector('video');
      if (video) bindPlaybackHandoff(container, video, 'video');
      const muxPlayer = entry.querySelector('mux-player');
      if (muxPlayer) bindPlaybackHandoff(container, muxPlayer, 'mux');
      const youtube = entry.querySelector('iframe[data-lm-youtube]');
      if (youtube) bindPlaybackHandoff(container, youtube, 'youtube');
      rendered += 1;
    });

    groupRecords.forEach(record => {
      applyStickerCardVariation(record);
      watchArtworkGroupLayout(container, record);
    });
    const youtubeFrames = container.querySelectorAll('iframe[data-lm-youtube]');
    if (youtubeFrames.length) bindYouTubeStateHandoff(container);
    return rendered;
  }
  function destroy() {
    destroyed = true;
    Array.from(activeLightboxMediaCleanups).reverse().forEach(record => {
      try { record.run(); } catch (_) {}
    });
    activeLightboxMediaCleanups.clear();
    if (activeInspector) closeArtworkInspect({immediate:true});
    disposeArtworkGroupLayouts();
    artworkGroupInteractionCleanups.forEach(cleanup => { try { cleanup(); } catch (_) {} });
    artworkGroupInteractionCleanups.clear();
    Array.from(holographicCleanups).reverse().forEach(cleanup => {
      try { cleanup(); } catch (_) {}
      holographicCleanups.delete(cleanup);
    });
    Array.from(activePreloadCleanups).reverse().forEach(cleanup => {
      try { cleanup(); } catch (_) {}
    });
    activePreloadCleanups.clear();

    youtubeMessageCleanup?.();
    youtubeMessageCleanup = null;

    if (youtubePreloadRoot?.isConnected) {
      youtubePreloadRoot.remove();
    }
    youtubePreloadRoot = null;
    if (mediaPreloadRoot) {
      mediaPreloadRoot.querySelectorAll('video').forEach(releasePreloadedVideo);
      if (mediaPreloadRoot.isConnected) mediaPreloadRoot.remove();
    }
    mediaPreloadRoot = null;

    artworkVisibilityObserver?.disconnect();
    artworkVisibilityObserver = null;
    youtubeFrameCache.clear();
    imageDimensionCache.clear();
    videoDimensionCache.clear();
    lottieDimensionAbortControllers.forEach(controller => {
      try { controller.abort(); } catch (_) {}
    });
    lottieDimensionAbortControllers.clear();
    lottieDimensionCache.clear();
    lottieDimensionRequests.clear();
  }

  function dispose(container) {
    if (!container) return;
    container.querySelectorAll?.('.lightbox-artwork').forEach(artwork => {
      artworkVisibilityObserver?.unobserve(artwork);
      artworkVisibilityStates.delete(artwork);
    });
    cleanupLightboxMediaIn(container);
    if (activeInspector?.container === container) closeArtworkInspect({immediate:true});
    disposeArtworkGroupLayouts(container);
    artworkGroupInteractionCleanups.forEach(cleanup => { try { cleanup(); } catch (_) {} });
    artworkGroupInteractionCleanups.clear();
    Array.from(holographicCleanups).reverse().forEach(cleanup => {
      try { cleanup(); } catch (_) {}
      holographicCleanups.delete(cleanup);
    });
    youtubeMessageCleanup?.();
    youtubeMessageCleanup = null;
    pauseOtherPlayback(container);
    container.querySelectorAll('video').forEach(releasePreloadedVideo);

    const youtubeFrames = Array.from(container.querySelectorAll('iframe[data-lm-youtube]'));
    if (youtubeFrames.length) {
      const preloadRoot = ensureYouTubePreloadRoot();
      youtubeFrames.forEach(iframe => {
        const key = iframe.dataset.lmYoutubeCacheKey;
        if (key && youtubeFrameCache.get(key) === iframe) {
          // Hidden preload frames must never remain keyboard-focusable while
          // they sit outside the active Lightbox artwork surface.
          iframe.tabIndex = -1;
          preloadRoot.appendChild(iframe);
        }
      });
    }

    container.querySelectorAll('.model-viewer-shell').forEach(shell => {
      try { shell.__modelViewerCleanup?.(); } catch (_) {}
    });
  }

  return {
    renderProjectMedia,
    preloadProjectsMedia,
    dispose,
    destroy
  };
}