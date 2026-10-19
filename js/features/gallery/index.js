/**
 * Architecture V2 — gallery controller.
 * Owns filtering/state and exposes the public gallery contract.
 */
import { createLifecycle } from '../../core/lifecycle.js';
import {
  getResponsiveBaseCount,
  getRowAlignedCount,
  applyGalleryReveal,
  resetGalleryPresentation,
  captureGalleryCardRects
} from './presentation.js?v=20261006-03';
export async function initGallery(options = {}) {
  const documentRef = options.root?.getElementById ? options.root : globalThis.document;
  const windowRef = documentRef?.defaultView || globalThis.window;
  if (!documentRef || !windowRef) return null;

  const filterTabs = documentRef.querySelector('.filter-tabs');
  const filterContent = filterTabs?.querySelector('.filter-nav-content') || filterTabs;
  const getProjects = typeof options.getProjects === 'function' ? options.getProjects : () => [];
  const getCardForProject = typeof options.getCardForProject === 'function' ? options.getCardForProject : () => null;
  const showMoreBtn = documentRef.getElementById('showMoreBtn');
  const showMoreWrapper = documentRef.getElementById('showMoreWrapper');
  const portfolioGrid = documentRef.getElementById('portfolioGrid');
  const portfolioWrapper = documentRef.querySelector('.portfolio-wrapper');
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
      const hasFilterCollection =
        Array.isArray(raw) ||
        Array.isArray(raw?.filters);

      // An explicitly supplied empty filter collection is valid CMS state.
      // Render the built-in ALL state rather than preserving stale/static
      // filter buttons from an older content snapshot.
      if (!hasFilterCollection) return;

      const list = Array.isArray(raw) ? raw : raw.filters;
      const availableProjects = getProjects().filter(project => project && project.id);
      const fragment = documentRef.createDocumentFragment();

      const allButton = documentRef.createElement('button');
      allButton.type = 'button';
      allButton.className = 'tab-btn filter-btn active';
      allButton.dataset.filter = 'all';
      allButton.setAttribute('aria-pressed', 'true');
      allButton.textContent = 'ALL';
      fragment.appendChild(allButton);

      list.forEach(filter => {
        if (!filter || !filter.id || String(filter.id).toLowerCase() === 'all') return;
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.className = 'tab-btn filter-btn';
        button.dataset.filter = String(filter.id);
        button.setAttribute('aria-pressed', 'false');
        button.textContent = filter.label || filter.name || filter.id;
        button.disabled = !availableProjects.some(project =>
          Array.isArray(project.filters) && project.filters.includes(button.dataset.filter)
        );
        if (button.disabled) {
          button.setAttribute('aria-label', button.textContent.trim() + ' — no projects currently available');
        }
        fragment.appendChild(button);
      });

      filterContent.replaceChildren(fragment);
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
  const filterNavWrapper = filterTabs?.closest('.filter-nav-wrapper');
  let filterAnnouncement = null;
  if (filterNavWrapper) {
    filterAnnouncement = documentRef.createElement('p');
    filterAnnouncement.className = 'filter-announcement';
    filterAnnouncement.setAttribute('role', 'status');
    filterAnnouncement.setAttribute('aria-live', 'polite');
    filterAnnouncement.setAttribute('aria-atomic', 'true');
    filterNavWrapper.insertAdjacentElement('afterend', filterAnnouncement);
  }

  const phoneCount = Number.isFinite(options.phoneCount) ? options.phoneCount : 6;
  const tabletShortCount = Number.isFinite(options.tabletShortCount) ? options.tabletShortCount : 4;
  const tabletTallCount = Number.isFinite(options.tabletTallCount) ? options.tabletTallCount : 6;
  const desktopCount = Number.isFinite(options.desktopCount) ? options.desktopCount : 9;
  const phoneBreakpoint = Number.isFinite(options.phoneBreakpoint) ? options.phoneBreakpoint : 768;
  const tabletBreakpoint = Number.isFinite(options.tabletBreakpoint) ? options.tabletBreakpoint : 1100;
  const fadeMs = Number.isFinite(options.fadeMs) ? options.fadeMs : 300;
  let currentFilter = 'all';
  let lastCenteredFilterId = null;
  let isExpanded = false;
  let filterPager = null;
  let filterPageDots = [];
  let filterScrollTimer = null;
  let filterSettleTimer = null;
  let filterScrollFrame = null;
  let filterDrag = null;
  let filterPointerActive = false;
  let filterInertiaFrame = null;
  let filterActiveIndicator = null;
  let filterSettling = false;
  let galleryDestroyed = false;
  let suppressFilterClickUntil = 0;
  // Centering the active filter after a viewport resize emits scroll events.
  // Those programmatic scrolls must not be mistaken for a user selecting a new
  // filter, because a filter change intentionally collapses Show More.
  let suppressFilterSettleUntil = 0;
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
    if (!filterTabs || !filterContent) return;

    // Edge cushions are useful only when labels need horizontal scrolling.
    // If the entire row fits, keep it centered without creating fake overflow.
    filterTabs.querySelectorAll('.filter-edge-spacer').forEach(el => el.remove());

    const buttons = Array.from(filterTabs.querySelectorAll('.filter-btn, .tab-btn'));
    if (!buttons.length || filterTabs.clientWidth <= 0) {
      filterTabs.dataset.overflow = 'false';
      return;
    }

    const contentStyle = windowRef.getComputedStyle?.(filterContent);
    const columnGap = Number.parseFloat(contentStyle?.columnGap || contentStyle?.gap || '0') || 0;
    const pillsWidth = buttons.reduce((total, button) => total + button.getBoundingClientRect().width, 0);
    const naturalWidth = pillsWidth + columnGap * Math.max(0, buttons.length - 1);
    const needsScroller = naturalWidth > filterTabs.clientWidth + 1;
    filterTabs.dataset.overflow = needsScroller ? 'true' : 'false';
    if (!needsScroller) return;

    // The outer gap around each spacer is part of the flex gap, so subtract it
    // from the cushion size. This aligns the visible pill center with the rail.
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const firstSpace = Math.max(
      0,
      (filterTabs.clientWidth - first.getBoundingClientRect().width) / 2 - columnGap
    );
    const lastSpace = Math.max(
      0,
      (filterTabs.clientWidth - last.getBoundingClientRect().width) / 2 - columnGap
    );

    const leading = documentRef.createElement('span');
    leading.className = 'filter-edge-spacer';
    leading.setAttribute('aria-hidden', 'true');
    leading.style.width = `${firstSpace}px`;

    const trailing = documentRef.createElement('span');
    trailing.className = 'filter-edge-spacer';
    trailing.setAttribute('aria-hidden', 'true');
    trailing.style.width = `${lastSpace}px`;

    filterContent.prepend(leading);
    filterContent.append(trailing);
  }

  function getFilterButtons() {
    return filterTabs ? Array.from(filterTabs.querySelectorAll('.filter-btn, .tab-btn')) : [];
  }

  function getFilterIndicatorHost() {
    return filterTabs?.closest('.filter-nav-viewport') || filterTabs;
  }

  function ensureFilterActiveIndicator() {
    const host = getFilterIndicatorHost();
    if (!host) return null;
    if (!filterActiveIndicator || filterActiveIndicator.parentElement !== host) {
      filterActiveIndicator = documentRef.createElement('span');
      filterActiveIndicator.className = 'filter-active-indicator';
      filterActiveIndicator.setAttribute('aria-hidden', 'true');
      host.appendChild(filterActiveIndicator);
    }
    return filterActiveIndicator;
  }

  function syncFilterActiveIndicator(
    button = getFilterButtons().find(item =>
      item.classList.contains('active') || item.getAttribute('aria-pressed') === 'true'
    ),
    { followingScroll = false } = {}
  ) {
    const indicator = ensureFilterActiveIndicator();
    const host = getFilterIndicatorHost();
    if (!indicator || !host || !button || !filterContent.contains(button)) return;
    const initialPlacement = !indicator.classList.contains('is-ready');
    if (followingScroll) indicator.classList.add('is-following-scroll');
    else indicator.classList.remove('is-following-scroll');
    if (!initialPlacement) indicator.classList.add('is-animated');

    // The indicator overlays the stationary viewport, so its coordinates are
    // measured from that viewport. Scroll frames keep it aligned with the
    // active label while the contents glide underneath on mobile.
    const hostRect = host.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    indicator.style.width = `${buttonRect.width}px`;
    indicator.style.height = `${buttonRect.height}px`;
    indicator.style.transform = `translate3d(${buttonRect.left - hostRect.left}px, ${buttonRect.top - hostRect.top}px, 0)`;

    // The static active button remains the CSS fallback until the indicator
    // has a measured position, so selection never disappears during startup.
    indicator.classList.add('is-ready');
    filterContent.classList.add('has-active-indicator');
    if (initialPlacement) {
      const enableMotion = () => {
        if (filterActiveIndicator === indicator && indicator.isConnected) {
          indicator.classList.add('is-animated');
        }
      };
      if (typeof windowRef.requestAnimationFrame === 'function') windowRef.requestAnimationFrame(enableMotion);
      else windowRef.setTimeout(enableMotion, 0);
    }
  }

  // Active labels use a heavier weight, which can otherwise alter flex widths
  // on every selection and nudge neighbouring labels. Reserve each label's
  // natural maximum active/inactive width so only the gray indicator moves.
  function normalizeFilterButtonWidths() {
    getFilterButtons().forEach(button => {
      button.style.width = '';
      const wasActive = button.classList.contains('active');
      const previousPressed = button.getAttribute('aria-pressed');
      button.classList.remove('active');
      button.setAttribute('aria-pressed', 'false');
      const inactiveWidth = button.getBoundingClientRect().width;
      button.classList.add('active');
      button.setAttribute('aria-pressed', 'true');
      const activeWidth = button.getBoundingClientRect().width;
      button.classList.toggle('active', wasActive);
      if (previousPressed === null) button.removeAttribute('aria-pressed');
      else button.setAttribute('aria-pressed', previousPressed);
      button.style.width = `${Math.ceil(Math.max(inactiveWidth, activeWidth))}px`;
    });
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

  function isFilterScroller() {
    return Boolean(filterTabs && filterTabs.dataset.overflow === 'true');
  }

  function isFilterCarousel() {
    return windowRef.innerWidth < 768;
  }

  function refreshFilterGeometryAfterFontsLoad() {
    if (galleryDestroyed || !filterTabs?.isConnected) return;

    // Re-measure after web fonts settle so labels and the moving pill cannot
    // clip or drift when a late font swap changes text metrics.
    normalizeFilterButtonWidths();
    ensureFilterEdges();
    const activeButton = filterBtns.find(button =>
      (button.getAttribute('data-filter') || 'all') === currentFilter
    );
    suppressFilterSettleUntil = Date.now() + 750;
    if (activeButton && isFilterScroller()) centerFilterButton(activeButton, 'auto');
    syncFilterActiveIndicator(activeButton, { followingScroll: true });

    const indicator = filterActiveIndicator;
    const restoreIndicatorMotion = () => {
      if (!galleryDestroyed && filterActiveIndicator === indicator && indicator?.isConnected) {
        indicator.classList.remove('is-following-scroll');
      }
    };
    if (typeof windowRef.requestAnimationFrame === 'function') {
      windowRef.requestAnimationFrame(restoreIndicatorMotion);
    } else {
      windowRef.setTimeout(restoreIndicatorMotion, 0);
    }
    updateFilterPager(filterBtns.indexOf(activeButton));
  }

  function centerFilterButton(button, behavior = 'smooth', force = false) {
    if (!filterTabs || !button || !isFilterScroller()) return false;
    const tabsRect = filterTabs.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const delta = (buttonRect.left + buttonRect.width / 2) -
      (tabsRect.left + tabsRect.width / 2);
    // Keep the selected item on the viewport's horizontal centerline. A small
    // tolerance prevents re-scrolling when it's already centered, while force
    // is reserved for precise post-swipe snap settlement.
    const centerTolerance = 1.5;
    if (!force && Math.abs(delta) <= centerTolerance) return false;
    if (Math.abs(delta) < 1) return false;

    const reducedMotion = !!windowRef.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const resolvedBehavior = reducedMotion && behavior === 'smooth' ? 'auto' : behavior;
    try {
      if (typeof filterTabs.scrollTo === 'function') {
        filterTabs.scrollTo({ left: filterTabs.scrollLeft + delta, behavior: resolvedBehavior });
      } else {
        filterTabs.scrollLeft += delta;
      }
    } catch (_) {
      filterTabs.scrollLeft += delta;
    }
    return true;
  }

  function signalCenteredFilter(button) {
    if (!button) return;
    const filterId = button.getAttribute('data-filter') || 'all';
    if (filterId === lastCenteredFilterId) return;
    lastCenteredFilterId = filterId;

    const CustomEventConstructor = windowRef.CustomEvent;
    if (typeof CustomEventConstructor !== 'function') return;
    documentRef.dispatchEvent(new CustomEventConstructor('lm:filter-centered', {
      detail: {
        filter: filterId,
        label: String(button.textContent || '').trim()
      }
    }));
  }

  function cancelPendingFilterSettlement() {
    windowRef.clearTimeout(filterScrollTimer);
    filterScrollTimer = null;
    windowRef.clearTimeout(filterSettleTimer);
    filterSettleTimer = null;
    filterSettling = false;
  }

  function activateFilterButton(button, { center = false, updateUrl = true, fromScroll = false } = {}) {
    if (!button || button.disabled) return;
    if (!fromScroll) cancelPendingFilterSettlement();

    const nextFilter = button.getAttribute('data-filter') || 'all';
    const changed = currentFilter !== nextFilter;

    filterBtns.forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    currentFilter = nextFilter;
    syncFilterActiveIndicator(button);

    // Only a real filter change starts a new result set. Centering the
    // currently selected button during resize/scroll settling must not reset
    // the user's Show More state.
    if (changed) {
      const transitionFromRects = captureGalleryCardRects(portfolioGrid);
      isExpanded = false;
      render({ animateTransition: true, transitionFromRects });
      updateFilterAnnouncement(button);
    }
    if (center && isFilterScroller()) centerFilterButton(button);
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
    if (!filterTabs || !isFilterScroller() || filterSettling ||
        Date.now() < suppressFilterSettleUntil) return;
    const buttons = getFilterButtons();
    if (!buttons.length) return;

    const nearest = buttons[getNearestCenteredFilterIndex()];
    if (!nearest) return;

    filterSettling = true;
    windowRef.clearTimeout(filterSettleTimer);
    activateFilterButton(nearest, { center: false, updateUrl: true, fromScroll: true });
    updateFilterPager(filterBtns.indexOf(nearest));

    // Native scroll snapping has already settled the gesture. Correct any residual
    // sub-pixel drift instantly instead of launching a second smooth glide.
    const needsRecentering = center && centerFilterButton(nearest, 'auto', true);
    if (needsRecentering) {
      // Prefer native scrollend; this timer covers engines without that event.
      filterSettleTimer = windowRef.setTimeout(() => {
        filterSettling = false;
        filterSettleTimer = null;
        const settledButtons = getFilterButtons();
        signalCenteredFilter(settledButtons[getNearestCenteredFilterIndex()] || nearest);
      }, 420);
    } else {
      filterSettling = false;
      signalCenteredFilter(nearest);
    }
  }

  function scheduleCenteredFilter() {
    if (!filterTabs || !isFilterScroller() || filterPointerActive || filterSettling ||
        Date.now() < suppressFilterSettleUntil) return;
    windowRef.clearTimeout(filterScrollTimer);
    filterScrollTimer = windowRef.setTimeout(() => {
      filterActiveIndicator?.classList.remove('is-following-scroll');
      settleCenteredFilter();
    }, 220);
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

    normalizeFilterButtonWidths();
    ensureFilterActiveIndicator();
    ensureFilterEdges();
    const activeIndex = Math.max(0, buttons.findIndex(button => (button.getAttribute('data-filter') || 'all') === currentFilter));
    const activeButton = buttons[activeIndex];
    lastCenteredFilterId = activeButton?.getAttribute('data-filter') || currentFilter;
    if (activeButton && isFilterScroller()) centerFilterButton(activeButton, 'auto');
    syncFilterActiveIndicator(activeButton);
    updateFilterPager(activeIndex >= 0 ? activeIndex : 0);
  }
  function projectMatchesFilter(project, filter) {
    if (filter === 'all') return true;
    return Array.isArray(project?.filters) && project.filters.includes(filter);
  }

  function getFilteredProjects() {
    return getProjectSnapshot().filter(project => projectMatchesFilter(project, currentFilter));
  }

  function updateFilterAnnouncement(button) {
    if (!filterAnnouncement || !button) return;
    const count = getFilteredProjects().length;
    const noun = count === 1 ? 'project' : 'projects';
    const filterId = button.getAttribute('data-filter') || 'all';
    const label = String(button.textContent || '').trim();
    filterAnnouncement.textContent = filterId === 'all'
      ? 'Showing all ' + count + ' ' + noun + '.'
      : 'Showing ' + count + ' ' + noun + ' in ' + label + '.';
  }

  function getCardsForProjects(projects) {
    return projects.map(project => getCardForProject(project.id)).filter(Boolean);
  }

  function getEffectiveBaseCount(filtered) {
    return getRowAlignedCount(filtered, getBaseCount(), windowRef, portfolioGrid);
  }

  function render({ animateTransition = false, transitionFromRects = null } = {}) {
    // A pending Show Less follow-scroll belongs to the layout that existed
    // when the button was collapsed. If a filter/resize/pageshow render starts
    // first, that old timer must not scroll the visitor into the new layout.
    if (collapseScrollTimer !== null) {
      windowRef.clearTimeout(collapseScrollTimer);
      collapseScrollTimer = null;
    }
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
      animateTransition,
      transitionFromRects,
      windowRef,
      fadeMs,
      renderToken: token,
      isCurrentRender: value => value === renderToken
    });
  }


  function scheduleGalleryScroll() {
    const scroll = () => scrollGalleryIntoView();
    if (typeof windowRef.requestAnimationFrame === 'function') {
      windowRef.requestAnimationFrame(() => windowRef.requestAnimationFrame(scroll));
      return;
    }
    windowRef.setTimeout(scroll, 0);
  }

  // Public Works filter links are navigation controls, not ordinary anchors.
  // Gallery owns the filter state, so consume the click explicitly and run the
  // same activation path as an in-page filter button. This removes the timing
  // dependency on hashchange (especially when the mobile menu closes at the
  // same moment) while preserving the existing URL/hash contract.
  function handlePublicFilterNavigation(event) {
    const link = event.target?.closest?.('.nav-links a[href], .mobile-menu a[href]');
    if (!link || !documentRef?.contains?.(link)) return;

    let filterId = '';
    try {
      filterId = decodeURIComponent(
        new URL(link.getAttribute('href') || '', windowRef.location.href).hash.slice(1)
      );
    } catch (_) {
      return;
    }
    if (!filterId) return;

    const button = filterBtns.find(item => item.getAttribute('data-filter') === filterId);
    if (!button || button.disabled) return;

    event.preventDefault();
    activateFilterButton(button, { center: true, updateUrl: true });

    // The mobile navigation closes from its link listener on the target node.
    // Scroll only after that close and the Gallery render have had a paint to
    // settle, so the portfolio wrapper lands below the fixed navbar reliably.
    scheduleGalleryScroll();
  }

  bind(documentRef, 'click', handlePublicFilterNavigation);

  // Returning to Works/home always means the public gallery is back to ALL.
  // Navigation publishes the event; Gallery owns the state reset, render, and
  // mobile filter-strip positioning.
  function resetToAllFilter() {
    const allButton = filterBtns.find(button => (button.getAttribute('data-filter') || 'all') === 'all');
    if (!allButton) return;
    // Home/Works navigation is an explicit state change. Cancel pending
    // gesture settlement and guard the reset's own rail-centering scroll from
    // re-selecting whichever category happens to be nearest after the delay.
    cancelPendingFilterSettlement();
    suppressFilterSettleUntil = Date.now() + 750;
    const changed = currentFilter !== 'all';
    const transitionFromRects = changed ? captureGalleryCardRects(portfolioGrid) : null;
    filterBtns.forEach(item => {
      const active = item === allButton;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    currentFilter = 'all';
    lastCenteredFilterId = 'all';
    isExpanded = false;
    render({ animateTransition: changed, transitionFromRects });
    if (changed) updateFilterAnnouncement(allButton);
    updateFilterPager(filterBtns.indexOf(allButton));
    if (isFilterScroller()) centerFilterButton(allButton, 'auto');
    syncFilterActiveIndicator(allButton);
  }

  bind(windowRef, 'lm:navigate-home', resetToAllFilter);

  // Lightbox is a separate feature, but closing it can coincide with media/layout
  // reconciliation. Rebuild Gallery presentation from its own state contract
  // without changing the user's selected filter or Show More/Show Less state.
  bind(windowRef, 'lm:lightbox-closed', event => {
    const scrollingElement = documentRef.scrollingElement || documentRef.documentElement;
    const detail = event?.detail || {};
    const capturedX = Number(detail.scrollX);
    const capturedY = Number(detail.scrollY);
    const savedScrollX = Number.isFinite(capturedX)
      ? capturedX
      : Number(windowRef.scrollX) || Number(scrollingElement?.scrollLeft) || 0;
    const savedScrollY = Number.isFinite(capturedY)
      ? capturedY
      : Number(windowRef.scrollY) || Number(scrollingElement?.scrollTop) || 0;
    if (portfolioGridViewport) portfolioGridViewport.style.maxHeight = 'none';

    render();

    const restoreScroll = () => {
      try {
        scrollingElement.scrollLeft = savedScrollX;
        scrollingElement.scrollTop = savedScrollY;
        documentRef.documentElement.scrollLeft = savedScrollX;
        documentRef.documentElement.scrollTop = savedScrollY;
        documentRef.body.scrollLeft = savedScrollX;
        documentRef.body.scrollTop = savedScrollY;
        windowRef.scrollTo({ left: savedScrollX, top: savedScrollY, behavior: 'auto' });
      } catch (_) {}
    };

    restoreScroll();
    windowRef.requestAnimationFrame?.(() => {
      restoreScroll();
      windowRef.requestAnimationFrame?.(restoreScroll);
    });
  });

  filterBtns.forEach(btn => bind(btn, 'click', event => {
    if (Date.now() < suppressFilterClickUntil) {
      event.preventDefault();
      return;
    }
    // A programmatic centering scroll can finish after the click event. Ignore
    // its late scroll/scrollend notifications so an explicitly selected,
    // already-visible pill cannot be replaced by the nearest-centre category.
    // Genuine wheel/pointer gestures clear this guard in their own handlers.
    suppressFilterSettleUntil = Date.now() + 750;
    activateFilterButton(btn, { center: true, updateUrl: true });
  }));

  // Arrow keys move focus along the mobile strip; Home/End jump to its bounds.
  // The settled center remains the owner of filter state and sound timing.
  bind(filterTabs, 'keydown', event => {
    if (!isFilterScroller()) return;
    const focused = event.target?.closest?.('.filter-btn, .tab-btn');
    if (!focused) return;
    const buttons = getFilterButtons();
    const index = buttons.indexOf(focused);
    if (index < 0) return;

    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex += 1;
    else if (event.key === 'ArrowLeft') nextIndex -= 1;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = buttons.length - 1;
    else return;

    event.preventDefault();
    // A fresh keyboard navigation gesture is intentional user input and
    // must not be blocked by the post-click programmatic-scroll guard.
    suppressFilterSettleUntil = 0;
    nextIndex = Math.max(0, Math.min(buttons.length - 1, nextIndex));
    const next = buttons[nextIndex];
    next?.focus?.({ preventScroll: true });
    if (next) {
      centerFilterButton(next, 'smooth');
      scheduleCenteredFilter();
    }
  });

  let collapseScrollTimer = null;

  function scrollWindowToGalleryStart() {
    const galleryRoot = portfolioWrapper || documentRef.getElementById('portfolioGrid');
    const scrollingElement = documentRef.scrollingElement || documentRef.documentElement;
    if (!galleryRoot || !scrollingElement) return;

    const viewportHeight = Number(windowRef.innerHeight) || 0;
    const currentY = Number(windowRef.scrollY) || Number(scrollingElement.scrollTop) || 0;
    const rect = galleryRoot.getBoundingClientRect();
    const scrollMarginTop = Number.parseFloat(
      windowRef.getComputedStyle?.(galleryRoot)?.scrollMarginTop || ''
    ) || 0;
    const targetY = currentY + rect.top - scrollMarginTop;
    const documentHeight = Math.max(
      Number(documentRef.documentElement?.scrollHeight) || 0,
      Number(documentRef.body?.scrollHeight) || 0
    );
    const maxY = Math.max(0, documentHeight - viewportHeight);
    const destination = Math.max(0, Math.min(maxY, targetY));

    // Direct scrollTop is intentional here. Show Less is a state-changing
    // control, and the visitor asked for an immediate return to the gallery.
    // Two paint-pass corrections absorb the synchronous collapse geometry
    // without adding a visible timeout or a second animation system.
    scrollingElement.scrollTop = destination;
  }

  lifecycle.add(() => {
    windowRef.clearTimeout(collapseScrollTimer);
  });

  bind(showMoreBtn, 'click', event => {
    event.preventDefault();
    const nextExpanded = !isExpanded;
    const shouldFollowCollapsedControl = !nextExpanded;

    isExpanded = nextExpanded;
    render();

    // Keep the button's semantic state synchronized immediately. The visual
    // reveal may animate, but its state must never depend on a later scroll,
    // resize, or media-load callback.
    showMoreBtn?.setAttribute('aria-expanded', String(isExpanded));
    showMoreWrapper?.setAttribute('data-expanded', String(isExpanded));

    // When Show Less collapses the gallery, return to the top of the project
    // gallery rather than centering the Show More control. This matches the
    // legacy behavior and keeps the expanded rows from leaving the visitor
    // stranded at a stale document position.
    if (shouldFollowCollapsedControl) {
      // Start immediately on click. The collapse itself is already applied
      // synchronously by render(); correct again on the next two paint passes
      // so the button never waits for a timeout before returning to the
      // gallery start.
      collapseScrollTimer = null;
      if (!isExpanded && showMoreWrapper) {
        scrollWindowToGalleryStart();
        if (typeof windowRef.requestAnimationFrame === 'function') {
          windowRef.requestAnimationFrame(() => {
            if (isExpanded) return;
            scrollWindowToGalleryStart();
            windowRef.requestAnimationFrame(() => {
              if (!isExpanded) scrollWindowToGalleryStart();
            });
          });
        }
      }
    }
  });

  let resizeTimer = null;
  lifecycle.add(() => windowRef.clearTimeout(resizeTimer));
  bind(windowRef, 'resize', () => {
    // Cancel any scroll-settlement work that was already pending before this
    // resize. Re-centering the active button is presentation-only and must not
    // switch the active filter or collapse the user's expanded gallery.
    suppressFilterSettleUntil = Date.now() + 350;
    windowRef.clearTimeout(filterScrollTimer);
    filterScrollTimer = null;
    windowRef.clearTimeout(filterSettleTimer);
    filterSettleTimer = null;
    filterSettling = false;
    clearTimeout(resizeTimer);
    resizeTimer = windowRef.setTimeout(() => {
      normalizeFilterButtonWidths();
      ensureFilterEdges();
      const activeBtn = filterBtns.find(button => (button.getAttribute('data-filter') || 'all') === currentFilter);
      // Re-establish the guard after the debounce because this is the
      // programmatic scroll that otherwise fires a second filter settlement.
      suppressFilterSettleUntil = Date.now() + 350;
      lastCenteredFilterId = activeBtn?.getAttribute('data-filter') || currentFilter;
      if (activeBtn && isFilterScroller()) centerFilterButton(activeBtn, 'auto');
      // Breakpoint/viewport changes are layout corrections, not a user tab
      // change. Reposition instantly so the indicator cannot lag across an
      // old viewport width and briefly detach from the selected label.
      syncFilterActiveIndicator(activeBtn, { followingScroll: true });
      const indicator = filterActiveIndicator;
      const restoreIndicatorMotion = () => {
        if (filterActiveIndicator === indicator && indicator?.isConnected) {
          indicator.classList.remove('is-following-scroll');
        }
      };
      if (typeof windowRef.requestAnimationFrame === 'function') windowRef.requestAnimationFrame(restoreIndicatorMotion);
      else windowRef.setTimeout(restoreIndicatorMotion, 0);
      updateFilterPager(filterBtns.indexOf(activeBtn));
      // Re-render at breakpoint changes because card orientation and the
      // collapsed viewport measurement depend on the current width. The
      // user's expansion state itself is never changed by resize.
      render();
    }, 120);
  });

  bind(filterTabs, 'scroll', () => {
    if (!isFilterScroller()) return;
    if (filterScrollFrame) return;
    filterScrollFrame = windowRef.requestAnimationFrame(() => {
      filterScrollFrame = null;
      syncFilterActiveIndicator(undefined, { followingScroll: true });
      updateFilterPager();
      scheduleCenteredFilter();
    });
  }, { passive: true });

  bind(filterTabs, 'scrollend', () => {
    if (!isFilterScroller()) return;
    filterActiveIndicator?.classList.remove('is-following-scroll');
    if (filterPointerActive) return;
    if (filterSettling) {
      filterSettling = false;
      windowRef.clearTimeout(filterSettleTimer);
      filterSettleTimer = null;
      const buttons = getFilterButtons();
      signalCenteredFilter(buttons[getNearestCenteredFilterIndex()]);
      return;
    }
    settleCenteredFilter();
  }, { passive: true });

  /* Horizontal rail gestures are axis-locked. Touch-action: pan-y lets
     the browser own vertical scrolling; horizontal dragging only starts
     after X movement clearly wins over Y movement. */
  function stopFilterInertia() {
    if (filterInertiaFrame !== null) windowRef.cancelAnimationFrame?.(filterInertiaFrame);
    filterInertiaFrame = null;
    filterTabs?.classList.remove('is-gesture-active', 'is-dragging');
  }

  function runFilterInertia(initialVelocity) {
    if (!filterTabs || typeof windowRef.requestAnimationFrame !== 'function') {
      stopFilterInertia();
      scheduleCenteredFilter();
      return;
    }

    let velocity = Math.max(-2.5, Math.min(2.5, initialVelocity));
    let previousTime = null;
    let elapsed = 0;
    const maxScroll = Math.max(0, filterTabs.scrollWidth - filterTabs.clientWidth);

    const advance = timestamp => {
      filterInertiaFrame = null;
      const now = Number.isFinite(timestamp) ? timestamp : Date.now();
      const deltaTime = previousTime === null
        ? 16
        : Math.max(1, Math.min(32, now - previousTime));
      previousTime = now;
      elapsed += deltaTime;

      const before = filterTabs.scrollLeft;
      const next = Math.max(0, Math.min(maxScroll, before + velocity * deltaTime));
      filterTabs.scrollLeft = next;
      velocity *= Math.exp(-deltaTime / 230);

      const hitEdge = (next <= 0 && velocity < 0) || (next >= maxScroll && velocity > 0);
      if (elapsed < 640 && Math.abs(velocity) > 0.035 && !hitEdge) {
        filterInertiaFrame = windowRef.requestAnimationFrame(advance);
        return;
      }

      filterTabs.classList.remove('is-gesture-active', 'is-dragging');
      scheduleCenteredFilter();
    };

    if (Math.abs(velocity) < 0.035) {
      stopFilterInertia();
      scheduleCenteredFilter();
      return;
    }
    filterInertiaFrame = windowRef.requestAnimationFrame(advance);
  }

  bind(filterTabs, 'pointerdown', event => {
    if (!isFilterScroller() || event.isPrimary === false) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    // A new gesture interrupts any previous coast or programmatic centering.
    stopFilterInertia();
    suppressFilterSettleUntil = 0;
    windowRef.clearTimeout(filterScrollTimer);
    filterScrollTimer = null;
    windowRef.clearTimeout(filterSettleTimer);
    filterSettleTimer = null;
    filterSettling = false;
    filterPointerActive = true;

    filterDrag = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || 'mouse',
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: filterTabs.scrollLeft,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: Number(event.timeStamp) || Date.now(),
      velocityX: 0,
      distanceX: 0,
      axis: null,
      moved: false
    };
  });

  bind(filterTabs, 'pointermove', event => {
    if (!filterDrag || event.pointerId !== filterDrag.pointerId) return;

    const now = Number(event.timeStamp) || Date.now();
    const deltaTime = Math.max(1, now - filterDrag.lastTime);
    const sampleVelocity = Math.max(
      -2.5,
      Math.min(2.5, (event.clientX - filterDrag.lastX) / deltaTime)
    );
    filterDrag.velocityX = filterDrag.velocityX * 0.35 + sampleVelocity * 0.65;

    const distanceX = event.clientX - filterDrag.startX;
    const distanceY = event.clientY - filterDrag.startY;
    filterDrag.distanceX = distanceX;

    if (!filterDrag.axis && Math.max(Math.abs(distanceX), Math.abs(distanceY)) >= 8) {
      if (Math.abs(distanceX) > Math.abs(distanceY) * 1.15) {
        filterDrag.axis = 'x';
        filterDrag.moved = true;
        filterTabs.classList.add('is-gesture-active', 'is-dragging');
        try { filterTabs.setPointerCapture?.(event.pointerId); } catch (_) {}
      } else if (Math.abs(distanceY) > Math.abs(distanceX) * 1.15) {
        // The gesture belongs to the document, not the filter rail. Do not
        // preventDefault(), capture the pointer, or schedule filter selection.
        filterDrag.axis = 'y';
        filterPointerActive = false;
      }
    }

    if (filterDrag.axis === 'x') {
      if (event.cancelable) event.preventDefault();
      filterTabs.scrollLeft = filterDrag.startScrollLeft - distanceX;
    }

    filterDrag.lastX = event.clientX;
    filterDrag.lastY = event.clientY;
    filterDrag.lastTime = now;
  });

  function finishFilterPointer(event) {
    if (!filterDrag) return;
    if (event && event.pointerId !== filterDrag.pointerId) return;

    const gesture = filterDrag;
    const cancelled = event?.type === 'pointercancel';
    filterDrag = null;
    filterPointerActive = false;

    try { filterTabs.releasePointerCapture?.(gesture.pointerId); } catch (_) {}
    filterTabs.classList.remove('is-dragging');

    // Native vertical page scrolling takes priority and must not change which
    // filter is active just because the pointer started over the rail.
    if (gesture.axis === 'y') {
      filterTabs.classList.remove('is-gesture-active');
      return;
    }

    if (gesture.axis === 'x' && gesture.moved) {
      suppressFilterClickUntil = Date.now() + 250;
      const reducedMotion = !!windowRef.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const travel = Math.abs(gesture.distanceX);
      const speed = Math.abs(gesture.velocityX);
      const longGesture = travel >= Math.max(140, filterTabs.clientWidth * 0.42);
      const shouldCoast = !reducedMotion && !cancelled && (
        (travel >= 24 && speed >= 0.45) ||
        (longGesture && speed >= 0.12)
      );

      if (shouldCoast) {
        // Finger velocity and scroll velocity have opposite signs. The brief
        // damped coast is reserved for genuinely fast or long horizontal drags.
        runFilterInertia(-gesture.velocityX);
      } else {
        filterTabs.classList.remove('is-gesture-active');
        scheduleCenteredFilter();
      }
      return;
    }

    filterTabs.classList.remove('is-gesture-active');
    if (!cancelled) scheduleCenteredFilter();
  }

  bind(filterTabs, 'wheel', () => { suppressFilterSettleUntil = 0; }, { passive: true });
  bind(filterTabs, 'pointerup', finishFilterPointer);
  bind(filterTabs, 'pointercancel', finishFilterPointer);

  // Gestures can end outside the strip after pointer capture or OS interruption.
  // The no-active-gesture guard prevents the bubbling pointerup from settling twice.
  bind(windowRef, 'pointerup', finishFilterPointer);
  bind(windowRef, 'pointercancel', finishFilterPointer);

  function scrollGalleryIntoView() {
    if (!portfolioWrapper?.scrollIntoView) return;

    const reducedMotion = !!windowRef.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    portfolioWrapper.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'start'
    });
  }

  function applyHash() {
    const hash = decodeURIComponent(windowRef.location.hash.replace('#', ''));
    if (!hash) return;
    const btn = filterBtns.find(item => item.getAttribute('data-filter') === hash);
    if (!btn || btn.disabled) return;
    filterBtns.forEach(item => {
      const active = item === btn;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    currentFilter = hash;
    lastCenteredFilterId = hash;
    isExpanded = false;
    render();
    updateFilterAnnouncement(btn);
    if (isFilterScroller()) centerFilterButton(btn, 'auto');
    updateFilterPager(filterBtns.indexOf(btn));

    // Filter links from the public navigation use the same hash contract as
    // the gallery state. There is no physical DOM anchor for a filter ID
    // because the filter buttons are rebuilt from CMS data, so explicitly
    // move the visitor to the gallery after the hash has selected the set.
    scheduleGalleryScroll();
  }

  lifecycle.add(() => windowRef.clearTimeout(filterScrollTimer));
  lifecycle.add(() => windowRef.clearTimeout(filterSettleTimer));
  lifecycle.add(() => windowRef.cancelAnimationFrame?.(filterScrollFrame));
  lifecycle.add(() => windowRef.cancelAnimationFrame?.(filterInertiaFrame));

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
  const fontMetricsReady = documentRef.fonts?.ready;
  if (fontMetricsReady && typeof fontMetricsReady.then === 'function') {
    fontMetricsReady.then(refreshFilterGeometryAfterFontsLoad).catch(() => {});
  }
  showMoreBtn?.setAttribute('aria-expanded', 'false');
  showMoreWrapper?.setAttribute('data-expanded', 'false');
  render();
  applyHash();
  ensureFilterEdges();
  lifecycle.animationFrame(() => {
    const activeBtn = filterBtns.find(button => (button.getAttribute('data-filter') || 'all') === currentFilter);
    if (activeBtn && isFilterScroller()) centerFilterButton(activeBtn, 'auto');
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
      galleryDestroyed = true;
      renderToken += 1;
      lifecycle.cleanup();
      filterDrag = null;
      filterPointerActive = false;
      filterSettling = false;
      if (filterInertiaFrame !== null) windowRef.cancelAnimationFrame?.(filterInertiaFrame);
      filterInertiaFrame = null;
      filterTabs?.classList.remove('is-gesture-active', 'is-dragging');
      filterActiveIndicator?.remove();
      filterActiveIndicator = null;
      filterContent?.classList.remove('has-active-indicator');
      filterPager?.remove();
      filterPager = null;
      filterPageDots = [];
      filterAnnouncement?.remove();
      filterTabs?.querySelectorAll('.filter-edge-spacer').forEach(el => el.remove());
      filterTabs?.removeAttribute('inert');
      filterTabs?.removeAttribute('data-filter-viewport');
      filterTabs?.style.removeProperty('pointer-events');
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
