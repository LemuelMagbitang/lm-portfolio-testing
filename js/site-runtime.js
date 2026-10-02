/*
 * LM. Site Runtime — compatibility facade
 *
 * This module intentionally contains no feature implementation. It preserves
 * the existing runtime API while consumers migrate to the explicit core and
 * infrastructure layers.
 */

export { getSiteRootUrl, siteAssetUrl } from './core/site-paths.js';
export { loadScriptOnce } from './core/script-loader.js';
export { ensureLottiePlayer } from './infrastructure/lottie/player.js';
export { ensureMediaBackgroundHelper } from './infrastructure/media-background/loader.js';

export const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const prefersReducedMotion = () => reducedMotionQuery.matches;
