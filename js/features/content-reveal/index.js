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
  {
    selector: '.about-hero .about-bio-text > *',
    // React Bits AnimatedContent-inspired profile, mapped to the site's native
    // IntersectionObserver/CSS system. Keep the hero entrance editorial, not
    // the generic demo's full 100px travel, and stagger each direct child.
    motion: { distance: 24, durationMs: 560, staggerStepMs: 48, staggerMaxMs: 144 }
  },
  {
    selector: '.about-page main .resume-skills-row > .resume-block > h3',
    motion: { distance: 16, durationMs: 460, staggerStepMs: 44, staggerMaxMs: 44 }
  },
  {
    selector: '#softwareSkillsList > li',
    motion: { distance: 16, durationMs: 460, staggerStepMs: 32, staggerMaxMs: 128 }
  },
  {
    selector: '#multimediaSkillsList > li',
    motion: { distance: 16, durationMs: 460, staggerStepMs: 32, staggerMaxMs: 128 }
  },
  {
    selector: '.about-page main .resume-main > .resume-block > h3',
    motion: { distance: 16, durationMs: 480, staggerStepMs: 44, staggerMaxMs: 88 }
  },
  {
    selector: '#experienceList > *',
    motion: { distance: 16, durationMs: 480, staggerStepMs: 30, staggerMaxMs: 120 }
  },
  {
    selector: '#educationList > *',
    motion: { distance: 16, durationMs: 480, staggerStepMs: 30, staggerMaxMs: 120 }
  },
  {
    selector: '#awardsList > *',
    motion: { distance: 16, durationMs: 480, staggerStepMs: 30, staggerMaxMs: 120 }
  },
  {
    selector: '.hero-section:not(.about-hero)',
    positionOnly: true,
    // The Works hero moves as one stable stage; slide/player motion remains
    // owned by Hero, while text stays readable throughout the entrance.
    animateOnSoftNavigation: true,
    motion: {
      distance: 14,
      mobileDistance: 10,
      durationMs: 520,
      ease: 'cubic-bezier(.22,1,.36,1)',
      threshold: 0.05
    }
  },
  {
    selector: 'main.works-main > .filter-nav-wrapper, #portfolioGridViewport',
    // Design-only entrance: filter rail first, then grid viewport. Gallery
    // continues to own individual card timing and interaction transforms.
    animateOnSoftNavigation: true,
    profile: 'animated-content',
    motion: {
      distance: 26,
      mobileDistance: 18,
      durationMs: 620,
      ease: 'cubic-bezier(.22,1,.36,1)',
      threshold: 0.05,
      staggerStepMs: 64,
      staggerMaxMs: 64
    }
  },
  { selector: '.curated-view-heading' },
  // The Contact tabs own a live segmented-control pill and drag state. Keep
  // those buttons out of generic reveal transforms so the hit areas and pill
  // geometry remain stable while selection/dragging is in progress.
  // Keep interactive form controls in their stable row geometry. Their
  // heading still participates in the reveal; moving the form container itself
  // can visibly desynchronize paired inputs while the stagger is in flight.
  { selector: '#contact-section #web3-forms-container > .contact-block > h2' },
  { selector: '#showMoreWrapper' },
  { selector: '.reviews-section .reviews-marquee' },
  { selector: '.footer-content > .social-icons, .footer-content > p' }
];

