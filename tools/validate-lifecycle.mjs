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


// One observation cleanup must not disconnect other targets on the same
// observer; the lifecycle releases each observation independently.
const observerLifecycle = createLifecycle();
const observedTargets = new Set();
const observer = {
  observe(target) { observedTargets.add(target); },
  unobserve(target) { observedTargets.delete(target); },
  disconnect() { observedTargets.clear(); }
};
const targetA = { id: 'a' };
const targetB = { id: 'b' };
const removeObservationA = observerLifecycle.observe(observer, targetA);
observerLifecycle.observe(observer, targetB);
assert.deepEqual([...observedTargets], [targetA, targetB]);
removeObservationA();
assert.deepEqual(
  [...observedTargets],
  [targetB],
  'removing one observation must not disconnect unrelated targets'
);
observerLifecycle.cleanup();
assert.deepEqual([...observedTargets], [], 'lifecycle cleanup releases remaining observations');

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
assert.match(pageCompositionSource, /\[heroFeature, footerFeature, galleryFeature, aboutFeature, reviewsFeature\] = await Promise\.all\(/);
assert.match(pageCompositionSource, /visibleReviewsPromise/);
assert.match(pageCompositionSource, /const projectLottiePlayerPreloadPromise = projectModels\.some\(/);
assert.match(pageCompositionSource, /const LOTTIE_PLAYER_STARTUP_WAIT_MS = 2500/);
assert.match(pageCompositionSource, /timerOwner\.setTimeout\?\.\(\(\) =>/);
assert.match(pageCompositionSource, /Lottie player startup warm-up timed out; continuing startup/);
assert.match(pageCompositionSource, /await Promise\.all\(\[\s*projectMediaPreloadPromise,\s*projectLottiePlayerPreloadPromise,/);

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
assert.ok(
  lightboxSource.indexOf('const clearPointerFocusReturn') <
    lightboxSource.indexOf("bind(documentRef, 'pointerdown', clearPointerFocusReturn, true)"),
  'Lightbox focus-restoration handlers must be initialized before being registered.'
);
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
assert.match(mediaRendererSource, /MEDIA_PRELOAD_TIMEOUT_MS,\s*\/\/ Abort a stalled dimensions fetch[\s\S]*?\(\) => lottieDimensionAbortControllers\.get\(url\)\?\.abort\(\)/);
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
assert.match(mediaRendererSource, /function releasePreloadedVideo\(video\) \{[\s\S]*?video\.pause\(\)[\s\S]*?video\.removeAttribute\('src'\)[\s\S]*?video\.load\(\)[\s\S]*?video\.remove\(\)/);
assert.match(mediaRendererSource, /const cleanup = \(\) => finishPreload\(false\);/);
assert.match(mediaRendererSource, /mediaPreloadRoot\.querySelectorAll\('video'\)\.forEach\(releasePreloadedVideo\)/);
assert.match(mediaRendererSource, /container\.querySelectorAll\('video'\)\.forEach\(releasePreloadedVideo\)/);
assert.match(mediaRendererSource, /async function preloadFetch\(url, \{ fetchPriority = 'low' \} = \{\}\) \{\s*if \(!url \|\| destroyed \|\| typeof globalThis\.fetch !== 'function'\) return false;/);
assert.match(mediaRendererSource, /const preload = \(async \(\) => \{[\s\S]*?await response\.arrayBuffer\(\);[\s\S]*?\}\)\(\);\s*return await withPreloadTimeout\(preload, MEDIA_PRELOAD_TIMEOUT_MS, cleanup\);/);
assert.match(mediaRendererSource, /const MODEL_MODULE_PRELOAD_TIMEOUT_MS = 3500/);
assert.match(mediaRendererSource, /const SECONDARY_MEDIA_STARTUP_WAIT_MS = 4000/);
assert.match(mediaRendererSource, /const secondaryPreloadPromise = constrainedNetwork\s*\?\s*Promise\.resolve\(\[\]\)\s*:\s*runPreloadPool\(secondaryJobs, 6\)\.catch\(\(\) => \[\]\);/);
assert.match(mediaRendererSource, /const secondaryWaitPromise = constrainedNetwork\s*\? Promise\.resolve\(null\)\s*:\s*withPreloadTimeout\(\s*secondaryPreloadPromise,\s*SECONDARY_MEDIA_STARTUP_WAIT_MS/);
assert.match(mediaRendererSource, /scheduleJob\(\s*'viewer-module',\s*\(\) => withPreloadTimeout\(\s*Promise\.resolve\(\)\.then\(preloadModelModule\),\s*MODEL_MODULE_PRELOAD_TIMEOUT_MS/);
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

assert.match(mediaRendererSource, /iframe\.removeEventListener\('load', onLoad\)/);
assert.match(mediaRendererSource, /iframe\.removeEventListener\('error', onError\)/);
assert.ok(mediaRendererSource.includes("try { iframe.removeAttribute('src'); } catch (_) {}"));
assert.match(mediaRendererSource, /const cleanup = \(\) => \{[\s\S]*?youtubeFrameCache\.delete\(embedSrc\)[\s\S]*?finish\(false\)/);
assert.match(mediaRendererSource, /type === 'image'/);
assert.match(mediaRendererSource, /type === 'video'/);
assert.match(mediaRendererSource, /type === 'youtube'/);
assert.match(mediaRendererSource, /const criticalIndex = media\.findIndex\(item => \{/);
assert.match(mediaRendererSource, /const critical =\s*media\.indexOf\(item\) === primaryIndex\s*\|\|\s*type === 'model'/);
assert.match(mediaRendererSource, /const MAX_CACHED_YOUTUBE_FRAMES = 2;/);
assert.match(mediaRendererSource, /function cacheYouTubeFrame\(embedSrc, iframe\) \{[\s\S]*youtubeFrameCache\.set\(embedSrc, iframe\)[\s\S]*while \(youtubeFrameCache\.size > MAX_CACHED_YOUTUBE_FRAMES\)[\s\S]*oldFrame\?\.parentNode === youtubePreloadRoot[\s\S]*oldFrame\.remove\(\)/);
assert.match(mediaRendererSource, /const scheduleYouTubeWarmup = \(key, url\) => \{[\s\S]*youtubeWarmupKeys\.size >= MAX_CACHED_YOUTUBE_FRAMES[\s\S]*scheduleJob\(key, \(\) => preloadYouTube\(url\), false, true\)/);
assert.equal((mediaRendererSource.match(/youtubeFrameCache\.set\(embedSrc, iframe\)/g) || []).length, 1);
assert.equal((mediaRendererSource.match(/scheduleYouTubeWarmup\(key, url\);/g) || []).length, 2);
assert.match(mediaRendererSource, /const \[criticalResults, secondaryOutcome\] = await Promise\.all\(/);
assert.match(mediaRendererSource, /type === 'lottie'/);
assert.match(mediaRendererSource, /function runPreloadPool\(jobs, concurrency = 8\)/);
assert.match(mediaRendererSource, /const scheduledJobs = new Map\(\)/);
assert.match(mediaRendererSource, /critical && !existing\.critical/);
assert.match(mediaRendererSource, /const \[criticalResults, secondaryOutcome\] = await Promise\.all\(/);
assert.match(mediaRendererSource, /if \(!constrainedNetwork\) \{\s*void runPreloadPool\(nonBlockingJobs, 2\)/);
assert.match(mediaRendererSource, /globalThis\.navigator\?\.connection/);
assert.match(mediaRendererSource, /mediaPreloadRoot\?\.isConnected/);
assert.match(mediaRendererSource, /videoDimensionCache\.set\(cacheKey, \{ width, height \}\)/);
assert.match(mediaRendererSource, /function destroy\(\) \{[\s\S]*youtubePreloadRoot\?\.isConnected[\s\S]*if \(mediaPreloadRoot\) \{[\s\S]*mediaPreloadRoot\.querySelectorAll\('video'\)\.forEach\(releasePreloadedVideo\)[\s\S]*mediaPreloadRoot\.isConnected[\s\S]*youtubeFrameCache\.clear\(\)/);

const modelViewerSource = await readFile(new URL('../js/infrastructure/three/model-viewer.js', import.meta.url), 'utf8');
assert.match(modelViewerSource, /__modelViewerMountToken/);
assert.match(modelViewerSource, /const reducedQualityProfile = initialMobileProfile \|\| thumbnailMode/);
assert.match(modelViewerSource, /antialias: !reducedQualityProfile/);
assert.match(modelViewerSource, /powerPreference: reducedQualityProfile \? 'low-power' : 'high-performance'/);
assert.match(modelViewerSource, /const maxPixelRatio = \(mobileProfile \|\| thumbnailMode\) \? 1 : 1\.5/);
assert.match(modelViewerSource, /const pixelRatioChanged = Math\.abs\(pixelRatio - appliedPixelRatio\) > 0\.01;/);
assert.match(modelViewerSource, /const profileChanged = updateRenderProfile\(\);/);
assert.match(modelViewerSource, /const dimensionsChanged = width !== lastSize\.width \|\| height !== lastSize\.height;/);
assert.match(modelViewerSource, /if \(!dimensionsChanged && !fitRequested && !profileChanged\) return;/);
assert.match(modelViewerSource, /if \(dimensionsChanged\) \{\s*renderer\.setSize\(width, height, false\);[\s\S]*?camera\.updateProjectionMatrix\(\);\s*\}/);
assert.match(modelViewerSource, /container\.dataset\.renderFrameCap = mobileProfile \? '30' : '60'/);
assert.match(modelViewerSource, /const frameInterval = isMobileRenderProfile\(\) \? \(1000 \/ 30\) : \(1000 \/ 60\)/);
assert.match(modelViewerSource, /bindContainer\(ownerDocument, 'visibilitychange'/);
assert.match(modelViewerSource, /Math\.min\(clock\.getDelta\(\), 0\.05\)/);
assert.match(modelViewerSource, /const containerCleanup = \[\]/);
assert.match(modelViewerSource, /containerCleanup\.splice\(0\)\.reverse\(\)/);
assert.doesNotMatch(modelViewerSource, /container\.addEventListener\('(?:pointerdown|pointermove|pointercancel|click|keydown|wheel)'/);
assert.match(modelViewerSource, /if \(!isCurrentMount\(\)\) \{[\s\S]*disposeObject\(loaded\.root\)[\s\S]*return null;/);

const foilNormalRendererSource = await readFile(new URL('../js/features/lightbox/foil-normal-renderer.js', import.meta.url), 'utf8');
assert.match(foilNormalRendererSource, /gl\.getExtension\('WEBGL_lose_context'\)\?\.loseContext\(\)/);
assert.match(foilNormalRendererSource, /canvas\.width=0;canvas\.height=0;\s*return NOOP;/);

const aboutSource = await readFile(new URL('../js/features/about/index.js', import.meta.url), 'utf8');
assert.match(aboutSource, /image\.src = ''/);
assert.match(aboutSource, /image\.onload = null/);
assert.match(aboutSource, /image\.onerror = null/);
assert.match(aboutSource, /image\.onload = async \(\) => \{/);
assert.match(aboutSource, /await image\.decode\?\.\(\)/);

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
assert.match(adminSource, /let previewGeneration = 0;/);
assert.match(adminSource, /let previewDisposed = false;/);
assert.match(adminSource, /row\.__disposeMediaPreview = disposeMediaPreview;/);
assert.match(adminSource, /function invalidateCurrentModelViewer\(\)/);
assert.match(adminSource, /delete host\.__modelViewerMountToken/);
assert.match(adminSource, /generation !== previewGeneration/);
assert.match(adminSource, /!row\.isConnected \|\| !host\?\.isConnected/);
assert.match(adminSource, /try \{ cleanup\?\.\(\); \} catch \(_\) \{\}\s*return;/);
const disposePreviewIndex = adminSource.indexOf('oldRow.__disposeMediaPreview?.()');
const replaceMediaListIndex = adminSource.indexOf('medWrap.replaceWith(freshWrap)', disposePreviewIndex);
assert.ok(disposePreviewIndex >= 0 && replaceMediaListIndex > disposePreviewIndex,
  'CMS media previews must be disposed before the old media list is detached.');
assert.match(adminSource, /previewEl\.querySelector\('\[data-model-preview\]'\) !== host/);
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