/** Architecture V2 — complete lightbox controller. */
import { createLifecycle } from '../../core/lifecycle.js';
function createLightboxA11y(lightboxEl, documentRef = globalThis.document, windowRef = globalThis.window) {
  if (!lightboxEl) return { open() {}, close() {} };
  let opener = null;
  function getFocusable() {
    return Array.from(lightboxEl.querySelectorAll('a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter(el => !el.hidden && el.offsetParent !== null);
  }
  function onKeydown(event) {
    if (!lightboxEl.classList.contains('active') || event.key !== 'Tab') return;
    const items = getFocusable();
    if (!items.length) { event.preventDefault(); lightboxEl.focus?.(); return; }
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && documentRef.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && documentRef.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function open() {
    opener = documentRef.activeElement instanceof HTMLElement ? documentRef.activeElement : null;
    lightboxEl.setAttribute('aria-modal','true');
    if (!lightboxEl.hasAttribute('tabindex')) lightboxEl.setAttribute('tabindex','-1');
    documentRef.addEventListener('keydown', onKeydown, true);
    windowRef.requestAnimationFrame(() => { const items=getFocusable(); (items[0]||lightboxEl).focus?.(); });
  }
  function close() {
    documentRef.removeEventListener('keydown', onKeydown, true);
    const target=opener; opener=null;
    if(target?.isConnected) windowRef.requestAnimationFrame(()=>target.focus());
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
const lightboxControls = documentRef.getElementById('lightboxControls');
const lightboxClose = documentRef.getElementById('lightboxClose');
const lightboxPrev = documentRef.querySelector('.lightbox-prev');
const lightboxNext = documentRef.querySelector('.lightbox-next');
const modalTitle = documentRef.getElementById('modalTitle');
const modalDesc = documentRef.getElementById('modalDesc');
const modalFullDesc = documentRef.getElementById('modalFullDesc');
const modalMediaContainer = documentRef.getElementById('lightboxMediaContainer');
const lightboxA11y = createLightboxA11y(lightbox, documentRef, windowRef);

let currentLightboxIndex = 0;
let activeLightboxCards = []; // Only navigate through currently filtered items

// Reads a YouTube URL and returns the video ID plus whether it's a Short.
// Supports: /shorts/ID, youtu.be/ID, watch?v=ID, and /embed/ID links.


// Builds one artwork image with save-protection applied only when
// switched on at the top of this file (right-click + drag disabled,
// so there's no "Save Image As" path — no watermark, no zoom, just a
// clean image that can't be casually saved).
function buildImageMedia(imgUrl) {
  const img = documentRef.createElement('img');
  img.src = imgUrl;
  img.draggable = false;
  img.loading = 'lazy';
  img.decoding = 'async';

  if (protectionEnabled()) {
    img.classList.add('no-save');
    // Worth being upfront: no front-end trick can block a screenshot
    // outright. This blocks the right-click "Save Image As" menu and
    // drag-to-save, which covers casual reuse — a determined person
    // with a screenshot tool can't be stopped client-side.
    img.addEventListener('contextmenu', (e) => e.preventDefault());
    img.addEventListener('dragstart', (e) => e.preventDefault());
  }

  return img;
}

// Builds a small caption under a media item — but only if there's
// actual text. Add one by putting data-description="..." on that
// <div class="media-item">; leave it off (or empty) and nothing
// renders, no empty box.
function buildMediaCaption(text) {
  if (!text || !text.trim()) return null;
  const p = documentRef.createElement('p');
  p.className = 'media-caption';
  p.textContent = text.trim();
  return p;
}

// Wraps one media element (image or video iframe) together with its
// optional caption so they stay grouped as a single unit.
function buildMediaEntry(mediaEl, captionText, background) {
  const wrap = documentRef.createElement('div');
  wrap.className = 'lightbox-media-item';
  wrap.appendChild(mediaEl);
  if (background && applyMediaBackground) {
    Promise.resolve(applyMediaBackground(wrap, background, resolveAssetUrl)).catch(error => {
      console.warn('Lightbox: media background could not be applied.', error);
    });
  }

  const caption = buildMediaCaption(captionText);
  if (caption) wrap.appendChild(caption);

  return wrap;
}

function openLightbox(index, initialMediaIndex = -1) {
  lightbox.classList.remove('is-3d-focused');
  if (lightboxControls) {
    lightboxControls.classList.remove('is-3d-controls-disabled');
    lightboxControls.inert = false;
  }
  documentRef.documentElement.classList.remove('lm-3d-focus-open');
  documentRef.body.classList.remove('lm-3d-focus-open');
  currentLightboxIndex = index;

  const card = activeLightboxCards[currentLightboxIndex];
  const project = getProjectForCard(card);

  // The viewer consumes the normalized Project model exposed by the Projects
  // feature. It deliberately does not inspect project-card markup, so a card
  // redesign can change its DOM without changing Lightbox behavior.
  if (!project) {
    console.warn('Lightbox: no normalized project model is available for this card.');
    return;
  }

  // 1. Populate Text
  if (modalTitle) modalTitle.textContent = project.title || '';
  if (modalDesc) modalDesc.textContent = project.subtitle || '';
  if (modalFullDesc) modalFullDesc.textContent = project.description || '';

  // 2. Clear previous media and dispose mounted 3D resources.
  modalMediaContainer.querySelectorAll('.model-viewer-shell').forEach(shell => {
    try { shell.__modelViewerCleanup?.(); } catch (_) {}
  });
  modalMediaContainer.innerHTML = '';

  // 3. Render directly from the normalized project model.
  const mediaList = Array.isArray(project.media) && project.media.length
    ? project.media
    : (project.thumbnail?.src ? [{ ...project.thumbnail }] : []);

  mediaList.forEach(item => {
    if (!item?.src) return;

    const type = String(item.type || 'image').toLowerCase();
    const src = String(item.src);
    const caption = String(item.caption || item.description || '');
    const background = item.background && typeof item.background === 'object'
      ? item.background
      : null;
    const orientation = String(item.orientation || '').toLowerCase();

    if (type === 'image') {
      modalMediaContainer.appendChild(
        buildMediaEntry(buildImageMedia(resolveAssetUrl(src)), caption, background)
      );
      return;
    }

    if (type === 'youtube') {
      const { id, isShort } = parseYouTube(src);
      const embedUrl = id ? `https://www.youtube.com/embed/${id}` : src;
      const iframe = documentRef.createElement('iframe');
      iframe.src = embedUrl;
      iframe.frameBorder = '0';
      iframe.loading = 'lazy';
      iframe.title = caption || project.title || 'Project video';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;

      let orientationClass = 'yt-landscape';
      if (orientation === 'portrait') orientationClass = 'yt-portrait';
      else if (orientation === 'square') orientationClass = 'yt-square';
      else if (orientation === 'landscape') orientationClass = 'yt-landscape';
      else if (isShort) orientationClass = 'yt-portrait';

      iframe.classList.add(orientationClass);
      modalMediaContainer.appendChild(buildMediaEntry(iframe, caption, background));
      return;
    }

    if (type === 'video') {
      const video = documentRef.createElement('video');
      video.src = resolveAssetUrl(src);
      video.controls = true;
      video.playsInline = true;
      video.controlsList = 'nodownload';
      video.disablePictureInPicture = true;

      if (protectionEnabled()) {
        video.classList.add('no-save');
        video.addEventListener('contextmenu', (e) => e.preventDefault());
      }

      if (orientation === 'portrait') {
        video.classList.add('yt-portrait');
      } else if (orientation === 'square') {
        video.classList.add('yt-square');
      } else if (orientation === 'landscape') {
        video.classList.add('yt-landscape');
      } else {
        video.classList.add('yt-landscape');
        video.addEventListener('loadedmetadata', () => {
          const ratio = video.videoWidth / video.videoHeight;
          if (!Number.isFinite(ratio) || ratio <= 0) return;

          video.classList.remove('yt-landscape', 'yt-portrait', 'yt-square');
          if (ratio > 1.15) video.classList.add('yt-landscape');
          else if (ratio < 0.85) video.classList.add('yt-portrait');
          else video.classList.add('yt-square');

          video.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
        });
      }

      modalMediaContainer.appendChild(buildMediaEntry(video, caption, background));
      return;
    }

    if (type === 'model') {
      const modelWrap = documentRef.createElement('div');
      modelWrap.className = 'model-viewer-shell lightbox-model-viewer';
      const modelOrientation = orientation || 'auto';
      modelWrap.setAttribute('data-orientation', modelOrientation);
      modelWrap.setAttribute('aria-label', `${project.title || 'Project'} — 3D artwork preview`);

      const modelEntry = buildMediaEntry(modelWrap, caption, background);
      modelEntry.classList.add('is-3d-media-item');
      modalMediaContainer.appendChild(modelEntry);

      if (typeof mountModelViewer !== 'function') {
        modelWrap.innerHTML = '<div class="model-viewer-error">3D model preview is unavailable.</div>';
      } else {
        Promise.resolve()
          .then(() => {
            if (!modelWrap.isConnected || !lightbox.classList.contains('active')) return;

            return mountModelViewer(modelWrap, resolveAssetUrl(src), {
              autoRotate: false,
              background: background || null,
              orientation: modelOrientation,
              resolveUrl: resolveAssetUrl,
              onActivate: () => {
                const currentScroll = lightbox.scrollTop;
                lightbox.dataset.pre3dScrollTop = String(currentScroll);
                lightbox.classList.add('is-3d-focused');
                modelEntry.classList.add('is-3d-focus-target');
                if (lightboxControls) {
                  lightboxControls.classList.add('is-3d-controls-disabled');
                  lightboxControls.inert = true;
                }
                documentRef.documentElement.classList.add('lm-3d-focus-open');
                documentRef.body.classList.add('lm-3d-focus-open');
                windowRef.requestAnimationFrame(() => { lightbox.scrollTop = currentScroll; });
              },
              onDeactivate: () => {
                lightbox.classList.remove('is-3d-focused');
                modelEntry.classList.remove('is-3d-focus-target');
                if (lightboxControls) {
                  lightboxControls.classList.remove('is-3d-controls-disabled');
                  lightboxControls.inert = false;
                }
                documentRef.documentElement.classList.remove('lm-3d-focus-open');
                documentRef.body.classList.remove('lm-3d-focus-open');
                const previousScroll = Number(lightbox.dataset.pre3dScrollTop);
                if (Number.isFinite(previousScroll)) {
                  windowRef.requestAnimationFrame(() => { lightbox.scrollTop = previousScroll; });
                }
                delete lightbox.dataset.pre3dScrollTop;
              }
            });
          })
          .catch(err => {
            modelWrap.innerHTML = '<div class="model-viewer-error">3D model preview is unavailable.</div>';
            console.warn('3D model viewer:', err);
          });
      }
      return;
    }

    if (type === 'lottie') {
      const player = documentRef.createElement('lottie-player');
      player.setAttribute('src', resolveAssetUrl(src));
      player.setAttribute('autoplay', '');
      player.setAttribute('loop', '');
      player.setAttribute('background', 'transparent');

      if (orientation === 'portrait') player.classList.add('yt-portrait');
      else if (orientation === 'square') player.classList.add('yt-square');
      else player.classList.add('yt-landscape');

      player.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      player.preserveAspectRatio = 'xMidYMid slice';
      modalMediaContainer.appendChild(buildMediaEntry(player, caption, background));
    }
  });

  // 4. Show Lightbox and lock body scroll.
  lightbox.classList.add('active');
  if (lightboxControls) lightboxControls.classList.add('active');
  lightboxA11y.open();
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
  lightbox.classList.remove('active', 'is-3d-focused');
  if (lightboxControls) {
    lightboxControls.classList.remove('is-3d-controls-disabled');
    lightboxControls.inert = false;
  }
  documentRef.documentElement.classList.remove('lm-3d-focus-open');
  documentRef.body.classList.remove('lm-3d-focus-open');
  if (lightboxControls) lightboxControls.classList.remove('active');
  lightboxA11y.close();
  delete lightbox.dataset.pre3dScrollTop;
  documentRef.body.style.overflow = ''; // Restore body scroll
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
    openLightbox(currentLightboxIndex - 1);
  } else {
    openLightbox(activeLightboxCards.length - 1); // Loop to end
  }
};

const handleNext = (event) => {
  event.stopPropagation();
  if (currentLightboxIndex < activeLightboxCards.length - 1) {
    openLightbox(currentLightboxIndex + 1);
  } else {
    openLightbox(0); // Loop to start
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