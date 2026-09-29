/**
 * Architecture V2 — gallery controller.
 * Owns filtering, reveal/collapse behavior, deep links and responsive sizing.
 */
export function initGallery(options = {}) {
  const filterTabs = document.querySelector('.filter-tabs');
  const filterBtns = document.querySelectorAll('.tab-btn');
  const allCards = Array.from(document.querySelectorAll('.project-card'));
  const showMoreBtn = document.getElementById('showMoreBtn');
  const showMoreWrapper = document.getElementById('showMoreWrapper');
  const portfolioGrid = document.getElementById('portfolioGrid');
  const gridFadeOverlay = document.getElementById('gridFadeOverlay');
  if (!portfolioGrid || allCards.length === 0) return;

  const mobileCount = Number.isFinite(options.mobileCount) ? options.mobileCount : 5;
  const desktopCount = Number.isFinite(options.desktopCount) ? options.desktopCount : 9;
  const fadeMs = Number.isFinite(options.fadeMs) ? options.fadeMs : 300;
  let currentFilter = 'all';
  let isExpanded = false;
  let baseCount = getBaseCount();
  let filterPager = null;
  let filterPageDots = [];

  function getBaseCount() { return window.innerWidth < 768 ? mobileCount : desktopCount; }

  function ensureFilterPager() {
    if (!filterTabs || filterPager) return;
    filterPager = document.createElement('div');
    filterPager.className = 'filter-page-controls';
    filterPager.setAttribute('aria-label', 'Filter pages');
    filterPager.hidden = true;
    filterTabs.insertAdjacentElement('afterend', filterPager);
  }

  function updateFilterPager() {
    if (!filterTabs || !filterPager) return;
    const overflow = filterTabs.scrollWidth > filterTabs.clientWidth + 4;
    if (!overflow) {
      filterPager.hidden = true;
      filterPageDots = [];
      filterPager.innerHTML = '';
      return;
    }

    const pages = Math.max(2, Math.ceil(filterTabs.scrollWidth / filterTabs.clientWidth));
    if (filterPageDots.length !== pages) {
      filterPager.innerHTML = '';
      filterPageDots = Array.from({ length: pages }, (_, index) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'filter-page-dot';
        dot.setAttribute('aria-label', `Show filter page ${index + 1}`);
        dot.addEventListener('click', () => {
          const maxScroll = Math.max(0, filterTabs.scrollWidth - filterTabs.clientWidth);
          const left = Math.min(maxScroll, index * filterTabs.clientWidth);
          filterTabs.scrollTo({ left, behavior: 'smooth' });
        });
        filterPager.appendChild(dot);
        return dot;
      });
    }

    const maxScroll = Math.max(1, filterTabs.scrollWidth - filterTabs.clientWidth);
    const page = Math.min(pages - 1, Math.round(filterTabs.scrollLeft / Math.max(1, filterTabs.clientWidth)));
    const normalizedPage = Math.min(pages - 1, Math.round((filterTabs.scrollLeft / maxScroll) * (pages - 1)));
    const activePage = filterTabs.scrollLeft <= 1 ? page : normalizedPage;

    filterPager.hidden = false;
    filterPageDots.forEach((dot, index) => {
      const active = index === activePage;
      dot.classList.toggle('active', active);
      dot.setAttribute('aria-current', active ? 'true' : 'false');
    });
  }

  function cardMatchesFilter(card, filter) {
    if (filter === 'all') return true;
    const raw = card.dataset.filterIds;
    if (raw) {
      try {
        const ids = JSON.parse(raw);
        if (Array.isArray(ids)) return ids.includes(filter);
      } catch (e) {}
    }
    return card.classList.contains(filter);
  }

  function getEffectiveBaseCount(filtered) {
    const requested = getBaseCount();
    if (filtered.length <= requested || window.innerWidth < 768) return Math.min(requested, filtered.length);
    const firstTop = filtered[0]?.getBoundingClientRect().top;
    let columns = 1;
    if (Number.isFinite(firstTop)) {
      let count = 0;
      for (const card of filtered) {
        if (Math.abs(card.getBoundingClientRect().top - firstTop) <= 2) count++;
        else break;
      }
      columns = Math.max(1, count);
    }
    const rowAlignedCount = Math.ceil(requested / columns) * columns;
    return Math.min(rowAlignedCount, filtered.length);
  }

  function render() {
    const filtered = allCards.filter(card => cardMatchesFilter(card, currentFilter));
    const hidden = allCards.filter(card => !filtered.includes(card));
    hidden.forEach(card => { card.style.opacity = '0'; });
    window.setTimeout(() => hidden.forEach(card => {
      if (currentFilter !== 'all' && !card.classList.contains(currentFilter)) card.style.display = 'none';
    }), fadeMs);
    filtered.forEach(card => { card.style.display = 'block'; });
    window.requestAnimationFrame(() => filtered.forEach(card => { card.style.opacity = '1'; }));
    const effectiveBaseCount = getEffectiveBaseCount(filtered);

    if (!isExpanded && filtered.length > effectiveBaseCount) {
      const gridRect = portfolioGrid.getBoundingClientRect();
      const cardRect = filtered[effectiveBaseCount - 1].getBoundingClientRect();
      const peek = window.innerWidth < 768 ? 40 : 70;
      portfolioGrid.style.maxHeight = `${Math.round(cardRect.bottom - gridRect.top + peek)}px`;
      gridFadeOverlay?.classList.remove('is-hidden');
    } else {
      portfolioGrid.style.maxHeight = 'none';
      gridFadeOverlay?.classList.add('is-hidden');
    }
    if (showMoreBtn && showMoreWrapper) {
      const label = showMoreBtn.querySelector('.btn-text');
      if (filtered.length > effectiveBaseCount) {
        showMoreWrapper.style.display = 'flex';
        showMoreWrapper.classList.toggle('expanded', isExpanded);
        showMoreBtn.classList.toggle('expanded', isExpanded);
        if (label) label.textContent = isExpanded ? 'SHOW LESS' : 'SHOW MORE';
      } else showMoreWrapper.style.display = 'none';
    }
  }

  filterBtns.forEach(btn => btn.addEventListener('click', () => {
    filterBtns.forEach(item => item.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.getAttribute('data-filter') || 'all';
    isExpanded = false;
    render();
    btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    history.replaceState(null, '', window.location.pathname + window.location.search + (currentFilter === 'all' ? '' : `#${currentFilter}`));
    window.requestAnimationFrame(updateFilterPager);
  }));

  showMoreBtn?.addEventListener('click', () => {
    isExpanded = !isExpanded;
    render();
    if (!isExpanded) document.querySelector('.filter-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      baseCount = getBaseCount();
      if (!isExpanded) render();
      updateFilterPager();
    }, 120);
  });

  filterTabs?.addEventListener('scroll', () => {
    window.requestAnimationFrame(updateFilterPager);
  }, { passive: true });

  function applyHash() {
    const hash = decodeURIComponent(window.location.hash.replace('#', ''));
    if (!hash) return;
    const btn = Array.from(filterBtns).find(item => item.getAttribute('data-filter') === hash);
    if (!btn) return;
    filterBtns.forEach(item => item.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = hash;
    isExpanded = false;
    render();
    btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    window.requestAnimationFrame(updateFilterPager);
  }

  ensureFilterPager();
  render();
  applyHash();
  window.requestAnimationFrame(updateFilterPager);
  window.addEventListener('hashchange', applyHash);
  window.addEventListener('load', () => { baseCount = getBaseCount(); if (!isExpanded) render(); });
  return {
    render,
    getFilter: () => currentFilter,
    getAllCards: () => allCards.slice(),
    getActiveCards: () => allCards.filter(card => cardMatchesFilter(card, currentFilter)).slice()
  };
}
