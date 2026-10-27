import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  COMPACT_FOIL_MAX_INTENSITY,
  FOIL_AUTO_MOTION_FRAME_INTERVAL_MS,
  FOIL_MAX_HOVER_ROLL_DEG,
  FOIL_MAX_HOVER_SHIFT_X_PX,
  FOIL_MAX_HOVER_SHIFT_Y_PX,
  FOIL_MAX_HOVER_TILT_DEG,
  getFoilAutoPose,
  getFoilPointerPose,
  isCompactFoilTarget,
  prefersReducedFoilMotion,
  resolveFoilIntensity,
  shouldAutoRotateFoil,
  supportsFoilHover
} from '../js/features/lightbox/foil-interaction.js?v=20261028-01';

const mediaQueryView = (innerWidth, options = {}) => ({
  innerWidth,
  matchMedia: query => ({ matches:
    query === '(max-width: 760px)' ? innerWidth <= 760
      : query === '(hover: none) and (pointer: coarse)' ? Boolean(options.touch)
      : query === '(any-hover: hover) and (any-pointer: fine)' ? Boolean(options.hover)
      : query === '(prefers-reduced-motion: reduce)' ? Boolean(options.reduced)
      : false
  })
});
const mobileView = mediaQueryView(390, { touch: true });
const touchTabletView = mediaQueryView(1024, { touch: true });
const narrowMouseView = mediaQueryView(600, { hover: true });
const laptopView = mediaQueryView(1366, { hover: true });
const largeDesktopView = mediaQueryView(1920, { hover: true });
const reducedMotionView = mediaQueryView(390, { touch: true, reduced: true });

assert.equal(isCompactFoilTarget(mobileView), true);
assert.equal(isCompactFoilTarget(touchTabletView), true);
assert.equal(isCompactFoilTarget(narrowMouseView), true);
assert.equal(shouldAutoRotateFoil(mobileView), true);
assert.equal(shouldAutoRotateFoil(touchTabletView), true);
assert.equal(shouldAutoRotateFoil(narrowMouseView), false, 'Fine hover takes priority on compact hybrid devices.');
assert.equal(shouldAutoRotateFoil(laptopView), false);
assert.equal(shouldAutoRotateFoil(largeDesktopView), false);
assert.equal(shouldAutoRotateFoil(reducedMotionView), false, 'Reduced motion must disable auto rotation.');
assert.equal(prefersReducedFoilMotion(reducedMotionView), true);
assert.equal(supportsFoilHover(laptopView), true);
assert.equal(supportsFoilHover(largeDesktopView), true);
assert.equal(supportsFoilHover(mobileView), false);

assert.equal(resolveFoilIntensity(0.95, true), COMPACT_FOIL_MAX_INTENSITY);
assert.equal(resolveFoilIntensity(0.10, true), 0.10);
assert.equal(resolveFoilIntensity(0.95, false), 0.95);
assert.equal(resolveFoilIntensity(-1, false), 0);
assert.equal(resolveFoilIntensity(4, false), 1);

const centrePose = getFoilPointerPose(50, 50);
assert.deepEqual(centrePose, { x: 50, y: 50, rx: 0, ry: 0, rotation: 0, shiftX: 0, shiftY: 0 });
const topRightPose = getFoilPointerPose(100, 0);
assert.equal(topRightPose.rx, FOIL_MAX_HOVER_TILT_DEG);
assert.equal(topRightPose.ry, FOIL_MAX_HOVER_TILT_DEG);
assert.equal(topRightPose.rotation, FOIL_MAX_HOVER_ROLL_DEG);
assert.equal(topRightPose.shiftX, FOIL_MAX_HOVER_SHIFT_X_PX);
assert.equal(topRightPose.shiftY, -FOIL_MAX_HOVER_SHIFT_Y_PX);
const bottomLeftPose = getFoilPointerPose(0, 100);
assert.equal(bottomLeftPose.rx, -FOIL_MAX_HOVER_TILT_DEG);
assert.equal(bottomLeftPose.ry, -FOIL_MAX_HOVER_TILT_DEG);
assert.equal(bottomLeftPose.rotation, -FOIL_MAX_HOVER_ROLL_DEG);
assert.equal(bottomLeftPose.shiftX, -FOIL_MAX_HOVER_SHIFT_X_PX);
assert.equal(bottomLeftPose.shiftY, FOIL_MAX_HOVER_SHIFT_Y_PX);

