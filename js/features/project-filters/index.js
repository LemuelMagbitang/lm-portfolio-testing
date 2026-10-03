/**
 * Project filters feature.
 * Loads filter labels, applies filtering, and owns filter-selection state.
 */

export async function initProjectFilters({
  url,
  root = globalThis.document,
  loadJson,
  resolveAssetUrl
} = {}) {
  const container = root?.querySelector('.filter-tabs');
  if (!container) return { render() {}, getFilter: () => 'all', getActiveCards: () => [], cleanup() {} };

  async function loadFilters() {
    if (!url || typeof loadJson !== 'function') return;
    try {
      const raw = await loadJson(url, null, { resolveUrl: resolveAssetUrl });
      const list = Array.isArray(raw)
        ? raw
        : (Array.isArray(raw?.filters) ? raw.filters : []);

      if (!list.length) return;

      const fragment = root.createDocumentFragment();
      list.forEach(filter => {
        if (!filter || !filter.id) return;
        const button = root.createElement('button');
        button.type = 'button';
        button.className = 'filter-btn';
        button.dataset.filter = String(filter.id);
        button.textContent = filter.label || filter.name || filter.id;
        fragment.appendChild(button);
      });

      container.replaceChildren(fragment);
    } catch (error) {
      console.warn('Filters: could not load', url, error);
    }
  }

  await loadFilters();

  let currentFilter = container.querySelector('.filter-btn.active, .tab-btn.active')?.dataset.filter || 'all';
  let buttons = Array.from(container.querySelectorAll('.filter-btn, .tab-btn'));

  function getCards() {
    return Array.from(root.querySelectorAll('.project-card'));
  }

  function cardMatches(card, filter) {
    if (filter === 'all') return true;
    let ids = [];
    try { ids = JSON.parse(card.dataset.filterIds || '[]'); } catch (_) {}
    return ids.includes(filter);
  }

  function applyFilter(filter) {
    currentFilter = filter || 'all';
    buttons.forEach(button => button.classList.toggle('active', (button.dataset.filter || 'all') === currentFilter));
    getCards().forEach(card => {
      card.style.display = cardMatches(card, currentFilter) ? '' : 'none';
    });
  }

  function onClick(event) {
    const button = event.target.closest('.filter-btn, .tab-btn');
    if (!button || !container.contains(button)) return;
    applyFilter(button.dataset.filter || 'all');
  }

  container.addEventListener('click', onClick);
  buttons = Array.from(container.querySelectorAll('.filter-btn, .tab-btn'));
  applyFilter(currentFilter);

  return {
    render: applyFilter,
    getFilter: () => currentFilter,
    getAllCards: getCards,
    getActiveCards: () => getCards().filter(card => cardMatches(card, currentFilter)),
    cleanup: () => container.removeEventListener('click', onClick)
  };
}
