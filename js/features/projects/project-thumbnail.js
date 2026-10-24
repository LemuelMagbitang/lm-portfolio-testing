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


const thumbnailMediaStateByElement = new WeakMap();
const thumbnailViewportObserversByWindow = new WeakMap();

function getThumbnailViewportObservers(windowRef) {
  if (!windowRef || (typeof windowRef !== 'object' && typeof windowRef !== 'function')) return null;
  const cached = thumbnailViewportObserversByWindow.get(windowRef);
  if (cached) return cached;
  const Observer = windowRef.IntersectionObserver || globalThis.IntersectionObserver;
  if (typeof Observer !== 'function') return null;

  const observers = { preload: null, visibility: null };
  observers.preload = new Observer(entries => {
    entries.forEach(entry => {
      const state = thumbnailMediaStateByElement.get(entry.target);
      if (!state || state.disposed) {
        observers.preload.unobserve(entry.target);
        return;
      }
      if (!entry.isIntersecting) return;
      observers.preload.unobserve(entry.target);
      state.activate();
    });
  }, { rootMargin: '640px 0px', threshold: 0.01 });

  observers.visibility = new Observer(entries => {
    entries.forEach(entry => {
      const state = thumbnailMediaStateByElement.get(entry.target);
      if (!state || state.disposed) {
        observers.visibility.unobserve(entry.target);
        return;
      }
      state.setVisible(entry.isIntersecting && entry.intersectionRatio > 0);
    });
  }, { rootMargin: '0px', threshold: 0.01 });

  thumbnailViewportObserversByWindow.set(windowRef, observers);
  return observers;
}

function registerThumbnailMediaState(media, { type, src, priority, reducedMotion, windowRef, ensureLottiePlayer = null } = {}) {
  const usesViewportLifecycle = type === 'video' || type === 'lottie';
  const observers = usesViewportLifecycle ? getThumbnailViewportObservers(windowRef) : null;
  const listeners = [];
  let activated = false;
  let disposed = false;

  const listen = (eventName, handler) => {
    media.addEventListener?.(eventName, handler);
    listeners.push([eventName, handler]);
  };
  const setReady = () => {
    if (disposed) return;
    const reveal = () => {
      if (disposed) return;
      media.dataset.mediaState = 'ready';
      media.classList.remove('is-media-loading', 'is-media-error');
      media.classList.add('is-media-ready');
      if (type === 'video' && media.dataset.mediaVisible === 'true' && !reducedMotion) {
        Promise.resolve(media.play?.()).catch(() => {});
      }
    };
    if (String(media.tagName || '').toLowerCase() === 'img' && typeof media.decode === 'function') {
      Promise.resolve().then(() => media.decode()).catch(() => {}).then(reveal);
    } else {
      reveal();
    }
  };
  const setFailed = () => {
    if (disposed) return;
    media.dataset.mediaState = 'error';
    media.classList.remove('is-media-loading', 'is-media-ready');
    media.classList.add('is-media-error');
  };

  if (type === 'image') {
    listen('load', setReady);
    listen('error', setFailed);
  } else if (type === 'video') {
    listen('loadeddata', setReady);
    listen('canplay', setReady);
    listen('error', setFailed);
  } else if (type === 'lottie') {
    listen('ready', setReady);
    listen('load', setReady);
    listen('error', setFailed);
  }

  const state = {
    type,
    observers,
    disposed: false,
    activate() {
      if (disposed || activated) return;
      activated = true;
      media.dataset.mediaActivated = 'true';
      delete media.dataset.lazySrc;
      if (type === 'image') {
        media.src = src;
        if (media.complete) {
          if (Number(media.naturalWidth) > 0) setReady();
          else setFailed();
        }
        return;
      }
      if (type === 'video') {
        media.preload = 'metadata';
        media.src = src;
        return;
      }
      if (type === 'lottie') {
        const attachSource = () => {
          if (disposed) return;
          media.setAttribute('src', src);
          if (media.dataset.mediaVisible === 'true' && !reducedMotion) {
            media.setAttribute('autoplay', '');
            media.setAttribute('loop', '');
            Promise.resolve(media.play?.()).catch(() => {});
          }
        };

        if (typeof ensureLottiePlayer !== 'function') {
          attachSource();
          return;
        }

        media.dataset.mediaState = 'loading';
        media.classList.remove('is-media-ready', 'is-media-error');
        media.classList.add('is-media-loading');
        Promise.resolve()
          .then(() => ensureLottiePlayer())
          .then(ready => {
            if (disposed) return;
            if (ready === false) {
              activated = false;
              setFailed();
              return;
            }
            attachSource();
          })
          .catch(() => {
            if (disposed) return;
            activated = false;
            setFailed();
          });
      }
    },
    setVisible(visible) {
      if (disposed || !usesViewportLifecycle) return;
      const isVisible = Boolean(visible);
      media.dataset.mediaVisible = isVisible ? 'true' : 'false';
      if (isVisible) {
        state.activate();
        if (reducedMotion) {
          try { media.pause?.(); } catch (_) {}
          media.removeAttribute?.('autoplay');
          return;
        }
        if (type === 'video') {
          media.preload = 'auto';
          Promise.resolve(media.play?.()).catch(() => {});
        } else {
          media.setAttribute('autoplay', '');
          media.setAttribute('loop', '');
          Promise.resolve(media.play?.()).catch(() => {});
        }
        return;
      }
      try { media.pause?.(); } catch (_) {}
      if (type === 'lottie') media.removeAttribute?.('autoplay');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      state.disposed = true;
      observers?.preload?.unobserve(media);
      observers?.visibility?.unobserve(media);
      listeners.forEach(([eventName, handler]) => {
        try { media.removeEventListener?.(eventName, handler); } catch (_) {}
      });
      listeners.length = 0;
      if (type === 'video' || type === 'lottie') {
        try { media.pause?.(); } catch (_) {}
      }
      try { media.removeAttribute?.('src'); } catch (_) {}
      if (type === 'video') {
        try { media.load?.(); } catch (_) {}
      }
      thumbnailMediaStateByElement.delete(media);
    }
  };
  thumbnailMediaStateByElement.set(media, state);
  return state;
}

