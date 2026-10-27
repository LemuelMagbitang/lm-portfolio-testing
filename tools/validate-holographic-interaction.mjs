import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  COMPACT_FOIL_MAX_INTENSITY,
  FOIL_MAX_EDGE_ROTATION_DEG,
  getFoilEdgeRotation,
  isCompactFoilTarget,
  resolveFoilIntensity,
  supportsFoilHover
} from '../js/features/lightbox/foil-interaction.js?v=20261027-01';

const mobileView = {
  innerWidth: 390,
  matchMedia: query => ({ matches: query.includes('max-width') })
};
const smallTouchTablet = {
  innerWidth: 1024,
  matchMedia: query => ({ matches: query.includes('hover: none') })
};
const desktopView = {
  innerWidth: 1440,
  matchMedia: query => ({ matches: query.includes('any-hover: hover') || query.includes('any-pointer: fine') })
};
const touchOnlyView = {
  innerWidth: 1024,
  matchMedia: query => ({ matches: query.includes('hover: none') || query.includes('pointer: coarse') })
};

assert.equal(isCompactFoilTarget(mobileView), true);
assert.equal(isCompactFoilTarget(smallTouchTablet), true);
assert.equal(isCompactFoilTarget(desktopView), false);
assert.equal(resolveFoilIntensity(0.95, true), COMPACT_FOIL_MAX_INTENSITY);
assert.equal(resolveFoilIntensity(0.10, true), 0.10);
assert.equal(resolveFoilIntensity(0.95, false), 0.95, 'Desktop must preserve configured intensity.');
assert.equal(resolveFoilIntensity(-1, false), 0);
assert.equal(resolveFoilIntensity(4, false), 1);
assert.equal(supportsFoilHover(desktopView), true);
assert.equal(supportsFoilHover(touchOnlyView), false);

assert.equal(getFoilEdgeRotation(50, 50, 1), 0, 'The centre should stay neutral.');
assert.equal(getFoilEdgeRotation(100, 50, 1), FOIL_MAX_EDGE_ROTATION_DEG);
assert.equal(getFoilEdgeRotation(0, 50, -1), -FOIL_MAX_EDGE_ROTATION_DEG);
assert.ok(Math.abs(getFoilEdgeRotation(90, 50, 1)) > Math.abs(getFoilEdgeRotation(80, 50, 1)));
assert.equal(getFoilEdgeRotation(50, 50, -1), 0);

const mediaRenderer = await readFile(new URL('../js/features/lightbox/media-renderer.js', import.meta.url), 'utf8');
const normalRenderer = await readFile(new URL('../js/features/lightbox/foil-normal-renderer.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');

assert.match(mediaRenderer, /resolveFoilIntensity\(config\.intensity, compactTarget\)/);
assert.match(mediaRenderer, /resolveFoilIntensity\(config\.backIntensity, compactTarget\)/);
assert.match(mediaRenderer, /const rotationDirection = Math\.random\(\) < 0\.5 \? -1 : 1/);
assert.match(mediaRenderer, /getFoilEdgeRotation\(x, y, motion\.rotationDirection/);
assert.match(mediaRenderer, /event\.pointerType !== 'mouse'/);
assert.match(mediaRenderer, /surface\.addEventListener\('click', toggleFlip\)/);
assert.doesNotMatch(mediaRenderer, /HOLOGRAPHIC_TOUCH_HOLD_MS|is-holo-touch-engaged|HOLD \+ MOVE|onTouchMove|setPointerCapture/);
assert.match(normalRenderer, /resolveFoilIntensity\(intensity, compactTarget\)/);
assert.match(normalRenderer, /drawTimer/);
assert.match(normalRenderer, /u_mapCount>1\.5/);
assert.match(styles, /rotateZ\(var\(--holo-rotation,0deg\)\)/);
assert.match(styles, /@media\s*\(max-width:760px\),\s*\(hover:none\) and \(pointer:coarse\)/);
assert.match(styles, /TAP TO FLIP/);

console.log('Holographic foil responsive intensity and interaction contract validated.');
