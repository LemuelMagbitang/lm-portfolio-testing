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
import { buildProjectCardElement } from './project-card.js?v=20261006-02';
import { waitForProjectThumbnailReadiness } from './project-thumbnail.js?v=20261005-04';
import { loadCmsJson } from '../../infrastructure/cms/loader.js';
import { siteAssetUrl } from '../../infrastructure/browser/site-paths.js?v=20261004-01';
import { parseYouTubeUrl as defaultParseYouTubeUrl } from '../../infrastructure/youtube/url.js';

export async function mountProjects({
  url,
  documentRef = globalThis.document,
  loadJson = loadCmsJson,
  resolveAssetUrl = siteAssetUrl,
  getGrid = () => documentRef?.getElementById('portfolioGrid'),
  createFragment = () => documentRef?.createDocumentFragment(),
  onCardActivate,
  applyMediaBackground,
  parseYouTubeUrl = defaultParseYouTubeUrl,
  waitForThumbnailReadiness = true,
  buildCard = (project, index = 0) => buildProjectCardElement(project, {
    resolveAssetUrl,
    applyMediaBackground,
    documentRef,
    onActivate: onCardActivate,
    priority: index < (Number(documentRef?.defaultView?.innerWidth) < 768 ? 6 : 9),
    parseYouTubeUrl
  })
} = {}) {
  if (!documentRef || typeof loadJson !== 'function') return false;

  const mounted = await loadProjects({
    url,
    loadJson,
    resolveUrl: resolveAssetUrl,
    getGrid,
    createFragment,
    buildCard
  });
  if (!mounted) return false;

  if (waitForThumbnailReadiness) {
    try {
      const grid = getGrid?.();
      const cards = Array.from(grid?.querySelectorAll?.('.project-card') || []);
      const viewportWidth = Number(documentRef?.defaultView?.innerWidth) || 1280;
      const initialPriorityCount = viewportWidth < 768 ? 6 : 9;
      await waitForProjectThumbnailReadiness(cards, {
        count: initialPriorityCount,
        timeoutMs: 2200,
        windowRef: documentRef?.defaultView || globalThis.window
      });
    } catch (error) {
      // Thumbnail readiness is a startup optimization, not a reason to discard
      // an otherwise valid Projects mount.
      console.warn('Projects: thumbnail readiness wait failed.', error);
    }
  }

  return true;
}
