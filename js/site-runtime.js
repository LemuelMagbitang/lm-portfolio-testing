/*
 * LM. Site Runtime — compatibility facade
 *
 * Runtime used to own path resolution, script loading, third-party loaders,
 * and accessibility state in one module. Those responsibilities now live in
 * focused modules. This facade intentionally keeps the existing public API so
 * feature modules can migrate independently without a risky all-at-once
 * rewrite.
 */

export { getSiteRootUrl, siteAssetUrl } from './core/site-paths.js';
export { loadScriptOnce } from './core/script-loader.js';
export { ensureLottiePlayer } from './integrations/lottie-player.js';
export { ensureMediaBackgroundHelper } from './integrations/media-background.js';

export const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const prefersReducedMotion = () => reducedMotionQuery.matches;