assert.deepEqual(getFoilAutoPose(0), { x: 50, y: 50, rotation: 0 });
assert.notDeepEqual(getFoilAutoPose(1.5), getFoilAutoPose(2.5), 'Auto pose should progress.');
for (let step = 0; step <= 40; step++) {
  const pose = getFoilAutoPose(step * 0.25);
  assert.ok(pose.x >= 32 && pose.x <= 68);
  assert.ok(pose.y >= 37 && pose.y <= 63);
  assert.ok(Math.abs(pose.rotation) <= 2.2);
}
assert.ok(FOIL_AUTO_MOTION_FRAME_INTERVAL_MS >= 33 && FOIL_AUTO_MOTION_FRAME_INTERVAL_MS <= 34);

const mediaRenderer = await readFile(new URL('../js/features/lightbox/media-renderer.js', import.meta.url), 'utf8');
const normalRenderer = await readFile(new URL('../js/features/lightbox/foil-normal-renderer.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
const lightboxStyles = await readFile(new URL('../css/features/lightbox.css', import.meta.url), 'utf8');
assert.match(mediaRenderer, /getFoilPointerPose\(x, y\)/);
assert.match(mediaRenderer, /getFoilAutoPose\(\(timestamp - motion\.autoStartTime\) \/ 1000\)/);
assert.match(mediaRenderer, /motion\.autoFrame = windowRef\.requestAnimationFrame\(animate\)/);
assert.match(mediaRenderer, /cancelAnimationFrame\?\.\(motion\.autoFrame\)/);
assert.match(mediaRenderer, /prefersReducedFoilMotion\(windowRef\)/);
assert.match(mediaRenderer, /syncFoilMotionMode = \(\) =>/);
assert.match(mediaRenderer, /surface\.dataset\.holoMotion = autoRotationAvailable \? 'auto-rotate'/);
assert.match(mediaRenderer, /surface\.dataset\.holoFoil = compactTarget \? 'disabled' : 'enabled'/);
assert.match(mediaRenderer, /syncHolographicNormalRendering\(surface, !compactTarget\)/);
assert.match(mediaRenderer, /record\.canvas\.dataset\.foilNormalState = enabled \? 'active' : 'suspended'/);
assert.match(mediaRenderer, /surface\.addEventListener\('click', toggleFlip\)/);
assert.doesNotMatch(mediaRenderer, /Math\.random\(\)|rotationDirection|getFoilEdgeRotation/);
assert.doesNotMatch(mediaRenderer, /HOLOGRAPHIC_TOUCH_HOLD_MS|is-holo-touch-engaged|HOLD \+ MOVE|onTouchMove|setPointerCapture/);
assert.match(normalRenderer, /resolveFoilIntensity\(intensity,\s*compactTarget\)/);
assert.match(normalRenderer, /let compactTarget = isCompactFoilTarget\(view\)/);
assert.match(normalRenderer, /level=resolveFoilIntensity\(intensity,compactTarget\)/);
assert.match(normalRenderer, /mediaQuery\.addEventListener\('change',handleResize\)/);
assert.match(normalRenderer, /drawTimer/);
assert.match(styles, /rotateZ\(var\(--holo-rotation,0deg\)\)/);
assert.match(styles, /translate3d\(var\(--holo-shift-x,0px\),var\(--holo-shift-y,0px\),9px\)/);
assert.match(styles, /@media\s*\(max-width:760px\),\s*\(hover:none\) and \(pointer:coarse\)/);
assert.match(styles, /@media\s*\(prefers-reduced-motion:reduce\)/);
assert.match(styles, /TAP TO FLIP/);
assert.match(lightboxStyles, /lightbox-holographic-normal-map/);
assert.match(lightboxStyles, /lightbox-holographic-desktop-recommendation/);
assert.match(mediaRenderer, /For the full visual experience, we recommend viewing on a desktop\./);
console.log('Responsive foil modes and bounded pointer/auto poses validated.');
