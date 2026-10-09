/**
 * Project feature data orchestration.
 *
 * CMS access and project normalization are injected boundaries. This module
 * only coordinates data loading and rendering; it does not know which CMS
 * provider supplies the JSON or how project cards are implemented internally.
 *
 * DOM creation is injected explicitly. The Projects orchestration layer must
 * not reach into the global browser environment, which keeps it usable from
 * browser composition, previews, and non-browser tests alike.
 */

import { normalizeProjects } from '../../data/project-normalizer.js?v=20261009-09';

// Project models belong to the Projects feature, not to card markup. The
// WeakMap keeps the model private while exposing a stable card -> project
// lookup through the feature's public API for Gallery/Lightbox consumers.
const cardProjectMap = new WeakMap();
const projectCardMap = new Map();
let projectModels = [];
let projectLoadToken = 0;

export function getProjectForCard(card) {
  return cardProjectMap.get(card) || null;
}

export function getProjects() {
  return projectModels.slice();
}

export function getCardForProject(projectId) {
  const key = String(projectId || '').trim();
  return key ? projectCardMap.get(key) || null : null;
}

/**
 * Release the Projects feature's strong card index and normalized models.
 *
 * The card -> project relation uses a WeakMap, but the projectId -> card
 * index is intentionally strong for fast Gallery/Lightbox lookup. Clear that
 * index when the application is destroyed so detached card nodes can be
 * garbage-collected cleanly on remounts and in long-lived preview/test hosts.
 */
export function destroyProjects() {
  // Invalidate any CMS load that is still awaiting the network. A completed
  // stale load must not repopulate projectModels or the card index after an
  // app teardown/remount or after a newer load has taken ownership.
  projectLoadToken += 1;
  projectCardMap.clear();
  projectModels = [];
}

export async function loadProjects({
  url,
  loadJson,
  resolveUrl,
  buildCard,
  getGrid,
  createFragment
} = {}) {
  if (
    !url ||
    typeof loadJson !== 'function' ||
    typeof buildCard !== 'function' ||
    typeof getGrid !== 'function' ||
    typeof createFragment !== 'function'
  ) {
    return false;
  }

  const grid = getGrid();
  if (!grid) return false;
  const loadToken = ++projectLoadToken;

  try {
    const raw = await loadJson(url, null, { resolveUrl });
    const hasProjectCollection =
      Array.isArray(raw) ||
      Array.isArray(raw?.projects);

    // An explicitly supplied empty collection is valid CMS state. Publish it
    // as an empty Projects model instead of treating it like a transport/load
    // failure and leaving stale cards on the page.
    if (!hasProjectCollection) return false;

    const projects = normalizeProjects(raw);
    if (!projects.length) {
      if (loadToken !== projectLoadToken) return false;
      grid.replaceChildren();
      projectModels = [];
      projectCardMap.clear();
      return true;
    }

    const fragment = createFragment();
    if (!fragment || typeof fragment.appendChild !== 'function') return false;

    let mountedCount = 0;
    const mountedPairs = [];

    projects.forEach(project => {
      const card = buildCard(project, mountedCount);
      if (!card) return;
      mountedPairs.push([card, project]);
      fragment.appendChild(card);
      mountedCount += 1;
    });

    if (!mountedCount || mountedCount !== projects.length) {
      // Keep the published project state and card mappings coherent. A partial
      // build must not replace the current gallery while leaving the Projects
      // API describing cards that never reached the DOM.
      return false;
    }

    // The request/build may have completed after teardown or after another
    // load started. Only the current generation may publish into the DOM or
    // replace the normalized project index.
    if (loadToken !== projectLoadToken) return false;

    grid.replaceChildren(fragment);

    projectModels = projects.slice();
    projectCardMap.clear();
    mountedPairs.forEach(([card, project]) => {
      cardProjectMap.set(card, project);
      if (project.id) projectCardMap.set(project.id, card);
    });

    return true;
  } catch (error) {
    console.warn('Projects: could not load normalized project data.', error);
    return false;
  }
}
