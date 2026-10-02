/*
 * Lottie infrastructure adapter.
 *
 * Features request the capability; they do not know which CDN or script
 * loader provides the custom element.
 */

import { loadScriptOnce } from '../../core/script-loader.js';

const LOTTIE_SOURCES = [
  'https://unpkg.com/@lottiefiles/lottie-player@2.0.12/dist/lottie-player.js',
  'https://cdn.jsdelivr.net/npm/@lottiefiles/lottie-player@2.0.12/dist/lottie-player.js'
];

let lottiePromise = null;

export function ensureLottiePlayer() {
  if (window.customElements?.get('lottie-player')) return Promise.resolve(true);
  if (lottiePromise) return lottiePromise;

  lottiePromise = (async () => {
    for (const src of LOTTIE_SOURCES) {
      const loaded = await loadScriptOnce(
        src,
        () => !!window.customElements?.get('lottie-player')
      );
      if (loaded) return true;
    }
    return false;
  })();

  return lottiePromise;
}
