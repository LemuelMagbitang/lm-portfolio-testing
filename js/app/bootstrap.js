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
  cacheVersion = '20261003-10'
} = {}) {
  const pageTransition = root?.getElementById('pageTransition');
  let initialTransitionTimer = null;

  function showInitialPageTransition() {
    if (!pageTransition) return;
    pageTransition.classList.remove('is-hidden');
    root.defaultView.requestAnimationFrame(() => pageTransition.classList.add('is-entering'));
    initialTransitionTimer = root.defaultView.setTimeout(() => {
      pageTransition.classList.add('is-hidden');
    }, 900);
  }

  function hideInitialPageTransition() {
    pageTransition?.classList.add('is-hidden');
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

    await createPortfolioApp({ root, runtime, cms, config });

    hideInitialPageTransition();
    if (initialTransitionTimer) root.defaultView.clearTimeout(initialTransitionTimer);
  } catch (error) {
    console.error('Portfolio runtime failed to initialize', error);
    hideInitialPageTransition();
    if (initialTransitionTimer) root.defaultView.clearTimeout(initialTransitionTimer);
  }
}
