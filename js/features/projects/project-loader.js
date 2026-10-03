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

import { normalizeProjects } from '../../data/project-normalizer.js';

// Project models belong to the Projects feature, not to card markup. The
// WeakMap keeps the model private while exposing a stable card -> project
// lookup through the feature's public API for Gallery/Lightbox consumers.
const cardProjectMap = new WeakMap();
const projectCardMap = new Map();
let projectModels = [];

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

  try {
    const raw = await loadJson(url, null, { resolveUrl });
    const projects = normalizeProjects(raw);
    if (!projects.length) return false;
    const fragment = createFragment();
    if (!fragment || typeof fragment.appendChild !== 'function') return false;

    let mountedCount = 0;
    const mountedPairs = [];

    projects.forEach(project => {
      const card = buildCard(project);
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
