/**
 * Gallery presentation boundary.
 *
 * Owns responsive density and visual reveal mechanics. Gallery state and
 * filtering logic call these functions but do not decide how the grid should
 * look on each viewport.
 */

function setGalleryEntryDelay(card, value = '') {
  if (typeof card?.style?.setProperty !== 'function') return;
  card.style.setProperty('--gallery-entry-delay', value);
}

function clearGalleryScrollReveal(card, { complete = false } = {}) {
  if (!card?.dataset) return;
  if (complete) card.dataset.galleryRevealComplete = 'true';
  card.classList?.remove('has-gallery-scroll-reveal');
  card.style?.removeProperty?.('--gallery-scroll-reveal-delay');
  if (typeof card.removeAttribute === 'function') card.removeAttribute('data-gallery-reveal-state');
  else delete card.dataset.galleryRevealState;
}

function getGalleryColumnCount(grid, cards, windowRef) {
  const template = String(windowRef?.getComputedStyle?.(grid)?.gridTemplateColumns || '').trim();
  if (template && template !== 'none') {
    const count = template.split(/\s+/).filter(Boolean).length;
    if (count > 0) return count;
  }
  const leftEdges = [];
  cards.forEach(card => {
    const rect = card?.getBoundingClientRect?.();
    if (!Number.isFinite(rect?.left) || !(rect?.width > 0)) return;
    if (!leftEdges.some(left => Math.abs(left - rect.left) <= 2)) leftEdges.push(rect.left);
  });
  return Math.max(1, leftEdges.length);
}

/** Reveal stable card frames once as they enter Lightbox's inset viewport band. */
export function applyGalleryViewportReveal({
  grid, cards = [], windowRef = globalThis.window, renderToken = 0,
  isCurrentRender = () => true, skipVisibleReveal = false
} = {}) {
  if (!grid || !Array.isArray(cards) || !cards.length) return () => {};
  const eligible = cards.filter(card =>
    card?.dataset && card?.classList?.add && card?.classList?.remove &&
    card?.style?.setProperty && typeof card.getBoundingClientRect === 'function'
  );
  if (!eligible.length) return () => {};

  const reducedMotion = !!windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const isInsideViewport = card => {
    const rect = card.getBoundingClientRect();
    const width = Number(windowRef?.innerWidth) || 0;
    const height = Number(windowRef?.innerHeight) || 0;
    return rect.bottom > 24 && rect.top < height - 24 && rect.right > 0 && rect.left < width;
  };
  const pendingCards = [];
  eligible.forEach((card, index) => {
    if (card.dataset.galleryRevealComplete === 'true') clearGalleryScrollReveal(card);
    else if (reducedMotion || (skipVisibleReveal && isInsideViewport(card))) {
      clearGalleryScrollReveal(card, { complete: true });
    } else pendingCards.push({ card, index });
  });
  if (!pendingCards.length) return () => {};

  const Observer = windowRef?.IntersectionObserver || globalThis.IntersectionObserver;
  if (reducedMotion || typeof Observer !== 'function') {
    pendingCards.forEach(({ card }) => clearGalleryScrollReveal(card, { complete: true }));
    return () => {};
  }

  const columns = getGalleryColumnCount(grid, eligible, windowRef);
  const controlledCards = [];
  const transitionListeners = new Map();
  let disposed = false;
  const finishReveal = card => {
    const active = transitionListeners.get(card);
    if (!active) return;
    card.removeEventListener?.('transitionend', active.listener);
    if (active.timer !== null) windowRef?.clearTimeout?.(active.timer);
    transitionListeners.delete(card);
    clearGalleryScrollReveal(card);
  };
  const observer = new Observer(entries => {
    if (disposed || !isCurrentRender(renderToken)) return;
    entries.forEach(entry => {
      const card = entry.target;
      if (!entry.isIntersecting || !(entry.intersectionRatio > 0) ||
          card?.dataset?.galleryRevealState !== 'pending') return;
      observer.unobserve(card);
      card.dataset.galleryRevealComplete = 'true';
      card.dataset.galleryRevealState = 'revealing';
      const listener = event => {
        if (event?.target === card && event.propertyName === 'opacity') finishReveal(card);
      };
      card.addEventListener?.('transitionend', listener);
      const timer = typeof windowRef?.setTimeout === 'function'
        ? windowRef.setTimeout(() => finishReveal(card), 750)
        : null;
      transitionListeners.set(card, { listener, timer });
    });
  }, { root: null, rootMargin: '-24px 0px -24px 0px', threshold: 0.01 });

  pendingCards.forEach(({ card, index }) => {
    card.classList.add('has-gallery-scroll-reveal');
    card.dataset.galleryRevealState = 'pending';
    card.style.setProperty('--gallery-scroll-reveal-delay', String(Math.min(index % columns, 3) * 35) + 'ms');
    controlledCards.push(card);
    observer.observe(card);
  });
  return () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    controlledCards.forEach(card => {
      const active = transitionListeners.get(card);
      if (active) {
        card.removeEventListener?.('transitionend', active.listener);
        if (active.timer !== null) windowRef?.clearTimeout?.(active.timer);
        transitionListeners.delete(card);
      }
      clearGalleryScrollReveal(card);
    });
  };
}

