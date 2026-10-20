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
  let filterActiveIndicator = null;
  let filterSettling = false;
  let galleryDestroyed = false;
  let suppressFilterClickUntil = 0;
  // Centering the active filter after a viewport resize emits scroll events.
  // Those programmatic scrolls must not be mistaken for a user selecting a new
  // filter, because a filter change intentionally collapses Show More.
  let suppressFilterSettleUntil = 0;
  // Programmatic centering and post-release correction must not restart the
  // swipe-preview state when their queued scroll events arrive a frame later.
  let suppressFilterPreviewUntil = 0;
  // Only explicit user input can opt the rail into swipe-preview styling.
  // Programmatic centering, resize, and reconciliation scrolls never set this.
  let filterScrollPreviewRequested = false;
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

    // Edge cushions are rebuilt for every viewport to keep the active pill centered.
    filterTabs.querySelectorAll('.filter-edge-spacer').forEach(el => el.remove());

    const buttons = Array.from(filterTabs.querySelectorAll('.filter-btn, .tab-btn'));
    if (!buttons.length || filterTabs.clientWidth <= 0) {
      filterTabs.dataset.overflow = 'false';
      return;
    }

    const contentStyle = windowRef.getComputedStyle?.(filterContent);
    const columnGap = Number.parseFloat(contentStyle?.columnGap || contentStyle?.gap || '0') || 0;

    // The active pill is a centered carousel on every viewport, not only when
    // the labels exceed the available width. Edge cushions let the first and
    // last labels reach the centerline, making mouse-drag and touch-swipe use
    // the same interaction model on desktop, tablet, and mobile.
    const needsScroller = buttons.length > 1;
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
    // Keep the pill and label inside the same compositing context. The rail's
    // edge mask creates a stacking context of its own; a sibling pill outside
    // it cannot be used as the backdrop for mix-blend-mode: exclusion.
    return filterContent || filterTabs?.closest('.filter-nav-viewport') || filterTabs;
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

  function syncFilterActiveIndicator(button, { followingScroll = false } = {}) {
    const buttons = getFilterButtons();
    const activeButton = button || buttons.find(item =>
      item.classList.contains('active') || item.getAttribute('aria-pressed') === 'true'
    );
    // During a direct swipe, preview the nearest label. Otherwise, keep the
    // committed filter as the pill's width source even while the rail settles.
    const centeredButton = buttons[getNearestCenteredFilterIndex()];
    const isFollowingFilterScroll = followingScroll && isFilterScroller();
    const indicatorButton = isFollowingFilterScroll
      ? (centeredButton && !centeredButton.disabled ? centeredButton : activeButton)
      : activeButton;

    const indicator = ensureFilterActiveIndicator();
    const host = getFilterIndicatorHost();
    if (!indicator || !host || !indicatorButton || !filterContent.contains(indicatorButton)) return;

    const initialPlacement = !indicator.classList.contains('is-ready');
    indicator.classList.toggle('is-following-scroll', isFollowingFilterScroll);
    filterContent.classList.toggle('is-following-filter-scroll', isFollowingFilterScroll);
    buttons.forEach(item => item.classList.toggle(
      'is-centered-preview',
      isFollowingFilterScroll && item === indicatorButton
    ));
    if (!initialPlacement) indicator.classList.add('is-animated');

    const hostRect = host.getBoundingClientRect();
    const buttonRect = indicatorButton.getBoundingClientRect();
    const scrollerRect = filterTabs.getBoundingClientRect();
    // Anchor the pill's center to the viewport centerline. The label can scroll
    // underneath it; only the pill width morphs to fit the selected label.
    const centerX = scrollerRect.left + filterTabs.clientWidth / 2 - hostRect.left;
    indicator.style.left = `${centerX}px`;
    indicator.style.width = `${buttonRect.width}px`;
    indicator.style.height = `${buttonRect.height}px`;
    indicator.style.transform = `translate3d(-50%, ${buttonRect.top - hostRect.top}px, 0)`;

    // Keep a visible CSS fallback until the first measured pill is ready.
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

  function clearFilterScrollPreview() {
    filterScrollPreviewRequested = false;
    filterActiveIndicator?.classList.remove('is-following-scroll');
    filterContent?.classList.remove('is-following-filter-scroll');
    getFilterButtons().forEach(button => button.classList.remove('is-centered-preview'));
    syncFilterActiveIndicator();
  }

  // Pills stay content-sized. Active styling may affect a label's natural
  // metrics, so clear stale inline measurements and remeasure the edge cushions
  // after a selection rather than reserving every pill's maximum possible width.
  function normalizeFilterButtonWidths() {
    getFilterButtons().forEach(button => {
      button.style.width = '';
    });
  }

  function getNearestCenteredFilterIndex() {
    const buttons = getFilterButtons();
    const selectableButtons = buttons.filter(button => !button.disabled);
    if (!selectableButtons.length || !filterTabs) return 0;
    const center = filterTabs.getBoundingClientRect().left + filterTabs.clientWidth / 2;
    let nearestButton = selectableButtons[0];
    let nearestDistance = Infinity;

    selectableButtons.forEach(button => {
      const rect = button.getBoundingClientRect();
      const distance = Math.abs((rect.left + rect.width / 2) - center);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestButton = button;
      }
    });
    // Callers index the complete button list, so return the original index
    // while ensuring an inert CMS filter cannot win gesture settlement.
    return Math.max(0, buttons.indexOf(nearestButton));
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
    // Font/layout reconciliation is not user gesture intent. Keep the committed
    // filter in its resting high-contrast state while the pill is remeasured.
    syncFilterActiveIndicator(activeButton);

    const indicator = filterActiveIndicator;
    const restoreIndicatorMotion = () => {
      if (!galleryDestroyed && filterActiveIndicator === indicator && indicator?.isConnected) {
        syncFilterActiveIndicator(activeButton);
      }
    };
    if (typeof windowRef.requestAnimationFrame === 'function') {
      windowRef.requestAnimationFrame(restoreIndicatorMotion);
    } else {
      windowRef.setTimeout(restoreIndicatorMotion, 0);
    }
    updateFilterPager(filterBtns.indexOf(activeButton));
  }

  function centerFilterButton(button, behavior = 'auto', force = false) {
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
    filterScrollPreviewRequested = false;
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
    // Active and idle labels share the same font metrics, so preserve the
    // measured edge cushions when a filter is selected. Rebuilding them here
    // briefly shrinks the rail and can clamp scrollLeft before smooth scrolling
    // starts. Geometry changes still rebuild cushions through resize/font hooks.
    // Reduced-motion users receive instant centering from centerFilterButton().
    if (center && isFilterScroller()) centerFilterButton(button, 'smooth');
    syncFilterActiveIndicator(button);

    // Only a real filter change starts a new result set. Centering the
    // currently selected button during resize/scroll settling must not reset
    // the user's Show More state.
    if (changed) {
      const transitionFromRects = captureGalleryCardRects(portfolioGrid);
      isExpanded = false;
      render({ animateTransition: true, transitionFromRects });
    }
    // Initialize the live region on the first explicit selection as well as
    // announce subsequent changes; re-centering alone does not spam updates.
    if (changed || !filterAnnouncement?.textContent) updateFilterAnnouncement(button);
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
    if (!filterTabs || !isFilterScroller()) {
      clearFilterScrollPreview();
      return;
    }
    if (filterSettling || Date.now() < suppressFilterSettleUntil) {
      // A delayed settlement can race a previous commit or explicit selection.
      // Clear the transient preview on every early exit so the selected label
      // never remains in the dimmed, in-motion state.
      clearFilterScrollPreview();
      return;
    }
    const buttons = getFilterButtons();
    if (!buttons.some(button => !button.disabled)) {
      clearFilterScrollPreview();
      return;
    }

    const nearest = buttons[getNearestCenteredFilterIndex()];
    if (!nearest) {
      clearFilterScrollPreview();
      return;
    }

    // Committing a gesture ends user-scroll preview intent before final centering.
    filterScrollPreviewRequested = false;
    // The exact centering correction emits its own scroll/scrollend on some
    // engines. Guard the correction window so compact views cannot settle twice.
    suppressFilterPreviewUntil = Date.now() + 800;
    suppressFilterSettleUntil = Date.now() + 800;
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
    if (!filterTabs || !isFilterScroller() || filterPointerActive || filterSettling) return;
    windowRef.clearTimeout(filterScrollTimer);
    // If a click/resize initiated the scroll, preserve its chosen category while
    // the rail finishes moving. A delayed settle also clears the centered preview
    // on browsers that do not dispatch the native scrollend event.
    const delay = Math.max(220, suppressFilterSettleUntil - Date.now() + 16);
    filterScrollTimer = windowRef.setTimeout(() => {
      filterScrollTimer = null;
      filterActiveIndicator?.classList.remove('is-following-scroll');
      if (Date.now() < suppressFilterSettleUntil) {
        syncFilterActiveIndicator();
        return;
      }
      settleCenteredFilter();
    }, delay);
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

  // Outside input is never a filter selection. Clear transient swipe styling
  // and remeasure the committed pill before an outside control receives input.
  // Do not settle to the nearest label here: that can change filters on a tap
  // outside the rail after a gesture-suppression window has expired.
  bind(documentRef, 'pointerdown', event => {
    if (filterTabs?.contains(event.target)) return;
    clearFilterScrollPreview();
  }, { capture: true });

  // Keyboard/synthetic clicks may have no pointerdown. Cleanup is idempotent and
  // always remeasures the selected pill, even when no preview class is present.
  bind(documentRef, 'click', event => {
    if (filterTabs?.contains(event.target)) return;
    clearFilterScrollPreview();
  }, { capture: true });

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

  // Arrow keys move focus and selection together; Home/End jump to strip bounds.
  // Keyboard activation centers immediately and guards its programmatic scroll
  // so a delayed native scrollend cannot duplicate or override the selection.
  bind(filterTabs, 'keydown', event => {
    if (!isFilterScroller()) return;
    const focused = event.target?.closest?.('.filter-btn, .tab-btn');
    if (!focused) return;
    const buttons = getFilterButtons();
    const index = buttons.indexOf(focused);
    if (index < 0) return;

    // Reconcile the cue deduplication marker with the committed category before
    // keyboard navigation begins. A late prior scroll settlement must not leave
    // a stale marker that suppresses the next legitimate centered-filter cue.
    lastCenteredFilterId = focused.getAttribute('data-filter') || currentFilter || 'all';

    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex += 1;
    else if (event.key === 'ArrowLeft') nextIndex -= 1;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = buttons.length - 1;
    else return;

    event.preventDefault();
    // Keyboard navigation is an explicit selection, not an indirect request
    // to wait for a scroll event. Guard the programmatic centering from being
    // misread as a swipe or a second selection by queued scroll/scrollend events.
    cancelPendingFilterSettlement();
    suppressFilterSettleUntil = Date.now() + 750;
    suppressFilterPreviewUntil = Date.now() + 750;
    filterScrollPreviewRequested = false;
    nextIndex = Math.max(0, Math.min(buttons.length - 1, nextIndex));
    const next = buttons[nextIndex];
    next?.focus?.({ preventScroll: true });
    if (next) {
      activateFilterButton(next, { center: true, updateUrl: true });
      clearFilterScrollPreview();
      signalCenteredFilter(next);
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
    // A viewport/layout correction is not user scroll input and must never
    // activate the centered-preview/pale-label state.
    filterScrollPreviewRequested = false;
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
      syncFilterActiveIndicator(activeBtn);
      const indicator = filterActiveIndicator;
      const restoreIndicatorMotion = () => {
        if (filterActiveIndicator === indicator && indicator?.isConnected) {
          syncFilterActiveIndicator(activeBtn);
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
      const suppressPreview = !filterScrollPreviewRequested ||
        filterSettling ||
        Date.now() < suppressFilterSettleUntil ||
        Date.now() < suppressFilterPreviewUntil;
      // A tap, resize, or exact settle may scroll the rail programmatically.
      // Only genuine user scrolling should dim the committed label and preview
      // the label passing under the stationary pill.
      syncFilterActiveIndicator(undefined, { followingScroll: !suppressPreview });
      updateFilterPager();
      if (suppressPreview) {
        windowRef.clearTimeout(filterScrollTimer);
        filterScrollTimer = null;
        return;
      }
      scheduleCenteredFilter();
    });
  }, { passive: true });

  bind(filterTabs, 'scrollend', () => {
    if (!isFilterScroller() || filterPointerActive) return;
    // A release already schedules the single authoritative settle pass.
    // Browsers may queue scrollend for the final direct-manipulation frame;
    // consuming it here can recenter immediately and look like post-release coast.
    if (filterScrollTimer !== null) return;
    // Consume scrollend events from clicks and exact centering corrections first,
    // rather than cancelling a pending settle or launching a second pass.
    if (Date.now() < suppressFilterSettleUntil) {
      syncFilterActiveIndicator();
      return;
    }
    if (filterSettling) {
      filterSettling = false;
      windowRef.clearTimeout(filterSettleTimer);
      filterSettleTimer = null;
      syncFilterActiveIndicator();
      const buttons = getFilterButtons();
      signalCenteredFilter(buttons[getNearestCenteredFilterIndex()]);
      return;
    }
    settleCenteredFilter();
  }, { passive: true });

  /* Horizontal gestures stay axis-locked. Gallery owns movement and centering;
     no post-release coast or native snap is used. */

  bind(filterTabs, 'pointerdown', event => {
    if (!isFilterScroller() || event.isPrimary === false) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    // A new gesture interrupts pending settlement and starts direct manipulation.
    filterTabs.classList.remove('is-gesture-active', 'is-dragging');
    suppressFilterSettleUntil = 0;
    suppressFilterPreviewUntil = 0;
    filterScrollPreviewRequested = false;
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
      distanceX: 0,
      axis: null,
      moved: false
    };
  });

  bind(filterTabs, 'pointermove', event => {
    if (!filterDrag || event.pointerId !== filterDrag.pointerId) return;

    const distanceX = event.clientX - filterDrag.startX;
    const distanceY = event.clientY - filterDrag.startY;
    filterDrag.distanceX = distanceX;

    if (!filterDrag.axis && Math.max(Math.abs(distanceX), Math.abs(distanceY)) >= 8) {
      if (Math.abs(distanceX) > Math.abs(distanceY) * 1.15) {
        filterDrag.axis = 'x';
        filterDrag.moved = true;
        filterScrollPreviewRequested = true;
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
      // Update the centered preview in this pointer frame, not one scroll event later.
      syncFilterActiveIndicator(undefined, { followingScroll: true });
      updateFilterPager();
    }

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
      filterTabs.classList.remove('is-gesture-active');
      if (windowRef.innerWidth <= 1023) {
        // Commit on release and correct sub-pixel drift in the same interaction.
        // Cancelling a queued scroll frame prevents it from restoring swipe styles
        // after the active label has already been committed.
        windowRef.clearTimeout(filterScrollTimer);
        filterScrollTimer = null;
        if (filterScrollFrame !== null) {
          if (typeof windowRef.cancelAnimationFrame === 'function') {
            windowRef.cancelAnimationFrame(filterScrollFrame);
          } else {
            windowRef.clearTimeout(filterScrollFrame);
          }
          filterScrollFrame = null;
        }
        settleCenteredFilter();
      } else {
        scheduleCenteredFilter();
      }
      return;
    }

    filterTabs.classList.remove('is-gesture-active');
    if (!cancelled) scheduleCenteredFilter();
  }

  bind(filterTabs, 'wheel', event => {
    suppressFilterSettleUntil = 0;
    suppressFilterPreviewUntil = 0;
    filterScrollPreviewRequested =
      Math.abs(Number(event?.deltaX) || 0) > Math.abs(Number(event?.deltaY) || 0) ||
      event?.shiftKey === true;
  }, { passive: true });
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
    // Deep links are explicit filter state, not a swipe-settlement request.
    // Centering the selected button emits scroll events; guard those events so
    // an initial centered preview cannot immediately replace the URL filter.
    filterScrollPreviewRequested = false;
    suppressFilterSettleUntil = Date.now() + 750;
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
    // Deep links update selection without a pointer event; place the visible pill
    // on the newly committed category immediately.
    syncFilterActiveIndicator(btn);
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
  bind(windowRef, 'load', () => {
    ensureFilterEdges();
    if (!isExpanded) render();
    const activeButton = filterBtns.find(button =>
      (button.getAttribute('data-filter') || 'all') === currentFilter
    );
    syncFilterActiveIndicator(activeButton);
  });
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
