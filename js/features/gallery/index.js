/**
 * Architecture V2 — gallery controller.
 * Owns filtering/state and exposes the public gallery contract.
 */
import { createLifecycle } from '../../core/lifecycle.js';
import {
  getResponsiveBaseCount,
  getRowAlignedCount,
  applyGalleryReveal,
  resetGalleryPresentation
} from './presentation.js?v=20261004-20';
export async function initGallery(options = {}) {
  const documentRef = options.root?.getElementById ? options.root : globalThis.document;
  const windowRef = documentRef?.defaultView || globalThis.window;
  if (!documentRef || !windowRef) return null;

  const filterTabs = documentRef.querySelector('.filter-tabs');
  const getProjects = typeof options.getProjects === 'function' ? options.getProjects : () => [];
  const getCardForProject = typeof options.getCardForProject === 'function' ? options.getCardForProject : () => null;
  const showMoreBtn = documentRef.getElementById('showMoreBtn');
  const showMoreWrapper = documentRef.getElementById('showMoreWrapper');
  const portfolioGrid = documentRef.getElementById('portfolioGrid');
  const portfolioGridViewport = documentRef.getElementById('portfolioGridViewport');
  const gridFadeOverlay = documentRef.getElementById('gridFadeOverlay');
  if (!portfolioGrid) return;
  portfolioGrid.dataset.component = 'project-gallery';
  filterTabs?.setAttribute('data-component', 'project-filters');

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

      const fragment = documentRef.createDocumentFragment();

      const allButton = documentRef.createElement('button');
      allButton.type = 'button';
      allButton.className = 'tab-btn filter-btn active';
      allButton.dataset.filter = 'all';
      allButton.textContent = 'ALL';
      fragment.appendChild(allButton);

      list.forEach(filter => {
        if (!filter || !filter.id || String(filter.id).toLowerCase() === 'all') return;
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.className = 'tab-btn filter-btn';
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

  const getProjectSnapshot = () => getProjects().filter(project => project && project.id);
  const getCardSnapshot = projects => projects.map(project => getCardForProject(project.id)).filter(Boolean);

  const initialProjects = getProjectSnapshot();
  const initialCards = getCardSnapshot(initialProjects);
  if (initialProjects.length === 0 || initialCards.length === 0) return;
  const filterBtns = Array.from(documentRef.querySelectorAll('.filter-tabs .filter-btn, .filter-tabs .tab-btn'));

  const phoneCount = Number.isFinite(options.phoneCount) ? options.phoneCount : 6;
  const tabletShortCount = Number.isFinite(options.tabletShortCount) ? options.tabletShortCount : 4;
  const tabletTallCount = Number.isFinite(options.tabletTallCount) ? options.tabletTallCount : 6;
  const desktopCount = Number.isFinite(options.desktopCount) ? options.desktopCount : 9;
  const phoneBreakpoint = Number.isFinite(options.phoneBreakpoint) ? options.phoneBreakpoint : 768;
  const tabletBreakpoint = Number.isFinite(options.tabletBreakpoint) ? options.tabletBreakpoint : 1100;
  const fadeMs = Number.isFinite(options.fadeMs) ? options.fadeMs : 300;
  let currentFilter = 'all';
  let isExpanded = false;
  let filterPager = null;
  let filterPageDots = [];
  let filterScrollTimer = null;
  let filterSettleTimer = null;
  let filterScrollFrame = null;
  let filterDrag = null;
  let filterPointerActive = false;
  let filterSettling = false;
  let suppressFilterClickUntil = 0;

  // Gallery owns persistent listeners and timers through one lifecycle.
  // Short-lived pagination nodes disappear with the pager rather than
  // accumulating separate global teardown paths.
  const lifecycle = createLifecycle();
  const bind = (target, type, handler, listenerOptions) =>
    lifecycle.listen(target, type, handler, listenerOptions);
  let renderToken = 0;
  let cancelReveal = null;
  lifecycle.add(() => cancelReveal?.());

  function getBaseCount() {
    return getResponsiveBaseCount({
      width: windowRef.innerWidth,
      height: windowRef.innerHeight,
      total: getCardSnapshot(getProjectSnapshot()).length,
      phoneCount,
      tabletShortCount,
      tabletTallCount,
      desktopCount,
      phoneBreakpoint,
      tabletBreakpoint
    });
  }

  function ensureFilterPager() {
    if (!filterTabs || filterPager) return;
    filterPager = documentRef.createElement('div');
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

    const leading = documentRef.createElement('span');
    leading.className = 'filter-edge-spacer';
    leading.setAttribute('aria-hidden', 'true');
    leading.style.width = `${firstSpace}px`;

    const trailing = documentRef.createElement('span');
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
    return windowRef.innerWidth < 768;
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

    // Only a real filter change starts a new result set. Centering the
    // currently selected button during resize/scroll settling must not reset
    // the user's Show More state.
    if (changed) {
      isExpanded = false;
      render();
    }
    if (center && isFilterCarousel()) centerFilterButton(button);
    updateFilterPager(filterBtns.indexOf(button));

    if (updateUrl && changed) {
      history.replaceState(
        null,
        '',
        windowRef.location.pathname +
          windowRef.location.search +
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
    windowRef.clearTimeout(filterSettleTimer);
    activateFilterButton(nearest, { center: false, updateUrl: true });
    updateFilterPager(filterBtns.indexOf(nearest));

    if (center) {
      centerFilterButton(nearest, 'smooth');
      filterSettleTimer = windowRef.setTimeout(() => {
        filterSettling = false;
      }, 450);
    } else {
      filterSettling = false;
    }
  }

  function scheduleCenteredFilter() {
    if (!filterTabs || !isFilterCarousel() || filterPointerActive || filterSettling) return;
    windowRef.clearTimeout(filterScrollTimer);
    filterScrollTimer = windowRef.setTimeout(() => settleCenteredFilter(), 140);
  }

  function buildFilterPager() {
    if (!filterTabs) return;
    ensureFilterPager();

    const buttons = getFilterButtons();
    filterPager.innerHTML = '';
    filterPageDots = buttons.map((button, index) => {
      const dot = documentRef.createElement('button');
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
  function projectMatchesFilter(project, filter) {
    if (filter === 'all') return true;
    return Array.isArray(project?.filters) && project.filters.includes(filter);
  }

  function getFilteredProjects() {
    return getProjectSnapshot().filter(project => projectMatchesFilter(project, currentFilter));
  }

  function getCardsForProjects(projects) {
    return projects.map(project => getCardForProject(project.id)).filter(Boolean);
  }

  function getEffectiveBaseCount(filtered) {
    return getRowAlignedCount(filtered, getBaseCount(), windowRef, portfolioGrid);
  }

  function render() {
    const filteredProjects = getFilteredProjects();
    const filtered = getCardsForProjects(filteredProjects);
    renderToken += 1;
    const token = renderToken;

    // Cards from the previous filter can still be display:none while their
    // opacity fade is finishing. Make the incoming set participate in layout
    // before measuring row alignment; presentation.js still owns opacity and
    // final hiding.
    filtered.forEach(card => { card.style.display = 'block'; });

    const effectiveBaseCount = getEffectiveBaseCount(filtered);

    cancelReveal?.();
    cancelReveal = applyGalleryReveal({
      grid: portfolioGrid,
      gridViewport: portfolioGridViewport,
      fadeOverlay: gridFadeOverlay,
      showMoreButton: showMoreBtn,
      showMoreWrapper,
      filteredCards: filtered,
      visibleCount: effectiveBaseCount,
      expanded: isExpanded,
      windowRef,
      fadeMs,
      renderToken: token,
      isCurrentRender: value => value === renderToken
    });
  }


  filterBtns.forEach(btn => bind(btn, 'click', event => {
    if (Date.now() < suppressFilterClickUntil) {
      event.preventDefault();
      return;
    }
    activateFilterButton(btn, { center: true, updateUrl: true });
  }));

  bind(showMoreBtn, 'click', event => {
    event.preventDefault();
    const nextExpanded = !isExpanded;
    isExpanded = nextExpanded;
    render();

    // Keep the button's semantic state synchronized immediately. The visual
    // reveal may animate, but its state must never depend on a later scroll,
    // resize, or media-load callback.
    showMoreBtn?.setAttribute('aria-expanded', String(isExpanded));
    showMoreWrapper?.setAttribute('data-expanded', String(isExpanded));

    // Collapsing the gallery does not scroll the document. Keeping the
    // visitor's current position avoids a background smooth-scroll animation
    // competing with Lightbox, resize, or subsequent gallery interaction.
  });

  let resizeTimer = null;
  lifecycle.add(() => windowRef.clearTimeout(resizeTimer));
  bind(windowRef, 'resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = windowRef.setTimeout(() => {
      ensureFilterEdges();
      const activeBtn = filterBtns.find(button => (button.getAttribute('data-filter') || 'all') === currentFilter);
      if (activeBtn && isFilterCarousel()) centerFilterButton(activeBtn, 'auto');
      updateFilterPager(filterBtns.indexOf(activeBtn));
      // Re-render at breakpoint changes because card orientation and the
      // collapsed viewport measurement depend on the current width. The
      // user's expansion state itself is never changed by resize.
      render();
    }, 120);
  });

  bind(filterTabs, 'scroll', () => {
    if (!isFilterCarousel()) return;
    if (filterScrollFrame) return;
    filterScrollFrame = windowRef.requestAnimationFrame(() => {
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
      windowRef.clearTimeout(filterSettleTimer);
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

  // A touch can begin on the filter rail and finish outside it. Keep the
  // cleanup listener on the window so pointer state cannot remain stuck after
  // a swipe exits the tab strip.
  bind(windowRef, 'pointerup', finishFilterPointer);
  bind(windowRef, 'pointercancel', finishFilterPointer);

  function applyHash() {
    const hash = decodeURIComponent(windowRef.location.hash.replace('#', ''));
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

  lifecycle.add(() => windowRef.clearTimeout(filterScrollTimer));
  lifecycle.add(() => windowRef.clearTimeout(filterSettleTimer));
  lifecycle.add(() => windowRef.cancelAnimationFrame?.(filterScrollFrame));

  // Re-entry through browser back/forward can restore the page with a stale
  // collapsed gallery measurement. Rebuild the collapsed presentation from
  // the current viewport and card geometry instead of trusting the restored
  // max-height/state from the previous page instance.
  bind(windowRef, 'pageshow', () => {
    // BFCache restoration should reconstruct geometry without inventing a new
    // interaction state. The viewport is temporarily released before render()
    // so its fresh measurement is based on the current card geometry.
    if (portfolioGridViewport) portfolioGridViewport.style.maxHeight = 'none';
    render();
  });

  buildFilterPager();
  showMoreBtn?.setAttribute('aria-expanded', 'false');
  showMoreWrapper?.setAttribute('data-expanded', 'false');
  render();
  applyHash();
  ensureFilterEdges();
  lifecycle.animationFrame(() => {
    const activeBtn = filterBtns.find(button => (button.getAttribute('data-filter') || 'all') === currentFilter);
    if (activeBtn && isFilterCarousel()) centerFilterButton(activeBtn, 'auto');
    updateFilterPager(filterBtns.indexOf(activeBtn));
  }, windowRef);
  bind(windowRef, 'hashchange', applyHash);
  bind(windowRef, 'load', () => { ensureFilterEdges(); if (!isExpanded) render(); });
  return {
    render,
    getFilter: () => currentFilter,
    getAllCards: () => getCardSnapshot(getProjectSnapshot()).slice(),
    getActiveCards: () => getCardsForProjects(getFilteredProjects()).slice(),
    destroy() {
      renderToken += 1;
      lifecycle.cleanup();
      filterDrag = null;
      filterPointerActive = false;
      filterSettling = false;
      filterPager?.remove();
      filterPager = null;
      filterPageDots = [];
      filterTabs?.querySelectorAll('.filter-edge-spacer').forEach(el => el.remove());
      resetGalleryPresentation({
        grid: portfolioGrid,
        gridViewport: portfolioGridViewport,
        fadeOverlay: gridFadeOverlay,
        showMoreButton: showMoreBtn,
        showMoreWrapper
      });
    }
  };
}
