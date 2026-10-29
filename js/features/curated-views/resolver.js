/**
 * Resolve public Curated View hash routes into an ordered project payload.
 * The existing Projects pipeline remains responsible for normalization, cards, Gallery and Lightbox.
 */
const VALID_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function hashSlug(value) {
  let candidate = String(value || '').trim();
  if (candidate.startsWith('#')) candidate = candidate.slice(1);
  try { candidate = decodeURIComponent(candidate); } catch (_) { return ''; }
  candidate = candidate.trim().toLowerCase();
  return VALID_SLUG.test(candidate) ? candidate : '';
}
function findViewForHash(hash, views) {
  const slug = hashSlug(hash);
  if (!slug || !Array.isArray(views)) return null;
  const matches = views.filter(view =>
    view && typeof view === 'object' && !Array.isArray(view) &&
    String(view.id || '').trim().toLowerCase() === slug &&
    String(view.slug || '').trim().toLowerCase() === slug &&
    Boolean(String(view.name || '').trim()) &&
    Array.isArray(view.projects)
  );
  return matches.length === 1 ? matches[0] : null;
}
export function resolveCuratedViewSlug(hash, views) {
  return findViewForHash(hash, views)?.slug || '';
}
export function resolveCuratedView({ hash, views, mainProjects } = {}) {
  const view = findViewForHash(hash, views);
  if (!view) return null;
  const rows = Array.isArray(mainProjects)
    ? mainProjects
    : (Array.isArray(mainProjects?.projects) ? mainProjects.projects : []);
  const mainById = new Map();
  rows.forEach(project => {
    const id = String(project?.id || '').trim();
    if (!id) return;
    if (mainById.has(id)) mainById.set(id, null);
    else mainById.set(id, project);
  });
  const selected = [];
  const usedIds = new Set();
  view.projects.forEach(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    if (entry.source === 'main') {
      const id = String(entry.projectId || '').trim();
      const project = mainById.get(id);
      if (!project || usedIds.has(id)) return;
      usedIds.add(id);
      selected.push(project);
      return;
    }
    if (entry.source !== 'curated' || !entry.project ||
        typeof entry.project !== 'object' || Array.isArray(entry.project)) return;
    const project = entry.project;
    const id = String(project.id || '').trim();
    if (!id || !String(project.title || '').trim() || mainById.has(id) || usedIds.has(id)) return;
    usedIds.add(id);
    selected.push(project);
  });
  return { view, projects: selected };
}
