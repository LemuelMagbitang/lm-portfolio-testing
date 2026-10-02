/*
 * LM. Core — site path resolution
 *
 * Pure site-location helpers. No feature code, network access, or third-party
 * integrations belong here.
 */

function findScriptUrl(fileName = 'script.js') {
  try {
    const scripts = Array.from(document.scripts || []);
    const escapedName = fileName.replace(/\./g, '\\.');
    const pattern = new RegExp(`(?:^|/)js/${escapedName}(?:[?#].*)?$`, 'i');
    const element = scripts.find(node => {
      const raw = node.getAttribute('src') || '';
      const absolute = node.src || '';
      return pattern.test(raw) || pattern.test(absolute);
    });
    return element?.src || '';
  } catch (_) {
    return '';
  }
}

const SITE_SCRIPT_URL = findScriptUrl('script.js');

export function getSiteRootUrl() {
  try {
    if (SITE_SCRIPT_URL) return new URL('../', SITE_SCRIPT_URL).href;

    const configured = window.SITE_ROOT_URL;
    if (configured) {
      return new URL(configured, document.baseURI || window.location.href)
        .href
        .replace(/\/$/, '') + '/';
    }

    const pageUrl = new URL(document.baseURI || window.location.href);
    const path = pageUrl.pathname
      .replace(/\/about(?:\/.*)?$/i, '/')
      .replace(/\/admin(?:\/.*)?$/i, '/')
      .replace(/\/success(?:\/.*)?$/i, '/');

    return new URL(pageUrl.origin + path).href;
  } catch (_) {
    return new URL('./', document.baseURI || window.location.href).href;
  }
}

export function siteAssetUrl(src) {
  if (!src) return '';

  const value = String(src).trim();
  if (
    /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) ||
    /^(?:data|blob):/i.test(value)
  ) {
    return value;
  }

  try {
    return new URL(value.replace(/^\/+/, ''), getSiteRootUrl()).href;
  } catch (_) {
    return value;
  }
}
