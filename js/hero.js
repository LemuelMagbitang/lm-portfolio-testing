/**
 * Architecture V2 — hero configuration and source utilities.
 * The existing hero renderer remains in script.js until its behavior is
 * migrated completely; this module provides the stable contract for V2.
 */

export function normalizeHeroConfig(input = {}) {
  return {
    loopMode: ['latest', 'manual', 'mixed'].includes(input.loopMode) ? input.loopMode : 'latest',
    transitionStyle: ['kenburns', 'fade', 'none'].includes(input.transitionStyle) ? input.transitionStyle : 'kenburns',
    crossfadeMs: Number.isFinite(Number(input.crossfadeMs)) && Number(input.crossfadeMs) >= 500
      ? Number(input.crossfadeMs)
      : 3500,
    reducedMotion: Boolean(input.reducedMotion)
  };
}

export function heroMediaTypeFromSrc(src) {
  const clean = String(src || '').split('?')[0].split('#')[0].toLowerCase();
  if (/\.(mp4|webm|mov|m4v)$/.test(clean)) return 'video';
  if (/\.json$/.test(clean)) return 'lottie';
  return 'image';
}

export function selectHeroSources({ manual = [], latest = [], mode = 'latest', limit = 5 } = {}) {
  const manualItems = Array.isArray(manual) ? manual.filter(Boolean) : [];
  const latestItems = Array.isArray(latest) ? latest.filter(Boolean) : [];
  if (mode === 'manual') return manualItems.slice(0, limit);
  if (mode !== 'mixed') return latestItems.slice(0, limit);

  const result = [];
  const seen = new Set();
  for (const item of [...manualItems, ...latestItems]) {
    const key = `${item.type || heroMediaTypeFromSrc(item.src)}|${item.src || ''}`;
    if (!item.src || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}
