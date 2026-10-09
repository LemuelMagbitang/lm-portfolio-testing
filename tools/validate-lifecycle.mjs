import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLifecycle } from '../js/core/lifecycle.js';

const lifecycle = createLifecycle();
const events = [];
const target = {
  handlers: new Map(),
  addEventListener(type, handler) {
    this.handlers.set(type, handler);
    events.push(['add', type]);
  },
  removeEventListener(type, handler) {
    if (this.handlers.get(type) === handler) this.handlers.delete(type);
    events.push(['remove', type]);
  }
};

const removeListener = lifecycle.listen(target, 'change', () => events.push(['event']));
assert.equal(target.handlers.size, 1);

removeListener();
assert.equal(target.handlers.size, 0);

let timerFired = false;
lifecycle.timeout(() => { timerFired = true; }, 25);
lifecycle.cleanup();

await new Promise(resolve => setTimeout(resolve, 40));
assert.equal(timerFired, false);
assert.equal(lifecycle.isDisposed(), true);
assert.equal(events.filter(item => item[0] === 'remove').length, 1);

const afterDispose = lifecycle.listen(target, 'change', () => {});
assert.equal(target.handlers.size, 0);
afterDispose();

console.log('Feature lifecycle boundary validated.');


const projectLoaderSource = await readFile(new URL('../js/features/projects/project-loader.js', import.meta.url), 'utf8');
assert.match(projectLoaderSource, /export function destroyProjects\(\)/);
assert.match(projectLoaderSource, /projectCardMap\.clear\(\);/);
assert.match(projectLoaderSource, /projectModels = \[\];/);
assert.match(projectLoaderSource, /let projectLoadToken = 0;/);
assert.match(projectLoaderSource, /const loadToken = \+\+projectLoadToken;/);
assert.match(projectLoaderSource, /loadToken !== projectLoadToken/);
assert.match(projectLoaderSource, /projectLoadToken \+= 1;/);

const pageCompositionSource = await readFile(new URL('../js/app/page-composition.js', import.meta.url), 'utf8');
assert.match(pageCompositionSource, /destroyProjects/);
assert.match(pageCompositionSource, /destroyProjects\(\);/);
assert.match(pageCompositionSource, /activationInput/);
assert.match(pageCompositionSource, /details\.event\?\.type === 'keydown'/);
assert.match(pageCompositionSource, /aboutFeature\?\.cleanup\?\.\(\)/);

