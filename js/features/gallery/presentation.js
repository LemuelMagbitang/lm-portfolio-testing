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

  hiddenCards.forEach(card => {
    card.style.opacity = '0';
    if (animateTransition) {
      card.style.transitionDuration = filterTransitionDuration;
      card.style.transitionDelay = '0ms';
      card.style.transform = 'translate3d(0, 5px, 0)';
      card.style.filter = 'blur(5px)';
      card.style.willChange = reducedMotion ? '' : 'opacity, transform, filter';
    }
  });

  const measureCollapsedHeight = () => {
    if (!isCurrentRender(renderToken) || expanded) return;
    if (filteredCards.length <= visibleCount || visibleCount <= 0) return;

    const viewportRect = viewport.getBoundingClientRect();
    const gridRect = typeof grid?.getBoundingClientRect === 'function'
      ? grid.getBoundingClientRect()
      : viewportRect;
    if (!Number.isFinite(viewportRect.top) || !Number.isFinite(gridRect.top)) return;

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

    if (!Number.isFinite(furthestBottom)) return;

    // Clip the dedicated viewport, never the grid itself. The grid keeps its
    // natural height, so lazy media/layout changes cannot rewrite the
    // gallery's interaction state while the visitor is scrolling.
    const peek = windowRef.innerWidth < 768 ? mobilePeek : desktopPeek;
    const height = Math.max(1, furthestBottom - viewportRect.top + peek);
    viewport.style.maxHeight = `${Math.round(height)}px`;
    fadeOverlay?.classList.remove('is-hidden');
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
      measureCollapsedHeight();
      windowRef.requestAnimationFrame(() => {
        if (!isCurrentRender(renderToken)) return;
        measureCollapsedHeight();
      });
    } else if (expanded || filteredCards.length <= visibleCount || visibleCount <= 0) {
      viewport.style.maxHeight = 'none';
      fadeOverlay?.classList.add('is-hidden');
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
      card.style.filter = 'blur(5px)';
    } else {
      setGalleryEntryDelay(card);
      card.style.willChange = '';
    }
  });

  windowRef.requestAnimationFrame(() => {
    if (!isCurrentRender(renderToken) || animateTransition) return;
    filteredCards.forEach(card => {
      card.style.opacity = '1';
    });
  });

  if (!animateTransition && !expanded && filteredCards.length > visibleCount && visibleCount > 0) {
    // Non-transition renders can measure immediately because no outgoing result
    // is occupying the grid. Filter transitions defer measurement until their
    // outgoing cards have left layout.
    measureCollapsedHeight();
    windowRef.requestAnimationFrame(measureCollapsedHeight);
  } else if (!animateTransition && (expanded || filteredCards.length <= visibleCount || visibleCount <= 0)) {
    viewport.style.maxHeight = 'none';
    fadeOverlay?.classList.add('is-hidden');
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

  if (!showMoreButton || !showMoreWrapper) {
    return () => {
      windowRef.clearTimeout(hideTimer);
      cleanupTransition();
    };
  }

  const label = showMoreButton.querySelector('.btn-text');
  showMoreButton.setAttribute('aria-expanded', String(expanded));
  showMoreWrapper.setAttribute('data-expanded', String(expanded));

  if (filteredCards.length > visibleCount) {
    showMoreWrapper.style.display = 'flex';
    showMoreWrapper.classList.toggle('expanded', expanded);
    showMoreButton.classList.toggle('expanded', expanded);
    if (label) label.textContent = expanded ? 'SHOW LESS' : 'SHOW MORE';
  } else {
    showMoreWrapper.style.display = 'none';
  }

  return () => {
    windowRef.clearTimeout(hideTimer);
    cleanupTransition();
  };
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
