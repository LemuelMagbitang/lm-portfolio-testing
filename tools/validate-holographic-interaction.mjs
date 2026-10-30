import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  COMPACT_FOIL_MAX_INTENSITY,
  FOIL_AUTO_MOTION_FRAME_INTERVAL_MS,
  FOIL_MAX_HOVER_ROLL_DEG,
  FOIL_MAX_HOVER_SHIFT_X_PX,
  FOIL_MAX_HOVER_SHIFT_Y_PX,
  FOIL_MAX_HOVER_TILT_DEG,
  createFoilAutoMotionProfile,
  getFoilAutoPose,
  getFoilPointerPose,
  isCompactFoilTarget,
  prefersReducedFoilMotion,
  resolveFoilIntensity,
  shouldAutoRotateFoil,
  supportsFoilHover
} from '../js/features/lightbox/foil-interaction.js?v=20261028-03';

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
const slowerMotionProfile = createFoilAutoMotionProfile(() => 0.08);
const fasterMotionProfile = createFoilAutoMotionProfile(() => 0.92);
assert.ok(Object.isFrozen(slowerMotionProfile), 'Each surface motion profile must stay stable for its lifetime.');
assert.notDeepEqual(slowerMotionProfile, fasterMotionProfile, 'Separate holograms must use independent motion parameters.');
assert.deepEqual(
  getFoilAutoPose(3.25, slowerMotionProfile),
  getFoilAutoPose(3.25, slowerMotionProfile),
  'Reusing one profile at the same elapsed time must produce a stable pose.'
);
assert.notDeepEqual(
  getFoilAutoPose(3.25, slowerMotionProfile),
  getFoilAutoPose(3.25, fasterMotionProfile),
  'Independent profiles must produce different movement and phase.'
);
for (const profile of [slowerMotionProfile, fasterMotionProfile]) {
  for (let step = 0; step <= 80; step++) {
    const pose = getFoilAutoPose(step * 0.25, profile);
    assert.ok(pose.x >= 20 && pose.x <= 80);
    assert.ok(pose.y >= 28 && pose.y <= 72);
    assert.ok(Math.abs(pose.rotation) <= 2.5);
  }
}
const autoPoses = [];
for (let step = 0; step <= 80; step++) {
  const pose = getFoilAutoPose(step * 0.25);
  autoPoses.push(pose);
  assert.ok(pose.x >= 20 && pose.x <= 80);
  assert.ok(pose.y >= 28 && pose.y <= 72);
  assert.ok(Math.abs(pose.rotation) <= 2.5);
}
const autoRange = key => Math.max(...autoPoses.map(pose => pose[key])) -
  Math.min(...autoPoses.map(pose => pose[key]));
assert.ok(autoRange('x') > 45, 'Touch auto-parallax must travel a visibly wider horizontal range.');
assert.ok(autoRange('y') > 32, 'Touch auto-parallax must travel a visibly wider vertical range.');
assert.ok(autoPoses.some(pose => pose.rotation > 1.5), 'Auto roll should include a gentle clockwise phase.');
assert.ok(autoPoses.some(pose => pose.rotation < -1.5), 'Auto roll should include a gentle counterclockwise phase.');
assert.ok(FOIL_AUTO_MOTION_FRAME_INTERVAL_MS >= 33 && FOIL_AUTO_MOTION_FRAME_INTERVAL_MS <= 34);

