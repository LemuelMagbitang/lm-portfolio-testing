/**
 * Architecture V2 — lightbox accessibility controller.
 * Isolates focus management from media rendering during the migration.
 */
const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function createLightboxA11y(lightbox) {
  if (!lightbox) return { open() {}, close() {} };
  let opener = null;

  function getFocusable() {
    return Array.from(lightbox.querySelectorAll(FOCUSABLE)).filter(el => !el.hidden && el.offsetParent !== null);
  }

  function onKeydown(event) {
    if (!lightbox.classList.contains('active') || event.key !== 'Tab') return;
    const items = getFocusable();
    if (!items.length) { event.preventDefault(); lightbox.focus?.(); return; }
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function open() {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lightbox.setAttribute('aria-modal', 'true');
    if (!lightbox.hasAttribute('tabindex')) lightbox.setAttribute('tabindex', '-1');
    document.addEventListener('keydown', onKeydown, true);
    requestAnimationFrame(() => (getFocusable()[0] || lightbox).focus?.());
  }

  function close() {
    document.removeEventListener('keydown', onKeydown, true);
    const target = opener;
    opener = null;
    if (target?.isConnected) requestAnimationFrame(() => target.focus());
  }

  return { open, close };
}