const lightboxSource = await readFile(new URL('../js/features/lightbox/index.js', import.meta.url), 'utf8');
assert.match(lightboxSource, /\.lightbox-holographic/);
assert.match(lightboxSource, /bind\(windowRef, 'pagehide', handlePageHide\)/);
assert.match(lightboxSource, /bind\(windowRef, 'pageshow', handlePageShow\)/);
assert.match(lightboxSource, /setAttribute\('aria-hidden','false'\)/);
assert.match(lightboxSource, /setAttribute\('aria-hidden','true'\)/);
assert.match(lightboxSource, /closeLightbox\(\{ restoreFocus: false \}\)/);
assert.match(lightboxSource, /mediaRenderer\.destroy\(\)/);
assert.match(lightboxSource, /suppressPointerFocusRing/);
assert.match(lightboxSource, /lightboxOpenInputModality === 'pointer'/);
assert.match(lightboxSource, /is-pointer-focus-return/);
assert.match(lightboxSource, /openerElement: card/);
assert.match(lightboxSource, /bind\(documentRef, 'pointerdown', clearPointerFocusReturn, true\)/);
const mainStyleSource = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
assert.match(mainStyleSource, /\.project-card\.is-pointer-focus-return:focus-visible/);
assert.match(mainStyleSource, /box-shadow:none!important/);
assert.match(lightboxSource, /let openRenderToken = 0;/);
assert.match(lightboxSource, /const openToken = \+\+openRenderToken;/);
assert.match(lightboxSource, /openRenderToken !== openToken/);
assert.match(lightboxSource, /openRenderToken \+= 1;/);
const mediaRendererSource = await readFile(new URL('../js/features/lightbox/media-renderer.js', import.meta.url), 'utf8');
assert.match(mediaRendererSource, /const withPreloadTimeout = \(promise, timeoutMs = MEDIA_PRELOAD_TIMEOUT_MS, onTimeout = null\)/);
assert.match(mediaRendererSource, /image\.src = ''/);
assert.match(mediaRendererSource, /controller\?\.abort\(\)/);
assert.match(mediaRendererSource, /const activePreloadCleanups = new Set\(\)/);
assert.match(mediaRendererSource, /function registerPreloadCleanup\(cleanup\)/);
assert.match(mediaRendererSource, /Array\.from\(activePreloadCleanups\)\.reverse\(\)/);
assert.match(mediaRendererSource, /destroyed = true;/);
assert.match(mediaRendererSource, /function preloadVideo\(url(?:,|\))/);
assert.match(mediaRendererSource, /image\.fetchPriority = fetchPriority === 'high' \? 'high' : 'low'/);
assert.match(mediaRendererSource, /video\.fetchPriority = fetchPriority === 'high' \? 'high' : 'low'/);
assert.match(mediaRendererSource, /function preloadLottie\(url, \{ fetchPriority = 'low' \}/);
assert.match(mediaRendererSource, /const lottieDimensionAbortControllers = new Map\(\)/);
assert.match(mediaRendererSource, /if \(!url \|\| destroyed \|\| typeof globalThis\.fetch !== 'function'\) return Promise\.resolve\(null\)/);
assert.match(mediaRendererSource, /signal: controller\?\.signal/);
assert.match(mediaRendererSource, /lottieDimensionAbortControllers\.forEach\(controller => \{/);
assert.match(mediaRendererSource, /lottieDimensionAbortControllers\.clear\(\)/);
assert.match(mediaRendererSource, /if \(!destroyed\) lottieDimensionCache\.set\(url, dimensions\)/);
assert.match(mediaRendererSource, /function preloadFetch\(url, \{ fetchPriority = 'low' \}/);
assert.match(mediaRendererSource, /function preloadImage\(url, \{ fetchPriority = 'low' \} = \{\}\) \{\s*if \(!url \|\| destroyed\) return Promise\.resolve\(false\);/);
assert.match(mediaRendererSource, /async function preloadLottie\(url, \{ fetchPriority = 'low' \} = \{\}\) \{\s*if \(!url \|\| destroyed \|\| typeof globalThis\.fetch !== 'function'\) return false;/);
assert.match(mediaRendererSource, /async function preloadVideo\(url, \{ fetchPriority = 'low' \} = \{\}\) \{\s*if \(!url \|\| destroyed\) return false;/);
assert.match(mediaRendererSource, /async function preloadFetch\(url, \{ fetchPriority = 'low' \} = \{\}\) \{\s*if \(!url \|\| destroyed \|\| typeof globalThis\.fetch !== 'function'\) return false;/);
assert.match(mediaRendererSource, /while \(cursor < queue\.length\) \{\s*if \(destroyed\) break;/);
assert.match(mediaRendererSource, /if \(!destroyed && width > 0 && height > 0\) imageDimensionCache\.set\(url, \{ width, height \}\)/);
assert.match(mediaRendererSource, /function normalizeHolographicConfig\(value\)/);
assert.match(mediaRendererSource, /const HOLOGRAPHIC_TOUCH_HOLD_MS = 220;/);
assert.match(mediaRendererSource, /const HOLOGRAPHIC_TOUCH_MOVE_CANCEL_PX = 9;/);
assert.match(mediaRendererSource, /surface\.addEventListener\('touchmove', onTouchMove, \{ passive: false \}\)/);
assert.match(mediaRendererSource, /const onTouchMove = event =>/);
assert.match(mediaRendererSource, /is-holo-touch-pending/);
assert.match(mediaRendererSource, /touchGesture\.engaged/);
assert.match(mediaRendererSource, /is-holo-touch-engaged/);
assert.doesNotMatch(mediaRendererSource, /DeviceOrientationEvent|deviceorientation|requestHolographicMotion/);
assert.match(mediaRendererSource, /Array\.from\(holographicCleanups\)\.reverse\(\)/);
assert.match(mediaRendererSource, /function buildHolographicImage\(frontImage, item, project\)/);
assert.match(mediaRendererSource, /is-flipped/);
assert.match(mediaRendererSource, /\.\.\.\(fetchPriority === 'high' \? \{ priority: 'high' \} : \{\}\)/);
assert.match(mediaRendererSource, /const fetchPriority = critical \? 'high' : 'low'/);
assert.match(mediaRendererSource, /function preloadYouTube\(url\)/);
assert.match(mediaRendererSource, /type === 'image'/);
assert.match(mediaRendererSource, /type === 'video'/);
assert.match(mediaRendererSource, /type === 'youtube'/);
assert.match(mediaRendererSource, /const criticalIndex = media\.findIndex\(item => \{/);
assert.match(mediaRendererSource, /const critical =\s*media\.indexOf\(item\) === primaryIndex\s*\|\|\s*type === 'model'/);
assert.match(mediaRendererSource, /type === 'youtube'[\s\S]*scheduleJob\(key, \(\) => preloadYouTube\(url\), false\)/);
assert.match(mediaRendererSource, /const secondaryPromise = runPreloadPool\(/);
assert.match(mediaRendererSource, /type === 'lottie'/);
assert.match(mediaRendererSource, /function runPreloadPool\(jobs, concurrency = 8\)/);
assert.match(mediaRendererSource, /const scheduledJobs = new Map\(\)/);
assert.match(mediaRendererSource, /critical && !existing\.critical/);
assert.match(mediaRendererSource, /const secondaryPromise = runPreloadPool\(/);
assert.match(mediaRendererSource, /constrainedNetwork \? 1 : 2/);
assert.match(mediaRendererSource, /globalThis\.navigator\?\.connection/);
assert.match(mediaRendererSource, /mediaPreloadRoot\?\.isConnected/);
assert.match(mediaRendererSource, /videoDimensionCache\.set\(cacheKey, \{ width, height \}\)/);
assert.match(mediaRendererSource, /function destroy\(\) \{[\s\S]*youtubePreloadRoot\?\.isConnected[\s\S]*mediaPreloadRoot\?\.isConnected[\s\S]*youtubeFrameCache\.clear\(\)/);

const modelViewerSource = await readFile(new URL('../js/infrastructure/three/model-viewer.js', import.meta.url), 'utf8');
assert.match(modelViewerSource, /__modelViewerMountToken/);
assert.match(modelViewerSource, /antialias: !initialMobileProfile/);
assert.match(modelViewerSource, /powerPreference: initialMobileProfile \? 'low-power' : 'high-performance'/);
assert.match(modelViewerSource, /const maxPixelRatio = mobileProfile \? 1 : 1\.5/);
assert.match(modelViewerSource, /container\.dataset\.renderFrameCap = mobileProfile \? '30' : '60'/);
assert.match(modelViewerSource, /const frameInterval = isMobileRenderProfile\(\) \? \(1000 \/ 30\) : \(1000 \/ 60\)/);
assert.match(modelViewerSource, /bindContainer\(ownerDocument, 'visibilitychange'/);
assert.match(modelViewerSource, /Math\.min\(clock\.getDelta\(\), 0\.05\)/);
assert.match(modelViewerSource, /const containerCleanup = \[\]/);
assert.match(modelViewerSource, /containerCleanup\.splice\(0\)\.reverse\(\)/);
assert.doesNotMatch(modelViewerSource, /container\.addEventListener\('(?:pointerdown|pointermove|pointercancel|click|keydown|wheel)'/);
assert.match(modelViewerSource, /if \(!isCurrentMount\(\)\) \{[\s\S]*disposeObject\(loaded\.root\)[\s\S]*return null;/);

const aboutSource = await readFile(new URL('../js/features/about/index.js', import.meta.url), 'utf8');
assert.match(aboutSource, /image\.src = ''/);
assert.match(aboutSource, /image\.onload = null/);
assert.match(aboutSource, /image\.onerror = null/);

const lottieSource = await readFile(new URL('../js/infrastructure/lottie/player.js', import.meta.url), 'utf8');
assert.match(lottieSource, /\.finally\(\(\) => \{/);
assert.match(lottieSource, /lottiePromise = null/);
assert.match(lottieSource, /loadScriptOnce\(/);

const mediaBackgroundLoaderSource = await readFile(new URL('../js/infrastructure/media-background/loader.js', import.meta.url), 'utf8');
assert.match(mediaBackgroundLoaderSource, /\.finally\(\(\) => \{/);
assert.match(mediaBackgroundLoaderSource, /mediaBackgroundPromise = null/);
assert.match(mediaBackgroundLoaderSource, /loadScriptOnce\(/);

const adminSource = await readFile(new URL('../admin/admin.js', import.meta.url), 'utf8');
assert.equal((adminSource.match(/function buildProjectBody\(el, p, options = \{\}\)/g) || []).length, 1);
const sharedProjectEditorIndex = adminSource.indexOf('function buildProjectBody(el, p, options = {})');
const curatedRendererIndex = adminSource.indexOf('RENDERERS.curatedViews');
const projectsRendererIndex = adminSource.indexOf('RENDERERS.projects');
assert.ok(sharedProjectEditorIndex >= 0 && sharedProjectEditorIndex < curatedRendererIndex);
assert.ok(sharedProjectEditorIndex < projectsRendererIndex);
assert.match(adminSource, /buildProjectBody\(row\.querySelector\('\[data-editor\]'\),e\.project,\{showFilters:false,onChanged:markDirty,filterDefs:\[\]\}\)/);
assert.match(adminSource, /buildProjectBody\(wrap\.querySelector\('\[data-body\]'\), p, \{filterDefs, badgeDefs\}\)/);
assert.match(adminSource, /const deletedBadgeLabels\s*=\s*new Set\(\)/);
assert.match(adminSource, /function getBadgeRenameMap\(\)/);
assert.match(adminSource, /project\.badges=\[\.\.\.new Set\(nextBadges\)\]/);
assert.match(adminSource, /project\.badge=project\.badges\[0\]\|\|''/);
assert.match(adminSource, /\.\.\.\(project\.extensions && typeof project\.extensions === 'object' && !Array\.isArray\(project\.extensions\)/);
assert.match(adminSource, /const seenBadges=new Set\(\)/);
assert.doesNotMatch(adminSource, /function badgeOptions\(current\)/);
assert.match(adminSource, /className='curated-project-option'/);
assert.match(adminSource, /class="curated-project-preview"/);
const navigationGuardIndex = adminSource.indexOf('function goToSection(name){');
const navigationConfirmIndex = adminSource.indexOf("if(dirty[currentSection] && name !== currentSection){", navigationGuardIndex);
const navigationTrackerIndex = adminSource.indexOf('deployTrackVersion++;', navigationGuardIndex);
assert.ok(navigationGuardIndex >= 0 && navigationConfirmIndex > navigationGuardIndex && navigationTrackerIndex > navigationConfirmIndex);

console.log('Lightbox BFCache and 3D mount-race contracts validated.');