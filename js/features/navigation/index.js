/**
 * Navigation feature.
 * Owns mobile menu state and its DOM event lifecycle.
 *
 * Public pages use the same markup:
 *   .hamburger -> #navLinks
 * The CMS has its own navigation implementation, so this feature stays
 * scoped to the portfolio pages only.
 */

export function initNavigation({ root = globalThis.document } = {}) {
  const menuButton = root?.querySelector('.hamburger, .menu-button');
  const mobileMenu = root?.querySelector('.nav-links, .mobile-menu');
  const mobileMenuLinks = Array.from(
    root?.querySelectorAll('.nav-links a, .mobile-menu a') || []
  );

  if (!menuButton || !mobileMenu) {
    return {
      open() {},
      close() {},
      toggle() {},
      destroy() {}
    };
  }

  let isOpen = false;

  function syncAria() {
    menuButton.setAttribute('aria-expanded', String(isOpen));
    menuButton.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
  }

  function open() {
    isOpen = true;
    mobileMenu.classList.add('active');
    mobileMenu.classList.add('is-open');
    root.body?.classList.add('menu-open');
    syncAria();
  }

  function close() {
    isOpen = false;
    mobileMenu.classList.remove('active');
    mobileMenu.classList.remove('is-open');
    root.body?.classList.remove('menu-open');
    syncAria();
  }

  function toggle(event) {
    event?.preventDefault?.();
    if (isOpen) close();
    else open();
  }

  const cleanup = [];
  const bind = (target, type, handler, options) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler, options);
    cleanup.push(() => target.removeEventListener(type, handler, options));
  };

  bind(menuButton, 'click', toggle);
  mobileMenuLinks.forEach(link => bind(link, 'click', close));

  function scrollSamePageContact(targetId) {
    const target = root.getElementById(targetId) || root.querySelector('#contact-section');
    const windowRef = root?.defaultView || globalThis.window;
    if (!target || !windowRef?.scrollTo) return;

    const visualViewport = windowRef.visualViewport;
    const viewportHeight = Number(visualViewport?.height) || Number(windowRef.innerHeight) || 0;
    const viewportTop = Number(visualViewport?.offsetTop) || 0;
    const currentY = Number(windowRef.scrollY) || 0;
    const rect = target.getBoundingClientRect();
    const documentHeight = Math.max(
      Number(root.documentElement?.scrollHeight) || 0,
      Number(root.body?.scrollHeight) || 0
    );
    const maxScrollY = Math.max(0, documentHeight - viewportHeight);
    const targetY = Math.max(
      0,
      Math.min(
        maxScrollY,
        currentY + rect.top + (rect.height / 2) - (viewportTop + viewportHeight / 2)
      )
    );

    // Keep Contact deterministic while the mobile address bar can change the
    // visual viewport. A smooth scroll can otherwise finish against a stale
    // viewport height and land visibly above or below the requested center.
    // Use the legacy two-argument overload so this targeted correction is
    // instant even though the site globally opts into smooth scrolling via CSS.
    windowRef.scrollTo(0, targetY);
  }

  function handleSamePageContactNavigation(event) {
    const link = event.target?.closest?.('.nav-links a[href], .mobile-menu a[href]');
    if (!link || !root?.contains?.(link)) return;

    const windowRef = root?.defaultView || globalThis.window;
    let url;
    try {
      url = new URL(link.getAttribute('href') || '', windowRef.location.href);
    } catch (_) {
      return;
    }

    if (
      !url.hash ||
      url.pathname !== windowRef.location.pathname ||
      url.search !== windowRef.location.search
    ) return;

    let targetId = '';
    try {
      targetId = decodeURIComponent(url.hash.slice(1));
    } catch (_) {
      return;
    }
    if (targetId !== 'contact-start' && targetId !== 'contact-section') return;

    event.preventDefault();
    close();

    try {
      windowRef.history.pushState(null, '', url.pathname + url.search + url.hash);
    } catch (_) {}

    // Let the menu-close/layout pass settle before measuring the target.
    const settle = () => {
      scrollSamePageContact(targetId);
      windowRef.requestAnimationFrame?.(() => scrollSamePageContact(targetId));
    };
    if (typeof windowRef.requestAnimationFrame === 'function') {
      windowRef.requestAnimationFrame(() => windowRef.requestAnimationFrame(settle));
    } else {
      windowRef.setTimeout(settle, 0);
    }
  }

  bind(root, 'click', handleSamePageContactNavigation);

  // The mobile menu uses a dimmed page layer for visual separation. Keep
  // that layer interactive by closing when the user taps anywhere outside
  // the navbar, while preserving normal interaction inside the menu.
  bind(root, 'click', event => {
    if (!isOpen) return;
    const target = event.target;
    if (target?.closest?.('.navbar')) return;
    close();
  });

  bind(root, 'keydown', event => {
    if (event.key === 'Escape' && isOpen) {
      close();
      menuButton.focus?.();
    }
  });

  syncAria();

  return {
    open,
    close,
    toggle,
    destroy() {
      cleanup.splice(0).forEach(remove => {
        try { remove(); } catch (_) {}
      });
      close();
    }
  };
}
