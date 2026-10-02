/*
 * LM. Integration — media background helper
 *
 * This adapter owns the optional global helper used by artwork backgrounds.
 * Feature modules should request the capability instead of knowing how it is
 * loaded.
 */

import { loadScriptOnce } from '../core/script-loader.js';
import { getSiteRootUrl } from '../core/site-paths.js';

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
