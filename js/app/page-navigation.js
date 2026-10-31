/**
 * Lightweight same-origin router for the two public portfolio pages.
 *
 * The HTML files remain independently addressable for direct visits, search
 * engines, and no-JS users. Client navigation swaps the body after destination
 * HTML and route styles are ready, reuses the ES-module runtime, and falls back
 * to native navigation whenever the handoff cannot be completed safely.
 */
import { getSiteRootUrl } from '../infrastructure/browser/site-paths.js?v=20261031-05';

const NAV_LINK_SELECTOR = '.nav-links a[href], .nav-logo[href]';
const ROUTE_CONFIG_ID = 'pageConfig';

export function resolveRouteWarmHintRel(value) {
  const tokens = String(value || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.includes('preload')) return '';
  return ['modulepreload', 'prefetch', 'preconnect'].find(rel => tokens.includes(rel)) || '';
}

function normalizedPath(pathname) {
  return String(pathname || '').replace(/\/index\.html$/i, '').replace(/\/+$/, '') || '/';
}

export function resolvePortfolioRoute(urlValue, siteRootUrl) {
  try {
    const rootUrl = new URL(siteRootUrl);
    const url = new URL(urlValue, rootUrl);
    if (url.origin !== rootUrl.origin) return null;
    const routePath = normalizedPath(url.pathname);
    const designPath = normalizedPath(rootUrl.pathname);
    const aboutPath = normalizedPath(new URL('about/', rootUrl).pathname);
    if (routePath === designPath) return 'design';
    if (routePath === aboutPath) return 'about';
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Select only destination-specific data endpoints for route prefetch.
 * Shared settings/reviews/Hero/Footer data belongs to the active runtime and
 * should not be fetched again just because the visitor may change pages.
 */
export function resolveRouteDataPrefetchEntries(urls, route) {
  const entries = Object.entries(urls && typeof urls === 'object' ? urls : {})
    .filter(([, value]) => typeof value === 'string' && value.trim());

  // Only warm route-specific data. Settings, reviews, and Hero/Footer feeds
  // are shared by both page modules and are already requested by the active
  // runtime; warming them again while prefetching a destination duplicates
  // network work. The Design route owns projects/filters, while About owns
  // the profile payload.
  const routeKeys = route === 'design'
    ? new Set(['projects', 'filters'])
    : (route === 'about' ? new Set(['about']) : new Set());
  return entries.filter(([key]) => routeKeys.has(key));
}

function isPlainPrimaryClick(event, link) {
  if (!event || event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (!link || link.hasAttribute('download')) return false;
  const target = String(link.getAttribute('target') || '').trim().toLowerCase();
  return !target || target === '_self';
}

function nextFrame(windowRef) {
  return new Promise(resolve => {
    if (typeof windowRef?.requestAnimationFrame === 'function') {
      windowRef.requestAnimationFrame(() => resolve());
    } else {
      windowRef?.setTimeout?.(resolve, 0);
    }
  });
}

function scrollToPosition(windowRef, documentRef, y) {
  const html = documentRef?.documentElement;
  const body = documentRef?.body;
  const oldHtml = html?.style?.scrollBehavior || '';
  const oldBody = body?.style?.scrollBehavior || '';
  if (html?.style) html.style.scrollBehavior = 'auto';
  if (body?.style) body.style.scrollBehavior = 'auto';
  windowRef?.scrollTo?.({ left: 0, top: Math.max(0, Number(y) || 0), behavior: 'auto' });
  void nextFrame(windowRef).then(() => nextFrame(windowRef)).then(() => {
    if (html?.style) html.style.scrollBehavior = oldHtml;
    if (body?.style) body.style.scrollBehavior = oldBody;
  });
}

function readPageConfig(documentRef) {
  try {
    const parsed = JSON.parse(documentRef?.getElementById?.(ROUTE_CONFIG_ID)?.textContent || '{}');
    if (parsed && typeof parsed === 'object' && parsed.urls && typeof parsed.urls === 'object') return parsed;
  } catch (_) {}
  return { urls: {} };
}

function applyPageConfigToWindow(windowRef, config) {
  const urls = config?.urls || {};
  const mapping = {
    settings: 'SETTINGS_URL',
    projects: 'PROJECTS_URL',
    reviews: 'REVIEWS_URL',
    about: 'ABOUT_URL',
    filters: 'FILTERS_URL',
    heroLoop: 'HERO_LOOP_URL',
    footerLoop: 'FOOTER_LOOP_URL',
    heroMessages: 'HERO_MESSAGES_URL'
  };
  Object.entries(mapping).forEach(([key, globalName]) => {
    if (urls[key]) windowRef[globalName] = urls[key];
    else {
      try { delete windowRef[globalName]; } catch (_) { windowRef[globalName] = undefined; }
    }
  });
}

export function initPageNavigation({
  root = globalThis.document,
  getApp = () => null,
  setApp = () => {},
  mountPage
} = {}) {
  const windowRef = root?.defaultView || globalThis.window;
  if (!root?.body || !windowRef?.location || typeof windowRef.fetch !== 'function') {
    return { prefetch() {}, destroy() {} };
  }

  const siteRootUrl = getSiteRootUrl({ documentRef: root, windowRef });
  windowRef.SITE_ROOT_URL = siteRootUrl;
  let currentRoute = resolvePortfolioRoute(windowRef.location.href, siteRootUrl);
  const nativeScrollRestoration = windowRef.history?.scrollRestoration || 'auto';
  const documentCache = new Map();
  let navigationSequence = 0;
  let destroyed = false;
  let scrollFrame = null;
  let historyModeEnabled = false;

  function ensureManualScrollRestoration() {
    if (!historyModeEnabled && windowRef.history) {
      historyModeEnabled = true;
      try { windowRef.history.scrollRestoration = 'manual'; } catch (_) {}
    }
  }

  function saveCurrentScroll() {
    if (!windowRef.history || !historyModeEnabled) return;
    const state = windowRef.history.state && typeof windowRef.history.state === 'object'
      ? { ...windowRef.history.state }
      : {};
    state.__lmPortfolioScrollY = Number(windowRef.scrollY) || 0;
    try { windowRef.history.replaceState(state, '', windowRef.location.href); } catch (_) {}
  }

  function handleScroll() {
    if (!historyModeEnabled || scrollFrame !== null) return;
    const schedule = typeof windowRef.requestAnimationFrame === 'function'
      ? windowRef.requestAnimationFrame.bind(windowRef)
      : callback => windowRef.setTimeout(callback, 16);
    scrollFrame = schedule(() => {
      scrollFrame = null;
      saveCurrentScroll();
    });
  }

  function documentUrl(value) {
    const url = new URL(value, windowRef.location.href);
    url.hash = '';
    return url;
  }

  function addWarmHint(href, rel, attributes = {}) {
    if (!href || !root.head) return;
    const absolute = new URL(href, siteRootUrl).href;
    const matches = Array.from(root.head.querySelectorAll('link[rel]')).some(link =>
      link.rel.split(/\s+/).includes(rel) && link.href === absolute
    );
    if (matches) return;
    const link = root.createElement('link');
    link.rel = rel;
    link.href = absolute;
    Object.entries(attributes).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') link.setAttribute(key, String(value));
    });
    root.head.appendChild(link);
  }

  function warmDocumentResources(page) {
    const hints = Array.from(page.document.head?.querySelectorAll?.(
      'link[rel="modulepreload"], link[rel="prefetch"], link[rel="preload"], link[rel="preconnect"]'
    ) || []);
    hints.forEach(hint => {
      const rawHref = hint.getAttribute('href') || '';
      const rel = resolveRouteWarmHintRel(hint.rel);
      if (!rawHref || !rel) return;
      let absolute;
      try { absolute = new URL(rawHref, page.url); } catch (_) { return; }
      if (absolute.origin !== windowRef.location.origin) return;
      const attributes = {};
      ['as', 'crossorigin', 'type', 'fetchpriority'].forEach(name => {
        if (hint.hasAttribute(name)) attributes[name] = hint.getAttribute(name);
      });
      addWarmHint(absolute.href, rel, attributes);
    });

    // Route-specific styles are fetched during prefetch, but not activated
    // until that route is committed. This avoids a blocking stylesheet fetch
    // at the moment the visitor changes pages.
    const routeStyles = Array.from(page.document.head?.querySelectorAll?.(
      'link[rel="stylesheet"][data-page-style]'
    ) || []);
    routeStyles.forEach(source => {
      const rawHref = source.getAttribute('href') || '';
      if (!rawHref) return;
      try {
        const absolute = new URL(rawHref, page.url);
        if (absolute.origin === windowRef.location.origin) {
          addWarmHint(absolute.href, 'preload', { as: 'style' });
        }
      } catch (_) {}
    });

    const urls = readPageConfig(page.document).urls || {};
    const fetchJsonResource = value => {
      try {
        const url = new URL(value, siteRootUrl);
        if (url.origin !== windowRef.location.origin) return null;
        return windowRef.fetch(url.href, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'force-cache',
          headers: { Accept: 'application/json' }
        }).catch(() => null);
      } catch (_) {
        return null;
      }
    };
    const routeDataEntries = resolveRouteDataPrefetchEntries(urls, page.route);
    const routeDataRequests = routeDataEntries
      .map(([, value]) => fetchJsonResource(value))
      .filter(Boolean);
    void Promise.allSettled(routeDataRequests);
  }

  function loadPageDocument(value) {
    const url = documentUrl(value);
    const key = url.href;
    if (documentCache.has(key)) return documentCache.get(key);

    const request = windowRef.fetch(key, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'force-cache',
      headers: { Accept: 'text/html' }
    }).then(async response => {
      if (!response.ok) throw new Error('Page request failed (' + response.status + ').');
      const html = await response.text();
      const parsed = new windowRef.DOMParser().parseFromString(html, 'text/html');
      const finalUrl = response.url || key;
      const route = resolvePortfolioRoute(finalUrl, siteRootUrl);
      if (!parsed.body || !route) throw new Error('Destination is not a supported portfolio page.');
      const page = { document: parsed, url: finalUrl, route };
      warmDocumentResources(page);
      return page;
    }).catch(error => {
      documentCache.delete(key);
      throw error;
    });
    documentCache.set(key, request);
    return request;
  }

  function warmRouteModules(route) {
    if (route !== 'design') return;
    // Only warm the relatively heavy Design feature graph after navigation
    // intent. This keeps About's initial runtime lean while making a deliberate
    // return to the project grid much faster.
    [
      'js/features/projects/index.js?v=20261029-01',
      'js/features/gallery/index.js?v=20261030-03',
      'js/features/lightbox/index.js?v=20261030-07',
      'js/data/project-normalizer.js?v=20261029-01'
    ].forEach(path => {
      try {
        addWarmHint(new URL(path, siteRootUrl).href, 'modulepreload');
      } catch (_) {}
    });
  }

  function prefetch(value, { intent = false } = {}) {
    if (destroyed) return Promise.resolve(false);
    let url;
    try { url = documentUrl(value); } catch (_) { return Promise.resolve(false); }
    const destinationRoute = resolvePortfolioRoute(url, siteRootUrl);
    if (!destinationRoute || destinationRoute === currentRoute) return Promise.resolve(false);
    if (intent) warmRouteModules(destinationRoute);
    return loadPageDocument(url.href).then(() => true).catch(() => false);
  }

  async function ensureRouteStyles(page) {
    const routeStyles = Array.from(page.document.head?.querySelectorAll?.(
      'link[rel="stylesheet"][data-page-style]'
    ) || []);
    const waits = [];
    for (const source of routeStyles) {
      const rawHref = source.getAttribute('href') || '';
      if (!rawHref) continue;
      const href = new URL(rawHref, page.url).href;
      const existing = Array.from(root.head.querySelectorAll('link[rel="stylesheet"]'))
        .find(link => link.href === href);
      if (existing) continue;
      const link = root.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.pageStyle = source.dataset.pageStyle || 'route';
      if (source.media) link.media = source.media;
      if (source.crossOrigin) link.crossOrigin = source.crossOrigin;
      waits.push(new Promise(resolve => {
        let settled = false;
        let timer = null;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (timer !== null) windowRef.clearTimeout(timer);
          resolve();
        };
        link.addEventListener('load', finish, { once: true });
        link.addEventListener('error', finish, { once: true });
        timer = windowRef.setTimeout(finish, 3500);
      }));
      root.head.appendChild(link);
    }
    if (waits.length) await Promise.all(waits);
  }

  function syncHead(page) {
    root.title = page.document.title || root.title;
    root.documentElement.lang = page.document.documentElement.lang || 'en';

    const nextMeta = Array.from(page.document.head.querySelectorAll('meta[name], meta[property]'));
    const metaKey = node => node.hasAttribute('name')
      ? 'name:' + node.getAttribute('name').toLowerCase()
      : 'property:' + node.getAttribute('property').toLowerCase();
    const nextKeys = new Set(nextMeta.map(metaKey));
    Array.from(root.head.querySelectorAll('meta[name], meta[property]')).forEach(existing => {
      if (!nextKeys.has(metaKey(existing))) existing.remove();
    });
    nextMeta.forEach(source => {
      const key = metaKey(source);
      const existing = Array.from(root.head.querySelectorAll('meta[name], meta[property]'))
        .find(meta => metaKey(meta) === key);
      if (existing) existing.content = source.content || '';
      else root.head.appendChild(root.importNode(source, true));
    });

    const nextCanonical = page.document.head.querySelector('link[rel="canonical"]');
    let canonical = root.head.querySelector('link[rel="canonical"]');
    if (nextCanonical) {
      if (!canonical) {
        canonical = root.createElement('link');
        canonical.rel = 'canonical';
        root.head.appendChild(canonical);
      }
      canonical.href = nextCanonical.getAttribute('href') || page.url;
    }

    const nextIcon = page.document.head.querySelector('link[rel~="icon"]');
    const currentIcon = root.head.querySelector('link[rel~="icon"]');
    if (nextIcon && currentIcon) currentIcon.href = new URL(nextIcon.getAttribute('href') || '', page.url).href;

    const nextConfig = page.document.getElementById(ROUTE_CONFIG_ID);
    let currentConfig = root.getElementById(ROUTE_CONFIG_ID);
    if (nextConfig) {
      if (!currentConfig) {
        currentConfig = root.createElement('script');
        currentConfig.type = 'application/json';
        currentConfig.id = ROUTE_CONFIG_ID;
        root.head.appendChild(currentConfig);
      }
      currentConfig.textContent = nextConfig.textContent || '{}';
    }
    applyPageConfigToWindow(windowRef, readPageConfig(root));
  }

  function updateRouteStyles(page) {
    const desired = new Set(Array.from(page.document.head?.querySelectorAll?.(
      'link[rel="stylesheet"][data-page-style]'
    ) || []).map(link => new URL(link.getAttribute('href') || '', page.url).href));
    Array.from(root.head.querySelectorAll('link[rel="stylesheet"][data-page-style]')).forEach(link => {
      if (!desired.has(link.href)) link.remove();
    });
  }

  function cloneRouteOutlet(page) {
    const source = page.document.getElementById('routeOutlet');
    if (!source) throw new Error('Destination page is missing its shared-shell route outlet.');
    const outlet = root.importNode(source, true);
    outlet.querySelectorAll('script').forEach(script => script.remove());
    outlet.setAttribute('aria-busy', 'true');
    return outlet;
  }

  function syncNavigationState(route) {
    const isAbout = route === 'about';
    // Keep relative hrefs so the DOM retains its original URL contract on
    // both the repository root and GitHub Pages project-path deployments.
    const designHref = isAbout ? '../' : './';
    const aboutHref = isAbout ? './' : 'about/';
    const contactHref = isAbout ? '../#contact-start' : '#contact-start';

    const logo = root.querySelector('.nav-logo[href]');
    if (logo) logo.setAttribute('href', designHref);

    root.querySelectorAll('.nav-links a[data-route]').forEach(link => {
      const targetRoute = link.dataset.route;
      if (targetRoute === 'about') link.setAttribute('href', aboutHref);
      else if (targetRoute === 'design') link.setAttribute('href', designHref);
      const active = targetRoute === route;
      link.classList.toggle('active-link', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    const contactLink = root.querySelector('.nav-links a[data-route-anchor="contact"]');
    if (contactLink) contactLink.setAttribute('href', contactHref);
  }

  function setNavigationProgress(active, message = 'Loading page') {
    const outlet = root.getElementById('routeOutlet');
    if (outlet) outlet.setAttribute('aria-busy', active ? 'true' : 'false');
    const indicator = root.getElementById('navigationProgress');
    if (!indicator) return;
    indicator.hidden = !active;
    indicator.classList.toggle('is-active', active);
    indicator.textContent = active ? message : '';
  }

  function commitPageDOM(page) {
    syncHead(page);
    const currentOutlet = root.getElementById('routeOutlet');
    if (!currentOutlet) throw new Error('Current document is missing its shared-shell route outlet.');
    currentOutlet.replaceWith(cloneRouteOutlet(page));
    root.body.className = page.document.body.className || '';
    if (root.body.dataset) delete root.body.dataset.curatedViewSlug;
    syncNavigationState(page.route);
    currentRoute = page.route;
    root.body.dataset.pageNavigationReady = 'true';
  }

  function focusAfterNavigation({ hash = '', scrollY = 0, restoreScroll = false } = {}) {
    return nextFrame(windowRef).then(() => nextFrame(windowRef)).then(() => {
      let target = null;
      if (hash) {
        let id = hash.replace(/^#/, '');
        try { id = decodeURIComponent(id); } catch (_) {}
        target = root.getElementById(id);
        if (!target && root.body?.dataset?.curatedViewSlug === id) {
          target = root.getElementById('curatedViewHeading') || root.querySelector('.portfolio-wrapper');
        }
      }
      if (!target) target = root.querySelector('.about-hero h1, main h1, .hero-section h1');
      if (target?.focus) {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
      }
      if (restoreScroll) scrollToPosition(windowRef, root, scrollY);
      else if (!hash) scrollToPosition(windowRef, root, 0);
    });
  }

  function prefetchCurrentLinks() {
    root.querySelectorAll(NAV_LINK_SELECTOR).forEach(link => {
      void prefetch(link.getAttribute('href') || '');
    });
  }

  function destroyActivePage() {
    const oldApp = getApp?.();
    try { oldApp?.destroy?.(); } catch (error) {
      console.warn('Page navigation: previous page cleanup failed.', error);
    }
    setApp?.(null);
  }

  async function navigate(value, options = {}) {
    const sequence = ++navigationSequence;
    let targetUrl;
    try { targetUrl = new URL(value, windowRef.location.href); } catch (_) { return false; }
    const targetRoute = resolvePortfolioRoute(targetUrl, siteRootUrl);
    if (!targetRoute || targetRoute === currentRoute) return false;

    setNavigationProgress(true);
    warmRouteModules(targetRoute);
    try {
      // HTML, route styles, page modules, and eligible data are warmed before
      // the visible route changes. The currently active page remains usable.
      const page = await loadPageDocument(targetUrl.href);
      if (sequence !== navigationSequence) return false;
      if (page.route !== targetRoute) throw new Error('Destination content did not match the requested route.');
      await ensureRouteStyles(page);
      if (sequence !== navigationSequence) return false;

      if (options.history !== 'pop') {
        ensureManualScrollRestoration();
        saveCurrentScroll();
        windowRef.history.pushState({
          __lmPortfolioScrollY: 0,
          __lmPortfolioRoute: targetRoute
        }, '', targetUrl.href);
      }

      // Keep the View Transition callback synchronous: it only disposes the
      // previous page controller and swaps the route outlet. No network, data,
      // feature initialization, image readiness, or async mount work is awaited
      // while the browser is holding the old snapshot.
      const update = () => {
        destroyActivePage();
        commitPageDOM(page);
      };
      if (typeof root.startViewTransition === 'function') {
        const transition = root.startViewTransition(update);
        await transition.updateCallbackDone;
        await transition.finished.catch(() => {});
      } else {
        update();
      }
      if (sequence !== navigationSequence) return false;

      updateRouteStyles(page);
      prefetchCurrentLinks();

      const hash = new URL(targetUrl.href, windowRef.location.href).hash;
      void focusAfterNavigation({
        hash,
        scrollY: options?.scrollY,
        restoreScroll: Boolean(options?.restoreScroll && !hash)
      }).catch(error => console.warn('Page navigation: focus restoration failed.', error));

      // The destination HTML is already visible. Hydrate its independent page
      // module after the visual handoff and keep the shared shell responsive.
      let app = null;
      try {
        app = await mountPage({
          showPageTransition: false,
          awaitProjectMedia: false,
          immediateContentReveal: true
        });
      } catch (error) {
        console.warn('Page navigation: destination is visible but could not fully hydrate.', error);
      }

      if (sequence !== navigationSequence) {
        try { app?.destroy?.(); } catch (_) {}
        return false;
      }
      setApp?.(app);
      setNavigationProgress(false);
      return true;
    } catch (error) {
      if (sequence === navigationSequence) setNavigationProgress(false);
      console.warn('Page navigation: using native fallback after client route failure.', error);
      if (options.history === 'pop') windowRef.location.reload();
      else windowRef.location.assign(targetUrl.href);
      return false;
    }
  }

  function handleClick(event) {
    const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    const link = target?.closest?.(NAV_LINK_SELECTOR);
    if (!link || !root.contains(link) || !isPlainPrimaryClick(event, link)) return;
    const targetUrl = new URL(link.getAttribute('href') || '', windowRef.location.href);
    const targetRoute = resolvePortfolioRoute(targetUrl, siteRootUrl);
    if (!targetRoute || targetRoute === currentRoute) return;
    event.preventDefault();
    void navigate(targetUrl.href);
  }

  function handlePrefetch(event) {
    const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    const link = target?.closest?.(NAV_LINK_SELECTOR);
    if (!link || !root.contains(link)) return;
    const targetUrl = new URL(link.getAttribute('href') || '', windowRef.location.href);
    void prefetch(targetUrl.href, { intent: true });
  }

  function restoreSameRoutePopState(state) {
    const hash = String(windowRef.location.hash || '');
    if (hash) {
      let id = hash.slice(1);
      try { id = decodeURIComponent(id); } catch (_) {}
      const target = root.getElementById(id);
      if (target?.scrollIntoView) {
        target.scrollIntoView({ block: 'start', behavior: 'auto' });
        if (target.focus) {
          if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
          try { target.focus({ preventScroll: true }); } catch (_) {}
        }
      }
      return;
    }
    scrollToPosition(windowRef, root, state?.__lmPortfolioScrollY || 0);
  }

  function handlePopState(event) {
    const targetRoute = resolvePortfolioRoute(windowRef.location.href, siteRootUrl);
    if (!targetRoute || targetRoute === currentRoute) {
      if (targetRoute === currentRoute) restoreSameRoutePopState(event.state);
      return;
    }
    ensureManualScrollRestoration();
    void navigate(windowRef.location.href, {
      history: 'pop',
      restoreScroll: true,
      scrollY: event.state?.__lmPortfolioScrollY || 0
    });
  }

  function handlePageHide() {
    saveCurrentScroll();
    if (windowRef.history) {
      try { windowRef.history.scrollRestoration = nativeScrollRestoration; } catch (_) {}
    }
  }

  root.addEventListener('click', handleClick);
  root.addEventListener('pointerover', handlePrefetch, { passive: true });
  root.addEventListener('focusin', handlePrefetch);
  root.addEventListener('touchstart', handlePrefetch, { passive: true });
  windowRef.addEventListener('popstate', handlePopState);
  windowRef.addEventListener('scroll', handleScroll, { passive: true });
  windowRef.addEventListener('pagehide', handlePageHide, { once: true });

  prefetchCurrentLinks();

  return {
    prefetch,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.removeEventListener('click', handleClick);
      root.removeEventListener('pointerover', handlePrefetch);
      root.removeEventListener('focusin', handlePrefetch);
      root.removeEventListener('touchstart', handlePrefetch);
      windowRef.removeEventListener('popstate', handlePopState);
      windowRef.removeEventListener('scroll', handleScroll);
      windowRef.removeEventListener('pagehide', handlePageHide);
      if (scrollFrame !== null) {
        windowRef.cancelAnimationFrame?.(scrollFrame);
        windowRef.clearTimeout?.(scrollFrame);
      }
    }
  };
}