export function captureGalleryCardRects(grid) {
  const rects = new Map();
  if (!grid) return rects;

  Array.from(grid.querySelectorAll('.project-card')).forEach(card => {
    const computed = globalThis.getComputedStyle?.(card);
    if (computed?.display === 'none') return;

    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    rects.set(card, {
      left: rect.left,
      top: rect.top
    });
  });

  return rects;
}

export function getResponsiveBaseCount({
  width,
  height,
  total,
  phoneCount = 6,
  tabletShortCount = 4,
  tabletTallCount = 6,
  desktopCount = 9,
  phoneAllVisibleMax = 8,
  tabletAllVisibleMax = 15,
  desktopAllVisibleMax = 15,
  tabletBreakpoint = 1100,
  phoneBreakpoint = 768
} = {}) {
  const count = Math.max(0, Number(total) || 0);
  const viewportWidth = Number(width) || 0;
  const viewportHeight = Number(height) || 0;

  if (viewportWidth < phoneBreakpoint) {
    return count <= phoneAllVisibleMax ? count : Math.min(phoneCount, count);
  }

  if (viewportWidth < tabletBreakpoint) {
    const base = viewportHeight < 820 ? tabletShortCount : tabletTallCount;
    return count <= tabletAllVisibleMax ? count : Math.min(base, count);
  }

  return count <= desktopAllVisibleMax ? count : Math.min(desktopCount, count);
}

export function getRowAlignedCount(
  cards = [],
  requestedCount = 0,
  windowRef = globalThis.window,
  grid = null
) {
  const requested = Math.max(0, Number(requestedCount) || 0);
  if (!cards.length || requested <= 0) return 0;

  const width = Number(windowRef?.innerWidth) || 0;
  if (width < 768 || cards.length <= requested) {
    return Math.min(requested, cards.length);
  }

  let columns = 0;

  // Prefer the actual CSS grid track geometry. During a filter transition,
  // cards from the previous result can still exist in the grid while fading
  // out, so counting "how many filtered cards share the first row" can
  // under-count the real column count and produce a bad Show More threshold.
  const firstCard = cards[0];
  const cardWidth = Number(firstCard?.getBoundingClientRect?.().width) || 0;
  const gridWidth = Number(grid?.getBoundingClientRect?.().width) || 0;
  if (cardWidth > 0 && gridWidth > 0) {
    const computedGap = windowRef?.getComputedStyle?.(grid)?.columnGap || '0';
    const gap = Number.parseFloat(computedGap) || 0;
    columns = Math.round((gridWidth + gap) / (cardWidth + gap));
  }

  // Fall back to row-position inference when grid geometry is unavailable.
  if (columns < 1) {
    const firstTop = firstCard?.getBoundingClientRect?.().top;
    if (!Number.isFinite(firstTop)) return Math.min(requested, cards.length);

    for (const card of cards) {
      const top = card?.getBoundingClientRect?.().top;
      if (!Number.isFinite(top) || Math.abs(top - firstTop) > 2) break;
      columns += 1;
    }
  }

  const safeColumns = Math.max(1, columns);
  const rowAligned = Math.ceil(requested / safeColumns) * safeColumns;
  return Math.min(rowAligned, cards.length);
}

