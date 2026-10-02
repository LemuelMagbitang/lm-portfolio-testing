/*
 * LM. Site Runtime — compatibility facade
 *
 * This module intentionally contains no feature implementation. It preserves
 * the existing runtime API while consumers migrate to explicit infrastructure
 * boundaries.
 */

export { getSiteRootUrl, siteAssetUrl } from './infrastructure/browser/site-paths.js';
export { loadScriptOnce } from './infrastructure/browser/script-loader.js';
export { ensureLottiePlayer } from './infrastructure/lottie/player.js';
export { ensureMediaBackgroundHelper } from './infrastructure/media-background/loader.js';

export const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const prefersReducedMotion = () => reducedMotionQuery.matches;
