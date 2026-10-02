/**
 * Browser composition boundary for the Projects feature.
 *
 * This module is the bridge between browser/infrastructure services and the
 * presentation-agnostic Projects orchestration. The application entry point
 * can use mountProjects() without knowing how CMS transport, asset paths, DOM
 * lookup, or card construction are implemented.
 *
 * Keeping this adapter separate is intentional: a future UI can replace the
 * project-card renderer while the CMS/data contract remains unchanged.
 */

import { loadProjects, buildProjectCardElement } from './index.js';
import { loadCmsJson } from '../../infrastructure/cms/loader.js';
import { siteAssetUrl } from '../../infrastructure/browser/site-paths.js';

export async function mountProjects({
  url,
  documentRef = globalThis.document,
  resolveAssetUrl = siteAssetUrl,
  show3DIndicator = true
} = {}) {
  if (!documentRef) return false;

  return loadProjects({
    url,
    loadJson: loadCmsJson,
    resolveUrl: resolveAssetUrl,
    getGrid: () => documentRef.getElementById('portfolioGrid'),
    createFragment: () => documentRef.createDocumentFragment(),
    buildCard: project => buildProjectCardElement(project, {
      resolveAssetUrl,
      show3DIndicator
    })
  });
}
