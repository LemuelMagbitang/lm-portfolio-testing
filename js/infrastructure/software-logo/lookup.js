/**
 * Automatic software-logo lookup adapter.
 *
 * Common software gets a deterministic, pinned Simple Icons CDN candidate.
 * Only when that direct candidate fails does the UI request Iconify Search
 * for a broader match. Candidate images are preloaded before being mounted.
 */

const SIMPLE_ICONS_VERSION = '16.33.0';

const SOFTWARE_ALIASES = {
  'blender':'blender',
  'krita':'krita',
  'figma':'figma',
  'youtube':'youtube',
  'after effects':'adobeaftereffects',
  'adobe after effects':'adobeaftereffects',
  'premier pro':'adobepremierepro',
  'premiere pro':'adobepremierepro',
  'adobe premiere pro':'adobepremierepro',
  'photoshop':'adobephotoshop',
  'adobe photoshop':'adobephotoshop',
  'illustrator':'adobeillustrator',
  'adobe illustrator':'adobeillustrator',
  'davinci resolve':'davinciresolve',
  'da vinci resolve':'davinciresolve',
  'cinema 4d':'cinema4d',
  'maya':'autodeskmaya',
  'autodesk maya':'autodeskmaya',
  '3ds max':'3dsmax',
  'zbrush':'zbrush',
  'unity':'unity',
  'unreal engine':'unrealengine',
  'procreate':'procreate',
  'clip studio paint':'clipstudiopaint',
  'substance painter':'substancepainter',
  'houdini':'houdini',
  'sketchup':'sketchup'
};

const discoveryCache = new Map();
const discoveryPending = new Map();

function normalize(value = '') {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function simpleIconsUrl(slug) {
  return 'https://cdn.jsdelivr.net/npm/simple-icons@' + SIMPLE_ICONS_VERSION
    + '/icons/' + encodeURIComponent(slug) + '.svg';
}

function iconifyIconUrl(iconId) {
  const parts = String(iconId || '').split(':');
  const prefix = parts.shift();
  const iconName = parts.join(':');
  if (!prefix || !iconName) return '';
  return 'https://api.iconify.design/' + encodeURIComponent(prefix) + '/'
    + encodeURIComponent(iconName) + '.svg';
}

function scoreIcon(iconId, query) {
  const rawName = String(iconId || '').split(':').pop() || '';
  const normalized = normalize(rawName);
  if (!normalized) return -1;
  if (normalized === query) return 1000;
  if (normalized.includes(query)) return 700 - Math.abs(normalized.length - query.length);
  if (query.includes(normalized)) return 600 - Math.abs(normalized.length - query.length);
  return 0;
}

export function getSoftwareLogoDirectCandidates(name) {
  const raw = String(name || '').trim();
  if (!raw) return [];
  const slug = SOFTWARE_ALIASES[raw.toLowerCase()] || normalize(raw);
  return slug ? [simpleIconsUrl(slug)] : [];
}

export async function findSoftwareLogoDiscoveryCandidates(
  name,
  fetchRef = globalThis.fetch?.bind(globalThis)
) {
  const rawName = String(name || '').trim();
  const key = normalize(rawName);
  if (!rawName || !key || typeof fetchRef !== 'function') return [];
  if (discoveryCache.has(key)) return discoveryCache.get(key);
  if (discoveryPending.has(key)) return discoveryPending.get(key);

  const request = (async () => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 2500) : null;

    try {
      const response = await fetchRef(
        'https://api.iconify.design/search?query='
        + encodeURIComponent(rawName)
        + '&prefixes=simple-icons,logos&limit=12',
        {
          headers: { Accept: 'application/json' },
          ...(controller ? { signal: controller.signal } : {})
        }
      );

      if (!response.ok) return [];

      const payload = await response.json();
      return (Array.isArray(payload?.icons) ? payload.icons : [])
        .map(icon => ({ icon, score: scoreIcon(icon, key) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(item => iconifyIconUrl(item.icon))
        .filter(Boolean);
    } catch (_) {
      return [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();

  discoveryPending.set(key, request);
  const result = await request;
  discoveryPending.delete(key);
  discoveryCache.set(key, result);
  return result;
}

// Kept as the feature-facing convenience API. It returns the deterministic
// direct candidate immediately; discovery is requested by the feature only
// after the direct candidate fails.
export function findSoftwareLogoCandidates(name) {
  return getSoftwareLogoDirectCandidates(name);
}
