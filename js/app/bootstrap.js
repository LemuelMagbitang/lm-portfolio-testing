/**
 * Portfolio bootstrap.
 * Owns the outer lifecycle, page-composition loading, and fatal-error
 * containment. Infrastructure capabilities are imported directly so the
 * application has no dependency on legacy root facades.
 */

import { getSiteRootUrl, siteAssetUrl } from '../infrastructure/browser/site-paths.js';
import { prefersReducedMotion } from '../infrastructure/browser/reduced-motion.js';
import { loadScriptOnce } from '../infrastructure/browser/script-loader.js';
import { ensureLottiePlayer } from '../infrastructure/lottie/player.js';
import {
  ensureMediaBackgroundHelper,
  applyMediaBackground
} from '../infrastructure/media-background/loader.js';
import { loadCmsJson } from '../infrastructure/cms/loader.js';
import { parseYouTubeUrl } from '../infrastructure/youtube/url.js';
import { normalizeAppConfig } from '../core/config.js';

export async function bootstrapPortfolioApp({
  root = globalThis.document,
  cacheVersion = '20261003-12'
} = {}) {
  const pageTransition = root?.getElementById('pageTransition');
  const pageTransitionStatus = root?.getElementById('pageTransitionStatus');
  const pageTransitionProgress = root?.getElementById('pageTransitionProgress');
  const windowRef = root?.defaultView || globalThis.window;
  const loadingStartedAt = typeof windowRef?.performance?.now === 'function'
    ? windowRef.performance.now()
    : Date.now();
  const MIN_LOADING_SCREEN_MS = 450;
  let initialTransitionFrame = null;

  function setInitialPageTransitionStatus(message, progress = null) {
    if (pageTransitionStatus && message) pageTransitionStatus.textContent = message;
    if (pageTransitionProgress && Number.isFinite(progress)) {
      pageTransitionProgress.style.setProperty('--loading-progress', Math.max(0, Math.min(100, progress)) + '%');
      pageTransitionProgress.setAttribute('aria-valuenow', String(Math.round(progress)));
    }
  }

  function showInitialPageTransition() {
    if (!pageTransition) return;
    pageTransition.classList.remove('is-hidden', 'is-entering', 'is-error');
    pageTransition.setAttribute('aria-hidden', 'false');
    pageTransition.dataset.loading = 'active';
    root.body?.setAttribute('aria-busy', 'true');
    setInitialPageTransitionStatus('Loading portfolio…', 8);
    initialTransitionFrame = windowRef?.requestAnimationFrame?.(() => {
      pageTransition.classList.add('is-entering');
    });
  }

  function hideInitialPageTransition() {
    if (!pageTransition) return;
    pageTransition.classList.add('is-hidden');
    pageTransition.setAttribute('aria-hidden', 'true');
    pageTransition.dataset.loading = 'ready';
    root.body?.setAttribute('aria-busy', 'false');
  }

  async function waitForInitialViewportMedia() {
    const viewportHeight = Number(windowRef?.innerHeight) || 0;
    const viewportWidth = Number(windowRef?.innerWidth) || 0;
    const media = Array.from(root.querySelectorAll?.('img,video') || [])
      .filter(node => !pageTransition?.contains(node))
      .filter(node => {
        const rect = node.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
        return rect.bottom >= 0 && rect.top <= viewportHeight + Math.max(180, viewportHeight * 0.35)
          && rect.right >= 0 && rect.left <= viewportWidth;
      });

    const waits = media.map(node => new Promise(resolve => {
      if (node.tagName === 'IMG') {
        if (node.complete) return resolve();
        const done = () => { cleanup(); resolve(); };
        const cleanup = () => {
          node.removeEventListener('load', done);
          node.removeEventListener('error', done);
        };
        node.addEventListener('load', done, { once: true });
        node.addEventListener('error', done, { once: true });
        windowRef.setTimeout(done, 5000);
        return;
      }

      if (node.readyState >= 1) return resolve();
      const done = () => { cleanup(); resolve(); };
      const cleanup = () => {
        node.removeEventListener('loadedmetadata', done);
        node.removeEventListener('loadeddata', done);
        node.removeEventListener('error', done);
      };
      node.addEventListener('loadedmetadata', done, { once: true });
      node.addEventListener('loadeddata', done, { once: true });
      node.addEventListener('error', done, { once: true });
      windowRef.setTimeout(done, 5000);
    }));

    await Promise.allSettled(waits);
  }

  async function waitForReadyPaint() {
    const fontReady = root.fonts?.ready ? Promise.resolve(root.fonts.ready).catch(() => {}) : Promise.resolve();
    await Promise.allSettled([fontReady, waitForInitialViewportMedia()]);
    await new Promise(resolve => windowRef.requestAnimationFrame(resolve));
    await new Promise(resolve => windowRef.requestAnimationFrame(resolve));

    const elapsed = (typeof windowRef?.performance?.now === 'function' ? windowRef.performance.now() : Date.now()) - loadingStartedAt;
    const remaining = Math.max(0, MIN_LOADING_SCREEN_MS - elapsed);
    if (remaining) await new Promise(resolve => windowRef.setTimeout(resolve, remaining));
  }

  showInitialPageTransition();

  try {
    const { createPortfolioApp } = await import(`./page-composition.js?v=${cacheVersion}`);

    const config = normalizeAppConfig({
      urls: {
        settings: globalThis.SETTINGS_URL,
        projects: globalThis.PROJECTS_URL,
        reviews: globalThis.REVIEWS_URL,
        about: globalThis.ABOUT_URL,
        filters: globalThis.FILTERS_URL,
        heroLoop: globalThis.HERO_LOOP_URL,
        heroMessages: globalThis.HERO_MESSAGES_URL
      }
    });

    const runtime = {
      getSiteRootUrl,
      siteAssetUrl,
      prefersReducedMotion,
      loadScriptOnce,
      ensureLottiePlayer,
      ensureMediaBackgroundHelper,
      applyMediaBackground
    };

    const cms = {
      loadCmsJson,
      parseYouTubeUrl
    };

    await createPortfolioApp({
      root,
      runtime,
      cms,
      config,
      onProgress(message) {
        const map = {
          'Loading portfolio data…': 12,
          'Building the portfolio…': 38,
          'Preparing animated artwork…': 56,
          'Preparing the visual experience…': 66,
          'Finalizing interactions…': 82,
          'Finishing layout…': 92
        };
        setInitialPageTransitionStatus(message, map[message] ?? 72);
      }
    });

    setInitialPageTransitionStatus('Finishing layout…', 92);
    await waitForReadyPaint();
    setInitialPageTransitionStatus('Ready', 100);
    hideInitialPageTransition();
    if (initialTransitionFrame) windowRef.cancelAnimationFrame?.(initialTransitionFrame);
  } catch (error) {
    console.error('Portfolio runtime failed to initialize', error);
    if (pageTransition) {
      pageTransition.classList.remove('is-hidden');
      pageTransition.classList.add('is-error', 'is-entering');
      pageTransition.dataset.loading = 'error';
      pageTransition.setAttribute('aria-hidden', 'false');
      setInitialPageTransitionStatus('Portfolio could not finish loading. Please refresh.', 100);
    }
    root.body?.setAttribute('aria-busy', 'true');
  }
}
