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
  contactTabs.forEach(tab => {
    const handler = () => setActiveContactTab(tab.getAttribute('data-contact-tab') || 'project');
    contactTabHandlers.set(tab, handler);
    tab.addEventListener('click', handler);
  });

  if (contactTabs.length && contactPanels.length) {
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
      projectEmailBtn?.removeEventListener('click', projectEmailHandler);
      reviewEmailBtn?.removeEventListener('click', reviewEmailHandler);
      contactTabHandlers.forEach((handler, tab) => tab.removeEventListener('click', handler));
      contactTabHandlers.clear();
    }
  };
}
