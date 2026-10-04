/*
 * LM. Infrastructure — browser/deployment path resolution
 *
 * Site-root discovery depends on the current document and deployment URL, so
 * it belongs to the browser infrastructure boundary rather than core logic.
 */

function findScriptUrl(fileName = 'script.js', documentRef = globalThis.document) {
  try {
    if (!documentRef) return '';
    const scripts = Array.from(documentRef.scripts || []);
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

export function getSiteRootUrl({
  documentRef = globalThis.document,
  windowRef = globalThis.window
} = {}) {
  try {
    const siteScriptUrl = findScriptUrl('script.js', documentRef);
    if (siteScriptUrl) return new URL('../', siteScriptUrl).href;

    const configured = windowRef?.SITE_ROOT_URL;
    if (configured) {
      return new URL(configured, documentRef?.baseURI || windowRef?.location?.href).href
        .replace(/\/$/, '') + '/';
    }

    const baseUri = documentRef?.baseURI || windowRef?.location?.href;
    const pageUrl = new URL(baseUri);
    const path = pageUrl.pathname
      .replace(/\/about(?:\/.*)?$/i, '/')
      .replace(/\/admin(?:\/.*)?$/i, '/')
      .replace(/\/success(?:\/.*)?$/i, '/');

    return new URL(pageUrl.origin + path).href;
  } catch (_) {
    const baseUri = documentRef?.baseURI || windowRef?.location?.href || './';
    return new URL('./', baseUri).href;
  }
}

export function siteAssetUrl(src, options = {}) {
  if (!src) return '';

  const value = String(src).trim();
  if (
    /^https?:\/\//i.test(value) ||
    /^\/\//.test(value) ||
    /^(?:data|blob):/i.test(value)
  ) {
    return value;
  }

  // Asset URLs are a trust boundary: relative paths and HTTP(S) resources are
  // supported, while executable or otherwise unsupported URI schemes are not.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return '';

  try {
    const resolved = new URL(
      value.replace(/^\/+/, ''),
      getSiteRootUrl(options)
    );
    if (!['http:', 'https:'].includes(resolved.protocol)) return '';
    return resolved.href;
  } catch (_) {
    return '';
  }
}
