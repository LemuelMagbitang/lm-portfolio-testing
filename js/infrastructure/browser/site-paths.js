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
    // The router snapshots SITE_ROOT_URL before client-side navigation.
    // Prefer that stable absolute value: after pushState(), a relative script
    // src can be re-resolved against /about/ even though the script was loaded
    // from the site root.
    const configured = windowRef?.SITE_ROOT_URL;
    if (configured) {
      return new URL(configured, documentRef?.baseURI || windowRef?.location?.href).href
        .replace(/\/$/, '') + '/';
    }

    const siteScriptUrl = findScriptUrl('script.js', documentRef);
    if (siteScriptUrl) return new URL('../', siteScriptUrl).href;

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
    const siteRoot = new URL(getSiteRootUrl(options));
    const rootPath = siteRoot.pathname.endsWith('/')
      ? siteRoot.pathname
      : siteRoot.pathname + '/';
    const resolved = new URL(value.replace(/^\/+/, ''), siteRoot);
    if (!['http:', 'https:'].includes(resolved.protocol)) return '';
    if (resolved.origin !== siteRoot.origin || !resolved.pathname.startsWith(rootPath)) return '';

    // Defense in depth for paths with encoded separators/dot-segments that
    // survive URL parsing. Normalize each decoding layer against the origin
    // so traversal is never re-based beneath the project prefix by accident.
    let decodedPath = resolved.pathname;
    while (true) {
      const decoded = decodedPath
        .replace(/%25/gi, '%')
        .replace(/%2e/gi, '.')
        .replace(/%2f/gi, '/')
        .replace(/%5c/gi, '/');
      if (decoded === decodedPath) break;
      if (/[\u0000-\u001f\u007f]/.test(decoded) ||
          /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(decoded) ||
          decoded.split('/').some(segment => segment === '.' || segment === '..')) return '';
      const normalizedDecoded = new URL(decoded, siteRoot.origin);
      if (normalizedDecoded.origin !== siteRoot.origin ||
          !normalizedDecoded.pathname.startsWith(rootPath)) return '';
      decodedPath = decoded;
    }
    return resolved.href;
  } catch (_) {
    return '';
  }
}
