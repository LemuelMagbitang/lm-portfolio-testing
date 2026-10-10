/**
 * Lightbox media presentation boundary.
 *
 * Converts normalized project media into viewer DOM. Navigation, modal state,
 * and project selection remain in the Lightbox controller.
 */

import { createFoilNormalRenderer } from './foil-normal-renderer.js?v=20261010-05';

const YOUTUBE_PLAYER_ORIGIN = 'https://www.youtube.com';

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
  const holographicMotionStates = new WeakMap();
  const youtubeFrameCache = new Map();
  const imageDimensionCache = new Map();
  const videoDimensionCache = new Map();
  const lottieDimensionCache = new Map();
  const lottieDimensionRequests = new Map();
  const lottieDimensionAbortControllers = new Map();
  let youtubePreloadRoot = null;
  let mediaPreloadRoot = null;
  let destroyed = false;
  const activePreloadCleanups = new Set();
  const MEDIA_PRELOAD_TIMEOUT_MS = 9000;
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
        if (!destroyed && width > 0 && height > 0) imageDimensionCache.set(url, { width, height });
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
        () => {}
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
    let resolveResult = null;
    const preload = new Promise(resolve => {
      resolveResult = resolve;
      const finish = ready => {
        if (settled) return;
        settled = true;
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('error', onError);
        if (!ready && video.parentNode) video.remove();
        resolve(ready);
      };
      const onReady = () => finish(true);
      const onError = () => finish(false);
      video.addEventListener('loadeddata', onReady, { once: true });
      video.addEventListener('canplay', onReady, { once: true });
      video.addEventListener('error', onError, { once: true });
    });

    const cleanup = () => resolveResult?.(false);
    const unregister = registerPreloadCleanup(cleanup);
    root.appendChild(video);
    video.src = url;
    video.load();

    const result = await withPreloadTimeout(
      preload,
      MEDIA_PRELOAD_TIMEOUT_MS,
      cleanup
    ).finally(unregister);

    if (!result && video.parentNode) video.remove();
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

    const ready = new Promise(resolve => {
      iframe.addEventListener('load', () => {
        primeYouTubeFrame(iframe);
        youtubeFrameCache.set(embedSrc, iframe);
        resolve(true);
      }, { once: true });
      iframe.addEventListener('error', () => resolve(false), { once: true });
    });
    const cleanup = () => {
      if (youtubeFrameCache.get(embedSrc) === iframe) youtubeFrameCache.delete(embedSrc);
      if (iframe.parentNode) iframe.remove();
    };
    const unregister = registerPreloadCleanup(cleanup);
    root.appendChild(iframe);
    iframe.src = embedSrc;
    const result = await withPreloadTimeout(ready, MEDIA_PRELOAD_TIMEOUT_MS, cleanup).finally(unregister);
    if (!result && youtubeFrameCache.get(embedSrc) === iframe) youtubeFrameCache.delete(embedSrc);
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
      const response = await withPreloadTimeout(
        globalThis.fetch(url, {
          method: 'GET',
          credentials: 'omit',
          cache: 'force-cache',
          ...(fetchPriority === 'high' ? { priority: 'high' } : {}),
          signal: controller?.signal
        }),
        MEDIA_PRELOAD_TIMEOUT_MS,
        cleanup
      );
      if (!response?.ok) return false;
      await response.arrayBuffer();
      return true;
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
    const scheduleJob = (key, job, critical = false) => {
      if (!key || typeof job !== 'function') return;
      const existing = scheduledJobs.get(key);
      if (!existing || (critical && !existing.critical)) {
        scheduledJobs.set(key, { job, critical });
      }
    };
    let hasModel = false;

    const connection = globalThis.navigator?.connection ||
      globalThis.navigator?.mozConnection ||
      globalThis.navigator?.webkitConnection;
    const constrainedNetwork = Boolean(
      connection?.saveData ||
      /(^|-)2g$/i.test(String(connection?.effectiveType || ''))
    );

    (Array.isArray(projects) ? projects : []).forEach(project => {
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
      media.forEach(item => {
        if (!item?.src) return;
        const type = String(item.type || '').toLowerCase();
        const url = resolveAssetUrl(item.src);
        const key = type + ':' + url;

        // Keep the first local-renderable item critical for every project.
        // Models are an intentional exception: the 3D viewer is a distinct
        // interaction surface, and preloading its binary removes the remaining
        // first-open fetch after the viewer module graph is already warm.
        const critical =
          media.indexOf(item) === primaryIndex ||
          type === 'model';

        const fetchPriority = critical ? 'high' : 'low';

        if (type === 'image') {
          const holo = normalizeHolographicConfig(item.holographic);
          if (holo?.back) {
            const backUrl = resolveAssetUrl(holo.back);
            scheduleJob('holographic-back:' + backUrl, () => preloadImage(backUrl, { fetchPriority: 'low' }), false);
          }
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
            ...(holo?.style === 'cosmos' ? ['assets/holographic/cosmos-bottom.png','assets/holographic/cosmos-middle-trans.png','assets/holographic/cosmos-top-trans.png'] : []),
            ...(holo?.grainLayer !== false ? ['assets/holographic/grain.webp'] : []),
            ...(holo?.glitterLayer === true ? ['assets/holographic/glitter.png'] : [])
          ];
          sharedFoilAssets.forEach(path => {
            const layerUrl = resolveAssetUrl(path);
            scheduleJob('holographic-layer:' + layerUrl, () => preloadImage(layerUrl, { fetchPriority: 'low' }), false);
          });
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
          // A YouTube iframe is never startup-critical. Its iframe/player boot
          // is much more expensive than the local first-view assets, and the
          // embed does not guarantee that the actual video bytes are ready.
          // Queue it as low-priority warm-up alongside the critical tier.
          if (!constrainedNetwork) {
            scheduleJob(key, () => preloadYouTube(url), false);
          }
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
      scheduleJob('viewer-module', () => Promise.resolve().then(preloadModelModule), true);
    }

    const criticalJobs = [];
    const secondaryJobs = [];
    for (const { job, critical } of scheduledJobs.values()) {
      (critical ? criticalJobs : secondaryJobs).push(job);
    }

    // The critical tier is what the branded LM loading gate waits for:
    // one primary media item per project plus project-level backgrounds and,
    // when present, the 3D viewer module graph.
    // Launch secondary warm-up immediately at lower concurrency. Browser fetch
    // priorities keep critical work favored while the visitor is still on the
    // branded loading screen, so more of the gallery can be ready by first use.
    const secondaryPromise = runPreloadPool(
      secondaryJobs,
      constrainedNetwork ? 1 : 2
    );

    const criticalResults = await runPreloadPool(
      criticalJobs,
      constrainedNetwork ? 3 : 6
    );

    // Secondary media is intentionally fire-and-forget after the critical gate;
    // its completion must never hold the first paint hostage.
    void secondaryPromise.catch(() => {});

    return {
      total: criticalJobs.length + secondaryJobs.length,
      ready: criticalResults.filter(Boolean).length,
      criticalTotal: criticalJobs.length,
      criticalReady: criticalResults.filter(Boolean).length
    };
  }

  function takeCachedYouTubeFrame(embedSrc) {
    const frame = youtubeFrameCache.get(embedSrc);
    if (!frame) return null;
    if (!frame.isConnected) {
      youtubeFrameCache.delete(embedSrc);
      return null;
    }
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
    const intensityValue = Number(value.intensity);
    const intensity = Number.isFinite(intensityValue)
      ? Math.max(0, Math.min(1, intensityValue))
      : 0.7;
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
      intensity, textureMode, backTextureMode,
      glitterLayer: value.glitterLayer === true,
      grainLayer: value.grainLayer !== false,
      ...(texture ? { texture } : {}), ...(back ? { back, backFoilEnabled } : {}), ...(mask ? { mask } : {}),
      ...(backTexture ? { backTexture } : {}), ...(backMask ? { backMask } : {})
    };
  }

  const HOLOGRAPHIC_COSMOS_MAPS = {
    'cosmos-bottom': 'assets/holographic/cosmos-bottom.png',
    'cosmos-middle': 'assets/holographic/cosmos-middle-trans.png',
    'cosmos-top': 'assets/holographic/cosmos-top-trans.png'
  };
  const HOLOGRAPHIC_TOUCH_HOLD_MS = 220;
  const HOLOGRAPHIC_TOUCH_MOVE_CANCEL_PX = 9;
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

  function updateHolographicTilt(surface, x, y) {
    if (!surface) return;
    const clampedX = clampHolographic(x);
    const clampedY = clampHolographic(y);
    const ry = ((clampedX - 50) / 50) * 13.5;
    const rx = ((50 - clampedY) / 50) * 13.5;
    const angle = Math.atan2(clampedY - 50, clampedX - 50) * (180 / Math.PI);
    const foilX = 100 - clampedX;
    const foilY = 100 - clampedY;
    // Reflect a virtual studio key light against the hand movement rather than
    // gluing a white flashlight to the pointer. Grazing angles reveal more foil.
    const lightX = clampHolographic(50 + ((50 - clampedX) * 0.68), 16, 84);
    const lightY = clampHolographic(50 + ((50 - clampedY) * 0.68), 16, 84);
    const tiltStrength = clampHolographic(Math.hypot(clampedX - 50, clampedY - 50) / 70, 0, 1);

    // Input drives card tilt, inverse foil refraction and a counter-moving
    // virtual key light. The animation-frame easing keeps the reflection
    // optical and fluid rather than cursor-locked.
    surface.style.setProperty('--holo-x', clampedX + '%');
    surface.style.setProperty('--holo-y', clampedY + '%');
    surface.style.setProperty('--holo-foil-x', foilX.toFixed(2) + '%');
    surface.style.setProperty('--holo-foil-y', foilY.toFixed(2) + '%');
    surface.style.setProperty('--holo-light-x', lightX.toFixed(2) + '%');
    surface.style.setProperty('--holo-light-y', lightY.toFixed(2) + '%');
    surface.style.setProperty('--holo-tilt-strength', tiltStrength.toFixed(3));
    surface.style.setProperty('--holo-rx', rx.toFixed(2) + 'deg');
    surface.style.setProperty('--holo-ry', ry.toFixed(2) + 'deg');
    surface.style.setProperty('--holo-angle', angle.toFixed(2) + 'deg');
    holographicNormalControllers.get(surface)?.forEach(controller => controller.setLight(lightX / 100, 1 - (lightY / 100)));
  }

  function setHolographicTarget(surface, x, y) {
    if (!surface) return;
    const motion = holographicMotionStates.get(surface);
    const targetX = clampHolographic(x);
    const targetY = clampHolographic(y);
    if (!motion || typeof windowRef?.requestAnimationFrame !== 'function') {
      updateHolographicTilt(surface, targetX, targetY);
      return;
    }

    motion.targetX = targetX;
    motion.targetY = targetY;
    if (motion.frame !== null) return;

    const animate = timestamp => {
      motion.frame = null;
      const previousTime = motion.lastTime || (timestamp - 16.67);
      const elapsed = Math.max(1, Math.min(50, timestamp - previousTime));
      const alpha = 1 - Math.exp(-elapsed / 42);
      motion.lastTime = timestamp;
      motion.x += (motion.targetX - motion.x) * alpha;
      motion.y += (motion.targetY - motion.y) * alpha;

      const dx = motion.targetX - motion.x;
      const dy = motion.targetY - motion.y;
      if (Math.abs(dx) < 0.04 && Math.abs(dy) < 0.04) {
        motion.x = motion.targetX;
        motion.y = motion.targetY;
        motion.lastTime = 0;
        updateHolographicTilt(surface, motion.x, motion.y);
        return;
      }

      updateHolographicTilt(surface, motion.x, motion.y);
      motion.frame = windowRef.requestAnimationFrame(animate);
    };

    motion.frame = windowRef.requestAnimationFrame(animate);
  }

  function setHolographicReflection(surface, event) {
    const rect = surface.getBoundingClientRect?.();
    if (!rect || !rect.width || !rect.height) return;
    const x = ((Number(event.clientX) - rect.left) / rect.width) * 100;
    const y = ((Number(event.clientY) - rect.top) / rect.height) * 100;
    setHolographicTarget(surface, x, y);
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
    surface.dataset.holoInput = 'pointer';
    const backHasCustomArtwork = Boolean(String(config.back || '').trim());
    const backFoilEnabled = backHasCustomArtwork && Boolean(config.backFoilEnabled);
    surface.dataset.holoHasCustomBack = backHasCustomArtwork ? 'true' : 'false';
    surface.dataset.holoHasBackEffects = backFoilEnabled ? 'true' : 'false';
    surface.style.setProperty('--holo-intensity', String(config.intensity));
    surface.style.setProperty('--holo-x', '50%');
    surface.style.setProperty('--holo-y', '50%');
    surface.style.setProperty('--holo-foil-x', '50%');
    surface.style.setProperty('--holo-foil-y', '50%');
    surface.style.setProperty('--holo-light-x', '34%');
    surface.style.setProperty('--holo-light-y', '26%');
    surface.style.setProperty('--holo-tilt-strength', '0');
    holographicMotionStates.set(surface, { x: 50, y: 50, targetX: 50, targetY: 50, frame: null, lastTime: 0 });
    surface.style.setProperty('--holo-rx', '0deg');
    surface.style.setProperty('--holo-ry', '0deg');
    surface.style.setProperty('--holo-angle', '0deg');
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
    desktopAction.textContent = 'CLICK / MOVE';
    const touchAction = documentRef.createElement('span');
    touchAction.className = 'lightbox-holographic-touch-action';
    touchAction.textContent = 'HOLD + MOVE';
    hint.append(faceLabel, separator, desktopAction, touchAction);
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
        const controller = createFoilNormalRenderer(normalCanvas, normalPatternUrls, {
          intensity: config.intensity,
          phase: isFront ? 0.17 : 0.43,
          uvScale: config.style === 'cosmos' ? 2 : (faceTextureMode === 'tile' ? 2 : 1)
        });
        const controllers = holographicNormalControllers.get(surface) || [];
        controllers.push(controller);
        holographicNormalControllers.set(surface, controllers);
        controller.setLight(0.34, 0.74);
      }
    });

    flip.append(front, back);
    inner.appendChild(flip);
    surface.appendChild(inner);

    let touchGesture = null;
    let suppressNextClick = false;
    let holdTimer = null;

    const clearTouchGesture = () => {
      if (holdTimer !== null) {
        windowRef?.clearTimeout?.(holdTimer);
        holdTimer = null;
      }
      touchGesture = null;
      surface.classList.remove('is-holo-touch-engaged', 'is-holo-touch-pending');
    };

    const cleanup = () => {
      clearTouchGesture();
      const motion = holographicMotionStates.get(surface);
      if (motion?.frame !== null && motion?.frame !== undefined) {
        windowRef?.cancelAnimationFrame?.(motion.frame);
      }
      holographicMotionStates.delete(surface);
      holographicNormalControllers.get(surface)?.forEach(controller => { try { controller.destroy(); } catch (_) {} });
      holographicNormalControllers.delete(surface);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointerup', onPointerUp);
      surface.removeEventListener('pointercancel', onPointerUp);
      surface.removeEventListener('pointerleave', onPointerLeave);
      surface.removeEventListener('touchmove', onTouchMove);
      surface.removeEventListener('touchend', onTouchEnd);
      surface.removeEventListener('touchcancel', onTouchEnd);
      surface.removeEventListener('click', toggleFlip);
      surface.removeEventListener('keydown', toggleFlip);
      surface.__lightboxHoloHint?.remove();
      surface.replaceChildren();
    };

    const onPointerMove = event => {
      const pointerType = event.pointerType || '';
      if (pointerType === 'touch' || pointerType === 'pen') {
        if (pointerType === 'touch' && event.isPrimary === false) return;
        if (!touchGesture || touchGesture.pointerId !== event.pointerId) return;

        const currentX = Number(event.clientX) || 0;
        const currentY = Number(event.clientY) || 0;
        const dx = currentX - touchGesture.startX;
        const dy = currentY - touchGesture.startY;

        if (!touchGesture.engaged) {
          if (Math.hypot(dx, dy) > HOLOGRAPHIC_TOUCH_MOVE_CANCEL_PX) {
            touchGesture.moved = true;
            suppressNextClick = true;
            clearTouchGesture();
          }
          return;
        }

        event.preventDefault();
        setHolographicReflection(surface, event);
        return;
      }

      if (pointerType === 'mouse') {
        setHolographicReflection(surface, event);
      }
    };

    const onPointerLeave = () => {
      if (!touchGesture?.engaged) setHolographicTarget(surface, 50, 50);
    };

    const onPointerDown = event => {
      const pointerType = event.pointerType || '';
      if (pointerType === 'mouse') {
        setHolographicReflection(surface, event);
        return;
      }
      if ((pointerType !== 'touch' && pointerType !== 'pen') ||
          (pointerType === 'touch' && event.isPrimary === false)) return;

      clearTouchGesture();
      suppressNextClick = false;
      surface.classList.add('is-holo-touch-pending');
      touchGesture = {
        pointerId: event.pointerId,
        startX: Number(event.clientX) || 0,
        startY: Number(event.clientY) || 0,
        engaged: false,
        moved: false
      };

      holdTimer = windowRef?.setTimeout?.(() => {
        if (!touchGesture || touchGesture.pointerId !== event.pointerId || touchGesture.moved) return;
        touchGesture.engaged = true;
        suppressNextClick = true;
        surface.classList.add('is-holo-touch-engaged');
        try { surface.setPointerCapture?.(event.pointerId); } catch (_) {}
        setHolographicReflection(surface, event);
      }, HOLOGRAPHIC_TOUCH_HOLD_MS);
    };

    const onPointerUp = event => {
      if (!touchGesture || touchGesture.pointerId !== event.pointerId) return;
      const engaged = touchGesture.engaged;
      const moved = touchGesture.moved;
      if (engaged || moved) suppressNextClick = true;
      try {
        if (event.pointerId !== undefined) surface.releasePointerCapture?.(event.pointerId);
      } catch (_) {}
      clearTouchGesture();
    };

    // Pointer Events cover modern browsers, but Safari/iOS gesture arbitration
    // can still hand scrolling to the page before a late pointermove
    // preventDefault() is honored. Mirror the engaged gesture through a
    // non-passive Touch Events path so a held hologram can reliably take over
    // after the deliberate 220 ms hold without blocking ordinary scroll starts.
    const onTouchMove = event => {
      if (!touchGesture?.engaged) return;
      const touch = event.touches?.[0] || event.changedTouches?.[0];
      if (!touch) return;
      event.preventDefault();
      setHolographicReflection(surface, {
        clientX: Number(touch.clientX) || 0,
        clientY: Number(touch.clientY) || 0
      });
    };

    const onTouchEnd = () => {
      if (!touchGesture) return;
      const engaged = touchGesture.engaged;
      const moved = touchGesture.moved;
      if (engaged || moved) suppressNextClick = true;
      clearTouchGesture();
    };

    const toggleFlip = event => {
      if (event?.type === 'click' && suppressNextClick) {
        suppressNextClick = false;
        return;
      }
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

    // Touch movement may call preventDefault() only after the deliberate hold
    // threshold has engaged. Keep the listener non-passive so normal scrolling
    // remains available before engagement, while an engaged hold can suppress
    // scrolling and drive the holographic reflection.
    surface.addEventListener('pointermove', onPointerMove, { passive: false });
    surface.addEventListener('pointerdown', onPointerDown);
    surface.addEventListener('pointerup', onPointerUp);
    surface.addEventListener('pointercancel', onPointerUp);
    surface.addEventListener('pointerleave', onPointerLeave);
    surface.addEventListener('touchmove', onTouchMove, { passive: false });
    surface.addEventListener('touchend', onTouchEnd);
    surface.addEventListener('touchcancel', onTouchEnd);
    surface.addEventListener('click', toggleFlip);
    surface.addEventListener('keydown', toggleFlip);



    holographicCleanups.add(cleanup);
    return surface;
  }

  function pauseYouTubeFrame(iframe) {
    if (!iframe?.contentWindow) return;
    iframe.dataset.lmYoutubePauseRequested = String(Date.now());
    try {
      iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "pauseVideo", args: [] }), YOUTUBE_PLAYER_ORIGIN);
    } catch (_) {}
  }

  function pauseOtherPlayback(container, activeElement = null) {
    if (container) {
      container.querySelectorAll("video").forEach(video => {
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
    if (!iframe?.contentWindow) return;
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
    if (type === "video") {
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

  function buildMediaEntry(mediaEl, captionText, background) {
    const wrap = documentRef.createElement('div');
    wrap.className = 'lightbox-media-item';

    // Keep media backgrounds scoped to the artwork surface. The caption is a
    // sibling of this surface, so fills never paint behind or tint captions.
    const artwork = documentRef.createElement('div');
    artwork.className = 'lightbox-artwork';

    // Carry the viewer's known orientation onto the artwork surface itself.
    // This is especially important for Lottie because its custom element
    // uses height:100%; the wrapper must own the aspect-ratio box.
    const orientationClass = ['yt-landscape', 'yt-portrait', 'yt-square']
      .find(className => mediaEl.classList?.contains?.(className));
    if (orientationClass) artwork.classList.add(orientationClass);

    artwork.appendChild(mediaEl);
    wrap.appendChild(artwork);

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
    const applyIntrinsicRatio = () => {
      const cached = imageDimensionCache.get(sourceUrl);
      setAspectRatio(
        artwork,
        cached?.width || image.naturalWidth,
        cached?.height || image.naturalHeight
      );
    };
    applyIntrinsicRatio();
    image.addEventListener('load', applyIntrinsicRatio, { once: true });

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

    return entry;
  }

  function renderYouTube(item, project, index = 0) {
    const { isShort } = parseYouTube(item.src);
    const embedSrc = buildYouTubeEmbedUrl(item.src);
    if (!embedSrc) return null;

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
        primeYouTubeFrame(iframe);
        // A newly created frame is cached only after a successful load. This
        // prevents a failed player from becoming a poisoned cache entry.
        youtubeFrameCache.set(embedSrc, iframe);
      }, { once: true });
      iframe.addEventListener('error', () => {
        if (youtubeFrameCache.get(embedSrc) === iframe) youtubeFrameCache.delete(embedSrc);
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
    if (resolvedOrientation === 'portrait') setAspectRatio(artwork, 9, 16);
    else if (resolvedOrientation === 'square') setAspectRatio(artwork, 1, 1);
    else setAspectRatio(artwork, 16, 9);
    return entry;
  }

  function renderVideo(item, index = 0) {
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
    entry.querySelector('.lightbox-artwork')?.classList.add('is-local-video-artwork');
    applyVideoOrientation(
      video,
      String(item.orientation || '').toLowerCase(),
      entry.querySelector('.lightbox-artwork')
    );
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

    if (typeof mountModelViewer !== 'function') {
      modelWrap.innerHTML = '<div class="model-viewer-error">3D model preview is unavailable.</div>';
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
            const currentScroll = lightbox.scrollTop;
            lightbox.dataset.pre3dScrollTop = String(currentScroll);
            // The interactive 3D state always begins at its own viewport
            // origin. The previous Lightbox scroll position is restored only
            // when Back/Escape exits this focused environment.
            lightbox.scrollTop = 0;
            lightbox.classList.add('is-3d-focused');
            modelEntry.classList.add('is-3d-focus-target');
            if (lightboxControls) {
              lightboxControls.classList.add('is-3d-controls-disabled');
              lightboxControls.inert = true;
            }
            documentRef.documentElement.classList.add('lm-3d-focus-open');
            documentRef.body.classList.add('lm-3d-focus-open');

            // Focus mode owns the viewport completely. Reassert zero after
            // the class/layout change as Chromium can otherwise restore the
            // old media-list scroll anchor on the following paint.
            lightbox.scrollTop = 0;
            windowRef.requestAnimationFrame(() => {
              if (!lightbox?.classList.contains('is-3d-focused')) return;
              lightbox.scrollTop = 0;
              windowRef.requestAnimationFrame(() => {
                if (lightbox?.classList.contains('is-3d-focused')) lightbox.scrollTop = 0;
              });
            });
          },
          onDeactivate: () => {
            lightbox?.classList.remove('is-3d-focused');
            modelEntry.classList.remove('is-3d-focus-target');
            if (lightboxControls) {
              lightboxControls.classList.remove('is-3d-controls-disabled');
              lightboxControls.inert = false;
            }
            documentRef.documentElement.classList.remove('lm-3d-focus-open');
            documentRef.body.classList.remove('lm-3d-focus-open');

            const previousScroll = Number(lightbox?.dataset.pre3dScrollTop);
            if (Number.isFinite(previousScroll)) {
              windowRef.requestAnimationFrame(() => { lightbox.scrollTop = previousScroll; });
            }
            if (lightbox) delete lightbox.dataset.pre3dScrollTop;
          }
        });
      })
      .then(cleanup => {
        if (!cleanup) return;
        // mountModelViewer is async. The Lightbox may have navigated or closed
        // while the model loader was waiting on the asset. Never keep a WebGL
        // viewer alive for a detached media item.
        if (!modelWrap.isConnected || !lightbox?.classList.contains('active')) {
          try { cleanup?.(); } catch (_) {}
        }
      })
      .catch(error => {
        if (!modelWrap.isConnected) return;
        modelWrap.innerHTML = '<div class="model-viewer-error">3D model preview is unavailable.</div>';
        console.warn('3D model viewer:', error);
      });

    return modelEntry;
  }

  function renderLottie(item) {
    const resolvedSrc = resolveAssetUrl(item.src);
    const player = documentRef.createElement('lottie-player');
    player.setAttribute('src', resolvedSrc);
    player.setAttribute('autoplay', '');
    player.setAttribute('loop', '');
    player.setAttribute('background', 'transparent');

    const orientation = String(item.orientation || '').toLowerCase();
    if (orientation === 'portrait') player.classList.add('yt-portrait');
    else if (orientation === 'square') player.classList.add('yt-square');
    else player.classList.add('yt-landscape');

    // The artwork surface is assigned the Lottie file's intrinsic w/h
    // before normal interactive use. Use "meet" so a delayed/unknown ratio
    // can never crop the animation; the surface itself remains responsible
    // for the final aspect-ratio geometry.
    player.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    player.preserveAspectRatio = 'xMidYMid meet';
    const entry = buildMediaEntry(player, item.caption || item.description, item.background);
    const artwork = entry.querySelector('.lightbox-artwork');
    artwork?.classList.add('is-lottie-artwork');
    const dimensions = lottieDimensionCache.get(resolvedSrc);
    if (dimensions) {
      setAspectRatio(artwork, dimensions.width, dimensions.height);
    } else {
      // Startup warm-up is intentionally bounded and may not finish before a
      // visitor opens a project. Resolve the Lottie JSON dimensions on demand
      // so first-open still converges to the intrinsic artwork geometry.
      void resolveLottieDimensions(resolvedSrc).then(resolved => {
        if (!resolved || destroyed || !artwork?.isConnected) return;
        setAspectRatio(artwork, resolved.width, resolved.height);
      });
    }
    return entry;
  }

  function renderItem(item, project, index = 0) {
    if (!item?.src) return null;

    const type = String(item.type || 'image').toLowerCase();
    if (type === 'image') return renderImage(item, project, index);
    if (type === 'youtube') return renderYouTube(item, project, index);
    if (type === 'video') return renderVideo(item, index);
    if (type === 'model') return renderModel(item, project);
    if (type === 'lottie') return renderLottie(item);
    return null;
  }

  function renderProjectMedia(container, project = {}) {
    if (!container) return 0;

    const mediaList = Array.isArray(project.media) && project.media.length
      ? project.media
      : (project.thumbnail?.src ? [{ ...project.thumbnail }] : []);

    let rendered = 0;
    container.dataset.mediaDensity = mediaList.length > 2 ? 'multi' : 'single';
    container.setAttribute(
      'data-has-youtube',
      mediaList.some(item => String(item?.type || '').toLowerCase() === 'youtube') ? 'true' : 'false'
    );
    mediaList.forEach((item, index) => {
      const entry = renderItem(item, project, index);
      if (!entry) return;
      container.appendChild(entry);
      const video = entry.querySelector("video");
      if (video) bindPlaybackHandoff(container, video, "video");
      const youtube = entry.querySelector("iframe[data-lm-youtube]");
      if (youtube) bindPlaybackHandoff(container, youtube, "youtube");
      rendered += 1;
    });

    const youtubeFrames = container.querySelectorAll('iframe[data-lm-youtube]');
    if (youtubeFrames.length) {
      bindYouTubeStateHandoff(container);
    }

    return rendered;
  }

  function destroy() {
    destroyed = true;
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
    if (mediaPreloadRoot?.isConnected) {
      mediaPreloadRoot.remove();
    }
    mediaPreloadRoot = null;

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
    Array.from(holographicCleanups).reverse().forEach(cleanup => {
      try { cleanup(); } catch (_) {}
      holographicCleanups.delete(cleanup);
    });
    youtubeMessageCleanup?.();
    youtubeMessageCleanup = null;
    pauseOtherPlayback(container);

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