/** Architecture V2 — complete lightbox controller. */
import { siteAssetUrl } from './site-runtime.js';
import { parseYouTubeUrl } from './cms-data.js';

function createLightboxA11y(lightboxEl) {
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
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function open() {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lightboxEl.setAttribute('aria-modal','true');
    if (!lightboxEl.hasAttribute('tabindex')) lightboxEl.setAttribute('tabindex','-1');
    document.addEventListener('keydown', onKeydown, true);
    window.requestAnimationFrame(() => { const items=getFocusable(); (items[0]||lightboxEl).focus?.(); });
  }
  function close() {
    document.removeEventListener('keydown', onKeydown, true);
    const target=opener; opener=null;
    if(target?.isConnected) window.requestAnimationFrame(()=>target.focus());
  }
  return {open,close};
}


export function initLightbox(options = {}) {
  const getActiveCards = typeof options.getActiveCards === 'function'
    ? options.getActiveCards
    : () => Array.from(document.querySelectorAll('.project-card'));
  const protectionEnabled = typeof options.protectionEnabled === 'function'
    ? options.protectionEnabled
    : () => true;
  const allCards = Array.from(document.querySelectorAll('.project-card'));

/* =========================================
   7. LIGHTBOX MODAL
   ========================================= */
const lightbox = document.getElementById('lightbox');
const lightboxControls = document.getElementById('lightboxControls');
const lightboxClose = document.getElementById('lightboxClose');
const lightboxPrev = document.querySelector('.lightbox-prev');
const lightboxNext = document.querySelector('.lightbox-next');
const modalTitle = document.getElementById('modalTitle');
const modalDesc = document.getElementById('modalDesc');
const modalFullDesc = document.getElementById('modalFullDesc');
const modalMediaContainer = document.getElementById('lightboxMediaContainer');
const lightboxA11y = createLightboxA11y(lightbox);

let currentLightboxIndex = 0;
let activeLightboxCards = []; // Only navigate through currently filtered items

// Reads a YouTube URL and returns the video ID plus whether it's a Short.
// Supports: /shorts/ID, youtu.be/ID, watch?v=ID, and /embed/ID links.


// Builds one artwork image with save-protection applied only when
// switched on at the top of this file (right-click + drag disabled,
// so there's no "Save Image As" path — no watermark, no zoom, just a
// clean image that can't be casually saved).
function buildImageMedia(imgUrl) {
  const img = document.createElement('img');
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
  const p = document.createElement('p');
  p.className = 'media-caption';
  p.textContent = text.trim();
  return p;
}

// Wraps one media element (image or video iframe) together with its
// optional caption so they stay grouped as a single unit.
function buildMediaEntry(mediaEl, captionText, background) {
  const wrap = document.createElement('div');
  wrap.className = 'lightbox-media-item';
  wrap.appendChild(mediaEl);
  if (window.LMMediaBackground && background) window.LMMediaBackground.apply(wrap, background, siteAssetUrl);

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
  document.documentElement.classList.remove('lm-3d-focus-open');
  document.body.classList.remove('lm-3d-focus-open');
  currentLightboxIndex = index;
  const card = activeLightboxCards[currentLightboxIndex];

  // 1. Populate Text
  modalTitle.textContent = card.querySelector('.glass-info h3').textContent;
  modalDesc.textContent = card.querySelector('.glass-info p').textContent;

  const descEl = card.querySelector('.project-description');
  modalFullDesc.textContent = descEl ? descEl.textContent : '';

  // 2. Clear previous media. Give mounted 3D viewers a chance to dispose
  // their OrbitControls, WebGL renderer, ResizeObserver and document-level
  // key listener before their DOM nodes are removed. This prevents stale
  // render loops and interaction handlers when moving between projects.
  modalMediaContainer.querySelectorAll('.model-viewer-shell').forEach(shell => {
    try { shell.__modelViewerCleanup?.(); } catch (_) {}
  });
  modalMediaContainer.innerHTML = '';

  // 3. Populate Media (Images & YouTube)
  const mediaList = card.querySelectorAll('.project-media-list .media-item');

  if (mediaList.length > 0) {
    mediaList.forEach(item => {
      const imgUrl = item.getAttribute('data-image');
      const ytUrl = item.getAttribute('data-youtube');
      const videoUrl = item.getAttribute('data-video');
      const lottieUrl = item.getAttribute('data-lottie');
      const modelUrl = item.getAttribute('data-model');
      const caption = item.getAttribute('data-description');
      let itemBackground=null; try { const raw=item.getAttribute('data-background'); itemBackground=raw?JSON.parse(raw):null; } catch(e){}

      if (imgUrl) {
        modalMediaContainer.appendChild(buildMediaEntry(buildImageMedia(imgUrl), caption, itemBackground));
      }

      if (ytUrl) {
        const { id, isShort } = parseYouTubeUrl(ytUrl);
        const embedUrl = id ? `https://www.youtube.com/embed/${id}` : ytUrl;

        const iframe = document.createElement('iframe');
        iframe.src = embedUrl;
        iframe.frameBorder = '0';
        iframe.loading = 'lazy';
        iframe.title = caption || 'Project video';
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        iframe.allowFullscreen = true;

        // Orientation: a manual "data-orientation" attribute always wins.
        // Otherwise, Shorts links default to portrait and everything
        // else defaults to landscape.
        const manualOrientation = item.getAttribute('data-orientation');
        let orientationClass = 'yt-landscape';

        if (manualOrientation === 'portrait') {
          orientationClass = 'yt-portrait';
        } else if (manualOrientation === 'square') {
          orientationClass = 'yt-square';
        } else if (manualOrientation === 'landscape') {
          orientationClass = 'yt-landscape';
        } else if (isShort) {
          orientationClass = 'yt-portrait';
        }

        iframe.classList.add(orientationClass);
        modalMediaContainer.appendChild(buildMediaEntry(iframe, caption, itemBackground));
      }

      if (videoUrl) {
        const video = document.createElement('video');
        video.src = siteAssetUrl(videoUrl);
        video.controls = true;
        video.playsInline = true;
        video.controlsList = 'nodownload';
        video.disablePictureInPicture = true;

        if (protectionEnabled()) {
          video.classList.add('no-save');
          video.addEventListener('contextmenu', (e) => e.preventDefault());
        }

        const manualVideoOrientation = item.getAttribute('data-orientation');

        if (manualVideoOrientation === 'portrait') {
          video.classList.add('yt-portrait');
        } else if (manualVideoOrientation === 'square') {
          video.classList.add('yt-square');
        } else if (manualVideoOrientation === 'landscape') {
          video.classList.add('yt-landscape');
        } else {
          // No manual override — start with a landscape placeholder
          // (avoids a layout jump before the file loads), then read
          // the video's own real width/height as soon as we know
          // them and size it exactly to that, same spirit as how
          // YouTube Shorts links get auto-detected as portrait.
          video.classList.add('yt-landscape');

          video.addEventListener('loadedmetadata', () => {
            const ratio = video.videoWidth / video.videoHeight;

            video.classList.remove('yt-landscape', 'yt-portrait', 'yt-square');
            if (ratio > 1.15) {
              video.classList.add('yt-landscape');
            } else if (ratio < 0.85) {
              video.classList.add('yt-portrait');
            } else {
              video.classList.add('yt-square');
            }

            // Exact proportions rather than a fixed 16:9 / 9:16 / 1:1
            // template — the class above just sets a sensible max-size
            // envelope for that general shape.
            video.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
          });
        }

        modalMediaContainer.appendChild(buildMediaEntry(video, caption, itemBackground));
      }

      if (modelUrl) {
        const modelWrap = document.createElement('div');
        modelWrap.className = 'model-viewer-shell lightbox-model-viewer';
        const modelOrientation = item.getAttribute('data-orientation') || 'auto';
        modelWrap.setAttribute('data-orientation', modelOrientation);
        modelWrap.setAttribute('aria-label', '3D artwork preview');
        const modelEntry = buildMediaEntry(modelWrap, caption, itemBackground);
        modelEntry.classList.add('is-3d-media-item');
        modalMediaContainer.appendChild(modelEntry);
        import(new URL('model-viewer.js', import.meta.url).href).then(({ mountModelViewer }) => {
          // The project may have been closed or replaced while the lazy
          // Three.js module was loading. Never mount a WebGL viewer into a
          // detached DOM node; doing so would leak a renderer until garbage
          // collection and could keep document-level listeners alive.
          if (!modelWrap.isConnected || !lightbox.classList.contains('active')) return;
          mountModelViewer(modelWrap, siteAssetUrl(modelUrl), {
            autoRotate: false,
            background: itemBackground || null,
            orientation: modelOrientation,
            resolveUrl: siteAssetUrl,
            onActivate: () => {
              // Freeze the current media-list position before promoting this
              // item into the device-focused layer. The target becomes fixed
              // visually, but the list itself never jumps back to the top.
              const currentScroll = lightbox.scrollTop;
              lightbox.dataset.pre3dScrollTop = String(currentScroll);
              lightbox.classList.add('is-3d-focused');
              modelEntry.classList.add('is-3d-focus-target');
              if (lightboxControls) {
                // Project navigation (X / previous / next) is intentionally
                // non-interactive while the 3D stage is active. It sits
                // visually beneath the backdrop veil as part of the
                // lightbox chrome, never as part of the model controls.
                lightboxControls.classList.add('is-3d-controls-disabled');
                lightboxControls.inert = true;
              }
              document.documentElement.classList.add('lm-3d-focus-open');
              document.body.classList.add('lm-3d-focus-open');
              requestAnimationFrame(() => { lightbox.scrollTop = currentScroll; });
            },
            onDeactivate: () => {
              lightbox.classList.remove('is-3d-focused');
              modelEntry.classList.remove('is-3d-focus-target');
              if (lightboxControls) {
                lightboxControls.classList.remove('is-3d-controls-disabled');
                lightboxControls.inert = false;
              }
              document.documentElement.classList.remove('lm-3d-focus-open');
              document.body.classList.remove('lm-3d-focus-open');
              const previousScroll = Number(lightbox.dataset.pre3dScrollTop);
              if (Number.isFinite(previousScroll)) {
                requestAnimationFrame(() => { lightbox.scrollTop = previousScroll; });
              }
              delete lightbox.dataset.pre3dScrollTop;
            }
          });
        }).catch(err => {
          modelWrap.innerHTML = '<div class="model-viewer-error">3D model preview is unavailable.</div>';
          console.warn('3D model viewer:', err);
        });
      }

      if (lottieUrl) {
        // <lottie-player> plays a Lottie/JSON animation the same way
        // <video> plays a video file — same orientation handling as
        // video above (manual override, else a landscape default),
        // since there's no equivalent of videoWidth/videoHeight to
        // read the real proportions from up front.
        const player = document.createElement('lottie-player');
        player.setAttribute('src', siteAssetUrl(lottieUrl));
        player.setAttribute('autoplay', '');
        player.setAttribute('loop', '');
        player.setAttribute('background', 'transparent');

        const manualLottieOrientation = item.getAttribute('data-orientation');
        if (manualLottieOrientation === 'portrait') player.classList.add('yt-portrait');
        else if (manualLottieOrientation === 'square') player.classList.add('yt-square');
        else player.classList.add('yt-landscape');

        player.setAttribute('preserveAspectRatio', 'xMidYMid slice'); player.preserveAspectRatio='xMidYMid slice';
        modalMediaContainer.appendChild(buildMediaEntry(player, caption, itemBackground));
      }
    });
  } else {
    // Fallback: use whichever thumbnail media the card actually renders.
    const thumbMedia = card.querySelector('.card-thumbnail .project-thumb-media, .card-thumbnail img, .card-thumbnail video, .card-thumbnail lottie-player');
    if (thumbMedia) {
      if (thumbMedia.tagName === 'LOTTIE-PLAYER') {
        const player = document.createElement('lottie-player');
        player.setAttribute('src', siteAssetUrl(thumbMedia.getAttribute('src') || ''));
        player.setAttribute('autoplay',''); player.setAttribute('loop',''); player.setAttribute('background','transparent');
        modalMediaContainer.appendChild(buildMediaEntry(player, ''));
      } else if (thumbMedia.tagName === 'VIDEO') {
        const video = document.createElement('video');
        video.src = thumbMedia.src; video.controls = true; video.playsInline = true;
        modalMediaContainer.appendChild(buildMediaEntry(video, ''));
      } else if (thumbMedia.src) {
        modalMediaContainer.appendChild(buildImageMedia(thumbMedia.src));
      }
    }
  }

  // 4. Show Lightbox and lock body scroll
  lightbox.classList.add('active');
  if (lightboxControls) lightboxControls.classList.add('active');
  lightboxA11y.open();
  document.body.style.overflow = 'hidden';

  // When a project was opened by clicking its 3D thumbnail, keep the
  // visitor at that artwork instead of resetting the project overlay to
  // the first media item. The target is centered because it remains easy
  // to understand on both desktop and small touch screens.
  requestAnimationFrame(() => {
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

// Project cards are keyboard-operable as well as pointer-operable.
allCards.forEach(card => {
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  const titleText = card.querySelector('.glass-info h3')?.textContent?.trim();
  card.setAttribute('aria-label', titleText ? `Open project: ${titleText}` : 'Open project');

  const openFromCard = (event) => {
    activeLightboxCards = getActiveCards();
    const index = activeLightboxCards.indexOf(card);

    // The project card uses its first media item as the visual thumbnail
    // fallback. When that fallback is a 3D model, clicking the thumbnail
    // should open the project at that same 3D artwork instead of jumping
    // to the top of the media stack.
    let initialMediaIndex = -1;
    if (event.target.closest('.card-thumbnail [data-model-thumb]')) {
      const mediaItems = Array.from(card.querySelectorAll('.project-media-list .media-item'));
      initialMediaIndex = mediaItems.findIndex(item => item.hasAttribute('data-model'));
    }

    openLightbox(index, initialMediaIndex);
  };

  card.addEventListener('click', openFromCard);
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openFromCard(event);
  });
});

// Close Lightbox function
function closeLightbox() {
  lightbox.classList.remove('active', 'is-3d-focused');
  if (lightboxControls) {
    lightboxControls.classList.remove('is-3d-controls-disabled');
    lightboxControls.inert = false;
  }
  document.documentElement.classList.remove('lm-3d-focus-open');
  document.body.classList.remove('lm-3d-focus-open');
  if (lightboxControls) lightboxControls.classList.remove('active');
  lightboxA11y.close();
  delete lightbox.dataset.pre3dScrollTop;
  document.body.style.overflow = ''; // Restore body scroll
  // Dispose any mounted 3D viewers before removing their DOM nodes. The
  // viewer owns OrbitControls, ResizeObserver, WebGL renderer and a document
  // keydown listener, none of which are cleaned up by innerHTML alone.
  modalMediaContainer.querySelectorAll('.model-viewer-shell').forEach(shell => {
    try { shell.__modelViewerCleanup?.(); } catch (_) {}
  });
  modalMediaContainer.innerHTML = ''; // Destroys iframes to stop audio playing in background
}

// Event Listeners for Lightbox Controls
if (lightboxClose) {
  lightboxClose.addEventListener('click', closeLightbox);
}

if (lightboxPrev) {
  lightboxPrev.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentLightboxIndex > 0) {
      openLightbox(currentLightboxIndex - 1);
    } else {
      openLightbox(activeLightboxCards.length - 1); // Loop to end
    }
  });
}

if (lightboxNext) {
  lightboxNext.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentLightboxIndex < activeLightboxCards.length - 1) {
      openLightbox(currentLightboxIndex + 1);
    } else {
      openLightbox(0); // Loop to start
    }
  });
}

// Close when clicking the dark background outside the modal interior
if (lightbox) {
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) {
      closeLightbox();
    }
  });
}

// Close on 'Esc' key
document.addEventListener('keydown', (e) => {
  if (lightbox && e.key === 'Escape' && lightbox.classList.contains('active')) {
    closeLightbox();
  }
});



}
