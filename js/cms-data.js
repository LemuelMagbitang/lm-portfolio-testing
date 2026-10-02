/**
 * Compatibility facade for the legacy CMS-data import path.
 *
 * New code should import CMS retrieval from ./data/cms-loader.js. Keeping this
 * facade temporarily lets feature migration happen without a flag-day rewrite.
 */

export { resolveCmsUrl, loadCmsJson } from './data/cms-loader.js';

export function parseYouTubeUrl(url) {
  const value = String(url || '');
  let id = null;
  let isShort = false;
  if (value.includes('/shorts/')) {
    id = value.split('/shorts/')[1].split(/[?&]/)[0];
    isShort = true;
  } else if (value.includes('youtu.be/')) {
    id = value.split('youtu.be/')[1].split(/[?&]/)[0];
  } else if (value.includes('watch?v=')) {
    id = value.split('watch?v=')[1].split('&')[0];
  } else if (value.includes('/embed/')) {
    id = value.split('/embed/')[1].split(/[?&]/)[0];
  }
  return { id, isShort };
}
