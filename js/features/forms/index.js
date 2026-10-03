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
    }
  };
}
