/**
 * Portfolio bootstrap.
 * Owns the outer lifecycle, cache-busted module loading, and fatal-error
 * containment. Feature behavior stays in the application composition root.
 */

function resolveRuntimeUrl(root = globalThis.document) {
  const runtimeScript = Array.from(root?.scripts || []).find(el =>
    /(?:^|\/)js\/script\.js(?:[?#].*)?$/i.test(el.src || el.getAttribute('src') || '')
  );

  return runtimeScript
    ? new URL('site-runtime.js?v=20261003-02', runtimeScript.src).href
    : new URL('js/site-runtime.js?v=20261003-02', root.baseURI).href;
}

export async function bootstrapPortfolioApp({
  root = globalThis.document,
  cacheVersion = '20261003-02'
} = {}) {
  const pageTransition = root?.getElementById('pageTransition');
  let initialTransitionTimer = null;

  function showInitialPageTransition() {
    if (!pageTransition) return;
    pageTransition.classList.remove('is-hidden');
    root.defaultView.requestAnimationFrame(() => pageTransition.classList.add('is-entering'));
    initialTransitionTimer = root.defaultView.setTimeout(() => {
      pageTransition.classList.add('is-hidden');
    }, 900);
  }

  function hideInitialPageTransition() {
    pageTransition?.classList.add('is-hidden');
  }

  showInitialPageTransition();

  try {
    const runtimeUrl = resolveRuntimeUrl(root);
    const [{ createPortfolioApp }, runtime, cms] = await Promise.all([
      import(`./page-composition.js?v=${cacheVersion}`),
      import(runtimeUrl),
      import(new URL(`cms-data.js?v=${cacheVersion}`, runtimeUrl).href)
    ]);

    await createPortfolioApp({ root, runtime, cms });

    hideInitialPageTransition();
    if (initialTransitionTimer) root.defaultView.clearTimeout(initialTransitionTimer);
  } catch (error) {
    console.error('Portfolio runtime failed to initialize', error);
    hideInitialPageTransition();
    if (initialTransitionTimer) root.defaultView.clearTimeout(initialTransitionTimer);
  }
}
