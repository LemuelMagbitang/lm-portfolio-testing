/**
 * Browser composition boundary for the Projects feature.
 *
 * This module is the bridge between browser/infrastructure services and the
 * presentation-agnostic Projects orchestration. The application entry point
 * can use mountProjects() without knowing how CMS transport, asset paths, DOM
 * lookup, or card construction are implemented.
 *
 * The concrete browser services are still the defaults, but each capability
 * can be replaced by the caller. This keeps the composition boundary useful
 * for preview environments, browser tests, and future UI implementations
 * without coupling the Projects feature to one runtime implementation.
 */

import { loadProjects } from './project-loader.js';
import { buildProjectCardElement } from './project-card.js?v=20261005-03';
import { loadCmsJson } from '../../infrastructure/cms/loader.js';
import { siteAssetUrl } from '../../infrastructure/browser/site-paths.js?v=20261004-01';
import { parseYouTubeUrl } from '../../infrastructure/youtube/url.js';

export async function mountProjects({
  url,
  documentRef = globalThis.document,
  loadJson = loadCmsJson,
  resolveAssetUrl = siteAssetUrl,
  getGrid = () => documentRef?.getElementById('portfolioGrid'),
  createFragment = () => documentRef?.createDocumentFragment(),
  onCardActivate,
  applyMediaBackground,
  buildCard = (project, index = 0) => buildProjectCardElement(project, {
    parseYouTubeUrl,
    resolveAssetUrl,
    applyMediaBackground,
    documentRef,
    onActivate: onCardActivate,
    priority: index < 6,
    parseYouTubeUrl
  })
} = {}) {
  if (!documentRef || typeof loadJson !== 'function') return false;

  return loadProjects({
    url,
    loadJson,
    resolveUrl: resolveAssetUrl,
    getGrid,
    createFragment,
    buildCard
  });
}
