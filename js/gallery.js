/**
 * Architecture V2 — gallery controller.
 * Owns filtering, reveal/collapse behavior, deep links and responsive sizing.
 */
export function initGallery(options = {}) {
  const filterBtns = document.querySelectorAll('.tab-btn');
  const allCards = Array.from(document.querySelectorAll('.project-card'));
  const showMoreBtn = document.getElementById('showMoreBtn');
  const showMoreWrapper = document.getElementById('showMoreWrapper');
  const portfolioGrid = document.getElementById('portfolioGrid');
  const gridFadeOverlay = document.getElementById('gridFadeOverlay');
  if (!portfolioGrid || allCards.length === 0) return;

  const mobileCount = Number.isFinite(options.mobileCount) ? options.mobileCount : 5;
  const desktopCount = Number.isFinite(options.desktopCount) ? options.desktopCount : 9;
  const fadeMs = Number.isFinite(options.fadeMs) ? options.fadeMs : 300;
  let currentFilter = 'all';
  let isExpanded = false;
  let baseCount = getBaseCount();

  function getBaseCount() { return window.innerWidth < 768 ? mobileCount : desktopCount; }
  function render() {
    const filtered = allCards.filter(card => currentFilter === 'all' || card.classList.contains(currentFilter));
    const hidden = allCards.filter(card => !filtered.includes(card));
    hidden.forEach(card => { card.style.opacity = '0'; });
    window.setTimeout(() => hidden.forEach(card => {
      if (currentFilter !== 'all' && !card.classList.contains(currentFilter)) card.style.display = 'none';
    }), fadeMs);
    filtered.forEach(card => { card.style.display = 'block'; });
    window.requestAnimationFrame(() => filtered.forEach(card => { card.style.opacity = '1'; }));
    if (!isExpanded && filtered.length > baseCount) {
      const gridRect = portfolioGrid.getBoundingClientRect();
      const cardRect = filtered[baseCount - 1].getBoundingClientRect();
      const peek = window.innerWidth < 768 ? 40 : 70;
      portfolioGrid.style.maxHeight = `${Math.round(cardRect.bottom - gridRect.top + peek)}px`;
      gridFadeOverlay?.classList.remove('is-hidden');
    } else {
      portfolioGrid.style.maxHeight = 'none';
      gridFadeOverlay?.classList.add('is-hidden');
    }
    if (showMoreBtn && showMoreWrapper) {
      const label = showMoreBtn.querySelector('.btn-text');
      if (filtered.length > baseCount) {
        showMoreWrapper.style.display = 'flex';
        showMoreWrapper.classList.toggle('expanded', isExpanded);
        showMoreBtn.classList.toggle('expanded', isExpanded);
        if (label) label.textContent = isExpanded ? 'SHOW LESS' : 'SHOW MORE';
      } else showMoreWrapper.style.display = 'none';
    }
  }

  filterBtns.forEach(btn => btn.addEventListener('click', () => {
    filterBtns.forEach(item => item.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.getAttribute('data-filter') || 'all';
    isExpanded = false;
    render();
    history.replaceState(null, '', window.location.pathname + window.location.search + (currentFilter === 'all' ? '' : `#${currentFilter}`));
  }));

  showMoreBtn?.addEventListener('click', () => {
    isExpanded = !isExpanded;
    render();
    if (!isExpanded) document.querySelector('.filter-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => { baseCount = getBaseCount(); if (!isExpanded) render(); }, 120);
  });

  function applyHash() {
    const hash = decodeURIComponent(window.location.hash.replace('#', ''));
    if (!hash) return;
    const btn = Array.from(filterBtns).find(item => item.getAttribute('data-filter') === hash);
    if (!btn) return;
    filterBtns.forEach(item => item.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = hash;
    isExpanded = false;
    render();
  }

  render();
  applyHash();
  window.addEventListener('hashchange', applyHash);
  window.addEventListener('load', () => { baseCount = getBaseCount(); if (!isExpanded) render(); });
  return {
    render,
    getFilter: () => currentFilter,
    getAllCards: () => allCards.slice(),
    getActiveCards: () => getActiveCards().slice()
  };
}
