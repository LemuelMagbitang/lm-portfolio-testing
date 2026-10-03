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
  phoneCount = 2,
  tabletShortCount = 4,
  tabletTallCount = 6,
  desktopCount = 9,
  tabletBreakpoint = 1100,
  phoneBreakpoint = 768
} = {}) {
  const count = Math.max(0, Number(total) || 0);
  const viewportWidth = Number(width) || 0;
  const viewportHeight = Number(height) || 0;

  if (viewportWidth < phoneBreakpoint) return Math.min(phoneCount, count);
  if (viewportWidth < tabletBreakpoint) {
    return Math.min(viewportHeight < 820 ? tabletShortCount : tabletTallCount, count);
  }
  return Math.min(desktopCount, count);
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
  fadeOverlay,
  showMoreButton,
  showMoreWrapper,
  filteredCards = [],
  visibleCount = 0,
  expanded = false,
  windowRef = globalThis.window,
  fadeMs = 300,
  mobilePeek = 40,
  desktopPeek = 70
} = {}) {
  if (!grid) return;

  const filteredSet = new Set(filteredCards);
  const allCards = Array.from(grid.querySelectorAll('.project-card'));
  const hiddenCards = allCards.filter(card => !filteredSet.has(card));

  hiddenCards.forEach(card => {
    card.style.opacity = '0';
  });

  windowRef.setTimeout(() => {
    filteredCards.forEach(card => { card.style.display = 'block'; });
    hiddenCards.forEach(card => {
      if (!filteredSet.has(card)) card.style.display = 'none';
    });
  }, Math.max(0, Number(fadeMs) || 0));

  filteredCards.forEach(card => {
    card.style.display = 'block';
  });

  windowRef.requestAnimationFrame(() => {
    filteredCards.forEach(card => { card.style.opacity = '1'; });
  });

  if (!expanded && filteredCards.length > visibleCount && visibleCount > 0) {
    const gridRect = grid.getBoundingClientRect();
    const lastVisible = filteredCards[visibleCount - 1];
    const cardRect = lastVisible?.getBoundingClientRect?.();

    if (cardRect && Number.isFinite(cardRect.bottom)) {
      const peek = windowRef.innerWidth < 768 ? mobilePeek : desktopPeek;
      grid.style.maxHeight = `${Math.round(cardRect.bottom - gridRect.top + peek)}px`;
      fadeOverlay?.classList.remove('is-hidden');
    }
  } else {
    grid.style.maxHeight = 'none';
    fadeOverlay?.classList.add('is-hidden');
  }

  if (!showMoreButton || !showMoreWrapper) return;

  const label = showMoreButton.querySelector('.btn-text');
  if (filteredCards.length > visibleCount) {
    showMoreWrapper.style.display = 'flex';
    showMoreWrapper.classList.toggle('expanded', expanded);
    showMoreButton.classList.toggle('expanded', expanded);
    if (label) label.textContent = expanded ? 'SHOW LESS' : 'SHOW MORE';
  } else {
    showMoreWrapper.style.display = 'none';
  }
}

export function resetGalleryPresentation({
  grid,
  fadeOverlay,
  showMoreButton,
  showMoreWrapper
} = {}) {
  if (grid) {
    grid.style.maxHeight = '';
    Array.from(grid.querySelectorAll('.project-card')).forEach(card => {
      card.style.opacity = '';
      card.style.display = '';
    });
  }

  fadeOverlay?.classList.add('is-hidden');

  if (showMoreWrapper) {
    showMoreWrapper.style.display = '';
    showMoreWrapper.classList.remove('expanded');
  }

  showMoreButton?.classList.remove('expanded');
}
