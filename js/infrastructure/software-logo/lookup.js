/**
 * Automatic software-logo lookup adapter.
 *
 * Uses a pinned Simple Icons CDN asset first for common software names, then
 * Iconify Search as a discovery fallback. UI code preloads candidates before
 * attaching them, so failed URLs never become visible broken-image icons.
 */

const SIMPLE_ICONS_VERSION = '16.33.0';
const cache = new Map();
const pending = new Map();

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

export async function findSoftwareLogoCandidates(name, fetchRef = globalThis.fetch?.bind(globalThis)) {
  const rawName = String(name || '').trim();
  if (!rawName) return [];

  const lowered = rawName.toLowerCase();
  const aliasSlug = SOFTWARE_ALIASES[lowered] || '';
  const normalizedName = normalize(rawName);
  const key = aliasSlug || normalizedName;

  if (!key) return [];
  if (cache.has(key)) return cache.get(key);
  if (pending.has(key)) return pending.get(key);

  const request = (async () => {
    const candidates = [simpleIconsUrl(aliasSlug || normalizedName)];

    if (typeof fetchRef === 'function') {
      try {
        const response = await fetchRef(
          'https://api.iconify.design/search?query='
          + encodeURIComponent(rawName)
          + '&prefixes=simple-icons,logos&limit=12',
          { headers: { Accept: 'application/json' } }
        );

        if (response.ok) {
          const payload = await response.json();
          const discovered = (Array.isArray(payload?.icons) ? payload.icons : [])
            .map(icon => ({ icon, score: scoreIcon(icon, normalizedName) }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .map(item => iconifyIconUrl(item.icon))
            .filter(Boolean);

          const seen = new Set(candidates);
          discovered.forEach(url => {
            if (!seen.has(url)) {
              seen.add(url);
              candidates.push(url);
            }
          });
        }
      } catch (_) {
        // Direct Simple Icons remains usable without discovery.
      }
    }

    cache.set(key, candidates);
    return candidates;
  })().finally(() => pending.delete(key));

  pending.set(key, request);
  return request;
}