const STAGGER_STEP_MS = 44;
const STAGGER_MAX_MS = 160;
const DEFAULT_INTERSECTION_THRESHOLD = 0.01;
const DEFAULT_REVEAL_EASE = 'cubic-bezier(.16,1,.3,1)';
const REVEAL_OBSERVER_THRESHOLDS = Array.from(new Set([
  DEFAULT_INTERSECTION_THRESHOLD,
  ...REVEAL_TARGET_GROUPS
    .map(group => group.motion?.threshold)
    .filter(value => Number.isFinite(value) && value >= 0 && value <= 1)
])).sort((a, b) => a - b);
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
  windowRef = root?.defaultView || globalThis.window,
  immediateVisible = false
} = {}) {
  if (!root?.querySelectorAll || !windowRef) return NOOP_FEATURE;

  const Observer = windowRef.IntersectionObserver || globalThis.IntersectionObserver;
  if (typeof Observer !== 'function') return NOOP_FEATURE;

  let observer = null;
  let destroyed = false;
  let reducedMotionQuery = null;
  const targets = new Set();
  const pendingTargets = new Set();
  const targetThresholds = new WeakMap();

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
        const targetThreshold = targetThresholds.get(entry?.target) ?? DEFAULT_INTERSECTION_THRESHOLD;
        if (entry?.isIntersecting && Number(entry.intersectionRatio) >= targetThreshold) {
          revealTarget(entry.target);
        }
      });
    }, {
      root: null,
      rootMargin: '0px 0px 96px 0px',
      threshold: REVEAL_OBSERVER_THRESHOLDS
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

        // Text-bearing targets and interactive descendants stay fully opaque while
        // waiting for the viewport. Their staggered translate remains active, but
        // readable content never becomes effectively invisible to full-page audits.
        const hasReadableText = String(target.textContent || '').trim().length > 0;
        const hasInteractiveContent = Boolean(
          target.matches?.('.form-container, a, button, input, textarea, select, [role="button"]') ||
          target.querySelector?.('form, a[href], button, input, textarea, select, [role="button"]')
        );
        if (group.positionOnly === true || hasReadableText || hasInteractiveContent) {
          target.dataset.lmContentRevealMotion = 'position-only';
        }

        // Profiles are scoped to selector groups. Use a shorter default reveal so
        // scroll-triggered elements respond promptly; About sections have
        // separate stagger groups so each block sequences independently.
        const motion = group.motion || {};
        const configuredDistance = Number.isFinite(motion.distance)
          ? Math.max(0, motion.distance)
          : 18;
        const mobileDistance = Number.isFinite(motion.mobileDistance)
          ? Math.max(0, motion.mobileDistance)
          : configuredDistance;
        const viewportWidth = Number(windowRef.innerWidth) || 0;
        const distance = viewportWidth > 0 && viewportWidth <= 640
          ? mobileDistance
          : configuredDistance;
        const durationMs = Number.isFinite(motion.durationMs) ? Math.max(0, motion.durationMs) : 480;
        const staggerStepMs = Number.isFinite(motion.staggerStepMs)
          ? Math.max(0, motion.staggerStepMs)
          : STAGGER_STEP_MS;
        const staggerMaxMs = Number.isFinite(motion.staggerMaxMs)
          ? Math.max(0, motion.staggerMaxMs)
          : STAGGER_MAX_MS;
        const startDelayMs = Number.isFinite(motion.startDelayMs)
          ? Math.max(0, motion.startDelayMs)
          : 0;
        const delay = startDelayMs + Math.min(index * staggerStepMs, staggerMaxMs);
        const threshold = Number.isFinite(motion.threshold)
          ? Math.min(1, Math.max(0, motion.threshold))
          : DEFAULT_INTERSECTION_THRESHOLD;
        const easing = typeof motion.ease === 'string' && motion.ease.trim()
          ? motion.ease.trim()
          : DEFAULT_REVEAL_EASE;
        targetThresholds.set(target, threshold);
        target.dataset.lmContentRevealThreshold = String(threshold);
        if (group.profile) target.dataset.lmContentRevealProfile = group.profile;
        target.style.setProperty('--lm-content-reveal-distance', distance + 'px');
        target.style.setProperty('--lm-content-reveal-duration', durationMs + 'ms');
        target.style.setProperty('--lm-content-reveal-ease', easing);
        target.style.setProperty('--lm-content-reveal-delay', delay + 'ms');
        target.dataset.lmContentRevealState = 'pending';
        target.classList.add('lm-content-reveal-target');
        targets.add(target);

        const rect = target.getBoundingClientRect?.();
        const inViewport = immediateVisible && !group.animateOnSoftNavigation && rect &&
          rect.bottom > 0 && rect.top < (Number(windowRef.innerHeight) || 0);
        if (inViewport) {
          // Do not show an empty first viewport during route remounts.
          // Offscreen content continues to use the normal observer reveal.
          target.dataset.lmContentRevealState = 'shown';
          target.classList.add('is-lm-content-revealed');
        } else {
          pendingTargets.add(target);
          activeObserver.observe(target);
        }
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
        if (target.dataset) {
          delete target.dataset.lmContentRevealState;
          delete target.dataset.lmContentRevealMotion;
          delete target.dataset.lmContentRevealThreshold;
          delete target.dataset.lmContentRevealProfile;
        }
        target.style?.removeProperty?.('--lm-content-reveal-delay');
        target.style?.removeProperty?.('--lm-content-reveal-distance');
        target.style?.removeProperty?.('--lm-content-reveal-duration');
        target.style?.removeProperty?.('--lm-content-reveal-ease');
      });
      pendingTargets.clear();
      targets.clear();
    }
  };
}
