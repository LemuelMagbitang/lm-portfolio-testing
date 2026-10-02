/**
 * Project feature data orchestration.
 * CMS access is injected so this feature stays independent from GitHub/CMS transport.
 */

export async function loadProjects({ url, loadJson, resolveUrl, buildCard, getGrid } = {}) {
  if (!url || typeof loadJson !== 'function' || typeof buildCard !== 'function') return false;
  const grid = typeof getGrid === 'function' ? getGrid() : document.getElementById('portfolioGrid');
  if (!grid) return false;

  const raw = await loadJson(url, null, { resolveUrl });
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.projects) ? raw.projects : []);
  if (!list.length) return false;

  const fragment = document.createDocumentFragment();
  list.forEach(project => fragment.appendChild(buildCard(project)));
  grid.replaceChildren(fragment);
  return true;
}
