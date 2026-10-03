/**
 * Reviews feature.
 * Owns CMS loading, visibility, marquee duplication, and cleanup.
 */

export async function initReviews({
  url,
  root = globalThis.document,
  loadJson,
  resolveAssetUrl,
  visible = false
} = {}) {
  const section = root?.querySelector('.reviews-section');
  const marquee = root?.querySelector('.reviews-marquee');
  const track = root?.getElementById('reviewsTrack');

  let pristineCards = [];

  function applyVisibility(show = visible) {
    visible = Boolean(show);
    if (section) section.style.display = visible ? '' : 'none';
  }

  function buildCard(review = {}) {
    const card = root.createElement('div');
    card.className = 'review-card glass';

    const quote = root.createElement('p');
    quote.className = 'review-quote';
    quote.textContent = review.quote || review.review || '';

    const name = root.createElement('h4');
    name.className = 'review-name';
    name.textContent = review.name || '';

    const role = root.createElement('div');
    role.className = 'review-role';
    role.textContent = review.role || '';

    card.append(quote, name, role);
    return card;
  }

  if (url && track && typeof loadJson === 'function') {
    try {
      const raw = await loadJson(url, null, { resolveUrl: resolveAssetUrl });
      const list = Array.isArray(raw)
        ? raw
        : (Array.isArray(raw?.reviews) ? raw.reviews : []);

      if (list.length) {
        const fragment = root.createDocumentFragment();
        list.forEach(review => fragment.appendChild(buildCard(review)));
        track.replaceChildren(fragment);
      }
    } catch (error) {
      console.warn('Reviews: could not load', url, error);
    }
  }

  if (track) {
    pristineCards = Array.from(track.children).map(card => card.cloneNode(true));
    if (pristineCards.length) {
      const fragment = root.createDocumentFragment();
      pristineCards.forEach(card => fragment.appendChild(card.cloneNode(true)));
      pristineCards.forEach(card => fragment.appendChild(card.cloneNode(true)));
      track.replaceChildren(fragment);
    }
  }

  applyVisibility(visible);

  return {
    setVisible: applyVisibility,
    isVisible: () => visible,
    cleanup() {
      if (!track) return;
      track.replaceChildren(...pristineCards.map(card => card.cloneNode(true)));
    }
  };
}
