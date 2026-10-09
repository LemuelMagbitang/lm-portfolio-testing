/**
 * Portfolio bootstrap.
 * Owns the outer lifecycle, page-composition loading, and fatal-error
 * containment. Infrastructure capabilities are imported directly so the
 * application has no dependency on legacy root facades.
 */

import { getSiteRootUrl, siteAssetUrl } from '../infrastructure/browser/site-paths.js?v=20261004-01';
import { prefersReducedMotion } from '../infrastructure/browser/reduced-motion.js';
import { loadScriptOnce } from '../infrastructure/browser/script-loader.js?v=20261008-01';
import { ensureLottiePlayer } from '../infrastructure/lottie/player.js';
import {
  ensureMediaBackgroundHelper,
  applyMediaBackground
} from '../infrastructure/media-background/loader.js?v=20261008-01';
import { loadCmsJson } from '../infrastructure/cms/loader.js';
import { parseYouTubeUrl } from '../infrastructure/youtube/url.js';
import { normalizeAppConfig } from '../core/config.js';

export async function bootstrapPortfolioApp({
  root = globalThis.document,
  cacheVersion = '20261009-23'
} = {}) {
  const pageTransition = root?.getElementById('pageTransition');
  const windowRef = root?.defaultView || globalThis.window;
  const loadingStartedAt = typeof windowRef?.performance?.now === 'function'
    ? windowRef.performance.now()
    : Date.now();
  const MIN_LOADING_SCREEN_MS = root.body?.classList.contains('about-page') ? 120 : 450;
  let initialTransitionFrame = null;
  let initialTransitionTimer = null;
  const hasInitialHash = Boolean(String(windowRef?.location?.hash || ''));

  // Prevent the browser's pre-hydration fragment restoration from jumping to
  // a stale layout. We restore the expected native behavior after the exact
  // anchor has been settled by the composed page.
  if (hasInitialHash && windowRef?.history) {
    try { windowRef.history.scrollRestoration = 'manual'; } catch (_) {}
    windowRef.scrollTo?.(0, 0);
  }


  function showInitialPageTransition() {
    if (!pageTransition) return;
    pageTransition.classList.remove('is-hidden', 'is-entering', 'is-error');
    pageTransition.setAttribute('aria-hidden', 'false');
    pageTransition.dataset.loading = 'active';
    pageTransition.classList.remove('is-steady');
    root.body?.setAttribute('aria-busy', 'true');
    initialTransitionFrame = windowRef?.requestAnimationFrame?.(() => {
      pageTransition.classList.add('is-entering');
    });
    initialTransitionTimer = root.defaultView.setTimeout(() => {
      if (pageTransition.dataset.loading === 'active') {
        pageTransition.classList.add('is-steady');
      }
    }, 900);
  }

  function hideInitialPageTransition() {
    if (initialTransitionTimer) {
      windowRef.clearTimeout(initialTransitionTimer);
      initialTransitionTimer = null;
    }
    if (!pageTransition) return;
    pageTransition.classList.add('is-hidden');
    pageTransition.setAttribute('aria-hidden', 'true');
    pageTransition.dataset.loading = 'ready';
    root.body?.setAttribute('aria-busy', 'false');
  }

  async function waitForReadyPaint() {
    const isAboutPage = root.body?.classList.contains('about-page');
    const fontReady = !isAboutPage && root.fonts?.ready
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

  function settleInitialHashTarget() {
    const rawHash = String(windowRef?.location?.hash || '').replace(/^#/, '');
    if (!rawHash) return;

    let id = rawHash;
    try { id = decodeURIComponent(rawHash); } catch (_) {}

    let target = root.getElementById(id);
    const isContactTarget = id === 'contact-start' || id === 'contact-section';
    if (isContactTarget) {
      target = root.getElementById('contact-start') || root.getElementById('contact-section') || target;
    }
    if (!target) return;

    const applyTarget = () => {
      if (!target.isConnected) return false;

      const rect = target.getBoundingClientRect();
      const currentY = Number(windowRef.scrollY) || 0;
      const visualViewport = windowRef.visualViewport;
      const viewportHeight = Number(visualViewport?.height) || Number(windowRef.innerHeight) || 0;
      const viewportTop = Number(visualViewport?.offsetTop) || 0;
      const documentHeight = Math.max(
        root.documentElement?.scrollHeight || 0,
        root.body?.scrollHeight || 0
      );
      const maxScrollY = Math.max(0, documentHeight - viewportHeight);
      const documentTargetY = currentY + rect.top;
      const navbarHeight = Number(
        root.querySelector('.navbar')?.getBoundingClientRect?.().height
      ) || 0;
      const safeTop = Math.max(navbarHeight + 24, 24);

      let desiredTargetY;
      if (isContactTarget) {
        // Contact now uses a single active mobile panel, so its total height
        // depends on the selected tab and is no longer equivalent to simply
        // positioning the heading. Center the actual Contact group in the
        // usable viewport, then clamp so the heading remains clear of the
        // fixed navbar.
        const contactGroup = root.querySelector('#contact-section .contact-grid');
        const groupRect = contactGroup?.getBoundingClientRect?.();
        if (groupRect?.height > 0) {
          const usableTop = safeTop;
          const usableHeight = Math.max(1, viewportHeight - usableTop);
          const groupCenterDocumentY = currentY + groupRect.top + groupRect.height / 2;
          desiredTargetY = groupCenterDocumentY - (usableTop + usableHeight / 2);

          const headingDocumentY = documentTargetY;
          const minHeadingTopScrollY = headingDocumentY - safeTop;
          desiredTargetY = Math.min(desiredTargetY, minHeadingTopScrollY);
        } else {
          desiredTargetY = documentTargetY - safeTop;
        }
      } else {
        const offset = Math.max(navbarHeight + 12, 24);
        desiredTargetY = documentTargetY - offset;
      }

      const targetY = Math.max(
        0,
        Math.min(maxScrollY, desiredTargetY)
      );

      // Assigning scrollTop directly bypasses the document's global smooth-
      // scroll setting and makes initial hash settlement deterministic.
      const scrollingElement = root.scrollingElement || root.documentElement;
      if (scrollingElement) scrollingElement.scrollTop = targetY;
      else windowRef.scrollTo(0, targetY);
      return true;
    };

    // Apply after the composed DOM is ready, then re-apply across two more
    // frames. This absorbs final font/layout commits without relying on the
    // browser's early fragment position.
    windowRef.requestAnimationFrame(() => {
      if (!applyTarget()) return;
      windowRef.requestAnimationFrame(() => {
        applyTarget();
        windowRef.requestAnimationFrame(() => {
          applyTarget();
          if (hasInitialHash && windowRef?.history) {
            try { windowRef.history.scrollRestoration = 'auto'; } catch (_) {}
          }
        });
      });
    });
  }

  showInitialPageTransition();
  // Settle an initial Contact hash before asynchronous composition work. A
  // later pass after composition corrects any layout shifts from hydration.
  settleInitialHashTarget();

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
      config
    });

    await waitForReadyPaint();
    settleInitialHashTarget();
    hideInitialPageTransition();
    if (initialTransitionFrame) windowRef.cancelAnimationFrame?.(initialTransitionFrame);
  } catch (error) {
    console.error('Portfolio runtime failed to initialize', error);
    if (pageTransition) {
      pageTransition.classList.remove('is-hidden');
      pageTransition.classList.add('is-error', 'is-entering');
      pageTransition.dataset.loading = 'error';
      pageTransition.setAttribute('aria-hidden', 'false');
    }
    root.body?.setAttribute('aria-busy', 'true');
  }
}