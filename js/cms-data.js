/**
 * Compatibility facade for the legacy CMS-data import path.
 *
 * New code should use the infrastructure CMS transport directly and keep
 * content normalization in the data layer. This facade temporarily preserves
 * the old public surface during migration.
 */

import {
  resolveCmsUrl as resolveCmsUrlImpl,
  loadCmsJson as loadCmsJsonImpl
} from './infrastructure/cms/loader.js';
import { parseYouTubeUrl } from './infrastructure/youtube/url.js';

export function resolveCmsUrl(...args) {
  return resolveCmsUrlImpl(...args);
}

export async function loadCmsJson(...args) {
  return loadCmsJsonImpl(...args);
}

export { parseYouTubeUrl };
