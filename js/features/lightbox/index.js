/** Architecture V2 — complete lightbox controller. */
import { createLifecycle } from '../../core/lifecycle.js';
import { createLightboxMediaRenderer } from './media-renderer.js?v=20261005-17';
export function getLightboxSwipeDirection(deltaX, deltaY, { threshold = 56, axisRatio = 1.2 } = {}) {
  const x = Number(deltaX) || 0;
  const y = Number(deltaY) || 0;
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  if (absX < threshold || absX <= absY * axisRatio) return 0;
  return x < 0 ? 1 : -1;
}

function createLightboxA11y(lightboxEl, documentRef = globalThis.document, windowRef = globalThis.window, lifecycle = null) {
  if (!lightboxEl) return { open() {}, close() {} };
  let opener = null;
  let focusCleanup = null;
  let keydownCleanup = null;
  function getFocusable() {
    return Array.from(lightboxEl.querySelectorAll(
      'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter(el => {
      if (el.hidden) return false;
      if (el.closest?.('[inert]')) return false;
      const style = documentRef.defaultView?.getComputedStyle?.(el);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      // offsetParent is null for fixed-position controls in Chromium. Use
      // client rects instead so the Lightbox chrome remains part of the
      // keyboard focus cycle without admitting detached/zero-sized nodes.
      return el.getClientRects?.().length > 0;
    });
  }
  function onKeydown(event) {
    if (!lightboxEl.classList.contains('active') || event.key !== 'Tab') return;
    const items = getFocusable();
    if (!items.length) { event.preventDefault(); lightboxEl.focus?.(); return; }
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && documentRef.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && documentRef.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function open({ captureOpener = true } = {}) {
    if (captureOpener) {
      opener = documentRef.activeElement?.nodeType === 1 ? documentRef.activeElement : null;
    }
    lightboxEl.setAttribute('aria-modal','true');
    lightboxEl.setAttribute('aria-hidden','false');
    if (!lightboxEl.hasAttribute('tabindex')) lightboxEl.setAttribute('tabindex','-1');
    keydownCleanup?.();
    keydownCleanup = lifecycle?.listen
      ? lifecycle.listen(documentRef, 'keydown', onKeydown, true)
      : (() => { documentRef.addEventListener('keydown', onKeydown, true); return () => documentRef.removeEventListener('keydown', onKeydown, true); })();
    focusCleanup?.();
    focusCleanup = lifecycle?.animationFrame
      ? lifecycle.animationFrame(() => { const items=getFocusable(); try { (items[0]||lightboxEl).focus({ preventScroll: true }); } catch (_) { (items[0]||lightboxEl).focus?.(); } }, windowRef)
      : (() => { const id=windowRef.requestAnimationFrame(() => { const items=getFocusable(); const target = items[0] || lightboxEl; try { target.focus?.({ preventScroll: true }); } catch (_) { target.focus?.(); } }); return () => windowRef.cancelAnimationFrame?.(id); })();
  }
  function close({ afterFocus, restoreFocus = true } = {}) {
    keydownCleanup?.();
    keydownCleanup = null;
    focusCleanup?.();
    focusCleanup = null;
    const target=opener; opener=null;
    if (restoreFocus && target?.isConnected) {
      try { target.focus({ preventScroll: true }); }
      catch (_) { target.focus(); }
    }
    lightboxEl.setAttribute('aria-hidden','true');
    lightboxEl.removeAttribute('aria-modal');
    afterFocus?.();
  }
  return {open,close};
}


export function initLightbox(options = {}) {
  const documentRef = options.root?.getElementById ? options.root : globalThis.document;
  const windowRef = documentRef?.defaultView || globalThis.window;
  if (!documentRef) return null;

  const resolveAssetUrl = typeof options.resolveAssetUrl === 'function'
    ? options.resolveAssetUrl
    : value => value;
  const parseYouTube = typeof options.parseYouTubeUrl === 'function'
    ? options.parseYouTubeUrl
    : () => ({ id: null, isShort: false });
  const applyMediaBackground = typeof options.applyMediaBackground === 'function'
    ? options.applyMediaBackground
    : null;
  const mountModelViewer = typeof options.mountModelViewer === 'function'
    ? options.mountModelViewer
    : null;
  const getActiveCards = typeof options.getActiveCards === 'function'
    ? options.getActiveCards
    : () => Array.from(documentRef.querySelectorAll('.project-card'));
  const getProjectForCard = typeof options.getProjectForCard === 'function'
    ? options.getProjectForCard
    : () => null;
  const protectionEnabled = typeof options.protectionEnabled === 'function'
    ? options.protectionEnabled
    : () => true;

  // Persistent listeners belong to the Lightbox lifecycle. Media-node listeners
  // remain scoped to short-lived DOM nodes and disappear when their content is
  // replaced.
  const lifecycle = createLifecycle();
  const bind = (target, type, handler, listenerOptions) =>
    lifecycle.listen(target, type, handler, listenerOptions);


/* =========================================
   7. LIGHTBOX MODAL
   ========================================= */
const lightbox = documentRef.getElementById('lightbox');
if (lightbox) lightbox.dataset.component = 'media-viewer';
const lightboxControls = documentRef.getElementById('lightboxControls');
const lightboxClose = documentRef.getElementById('lightboxClose');
const lightboxPrev = documentRef.querySelector('.lightbox-prev');
const lightboxNext = documentRef.querySelector('.lightbox-next');
const modalTitle = documentRef.getElementById('modalTitle');
const modalDesc = documentRef.getElementById('modalDesc');
const modalFullDesc = documentRef.getElementById('modalFullDesc');
const modalMediaContainer = documentRef.getElementById('lightboxMediaContainer');
const lightboxA11y = createLightboxA11y(lightbox, documentRef, windowRef, lifecycle);

const mediaRenderer = createLightboxMediaRenderer({
  documentRef,
  windowRef,
  resolveAssetUrl,
  parseYouTube,
  applyMediaBackground,
  mountModelViewer,
  protectionEnabled,
  lightbox,
  lightboxControls
});

let currentLightboxIndex = 0;
let activeLightboxCards = []; // Only navigate through currently filtered items
let previousPageScrollX = 0;
let previousPageScrollY = 0;
let navigationTimer = null;
let navigationTargetIndex = null;
let swipeStart = null;
let openRenderToken = 0;

// Reads a YouTube URL and returns the video ID plus whether it's a Short.
// Supports: /shorts/ID, youtu.be/ID, watch?v=ID, and /embed/ID links.


function openLightbox(index, initialMediaIndex = -1, { preserveOpener = false } = {}) {
  const preserveNavigation = lightbox.classList.contains('is-lightbox-navigating');
  lightbox.classList.remove('is-3d-focused');
  if (!preserveNavigation) {
    lightbox.classList.remove(
      'is-lightbox-navigating',
      'is-navigation-next',
      'is-navigation-prev',
      'is-lightbox-navigation-enter'
    );
  }
  if (lightboxControls) {
    lightboxControls.classList.remove('is-3d-controls-disabled');
    lightboxControls.inert = false;
  }
  documentRef.documentElement.classList.remove('lm-3d-focus-open');
  documentRef.body.classList.remove('lm-3d-focus-open');
  currentLightboxIndex = index;

  const openToken = ++openRenderToken;
  const card = activeLightboxCards[currentLightboxIndex];
  const project = getProjectForCard(card);

  if (!project) {
    console.warn('Lightbox: no normalized project model is available for this card.');
    return;
  }

  if (modalTitle) modalTitle.textContent = project.title || '';
  if (modalDesc) modalDesc.textContent = project.subtitle || '';
  if (modalFullDesc) modalFullDesc.textContent = project.description || '';

  const wasActive = lightbox.classList.contains('active');
  if (!wasActive) {
    // Capture the page position before the fixed Lightbox takes over the
    // viewport. The modal itself owns scrolling, so the document does not need
    // an overflow lock that can trigger mobile scroll reconciliation.
    previousPageScrollX = Number(windowRef.scrollX) || 0;
    previousPageScrollY = Number(windowRef.scrollY) || 0;
  }

  mediaRenderer.dispose(modalMediaContainer);
  modalMediaContainer.replaceChildren();
  mediaRenderer.renderProjectMedia(modalMediaContainer, project);

  // When a card opens the viewer directly on a non-first media item, promote
  // that exact target to eager loading as well. The renderer deliberately
  // defers secondary media during normal gallery browsing, but the visitor has
  // already expressed intent to view this specific item.
  if (initialMediaIndex >= 0) {
    const target = modalMediaContainer.querySelectorAll('.lightbox-media-item')[initialMediaIndex];
    const image = target?.querySelector('img');
    const video = target?.querySelector('video');
    const youtube = target?.querySelector('iframe[data-lm-youtube]');
    if (image) {
      image.loading = 'eager';
      image.fetchPriority = 'high';
    }
    if (video) {
      video.preload = 'auto';
      video.fetchPriority = 'high';
    }
    if (youtube) {
      youtube.loading = 'eager';
      youtube.fetchPriority = 'high';
    }
  }

  lightbox.classList.add('active');
  if (lightboxControls) lightboxControls.classList.add('active');
  if (!wasActive) {
    lightboxA11y.open({ captureOpener: !preserveOpener });
  }

  // Opening the modal can trigger several layout/asset reconciliation passes
  // on mobile Chromium. The document itself must remain stationary because
  // the Lightbox owns its own fixed viewport and scroll container. Re-assert
  // the captured page position across the initial frames instead of relying
  // on a document overflow lock, which previously caused its own mobile
  // reconciliation jump.
  const capturedPageScrollX = previousPageScrollX;
  const capturedPageScrollY = previousPageScrollY;
  for (let frame = 0; frame < 10; frame += 1) {
    windowRef.requestAnimationFrame(() => {
      if (!lightbox.classList.contains('active') || openRenderToken !== openToken) return;
      try {
        documentRef.documentElement.scrollLeft = capturedPageScrollX;
        documentRef.documentElement.scrollTop = capturedPageScrollY;
        documentRef.body.scrollLeft = capturedPageScrollX;
        documentRef.body.scrollTop = capturedPageScrollY;
        windowRef.scrollTo({
          left: capturedPageScrollX,
          top: capturedPageScrollY,
          behavior: 'auto'
        });
      } catch (_) {}
    });
  }

  // A directly requested media item can still be changing size while its
  // renderer loads (notably 3D models). Reconcile the Lightbox-owned scroll
  // position for a bounded number of animation frames so an early measurement
  // cannot be clamped before the target's final artwork height exists.
  const positionInitialMedia = (frame = 0) => {
    if (!lightbox.classList.contains('active') || currentLightboxIndex !== index || openRenderToken !== openToken) return;

    const items = modalMediaContainer.querySelectorAll('.lightbox-media-item');
    const target = initialMediaIndex >= 0 ? items[initialMediaIndex] : null;

    if (!target) {
      if (initialMediaIndex >= 0 && frame < 60) {
        windowRef.requestAnimationFrame(() => positionInitialMedia(frame + 1));
      }
      return;
    }

    // Never call Element.scrollIntoView() here. The target lives inside the
    // fixed Lightbox scroller, but scrollIntoView() can reconcile every
    // scrollable ancestor and move the document underneath the modal.
    const lightboxRect = lightbox.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const hasGeometry = targetRect.width > 0 && targetRect.height > 0 &&
      lightbox.clientHeight > 0;

    if (hasGeometry) {
      const centeredTop =
        lightbox.scrollTop +
        (targetRect.top - lightboxRect.top) -
        Math.max(0, (lightbox.clientHeight - targetRect.height) / 2);

      lightbox.scrollTo({
        top: Math.max(0, centeredTop),
        behavior: 'auto'
      });
    }

    if (frame < 60) {
      windowRef.requestAnimationFrame(() => positionInitialMedia(frame + 1));
    }
  };

  if (initialMediaIndex >= 0) {
    windowRef.requestAnimationFrame(() => positionInitialMedia());
  } else {
    lightbox.scrollTop = 0;
  }
}




// Projects owns card activation and calls this public method. Lightbox only
// resolves the active-project index and manages viewer state from there.
function openProjectCard(card, { initialMediaIndex = -1 } = {}) {
  if (!card) return false;
  activeLightboxCards = getActiveCards();
  const index = activeLightboxCards.indexOf(card);
  if (index < 0) return false;
  openLightbox(index, initialMediaIndex);
  return true;
}

// Close Lightbox function
function closeLightbox({ restoreFocus = true } = {}) {
  // Invalidate any queued document/media positioning frames from the
  // previous open. A rapid close/reopen or navigate/back sequence must not
  // let an older request move the new Lightbox to a stale media target.
  openRenderToken += 1;
  if (navigationTimer) {
    windowRef.clearTimeout(navigationTimer);
    navigationTimer = null;
  }
  navigationTargetIndex = null;
  swipeStart = null;
  lightbox.classList.remove(
    'active',
    'is-3d-focused',
    'is-lightbox-navigating',
    'is-navigation-next',
    'is-navigation-prev',
    'is-lightbox-navigation-enter'
  );
  if (lightboxControls) {
    lightboxControls.classList.remove('is-3d-controls-disabled');
    lightboxControls.inert = false;
  }
  documentRef.documentElement.classList.remove('lm-3d-focus-open');
  documentRef.body.classList.remove('lm-3d-focus-open');
  if (lightboxControls) lightboxControls.classList.remove('active');
  delete lightbox.dataset.pre3dScrollTop;

  const pageScrollX = previousPageScrollX;
  const pageScrollY = previousPageScrollY;
  const restorePageScroll = () => {
    try {
      documentRef.documentElement.scrollLeft = pageScrollX;
      documentRef.documentElement.scrollTop = pageScrollY;
      documentRef.body.scrollLeft = pageScrollX;
      documentRef.body.scrollTop = pageScrollY;
    } catch (_) {}
    windowRef.scrollTo({
      left: pageScrollX,
      top: pageScrollY,
      behavior: 'auto'
    });
  };

  previousPageScrollX = 0;
  previousPageScrollY = 0;

  // Restore focus synchronously and immediately put the viewport back where
  // it was. The post-layout frames below catch mobile reconciliation.
  lightboxA11y.close({ afterFocus: restorePageScroll, restoreFocus });
  restorePageScroll();
  // Let the renderer own media teardown so YouTube message listeners, playback
  // state, cached iframes, and 3D viewer resources all follow one lifecycle.
  // YouTube frames that loaded successfully can remain in the hidden preload
  // root for instant reuse on the next open.
  mediaRenderer.dispose(modalMediaContainer);
  modalMediaContainer.replaceChildren();
  // Post-layout corrections catch any scroll reconciliation triggered while
  // the Lightbox media subtree and body overflow state are being removed.
  windowRef.requestAnimationFrame(() => {
    restorePageScroll();
    windowRef.requestAnimationFrame(restorePageScroll);
  });
}

// Event Listeners for Lightbox Controls
function navigateLightbox(direction) {
  const step = Number(direction) < 0 ? -1 : 1;
  const total = activeLightboxCards.length;
  if (!lightbox?.classList.contains('active') || total < 2) return;

  // Gestures that arrive before the current transition commits are applied
  // relative to the pending destination. A quick Next -> Previous therefore
  // returns to the currently displayed project instead of becoming a delayed
  // jump to the unrelated previous project.
  if (navigationTimer) {
    windowRef.clearTimeout(navigationTimer);
    navigationTimer = null;
  }

  const baseIndex = navigationTargetIndex === null
    ? currentLightboxIndex
    : navigationTargetIndex;
  const nextIndex = step > 0
    ? (baseIndex + 1) % total
    : (baseIndex - 1 + total) % total;

  if (nextIndex === currentLightboxIndex) {
    navigationTargetIndex = null;
    lightbox.classList.remove(
      'is-lightbox-navigating',
      'is-navigation-next',
      'is-navigation-prev',
      'is-lightbox-navigation-enter'
    );
    return;
  }

  navigationTargetIndex = nextIndex;

  lightbox.classList.remove('is-navigation-next', 'is-navigation-prev');
  lightbox.classList.add(
    'is-lightbox-navigating',
    step > 0 ? 'is-navigation-next' : 'is-navigation-prev'
  );

  const reducedMotion = !!windowRef.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // Match the CSS exit transition so the previous project fully settles out
  // before the next project is mounted. Keeping this equal to the transform/
  // blur duration prevents the navigation from looking like a hard cut.
  const navigationDelay = reducedMotion ? 0 : 280;

  navigationTimer = windowRef.setTimeout(() => {
    navigationTimer = null;
    const targetIndex = navigationTargetIndex;
    navigationTargetIndex = null;
    if (!lightbox.classList.contains('active') || targetIndex === null) return;

    openLightbox(targetIndex, -1, { preserveOpener: true });

    lightbox.classList.add(
      'is-lightbox-navigation-enter',
      step > 0 ? 'is-navigation-next' : 'is-navigation-prev'
    );
    windowRef.requestAnimationFrame(() => {
      if (!lightbox.classList.contains('active')) return;
      windowRef.requestAnimationFrame(() => {
        lightbox.classList.remove(
          'is-lightbox-navigation-enter',
          'is-navigation-next',
          'is-navigation-prev'
        );
      });
    });
  }, navigationDelay);
}

const handlePrev = (event) => {
  event.stopPropagation();
  navigateLightbox(-1);
};

const handleNext = (event) => {
  event.stopPropagation();
  navigateLightbox(1);
};

const handleSwipePointerDown = event => {
  if (!lightbox?.classList.contains('active')) return;
  if (event.pointerType === 'mouse' || event.isPrimary === false) return;

  const target = event.target;
  if (
    target?.closest?.('button, a, iframe, video, .model-viewer-shell')
  ) {
    swipeStart = null;
    return;
  }

  swipeStart = {
    x: Number(event.clientX) || 0,
    y: Number(event.clientY) || 0,
    pointerId: event.pointerId
  };

  try { lightbox.setPointerCapture?.(event.pointerId); } catch (_) {}
};

const handleSwipePointerUp = event => {
  if (!swipeStart || event.pointerType === 'mouse' || event.isPrimary === false) return;

  const start = swipeStart;
  swipeStart = null;

  const direction = getLightboxSwipeDirection(
    (Number(event.clientX) || 0) - start.x,
    (Number(event.clientY) || 0) - start.y
  );
  try { lightbox.releasePointerCapture?.(event.pointerId); } catch (_) {}
  if (!direction) return;

  event.preventDefault();
  navigateLightbox(direction);
};

const handleSwipePointerCancel = event => {
  if (!swipeStart) return;
  if (event?.pointerId !== undefined && event.pointerId !== swipeStart.pointerId) return;
  try { lightbox.releasePointerCapture?.(event.pointerId); } catch (_) {}
  swipeStart = null;
};

const handleBackdropClick = (event) => {
  if (event.target === lightbox) {
    closeLightbox();
  }
};

const handleDocumentKeydown = (event) => {
  if (!lightbox?.classList.contains('active')) return;

  if (event.key === 'Escape') {
    closeLightbox();
    return;
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    navigateLightbox(-1);
    return;
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    navigateLightbox(1);
  }
};

const handlePageHide = event => {
  // A BFCache snapshot must not preserve a live modal, WebGL viewer, or
  // third-party playback state. Do not steal focus while the document is
  // transitioning away.
  if (event?.persisted && lightbox?.classList.contains('active')) {
    closeLightbox({ restoreFocus: false });
  }
};

const handlePageShow = event => {
  // Defensive fallback for browsers that restore the snapshot before the
  // pagehide cleanup has completed.
  if (event?.persisted && lightbox?.classList.contains('active')) {
    closeLightbox();
  }
};

// Lightbox controls have custom activation behavior. Suppress the browser
// button default on the click capture phase so activation cannot scroll the
// underlying document before our custom close/navigation handler runs.
const suppressControlDefault = event => event.preventDefault();
bind(lightboxClose, 'click', suppressControlDefault, true);
bind(lightboxPrev, 'click', suppressControlDefault, true);
bind(lightboxNext, 'click', suppressControlDefault, true);

bind(lightboxClose, 'click', closeLightbox);
bind(lightboxPrev, 'click', handlePrev);
bind(lightboxNext, 'click', handleNext);
bind(lightbox, 'click', handleBackdropClick);
bind(lightbox, 'pointerdown', handleSwipePointerDown, { passive: true });
bind(lightbox, 'pointerup', handleSwipePointerUp);
bind(lightbox, 'pointercancel', handleSwipePointerCancel);
bind(documentRef, 'keydown', handleDocumentKeydown);
bind(windowRef, 'pagehide', handlePageHide);
bind(windowRef, 'pageshow', handlePageShow);

return {
  openCard: openProjectCard,
  close: closeLightbox,
  destroy() {
    if (navigationTimer) {
      windowRef.clearTimeout(navigationTimer);
      navigationTimer = null;
    }
    closeLightbox({ restoreFocus: false });
    mediaRenderer.destroy();
    lifecycle.cleanup();
    activeLightboxCards = [];
  }
};

}