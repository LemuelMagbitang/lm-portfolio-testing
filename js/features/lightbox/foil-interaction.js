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

const DEFAULT_FOIL_AUTO_MOTION_PROFILE = Object.freeze({
  xAmplitude: 23, xFrequency: 0.58, xPhase: 0,
  xDriftAmplitude: 3, xDriftFrequency: 0.23, xDriftPhase: 0,
  yAmplitude: 17, yFrequency: 0.46, yPhase: 0,
  yDriftAmplitude: 2.5, yDriftFrequency: 0.29, yDriftPhase: 0,
  rotationAmplitude: 2, rotationFrequency: 0.39, rotationPhase: 0,
  rotationDriftAmplitude: 0.35, rotationDriftFrequency: 0.24, rotationDriftPhase: 0
});

/**
 * Build a bounded motion profile once per holographic surface. Independent
 * frequencies and phases stop nearby pieces from following the same orbit.
 */
export function createFoilAutoMotionProfile(random = Math.random) {
  const sample = () => {
    const value = Number(random());
    return Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0.5;
  };
  const range = (min, max) => min + sample() * (max - min);
  const phase = () => range(0, Math.PI * 2);

  return Object.freeze({
    xAmplitude: range(18, 23),
    xFrequency: range(0.48, 0.65),
    xPhase: phase(),
    xDriftAmplitude: range(2, 4),
    xDriftFrequency: range(0.17, 0.29),
    xDriftPhase: phase(),
    yAmplitude: range(12.5, 17),
    yFrequency: range(0.38, 0.54),
    yPhase: phase(),
    yDriftAmplitude: range(1.5, 3),
    yDriftFrequency: range(0.21, 0.33),
    yDriftPhase: phase(),
    rotationAmplitude: range(1.35, 1.9),
    rotationFrequency: range(0.31, 0.48),
    rotationPhase: phase(),
    rotationDriftAmplitude: range(0.15, 0.35),
    rotationDriftFrequency: range(0.16, 0.27),
    rotationDriftPhase: phase()
  });
}

/** Smooth touch-only parallax; callers reuse one profile and throttle to ~30 FPS. */
export function getFoilAutoPose(elapsedSeconds = 0, profile = DEFAULT_FOIL_AUTO_MOTION_PROFILE) {
  const time = Math.max(0, Number(elapsedSeconds) || 0);
  const motion = profile && typeof profile === 'object' ? profile : DEFAULT_FOIL_AUTO_MOTION_PROFILE;
  const round = value => { const rounded = Math.round(value * 1000) / 1000; return Object.is(rounded, -0) ? 0 : rounded; };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  return {
    x: round(clamp(50 + motion.xAmplitude * Math.sin(time * motion.xFrequency + motion.xPhase) +
      motion.xDriftAmplitude * Math.sin(time * motion.xDriftFrequency + motion.xDriftPhase), 20, 80)),
    y: round(clamp(50 + motion.yAmplitude * Math.sin(time * motion.yFrequency + motion.yPhase) +
      motion.yDriftAmplitude * Math.sin(time * motion.yDriftFrequency + motion.yDriftPhase), 28, 72)),
    rotation: round(clamp(motion.rotationAmplitude * Math.sin(time * motion.rotationFrequency + motion.rotationPhase) +
      motion.rotationDriftAmplitude * Math.sin(time * motion.rotationDriftFrequency + motion.rotationDriftPhase), -2.5, 2.5))
  };
}