/**
 * Release media only when a card is removed/replaced; scrolling out of view
 * pauses expensive animation without throwing away useful browser cache state.
 */
export function disposeProjectThumbnailMedia(root) {
  if (!root) return;
  const media = [];
  if (root.matches?.('.project-thumb-media')) media.push(root);
  root.querySelectorAll?.('.project-thumb-media').forEach(item => media.push(item));
  media.forEach(item => thumbnailMediaStateByElement.get(item)?.dispose());
}

export function buildProjectThumbnailMedia(
  source = {},
  altText = 'Project artwork',
  { resolveAssetUrl, documentRef = globalThis.document, priority = false, ensureLottiePlayer = null } = {}
) {
  if (!source?.src || typeof resolveAssetUrl !== 'function') return null;

  const type = String(source.type || mediaTypeFromSrc(source.src)).toLowerCase();
  const src = resolveAssetUrl(source.src);
  const windowRef = documentRef?.defaultView || globalThis.window;
  const reducedMotion = Boolean(windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  let media;

  if (type === 'video') {
    media = documentRef.createElement('video');
    media.muted = true;
    media.loop = !reducedMotion;
    media.autoplay = false;
    media.playsInline = true;
    media.preload = reducedMotion || priority ? 'metadata' : 'none';
    media.fetchPriority = priority && !reducedMotion ? 'high' : 'low';
  } else if (type === 'lottie') {
    media = documentRef.createElement('lottie-player');
    if (!reducedMotion) media.setAttribute('loop', '');
    media.setAttribute('background', 'transparent');
    media.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  } else if (type === 'model') {
    media = documentRef.createElement('div');
    media.className = 'project-thumb-model';
    media.setAttribute('role', 'img');
    media.setAttribute('aria-label', String(altText) + ' — 3D artwork');

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
    media.fetchPriority = priority ? 'high' : 'low';
  }

  media.classList.add('project-thumb-media');
  if (type !== 'model') {
    media.classList.add('is-media-loading');
    media.dataset.mediaState = 'loading';
    media.dataset.mediaType = type;
  }
  if (type === 'model') media.dataset.modelThumb = String(source.src);
  if (source.background && typeof source.background === 'object') {
    media.dataset.background = JSON.stringify(source.background);
  }

  if (type !== 'model') {
    const state = registerThumbnailMediaState(media, {
      type: ['image', 'video', 'lottie'].includes(type) ? type : 'image',
      src,
      priority,
      reducedMotion,
      windowRef,
      ensureLottiePlayer
    });
    const observers = state.observers;
    if (type === 'image' || !['video', 'lottie'].includes(type)) {
      state.activate();
    } else if (observers?.preload && observers?.visibility) {
      observers.visibility.observe(media);
      if (priority) {
        state.activate();
      } else {
        media.dataset.lazySrc = src;
        observers.preload.observe(media);
      }
    } else {
      state.activate();
      state.setVisible(!reducedMotion);
    }
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
