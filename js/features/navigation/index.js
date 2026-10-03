/**
 * Navigation feature.
 * Owns only mobile menu state and its DOM event lifecycle.
 */

export function initNavigation({ root = globalThis.document } = {}) {
  const menuButton = root?.querySelector('.menu-button');
  const mobileMenu = root?.querySelector('.mobile-menu');
  const mobileMenuClose = root?.querySelector('.mobile-menu-close');
  const mobileMenuLinks = Array.from(root?.querySelectorAll('.mobile-menu a') || []);

  function open() {
    if (!mobileMenu) return;
    mobileMenu.classList.add('is-open');
    root.body?.classList.add('menu-open');
  }

  function close() {
    if (!mobileMenu) return;
    mobileMenu.classList.remove('is-open');
    root.body?.classList.remove('menu-open');
  }

  const cleanup = [];
  const bind = (target, type, handler) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler);
    cleanup.push(() => target.removeEventListener(type, handler));
  };

  bind(menuButton, 'click', open);
  bind(mobileMenuClose, 'click', close);
  mobileMenuLinks.forEach(link => bind(link, 'click', close));

  return {
    open,
    close,
    destroy() {
      cleanup.splice(0).forEach(remove => {
        try { remove(); } catch (_) {}
      });
      close();
    }
  };
}
