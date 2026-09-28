/* LM. Site Runtime
 * Shared, lightweight browser runtime helpers.
 * This module is intentionally dependency-free and is loaded only by the
 * public site. Heavy feature libraries (Lottie / Three.js) stay lazy.
 */

function findScriptUrl(fileName = 'script.js') {
  try {
    const scripts = Array.from(document.scripts || []);
    const el = scripts.find(node => {
      const raw = node.getAttribute('src') || '';
      const abs = node.src || '';
      const pattern = new RegExp(`(?:^|/)js/${fileName.replace(/\\./g, '\\\\.')}(?:[?#].*)?$`, 'i');
      return pattern.test(raw) || pattern.test(abs);
    });
    return el?.src || '';
  } catch (_) {
    return '';
  }
}

const SITE_SCRIPT_URL = findScriptUrl('script.js');

export function getSiteRootUrl() {
  try {
    if (SITE_SCRIPT_URL) return new URL('../', SITE_SCRIPT_URL).href;
    const configured = window.SITE_ROOT_URL;
    if (configured) return new URL(configured, document.baseURI || window.location.href).href.replace(/\/$/, '') + '/';

    const pageUrl = new URL(document.baseURI || window.location.href);
    const path = pageUrl.pathname
      .replace(/\/about(?:\/.*)?$/i, '/')
      .replace(/\/admin(?:\/.*)?$/i, '/')
      .replace(/\/success(?:\/.*)?$/i, '/');
    return new URL(pageUrl.origin + path).href;
  } catch (_) {
    return new URL('./', document.baseURI || window.location.href).href;
  }
}

export function siteAssetUrl(src) {
  if (!src) return '';
  const value = String(src).trim();
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) || /^(?:data|blob):/i.test(value)) return value;
  try {
    return new URL(value.replace(/^\/+/, ''), getSiteRootUrl()).href;
  } catch (_) {
    return value;
  }
}

const loadedScripts = new Map();

export function loadScriptOnce(src, test = () => true) {
  const url = String(src || '');
  if (!url) return Promise.resolve(false);
  if (test()) return Promise.resolve(true);
  if (loadedScripts.has(url)) return loadedScripts.get(url);

  const promise = new Promise(resolve => {
    const existing = Array.from(document.scripts || []).find(node => node.dataset.lmRuntimeSrc === url);
    if (existing) {
      if (test()) return resolve(true);
      existing.addEventListener('load', () => resolve(test()), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.lmRuntimeSrc = url;
    script.onload = () => resolve(test());
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  loadedScripts.set(url, promise);
  return promise;
}

let lottiePromise = null;
const LOTTIE_SOURCES = [
  'https://unpkg.com/@lottiefiles/lottie-player@2.0.12/dist/lottie-player.js',
  'https://cdn.jsdelivr.net/npm/@lottiefiles/lottie-player@2.0.12/dist/lottie-player.js'
];

export function ensureLottiePlayer() {
  if (window.customElements?.get('lottie-player')) return Promise.resolve(true);
  if (lottiePromise) return lottiePromise;

  lottiePromise = (async () => {
    for (const src of LOTTIE_SOURCES) {
      const ok = await loadScriptOnce(src, () => !!window.customElements?.get('lottie-player'));
      if (ok) return true;
    }
    return false;
  })();

  return lottiePromise;
}

let mediaBackgroundPromise = null;
export function ensureMediaBackgroundHelper() {
  if (window.LMMediaBackground) return Promise.resolve(true);
  if (mediaBackgroundPromise) return mediaBackgroundPromise;

  mediaBackgroundPromise = loadScriptOnce(
    new URL('js/media-background.js', getSiteRootUrl()).href,
    () => !!window.LMMediaBackground
  );
  return mediaBackgroundPromise;
}

export const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const prefersReducedMotion = () => reducedMotionQuery.matches;
