/**
 * Compatibility facade for the legacy CMS-data import path.
 *
 * New code should import CMS retrieval from ./data/cms-loader.js and vendor
 * parsing from the relevant infrastructure adapter. This facade temporarily
 * preserves the old public surface during migration.
 */

import { resolveCmsUrl as resolveCmsUrlImpl, loadCmsJson as loadCmsJsonImpl } from './data/cms-loader.js';
import { parseYouTubeUrl } from './infrastructure/youtube/url.js';

export function resolveCmsUrl(...args) {
  return resolveCmsUrlImpl(...args);
}

export async function loadCmsJson(...args) {
  return loadCmsJsonImpl(...args);
}

export { parseYouTubeUrl };
