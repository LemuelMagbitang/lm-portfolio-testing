/** Architecture V2 — complete hero banner controller. */
import { getSiteRootUrl, siteAssetUrl } from '../../infrastructure/browser/site-paths.js?v=20261004-01';
import { prefersReducedMotion } from '../../infrastructure/browser/reduced-motion.js';
import { ensureLottiePlayer } from '../../infrastructure/lottie/player.js';
import { ensureMediaBackgroundHelper } from '../../infrastructure/media-background/loader.js?v=20261008-01';
import { loadCmsJson } from '../../infrastructure/cms/loader.js';
import { parseYouTubeUrl } from '../../infrastructure/youtube/url.js';
import { normalizeProjects } from '../../data/project-normalizer.js?v=20261009-12';
import { createLifecycle } from '../../core/lifecycle.js';

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

    return { type: type || 'image', src, alt: p.title || 'Featured artwork', focus: thumb.focus || null, zoom: thumb.zoom || null, rotate: thumb.rotate || null, background };
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

    const weights = messages.map(item => item.weight);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let chosen = 0;

    if (total <= 0) {
      chosen = Math.floor(Math.random() * messages.length);
    } else {
      let roll = Math.random() * total;
      for (let i = 0; i < messages.length; i += 1) {
        roll -= weights[i];
        if (roll <= 0) {
          chosen = i;
          break;
        }
      }
    }

    if (chosen === exclude) {
      const alternatives = messages
        .map((_, i) => i)
        .filter(i => i !== exclude && messages[i].weight > 0);
      if (alternatives.length) {
        chosen = alternatives[Math.floor(Math.random() * alternatives.length)];
      }
    }

    return chosen;
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

    const label = ensure('heroQuoteLabel', 'hero-quote-label', 'span');
    const text = ensure('heroQuoteText', 'hero-quote-text', 'p');
    const author = ensure('heroQuoteAuthor', 'hero-quote-author', 'span');

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
      messageAutoRotateMs: Number.isFinite(Number(options.messageAutoRotateMs)) && Number(options.messageAutoRotateMs) >= 0 ? Number(options.messageAutoRotateMs) : 0
    };
    const heroContainer = documentRef.getElementById('heroBanner') || documentRef.getElementById('heroBannerAbout');
    if (!heroContainer) return;
    heroContainer.dataset.component = 'portfolio-hero';

    const siteRootUrl = getSiteRoot();
    const lifecycle = createLifecycle();
    let latestSources = [];
    let manualSources = [];
    let sources = [];
    let messageRotationTimer = null;
    let messageFadeTimer = null;
    lifecycle.add(() => windowRef.clearInterval(messageRotationTimer));
    lifecycle.add(() => windowRef.clearTimeout(messageFadeTimer));


    const heroMessageRoot = documentRef.getElementById('heroQuote') || documentRef.querySelector('.hero-quote');
    if (heroMessageRoot) {
      const messageView = buildHeroMessageView(documentRef, heroMessageRoot);
      let messages = [{ label: 'LM.', text: 'Open for freelance work.', author: '', source: '', weight: 1 }];
      let currentMessage = -1;

      const fadeToMessage = (index, animate = true) => {
        const item = messages[index];
        if (!item) return;
        currentMessage = index;
        if (!animate) {
          renderHeroMessage(messageView, item);
          return;
        }

        windowRef.clearTimeout(messageFadeTimer);
        messageView.root.style.opacity = '0';
        messageFadeTimer = windowRef.setTimeout(() => {
          renderHeroMessage(messageView, item);
          windowRef.requestAnimationFrame(() => { messageView.root.style.opacity = '1'; });
        }, config.messageFadeMs);
      };

      fadeToMessage(pickHeroMessage(messages), false);
      windowRef.requestAnimationFrame(() => {
        messageView.root.style.opacity = '1';
      });

      try {
        const rawMessages = await loadJson(heroMessagesUrl, null, { resolveUrl: resolveAssetUrl });
        const cmsMessages = normalizeHeroMessages(rawMessages);
        if (cmsMessages.length) {
          messages = cmsMessages;
          fadeToMessage(pickHeroMessage(messages, currentMessage));
        }
      } catch (err) {
        console.warn('Hero messages: could not load', heroMessagesUrl, err);
      }

      if (config.messageAutoRotateMs > 0 && messages.length > 1) {
        messageRotationTimer = windowRef.setInterval(() => {
          fadeToMessage(pickHeroMessage(messages, currentMessage));
        }, config.messageAutoRotateMs);
      }
    }

    // Load the CMS-curated manual list from the configured URL. A file path
    // is preferred over pasted JSON because it stays version-controlled,
    // cacheable, and easy to replace from the Media Library.
    if (config.loopMode === 'manual' || config.loopMode === 'mixed') {
      try {
        const list = await loadJson(heroLoopUrl, [], { resolveUrl: resolveAssetUrl });
        manualSources = (Array.isArray(list) ? list : [])
          .map(item => heroSourceFromManualEntry(item, siteRootUrl))
          .filter(Boolean);
      } catch (err) {
        console.warn('Hero banner: could not load manual hero loop data.', err);
      }
    }

    // Consume the same normalized Project models used by cards and Lightbox.
    // On the About page there is no mounted Projects feature, so fall back to
    // the CMS project source and normalize it at this boundary.
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
      const wrap = documentRef.createElement('div');
      wrap.className = 'slide' + (i === 0 ? ' active' : '');

      let media;
      if (source.type === 'video') {
        media = documentRef.createElement('video');
        media.src = resolveAssetUrl(source.src);
        media.autoplay = true; media.muted = true; media.loop = true; media.playsInline = true;
      } else if (source.type === 'lottie') {
        // <lottie-player> is a custom element from the lottie-player
        // library (loaded in this page's <head>) — it takes a JSON
        // animation file the same way an <img> takes a picture file.
        media = documentRef.createElement('lottie-player');
        media.setAttribute('src', resolveAssetUrl(source.src));
        media.setAttribute('autoplay', '');
        media.setAttribute('loop', '');
        media.setAttribute('background', 'transparent');
        media.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      } else {
        media = documentRef.createElement('img');
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
        if (media.complete) applyFocalPoint(media, null, windowRef);
        else media.addEventListener('load', () => applyFocalPoint(media, null, windowRef), { once: true });
      }
    }

    const stopCrossfade = startHeroCrossfade(heroContainer, config.crossfadeMs, windowRef, isReducedMotion);
    lifecycle.add(stopCrossfade);

    return {
      destroy() {
        lifecycle.cleanup();
        heroContainer.querySelectorAll('.slide').forEach(slide => {
          slide.querySelectorAll('video').forEach(video => video.pause?.());
        });
        heroContainer.replaceChildren();
        heroContainer.classList.remove('transition-kenburns', 'transition-fade', 'transition-none');
      }
    };
  }

  function startHeroCrossfade(heroContainer, crossfadeMs, windowRef = globalThis.window, isReducedMotionFn = prefersReducedMotion) {
    const slides = heroContainer.querySelectorAll('.slide');
    if (slides.length <= 1) return () => {};

    let currentSlide = 0;
    if (isReducedMotionFn()) return () => {};
    const intervalMs = Number.isFinite(Number(crossfadeMs)) && Number(crossfadeMs) >= 500
      ? Number(crossfadeMs)
      : 3500;
    const intervalId = windowRef.setInterval(() => {
      slides[currentSlide].classList.remove('active');
      currentSlide = (currentSlide + 1) % slides.length;
      slides[currentSlide].classList.add('active');
    }, intervalMs); // configured in Hero Loop Animation

    return () => windowRef.clearInterval(intervalId);
  }
export { initHeroBanner as initHeroBannerV2 };
