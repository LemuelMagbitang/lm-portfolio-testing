/** Architecture V2 — complete hero banner controller. */
import { getSiteRootUrl, siteAssetUrl } from '../../infrastructure/browser/site-paths.js';
import { prefersReducedMotion } from '../../infrastructure/browser/reduced-motion.js';
import { ensureLottiePlayer } from '../../infrastructure/lottie/player.js';
import { ensureMediaBackgroundHelper } from '../../infrastructure/media-background/loader.js';
import { loadCmsJson } from '../../infrastructure/cms/loader.js';
import { parseYouTubeUrl } from '../../infrastructure/youtube/url.js';

  /* =========================================
     4. HERO BANNER — AUTO-FILLED WITH THE
        5 LATEST ARTWORKS + FACE-AWARE FOCUS
     ========================================= */
  // "Latest" = whichever 5 project cards are FIRST in index.html's grid.
  // To change what shows in the hero, reorder your project cards there.
  //
  // On the Works page, we read the cards straight from this same page.
  // On any other page (like About), there's no grid to read from, so we
  // fetch index.html in the background and pull the same 5 thumbnails
  // from it — meaning both pages always stay in sync automatically.
  //
  // NOTE: the fetch only works when the site is actually being served
  // (e.g. on GitHub Pages, or a local dev server). If you open about.html
  // by double-clicking the file, browsers block this for local files,
  // and the About hero will just stay empty until viewed on a real server.
  //
  // FOCUS POINT — how each slide decides where to "look":
  //   1. Manual override always wins. Add data-focus="50% 10%" to a
  //      project's thumbnail <img> in index.html and the hero (and About
  //      hero) will crop/zoom around that exact point for that artwork.
  //   2. Otherwise, if the visitor's browser supports native face
  //      detection, we quietly detect the face and center the crop and
  //      zoom on it — no library, no download, just a browser API.
  //   3. Otherwise, it falls back to the top-biased crop already set in
  //      style.css (object-position: center 18%), which is a safe default
  //      for character art and portraits.

  async function applyFocalPoint(slideImg, manualFocus) {
    if (manualFocus) {
      slideImg.style.objectPosition = manualFocus;
      slideImg.style.transformOrigin = manualFocus;
      return;
    }

    // Progressive enhancement only — most browsers don't support this
    // yet, so this silently does nothing and the CSS default (top-biased
    // crop) is what visitors see. Nothing breaks either way.
    if (!('FaceDetector' in window)) return;

    try {
      const detector = new window.FaceDetector({ maxDetectedFaces: 1, fastMode: true });
      const faces = await detector.detect(slideImg);
      if (!faces.length) return;

      const box = faces[0].boundingBox;
      const naturalW = slideImg.naturalWidth || slideImg.width;
      const naturalH = slideImg.naturalHeight || slideImg.height;
      if (!naturalW || !naturalH) return;

      const focusX = ((box.x + box.width / 2) / naturalW) * 100;
      const focusY = ((box.y + box.height / 2) / naturalH) * 100;
      const focusPoint = `${focusX.toFixed(1)}% ${focusY.toFixed(1)}%`;

      // Smoothly re-center onto the detected face rather than snapping.
      slideImg.style.transition = 'object-position 1.2s ease, transform-origin 1.2s ease, opacity 1.5s ease-in-out';
      slideImg.style.objectPosition = focusPoint;
      slideImg.style.transformOrigin = focusPoint;
    } catch (err) {
      // Detection unsupported/failed on this device — keep the default crop.
    }
  }

  // Reads the first 5 project cards out of a document and returns a plain
  // list of {src, alt, focus} for the hero to use.
  //
  // Why it reads data-image and not <img src>: in index.html most
  // .card-thumbnail divs are left EMPTY on purpose, and script.js fills
  // them in at runtime from each card's own first media-item. That works
  // fine on the Works page (the script has already run by then), but a
  // document pulled in with fetch() is raw HTML that never executed any
  // JavaScript — so its thumbnails are still empty divs and looking for
  // an <img> inside them finds nothing. Reading the same data-image
  // attribute the runtime filler reads makes both paths agree.
  //
  // baseUrl matters for the same reason: paths in index.html like
  // "assets/projects/..." are relative to the site root, so when the
  // About page (at /about/) reuses them they must be resolved against
  // the root rather than against /about/, or every slide 404s.
  function collectHeroSources(doc, baseUrl) {
    const cards = doc.querySelectorAll('.project-card');
    return Array.from(cards).map(card => {
      const thumbWrap = card.querySelector('.card-thumbnail');
      const thumbImg = thumbWrap ? thumbWrap.querySelector('img') : null;

      // Same order of preference as fillMissingThumbnails(): a real
      // <img src> if one was written by hand, else the card's first
      // data-image, else its first YouTube thumbnail.
      let rawSrc = thumbImg ? thumbImg.getAttribute('src') : null;
      let explicitType = thumbWrap ? thumbWrap.getAttribute('data-thumbnail-type') : null;
      let explicitBackground = null;
      try { explicitBackground = thumbWrap?.getAttribute('data-background') ? JSON.parse(thumbWrap.getAttribute('data-background')) : null; } catch (e) { explicitBackground = null; }
      const thumbMedia = thumbWrap ? thumbWrap.querySelector('.project-thumb-media') : null;
      if (!rawSrc && thumbMedia && !thumbMedia.hasAttribute('data-model-thumb')) {
        rawSrc = thumbMedia.getAttribute('src');
        explicitType = explicitType || (thumbMedia.tagName === 'VIDEO' ? 'video' : thumbMedia.tagName === 'LOTTIE-PLAYER' ? 'lottie' : 'image');
        if (!explicitBackground) {
          try { explicitBackground = thumbMedia.getAttribute('data-background') ? JSON.parse(thumbMedia.getAttribute('data-background')) : null; } catch (e) { explicitBackground = null; }
        }
      }
      if (!rawSrc) {
        const mediaItems = card.querySelectorAll('.project-media-list .media-item');
        for (const mediaItem of mediaItems) {
          const image = mediaItem.getAttribute('data-image');
          const video = mediaItem.getAttribute('data-video');
          const lottie = mediaItem.getAttribute('data-lottie');
          const rawBg = mediaItem.getAttribute('data-background');
          let mediaBackground=null; try { mediaBackground = rawBg ? JSON.parse(rawBg) : null; } catch(e) {}
          if (image) { rawSrc = image; explicitType = explicitType || 'image'; explicitBackground = mediaBackground; break; }
          if (video) { rawSrc = video; explicitType = explicitType || 'video'; explicitBackground = mediaBackground; break; }
          if (lottie) { rawSrc = lottie; explicitType = explicitType || 'lottie'; explicitBackground = mediaBackground; break; }
        }
        if (!rawSrc) {
          const firstYouTubeItem = card.querySelector('.project-media-list .media-item[data-youtube]');
          if (firstYouTubeItem) { const { id } = parseYouTube(firstYouTubeItem.getAttribute('data-youtube')); if (id) rawSrc = `https://img.youtube.com/vi/${id}/hqdefault.jpg`; }
        }
      }

      if (!rawSrc) return null; // this card has no usable artwork

      let src = rawSrc;
      if (baseUrl) {
        try { src = new URL(rawSrc, baseUrl).href; } catch (e) { /* keep raw */ }
      }

      const titleEl = card.querySelector('.glass-info h3');

      return {
        type: explicitType || heroMediaTypeFromSrc(rawSrc),
        src,
        alt: (thumbImg && thumbImg.getAttribute('alt')) || (titleEl ? titleEl.textContent : 'Featured artwork'),
        focus: (thumbImg && thumbImg.getAttribute('data-focus')) || (thumbWrap && thumbWrap.getAttribute('data-focus')) || null,
        zoom: (thumbImg && thumbImg.getAttribute('data-zoom')) || null,
        rotate: (thumbImg && thumbImg.getAttribute('data-rotate')) || null,
        background: explicitBackground
      };
    }).filter(Boolean);
  }

  // Guesses a hero slide's media type from its file extension — used
  // wherever the source doesn't already carry an explicit type field
  // (the DOM-scraping path above has no such attribute to read).
  // data/hero-loop.json and data/projects.json entries carry their own
  // real `type`, read directly instead of guessed, in the two
  // functions below.
  function heroMediaTypeFromSrc(src) {
    const clean = (src || '').split('?')[0].split('#')[0].toLowerCase();
    if (/\.(mp4|webm|mov|m4v)$/.test(clean)) return 'video';
    if (/\.json$/.test(clean)) return 'lottie';
    return 'image';
  }

  // The data/projects.json equivalent of collectHeroSources's per-card
  // mapping above — same order of preference (explicit thumbnail, then
  // first media item, then first YouTube item's thumbnail), just
  // reading JSON fields instead of DOM attributes since there's no
  // rendered markup to read them from here.
  function heroSourceFromProjectData(p, baseUrl) {
    if (!p) return null;
    const thumb = p.thumbnail || {};
    let rawSrc = thumb.src || null;
    let type = rawSrc ? (thumb.type || heroMediaTypeFromSrc(rawSrc)) : null;
    let background = thumb.background || null;

    if (!rawSrc && Array.isArray(p.media)) {
      const firstUsable = p.media.find(m => m && m.src && (m.type === 'image' || m.type === 'video' || m.type === 'lottie'));
      if (firstUsable) {
        rawSrc = firstUsable.src;
        type = firstUsable.type;
        background = firstUsable.background || null;
      } else {
        const firstYouTube = p.media.find(m => m && m.type === 'youtube' && m.src);
        if (firstYouTube) {
          const { id } = parseYouTube(firstYouTube.src);
          if (id) { rawSrc = `https://img.youtube.com/vi/${id}/hqdefault.jpg`; type = 'image'; }
        }
      }
    }

    if (!rawSrc) return null;

    let src = rawSrc;
    if (baseUrl) {
      try { src = new URL(rawSrc, baseUrl).href; } catch (e) { /* keep raw */ }
    }

    return { type: type || 'image', src, alt: p.title || 'Featured artwork', focus: thumb.focus || null, zoom: thumb.zoom || null, rotate: thumb.rotate || null, background };
  }

  // Same shape again, this time for a hand-curated entry in
  // data/hero-loop.json — used only in 'manual' loop mode. Every field
  // already exists on the entry itself; this just resolves its path
  // against the site root, same as every other data-driven path here.
  function heroSourceFromManualEntry(item, baseUrl) {
    if (!item || !item.src) return null;
    let src = item.src;
    try { src = new URL(item.src, baseUrl).href; } catch (e) { /* keep raw */ }
    return {
      type: item.type || heroMediaTypeFromSrc(item.src),
      src,
      alt: item.alt || 'Featured artwork',
      focus: item.focus || null,
      zoom: item.zoom || null,
      rotate: item.rotate || null,
      background: item.background || null,
      fadeInMs: Number.isFinite(Number(item.fadeInMs)) ? Math.max(0, Number(item.fadeInMs)) : 1500,
      fadeOutMs: Number.isFinite(Number(item.fadeOutMs)) ? Math.max(0, Number(item.fadeOutMs)) : 1500
    };
  }

  async function initHeroBanner(options = {}) {
    const loadJson = typeof options.loadJson === 'function' ? options.loadJson : loadCmsJson;
    const resolveAssetUrl = typeof options.resolveAssetUrl === 'function' ? options.resolveAssetUrl : siteAssetUrl;
    const getSiteRoot = typeof options.getSiteRootUrl === 'function' ? options.getSiteRootUrl : getSiteRootUrl;
    const ensureLottie = typeof options.ensureLottiePlayer === 'function' ? options.ensureLottiePlayer : ensureLottiePlayer;
    const ensureMediaBackground = typeof options.ensureMediaBackgroundHelper === 'function' ? options.ensureMediaBackgroundHelper : ensureMediaBackgroundHelper;
    const applyMediaBackground = typeof options.applyMediaBackground === 'function' ? options.applyMediaBackground : null;
    const parseYouTube = typeof options.parseYouTubeUrl === 'function' ? options.parseYouTubeUrl : parseYouTubeUrl;
    const isReducedMotion = typeof options.prefersReducedMotion === 'function' ? options.prefersReducedMotion : prefersReducedMotion;

    const heroLoopUrl = options.heroLoopUrl || 'data/hero-loop.json';
    const projectsUrl = options.projectsUrl || 'data/projects.json';

    const config = {
      loopMode: ['latest','manual','mixed'].includes(options.loopMode) ? options.loopMode : 'latest',
      transitionStyle: ['kenburns','fade','none'].includes(options.transitionStyle) ? options.transitionStyle : 'kenburns',
      crossfadeMs: Number.isFinite(Number(options.crossfadeMs)) && Number(options.crossfadeMs) >= 500 ? Number(options.crossfadeMs) : 3500
    };
    const heroContainer = document.getElementById('heroBanner') || document.getElementById('heroBannerAbout');
    if (!heroContainer) return;

    const siteRootUrl = getSiteRoot();
    let latestSources = [];
    let manualSources = [];
    let sources = [];

    // Load the CMS-curated manual list from the configured URL. A file path
    // is preferred over pasted JSON because it stays version-controlled,
    // cacheable, and easy to replace from the Media Library.
    try {
      const list = await loadJson(heroLoopUrl, [], { resolveUrl: resolveAssetUrl });
      manualSources = (Array.isArray(list) ? list : [])
        .map(item => heroSourceFromManualEntry(item, siteRootUrl))
        .filter(Boolean);
    } catch (err) {
      if (config.loopMode === 'manual' || config.loopMode === 'mixed') {
        console.warn('Hero banner: could not load manual hero loop data.', err);
      }
    }

    // Load the same project ordering the portfolio uses.
    try {
      latestSources = collectHeroSources(document, null);
      if (latestSources.length === 0) {
        const list = await loadJson(projectsUrl, [], { resolveUrl: resolveAssetUrl });
        latestSources = (Array.isArray(list) ? list : [])
          .map(p => heroSourceFromProjectData(p, siteRootUrl))
          .filter(Boolean);
      }
    } catch (err) {
      console.warn('Hero banner: could not load artwork from data/projects.json.', err);
    }

    function sourceKey(source) {
      return `${source.type}|${source.src}`;
    }

    if (config.loopMode === 'manual') {
      sources = manualSources;
    } else if (config.loopMode === 'mixed') {
      // Manual additions take priority; newest projects fill the remaining
      // slots until the five-slide hero is full. Dedupe prevents adding the
      // same file twice when a manual entry points at a project thumbnail.
      const seen = new Set();
      sources = [];
      for (const source of manualSources) {
        if (sources.length >= 5) break;
        const key = sourceKey(source);
        if (seen.has(key)) continue;
        seen.add(key); sources.push(source);
      }
      for (const source of latestSources) {
        if (sources.length >= 5) break;
        const key = sourceKey(source);
        if (seen.has(key)) continue;
        seen.add(key); sources.push(source);
      }
    } else {
      sources = latestSources.slice(0, 5);
    }

    if (!sources.length) return;

    if (sources.some(source => source.type === 'lottie')) await ensureLottie();
    if (sources.some(source => source.background)) await ensureMediaBackground();

    heroContainer.classList.remove('transition-kenburns', 'transition-fade', 'transition-none');
    heroContainer.classList.add('transition-' + config.transitionStyle);

    for (const [i, source] of sources.entries()) {
      const wrap = document.createElement('div');
      wrap.className = 'slide' + (i === 0 ? ' active' : '');

      let media;
      if (source.type === 'video') {
        media = document.createElement('video');
        media.src = resolveAssetUrl(source.src);
        media.autoplay = true; media.muted = true; media.loop = true; media.playsInline = true;
      } else if (source.type === 'lottie') {
        // <lottie-player> is a custom element from the lottie-player
        // library (loaded in this page's <head>) — it takes a JSON
        // animation file the same way an <img> takes a picture file.
        media = document.createElement('lottie-player');
        media.setAttribute('src', resolveAssetUrl(source.src));
        media.setAttribute('autoplay', '');
        media.setAttribute('loop', '');
        media.setAttribute('background', 'transparent');
        media.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      } else {
        media = document.createElement('img');
        media.src = resolveAssetUrl(source.src);
        media.alt = source.alt;
      }
      const fadeInMs = Number.isFinite(Number(source.fadeInMs)) ? Math.max(0, Number(source.fadeInMs)) : 1500;
      const fadeOutMs = Number.isFinite(Number(source.fadeOutMs)) ? Math.max(0, Number(source.fadeOutMs)) : 1500;
      wrap.style.setProperty('--hero-fade-in-ms', `${fadeInMs}ms`);
      wrap.style.setProperty('--hero-fade-out-ms', `${fadeOutMs}ms`);

      wrap.appendChild(media);
      heroContainer.appendChild(wrap);
      if (applyMediaBackground && source.background) await applyMediaBackground(wrap, source.background, resolveAssetUrl);

      if (source.focus) { media.style.objectPosition = source.focus; media.style.transformOrigin = source.focus; }
      media.style.setProperty('--hero-zoom', source.zoom || 1);
      media.style.setProperty('--hero-rotate', (source.rotate || 0) + 'deg');

      // Auto face-detection fallback only ever made sense for still
      // images with no focus point already set by hand — video and
      // Lottie slides skip it entirely, and an image with an explicit
      // focus already has what it needs.
      if (source.type === 'image' && !source.focus) {
        if (media.complete) applyFocalPoint(media, null);
        else media.addEventListener('load', () => applyFocalPoint(media, null), { once: true });
      }
    }

    const stopCrossfade = startHeroCrossfade(heroContainer, config.crossfadeMs);
    return {
      destroy() {
        stopCrossfade?.();
        heroContainer.querySelectorAll('.slide').forEach(slide => {
          slide.querySelectorAll('video').forEach(video => video.pause?.());
        });
        heroContainer.replaceChildren();
        heroContainer.classList.remove('transition-kenburns', 'transition-fade', 'transition-none');
      }
    };
  }

  function startHeroCrossfade(heroContainer, crossfadeMs) {
    const slides = heroContainer.querySelectorAll('.slide');
    if (slides.length <= 1) return () => {};

    let currentSlide = 0;
    if (isReducedMotion()) return () => {};
    const intervalMs = Number.isFinite(Number(crossfadeMs)) && Number(crossfadeMs) >= 500
      ? Number(crossfadeMs)
      : 3500;
    const intervalId = setInterval(() => {
      slides[currentSlide].classList.remove('active');
      currentSlide = (currentSlide + 1) % slides.length;
      slides[currentSlide].classList.add('active');
    }, intervalMs); // configured in Hero Loop Animation

    return () => clearInterval(intervalId);
  }
export { initHeroBanner as initHeroBannerV2 };
