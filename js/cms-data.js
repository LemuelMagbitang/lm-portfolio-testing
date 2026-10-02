/**
 * Compatibility facade for the legacy CMS-data import path.
 *
 * New code should import CMS retrieval from ./data/cms-loader.js and vendor
 * parsing from the relevant infrastructure adapter. This facade temporarily
 * preserves the old public surface during migration.
 */

export { resolveCmsUrl, loadCmsJson } from './data/cms-loader.js';
export { parseYouTubeUrl } from './infrastructure/youtube/url.js';
