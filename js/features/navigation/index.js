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
