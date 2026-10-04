/**
 * Lightbox media presentation boundary.
 *
 * Converts normalized project media into viewer DOM. Navigation, modal state,
 * and project selection remain in the Lightbox controller.
 */

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
  function buildImageMedia(imgUrl, altText = 'Project artwork') {
    const img = documentRef.createElement('img');
    img.alt = String(altText || 'Project artwork').trim() || 'Project artwork';
    img.src = imgUrl;
    img.draggable = false;
    img.loading = 'lazy';
    img.decoding = 'async';

    if (protectionEnabled()) {
      img.classList.add('no-save');
      img.addEventListener('contextmenu', event => event.preventDefault());
      img.addEventListener('dragstart', event => event.preventDefault());
    }

    return img;
  }

  function pauseYouTubeFrame(iframe) {
    if (!iframe?.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "pauseVideo", args: [] }), "*");
    } catch (_) {}
  }

  function pauseOtherPlayback(container, activeElement = null) {
    if (!container) return;
    container.querySelectorAll("video").forEach(video => {
      if (video === activeElement) return;
      /* pause() is idempotent; calling it even on an already-paused element
         makes playback handoff deterministic when media state is changing
         asynchronously across devices. */
      try { video.pause(); } catch (_) {}
    });
    container.querySelectorAll("iframe[data-lm-youtube]").forEach(iframe => {
      if (iframe === activeElement) return;
      pauseYouTubeFrame(iframe);
    });
  }

  function bindPlaybackHandoff(container, mediaElement, type) {
    if (!container || !mediaElement) return;
    if (type === "video") {
      mediaElement.addEventListener("play", () => pauseOtherPlayback(container, mediaElement));
      mediaElement.addEventListener("pointerdown", () => pauseOtherPlayback(container, mediaElement), { capture: true });
      return;
    }
    if (type === "youtube") {
      /* YouTube is cross-origin, so its play event cannot bubble into the page.
         A pointer/focus handoff pauses every other player before the new
         iframe receives the user's gesture. */
      mediaElement.addEventListener("pointerdown", () => pauseOtherPlayback(container, mediaElement), { capture: true });
      mediaElement.addEventListener("focus", () => pauseOtherPlayback(container, mediaElement));
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

    if (orientation === 'portrait' || orientation === 'square' || orientation === 'landscape') {
      syncClasses(orientation);
      return;
    }

    // Auto-orientation starts conservatively, then switches to the video's
    // real intrinsic dimensions as soon as metadata is available. The exact
    // ratio is applied to both the video and its artwork surface so portrait,
    // square, and non-16:9 landscape MP4s keep their original proportions.
    syncClasses('landscape');
    const syncIntrinsicRatio = () => {
      const width = Number(video.videoWidth);
      const height = Number(video.videoHeight);
      const ratio = width / height;
      if (!Number.isFinite(ratio) || ratio <= 0) return;

      const resolved = ratio < 0.85 ? 'portrait' : ratio > 1.15 ? 'landscape' : 'square';
      syncClasses(resolved);
      const exactRatio = `${width} / ${height}`;
      video.style.aspectRatio = exactRatio;
      if (artwork) artwork.style.aspectRatio = exactRatio;
    };

    syncIntrinsicRatio();
    video.addEventListener('loadedmetadata', syncIntrinsicRatio);
  }

  function renderImage(item, project) {
    return buildMediaEntry(
      buildImageMedia(
        resolveAssetUrl(item.src),
        item.caption || item.description || project.title || 'Project artwork'
      ),
      item.caption || item.description,
      item.background
    );
  }

  function renderYouTube(item, project) {
    const { id, isShort } = parseYouTube(item.src);
    const iframe = documentRef.createElement("iframe");
    iframe.dataset.lmYoutube = "true";
    let embedSrc = item.src;
    if (id) {
      const params = new URLSearchParams();
      params.set("enablejsapi", "1");
      params.set("playsinline", "1");
      if (windowRef?.location?.origin) params.set("origin", windowRef.location.origin);
      embedSrc = "https://www.youtube.com/embed/" + id + "?" + params.toString();
    }
    iframe.src = embedSrc;
    iframe.frameBorder = '0';
    // Lightbox media should be immediately interactive on touch and mouse
    // devices. Lazy-loading can leave the first tap landing while the
    // cross-origin player is still attaching its controls.
    iframe.loading = 'eager';
    iframe.tabIndex = 0;
    iframe.title = item.caption || item.description || project.title || 'Project video';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;

    const orientation = String(item.orientation || '').toLowerCase();
    if (orientation === 'portrait') iframe.classList.add('yt-portrait');
    else if (orientation === 'square') iframe.classList.add('yt-square');
    else if (orientation === 'landscape') iframe.classList.add('yt-landscape');
    else iframe.classList.add(isShort ? 'yt-portrait' : 'yt-landscape');

    return buildMediaEntry(iframe, item.caption || item.description, item.background);
  }

  function renderVideo(item) {
    const video = documentRef.createElement('video');
    video.src = resolveAssetUrl(item.src);
    video.controls = true;
    video.playsInline = true;
    video.controlsList = 'nodownload';
    video.disablePictureInPicture = true;

    if (protectionEnabled()) {
      video.classList.add('no-save');
      video.addEventListener('contextmenu', event => event.preventDefault());
    }

    const entry = buildMediaEntry(video, item.caption || item.description, item.background);
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
    const player = documentRef.createElement('lottie-player');
    player.setAttribute('src', resolveAssetUrl(item.src));
    player.setAttribute('autoplay', '');
    player.setAttribute('loop', '');
    player.setAttribute('background', 'transparent');

    const orientation = String(item.orientation || '').toLowerCase();
    if (orientation === 'portrait') player.classList.add('yt-portrait');
    else if (orientation === 'square') player.classList.add('yt-square');
    else player.classList.add('yt-landscape');

    player.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    player.preserveAspectRatio = 'xMidYMid slice';
    return buildMediaEntry(player, item.caption || item.description, item.background);
  }

  function renderItem(item, project) {
    if (!item?.src) return null;

    const type = String(item.type || 'image').toLowerCase();
    if (type === 'image') return renderImage(item, project);
    if (type === 'youtube') return renderYouTube(item, project);
    if (type === 'video') return renderVideo(item);
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
    mediaList.forEach(item => {
      const entry = renderItem(item, project);
      if (!entry) return;
      container.appendChild(entry);
      const video = entry.querySelector("video");
      if (video) bindPlaybackHandoff(container, video, "video");
      const youtube = entry.querySelector("iframe[data-lm-youtube]");
      if (youtube) bindPlaybackHandoff(container, youtube, "youtube");
      rendered += 1;
    });
    return rendered;
  }

  function dispose(container) {
    if (!container) return;
    pauseOtherPlayback(container);
    container.querySelectorAll('.model-viewer-shell').forEach(shell => {
      try { shell.__modelViewerCleanup?.(); } catch (_) {}
    });
  }

  return {
    renderProjectMedia,
    dispose
  };
}
