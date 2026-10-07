/**
 * Automatic software-logo lookup adapter.
 *
 * This follows the known-good portfolio implementation from the
 * architecture-security-hardening branch and deployed main repo:
 * Simple Icons direct lookup first, then Iconify discovery as a final fallback for names outside the common
 * software list.
 */

const SOFTWARE_DOMAINS = {
  krita: 'krita.org',
  blender: 'blender.org',
  figma: 'figma.com',
  'davinci resolve': 'blackmagicdesign.com',
  'cinema 4d': 'maxon.net',
  zbrush: 'maxon.net',
  maya: 'autodesk.com',
  '3ds max': 'autodesk.com',
  'autodesk maya': 'autodesk.com',
  unity: 'unity.com',
  'unreal engine': 'unrealengine.com',
  procreate: 'procreate.com',
  sketch: 'sketch.com',
  sketchup: 'sketchup.com',
  'substance painter': 'substance3d.com',
  'substance designer': 'substance3d.com',
  'affinity photo': 'affinity.serif.com',
  'affinity designer': 'affinity.serif.com',
  houdini: 'sidefx.com',
  'clip studio paint': 'clipstudio.net'
};

const SOFTWARE_ALIASES = {
  'premier pro': 'adobepremierepro',
  'premiere pro': 'adobepremierepro',
  'adobe premier pro': 'adobepremierepro',
  'adobe premiere pro': 'adobepremierepro',
  'after effects': 'adobeaftereffects',
  'adobe after effects': 'adobeaftereffects',
  'photoshop': 'adobephotoshop',
  'adobe photoshop': 'adobephotoshop',
  'illustrator': 'adobeillustrator',
  'adobe illustrator': 'adobeillustrator'
};

// Local assets cover the software already represented by this portfolio.
// Remote Simple Icons / Iconify discovery remains available for newly typed
// programs, so the CMS stays automatic without making the live site depend
// on a third-party logo CDN for known entries.
const BUNDLED_SOFTWARE_LOGOS = {
  blender: 'assets/projects/site/logos/blender_icon_512x512.png',
  figma: 'assets/projects/site/logos/figma.png',
  krita: 'assets/projects/site/logos/krita.png',
  adobepremierepro: 'assets/projects/site/logos/adobe-premiew-pro-cc.png',
  adobeaftereffects: 'assets/projects/site/logos/adobe-after-effects-cc.png',
  adobephotoshop: 'assets/projects/site/logos/adobe-photoshop-cc.png',
  adobeillustrator: 'assets/projects/site/logos/adobe-illustrator-cc.png'
};

const cache = new Map();
const discoveryCache = new Map();
const discoveryPending = new Map();

function normalize(value = '') {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function slugFor(name) {
  const raw = String(name || '').trim().toLowerCase();
  return SOFTWARE_ALIASES[raw] || normalize(raw);
}

function simpleIconsUrl(slug) {
  return 'https://cdn.simpleicons.org/' + encodeURIComponent(slug);
}


function iconifyUrl(iconId) {
  const parts = String(iconId || '').split(':');
  const prefix = parts.shift();
  const name = parts.join(':');
  return prefix && name
    ? 'https://api.iconify.design/' + encodeURIComponent(prefix) + '/' + encodeURIComponent(name) + '.svg'
    : '';
}

function scoreIcon(iconId, query) {
  const iconName = String(iconId || '').split(':').pop() || '';
  const normalized = normalize(iconName);
  if (!normalized) return -1;
  if (normalized === query) return 1000;
  if (normalized.includes(query)) return 800 - Math.abs(normalized.length - query.length);
  if (query.includes(normalized)) return 700 - Math.abs(normalized.length - query.length);
  return 0;
}

export function getSoftwareLogoDirectCandidates(name) {
  const raw = String(name || '').trim().toLowerCase();
  if (!raw) return [];

  const candidates = [];
  const slug = slugFor(raw);
  if (!slug) return [];

  const bundled = BUNDLED_SOFTWARE_LOGOS[slug];
  if (bundled) candidates.push(bundled);

  const remote = simpleIconsUrl(slug);
  if (remote) candidates.push(remote);

  return candidates;
}

export async function findSoftwareLogoDiscoveryCandidates(
  name,
  fetchRef = globalThis.fetch?.bind(globalThis)
) {
  const raw = String(name || '').trim();
  const key = normalize(raw);
  if (!raw || !key || typeof fetchRef !== 'function') return [];
  if (discoveryCache.has(key)) return discoveryCache.get(key);
  if (discoveryPending.has(key)) return discoveryPending.get(key);

  const request = (async () => {
    try {
      const response = await fetchRef(
        'https://api.iconify.design/search?query=' + encodeURIComponent(raw)
        + '&prefixes=simple-icons,logos&limit=12',
        { headers: { Accept: 'application/json' } }
      );
      if (!response.ok) return [];

      const payload = await response.json();
      return (Array.isArray(payload?.icons) ? payload.icons : [])
        .map(icon => ({ icon, score: scoreIcon(icon, key) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(item => iconifyUrl(item.icon))
        .filter(Boolean);
    } catch (_) {
      return [];
    }
  })();

  discoveryPending.set(key, request);
  const result = await request;
  discoveryPending.delete(key);
  discoveryCache.set(key, result);
  return result;
}

export function findSoftwareLogoCandidates(name) {
  const raw = String(name || '').trim().toLowerCase();
  const key = normalize(raw);
  if (!key) return [];
  if (cache.has(key)) return cache.get(key);

  const candidates = getSoftwareLogoDirectCandidates(raw);
  cache.set(key, candidates);
  return candidates;
}
