export const COMPACT_FOIL_MAX_INTENSITY = 0.10;
export const FOIL_MAX_HOVER_TILT_DEG = 7;
export const FOIL_MAX_HOVER_ROLL_DEG = 2.5;
export const FOIL_MAX_HOVER_SHIFT_X_PX = 4;
export const FOIL_MAX_HOVER_SHIFT_Y_PX = 3;
export const FOIL_AUTO_MOTION_FRAME_INTERVAL_MS = 1000 / 30;

const NARROW_FOIL_BREAKPOINT = 760;

function mediaMatches(view, query) {
  try { return Boolean(view?.matchMedia?.(query)?.matches); }
  catch (_) { return false; }
}

/** Responsive capability check; no user-agent sniffing. */
export function isCompactFoilTarget(view = globalThis.window) {
  const width = Number(view?.innerWidth) || 0;
  const narrowViewport = mediaMatches(view, `(max-width: ${NARROW_FOIL_BREAKPOINT}px)`) ||
    (width > 0 && width <= NARROW_FOIL_BREAKPOINT);
  const touchFirst = mediaMatches(view, '(hover: none) and (pointer: coarse)');
  return narrowViewport || touchFirst;
}

/** Only enable pointer parallax where a real fine hover pointer is available. */
export function supportsFoilHover(view = globalThis.window) {
  return mediaMatches(view, '(any-hover: hover) and (any-pointer: fine)');
}

export function prefersReducedFoilMotion(view = globalThis.window) {
  return mediaMatches(view, '(prefers-reduced-motion: reduce)');
}

/** Mobile auto motion and desktop hover can never be enabled at the same time. */
export function shouldAutoRotateFoil(view = globalThis.window) {
  return isCompactFoilTarget(view) &&
    !supportsFoilHover(view) &&
    !prefersReducedFoilMotion(view);
}

export function resolveFoilIntensity(value, compactTarget = false) {
  const parsed = Number(value);
  const intensity = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
  return compactTarget ? Math.min(intensity, COMPACT_FOIL_MAX_INTENSITY) : intensity;
}

/** Deterministic bounded pointer pose: right/down is positive, left/up negative. */
export function getFoilPointerPose(xPercent, yPercent) {
  const x = Math.max(0, Math.min(100, Number(xPercent) || 0));
  const y = Math.max(0, Math.min(100, Number(yPercent) || 0));
  const nx = (x - 50) / 50;
  const ny = (y - 50) / 50;
  const round = value => { const rounded = Math.round(value * 1000) / 1000; return Object.is(rounded, -0) ? 0 : rounded; };
  return {
    x, y,
    rx: round(-ny * FOIL_MAX_HOVER_TILT_DEG),
    ry: round(nx * FOIL_MAX_HOVER_TILT_DEG),
    rotation: round(nx * FOIL_MAX_HOVER_ROLL_DEG),
    shiftX: round(nx * FOIL_MAX_HOVER_SHIFT_X_PX),
    shiftY: round(ny * FOIL_MAX_HOVER_SHIFT_Y_PX)
  };
}

/** Gentle deterministic touch-only parallax; caller throttles updates to ~30 FPS. */
export function getFoilAutoPose(elapsedSeconds = 0) {
  const time = Math.max(0, Number(elapsedSeconds) || 0);
  const round = value => { const rounded = Math.round(value * 1000) / 1000; return Object.is(rounded, -0) ? 0 : rounded; };
  return {
    x: round(50 + 18 * Math.sin(time * 0.50)),
    y: round(50 + 13 * Math.sin(time * 0.40)),
    rotation: round(2.2 * Math.sin(time * 0.34))
  };
}
