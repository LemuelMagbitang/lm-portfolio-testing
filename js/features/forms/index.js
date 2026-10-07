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

  function applyFormToggle(form, emailButton, enabled) {
    if (!form || !emailButton) return;
    form.style.display = enabled ? '' : 'none';
    emailButton.style.display = enabled ? 'none' : '';
  }

  function getContactHref() {
    return root?.querySelector('a[href^="mailto:"]')?.getAttribute('href') || '';
  }

  function routeToEmail() {
    const href = getContactHref();
    if (href) root.defaultView.location.href = href;
  }

  function setActiveContactTab(kind, focusPanel = false) {
    if (!contactTabs.length || !contactPanels.length) return;
    const targetKind = kind === 'review' ? 'review' : 'project';

    contactTabs.forEach(tab => {
      const active = tab.getAttribute('data-contact-tab') === targetKind;
      tab.setAttribute('aria-selected', String(active));
      tab.classList.toggle('is-active', active);
      tab.tabIndex = active ? 0 : -1;
    });

    contactPanels.forEach(panel => {
      const active = panel.getAttribute('data-contact-panel') === targetKind;
      panel.classList.toggle('is-contact-active', active);
    });

    if (focusPanel) {
      const panel = contactPanels.find(item => item.getAttribute('data-contact-panel') === targetKind);
      panel?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }
  }

  const contactTabHandlers = new Map();
  contactTabs.forEach(tab => {
    const handler = () => setActiveContactTab(tab.getAttribute('data-contact-tab') || 'project');
    contactTabHandlers.set(tab, handler);
    tab.addEventListener('click', handler);
  });

  if (contactTabs.length && contactPanels.length) {
    setActiveContactTab('project');
  }

  projectEmailBtn?.addEventListener('click', routeToEmail);
  reviewEmailBtn?.addEventListener('click', routeToEmail);

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
      projectEmailBtn?.removeEventListener('click', routeToEmail);
      reviewEmailBtn?.removeEventListener('click', routeToEmail);
      contactTabHandlers.forEach((handler, tab) => tab.removeEventListener('click', handler));
      contactTabHandlers.clear();
    }
  };
}
