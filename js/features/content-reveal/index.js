/**
 * Content Reveal — progressive, attribute-driven page entrance motion.
 *
 * Keeps motion outside page markup and component implementations. Existing
 * feature-owned motion (Hero, Gallery, Lightbox, navigation, and marquee) is
 * intentionally left to its own controller to avoid competing transforms.
 * No React, GSAP, or external animation runtime is required.
 */

const REVEAL_TARGET_GROUPS = [
  { selector: '.about-hero .photo-frame' },
  { selector: '.about-hero .about-bio-text > *' },
  {
    selector: '.about-page main .resume-skills-row > .resume-block > h3, ' +
      '.about-page main .resume-skills-row .skill-list > li'
  },
  {
    selector: '.about-page main .resume-main > .resume-block > h3, ' +
      '.about-page main .resume-main > .resume-block [id$="List"] > *'
  },
  { selector: 'main.works-main > .filter-nav-wrapper' },
  { selector: '.curated-view-heading' },
  { selector: '#contact-section > .contact-mobile-tabs > .contact-mobile-tab' },
  {
    selector: '#contact-section #web3-forms-container > .contact-block > h2, ' +
      '#contact-section #web3-forms-container > .contact-block > .form-container'
  },
  { selector: '#showMoreWrapper' },
  { selector: '.reviews-section .reviews-marquee' },
  { selector: '.footer-content > .social-icons, .footer-content > p' }
];

const STAGGER_STEP_MS = 70;
const STAGGER_MAX_MS = 280;
const NOOP_FEATURE = Object.freeze({
  refresh() { return 0; },
  destroy() {}
});

function isReducedMotion(view) {
  try {
    return Boolean(view?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch (_) {
    return false;
  }
}

/**
 * Reveals selected page content on entry into the viewport.
 * The returned API is owned by page composition and must be destroyed with it.
 */
export function initContentReveal({
  root = globalThis.document,
  windowRef = root?.defaultView || globalThis.window
} = {}) {
  if (!root?.querySelectorAll || !windowRef) return NOOP_FEATURE;

  const Observer = windowRef.IntersectionObserver || globalThis.IntersectionObserver;
  if (typeof Observer !== 'function') return NOOP_FEATURE;

  let observer = null;
  let destroyed = false;
  let reducedMotionQuery = null;
  const targets = new Set();
  const pendingTargets = new Set();

  try {
    reducedMotionQuery = windowRef.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
  } catch (_) {}

  const revealTarget = target => {
    if (!target?.dataset || target.dataset.lmContentRevealState !== 'pending') return;
    target.dataset.lmContentRevealState = 'shown';
    target.classList?.add('is-lm-content-revealed');
    pendingTargets.delete(target);
    observer?.unobserve?.(target);
  };

  const ensureObserver = () => {
    if (observer || destroyed) return observer;
    observer = new Observer(entries => {
      if (destroyed) return;
      if (isReducedMotion(windowRef)) {
        pendingTargets.forEach(revealTarget);
        observer?.disconnect?.();
        observer = null;
        return;
      }
      entries.forEach(entry => {
        if (entry?.isIntersecting && Number(entry.intersectionRatio) > 0) {
          revealTarget(entry.target);
        }
      });
    }, {
      root: null,
      rootMargin: '0px 0px -40px 0px',
      threshold: 0.01
    });
    return observer;
  };

  function refresh() {
    if (destroyed || isReducedMotion(windowRef)) return 0;
    const activeObserver = ensureObserver();
    if (!activeObserver) return 0;

    let added = 0;
    REVEAL_TARGET_GROUPS.forEach(group => {
      let groupTargets = [];
      try {
        groupTargets = Array.from(root.querySelectorAll(group.selector));
      } catch (_) {}

      groupTargets.forEach((target, index) => {
        if (!target?.classList?.add || !target?.dataset || !target?.style?.setProperty) return;
        if (target.dataset.lmContentRevealState ||
            target.closest?.('[data-lm-content-reveal="off"]')) return;

        // Delay only sibling members; clamp it to avoid a slow cascade on longer lists.
        const delay = Math.min(index * STAGGER_STEP_MS, STAGGER_MAX_MS);
        target.style.setProperty('--lm-content-reveal-delay', delay + 'ms');
        target.dataset.lmContentRevealState = 'pending';
        target.classList.add('lm-content-reveal-target');
        targets.add(target);
        pendingTargets.add(target);
        activeObserver.observe(target);
        added += 1;
      });
    });
    return added;
  }

  const handleMotionPreferenceChange = event => {
    if (destroyed) return;
    if (event?.matches ?? isReducedMotion(windowRef)) {
      // Never leave content hidden when the visitor enables reduced motion.
      pendingTargets.forEach(revealTarget);
      observer?.disconnect?.();
      observer = null;
    } else {
      refresh();
    }
  };

  if (typeof reducedMotionQuery?.addEventListener === 'function') {
    reducedMotionQuery.addEventListener('change', handleMotionPreferenceChange);
  } else if (typeof reducedMotionQuery?.addListener === 'function') {
    reducedMotionQuery.addListener(handleMotionPreferenceChange);
  }

  // Page composition owns the start timing; bootstrap calls refresh only after
  // the branded startup gate is dismissed so first-screen motion is visible.
  return {
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer?.disconnect?.();
      observer = null;
      if (typeof reducedMotionQuery?.removeEventListener === 'function') {
        reducedMotionQuery.removeEventListener('change', handleMotionPreferenceChange);
      } else if (typeof reducedMotionQuery?.removeListener === 'function') {
        reducedMotionQuery.removeListener(handleMotionPreferenceChange);
      }
      targets.forEach(target => {
        target.classList?.remove('lm-content-reveal-target', 'is-lm-content-revealed');
        if (target.dataset) delete target.dataset.lmContentRevealState;
        target.style?.removeProperty?.('--lm-content-reveal-delay');
      });
      pendingTargets.clear();
      targets.clear();
    }
  };
}
