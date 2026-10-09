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

  // A real DOM backdrop is more reliable than body::after: it remains fixed to
  // the viewport even while the document underneath is being scrolled.
  const menuBackdrop = root.createElement?.('div');
  if (menuBackdrop) {
    menuBackdrop.className = 'nav-menu-backdrop';
    menuBackdrop.setAttribute('aria-hidden', 'true');
    menuBackdrop.hidden = true;
    menuBackdrop.addEventListener('click', () => close());
    root.body?.appendChild(menuBackdrop);
  }

  function syncAria() {
    menuButton.setAttribute('aria-expanded', String(isOpen));
    menuButton.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
  }

  function open() {
    isOpen = true;
    mobileMenu.classList.add('active');
    mobileMenu.classList.add('is-open');
    root.body?.classList.add('menu-open');
    if (menuBackdrop) menuBackdrop.hidden = false;
    syncAria();
  }

  function close() {
    isOpen = false;
    mobileMenu.classList.remove('active');
    mobileMenu.classList.remove('is-open');
    root.body?.classList.remove('menu-open');
    if (menuBackdrop) menuBackdrop.hidden = true;
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

  function scrollSamePageContact() {
    const target = root.getElementById('contact-grid-anchor')
      || root.querySelector('#contact-section .contact-grid')
      || root.getElementById('contact-start')
      || root.getElementById('contact-section');
    const heading = root.getElementById('contact-start') || target;
    const windowRef = root?.defaultView || globalThis.window;
    if (!target || !windowRef?.scrollTo) return;

    const viewportHeight = Number(windowRef.visualViewport?.height) || Number(windowRef.innerHeight) || 0;
    const currentY = Number(windowRef.scrollY) || 0;
    const rect = target.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const navbarHeight = Number(root.querySelector('.navbar')?.getBoundingClientRect?.().height) || 0;
    const usableTop = Math.max(navbarHeight + 24, 24);
    const usableHeight = Math.max(1, viewportHeight - usableTop);

    // Center the Contact group in the usable viewport rather than positioning
    // only its heading. This gives desktop and mobile the same intentional
    // compositional balance while the safety clamp keeps the heading clear of
    // the fixed navbar.
    const targetCenterY = rect.top + rect.height / 2;
    const desiredY = currentY + targetCenterY - (usableTop + usableHeight / 2);
    const headingSafeY = currentY + headingRect.top - usableTop;
    const documentHeight = Math.max(
      Number(root.documentElement?.scrollHeight) || 0,
      Number(root.body?.scrollHeight) || 0
    );
    const maxScrollY = Math.max(0, documentHeight - viewportHeight);
    const targetY = Math.max(0, Math.min(maxScrollY, Math.min(desiredY, headingSafeY)));

    const scrollingElement = root.scrollingElement || root.documentElement;
    [scrollingElement, root.documentElement, root.body].filter(Boolean).forEach(element => {
      element.scrollTop = targetY;
    });
    try { windowRef.scrollTo({ left: 0, top: targetY, behavior: 'instant' }); }
    catch (_) { windowRef.scrollTo(0, targetY); }
  }

  function normalizedPagePath(pathname) {
    let pathnameValue = String(pathname || '').replace(/index\.html$/, '');
    if (pathnameValue.length > 1) pathnameValue = pathnameValue.replace(/\/+$/, '');
    return pathnameValue || '/';
  }

  function handleSamePageHomeNavigation(event) {
    const link = event.currentTarget;
    const windowRef = root?.defaultView || globalThis.window;
    if (!link || !windowRef?.location) return;

    let url;
    try { url = new URL(link.getAttribute('href') || '', windowRef.location.href); }
    catch (_) { return; }

    if (
      url.origin !== windowRef.location.origin ||
      url.hash ||
      normalizedPagePath(url.pathname) !== normalizedPagePath(windowRef.location.pathname)
    ) return;

    event.preventDefault();
    event.stopImmediatePropagation?.();
    close();

    // Home/Works navigation from the current Works page is an in-document
    // top reset, not a reload. Clear any Contact/filter hash first so Back
    // navigation and refresh cannot restore the previous Contact stage.
    try {
      windowRef.history.replaceState(null, '', url.pathname + url.search);
    } catch (_) {}

    // Keep navigation and Gallery decoupled: Navigation publishes the semantic
    // home/Works transition, while Gallery decides how its own filter state
    // should reset.
    try {
      windowRef.dispatchEvent(new windowRef.CustomEvent('lm:navigate-home'));
    } catch (_) {}

    const resetHomeScroll = () => {
      const scrollingElement = root.scrollingElement || root.documentElement;

      // Clear every standards/legacy document scroll surface. A single reset
      // is not enough when a smooth-scroll animation was already in flight or
      // Gallery's home-state render is still settling its layout.
      [scrollingElement, root.documentElement, root.body]
        .filter(Boolean)
        .forEach(element => {
          element.scrollLeft = 0;
          element.scrollTop = 0;
        });

      // Override the site's global smooth-scroll setting for this navigation.
      // Direct scrollTop writes above also provide a fallback for engines that
      // do not support the "instant" ScrollBehavior option.
      try {
        windowRef.scrollTo({ left: 0, top: 0, behavior: 'instant' });
      } catch (_) {
        try { windowRef.scrollTo(0, 0); } catch (_) {}
      }
    };

    // Reset synchronously for immediate feedback, then repeat across two paint
    // frames. This cancels a pre-existing scroll animation that could otherwise
    // resume after the first reset and ensures the destination remains at the
    // top after Gallery has applied its home/ALL presentation.
    resetHomeScroll();
    if (typeof windowRef.requestAnimationFrame === 'function') {
      windowRef.requestAnimationFrame(() => {
        resetHomeScroll();
        windowRef.requestAnimationFrame(resetHomeScroll);
      });
    }
  }

  function handleSamePageContactNavigation(event) {
    const boundLink = event.currentTarget;
    const link = boundLink?.matches?.('.nav-links a[href], .mobile-menu a[href]')
      ? boundLink
      : event.target?.closest?.('.nav-links a[href], .mobile-menu a[href]');
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
    event.stopImmediatePropagation?.();
    close();

    try {
      windowRef.history.pushState(null, '', url.pathname + url.search + url.hash);
    } catch (_) {}

    // Correct across paint boundaries after the menu closes, with no delayed
    // second-stage timers that make the Contact landing visibly drift.
    scrollSamePageContact();
    if (typeof windowRef.requestAnimationFrame === 'function') {
      windowRef.requestAnimationFrame(() => {
        scrollSamePageContact();
        windowRef.requestAnimationFrame(() => scrollSamePageContact());
      });
    }
  }

  // Works and the LM logo already target the current Works document on the
  // main page. Keep them in the same document instead of reloading it.
  const samePageHomeLinks = Array.from(new Set([
    root.querySelector('.nav-logo'),
    root.querySelector('.nav-dropdown-toggle'),
    ...mobileMenuLinks
  ].filter(Boolean)));
  samePageHomeLinks.forEach(link => bind(link, 'click', handleSamePageHomeNavigation, true));

  // Bind the same-page Contact contract directly to the concrete links.
  // The menu close listener remains separate; this avoids depending on
  // document-level click delegation or on which nested icon element receives
  // the original event.
  mobileMenuLinks.forEach(link => {
    const href = link.getAttribute('href') || '';
    if (href.includes('#contact-start') || href.includes('#contact-section')) {
      bind(link, 'click', handleSamePageContactNavigation, true);
    }
  });

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
      menuBackdrop?.remove?.();
    }
  };
}
