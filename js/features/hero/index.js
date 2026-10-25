/** Architecture V2 — complete hero banner controller. */
import { getSiteRootUrl, siteAssetUrl } from '../../infrastructure/browser/site-paths.js?v=20261004-01';
import { prefersReducedMotion } from '../../infrastructure/browser/reduced-motion.js';
import { ensureLottiePlayer } from '../../infrastructure/lottie/player.js';
import { ensureMediaBackgroundHelper } from '../../infrastructure/media-background/loader.js?v=20261023-01';
import { loadCmsJson } from '../../infrastructure/cms/loader.js';
import { parseYouTubeUrl } from '../../infrastructure/youtube/url.js';
import { normalizeProjects } from '../../data/project-normalizer.js?v=20261025-07';
import { createLifecycle } from '../../core/lifecycle.js';
import { loadPublicMuxVideos } from '../../infrastructure/mux/public-videos.js';
import { ensureMuxPlayer } from '../../infrastructure/mux/player.js';

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

  async function applyFocalPoint(slideImg, manualFocus, windowRef = globalThis.window) {
    if (manualFocus) {
      slideImg.style.objectPosition = manualFocus;
      slideImg.style.transformOrigin = manualFocus;
      return;
    }

    // Progressive enhancement only — most browsers don't support this
    // yet, so this silently does nothing and the CSS default (top-biased
    // crop) is what visitors see. Nothing breaks either way.
    if (!('FaceDetector' in windowRef)) return;

    try {
      const detector = new windowRef.FaceDetector({ maxDetectedFaces: 1, fastMode: true });
      const faces = await detector.detect(slideImg);
      if (!slideImg.isConnected || !faces.length) return;

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

  // The Hero consumes normalized Project models supplied by the Projects
  // feature. About/standalone pages can supply none; in that case the Hero
  // loads the same CMS project data itself and normalizes it locally. This
  // keeps Hero independent from whatever DOM representation the gallery uses.

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

    return { type: type || 'image', src, alt: p.title || 'Featured artwork', focus: thumb.focus || null, zoom: thumb.zoom || null, rotate: thumb.rotate || null, background, zoomTransition: typeof thumb.zoomTransition === 'boolean' ? thumb.zoomTransition : null, fadeTransition: typeof thumb.fadeTransition === 'boolean' ? thumb.fadeTransition : null };
  }

  function normalizeHeroMessages(raw) {
    const list = Array.isArray(raw)
      ? raw
      : (Array.isArray(raw?.messages) ? raw.messages : []);

    return list
      .filter(item => item && typeof item === 'object' && String(item.text || '').trim())
      .map(item => ({
        label: String(item.label || '').trim(),
        text: String(item.text || '').trim(),
        author: String(item.author || '').trim(),
        source: String(item.source || '').trim(),
        weight: Number.isFinite(Number(item.weight)) && Number(item.weight) >= 0 ? Number(item.weight) : 1
      }));
  }

  function pickHeroMessage(messages, exclude = -1) {
    if (messages.length <= 1) return 0;
    const excluded = exclude instanceof Set
      ? exclude
      : new Set(Number.isInteger(exclude) && exclude >= 0 ? [exclude] : []);
    let candidates = messages.map((_, index) => index).filter(index => !excluded.has(index));
    if (!candidates.length) candidates = messages.map((_, index) => index);
    const weighted = candidates
      .map(index => ({ index, weight: Math.max(0, Number(messages[index].weight) || 0) }))
      .filter(item => item.weight > 0);
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    if (total <= 0) return candidates[Math.floor(Math.random() * candidates.length)];
    let roll = Math.random() * total;
    for (const item of weighted) {
      roll -= item.weight;
      if (roll < 0) return item.index;
    }
    return weighted[weighted.length - 1].index;
  }

  function readLastMessageIndex(key, windowRef) {
    try {
      const raw = windowRef?.localStorage?.getItem(key);
      const index = raw === null || raw === undefined ? -1 : Number.parseInt(raw, 10);
      return Number.isInteger(index) && index >= 0 ? index : -1;
    } catch (_) {
      return -1;
    }
  }

  function rememberMessageIndex(key, index, windowRef) {
    try {
      windowRef?.localStorage?.setItem(key, String(index));
    } catch (_) {
      // Keep random selection working when storage is unavailable.
    }
  }

  function buildHeroMessageView(documentRef, root) {
    if (!root) return null;

    const ensure = (id, className, tagName) => {
      let element = root.querySelector('.' + className);
      if (!element) {
        element = documentRef.createElement(tagName);
        element.className = className;
        element.id = id;
        root.appendChild(element);
      }
      return element;
    };

    const isFooterMessage = root.classList.contains('footer-hero-message');
    const label = ensure(isFooterMessage ? 'footerQuoteLabel' : 'heroQuoteLabel', 'hero-quote-label', 'span');
    const text = ensure(isFooterMessage ? 'footerQuoteText' : 'heroQuoteText', 'hero-quote-text', 'p');
    const author = ensure(isFooterMessage ? 'footerQuoteAuthor' : 'heroQuoteAuthor', 'hero-quote-author', 'span');

    root.append(label, text, author);
    return { root, label, text, author };
  }

  function renderHeroMessage(view, item) {
    if (!view || !item) return;
    view.label.textContent = item.label;
    view.label.style.display = item.label ? '' : 'none';
    view.text.textContent = item.text;
    const credit = [item.author, item.source].filter(Boolean).join(', ');
    view.author.textContent = credit ? '— ' + credit : '';
    view.author.style.display = credit ? '' : 'none';
    view.root.classList.add('is-ready');
  }

  // Same shape again, this time for a hand-curated entry in
  // data/hero-loop.json — used only in 'manual' loop mode. Every field
  // already exists on the entry itself; this just resolves its path
  // against the site root, same as every other data-driven path here.
  function heroSourceFromManualEntry(item, baseUrl) {
    if (!item) return null;
    const playbackId = String(item.playbackId || '').trim();
    const declaredMux = item.type === 'mux' || item.provider === 'mux' || Boolean(playbackId);
    if (!item.src && !(declaredMux && playbackId)) return null;
    let src = item.src || '';
    if (src) {
      try { src = new URL(src, baseUrl).href; } catch (e) { /* keep raw */ }
    }
    return {
      type: declaredMux ? 'mux' : (item.type || heroMediaTypeFromSrc(item.src)),
      playbackId: playbackId || null,
      src,
      alt: item.alt || 'Featured artwork',
      focus: item.focus || null,
      zoom: item.zoom || null,
      rotate: item.rotate || null,
      poster: item.poster || null,
      background: item.background || null,
      fadeInMs: Number.isFinite(Number(item.fadeInMs)) ? Math.max(0, Number(item.fadeInMs)) : 1500,
      fadeOutMs: Number.isFinite(Number(item.fadeOutMs)) ? Math.max(0, Number(item.fadeOutMs)) : 1500,
      zoomTransition: typeof item.zoomTransition === 'boolean' ? item.zoomTransition : null,
      fadeTransition: typeof item.fadeTransition === 'boolean' ? item.fadeTransition : null
    };
  }

  async function initHeroBanner(options = {}) {
    const documentRef = options.root?.getElementById ? options.root : globalThis.document;
    const windowRef = documentRef?.defaultView || globalThis.window;
    if (!documentRef || !windowRef) return;

    const loadJson = typeof options.loadJson === 'function' ? options.loadJson : loadCmsJson;
    const resolveAssetUrl = typeof options.resolveAssetUrl === 'function' ? options.resolveAssetUrl : siteAssetUrl;
    const getSiteRoot = typeof options.getSiteRootUrl === 'function' ? options.getSiteRootUrl : getSiteRootUrl;
    const ensureLottie = typeof options.ensureLottiePlayer === 'function' ? options.ensureLottiePlayer : ensureLottiePlayer;
    const ensureMediaBackground = typeof options.ensureMediaBackgroundHelper === 'function' ? options.ensureMediaBackgroundHelper : ensureMediaBackgroundHelper;
    const applyMediaBackground = typeof options.applyMediaBackground === 'function' ? options.applyMediaBackground : null;
    const parseYouTube = typeof options.parseYouTubeUrl === 'function' ? options.parseYouTubeUrl : parseYouTubeUrl;
    const getProjects = typeof options.getProjects === 'function' ? options.getProjects : null;
    const isReducedMotion = typeof options.prefersReducedMotion === 'function' ? options.prefersReducedMotion : prefersReducedMotion;

    const heroLoopUrl = options.heroLoopUrl || 'data/hero-loop.json';
    const heroMessagesUrl = options.heroMessagesUrl || 'data/hero.json';
    const projectsUrl = options.projectsUrl || 'data/projects.json';

    const config = {
      loopMode: ['latest','manual','mixed'].includes(options.loopMode) ? options.loopMode : 'latest',
      transitionStyle: ['kenburns','fade','none'].includes(options.transitionStyle) ? options.transitionStyle : 'kenburns',
      crossfadeMs: Number.isFinite(Number(options.crossfadeMs)) && Number(options.crossfadeMs) >= 500 ? Number(options.crossfadeMs) : 3500,
      messageFadeMs: Number.isFinite(Number(options.messageFadeMs)) && Number(options.messageFadeMs) >= 0 ? Number(options.messageFadeMs) : 600,
      defaultVideoPoster: typeof options.defaultVideoPoster === 'string' ? options.defaultVideoPoster.trim() : ''
    };
    const heroContainer = documentRef.getElementById('heroBanner') || documentRef.getElementById('heroBannerAbout');
    if (!heroContainer) return;
    heroContainer.dataset.component = 'portfolio-hero';

    const siteRootUrl = getSiteRoot();
    const lifecycle = createLifecycle();
    let latestSources = [];
    let manualSources = [];
    let sources = [];



    const showHeroMessage = options.showHeroMessage !== false;
    const showFooterMessage = options.showFooterMessage === true;
    const heroMessageCandidate = documentRef.getElementById('heroQuote') || documentRef.querySelector('.hero-quote');
    if (heroMessageCandidate) {
      heroMessageCandidate.hidden = !showHeroMessage;
      const heroSection = heroMessageCandidate.closest('.hero-section');
      if (heroSection) heroSection.classList.toggle('hero-section--message', showHeroMessage);
    }
    const heroMessageRoot = showHeroMessage ? heroMessageCandidate : null;

    const footerContent = documentRef.querySelector('.footer-content');
    const footerElement = footerContent?.closest('footer');
    if (footerElement) footerElement.classList.toggle('footer--message-enabled', showFooterMessage);
    let footerMessageRoot = footerContent?.querySelector('.footer-hero-message') || null;
    if (showFooterMessage && footerContent) {
      if (!footerMessageRoot) {
        footerMessageRoot = documentRef.createElement('div');
        footerMessageRoot.className = 'footer-hero-message';
        const socials = footerContent.querySelector('.social-icons');
        footerContent.insertBefore(footerMessageRoot, socials || footerContent.firstChild);
      }
      footerMessageRoot.hidden = false;
    } else if (footerMessageRoot) {
      footerMessageRoot.remove();
      footerMessageRoot = null;
    }

    if (footerMessageRoot) footerMessageRoot.classList.add('hero-quote');

    const messageTargets = [
      { key: 'hero', root: heroMessageRoot },
      { key: 'footer', root: footerMessageRoot }
    ].filter(target => target.root)
      .map(target => ({ ...target, view: buildHeroMessageView(documentRef, target.root) }));

    if (messageTargets.length) {
      let messages = [{ label: 'LM.', text: 'Open for freelance work.', author: '', source: '', weight: 1 }];
      try {
        const rawMessages = await loadJson(heroMessagesUrl, null, { resolveUrl: resolveAssetUrl });
        const cmsMessages = normalizeHeroMessages(rawMessages);
        if (cmsMessages.length) messages = cmsMessages;
      } catch (err) {
        console.warn('Hero messages: could not load', heroMessagesUrl, err);
      }

      // Select once from the settled CMS list per page load. Artwork keeps
      // looping independently; quote copy has no timer. Avoid repeating the
      // last choice across refreshes when localStorage is available.
      const usedIndices = new Set();
      const selections = messageTargets.map(target => {
        const storageKey = target.key === 'hero' ? 'lm:lastHeroMessage' : 'lm:lastFooterMessage';
        const previousIndex = readLastMessageIndex(storageKey, windowRef);
        const excluded = new Set(usedIndices);
        if (messages.length > 1 && previousIndex >= 0 && previousIndex < messages.length) excluded.add(previousIndex);
        const index = pickHeroMessage(messages, excluded);
        usedIndices.add(index);
        rememberMessageIndex(storageKey, index, windowRef);
        target.view.root.style.transitionDuration = config.messageFadeMs + 'ms';
        return { target, item: messages[index] };
      });

      selections.forEach(({ target, item }) => renderHeroMessage(target.view, item));
      windowRef.requestAnimationFrame(() => {
        messageTargets.forEach(({ view }) => { view.root.style.opacity = '1'; });
      });
    }

    // Load the CMS-curated manual list from the configured URL. A file path
    // is preferred over pasted JSON because it stays version-controlled,
    // cacheable, and easy to replace from the Media Library.
    if (config.loopMode === 'manual' || config.loopMode === 'mixed') {
      try {
        // The manual loop is optional presentation data. Bound its request so a
        // slow/missing JSON file cannot hold the hero behind the startup gate.
        const list = await loadJson(heroLoopUrl, [], {
          resolveUrl: resolveAssetUrl,
          timeoutMs: 3500
        });
        manualSources = (Array.isArray(list) ? list : [])
          .map(item => heroSourceFromManualEntry(item, siteRootUrl))
          .filter(Boolean);

        // Mux is optional: use it only when configuration, feed, and player
        // are available. The checked-in MP4 list remains the fallback.
        try {
          const remoteVideos = await loadPublicMuxVideos('hero', {
            resolveUrl: resolveAssetUrl,
            fetchImpl: windowRef.fetch.bind(windowRef),
            timeoutMs: 1400
          });
          if (remoteVideos.length && await ensureMuxPlayer()) {
            manualSources = config.loopMode === 'mixed'
              ? remoteVideos.concat(manualSources)
              : remoteVideos;
          }
        } catch (_) {
          // The video backend must never block the normal portfolio startup.
        }
      } catch (err) {
        console.warn('Hero banner: could not load manual hero loop data.', err);
      }
    }

    // Only resolve project models for latest/mixed mode. Manual mode already
    // has its complete list in hero-loop.json, so the unrelated Projects feed
    // must not delay the first hero-video request on Works or About.
    if (config.loopMode !== 'manual') {
      try {
        let models = [];
        try { models = getProjects?.() || []; } catch (_) { models = []; }

        if (!Array.isArray(models) || !models.length) {
          const list = await loadJson(projectsUrl, [], { resolveUrl: resolveAssetUrl });
          models = normalizeProjects(list);
        }

        latestSources = models
          .map(project => heroSourceFromProjectData(project, siteRootUrl))
          .filter(Boolean);
      } catch (err) {
        console.warn('Hero banner: could not load normalized artwork from data/projects.json.', err);
      }
    }

    function sourceKey(source) {
      return source.type === 'mux'
        ? 'mux|' + String(source.playbackId || '')
        : String(source.type) + '|' + String(source.src || '');
    }

    if (config.loopMode === 'manual') {
      sources = manualSources;
      // A manually curated loop must never be a single point of failure. If its
      // JSON times out, is empty, or contains invalid entries, use the already
      // normalized project thumbnails as the visual fallback instead.
      if (!sources.length) {
        let fallbackModels = [];
        try { fallbackModels = getProjects?.() || []; } catch (_) { fallbackModels = []; }
        if (!Array.isArray(fallbackModels) || !fallbackModels.length) {
          try {
            const projectList = await loadJson(projectsUrl, [], { resolveUrl: resolveAssetUrl });
            fallbackModels = normalizeProjects(projectList);
          } catch (_) {
            fallbackModels = [];
          }
        }
        latestSources = fallbackModels
          .map(project => heroSourceFromProjectData(project, siteRootUrl))
          .filter(Boolean);
        sources = latestSources.slice(0, 5);
        if (sources.length) {
          console.warn('Hero banner: manual loop unavailable; showing latest project media as a fallback.');
        }
      }
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

    const reducedMotion = Boolean(isReducedMotion());

    if (sources.some(source => source.type === 'lottie')) await ensureLottie();
    if (sources.some(source => source.background)) await ensureMediaBackground();

    heroContainer.classList.remove('transition-kenburns', 'transition-fade', 'transition-none');
    heroContainer.classList.add('transition-' + config.transitionStyle);

    for (const [i, source] of sources.entries()) {
      const wrap = documentRef.createElement('div');
      wrap.className = 'slide' + (i === 0 ? ' active' : '');

      let media;
      let hasVideoPoster = false;
      const isVideoSource = source.type === 'video' || source.type === 'mux';
      if (source.type === 'mux') {
        media = documentRef.createElement('mux-player');
        media.setAttribute('playback-id', source.playbackId);
        media.setAttribute('metadata-video-title', source.alt || 'Portfolio hero reel');
        media.setAttribute('stream-type', 'on-demand');
        media.muted = true;
        media.defaultMuted = true;
        media.setAttribute('muted', '');
        media.loop = false;
        media.playsInline = true;
        media.setAttribute('playsinline', '');
        media.controls = false;
        media.preload = reducedMotion ? 'none' : (i === 0 ? 'auto' : 'metadata');
        media.autoplay = false;
        const posterSource = source.poster || config.defaultVideoPoster;
        if (posterSource) {
          media.setAttribute('poster', posterSource);
          hasVideoPoster = true;
        }
      } else if (source.type === 'video') {
        media = documentRef.createElement('video');
        media.muted = true;
        media.defaultMuted = true;
        media.setAttribute('muted', '');
        media.loop = false;
        media.playsInline = true;
        media.setAttribute('playsinline', '');
        // A poster on this specific item wins; the site-wide CMS setting is only a fallback.
        // Open Graph images are for social previews and are never reused as video posters.
        const posterSource = source.poster || config.defaultVideoPoster;
        const posterUrl = posterSource ? resolveAssetUrl(posterSource) : '';
        if (posterUrl) {
          media.poster = posterUrl;
          hasVideoPoster = true;
        }
        media.preload = reducedMotion ? 'none' : (i === 0 ? 'auto' : 'metadata');
        media.autoplay = false;
        // Reduced-motion visitors see a still poster, not a video download.
        // Only attach the video source when motion playback is appropriate.
        if (!reducedMotion) media.src = resolveAssetUrl(source.src);
      } else if (source.type === 'lottie') {
        // <lottie-player> is a custom element from the lottie-player
        // library (loaded in this page's <head>) — it takes a JSON
        // animation file the same way an <img> takes a picture file.
        media = documentRef.createElement('lottie-player');
        media.setAttribute('src', resolveAssetUrl(source.src));
        media.setAttribute('background', 'transparent');
        media.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      } else {
        media = documentRef.createElement('img');
        media.src = resolveAssetUrl(source.src);
        media.alt = source.alt;
      }
      const fadeInMs = Number.isFinite(Number(source.fadeInMs)) ? Math.max(0, Number(source.fadeInMs)) : 1500;
      const fadeOutMs = Number.isFinite(Number(source.fadeOutMs)) ? Math.max(0, Number(source.fadeOutMs)) : 1500;
      const zoomTransition = typeof source.zoomTransition === 'boolean' ? source.zoomTransition : config.transitionStyle === 'kenburns';
      const fadeTransition = typeof source.fadeTransition === 'boolean' ? source.fadeTransition : config.transitionStyle !== 'none';
      wrap.dataset.heroType = source.type === 'mux' ? 'video' : (source.type || 'image');
      if (source.type === 'video' && !hasVideoPoster) {
        wrap.classList.add('is-video-pending');
        const clearVideoPending = () => wrap.classList.remove('is-video-pending');
        media.addEventListener('loadeddata', clearVideoPending, { once: true });
        media.addEventListener('playing', clearVideoPending, { once: true });
      }
      if (source.type === 'mux' && !hasVideoPoster) {
        wrap.classList.add('is-video-pending');
        const clearMuxPending = () => wrap.classList.remove('is-video-pending');
        media.addEventListener('loadeddata', clearMuxPending, { once: true });
        media.addEventListener('playing', clearMuxPending, { once: true });
      }
      wrap.classList.toggle('slide--zoom', zoomTransition);
      wrap.classList.toggle('slide--fade', fadeTransition);
      wrap.style.setProperty('--hero-fade-in-ms', `${fadeInMs}ms`);
      wrap.style.setProperty('--hero-fade-out-ms', `${fadeOutMs}ms`);
      wrap.appendChild(media);
      heroContainer.appendChild(wrap);
      if (applyMediaBackground && source.background) await applyMediaBackground(wrap, source.background, resolveAssetUrl);

      if (source.focus) { media.style.objectPosition = source.focus; media.style.transformOrigin = source.focus; }
      media.style.setProperty('--thumb-zoom', source.zoom || 1);
      media.style.setProperty('--thumb-rotate', (source.rotate || 0) + 'deg');

      // Auto face-detection fallback only ever made sense for still
      // images with no focus point already set by hand — video and
      // Lottie slides skip it entirely, and an image with an explicit
      // focus already has what it needs.
      if (source.type === 'image' && !source.focus) {
        if (media.complete) applyFocalPoint(media, null, windowRef);
        else media.addEventListener('load', () => applyFocalPoint(media, null, windowRef), { once: true });
      }
    }

    // Keep the bounded readiness check for images/Lottie. Do not make a network
    // video block page composition until its first frame arrives; start playback
    // and recovery immediately, leaving the neutral loading surface in place.
    const firstSlide = heroContainer.querySelector('.slide');
    if (firstSlide && sources[0]?.type !== 'video' && sources[0]?.type !== 'mux') {
      try { await waitForHeroMedia(firstSlide.firstElementChild, sources[0]?.type, windowRef); }
      catch (_) { /* An unavailable visual must never trap startup. */ }
    }
    const stopCrossfade = startHeroCrossfade(heroContainer, config.crossfadeMs, windowRef, () => reducedMotion);
    lifecycle.add(stopCrossfade);

    return {
      destroy() {
        lifecycle.cleanup();
        heroContainer.querySelectorAll('.slide').forEach(slide => {
          slide.querySelectorAll('video, mux-player').forEach(video => video.pause?.());
        });
        heroContainer.replaceChildren();
        heroContainer.classList.remove('transition-kenburns', 'transition-fade', 'transition-none');
      }
    };
  }

  function waitForHeroMedia(media,type,windowRef){
    if(!media)return Promise.resolve(false);
    return new Promise(resolve=>{
      let settled=false;
      const finish=value=>{if(settled)return;settled=true;windowRef.clearTimeout(timer);Object.entries(handlers).forEach(([name,fn])=>media.removeEventListener?.(name,fn));resolve(value);};
      const handlers={load:()=>finish(true),loadeddata:()=>finish(true),canplay:()=>finish(true),ready:()=>finish(true),error:()=>finish(false)};
      const timer=windowRef.setTimeout(()=>finish(false),3200);
      if(type==='image'){if(media.complete&&media.naturalWidth>0){finish(true);return;}media.addEventListener('load',handlers.load,{once:true});media.addEventListener('error',handlers.error,{once:true});}
      else if(type==='video'){if(media.readyState>=2){finish(true);return;}media.addEventListener('loadeddata',handlers.loadeddata,{once:true});media.addEventListener('canplay',handlers.canplay,{once:true});media.addEventListener('error',handlers.error,{once:true});}
      else{if(media.isReady||media.getLottie?.()){finish(true);return;}media.addEventListener('ready',handlers.ready,{once:true});media.addEventListener('error',handlers.error,{once:true});}
    });
  }
  function startHeroCrossfade(heroContainer, crossfadeMs, windowRef = globalThis.window, isReducedMotionFn = prefersReducedMotion) {
    const slides = Array.from(heroContainer.querySelectorAll('.slide'));
    if (!slides.length) return () => {};

    const reducedMotion = Boolean(isReducedMotionFn());
    const intervalMs = Number.isFinite(Number(crossfadeMs)) && Number(crossfadeMs) >= 500
      ? Number(crossfadeMs)
      : 3500;
    let currentIndex = Math.max(0, slides.findIndex(slide => slide.classList.contains('active')));
    let timer = null;
    let networkRetryTimer = null;
    let disposed = false;
    const cleanups = [];
    const activeMediaCleanups = [];

    function clearActiveMediaListeners() {
      activeMediaCleanups.splice(0).forEach(cleanup => {
        try { cleanup(); } catch (_) {}
      });
    }

    function bind(target, type, handler, options) {
      if (!target?.addEventListener) return;
      target.addEventListener(type, handler, options);
      cleanups.push(() => target.removeEventListener(type, handler, options));
    }

    function clearTimer() {
      if (timer !== null) windowRef.clearTimeout(timer);
      timer = null;
    }

    function scheduleAdvance(delay) {
      clearTimer();
      if (slides.length <= 1 || reducedMotion) return;
      timer = windowRef.setTimeout(advance, Math.max(0, delay));
    }

    function scheduleNetworkRetry(slide, media) {
      // Retry one transient network failure automatically; reconnects and user
      // gestures can retry later if connectivity recovers after that attempt.
      if (disposed || slides[currentIndex] !== slide ||
          Number(media?.error?.code) !== 2 ||
          Number(media?.dataset?.networkRetryCount || 0) >= 1 ||
          networkRetryTimer !== null) return;
      media.dataset.networkRetryCount = '1';
      media.dataset.playbackState = 'retrying';
      networkRetryTimer = windowRef.setTimeout(() => {
        networkRetryTimer = null;
        if (disposed || slides[currentIndex] !== slide || !media.isConnected) return;
        try { media.load?.(); } catch (_) {}
        activateMedia(slide);
      }, 500);
    }

    function activateMedia(slide) {
      const media = slide?.firstElementChild;
      if (!media || reducedMotion || disposed) return;

      if (slide.dataset.heroType === 'video') {
        media.muted = true;
        media.defaultMuted = true;
        media.playsInline = true;
        // A single CMS-selected video is a continuous hero reel, not a
        // one-slide slideshow that waits for an ended event to restart.
        media.loop = slides.length === 1;
        media.dataset.playbackState = 'starting';
        const playback = media.play?.();
        if (playback && typeof playback.then === 'function') {
          Promise.resolve(playback).then(() => {
            if (!disposed && slides[currentIndex] === slide) {
              media.dataset.playbackState = 'playing';
            }
          }).catch(() => {
            // A delayed rejection from a slide that has already been replaced
            // must not overwrite the active slide's playback status or timer.
            if (disposed || slides[currentIndex] !== slide) return;
            if (Number(media.error?.code) === 2) {
              media.dataset.playbackState = 'error';
              scheduleNetworkRetry(slide, media);
              return;
            }
            media.dataset.playbackState = 'blocked';

            // If playback was attempted before the first decodable frame, retry
            // when data becomes available. Gesture recovery remains the fallback
            // if autoplay is explicitly denied by the browser.
            if (media.readyState < 2) {
              const retryAfterReady = () => {
                if (disposed || slides[currentIndex] !== slide ||
                    media.dataset.playbackState !== 'blocked') return;
                activateMedia(slide);
              };
              media.addEventListener('canplay', retryAfterReady, { once: true });
              activeMediaCleanups.push(() => media.removeEventListener('canplay', retryAfterReady));
            }

            if (slides.length > 1) scheduleAdvance(intervalMs);
          });
        } else if (!media.paused) {
          media.dataset.playbackState = 'playing';
        }
        return;
      }

      if (slide.dataset.heroType === 'lottie') {
        media.setAttribute('autoplay', '');
        if (slides.length === 1) media.setAttribute('loop', '');
        else media.removeAttribute('loop');
        try { media.play?.(); } catch (_) {}
      }
    }

    function advance() {
      if (disposed || reducedMotion || slides.length <= 1) return;
      clearTimer();
      const outgoing = slides[currentIndex];
      const oldMedia = outgoing?.firstElementChild;
      outgoing?.classList.remove('active');
      currentIndex = (currentIndex + 1) % slides.length;
      const incoming = slides[currentIndex];
      incoming.classList.add('active');

      if (oldMedia && outgoing.dataset.heroType === 'video') {
        try {
          oldMedia.pause?.();
          oldMedia.currentTime = 0;
          oldMedia.dataset.playbackState = 'paused';
        } catch (_) {}
      } else if (oldMedia && outgoing.dataset.heroType === 'lottie') {
        try { oldMedia.pause?.(); oldMedia.stop?.(); } catch (_) {}
      }

      scheduleAdvanceForCurrent();
      activateMedia(incoming);
    }

    function scheduleAdvanceForCurrent() {
      clearTimer();
      clearActiveMediaListeners();
      if (slides.length <= 1 || reducedMotion) return;
      const slide = slides[currentIndex];
      const type = slide?.dataset?.heroType;
      const media = slide?.firstElementChild;
      if (!media) {
        scheduleAdvance(intervalMs);
        return;
      }

      if (type === 'video') {
        const ended = () => advance();
        const error = () => scheduleAdvance(intervalMs);
        media.addEventListener('ended', ended, { once: true });
        media.addEventListener('error', error, { once: true });
        activeMediaCleanups.push(() => {
          media.removeEventListener('ended', ended);
          media.removeEventListener('error', error);
        });
        return;
      }

      if (type === 'lottie') {
        const complete = () => advance();
        const error = () => scheduleAdvance(intervalMs);
        media.addEventListener('complete', complete, { once: true });
        media.addEventListener('error', error, { once: true });
        activeMediaCleanups.push(() => {
          media.removeEventListener('complete', complete);
          media.removeEventListener('error', error);
        });
        timer = windowRef.setTimeout(() => {
          if (media.isConnected && !media.getLottie?.()) advance();
        }, Math.max(intervalMs * 3, 15000));
        return;
      }

      scheduleAdvance(intervalMs);
    }

    function retryBlockedVideo() {
      if (reducedMotion || disposed) return;
      const slide = slides[currentIndex];
      const media = slide?.firstElementChild;
      if (slide?.dataset?.heroType !== 'video' || !media) return;
      const state = media.dataset.playbackState || '';
      const shouldRetry = state === 'blocked' || state === 'error' ||
        (media.paused && media.readyState >= 2);
      if (!shouldRetry) return;
      if (networkRetryTimer !== null) {
        windowRef.clearTimeout(networkRetryTimer);
        networkRetryTimer = null;
      }
      // Network errors may leave a failed media element; reload the existing
      // source before requesting playback again.
      if (Number(media.error?.code) === 2) {
        try { media.load?.(); } catch (_) {}
      }
      activateMedia(slide);
    }

    // Autoplay is normally allowed for a muted, inline background video, but
    // browsers may still deny it (for example, data-saving or battery modes).
    // Retry from a real gesture and when a background tab becomes visible again.
    // The quote overlay is a sibling layered over the banner. Bind to the
    // whole hero section so a gesture over either surface can recover blocked
    // playback without introducing controls or changing the visual design.
    // Track frame/error state separately from slideshow advance logic so a
    // single continuous video receives the same recovery behavior.
    slides.forEach(slide => {
      const media = slide.firstElementChild;
      if (slide.dataset.heroType !== 'video' || !media) return;
      bind(media, 'playing', () => {
        if (!disposed && slides[currentIndex] === slide) media.dataset.playbackState = 'playing';
      });
      bind(media, 'error', () => {
        if (disposed || slides[currentIndex] !== slide) return;
        media.dataset.playbackState = 'error';
        scheduleNetworkRetry(slide, media);
      });
    });

    const interactionSurface = heroContainer.closest('.hero-section') || heroContainer;
    const documentRef = windowRef.document || heroContainer.ownerDocument;
    bind(interactionSurface, 'pointerdown', retryBlockedVideo, { passive: true });
    // Gestures outside the hero, reconnects and page restoration can recover
    // playback without requiring a refresh or navigating to another page.
    bind(documentRef, 'pointerdown', retryBlockedVideo, { capture: true, passive: true });
    bind(documentRef, 'keydown', retryBlockedVideo, { capture: true });
    bind(windowRef, 'online', retryBlockedVideo);
    bind(windowRef, 'pageshow', retryBlockedVideo);
    bind(documentRef, 'visibilitychange', () => {
      if (!documentRef.hidden) retryBlockedVideo();
    });

    if (reducedMotion) {
      slides.forEach(slide => {
        const media = slide.firstElementChild;
        if (slide.dataset.heroType === 'video') {
          try { media.pause?.(); } catch (_) {}
        } else if (slide.dataset.heroType === 'lottie') {
          try { media.pause?.(); media.stop?.(); } catch (_) {}
        }
      });
    } else {
      // Always activate the current slide, even when the CMS contains only a
      // single video or Lottie. The previous early return skipped play() for
      // the site's current one-video manual loop.
      scheduleAdvanceForCurrent();
      activateMedia(slides[currentIndex]);
    }

    return () => {
      disposed = true;
      clearTimer();
      if (networkRetryTimer !== null) {
        windowRef.clearTimeout(networkRetryTimer);
        networkRetryTimer = null;
      }
      clearActiveMediaListeners();
      cleanups.splice(0).forEach(cleanup => {
        try { cleanup(); } catch (_) {}
      });
      slides.forEach(slide => {
        const media = slide.firstElementChild;
        if (slide.dataset.heroType === 'video') {
          try { media.pause?.(); media.dataset.playbackState = 'paused'; } catch (_) {}
        } else if (slide.dataset.heroType === 'lottie') {
          try { media.pause?.(); media.stop?.(); } catch (_) {}
        }
      });
    };
  }
export { initHeroBanner as initHeroBannerV2 };
