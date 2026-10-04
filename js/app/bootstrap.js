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
  cacheVersion = '20261004-01'
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

  async function waitForReadyPaint() {
    const fontReady = root.fonts?.ready
      ? Promise.resolve(root.fonts.ready).catch(() => {})
      : Promise.resolve();

    // All CMS-backed content and feature composition are already awaited by
    // createPortfolioApp. Here we only give the browser two paint opportunities
    // to commit the complete DOM before removing the branded gate.
    await fontReady;
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
