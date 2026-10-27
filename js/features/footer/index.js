/**
 * Footer animation feature.
 *
 * The footer is intentionally independent from the Hero feature. In the
 * default "hero" mode it resolves the same project/manual loop sources and
 * timing configured for the hero. In "manual" mode it renders one CMS-selected
 * image, video, or Lottie source without taking ownership of Hero state.
 */
import { loadCmsJson } from '../../infrastructure/cms/loader.js';
import { ensureLottiePlayer } from '../../infrastructure/lottie/player.js';

import { normalizeProjects } from '../../data/project-normalizer.js?v=20261026-01';
import { prefersReducedMotion } from '../../infrastructure/browser/reduced-motion.js';
import { createLifecycle } from '../../core/lifecycle.js';
import { chooseForeground } from '../../infrastructure/browser/media-contrast.js?v=20261026-02';

const MUX_PLAYER_MODULE_URL = '../../infrastructure/mux/player.js?v=20261027-02';
let muxPlayerModulePromise = null;
let muxPlayerModuleAttempt = 0;

async function loadMuxPlayerModule() {
  if (!muxPlayerModulePromise) {
    muxPlayerModuleAttempt += 1;
    const moduleUrl = muxPlayerModuleAttempt === 1
      ? MUX_PLAYER_MODULE_URL
      : `${MUX_PLAYER_MODULE_URL}&retry=${muxPlayerModuleAttempt}`;
    const pending = import(moduleUrl);
    const guarded = pending.catch(error => {
      if (muxPlayerModulePromise === guarded) muxPlayerModulePromise = null;
      throw error;
    });
    muxPlayerModulePromise = guarded;
  }
  return muxPlayerModulePromise;
}

// Mux is an optional media capability. Its helper must never be a static edge
// in the feature graph: a transient hosting/CDN failure should fall back to a
// poster, not reject page-composition.js before the site can initialize.
async function ensureMuxVideo(...args) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const module = await loadMuxPlayerModule();
      return await module.ensureMuxVideo(...args);
    } catch (_) {
      if (attempt === 1) return false;
    }
  }
  return false;
}

function mediaTypeFromSrc(src) {
  const clean = String(src || '').split('?')[0].split('#')[0].toLowerCase();
  if (/\.(mp4|webm|mov|m4v)$/.test(clean)) return 'video';
  if (/\.json$/.test(clean)) return 'lottie';
  return 'image';
}

function resolveSource(item, resolveAssetUrl) {
  if (!item) return null;
  const playbackId = String(item.playbackId || '').trim();
  const type = item.type || (playbackId ? 'mux' : mediaTypeFromSrc(item.src));
  if (!['image', 'video', 'lottie', 'mux'].includes(type)) return null;
  if (!item.src && !(type === 'mux' && playbackId)) return null;
  const poster = String(item.poster || item.src || (playbackId
    ? 'https://image.mux.com/' + encodeURIComponent(playbackId) + '/thumbnail.jpg?time=1.5&width=1600'
    : '')).trim();
  return {
    type,
    src: resolveAssetUrl(type === 'mux' ? poster : item.src),
    ...(type === 'mux' ? { playbackId, poster: resolveAssetUrl(poster) } : {}),
    alt: item.alt || 'Footer artwork',
    focus: item.focus || '50% 50%',
    zoom: Number.isFinite(Number(item.zoom)) ? Number(item.zoom) : 1,
    rotate: Number.isFinite(Number(item.rotate)) ? Number(item.rotate) : 0,
    foreground: ['light', 'dark'].includes(item.foreground) ? item.foreground : null
  };
}

