/** Architecture V2 — complete lightbox controller. */
import { createLifecycle } from '../../core/lifecycle.js';
import { createLightboxMediaRenderer } from './media-renderer.js';
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
    if (!lightboxEl.hasAttribute('tabindex')) lightboxEl.setAttribute('tabindex','-1');
    keydownCleanup?.();
    keydownCleanup = lifecycle?.listen
      ? lifecycle.listen(documentRef, 'keydown', onKeydown, true)
      : (() => { documentRef.addEventListener('keydown', onKeydown, true); return () => documentRef.removeEventListener('keydown', onKeydown, true); })();
    focusCleanup?.();
    focusCleanup = lifecycle?.animationFrame
      ? lifecycle.animationFrame(() => { const items=getFocusable(); (items[0]||lightboxEl).focus?.(); }, windowRef)
      : (() => { const id=windowRef.requestAnimationFrame(() => { const items=getFocusable(); (items[0]||lightboxEl).focus?.(); }); return () => windowRef.cancelAnimationFrame?.(id); })();
  }
  function close() {
    keydownCleanup?.();
    keydownCleanup = null;
    focusCleanup?.();
    focusCleanup = null;
    const target=opener; opener=null;
    if(target?.isConnected) {
      focusCleanup = lifecycle?.animationFrame
        ? lifecycle.animationFrame(() => target.focus(), windowRef)
        : (() => { const id=windowRef.requestAnimationFrame(()=>target.focus()); return () => windowRef.cancelAnimationFrame?.(id); })();
    }
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

let contrastRaf = 0;
let contrastCanvas = null;

function sampleMediaLuminance(mediaItem) {
  if (!mediaItem) return null;
  const media = mediaItem.querySelector("img, video");
  if (!media) return null;
  if (media.tagName === "IMG" && (!media.complete || !media.naturalWidth)) return null;
  if (media.tagName === "VIDEO" && media.readyState < 2) return null;

  try {
    contrastCanvas ||= documentRef.createElement("canvas");
    contrastCanvas.width = 16;
    contrastCanvas.height = 16;
    const ctx = contrastCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, 16, 16);
    ctx.drawImage(media, 0, 0, 16, 16);
    const pixels = ctx.getImageData(0, 0, 16, 16).data;
    let weighted = 0, weight = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3] / 255;
      if (alpha <= 0.03) continue;
      const luminance = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
      weighted += luminance * alpha;
      weight += alpha;
    }
    return weight ? weighted / weight : null;
  } catch (_) {
    return null;
  }
}

function getMostVisibleMediaItem() {
  const items = Array.from(modalMediaContainer?.querySelectorAll(".lightbox-media-item") || []);
  if (!items.length) return null;
  const bounds = lightbox.getBoundingClientRect();
  const center = bounds.top + bounds.height / 2;
  let best = null, bestScore = -Infinity;
  items.forEach(item => {
    const rect = item.getBoundingClientRect();
    const overlap = Math.max(0, Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top));
    if (overlap <= 0) return;
    const distance = Math.abs((rect.top + rect.bottom) / 2 - center);
    const score = overlap * 2 - distance * 0.25;
    if (score > bestScore) { bestScore = score; best = item; }
  });
  return best;
}

function updateLightboxControlContrast() {
  contrastRaf = 0;
  if (!lightbox?.classList.contains("active")) return;
  const luminance = sampleMediaLuminance(getMostVisibleMediaItem());
  const bright = Number.isFinite(luminance) && luminance >= 0.68;
  lightbox.classList.toggle("has-bright-media", bright);
  lightbox.dataset.controlContrast = bright ? "dark" : "light";
}

function scheduleLightboxControlContrast() {
  if (contrastRaf || !lightbox?.classList.contains("active")) return;
  contrastRaf = windowRef.requestAnimationFrame(updateLightboxControlContrast);
}

bind(lightbox, "scroll", scheduleLightboxControlContrast, { passive: true });
bind(windowRef, "resize", scheduleLightboxControlContrast);
bind(modalMediaContainer, "load", scheduleLightboxControlContrast, true);
bind(modalMediaContainer, "loadeddata", scheduleLightboxControlContrast, true);
lifecycle.add(() => windowRef.cancelAnimationFrame?.(contrastRaf));

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
let previousBodyOverflow = '';

// Reads a YouTube URL and returns the video ID plus whether it's a Short.
// Supports: /shorts/ID, youtu.be/ID, watch?v=ID, and /embed/ID links.


