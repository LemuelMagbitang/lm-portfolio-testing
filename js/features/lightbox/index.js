/** Architecture V2 — complete lightbox controller. */
import { createLifecycle } from '../../core/lifecycle.js';
import { createLightboxMediaRenderer } from './media-renderer.js?v=20261005-16';
export function getLightboxSwipeDirection(deltaX, deltaY, { threshold = 56, axisRatio = 1.2 } = {}) {
  const x = Number(deltaX) || 0;
  const y = Number(deltaY) || 0;
  const absX = Math.abs(x);
  const absY = Math.abs(y);
  if (absX < threshold || absX <= absY * axisRatio) return 0;
  return x < 0 ? 1 : -1;
}

function createLightboxA11y(lightboxEl, documentRef = globalThis.document, windowRef = globalThis.window, lifecycle = null) {
  if (!lightboxEl) return { open() {}, close() {} };
  let opener = null;
  let focusCleanup = null;
  let keydownCleanup = null;
  function getFocusable() {
    return Array.from(lightboxEl.querySelectorAll(
      'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'