function sourceFromProject(project, resolveAssetUrl) {
  if (!project) return null;
  const thumb = project.thumbnail || {};
  if (thumb.src && ['image', 'video', 'lottie', 'mux'].includes(thumb.type || mediaTypeFromSrc(thumb.src)) ||
      thumb.type === 'mux' && thumb.playbackId) {
    return resolveSource({
      type: thumb.type || mediaTypeFromSrc(thumb.src),
      src: thumb.src,
      ...(thumb.playbackId ? { playbackId: thumb.playbackId } : {}),
      ...(thumb.poster ? { poster: thumb.poster } : {}),
      alt: project.title || 'Featured artwork',
      focus: thumb.focus,
      zoom: thumb.zoom,
      rotate: thumb.rotate
    }, resolveAssetUrl);
  }
  const media = Array.isArray(project.media)
    ? project.media.find(item => item?.src && ['image', 'video', 'lottie', 'mux'].includes(item.type) &&
      (item.type !== 'mux' || item.playbackId))
    : null;
  return media
    ? resolveSource({ ...media, alt: project.title || media.alt || 'Featured artwork' }, resolveAssetUrl)
    : null;
}

function sourceKey(source) {
  return source ? source.type + '|' + (source.type === 'mux' ? source.playbackId : source.src) : '';
}

async function resolveHeroSources({ heroLoopUrl, projectsUrl, heroTiming, loadJson, resolveAssetUrl, projects }) {
  const loopMode = ['latest', 'manual', 'mixed'].includes(heroTiming?.loopMode)
    ? heroTiming.loopMode
    : 'latest';
  let manual = [];
  if (loopMode === 'manual' || loopMode === 'mixed') {
    try {
      const raw = await loadJson(heroLoopUrl, [], { resolveUrl: resolveAssetUrl });
      manual = (Array.isArray(raw) ? raw : [])
        .map(item => resolveSource(item, resolveAssetUrl))
        .filter(Boolean);
    } catch (_) {}
  }

  let latest = [];
  if (Array.isArray(projects)) {
    latest = projects.map(project => sourceFromProject(project, resolveAssetUrl)).filter(Boolean);
  } else {
    try {
      const raw = await loadJson(projectsUrl, [], { resolveUrl: resolveAssetUrl });
      const normalized = normalizeProjects(Array.isArray(raw) ? raw : []);
      latest = normalized.map(project => sourceFromProject(project, resolveAssetUrl)).filter(Boolean);
    } catch (_) {}
  }

  if (loopMode === 'manual') return manual.slice(0, 5);
  if (loopMode === 'mixed') {
    const result = [];
    const seen = new Set();
    for (const source of [...manual, ...latest]) {
      const key = sourceKey(source);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(source);
      if (result.length >= 5) break;
    }
    return result;
  }
  return latest.slice(0, 5);
}

function buildMedia(documentRef, source, autoplayAllowed = true) {
  let media;
  if (source.type === 'mux') {
    media = documentRef.createElement('mux-video');
    media.setAttribute('playback-id', source.playbackId);
    media.setAttribute('stream-type', 'on-demand');
    media.muted = true;
    media.defaultMuted = true;
    media.controls = false;
    media.setAttribute('muted', '');
    media.setAttribute('loop', '');
    media.setAttribute('playsinline', '');
    media.setAttribute('disable-tracking', '');
    media.setAttribute('preload', autoplayAllowed ? 'auto' : 'none');
    if (autoplayAllowed) media.setAttribute('autoplay', '');
    else media.removeAttribute('autoplay');
    media.style.setProperty('--media-object-fit', 'cover');
    if (source.poster) media.setAttribute('poster', source.poster);
    media.setAttribute('metadata-video-title', source.alt || 'Footer video');
  } else if (source.type === 'video') {
    media = documentRef.createElement('video');
    media.autoplay = Boolean(autoplayAllowed);
    media.muted = true;
    media.defaultMuted = true;
    media.setAttribute('muted', '');
    media.loop = true;
    media.playsInline = true;
    media.preload = autoplayAllowed ? 'auto' : 'none';
    media.src = source.src;
  } else if (source.type === 'lottie') {
    media = documentRef.createElement('lottie-player');
    media.setAttribute('src', source.src);
    media.setAttribute('autoplay', '');
    media.setAttribute('loop', '');
    media.setAttribute('background', 'transparent');
    media.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  } else {
    media = documentRef.createElement('img');
    media.src = source.src;
    media.alt = '';
    media.loading = 'lazy';
    media.decoding = 'async';
  }

  media.style.objectPosition = source.focus;
  media.style.transformOrigin = source.focus;
  media.style.setProperty('--footer-zoom', source.zoom);
  media.style.setProperty('--footer-rotate', source.rotate + 'deg');
  return media;
}

