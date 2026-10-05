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
  renderToken = 0,
  isCurrentRender = () => true
} = {}) {
  const viewport = gridViewport || grid;
  if (!grid || !viewport) return;

  const filteredSet = new Set(filteredCards);
  const allCards = Array.from(grid.querySelectorAll('.project-card'));
  const hiddenCards = allCards.filter(card => !filteredSet.has(card));

  hiddenCards.forEach(card => {
    card.style.opacity = '0';
    if (animateTransition) {
      card.style.transform = 'translate3d(0, 5px, 0) scale(.985)';
      card.style.filter = 'blur(5px)';
    }
  });

  const measureCollapsedHeight = () => {
    if (!isCurrentRender(renderToken) || expanded) return;
    if (filteredCards.length <= visibleCount || visibleCount <= 0) return;

    const viewportRect = viewport.getBoundingClientRect();
    if (!Number.isFinite(viewportRect.top)) return;

    // A CSS grid row takes the height of its tallest card. With media-aware
    // card proportions, the last card in the visible set is not necessarily
    // the tallest card in its final row. Measure every currently visible card
    // and clip to the furthest bottom edge so a taller sibling can never be
    // cut off by the Show More viewport.
    const visibleCards = filteredCards.slice(0, visibleCount);
    const furthestBottom = visibleCards.reduce((maxBottom, card) => {
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

  const hideTimer = windowRef.setTimeout(() => {
    if (!isCurrentRender(renderToken)) return;
    filteredCards.forEach(card => { card.style.display = 'block'; });
    hiddenCards.forEach(card => {
      if (!filteredSet.has(card)) card.style.display = 'none';
    });

    // Re-measure after filter cards leave layout. A second frame handles
    // browser-restored pages and media metadata that settle just after the
    // first paint.
    windowRef.requestAnimationFrame(() => {
      if (!isCurrentRender(renderToken)) return;
      measureCollapsedHeight();
      windowRef.requestAnimationFrame(measureCollapsedHeight);
    });
  }, Math.max(0, Number(fadeMs) || 0));

  filteredCards.forEach((card, index) => {
    card.style.display = 'block';
    if (animateTransition) {
      const isMobile = Number(windowRef.innerWidth) < 768;
      card.style.setProperty(
        '--gallery-entry-delay',
        isMobile ? (Math.min(index, 7) * 18) + 'ms' : '0ms'
      );
      card.style.willChange = 'opacity, transform, filter';
      card.style.opacity = isMobile ? '0.24' : '0';
      card.style.transform = isMobile
        ? 'translate3d(0, 12px, 0) scale(.96)'
        : 'translate3d(0, 5px, 0) scale(.985)';
      card.style.filter = isMobile ? 'blur(7px)' : 'blur(5px)';
    } else {
      setGalleryEntryDelay(card);
      card.style.willChange = '';
    }
  });

  windowRef.requestAnimationFrame(() => {
    if (!isCurrentRender(renderToken)) return;
    filteredCards.forEach(card => {
      card.style.opacity = '1';
      if (animateTransition) {
        card.style.transform = 'translate3d(0, 0, 0) scale(1)';
        card.style.filter = 'blur(0)';
      }
    });
  });

  if (!expanded && filteredCards.length > visibleCount && visibleCount > 0) {
    // Measure from the actual visible card, but defer once so navigation
    // restoration and media dimensions have a chance to settle.
    measureCollapsedHeight();
    windowRef.requestAnimationFrame(measureCollapsedHeight);
  } else {
    viewport.style.maxHeight = 'none';
    fadeOverlay?.classList.add('is-hidden');
  }

  // The timer belongs to the current render. Returning a cancel function lets
  // the Gallery lifecycle discard it during destroy() without owning the
  // presentation implementation.
  if (!showMoreButton || !showMoreWrapper) {
    return () => {
      windowRef.clearTimeout(hideTimer);
      if (animateTransition) {
        filteredCards.forEach(card => {
          card.style.transform = '';
          card.style.filter = '';
          setGalleryEntryDelay(card);
          card.style.willChange = '';
        });
        hiddenCards.forEach(card => {
          card.style.transform = '';
          card.style.filter = '';
          setGalleryEntryDelay(card);
          card.style.willChange = '';
        });
      }
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
    if (animateTransition) {
      filteredCards.forEach(card => {
        card.style.transform = '';
        card.style.filter = '';
      });
      hiddenCards.forEach(card => {
        card.style.transform = '';
        card.style.filter = '';
      });
    }
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
