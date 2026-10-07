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
import { normalizeProjects } from '../../data/project-normalizer.js';
import { prefersReducedMotion } from '../../infrastructure/browser/reduced-motion.js';
import { createLifecycle } from '../../core/lifecycle.js';

function mediaTypeFromSrc(src) {
  const clean = String(src || '').split('?')[0].split('#')[0].toLowerCase();
  if (/\.(mp4|webm|mov|m4v)$/.test(clean)) return 'video';
  if (/\.json$/.test(clean)) return 'lottie';
  return 'image';
}

function resolveSource(item, resolveAssetUrl) {
  if (!item || !item.src) return null;
  const type = item.type || mediaTypeFromSrc(item.src);
  if (!['image', 'video', 'lottie'].includes(type)) return null;
  return {
    type,
    src: resolveAssetUrl(item.src),
    alt: item.alt || 'Footer artwork',
    focus: item.focus || '50% 50%',
    zoom: Number.isFinite(Number(item.zoom)) ? Number(item.zoom) : 1,
    rotate: Number.isFinite(Number(item.rotate)) ? Number(item.rotate) : 0
  };
}

function sourceFromProject(project, resolveAssetUrl) {
  if (!project) return null;
  const thumb = project.thumbnail || {};
  if (thumb.src && ['image', 'video', 'lottie'].includes(thumb.type || mediaTypeFromSrc(thumb.src))) {
    return resolveSource({
      type: thumb.type || mediaTypeFromSrc(thumb.src),
      src: thumb.src,
      alt: project.title || 'Featured artwork',
      focus: thumb.focus,
      zoom: thumb.zoom,
      rotate: thumb.rotate
    }, resolveAssetUrl);
  }
  const media = Array.isArray(project.media)
    ? project.media.find(item => item?.src && ['image', 'video', 'lottie'].includes(item.type))
    : null;
  return media
    ? resolveSource({ ...media, alt: project.title || media.alt || 'Featured artwork' }, resolveAssetUrl)
    : null;
}

function sourceKey(source) {
  return source ? source.type + '|' + source.src : '';
}

async function resolveHeroSources({ heroLoopUrl, projectsUrl, heroTiming, loadJson, resolveAssetUrl }) {
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
  try {
    const raw = await loadJson(projectsUrl, [], { resolveUrl: resolveAssetUrl });
    const projects = normalizeProjects(Array.isArray(raw) ? raw : []);
    latest = projects.map(project => sourceFromProject(project, resolveAssetUrl)).filter(Boolean);
  } catch (_) {}

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

function buildMedia(documentRef, source) {
  let media;
  if (source.type === 'video') {
    media = documentRef.createElement('video');
    media.autoplay = true;
    media.muted = true;
    media.loop = true;
    media.playsInline = true;
    media.preload = 'metadata';
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
      heroTiming,
      loadJson,
      resolveAssetUrl
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

  const lifecycle = createLifecycle();
  const reducedMotion = typeof options.prefersReducedMotion === 'function'
    ? options.prefersReducedMotion
    : () => prefersReducedMotion(windowRef);

  const transitionStyle = ['kenburns', 'fade', 'none'].includes(heroTiming.transitionStyle)
    ? heroTiming.transitionStyle
    : 'kenburns';
  const crossfadeMs = Number.isFinite(Number(heroTiming.crossfadeMs)) && Number(heroTiming.crossfadeMs) >= 500
    ? Number(heroTiming.crossfadeMs)
    : 3500;

  container.hidden = false;
  container.classList.remove('transition-kenburns', 'transition-fade', 'transition-none');
  container.classList.add('transition-' + transitionStyle);
  container.replaceChildren();

  sources.forEach((source, index) => {
    const slide = documentRef.createElement('div');
    slide.className = 'footer-animation-slide' + (index === 0 ? ' active' : '');
    slide.appendChild(buildMedia(documentRef, source));
    container.appendChild(slide);
  });

  let intervalId = null;
  if (sources.length > 1 && !reducedMotion()) {
    let index = 0;
    intervalId = windowRef.setInterval(() => {
      const slides = Array.from(container.querySelectorAll('.footer-animation-slide'));
      if (!slides.length) return;
      slides[index]?.classList.remove('active');
      index = (index + 1) % slides.length;
      slides[index]?.classList.add('active');
    }, crossfadeMs);
    lifecycle.add(() => windowRef.clearInterval(intervalId));
  }

  lifecycle.add(() => {
    container.querySelectorAll('video').forEach(video => video.pause?.());
    container.replaceChildren();
    container.hidden = true;
    container.classList.remove('transition-kenburns', 'transition-fade', 'transition-none');
  });

  return {
    mode: config.mode === 'manual' ? 'manual' : 'hero',
    sourceCount: sources.length,
    destroy() {
      lifecycle.cleanup();
    }
  };
}