const mediaRenderer = await readFile(new URL('../js/features/lightbox/media-renderer.js', import.meta.url), 'utf8');
const normalRenderer = await readFile(new URL('../js/features/lightbox/foil-normal-renderer.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
const lightboxStyles = await readFile(new URL('../css/features/lightbox.css', import.meta.url), 'utf8');
assert.match(mediaRenderer, /getFoilPointerPose\(x, y\)/);
assert.match(mediaRenderer, /const onPointerMove = event => \{[\s\S]*?setHolographicReflection\(surface, event\);/,
  'Desktop pointer events must update the latest foil target directly and use the existing eased RAF loop.');
assert.doesNotMatch(mediaRenderer, /pointerFrame|pendingPointer|cancelQueuedPointer/,
  'Foil input must not stack a second animation-frame queue before its eased pose loop.');
assert.doesNotMatch(mediaRenderer, /getFoilAutoPose\(\(timestamp - motion\.autoStartTime\) \/ 1000, motion\.autoMotion\)/,
  'Grouped lightbox artwork must not run a continuous per-surface auto-motion loop.');
assert.doesNotMatch(mediaRenderer, /autoMotion:\s*createFoilAutoMotionProfile\(\)/,
  'Rendering many compact holo artworks must not allocate an unused motion profile per item.');
assert.match(lightboxStyles, /grid-template-areas:\s*"hint-primary"\s*"recommendation"/,
  'Compact foil hint must keep the nested face/flip row separate from the desktop recommendation.');
assert.doesNotMatch(lightboxStyles, /grid-template-areas:\s*"face separator action"/,
  'The obsolete direct-child grid must not return after the hint DOM was grouped.');
assert.doesNotMatch(mediaRenderer, /motion\.autoFrame = windowRef\.requestAnimationFrame\(animate\)/,
  'Holo surfaces must not schedule a continuous animation loop while foil effects are disabled on compact devices.');
assert.match(mediaRenderer, /cancelAnimationFrame\?\.\(motion\.autoFrame\)/);
assert.match(mediaRenderer, /prefersReducedFoilMotion\(windowRef\)/);
assert.match(mediaRenderer, /syncFoilMotionMode = \(\) =>/);
assert.match(mediaRenderer, /surface\.dataset\.holoMotion = hoverAvailable \? 'pointer' : 'static'/);
assert.match(mediaRenderer, /let hoverAvailable = !compactTarget && supportsFoilHover\(windowRef\)/);
assert.match(mediaRenderer, /const nextHoverAvailable = !isCompactFoilTarget\(windowRef\)/);
assert.match(mediaRenderer, /if \(holo\?\.back && !isCompactFoilTarget\(windowRef\)\)/);
assert.match(mediaRenderer, /\{ eager: !compactTarget \}/);
assert.ok(!mediaRenderer.includes('startFoilAutoRotation('),
  'Automatic rotation must be removed from the grouped lightbox lifecycle.');
assert.match(mediaRenderer, /surface\.dataset\.holoFoil = compactTarget \? 'disabled' : 'enabled'/);
assert.match(mediaRenderer, /syncHolographicNormalRendering\(surface, !compactTarget\)/);
assert.ok(mediaRenderer.includes('if (motion?.compactTarget) return;'),
  'Compact motion updates must skip foil-lighting calculations and writes.');
assert.ok(mediaRenderer.includes("surface.style.setProperty('--holo-rx'"),
  'Transform properties must remain available for centered desktop pointer response.');
assert.ok(mediaRenderer.includes("surface.style.setProperty('--holo-shift-x'"),
  'Artwork translation properties must remain initialized for centering and reset behavior.');
assert.match(mediaRenderer, /record\.canvas\.dataset\.foilNormalState = enabled \? 'active' : 'suspended'/);
assert.match(mediaRenderer, /const onPointerLeave = event => \{[\s\S]*?clientX >= rect\.left && clientX < rect\.right[\s\S]*?clientY >= rect\.top && clientY < rect\.bottom[\s\S]*?return;[\s\S]*?setHolographicTarget\(surface, 50, 50, 0\);/,
  'Transient pointerleave inside the outer card bounds must not erase desktop foil response.');
assert.match(mediaRenderer, /surface\.addEventListener\('click', toggleFlip\)/);
assert.doesNotMatch(mediaRenderer, /Math\.random\(\)|rotationDirection|getFoilEdgeRotation/);
assert.doesNotMatch(mediaRenderer, /HOLOGRAPHIC_TOUCH_HOLD_MS|is-holo-touch-engaged|HOLD \+ MOVE|onTouchMove|setPointerCapture/);
// Tile-mode normal maps use shader-side repeat addressing; retain clamp sampler
// state for WebGL 1 compatibility with non-power-of-two pattern uploads.
assert.match(normalRenderer, /vec2 addressPatternUV\(vec2 p\)\s*\{\s*return u_uvScale>1\.0\?fract\(p\):clamp\(p,vec2\(0\.0\),vec2\(1\.0\)\);\s*\}/);
for (let mapIndex = 0; mapIndex < 4; mapIndex += 1) {
  assert.ok(normalRenderer.includes(
    `float heightAt${mapIndex}(vec2 p){return luminance(texture2D(u_map${mapIndex},addressPatternUV(p)));}`
  ), `Height map ${mapIndex} must use repeat-aware UV addressing.`);
}
assert.ok(
  normalRenderer.includes('gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE)') &&
  normalRenderer.includes('gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE)'),
  'WebGL 1 non-power-of-two maps must retain CLAMP_TO_EDGE sampler state.'
);
assert.match(normalRenderer, /resolveFoilIntensity\(intensity,\s*compactTarget\)/);
assert.match(normalRenderer, /let compactTarget = isCompactFoilTarget\(view\)/);
assert.match(normalRenderer, /level=resolveFoilIntensity\(intensity,compactTarget\)/);
assert.match(normalRenderer, /mediaQuery\.addEventListener\('change',handleResize\)/);
assert.match(normalRenderer, /drawTimer/);
const foilDrawStart = normalRenderer.indexOf('function drawNow(){');
const foilDrawEnd = normalRenderer.indexOf('  const scheduleDrawTimer', foilDrawStart);
assert.ok(foilDrawStart >= 0 && foilDrawEnd > foilDrawStart,
  'Foil renderer must keep a bounded drawNow routine.');
const foilDrawSource = normalRenderer.slice(foilDrawStart, foilDrawEnd);
assert.ok(foilDrawSource.includes('gl.drawArrays(gl.TRIANGLE_STRIP,0,4)'),
  'The foil pass must redraw its full-screen quad on every frame.');
assert.doesNotMatch(foilDrawSource, /gl\.clear(?:Color)?\s*\(/,
  'A full-screen quad that writes transparent output for uncovered pixels must not clear the entire drawing buffer first.');
assert.ok(normalRenderer.includes('new Float32Array([-1,-1,0,0,1,-1,1,0,-1,1,0,1,1,1,1,1])'),
  'The foil quad must continue to cover the full viewport.');
assert.ok(normalRenderer.includes('if(coverage<0.008||u_intensity<=0.001){gl_FragColor=vec4(0.0);return;}') &&
  normalRenderer.includes('gl_FragColor=vec4(color,alpha);'),
  'Every fragment path must write a color so the redundant clear can stay removed.');
assert.match(styles, /rotateZ\(var\(--holo-rotation,0deg\)\)/);
assert.match(styles, /translate3d\(var\(--holo-shift-x,0px\),var\(--holo-shift-y,0px\),9px\)/);
assert.match(styles, /@media\s*\(max-width:760px\),\s*\(hover:none\) and \(pointer:coarse\)/);
assert.match(styles, /@media\s*\(prefers-reduced-motion:reduce\)/);
assert.match(styles, /TAP TO FLIP/);
assert.match(lightboxStyles, /lightbox-holographic-normal-map/);
const compactRuleStart = lightboxStyles.indexOf('@media (max-width:760px), (hover:none) and (pointer:coarse) {');
const compactRuleEnd = lightboxStyles.indexOf('/* Desktop:', compactRuleStart);
assert.ok(compactRuleStart >= 0 && compactRuleEnd > compactRuleStart,
  'Compact foil rules must stay scoped to mobile/coarse-pointer targets.');
const compactFoilCss = lightboxStyles.slice(compactRuleStart, compactRuleEnd);
for (const layer of [
  '.lightbox-holographic-spectrum',
  '.lightbox-holographic-cosmos-layer',
  '.lightbox-holographic-grain-layer',
  '.lightbox-holographic-glitter-layer',
  '.lightbox-holographic-environment',
  '.lightbox-holographic-glare',
  '.lightbox-holographic-prism',
  '.lightbox-holographic-ribbons',
  '.lightbox-holographic-diffraction',
  '.lightbox-holographic-sparkles',
  '.lightbox-holographic-sheen',
  '.lightbox-holographic-texture',
  '.lightbox-holographic-normal-map'
]) assert.ok(compactFoilCss.includes(layer), `Compact presentation must suppress ${layer}.`);
assert.ok(compactFoilCss.includes('display:none!important;'),
  'Compact foil layers must not paint on mobile.');
assert.ok(compactFoilCss.includes('background-image:none!important;'),
  'Mobile must suppress foil textures at the cascade level.');
assert.ok(compactFoilCss.includes('opacity:0!important;') &&
  compactFoilCss.includes('mix-blend-mode:normal!important;'),
  'Mobile foil layers must be transparent and use a non-blending composite mode.');
assert.ok(compactFoilCss.includes('.lightbox-holographic[data-holo-style] .lightbox-holographic-prism') &&
  compactFoilCss.includes('.lightbox-holographic[data-holo-style] .lightbox-holographic-ribbons') &&
  compactFoilCss.includes('.lightbox-holographic[data-holo-style] .lightbox-holographic-sheen'),
  'Mobile overrides must beat the higher-specificity style-specific foil enable rules.');
assert.ok(compactFoilCss.includes('transform-style:preserve-3d;') &&
  compactFoilCss.includes('will-change:transform;'),
  'Mobile must retain the transform-only 3D parallax surface.');
assert.ok(styles.includes('.lightbox-holographic-spectrum{'),
  'Desktop foil material rules must remain available.');
assert.match(lightboxStyles, /lightbox-holographic-desktop-recommendation/);
assert.match(lightboxStyles, /@media \(max-width:767px\)\s*\{[\s\S]*?#lightboxMediaContainer \.lightbox-media-item:has\(\.lightbox-holographic\)\s*\{[\s\S]*?width:75%;[\s\S]*?max-width:75%;/,
  'Mobile holographic media items must stay centered at 75% width; desktop sizing must not be changed.');
assert.match(mediaRenderer, /Switch to desktop for the full effect\./);
console.log('Responsive foil modes and bounded pointer/auto poses validated.');
