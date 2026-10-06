/**
 * Site settings feature.
 * Fetches CMS settings, normalizes them, updates CMS-driven DOM values,
 * and exposes the resulting runtime configuration to the composition root.
 */

import {
  DEFAULT_SITE_SETTINGS,
  normalizeSiteSettings,
  SOCIAL_PLATFORMS
} from '../../data/site-settings.js?v=20261006-01';

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

  function renderSocials(settings) {
    const documentRef = root?.ownerDocument || root;
    if (!documentRef || typeof documentRef.createElement !== 'function') return;

    const links = SOCIAL_PLATFORMS
      .filter(platform => settings.socials?.[platform.key])
      .map(platform => ({
        ...platform,
        href: settings.socials[platform.key]
      }));

    root?.querySelectorAll('.social-icons').forEach(container => {
      const fragment = documentRef.createDocumentFragment();

      links.forEach(platform => {
        const anchor = documentRef.createElement('a');
        anchor.href = platform.href;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.setAttribute('aria-label', platform.label);

        const icon = documentRef.createElement('i');
        icon.className = platform.icon;
        anchor.appendChild(icon);
        fragment.appendChild(anchor);
      });

      if (settings.contactEmail) {
        const email = documentRef.createElement('a');
        email.href = `mailto:${settings.contactEmail}`;
        email.setAttribute('aria-label', 'Email');

        const icon = documentRef.createElement('i');
        icon.className = 'fa-solid fa-envelope';
        email.appendChild(icon);
        fragment.appendChild(email);
      }

      container.replaceChildren(fragment);
    });
  }

  function applyDom(settings) {

    renderSocials(settings);

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
