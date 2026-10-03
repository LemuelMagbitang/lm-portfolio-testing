/**
 * Architecture V2 — gallery controller.
 * Owns filtering, reveal/collapse behavior, deep links and responsive sizing.
 */
export async function initGallery(options = {}) {
  const filterTabs = document.querySelector('.filter-tabs');
  const showMoreBtn = document.getElementById('showMoreBtn');
  const showMoreWrapper = document.getElementById('showMoreWrapper');
  const portfolioGrid = document.getElementById('portfolioGrid');
  const gridFadeOverlay = document.getElementById('gridFadeOverlay');
  if (!portfolioGrid) return;

  async function loadFilterButtons() {
    if (!filterTabs || !options.filterUrl || typeof options.loadJson !== 'function') return;

    try {
      const raw = await options.loadJson(options.filterUrl, null, {
        resolveUrl: options.resolveAssetUrl
      });
      const list = Array.isArray(raw)
        ? raw
        : (Array.isArray(raw?.filters) ? raw.filters : []);

      if (!list.length) return;

      const fragment = document.createDocumentFragment();
      list.forEach(filter => {
        if (!filter || !filter.id) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'filter-btn';
        button.dataset.filter = String(filter.id);
        button.textContent = filter.label || filter.name || filter.id;
        fragment.appendChild(button);
      });
      filterTabs.replaceChildren(fragment);
    } catch (error) {
      console.warn('Filters: could not load', options.filterUrl, error);
    }
  }

  await loadFilterButtons();

  const allCards = Array.from(document.querySelectorAll('.project-card'));
  if (allCards.length === 0) return;
  const filterBtns = Array.from(document.querySelectorAll('.filter-tabs .filter-btn, .filter-tabs .tab-btn'));

  const mobileCount = Number.isFinite(options.mobileCount) ? options.mobileCount : 5;
  const desktopCount = Number.isFinite(options.desktopCount) ? options.desktopCount : 9;
  const fadeMs = Number.isFinite(options.fadeMs) ? options.fadeMs : 300;
  let currentFilter = 'all';
  let isExpanded = false;
  let baseCount = getBaseCount();
  let filterPager = null;
  let filterPageDots = [];
  let filterScrollTimer = null;
  let filterSettleTimer = null;
  let filterScrollFrame = null;
  let filterDrag = null;
  let filterPointerActive = false;
  let filterSettling = false;
  let suppressFilterClickUntil = 0;

  // Gallery owns these persistent listeners and removes them on destroy().
  // The generated pagination-dot listeners are attached to short-lived dot
  // nodes and disappear with the nodes when the pager is rebuilt.
  const listenerCleanups = [];
  const bind = (target, type, handler, listenerOptions) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler, listenerOptions);
    listenerCleanups.push(() => target.removeEventListener(type, handler, listenerOptions));
  };

  function getBaseCount() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Keep the visible gallery density proportional to the device:
    // phones show two cards (two rows in the one-column layout);
    // tablets use two columns and choose two or three rows based on
    // available vertical space; desktop stays at three rows.
    if (width < 768) return Math.min(2, allCards.length);
    if (width < 1100) return Math.min(height < 820 ? 4 : 6, allCards.length);
    return Math.min(9, allCards.length);
  }

  function ensureFilterPager() {
    if (!filterTabs || filterPager) return;
    filterPager = document.createElement('div');
    filterPager.className = 'filter-page-controls';
    filterPager.setAttribute('aria-label', 'Filter navigation');
    filterTabs.insertAdjacentElement('afterend', filterPager);
  }

  function ensureFilterEdges() {
    if (!filterTabs) return;
    const current = Array.from(filterTabs.querySelectorAll('.filter-edge-spacer'));
    current.forEach(el => el.remove());

    const buttons = Array.from(filterTabs.querySelectorAll('.filter-btn, .tab-btn'));
    if (!buttons.length) return;

    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const firstSpace = Math.max(0, (filterTabs.clientWidth - first.getBoundingClientRect().width) / 2);
    const lastSpace = Math.max(0, (filterTabs.clientWidth - last.getBoundingClientRect().width) / 2);

    const leading = document.createElement('span');
    leading.className = 'filter-edge-spacer';
    leading.setAttribute('aria-hidden', 'true');
    leading.style.width = `${firstSpace}px`;

    const trailing = document.createElement('span');
    trailing.className = 'filter-edge-spacer';
    trailing.setAttribute('aria-hidden', 'true');
    trailing.style.width = `${lastSpace}px`;

    filterTabs.prepend(leading);
    filterTabs.append(trailing);
  }

  function getFilterButtons() {
    return filterTabs ? Array.from(filterTabs.querySelectorAll('.filter-btn, .tab-btn')) : [];
  }

  function getNearestCenteredFilterIndex() {
    const buttons = getFilterButtons();
    if (!buttons.length || !filterTabs) return 0;
    const center = filterTabs.getBoundingClientRect().left + filterTabs.clientWidth / 2;
    let nearestIndex = 0;
    let nearestDistance = Infinity;

    buttons.forEach((button, index) => {
      const rect = button.getBoundingClientRect();
      const distance = Math.abs((rect.left + rect.width / 2) - center);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    return nearestIndex;
  }

  function updateFilterPager(activeIndex = getNearestCenteredFilterIndex()) {
    if (!filterPager) return;
    const dots = filterPageDots;
    if (!dots.length) {
      filterPager.hidden = true;
      return;
    }
    filterPager.hidden = dots.length <= 1 || !isFilterCarousel();
    dots.forEach((dot, index) => {
      const active = index === activeIndex;
      dot.classList.toggle('active', active);
      if (active) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  }

  function isFilterCarousel() {
    return window.innerWidth < 768;
  }

  function centerFilterButton(button, behavior = 'smooth') {
    if (!filterTabs || !button || !isFilterCarousel()) return;
    const tabsRect = filterTabs.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const delta = (buttonRect.left + buttonRect.width / 2) -
      (tabsRect.left + tabsRect.width / 2);
    if (Math.abs(delta) < 1) return;
    filterTabs.scrollTo({
      left: filterTabs.scrollLeft + delta,
      behavior
    });
  }

  function activateFilterButton(button, { center = false, updateUrl = true } = {}) {
    if (!button) return;
    const nextFilter = button.getAttribute('data-filter') || 'all';
    const changed = currentFilter !== nextFilter;

    filterBtns.forEach(item => item.classList.toggle('active', item === button));
    currentFilter = nextFilter;
    isExpanded = false;

    if (changed) render();
    if (center && isFilterCarousel()) centerFilterButton(button);
    updateFilterPager(filterBtns.indexOf(button));

    if (updateUrl && changed) {
      history.replaceState(
        null,
        '',
        window.location.pathname +
          window.location.search +
          (currentFilter === 'all' ? '' : `#${currentFilter}`)
      );
    }
  }

  function settleCenteredFilter({ center = true } = {}) {
    if (!filterTabs || !isFilterCarousel() || filterSettling) return;
    const buttons = getFilterButtons();
    if (!buttons.length) return;

    const nearest = buttons[getNearestCenteredFilterIndex()];
    if (!nearest) return;

    filterSettling = true;
    window.clearTimeout(filterSettleTimer);
    activateFilterButton(nearest, { center: false, updateUrl: true });
    updateFilterPager(filterBtns.indexOf(nearest));

    if (center) {
      centerFilterButton(nearest, 'smooth');
      filterSettleTimer = window.setTimeout(() => {
        filterSettling = false;
      }, 450);
    } else {
      filterSettling = false;
    }
  }

  function scheduleCenteredFilter() {
    if (!filterTabs || !isFilterCarousel() || filterPointerActive || filterSettling) return;
    window.clearTimeout(filterScrollTimer);
    filterScrollTimer = window.setTimeout(() => settleCenteredFilter(), 140);
  }

  function buildFilterPager() {
    if (!filterTabs) return;
    ensureFilterPager();

    const buttons = getFilterButtons();
    filterPager.innerHTML = '';
    filterPageDots = buttons.map((button, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'filter-page-dot';
      dot.setAttribute('aria-label', `Show filter ${button.textContent.trim() || index + 1}`);
      dot.addEventListener('click', () => {
        button.click();
      });
      filterPager.appendChild(dot);
      return dot;
    });

    ensureFilterEdges();
    const activeIndex = Math.max(0, buttons.findIndex(button => (button.getAttribute('data-filter') || 'all') === currentFilter));
    if (buttons[activeIndex] && isFilterCarousel()) centerFilterButton(buttons[activeIndex], 'auto');
    updateFilterPager(activeIndex >= 0 ? activeIndex : 0);
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
      if (currentFilter !== 'all' && !cardMatchesFilter(card, currentFilter)) card.style.display = 'none';
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

  filterBtns.forEach(btn => bind(btn, 'click', event => {
    if (Date.now() < suppressFilterClickUntil) {
      event.preventDefault();
      return;
    }
    activateFilterButton(btn, { center: true, updateUrl: true });
  }));

  bind(showMoreBtn, 'click', () => {
    isExpanded = !isExpanded;
    render();
    if (!isExpanded) document.querySelector('.filter-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  let resizeTimer;
  bind(window, 'resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      baseCount = getBaseCount();
      ensureFilterEdges();
      const activeBtn = filterBtns.find(button => (button.getAttribute('data-filter') || 'all') === currentFilter);
      if (activeBtn && isFilterCarousel()) centerFilterButton(activeBtn, 'auto');
      updateFilterPager(filterBtns.indexOf(activeBtn));
      if (!isExpanded) render();
    }, 120);
  });

  bind(filterTabs, 'scroll', () => {
    if (!isFilterCarousel()) return;
    if (filterScrollFrame) return;
    filterScrollFrame = window.requestAnimationFrame(() => {
      filterScrollFrame = null;
      updateFilterPager();
      scheduleCenteredFilter();
    });
  }, { passive: true });

  bind(filterTabs, 'scrollend', () => {
    if (!isFilterCarousel()) return;
    if (filterPointerActive) return;
    if (filterSettling) {
      filterSettling = false;
      window.clearTimeout(filterSettleTimer);
      return;
    }
    settleCenteredFilter();
  }, { passive: true });

  /* Small-screen touch, wheel/trackpad and primary-button mouse dragging
     all share the same settling rule. The centered filter is selected only
     after the user's movement ends, so the interface never fights an
     in-progress swipe or drag. */
  bind(filterTabs, 'pointerdown', event => {
    if (!isFilterCarousel()) return;
    filterPointerActive = true;

    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    filterDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: filterTabs.scrollLeft,
      moved: false
    };
  });

  bind(filterTabs, 'pointermove', event => {
    if (!filterDrag || event.pointerId !== filterDrag.pointerId) return;
    const distance = event.clientX - filterDrag.startX;
    if (Math.abs(distance) > 4) {
      filterDrag.moved = true;
      filterTabs.classList.add('is-dragging');
      filterTabs.setPointerCapture?.(event.pointerId);
    }
    if (!filterDrag.moved) return;

    event.preventDefault();
    filterTabs.scrollLeft = filterDrag.startScrollLeft - distance;
  });

  function finishFilterPointer(event) {
    if (event && filterDrag && event.pointerId !== filterDrag.pointerId) return;

    const dragged = !!filterDrag?.moved;
    const pointerId = filterDrag?.pointerId;

    if (filterDrag) {
      filterDrag = null;
      filterTabs.classList.remove('is-dragging');
      try { filterTabs.releasePointerCapture?.(pointerId); } catch (e) {}
    }

    filterPointerActive = false;

    if (dragged) {
      suppressFilterClickUntil = Date.now() + 250;
      settleCenteredFilter();
    } else if (event?.pointerType !== 'mouse') {
      scheduleCenteredFilter();
    }
  }

  bind(filterTabs, 'pointerup', finishFilterPointer);
  bind(filterTabs, 'pointercancel', finishFilterPointer);

  function applyHash() {
    const hash = decodeURIComponent(window.location.hash.replace('#', ''));
    if (!hash) return;
    const btn = filterBtns.find(item => item.getAttribute('data-filter') === hash);
    if (!btn) return;
    filterBtns.forEach(item => item.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = hash;
    isExpanded = false;
    render();
    if (isFilterCarousel()) centerFilterButton(btn, 'auto');
    updateFilterPager(filterBtns.indexOf(btn));
  }

  buildFilterPager();
  render();
  applyHash();
  ensureFilterEdges();
  window.requestAnimationFrame(() => {
    const activeBtn = filterBtns.find(button => (button.getAttribute('data-filter') || 'all') === currentFilter);
    if (activeBtn && isFilterCarousel()) centerFilterButton(activeBtn, 'auto');
    updateFilterPager(filterBtns.indexOf(activeBtn));
  });
  bind(window, 'hashchange', applyHash);
  bind(window, 'load', () => { baseCount = getBaseCount(); ensureFilterEdges(); if (!isExpanded) render(); });
  return {
    render,
    getFilter: () => currentFilter,
    getAllCards: () => allCards.slice(),
    getActiveCards: () => allCards.filter(card => cardMatchesFilter(card, currentFilter)).slice(),
    destroy() {
      window.clearTimeout(filterScrollTimer);
      window.clearTimeout(filterSettleTimer);
      window.cancelAnimationFrame?.(filterScrollFrame);
      window.clearTimeout(resizeTimer);
      listenerCleanups.splice(0).forEach(cleanup => {
        try { cleanup(); } catch (_) {}
      });
      filterDrag = null;
      filterPointerActive = false;
      filterSettling = false;
      filterPager?.remove();
      filterPager = null;
      filterPageDots = [];
      filterTabs?.querySelectorAll('.filter-edge-spacer').forEach(el => el.remove());
      if (portfolioGrid) portfolioGrid.style.maxHeight = '';
      gridFadeOverlay?.classList.add('is-hidden');
    }
  };
}
