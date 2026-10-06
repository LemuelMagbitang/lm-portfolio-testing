/**
 * Site settings feature.
 * Fetches CMS settings, normalizes them, updates CMS-driven DOM values,
 * and exposes the resulting runtime configuration to the composition root.
 */

import {
  DEFAULT_SITE_SETTINGS,
  normalizeSiteSettings
} from '../../data/site-settings.js';

const SOCIAL_LABELS = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube'
};

export async function initSiteSettings({
  url,
  root = globalThis.document,
  loadJson,
  resolveAssetUrl,
  getSiteRootUrl,
  defaults = DEFAULT_SITE_SETTINGS
} = {}) {
  let state = normalizeSiteSettings({}, defaults);

  function setHiddenField(formId, fieldName, value) {
    if (!value) return;
    const form = root?.getElementById(formId);
    const input = form?.querySelector(`input[name="${fieldName}"]`);
    if (input) input.value = value;
  }

  function applyOgMeta(settings) {
    if (!settings.ogImage || typeof getSiteRootUrl !== 'function') return;
    try {
      const rootUrl = getSiteRootUrl();
      const imageUrl = new URL(
        settings.ogImage + (settings.ogImageVersion ? `?v=${encodeURIComponent(settings.ogImageVersion)}` : ''),
        rootUrl
      ).href;

      root?.querySelectorAll('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"]')
        .forEach(meta => meta.setAttribute('content', imageUrl));

      if (settings.ogImageAlt) {
        root?.querySelectorAll('meta[property="og:image:alt"]')
          .forEach(meta => meta.setAttribute('content', settings.ogImageAlt));
      }
    } catch (_) {
      // Keep the static HTML fallback when runtime URL resolution fails.
    }
  }

  function applyDom(settings) {

    if (settings.contactEmail) {
      root?.querySelectorAll('a[href^="mailto:"]').forEach(anchor => {
        const query = anchor.getAttribute('href')?.split('?')[1];
        anchor.href = `mailto:${settings.contactEmail}${query ? `?${query}` : ''}`;
      });
    }

    Object.entries(SOCIAL_LABELS).forEach(([key, label]) => {
      const href = settings.socials[key];
      if (!href) return;
      root?.querySelectorAll(`a[aria-label="${label}"]`).forEach(anchor => { anchor.href = href; });
    });

    setHiddenField('projectForm', 'apikey', settings.web3forms.projectKey);
    setHiddenField('reviewForm', 'apikey', settings.web3forms.reviewKey);
    setHiddenField('projectForm', 'redirect', settings.redirectUrl);
    setHiddenField('reviewForm', 'redirect', settings.redirectUrl);

    if (settings.siteTitle) root.defaultView.document.title = settings.siteTitle;
    applyOgMeta(settings);
  }

  if (url && typeof loadJson === 'function') {
    try {
      const raw = await loadJson(url, null, { resolveUrl: resolveAssetUrl });
      state = normalizeSiteSettings(raw, defaults);
      applyDom(state);
    } catch (error) {
      console.warn('Settings: could not load', url, error);
    }
  }

  return {
    getState: () => ({ ...state, formsEnabled: { ...state.formsEnabled }, heroTiming: { ...state.heroTiming } }),
    applyDom: () => applyDom(state),
    state
  };
}