export function applyGalleryReveal({
  grid,
  gridViewport,
  fadeOverlay,
  showMoreButton,
  showMoreWrapper,
  filteredCards = [],
  visibleCount = 0,
  expanded = false,
  windowRef = globalThis.window,
  fadeMs = 300,
  mobilePeek = 40,
  desktopPeek = 70,
  animateTransition = false,
  animateExpand = false,
  animateCollapse = false,
  transitionFromRects = null,
  renderToken = 0,
  isCurrentRender = () => true
} = {}) {
  const viewport = gridViewport || grid;
  if (!grid || !viewport) return;

  const filteredSet = new Set(filteredCards);
  const allCards = Array.from(grid.querySelectorAll('.project-card'));
  const hiddenCards = allCards.filter(card => !filteredSet.has(card));
  const reducedMotion = !!windowRef.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const filterTransitionDuration = reducedMotion ? '0ms' : '360ms';
  let transitionStartFrame = null;
  let transitionFrame = null;
  let viewportTransitionFrame = null;
  let viewportTransitionFrameIsTimer = false;
  let viewportTransitionFallbackTimer = null;
  let viewportTransitionListener = null;
  let viewportTransitionActive = false;
  let viewportTransitionCompletion = null;

  const cancelViewportTransition = () => {
    const wasActive = viewportTransitionActive;
    const currentHeight = wasActive
      ? Number(viewport.getBoundingClientRect?.().height) || 0
      : 0;
    if (viewportTransitionFrame !== null) {
      if (viewportTransitionFrameIsTimer) windowRef.clearTimeout(viewportTransitionFrame);
      else windowRef.cancelAnimationFrame?.(viewportTransitionFrame);
      viewportTransitionFrame = null;
    }
    viewportTransitionFrameIsTimer = false;
    if (viewportTransitionFallbackTimer !== null) {
      windowRef.clearTimeout(viewportTransitionFallbackTimer);
      viewportTransitionFallbackTimer = null;
    }
    if (viewportTransitionListener) {
      viewport.removeEventListener?.('transitionend', viewportTransitionListener);
      viewportTransitionListener = null;
    }
    // Preserve the in-flight visual height if a second activation reverses
    // direction before the first transition finishes.
    if (wasActive && currentHeight > 0) {
      viewport.style.maxHeight = `${Math.ceil(currentHeight)}px`;
    }
    viewportTransitionActive = false;
    viewportTransitionCompletion = null;
    viewport.classList?.remove('is-expanding', 'is-collapsing');
    showMoreWrapper?.classList?.remove('is-expanding', 'is-collapsing');
  };

  const finishViewportTransition = () => {
    if (!viewportTransitionActive) return;
    const complete = viewportTransitionCompletion;
    cancelViewportTransition();
    if (!isCurrentRender(renderToken)) return;
    complete?.();
  };

  const startViewportTransition = ({ startHeight, targetHeight, direction, onComplete } = {}) => {
    const fromHeight = Math.ceil(Number(startHeight) || 0);
    const toHeight = Math.ceil(Number(targetHeight) || 0);
    if (!(fromHeight > 0) || !(toHeight > 0) || Math.abs(fromHeight - toHeight) <= 1) return false;

    // Freeze the current visual height before enabling the transition. This
    // also makes a rapid direction change continue from the in-flight frame.
    viewport.style.maxHeight = `${fromHeight}px`;
    void viewport.getBoundingClientRect?.().height;

    const transitionClass = direction === 'collapse' ? 'is-collapsing' : 'is-expanding';
    viewportTransitionActive = true;
    viewportTransitionCompletion = onComplete;
    viewport.classList?.add(transitionClass);
    showMoreWrapper?.classList?.add(transitionClass);

    // Commit the transition-enabled starting styles before changing the target.
    // CSS applies the same short 70ms handoff in both directions.
    void windowRef.getComputedStyle?.(viewport)?.transitionDuration;
    if (showMoreWrapper) {
      void windowRef.getComputedStyle?.(showMoreWrapper)?.transitionDuration;
    }

    viewportTransitionListener = event => {
      if (event?.target === viewport && event.propertyName === 'max-height') {
        finishViewportTransition();
      }
    };
    viewport.addEventListener?.('transitionend', viewportTransitionListener);

    const applyTargetHeight = () => {
      viewportTransitionFrame = null;
      viewportTransitionFrameIsTimer = false;
      if (!isCurrentRender(renderToken)) {
        cancelViewportTransition();
        return;
      }
      viewport.style.maxHeight = `${toHeight}px`;
    };
    // Keep the measured starting height visible for one paint before applying
    // the target. The shared CSS transition delay then creates the short handoff.
    if (typeof windowRef.requestAnimationFrame === 'function') {
      viewportTransitionFrame = windowRef.requestAnimationFrame(applyTargetHeight);
    } else {
      viewportTransitionFrameIsTimer = true;
      viewportTransitionFrame = windowRef.setTimeout(applyTargetHeight, 0);
    }

    // Backgrounded tabs can throttle transitions or omit transitionend.
    viewportTransitionFallbackTimer = windowRef.setTimeout(finishViewportTransition, 900);
    return true;
  };

  const startExpansion = () => {
    if (!animateExpand || !expanded || reducedMotion) return false;
    const startHeight = Number(viewport.getBoundingClientRect?.().height) || 0;
    const gridHeight = Math.max(
      Number(grid.scrollHeight) || 0,
      Number(grid.getBoundingClientRect?.().height) || 0
    );
    if (!(startHeight > 0) || !(gridHeight > startHeight + 1)) return false;

    return startViewportTransition({
      startHeight,
      targetHeight: gridHeight,
      direction: 'expand',
      onComplete: () => {
        // Release the explicit pixel ceiling after the measured full height is reached.
        viewport.style.maxHeight = 'none';
        fadeOverlay?.classList.add('is-hidden');
      }
    });
  };

  hiddenCards.forEach(card => {
    if (card.dataset?.galleryRevealState === 'pending') card.removeAttribute?.('data-gallery-reveal-state');
    card.style.opacity = '0';
    if (animateTransition) {
      card.style.transitionDuration = filterTransitionDuration;
      card.style.transitionDelay = '0ms';
      card.style.transform = 'translate3d(0, 5px, 0)';
      card.style.filter = 'blur(3px)';
      card.style.willChange = reducedMotion ? '' : 'opacity, transform, filter';
    }
  });

  const getCollapsedHeight = () => {
    if (!isCurrentRender(renderToken) || expanded) return null;
    if (filteredCards.length <= visibleCount || visibleCount <= 0) return null;

    const viewportRect = viewport.getBoundingClientRect();
    const gridRect = typeof grid?.getBoundingClientRect === 'function'
      ? grid.getBoundingClientRect()
      : viewportRect;
    if (!Number.isFinite(viewportRect.top) || !Number.isFinite(gridRect.top)) return null;

    // Collapse geometry must use layout metrics, not transformed visual
    // bounds. Filter transitions translate cards visually, but that transform
    // must never alter the actual Show More viewport size.
    const visibleCards = filteredCards.slice(0, visibleCount);
    const furthestBottom = visibleCards.reduce((maxBottom, card) => {
      const offsetTop = Number(card?.offsetTop);
      const offsetHeight = Number(card?.offsetHeight);
      if (Number.isFinite(offsetTop) && Number.isFinite(offsetHeight)) {
        return Math.max(maxBottom, gridRect.top + offsetTop + offsetHeight);
      }

      // Lightweight test doubles and older embedded callers may not expose
      // offset geometry. Fall back to the visual bottom only when layout
      // metrics are unavailable; real browser cards take the layout-metric path.
      const bottom = Number(card?.getBoundingClientRect?.().bottom);
      return Number.isFinite(bottom) ? Math.max(maxBottom, bottom) : maxBottom;
    }, Number.NEGATIVE_INFINITY);

    if (!Number.isFinite(furthestBottom)) return null;

    // Clip the dedicated viewport, never the grid itself. The grid keeps its
    // natural height, so lazy media/layout changes cannot rewrite the
    // gallery's interaction state while the visitor is scrolling.
    const peek = windowRef.innerWidth < 768 ? mobilePeek : desktopPeek;
    const height = Math.max(1, furthestBottom - viewportRect.top + peek);
    return Math.round(height);
  };

  const measureCollapsedHeight = () => {
    const height = getCollapsedHeight();
    if (!Number.isFinite(height)) return false;
    viewport.style.maxHeight = `${height}px`;
    fadeOverlay?.classList.remove('is-hidden');
    return true;
  };

  const startCollapse = () => {
    if (!animateCollapse || expanded || reducedMotion) return false;
    const targetHeight = getCollapsedHeight();
    if (!Number.isFinite(targetHeight)) return false;

    const startHeight = Number(viewport.getBoundingClientRect?.().height) || 0;
    if (!(startHeight > targetHeight + 1)) {
      viewport.style.maxHeight = `${targetHeight}px`;
      fadeOverlay?.classList.remove('is-hidden');
      return false;
    }

    fadeOverlay?.classList.remove('is-hidden');
    return startViewportTransition({
      startHeight,
      targetHeight,
      direction: 'collapse',
      onComplete: () => {
        viewport.style.maxHeight = `${targetHeight}px`;
        fadeOverlay?.classList.remove('is-hidden');
      }
    });
  };

  // Project-card geometry is presentation-locked by the CSS card contract
  // (the card owns a fixed 1:1 footprint). Keep collapse measurement
  // deterministic instead of continuously rewriting max-height from a
  // ResizeObserver while the visitor scrolls. Late asset loads can still be
  // covered by the bounded post-render measurements below without letting a
  // layout observer move the Show More control underneath the user.

  const settleFilterLayout = () => {
    if (!animateTransition || !isCurrentRender(renderToken)) return;

    if (reducedMotion || !transitionFromRects) {
      filteredCards.forEach(card => {
        card.style.opacity = '1';
        card.style.transform = 'translate3d(0, 0, 0)';
        card.style.filter = 'blur(0)';
        card.style.willChange = '';
      });
      return;
    }

    // Old cards are already leaving layout here. Invert surviving cards from
    // their previous viewport coordinates, then release that inverse on the
    // next paint so CSS Grid reflow becomes continuous visual movement.
    filteredCards.forEach(card => {
      card.style.transition = 'none';
      card.style.transform = 'translate3d(0, 0, 0)';
    });

    filteredCards.forEach(card => {
      const from = transitionFromRects.get(card);
      const to = card.getBoundingClientRect();
      const deltaX = from ? from.left - to.left : 0;
      const deltaY = from ? from.top - to.top : 8;
      const x = Math.round(deltaX * 100) / 100;
      const y = Math.round(deltaY * 100) / 100;
      card.style.transform = 'translate3d(' + x + 'px, ' + y + 'px, 0)';
    });

    transitionStartFrame = windowRef.requestAnimationFrame(() => {
      if (!isCurrentRender(renderToken)) return;

      transitionFrame = windowRef.requestAnimationFrame(() => {
        if (!isCurrentRender(renderToken)) return;

        filteredCards.forEach(card => {
          card.style.transition = '';
          card.style.opacity = '1';
          card.style.transform = 'translate3d(0, 0, 0)';
          card.style.filter = 'blur(0)';
        });

        transitionFrame = null;
        transitionStartFrame = null;
      });
    });
  };

  const hideTimer = windowRef.setTimeout(() => {
    if (!isCurrentRender(renderToken)) return;
    filteredCards.forEach(card => { card.style.display = 'block'; });
    hiddenCards.forEach(card => {
      if (!filteredSet.has(card)) card.style.display = 'none';
    });

    settleFilterLayout();

    if (!expanded && filteredCards.length > visibleCount && visibleCount > 0) {
      if (!viewportTransitionActive) {
        measureCollapsedHeight();
        windowRef.requestAnimationFrame(() => {
          if (!isCurrentRender(renderToken) || viewportTransitionActive) return;
          measureCollapsedHeight();
        });
      }
    } else if (expanded || filteredCards.length <= visibleCount || visibleCount <= 0) {
      if (!viewportTransitionActive) {
        viewport.style.maxHeight = 'none';
        fadeOverlay?.classList.add('is-hidden');
      }
    }
  }, Math.max(0, Number(fadeMs) || 0));

  filteredCards.forEach(card => {
    card.style.display = 'block';
    if (animateTransition) {
      // One duration, one easing, and no per-card delay make the result read
      // as a single composition rather than a staggered list.
      card.style.setProperty('--gallery-entry-delay', '0ms');
      card.style.transitionDuration = filterTransitionDuration;
      card.style.transitionDelay = '0ms';
      card.style.willChange = reducedMotion ? '' : 'opacity, transform, filter';
      card.style.opacity = '0.18';
      card.style.transform = 'translate3d(0, 8px, 0)';
      card.style.filter = 'blur(3px)';
    } else {
      setGalleryEntryDelay(card);
      card.style.willChange = '';
    }
  });

  const cleanupViewportReveal = applyGalleryViewportReveal({
    grid, cards: filteredCards, windowRef, renderToken, isCurrentRender,
    skipVisibleReveal: animateTransition
  });

  windowRef.requestAnimationFrame(() => {
    if (!isCurrentRender(renderToken) || animateTransition) return;
    filteredCards.forEach(card => {
      card.style.opacity = '1';
    });
  });

  if (!animateTransition && !expanded && filteredCards.length > visibleCount && visibleCount > 0) {
    // Direct Show Less activations animate from the current viewport height.
    // Other renders keep the existing immediate measurement behavior.
    if (!startCollapse()) {
      measureCollapsedHeight();
      windowRef.requestAnimationFrame(() => {
        if (isCurrentRender(renderToken) && !viewportTransitionActive) measureCollapsedHeight();
      });
    }
  } else if (!animateTransition && (expanded || filteredCards.length <= visibleCount || visibleCount <= 0)) {
    if (!startExpansion()) {
      viewport.style.maxHeight = 'none';
      fadeOverlay?.classList.add('is-hidden');
    }
  }

  // The timer belongs to the current render. Returning a cancel function lets
  // the Gallery lifecycle discard it during destroy() without owning the
  // presentation implementation.
  const cleanupTransition = () => {
    if (transitionStartFrame !== null) {
      windowRef.cancelAnimationFrame?.(transitionStartFrame);
      transitionStartFrame = null;
    }
    if (transitionFrame !== null) {
      windowRef.cancelAnimationFrame?.(transitionFrame);
      transitionFrame = null;
    }

    if (!animateTransition) return;
    [...filteredCards, ...hiddenCards].forEach(card => {
      card.style.transition = '';
      card.style.transitionDuration = '';
      card.style.transitionDelay = '';
      card.style.transform = '';
      card.style.filter = '';
      card.style.setProperty('--gallery-entry-delay', '');
      card.style.willChange = '';
    });
  };

  const cleanup = () => {
    windowRef.clearTimeout(hideTimer);
    cancelViewportTransition();
    cleanupTransition();
    cleanupViewportReveal();
  };
  if (!showMoreButton || !showMoreWrapper) return cleanup;

  const label = showMoreButton.querySelector('.btn-text');
  const syncShowMoreButtonState = () => {
    showMoreButton.setAttribute('aria-expanded', String(expanded));
    showMoreWrapper.setAttribute('data-expanded', String(expanded));
    showMoreButton.classList.toggle('expanded', expanded);
    if (label) label.textContent = expanded ? 'SHOW LESS' : 'SHOW MORE';
  };

  if (filteredCards.length > visibleCount) {
    showMoreWrapper.style.display = 'flex';
    // This class owns the wrapper's layout spacing, so change it when the
    // viewport transition starts. The button's own visual/semantic state stays
    // unchanged until the viewport reaches its final height.
    showMoreWrapper.classList.toggle('expanded', expanded);
    // The button and ARIA state follow the requested state immediately.
    // Only the content geometry remains in the measured height transition.
    syncShowMoreButtonState();
  } else {
    showMoreWrapper.style.display = 'none';
    syncShowMoreButtonState();
  }

  return cleanup;
}

export function resetGalleryPresentation({
  grid,
  gridViewport,
  fadeOverlay,
  showMoreButton,
  showMoreWrapper
} = {}) {
  if (grid) {
    Array.from(grid.querySelectorAll('.project-card')).forEach(card => {
      card.style.opacity = '';
      card.style.display = '';
      card.style.transform = '';
      card.style.filter = '';
      card.style.removeProperty?.('--gallery-scroll-reveal-delay');
      card.classList?.remove('has-gallery-scroll-reveal');
      card.removeAttribute?.('data-gallery-reveal-state');
      card.removeAttribute?.('data-gallery-reveal-complete');
    });
  }

  if (gridViewport) gridViewport.style.maxHeight = '';

  fadeOverlay?.classList.add('is-hidden');

  if (showMoreWrapper) {
    showMoreWrapper.style.display = '';
    showMoreWrapper.classList.remove('expanded');
  }

  showMoreButton?.classList.remove('expanded');
}
