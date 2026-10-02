/**
 * Project feature data orchestration.
 *
 * CMS access and project normalization are injected boundaries. This module
 * only coordinates data loading and rendering; it does not know which CMS
 * provider supplies the JSON or how project cards are implemented internally.
 */

import { normalizeProjects } from '../../data/project-normalizer.js';

export async function loadProjects({ url, loadJson, resolveUrl, buildCard, getGrid } = {}) {
  if (!url || typeof loadJson !== 'function' || typeof buildCard !== 'function' || typeof getGrid !== 'function') {
    return false;
  }

  const grid = getGrid();
  if (!grid) return false;

  try {
    const raw = await loadJson(url, null, { resolveUrl });
    const projects = normalizeProjects(raw);
    if (!projects.length) return false;

    const fragment = document.createDocumentFragment();
    projects.forEach(project => fragment.appendChild(buildCard(project)));
    grid.replaceChildren(fragment);
    return true;
  } catch (error) {
    console.warn('Projects: could not load normalized project data.', error);
    return false;
  }
}
