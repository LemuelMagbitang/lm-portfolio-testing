/**
 * Software-logo lookup adapter.
 *
 * Searches Iconify's brand-logo sets by the software name entered in CMS
 * and returns image URLs. The public site does not write these URLs back
 * into CMS content.
 */

const cache = new Map();
const pending = new Map();

const QUERY_ALIASES = {
  'premier pro': 'premiere pro',
  'adobe premier pro': 'adobe premiere pro',
  'after effects': 'adobe after effects',
  'ae': 'adobe after effects',
  'photoshop': 'adobe photoshop',
  'ps': 'adobe photoshop',
  'illustrator': 'adobe illustrator',
  'ai': 'adobe illustrator',
  'youtube': 'youtube'
};

function normalize(value = '') {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
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
  if (!rawName || typeof fetchRef !== 'function') return [];

  const queryText = QUERY_ALIASES[rawName.toLowerCase()] || rawName;
  const key = normalize(queryText);
  if (!key) return [];
  if (cache.has(key)) return cache.get(key);
  if (pending.has(key)) return pending.get(key);

  const url = 'https://api.iconify.design/search?query='
    + encodeURIComponent(queryText)
    + '&prefixes=simple-icons,logos&limit=12';

  const request = fetchRef(url, { headers: { Accept: 'application/json' } })
    .then(async response => {
      if (!response.ok) return [];
      const payload = await response.json();
      const icons = Array.isArray(payload?.icons) ? payload.icons : [];
      const sorted = icons
        .map(icon => ({ icon, score: scoreIcon(icon, key) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(item => item.icon);

      const urls = sorted.map(iconId => {
        const parts = String(iconId).split(':');
        const prefix = parts.shift();
        const iconName = parts.join(':');
        return 'https://api.iconify.design/'
          + encodeURIComponent(prefix)
          + '/'
          + encodeURIComponent(iconName)
          + '.svg';
      });

      cache.set(key, urls);
      return urls;
    })
    .catch(() => {
      cache.set(key, []);
      return [];
    })
    .finally(() => pending.delete(key));

  pending.set(key, request);
  return request;
}