export async function initFooterAnimation(options = {}) {
  const documentRef = options.root?.getElementById ? options.root : globalThis.document;
  const windowRef = documentRef?.defaultView || globalThis.window;
  if (!documentRef || !windowRef) return null;

  const reducedMotion = typeof options.prefersReducedMotion === 'function'
    ? options.prefersReducedMotion
    : () => prefersReducedMotion(windowRef);

  const container = documentRef.getElementById('footerAnimation');
  if (!container) return null;

  const loadJson = typeof options.loadJson === 'function' ? options.loadJson : loadCmsJson;
  const resolveAssetUrl = typeof options.resolveAssetUrl === 'function'
    ? options.resolveAssetUrl
    : value => value;
  const heroTiming = options.heroTiming || {};
  const footerLoopUrl = options.footerLoopUrl || 'data/footer-loop.json';

  let config = { mode: 'hero', manual: null };
  try {
    const raw = await loadJson(footerLoopUrl, config, { resolveUrl: resolveAssetUrl });
    if (raw && typeof raw === 'object') config = { ...config, ...raw };
  } catch (_) {}

  let sources = [];
  if (config.mode === 'manual') {
    const manual = config.manual && typeof config.manual === 'object'
      ? resolveSource(config.manual, resolveAssetUrl)
      : null;
    if (manual) sources = [manual];
  } else {
    sources = await resolveHeroSources({
      heroLoopUrl: options.heroLoopUrl || 'data/hero-loop.json',
      projectsUrl: options.projectsUrl || 'data/projects.json',
      projects: Array.isArray(options.projects) ? options.projects : null,
      heroTiming,
      loadJson,
      resolveAssetUrl
    });
  }

  const reduceMotionNow = Boolean(reducedMotion());
  if (reduceMotionNow) {
    sources = sources.flatMap(source => {
      if (source.type !== 'mux') return [source];
      const poster = String(source.poster || source.src || '').trim();
      return poster ? [{ ...source, type: 'image', src: poster }] : [];
    });
  }

  if (!sources.length) {
    container.replaceChildren();
    container.hidden = true;
    return null;
  }

  if (sources.some(source => source.type === 'lottie')) {
    try { await (options.ensureLottiePlayer || ensureLottiePlayer)(); } catch (_) {}
  }
  if (sources.some(source => source.type === 'mux')) {
    let muxReady = false;
    try { muxReady = await (options.ensureMuxVideo || ensureMuxVideo)(); } catch (_) {}
    if (!muxReady) {
      sources = sources.map(source => source.type === 'mux'
        ? { ...source, type: 'image', src: source.poster || source.src }
        : source).filter(source => source.src);
    }
  }

  const lifecycle = createLifecycle();

  const transitionStyle = ['kenburns', 'fade', 'none'].includes(heroTiming.transitionStyle)
    ? heroTiming.transitionStyle
    : 'kenburns';
  const crossfadeMs = Number.isFinite(Number(heroTiming.crossfadeMs)) && Number(heroTiming.crossfadeMs) >= 500
    ? Number(heroTiming.crossfadeMs)
    : 3500;
  const kenBurnsFromScale = Number.isFinite(Number(heroTiming.kenBurnsFromScale))
    ? Number(heroTiming.kenBurnsFromScale)
    : 1;
  const kenBurnsToScale = Number.isFinite(Number(heroTiming.kenBurnsToScale))
    ? Number(heroTiming.kenBurnsToScale)
    : 1.15;
  const kenBurnsDurationS = Number.isFinite(Number(heroTiming.kenBurnsDurationS)) && Number(heroTiming.kenBurnsDurationS) >= 1
    ? Number(heroTiming.kenBurnsDurationS)
    : 14;

  container.hidden = false;
  container.classList.remove('transition-kenburns', 'transition-fade', 'transition-none');
  container.classList.add('transition-' + transitionStyle);
  container.style.setProperty('--footer-kenburns-from', kenBurnsFromScale);
  container.style.setProperty('--footer-kenburns-to', kenBurnsToScale);
  container.style.setProperty('--footer-kenburns-duration', kenBurnsDurationS + 's');
  container.replaceChildren();

  sources.forEach((source, index) => {
    const slide = documentRef.createElement('div');
    slide.className = 'footer-animation-slide' + (index === 0 ? ' active' : '');
    slide.dataset.index = String(index);
    const media = buildMedia(documentRef, source, !reducedMotion() && index === 0);
    slide.appendChild(media);
    container.appendChild(slide);
  });

  const footerElement = container.closest('footer');
  const applyForeground = index => {
    const source = sources[index];
    const slide = container.querySelectorAll('.footer-animation-slide')[index];
    const media = slide?.firstElementChild;
    const color = chooseForeground(documentRef, source, media);
    footerElement?.style.setProperty('--footer-foreground', color);
  };

  Array.from(container.querySelectorAll('.footer-animation-slide')).forEach((slide, index) => {
    const media = slide.firstElementChild;
    const refresh = () => applyForeground(index);
    media?.addEventListener('load', refresh);
    media?.addEventListener('loadeddata', refresh);
    lifecycle.add(() => {
      media?.removeEventListener('load', refresh);
      media?.removeEventListener('loadeddata', refresh);
    });
  });

  applyForeground(0);
  const firstMuxVideo = container.querySelector('.footer-animation-slide.active mux-video, .footer-animation-slide.active mux-player');
  if (firstMuxVideo && !reducedMotion()) {
    try { const playback = firstMuxVideo.play?.(); playback?.catch?.(() => {}); } catch (_) {}
  }

  let contrastIntervalId = null;
  if (sources.some(source => source.type === 'video' || source.type === 'mux')) {
    contrastIntervalId = windowRef.setInterval(() => {
      const activeIndex = Number(container.querySelector('.footer-animation-slide.active')?.dataset?.index || 0);
      applyForeground(activeIndex);
    }, 900);
    lifecycle.add(() => windowRef.clearInterval(contrastIntervalId));
  }

  let intervalId = null;
  if (sources.length > 1 && !reducedMotion()) {
    let index = 0;
    intervalId = windowRef.setInterval(() => {
      const slides = Array.from(container.querySelectorAll('.footer-animation-slide'));
      if (!slides.length) return;
      const previous = slides[index];
      previous?.classList.remove('active');
      const previousMux = previous?.querySelector('mux-video, mux-player');
      if (previousMux) { try { previousMux.pause?.(); } catch (_) {} }
      const previousVideo = previous?.querySelector('video');
      if (previousVideo) { try { previousVideo.pause?.(); } catch (_) {} }
      index = (index + 1) % slides.length;
      slides[index]?.classList.add('active');
      const currentMux = slides[index]?.querySelector('mux-video, mux-player');
      if (currentMux) { try { const playback = currentMux.play?.(); playback?.catch?.(() => {}); } catch (_) {} }
      const currentVideo = slides[index]?.querySelector('video');
      if (currentVideo) { try { const playback = currentVideo.play?.(); playback?.catch?.(() => {}); } catch (_) {} }
      applyForeground(index);
    }, crossfadeMs);
    lifecycle.add(() => windowRef.clearInterval(intervalId));
  }

  lifecycle.add(() => {
    container.querySelectorAll('video,mux-player,mux-video').forEach(video => {
      try { video.pause?.(); } catch (_) {}
      if (video.matches('mux-player,mux-video')) video.removeAttribute('playback-id');
    });
    container.replaceChildren();
    container.hidden = true;
    container.classList.remove('transition-kenburns', 'transition-fade', 'transition-none');
    container.style.removeProperty('--footer-kenburns-from');
    container.style.removeProperty('--footer-kenburns-to');
    container.style.removeProperty('--footer-kenburns-duration');
  });

  return {
    mode: config.mode === 'manual' ? 'manual' : 'hero',
    sourceCount: sources.length,
    destroy() {
      lifecycle.cleanup();
    }
  };
}
