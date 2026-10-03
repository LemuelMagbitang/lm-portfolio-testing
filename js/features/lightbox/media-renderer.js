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
  function buildImageMedia(imgUrl) {
    const img = documentRef.createElement('img');
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
    wrap.appendChild(mediaEl);

    if (background && applyMediaBackground) {
      Promise.resolve(applyMediaBackground(wrap, background, resolveAssetUrl))
        .catch(error => console.warn('Lightbox: media background could not be applied.', error));
    }

    const caption = buildMediaCaption(captionText);
    if (caption) wrap.appendChild(caption);

    return wrap;
  }

  function applyVideoOrientation(video, orientation) {
    if (orientation === 'portrait') video.classList.add('yt-portrait');
    else if (orientation === 'square') video.classList.add('yt-square');
    else if (orientation === 'landscape') video.classList.add('yt-landscape');
    else {
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
  }

  function renderImage(item) {
    return buildMediaEntry(
      buildImageMedia(resolveAssetUrl(item.src)),
      item.caption || item.description,
      item.background
    );
  }

  function renderYouTube(item, project) {
    const { id, isShort } = parseYouTube(item.src);
    const iframe = documentRef.createElement('iframe');
    iframe.src = id ? `https://www.youtube.com/embed/${id}` : item.src;
    iframe.frameBorder = '0';
    iframe.loading = 'lazy';
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

    applyVideoOrientation(video, String(item.orientation || '').toLowerCase());
    return buildMediaEntry(video, item.caption || item.description, item.background);
  }

  function renderModel(item, project) {
    const modelWrap = documentRef.createElement('div');
    modelWrap.className = 'model-viewer-shell lightbox-model-viewer';
    const orientation = String(item.orientation || '').toLowerCase() || 'auto';
    modelWrap.setAttribute('data-orientation', orientation);
    modelWrap.setAttribute('aria-label', `${project.title || 'Project'} — 3D artwork preview`);

    const modelEntry = buildMediaEntry(modelWrap, item.caption || item.description, item.background);
    modelEntry.classList.add('is-3d-media-item');

    if (typeof mountModelViewer !== 'function') {
      modelWrap.innerHTML = '<div class="model-viewer-error">3D model preview is unavailable.</div>';
      return modelEntry;
    }

    Promise.resolve()
      .then(() => {
        if (!modelWrap.isConnected || !lightbox?.classList.contains('active')) return;

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
      .catch(error => {
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
    if (type === 'image') return renderImage(item);
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
      rendered += 1;
    });
    return rendered;
  }

  function dispose(container) {
    if (!container) return;
    container.querySelectorAll('.model-viewer-shell').forEach(shell => {
      try { shell.__modelViewerCleanup?.(); } catch (_) {}
    });
  }

  return {
    renderProjectMedia,
    dispose
  };
}
