export const COMPACT_FOIL_MAX_INTENSITY = 0.10;
export const FOIL_MAX_EDGE_ROTATION_DEG = 13.5;
const NARROW_FOIL_BREAKPOINT = 760;
const EDGE_ROTATION_START = 0.62;
const EDGE_ROTATION_MAX_RADIUS = 0.97;

function mediaMatches(view, query) {
  try {
    return Boolean(view?.matchMedia?.(query)?.matches);
  } catch (_) {
    return false;
  }
}

/**
 * Keep foil treatment lightweight on narrow layouts and touch-first devices.
 * Uses responsive capabilities, never user-agent sniffing.
 */
export function isCompactFoilTarget(view = globalThis.window) {
  const width = Number(view?.innerWidth) || 0;
  const narrowViewport = mediaMatches(view, `(max-width: ${NARROW_FOIL_BREAKPOINT}px)`) ||
    (width > 0 && width <= NARROW_FOIL_BREAKPOINT);
  const touchFirst = mediaMatches(view, '(hover: none) and (pointer: coarse)');
  return narrowViewport || touchFirst;
}

/**
 * Only enable hover interactions when the device has a real fine hover pointer.
 * any-pointer allows a mouse/trackpad attached to a touch-capable tablet.
 */
export function supportsFoilHover(view = globalThis.window) {
  return mediaMatches(view, '(any-hover: hover) and (any-pointer: fine)');
}

export function resolveFoilIntensity(value, compactTarget = false) {
  const parsed = Number(value);
  const intensity = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
  return compactTarget ? Math.min(intensity, COMPACT_FOIL_MAX_INTENSITY) : intensity;
}

/**
 * Map pointer distance from the artwork centre to a smooth edge roll.
 * Direction is selected once per artwork instance and only determines the sign.
 */
export function getFoilEdgeRotation(xPercent, yPercent, direction = 1, maxRotation = FOIL_MAX_EDGE_ROTATION_DEG) {
  const x = Math.max(0, Math.min(100, Number(xPercent) || 0));
  const y = Math.max(0, Math.min(100, Number(yPercent) || 0));
  const radius = Math.min(1, Math.hypot((x - 50) / 50, (y - 50) / 50));
  // The surface is projected in 3D and has a subtle idle pose, so a real
  // pointer at its visual outer edge may map a few pixels inside the AABB.
  // Saturate in that narrow edge band instead of requiring an impossible 100%.
  const progress = Math.max(0, Math.min(1, (radius - EDGE_ROTATION_START) / (EDGE_ROTATION_MAX_RADIUS - EDGE_ROTATION_START)));
  if (progress <= 0) return 0;
  const sign = Number(direction) < 0 ? -1 : 1;
  const limit = Math.max(0, Number(maxRotation) || 0);
  return Math.round(sign * limit * progress * 100) / 100;
}
