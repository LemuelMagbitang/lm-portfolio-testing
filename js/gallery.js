/**
 * Architecture V2 — gallery controller.
 * Owns filtering, reveal/collapse behavior, deep links and responsive sizing.
 */
export function initGallery(options = {}) {
  const filterTabs = document.querySelector('.filter-tabs');
  const filterBtns = Array.from(document.querySelectorAll('.tab-btn'));
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

  function getFilterPageSize() {
    return window.innerWidth < 768 ? 3 : 4;
  }

  function findFilterPageForButton(button) {
    if (!filterTabs || !button) return 0;
    const page = button.closest('.filter-page');
    return page ? Number(page.dataset.page || 0) : 0;
  }

  function ensureFilterPager() {
    if (!filterTabs || filterPager) return;
    filterPager = document.createElement('div');
    filterPager.className = 'filter-page-controls';
    filterPager.setAttribute('aria-label', 'Filter pages');
    filterTabs.insertAdjacentElement('afterend', filterPager);
  }

  function goToFilterPage(index, animate = true) {
    if (!filterTabs) return;
    const pages = Array.from(filterTabs.querySelectorAll('.filter-page'));
    if (!pages.length) return;

    const next = Math.max(0, Math.min(index, pages.length - 1));
    pages.forEach((page, pageIndex) => {
      const active = pageIndex === next;
      page.classList.toggle('is-active', active);
      page.hidden = !active;
      page.setAttribute('aria-hidden', String(!active));
    });

    filterPageDots.forEach((dot, dotIndex) => {
      const active = dotIndex === next;
      dot.classList.toggle('active', active);
      if (active) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });

    filterTabs.dataset.filterPage = String(next);
    if (animate) filterTabs.classList.add('is-page-changing');
    if (animate) window.setTimeout(() => filterTabs.classList.remove('is-page-changing'), 220);
  }

  function rebuildFilterPages(preferredFilter = currentFilter) {
    if (!filterTabs) return;
    ensureFilterPager();

    const buttons = Array.from(filterTabs.querySelectorAll(':scope > .tab-btn, :scope > button.tab-btn'));
    const nestedButtons = Array.from(filterTabs.querySelectorAll('.filter-page .tab-btn'));
    const sourceButtons = buttons.length ? buttons : nestedButtons;
    if (!sourceButtons.length) return;

    filterTabs.innerHTML = '';
    const pageSize = getFilterPageSize();
    const pages = [];

    for (let start = 0; start < sourceButtons.length; start += pageSize) {
      const page = document.createElement('div');
      page.className = 'filter-page';
      page.dataset.page = String(pages.length);
      page.setAttribute('role', 'group');
      page.hidden = true;
      page.setAttribute('aria-hidden', 'true');
      sourceButtons.slice(start, start + pageSize).forEach(button => page.appendChild(button));
      filterTabs.appendChild(page);
      pages.push(page);
    }

    filterPager.innerHTML = '';
    filterPageDots = pages.map((_, pageIndex) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'filter-page-dot';
      dot.setAttribute('aria-label', `Show filter page ${pageIndex + 1}`);
      dot.addEventListener('click', () => goToFilterPage(pageIndex));
      filterPager.appendChild(dot);
      return dot;
    });

    filterPager.hidden = pages.length <= 1;
    const preferredButton = sourceButtons.find(button => (button.getAttribute('data-filter') || 'all') === preferredFilter);
    const preferredPage = preferredButton
      ? Math.floor(sourceButtons.indexOf(preferredButton) / pageSize)
      : 0;
    goToFilterPage(preferredPage, false);
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
    goToFilterPage(findFilterPageForButton(btn));
    history.replaceState(null, '', window.location.pathname + window.location.search + (currentFilter === 'all' ? '' : `#${currentFilter}`));
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
      rebuildFilterPages(currentFilter);
      if (!isExpanded) render();
    }, 120);
  });

  function applyHash() {
    const hash = decodeURIComponent(window.location.hash.replace('#', ''));
    if (!hash) return;
    const btn = filterBtns.find(item => item.getAttribute('data-filter') === hash);
    if (!btn) return;
    filterBtns.forEach(item => item.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = hash;
    isExpanded = false;
    rebuildFilterPages(currentFilter);
    render();
    goToFilterPage(findFilterPageForButton(btn), false);
  }

  ensureFilterPager();
  rebuildFilterPages(currentFilter);
  render();
  applyHash();
  window.addEventListener('hashchange', applyHash);
  window.addEventListener('load', () => { baseCount = getBaseCount(); rebuildFilterPages(currentFilter); if (!isExpanded) render(); });
  return {
    render,
    getFilter: () => currentFilter,
    getAllCards: () => allCards.slice(),
    getActiveCards: () => allCards.filter(card => cardMatchesFilter(card, currentFilter)).slice()
  };
}
