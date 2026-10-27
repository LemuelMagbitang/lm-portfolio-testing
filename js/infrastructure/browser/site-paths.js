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

function hasUnsafeAssetPathSegments(value) {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return true;

  // Reject literal, slash-encoded, and nested URL-encoded traversal before
  // URL() normalizes the path. That keeps local media inside a GitHub Pages
  // repository prefix instead of silently resolving against the domain root.
  const candidates = [raw];
  let candidate = raw;
  for (let decodeStep = 0; decodeStep < 3; decodeStep += 1) {
    let decoded;
    try {
      decoded = decodeURIComponent(candidate).replace(/\\/g, '/');
    } catch (_) {
      break;
    }
    if (decoded === candidate) break;
    candidates.push(decoded);
    candidate = decoded;
  }

  return candidates.some(path =>
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.split('/').some(segment => segment === '.' || segment === '..')
  );
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

  // Ignore query/hash text when checking path segments so harmless URL
  // parameters cannot be mistaken for traversal.
  const pathOnly = value.split(/[?#]/, 1)[0];
  if (hasUnsafeAssetPathSegments(pathOnly)) return '';

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