function openLightbox(index, initialMediaIndex = -1, { preserveOpener = false } = {}) {
  lightbox.classList.remove('is-3d-focused', 'has-bright-media');
  delete lightbox.dataset.controlContrast;
  if (lightboxControls) {
    lightboxControls.classList.remove('is-3d-controls-disabled');
    lightboxControls.inert = false;
  }
  documentRef.documentElement.classList.remove('lm-3d-focus-open');
  documentRef.body.classList.remove('lm-3d-focus-open');
  currentLightboxIndex = index;

  const card = activeLightboxCards[currentLightboxIndex];
  const project = getProjectForCard(card);

  if (!project) {
    console.warn('Lightbox: no normalized project model is available for this card.');
    return;
  }

  if (modalTitle) modalTitle.textContent = project.title || '';
  if (modalDesc) modalDesc.textContent = project.subtitle || '';
  if (modalFullDesc) modalFullDesc.textContent = project.description || '';

  mediaRenderer.dispose(modalMediaContainer);
  modalMediaContainer.innerHTML = '';
  mediaRenderer.renderProjectMedia(modalMediaContainer, project);

  lightbox.classList.add('active');
  if (lightboxControls) lightboxControls.classList.add('active');
  lightboxA11y.open({ captureOpener: !preserveOpener });
  if (!lightbox.classList.contains('active')) previousBodyOverflow = documentRef.body.style.overflow;
  documentRef.body.style.overflow = 'hidden';

  windowRef.requestAnimationFrame(() => {
    const items = modalMediaContainer.querySelectorAll('.lightbox-media-item');
    if (initialMediaIndex >= 0 && items[initialMediaIndex]) {
      items[initialMediaIndex].scrollIntoView({
        behavior: 'auto',
        block: 'center',
        inline: 'nearest'
      });
    } else {
      lightbox.scrollTop = 0;
    }
    scheduleLightboxControlContrast();
  });
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
function closeLightbox() {
  lightbox.classList.remove('active', 'is-3d-focused', 'has-bright-media');
  delete lightbox.dataset.controlContrast;
  if (contrastRaf) {
    windowRef.cancelAnimationFrame?.(contrastRaf);
    contrastRaf = 0;
  }
  if (lightboxControls) {
    lightboxControls.classList.remove('is-3d-controls-disabled');
    lightboxControls.inert = false;
  }
  documentRef.documentElement.classList.remove('lm-3d-focus-open');
  documentRef.body.classList.remove('lm-3d-focus-open');
  if (lightboxControls) lightboxControls.classList.remove('active');
  lightboxA11y.close();
  delete lightbox.dataset.pre3dScrollTop;
  documentRef.body.style.overflow = previousBodyOverflow;
  previousBodyOverflow = '';
  // Dispose any mounted 3D viewers before removing their DOM nodes. The
  // viewer owns OrbitControls, ResizeObserver, WebGL renderer and a document
  // keydown listener, none of which are cleaned up by innerHTML alone.
  modalMediaContainer.querySelectorAll('.model-viewer-shell').forEach(shell => {
    try { shell.__modelViewerCleanup?.(); } catch (_) {}
  });
  modalMediaContainer.innerHTML = ''; // Destroys iframes to stop audio playing in background
}

// Event Listeners for Lightbox Controls
const handlePrev = (event) => {
  event.stopPropagation();
  if (currentLightboxIndex > 0) {
    openLightbox(currentLightboxIndex - 1, -1, { preserveOpener: true });
  } else {
    openLightbox(activeLightboxCards.length - 1, -1, { preserveOpener: true }); // Loop to end
  }
};

const handleNext = (event) => {
  event.stopPropagation();
  if (currentLightboxIndex < activeLightboxCards.length - 1) {
    openLightbox(currentLightboxIndex + 1, -1, { preserveOpener: true });
  } else {
    openLightbox(0, -1, { preserveOpener: true }); // Loop to start
  }
};

const handleBackdropClick = (event) => {
  if (event.target === lightbox) {
    closeLightbox();
  }
};

const handleDocumentKeydown = (event) => {
  if (lightbox && event.key === 'Escape' && lightbox.classList.contains('active')) {
    closeLightbox();
  }
};

bind(lightboxClose, 'click', closeLightbox);
bind(lightboxPrev, 'click', handlePrev);
bind(lightboxNext, 'click', handleNext);
bind(lightbox, 'click', handleBackdropClick);
bind(documentRef, 'keydown', handleDocumentKeydown);

return {
  openCard: openProjectCard,
  close: closeLightbox,
  destroy() {
    closeLightbox();
    lifecycle.cleanup();
    activeLightboxCards = [];
  }
};

}