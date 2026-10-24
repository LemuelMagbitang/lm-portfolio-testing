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

import { loadProjects } from './project-loader.js?v=20261024-02';
import { buildProjectCardElement } from './project-card.js?v=20261025-04';
import { waitForProjectThumbnailReadiness, disposeProjectThumbnailMedia } from './project-thumbnail.js?v=20261025-03';
import { loadCmsJson } from '../../infrastructure/cms/loader.js';
import { siteAssetUrl } from '../../infrastructure/browser/site-paths.js?v=20261004-01';

async function mountThumbnailModelViewer(container, src, options = {}) {
  if (typeof options.isCurrent === 'function' && !options.isCurrent()) return null;
  const { mountModelViewer } = await import('../../infrastructure/three/model-viewer.js?v=20261024-02');
  if (typeof options.isCurrent === 'function' && !options.isCurrent()) return null;
  return mountModelViewer(container, src, {
    ...options,
    thumbnail: true,
    hint: false,
    autoRotate: false,
    isCurrent: undefined
  });
}

export async function mountProjects({
  url,
  projectData,
  documentRef = globalThis.document,
  loadJson = loadCmsJson,
  resolveAssetUrl = siteAssetUrl,
  getGrid = () => documentRef?.getElementById('portfolioGrid'),
  createFragment = () => documentRef?.createDocumentFragment(),
  onCardActivate,
  applyMediaBackground,
  ensureLottiePlayer = null,
  waitForThumbnailReadiness = true,
  buildCard = (project, index = 0) => buildProjectCardElement(project, {
    resolveAssetUrl,
    applyMediaBackground,
    documentRef,
    onActivate: onCardActivate,
    priority: index < (Number(documentRef?.defaultView?.innerWidth) < 768 ? 2 : 3),
    ensureLottiePlayer,
    mountModelViewer: mountThumbnailModelViewer
  })
} = {}) {
  if (!documentRef || typeof loadJson !== 'function') return false;

  const mounted = await loadProjects({
    url,
    projectData,
    loadJson,
    resolveUrl: resolveAssetUrl,
    getGrid,
    createFragment,
    buildCard,
    disposePreviousCards: cards => cards.forEach(disposeProjectThumbnailMedia)
  });
  if (!mounted) return false;

  if (waitForThumbnailReadiness) {
    try {
      const grid = getGrid?.();
      const cards = Array.from(grid?.querySelectorAll?.('.project-card') || []);
      const viewportWidth = Number(documentRef?.defaultView?.innerWidth) || 1280;
      const initialPriorityCount = viewportWidth < 768 ? 2 : 3;
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
