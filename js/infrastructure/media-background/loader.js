/*
 * Media-background infrastructure adapter.
 *
 * Feature code asks for the optional global capability without owning the
 * loading mechanism or the site-root calculation.
 */

import { loadScriptOnce } from '../browser/script-loader.js';
import { getSiteRootUrl } from '../browser/site-paths.js';

let mediaBackgroundPromise = null;

export function ensureMediaBackgroundHelper() {
  if (window.LMMediaBackground) return Promise.resolve(true);
  if (mediaBackgroundPromise) return mediaBackgroundPromise;

  mediaBackgroundPromise = loadScriptOnce(
    new URL('js/media-background.js', getSiteRootUrl()).href,
    () => !!window.LMMediaBackground
  );

  return mediaBackgroundPromise;
}
