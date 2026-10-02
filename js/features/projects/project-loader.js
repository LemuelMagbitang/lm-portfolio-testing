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

    projects.forEach(project => fragment.appendChild(buildCard(project)));
    grid.replaceChildren(fragment);
    return true;
  } catch (error) {
    console.warn('Projects: could not load normalized project data.', error);
    return false;
  }
}
