/**
 * Gallery presentation boundary.
 *
 * Owns responsive density and visual reveal mechanics. Gallery state and
 * filtering logic call these functions but do not decide how the grid should
 * look on each viewport.
 */

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
  windowRef = globalThis.window
) {
  const requested = Math.max(0, Number(requestedCount) || 0);
  if (!cards.length || requested <= 0) return 0;

  const width = Number(windowRef?.innerWidth) || 0;
  if (width < 768 || cards.length <= requested) {
    return Math.min(requested, cards.length);
  }

  const firstTop = cards[0]?.getBoundingClientRect?.().top;
  if (!Number.isFinite(firstTop)) return Math.min(requested, cards.length);

  let columns = 0;
  for (const card of cards) {
    const top = card?.getBoundingClientRect?.().top;
    if (!Number.isFinite(top) || Math.abs(top - firstTop) > 2) break;
    columns += 1;
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
  });

  const measureCollapsedHeight = () => {
    if (!isCurrentRender(renderToken) || expanded) return;
    if (filteredCards.length <= visibleCount || visibleCount <= 0) return;

    const viewportRect = viewport.getBoundingClientRect();
    const lastVisible = filteredCards[visibleCount - 1];
    const cardRect = lastVisible?.getBoundingClientRect?.();
    if (!cardRect || !Number.isFinite(cardRect.bottom) || !Number.isFinite(viewportRect.top)) return;

    // Clip the dedicated viewport, never the grid itself. The grid keeps its
    // natural height, so lazy media/layout changes cannot rewrite the
    // gallery's interaction state while the visitor is scrolling.
    const peek = windowRef.innerWidth < 768 ? mobilePeek : desktopPeek;
    const height = Math.max(1, cardRect.bottom - viewportRect.top + peek);
    viewport.style.maxHeight = `${Math.round(height)}px`;
    fadeOverlay?.classList.remove('is-hidden');
  };

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

  filteredCards.forEach(card => {
    card.style.display = 'block';
  });

  windowRef.requestAnimationFrame(() => {
    if (!isCurrentRender(renderToken)) return;
    filteredCards.forEach(card => { card.style.opacity = '1'; });
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
