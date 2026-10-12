/**
 * Contact/review form feature.
 * Owns form visibility and email fallback behavior.
 */

export function initForms({
  root = globalThis.document,
  projectEnabled = true,
  reviewEnabled = true
} = {}) {
  const projectForm = root?.getElementById('projectForm');
  const projectEmailBtn = root?.getElementById('projectEmailBtn');
  const reviewForm = root?.getElementById('reviewForm');
  const reviewEmailBtn = root?.getElementById('reviewEmailBtn');

  const contactTabs = Array.from(root?.querySelectorAll?.('.contact-mobile-tab') || []);
  const contactPanels = Array.from(root?.querySelectorAll?.('[data-contact-panel]') || []);
  const windowRef = root?.defaultView || globalThis.window;

  function applyFormToggle(form, emailButton, enabled) {
    if (!form || !emailButton) return;
    form.style.display = enabled ? '' : 'none';
    emailButton.style.display = enabled ? 'none' : '';
  }

  function syncContactPanelAccessibility() {
    const isMobile = Boolean(windowRef?.matchMedia?.('(max-width: 767px)')?.matches);
    contactPanels.forEach(panel => {
      const hidden = isMobile && !panel.classList?.contains?.('is-contact-active');
      panel.setAttribute('aria-hidden', String(Boolean(hidden)));

      // The tab controls are only presented on mobile. Expose complete tab-panel
      // semantics there, while keeping the two desktop contact sections standalone.
      if (!isMobile) {
        panel.removeAttribute('role');
        panel.removeAttribute('aria-labelledby');
        return;
      }

      panel.setAttribute('role', 'tabpanel');
      const panelKind = panel.getAttribute('data-contact-panel') || '';
      const tab = contactTabs.find(candidate =>
        candidate.getAttribute('data-contact-tab') === panelKind
      );
      if (tab?.id) panel.setAttribute('aria-labelledby', tab.id);
      else panel.removeAttribute('aria-labelledby');
    });
  }

  const contactResizeHandler = () => syncContactPanelAccessibility();

  function routeToEmail(emailButton) {
    const href = emailButton?.getAttribute('href') || '';
    if (href && root?.defaultView?.location) {
      root.defaultView.location.href = href;
    }
  }

  const projectEmailHandler = () => routeToEmail(projectEmailBtn);
  const reviewEmailHandler = () => routeToEmail(reviewEmailBtn);

  function setActiveContactTab(kind, focusPanel = false) {
    if (!contactTabs.length || !contactPanels.length) return;
    const targetKind = kind === 'review' ? 'review' : 'project';
    const previousPanel = contactPanels.find(panel => panel.classList.contains('is-contact-active'));
    const nextPanel = contactPanels.find(panel => panel.getAttribute('data-contact-panel') === targetKind);
    const grid = root.querySelector('#contact-section .contact-grid');
    const shouldAnimate = Boolean(
      windowRef?.matchMedia?.('(max-width: 767px)')?.matches &&
      !windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches &&
      previousPanel && nextPanel && previousPanel !== nextPanel && grid &&
      typeof grid.animate === 'function' && typeof nextPanel.animate === 'function'
    );
    const previousHeight = shouldAnimate ? grid.getBoundingClientRect().height : 0;

    contactTabs.forEach(tab => {
      const active = tab.getAttribute('data-contact-tab') === targetKind;
      tab.setAttribute('aria-selected', String(active));
      tab.classList.toggle('is-active', active);
      tab.tabIndex = active ? 0 : -1;
    });
    const tabRail = contactTabs[0]?.parentElement;
    if (tabRail) tabRail.setAttribute('data-active', targetKind);

    contactPanels.forEach(panel => {
      const active = panel.getAttribute('data-contact-panel') === targetKind;
      panel.classList.toggle('is-contact-active', active);
    });
    syncContactPanelAccessibility();

    if (shouldAnimate) {
      const nextHeight = nextPanel.getBoundingClientRect().height;
      grid.style.height = previousHeight + 'px';
      grid.style.overflow = 'hidden';
      const heightAnimation = grid.animate(
        [{ height: previousHeight + 'px' }, { height: nextHeight + 'px' }],
        { duration: 340, easing: 'cubic-bezier(.22,1,.36,1)' }
      );
      heightAnimation.onfinish = () => {
        grid.style.removeProperty('height');
        grid.style.removeProperty('overflow');
        heightAnimation.cancel();
      };
      const panelAnimation = nextPanel.animate(
        [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'translate3d(0,0,0)' }],
        { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' }
      );
      panelAnimation.onfinish = () => panelAnimation.cancel();
    }

    if (focusPanel) {
      nextPanel?.scrollIntoView?.({
        block: 'nearest',
        behavior: windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth'
      });
    }
  }

  const contactTabHandlers = new Map();
  const contactTabKeyHandlers = new Map();
  contactTabs.forEach(tab => {
    const handler = () => setActiveContactTab(tab.getAttribute('data-contact-tab') || 'project');
    const keyHandler = event => {
      const currentIndex = contactTabs.indexOf(tab);
      const key = event?.key;
      let nextIndex;

      if (key === 'ArrowRight') nextIndex = (currentIndex + 1) % contactTabs.length;
      else if (key === 'ArrowLeft') nextIndex = (currentIndex - 1 + contactTabs.length) % contactTabs.length;
      else if (key === 'Home') nextIndex = 0;
      else if (key === 'End') nextIndex = contactTabs.length - 1;
      else return;

      event?.preventDefault?.();
      const nextTab = contactTabs[nextIndex];
      if (!nextTab) return;
      setActiveContactTab(nextTab.getAttribute('data-contact-tab') || 'project');
      nextTab.focus?.();
    };
    contactTabHandlers.set(tab, handler);
    contactTabKeyHandlers.set(tab, keyHandler);
    tab.addEventListener('click', handler);
    tab.addEventListener('keydown', keyHandler);
  });

  const contactTabRail = contactTabs[0]?.parentElement || null;
  let activeContactDrag = null;
  let suppressDragClick = false;
  let dragClickResetTimer = null;

  function clearDragClickReset() {
    if (dragClickResetTimer === null) return;
    const clearTimer = windowRef?.clearTimeout?.bind(windowRef) || globalThis.clearTimeout;
    clearTimer(dragClickResetTimer);
    dragClickResetTimer = null;
  }

  function tabAtClientX(clientX) {
    return contactTabs.find(tab => {
      const bounds = tab.getBoundingClientRect?.();
      return bounds && clientX >= bounds.left && clientX <= bounds.right;
    }) || null;
  }

  const contactDragStartHandler = event => {
    const startTab = contactTabs.find(tab => tab === event?.target || tab.contains?.(event?.target));
    if (!contactTabRail ||
        !windowRef?.matchMedia?.('(max-width: 767px)')?.matches ||
        event?.pointerType !== 'touch' ||
        event?.isPrimary === false ||
        (event?.button !== undefined && event.button !== 0) ||
        !startTab) {
      activeContactDrag = null;
      return;
    }

    activeContactDrag = {
      pointerId: event.pointerId,
      startX: Number.isFinite(Number(event.clientX)) ? Number(event.clientX) : 0,
      startY: Number.isFinite(Number(event.clientY)) ? Number(event.clientY) : 0,
      lastX: Number.isFinite(Number(event.clientX)) ? Number(event.clientX) : 0,
      dragging: false
    };
  };

  const contactDragMoveHandler = event => {
    const drag = activeContactDrag;
    if (!drag || event?.pointerId !== drag.pointerId ||
        !windowRef?.matchMedia?.('(max-width: 767px)')?.matches) return;

    const x = Number.isFinite(Number(event.clientX)) ? Number(event.clientX) : drag.lastX;
    const y = Number.isFinite(Number(event.clientY)) ? Number(event.clientY) : drag.startY;
    const deltaX = x - drag.startX;
    const deltaY = y - drag.startY;

    // Let vertical movement remain native page scrolling. A horizontal drag
    // starts with a small threshold and selects whichever tab is under the finger.
    if (!drag.dragging) {
      if (Math.abs(deltaY) > 10 && Math.abs(deltaY) >= Math.abs(deltaX)) {
        activeContactDrag = null;
        return;
      }
      if (Math.abs(deltaX) < 8 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
      drag.dragging = true;
    }

    drag.lastX = x;
    const hoveredTab = tabAtClientX(x);
    if (hoveredTab && hoveredTab.getAttribute('aria-selected') !== 'true') {
      setActiveContactTab(hoveredTab.getAttribute('data-contact-tab') || 'project');
    }
  };

  const contactDragEndHandler = event => {
    const drag = activeContactDrag;
    activeContactDrag = null;
    if (!drag || event?.pointerId !== drag.pointerId ||
        !windowRef?.matchMedia?.('(max-width: 767px)')?.matches ||
        !drag.dragging) return;

    // Swallow only the click generated by a completed drag; a normal tap still
    // uses the tab's regular click handler.
    suppressDragClick = true;
    clearDragClickReset();
    const scheduleReset = windowRef?.setTimeout?.bind(windowRef) || globalThis.setTimeout;
    dragClickResetTimer = scheduleReset(() => {
      suppressDragClick = false;
      dragClickResetTimer = null;
    }, 0);
  };

  const contactDragCancelHandler = event => {
    if (!event || !activeContactDrag || event.pointerId === activeContactDrag.pointerId) {
      activeContactDrag = null;
    }
  };

  const contactDragClickHandler = event => {
    if (!suppressDragClick) return;
    suppressDragClick = false;
    clearDragClickReset();
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
  };

  if (contactTabs.length && contactPanels.length) {
    if (contactTabRail) {
      contactTabRail.addEventListener('pointerdown', contactDragStartHandler, { passive: true });
      contactTabRail.addEventListener('pointermove', contactDragMoveHandler, { passive: true });
      contactTabRail.addEventListener('pointerup', contactDragEndHandler, { passive: true });
      contactTabRail.addEventListener('pointercancel', contactDragCancelHandler, { passive: true });
      contactTabRail.addEventListener('click', contactDragClickHandler, true);
    }
    windowRef?.addEventListener?.('resize', contactResizeHandler);
    setActiveContactTab('project');
  }

  projectEmailBtn?.addEventListener('click', projectEmailHandler);
  reviewEmailBtn?.addEventListener('click', reviewEmailHandler);

  function setProjectEnabled(enabled) {
    projectEnabled = Boolean(enabled);
    applyFormToggle(projectForm, projectEmailBtn, projectEnabled);
  }

  function setReviewEnabled(enabled) {
    reviewEnabled = Boolean(enabled);
    applyFormToggle(reviewForm, reviewEmailBtn, reviewEnabled);
  }

  setProjectEnabled(projectEnabled);
  setReviewEnabled(reviewEnabled);

  return {
    setProjectEnabled,
    setReviewEnabled,
    setEnabled(kind, enabled) {
      if (kind === 'project') setProjectEnabled(enabled);
      if (kind === 'review') setReviewEnabled(enabled);
    },
    cleanup() {
      windowRef?.removeEventListener?.('resize', contactResizeHandler);
      activeContactDrag = null;
      suppressDragClick = false;
      clearDragClickReset();
      contactTabRail?.removeEventListener('pointerdown', contactDragStartHandler);
      contactTabRail?.removeEventListener('pointermove', contactDragMoveHandler);
      contactTabRail?.removeEventListener('pointerup', contactDragEndHandler);
      contactTabRail?.removeEventListener('pointercancel', contactDragCancelHandler);
      contactTabRail?.removeEventListener('click', contactDragClickHandler, true);
      projectEmailBtn?.removeEventListener('click', projectEmailHandler);
      reviewEmailBtn?.removeEventListener('click', reviewEmailHandler);
      contactTabHandlers.forEach((handler, tab) => tab.removeEventListener('click', handler));
      contactTabHandlers.clear();
      contactTabKeyHandlers.forEach((handler, tab) => tab.removeEventListener('keydown', handler));
      contactTabKeyHandlers.clear();
    }
  };
}
