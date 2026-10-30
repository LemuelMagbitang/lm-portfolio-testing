/**
 * Portfolio bootstrap.
 * Owns the outer lifecycle, page-composition loading, and fatal-error
 * containment. Infrastructure capabilities are imported directly so the
 * application has no dependency on legacy root facades.
 */

import { getSiteRootUrl, siteAssetUrl } from '../infrastructure/browser/site-paths.js?v=20261027-05';
import { prefersReducedMotion } from '../infrastructure/browser/reduced-motion.js';
import { loadScriptOnce } from '../infrastructure/browser/script-loader.js?v=20261008-01';
import { ensureLottiePlayer } from '../infrastructure/lottie/player.js';
import {
  ensureMediaBackgroundHelper,
  applyMediaBackground
} from '../infrastructure/media-background/loader.js?v=20261023-01';
import { loadCmsJson } from '../infrastructure/cms/loader.js';
import { parseYouTubeUrl } from '../infrastructure/youtube/url.js';
import { normalizeAppConfig } from '../core/config.js';

export async function bootstrapPortfolioApp({
  root = globalThis.document,
  cacheVersion = '20261030-06'
} = {}) {
  const pageTransition = root?.getElementById('pageTransition');
  const windowRef = root?.defaultView || globalThis.window;
  const loadingStartedAt = typeof windowRef?.performance?.now === 'function'
    ? windowRef.performance.now()
    : Date.now();
  const MIN_LOADING_SCREEN_MS = root.body?.classList.contains('about-page') ? 120 : 450;
  let initialTransitionFrame = null;
  let initialTransitionTimer = null;
  let loadingLock = null;
  const hasInitialHash = Boolean(String(windowRef?.location?.hash || ''));

  // Prevent the browser's pre-hydration fragment restoration from jumping to
  // a stale layout. We restore the expected native behavior after the exact
  // anchor has been settled by the composed page.
  if (hasInitialHash && windowRef?.history) {
    // Disable automatic fragment restoration while the composed page is still
    // moving into place, but don't force the viewport to the top. The final
    // target is reached with one intentional smooth-scroll after composition.
    try { windowRef.history.scrollRestoration = 'manual'; } catch (_) {}
  }


  function lockPageWhileLoading() {
    if (loadingLock || !pageTransition || !root.body) return;
    const body = root.body;
    const html = root.documentElement;
    const scrollKeys = new Set([' ', 'Spacebar', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown']);
    const previousStyles = {
      htmlOverflow: html?.style.overflow || '',
      bodyOverflow: body.style.overflow || '',
      bodyOverscroll: body.style.overscrollBehavior || '',
      bodyTouchAction: body.style.touchAction || ''
    };
    const inertChildren = Array.from(body.children)
      .filter(element => element !== pageTransition)
      .map(element => ({ element, inert: Boolean(element.inert) }));
    inertChildren.forEach(({ element }) => { element.inert = true; });
    if (html) html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    body.style.touchAction = 'none';
    const blockGesture = event => {
      if (pageTransition.dataset.loading !== 'ready' && event.cancelable) event.preventDefault();
    };
    const blockScrollKeys = event => {
      if (pageTransition.dataset.loading !== 'ready' && scrollKeys.has(event.key) && event.cancelable) event.preventDefault();
    };
    root.addEventListener?.('touchmove', blockGesture, { capture: true, passive: false });
    root.addEventListener?.('wheel', blockGesture, { capture: true, passive: false });
    root.addEventListener?.('keydown', blockScrollKeys, true);
    loadingLock = () => {
      root.removeEventListener?.('touchmove', blockGesture, true);
      root.removeEventListener?.('wheel', blockGesture, true);
      root.removeEventListener?.('keydown', blockScrollKeys, true);
      inertChildren.forEach(({ element, inert }) => { element.inert = inert; });
      if (html) html.style.overflow = previousStyles.htmlOverflow;
      body.style.overflow = previousStyles.bodyOverflow;
      body.style.overscrollBehavior = previousStyles.bodyOverscroll;
      body.style.touchAction = previousStyles.bodyTouchAction;
      loadingLock = null;
    };
  }

  function unlockPageAfterLoading() { loadingLock?.(); }

  function showInitialPageTransition() {
    if (!pageTransition) return;
    lockPageWhileLoading();
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
    unlockPageAfterLoading();
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

  function settleInitialHashTarget() {
    const rawHash = String(windowRef?.location?.hash || '').replace(/^#/, '');
    if (!rawHash) return;

    let id = rawHash;
    try { id = decodeURIComponent(rawHash); } catch (_) {}

    let target = root.getElementById(id);
    const curatedSlug = String(root.body?.dataset?.curatedViewSlug || '');
    if (!target && curatedSlug && id === curatedSlug) {
      target = root.getElementById('curatedViewHeading') || root.querySelector('.portfolio-wrapper');
    }
    const isContactTarget = id === 'contact-start' || id === 'contact-section';
    if (isContactTarget) {
      target = root.getElementById('contact-start') || root.getElementById('contact-section') || target;
    }
    if (!target) {
      if (hasInitialHash && windowRef?.history) {
        try { windowRef.history.scrollRestoration = 'auto'; } catch (_) {}
      }
      return;
    }

    // Let the composed content settle before calculating the final anchor.
    // Only issue one scroll command: re-applying scrollTop every frame would
    // cancel smooth scrolling and make automatic navigation appear to snap.
    const applyTarget = () => {
      if (!target.isConnected) return false;

      const rect = target.getBoundingClientRect();
      const currentY = Number(windowRef.scrollY) || 0;
      const viewportHeight = Number(windowRef.visualViewport?.height) || Number(windowRef.innerHeight) || 0;
      const documentHeight = Math.max(
        root.documentElement?.scrollHeight || 0,
        root.body?.scrollHeight || 0
      );
      const maxScrollY = Math.max(0, documentHeight - viewportHeight);
      const documentTargetY = currentY + rect.top;
      const navbarHeight = Number(root.querySelector('.navbar')?.getBoundingClientRect?.().height) || 0;
      const safeTop = Math.max(navbarHeight + 24, 24);

      let desiredTargetY;
      if (isContactTarget) {
        const contactGroup = root.querySelector('#contact-section .contact-grid');
        const groupRect = contactGroup?.getBoundingClientRect?.();
        if (groupRect?.height > 0) {
          const usableHeight = Math.max(1, viewportHeight - safeTop);
          const groupCenterDocumentY = currentY + groupRect.top + groupRect.height / 2;
          desiredTargetY = groupCenterDocumentY - (safeTop + usableHeight / 2);
          desiredTargetY = Math.min(desiredTargetY, documentTargetY - safeTop);
        } else {
          desiredTargetY = documentTargetY - safeTop;
        }
      } else {
        desiredTargetY = documentTargetY - Math.max(navbarHeight + 12, 24);
      }

      return Math.max(0, Math.min(maxScrollY, desiredTargetY));
    };

    const finishNavigation = () => {
      const targetY = applyTarget();
      if (targetY !== false) {
        const reducedMotion = Boolean(windowRef.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
        windowRef.scrollTo({ left: 0, top: targetY, behavior: reducedMotion ? 'auto' : 'smooth' });
      }
      if (hasInitialHash && windowRef?.history) {
        try { windowRef.history.scrollRestoration = 'auto'; } catch (_) {}
      }
    };

    windowRef.requestAnimationFrame(() => {
      windowRef.requestAnimationFrame(finishNavigation);
    });
  }

  showInitialPageTransition();
  // Initial hash navigation is settled once the composed page has its final layout.

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

    const app = await createPortfolioApp({
      root,
      runtime,
      cms,
      config
    });

    await waitForReadyPaint();
    settleInitialHashTarget();
    hideInitialPageTransition();
    // Start first-viewport reveals only after the branded gate is gone; otherwise
    // the shortest page can finish animating behind the loading overlay.
    try {
      app?.contentReveal?.refresh?.();
    } catch (revealError) {
      console.warn('Content reveal could not start.', revealError);
    }
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