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

const pageCompositionSource = await readFile(new URL('../js/app/page-composition.js', import.meta.url), 'utf8');
assert.match(pageCompositionSource, /destroyProjects/);
assert.match(pageCompositionSource, /destroyProjects\(\);/);
assert.match(pageCompositionSource, /aboutFeature\?\.cleanup\?\.\(\)/);

const lightboxSource = await readFile(new URL('../js/features/lightbox/index.js', import.meta.url), 'utf8');
assert.match(lightboxSource, /bind\(windowRef, 'pagehide', handlePageHide\)/);
assert.match(lightboxSource, /bind\(windowRef, 'pageshow', handlePageShow\)/);
assert.match(lightboxSource, /setAttribute\('aria-hidden','false'\)/);
assert.match(lightboxSource, /setAttribute\('aria-hidden','true'\)/);
assert.match(lightboxSource, /closeLightbox\(\{ restoreFocus: false \}\)/);
assert.match(lightboxSource, /mediaRenderer\.destroy\(\)/);
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
assert.match(mediaRendererSource, /function preloadVideo\(url\)/);
assert.match(mediaRendererSource, /function preloadYouTube\(url\)/);
assert.match(mediaRendererSource, /type === 'image'/);
assert.match(mediaRendererSource, /type === 'video'/);
assert.match(mediaRendererSource, /type === 'youtube'/);
assert.match(mediaRendererSource, /type === 'lottie'/);
assert.match(mediaRendererSource, /function runPreloadPool\(jobs, concurrency = 8\)/);
assert.match(mediaRendererSource, /globalThis\.navigator\?\.connection/);
assert.match(mediaRendererSource, /mediaPreloadRoot\?\.isConnected/);
assert.match(mediaRendererSource, /videoDimensionCache\.set\(cacheKey, \{ width, height \}\)/);
assert.match(mediaRendererSource, /function destroy\(\) \{[\s\S]*youtubePreloadRoot\?\.isConnected[\s\S]*mediaPreloadRoot\?\.isConnected[\s\S]*youtubeFrameCache\.clear\(\)/);

const modelViewerSource = await readFile(new URL('../js/infrastructure/three/model-viewer.js', import.meta.url), 'utf8');
assert.match(modelViewerSource, /__modelViewerMountToken/);
assert.match(modelViewerSource, /const containerCleanup = \[\]/);
assert.match(modelViewerSource, /containerCleanup\.splice\(0\)\.reverse\(\)/);
assert.doesNotMatch(modelViewerSource, /container\.addEventListener\('(?:pointerdown|pointermove|pointercancel|click|keydown|wheel)'/);
assert.match(modelViewerSource, /if \(!isCurrentMount\(\)\) \{[\s\S]*disposeObject\(loaded\.root\)[\s\S]*return null;/);

const aboutSource = await readFile(new URL('../js/features/about/index.js', import.meta.url), 'utf8');
assert.match(aboutSource, /image\.src = ''/);
assert.match(aboutSource, /image\.onload = null/);
assert.match(aboutSource, /image\.onerror = null/);


const adminSource = await readFile(new URL('../admin/admin.js', import.meta.url), 'utf8');
assert.equal((adminSource.match(/function buildProjectBody\(el, p, options = \{\}\)/g) || []).length, 1);
const sharedProjectEditorIndex = adminSource.indexOf('function buildProjectBody(el, p, options = {})');
const curatedRendererIndex = adminSource.indexOf('RENDERERS.curatedViews');
const projectsRendererIndex = adminSource.indexOf('RENDERERS.projects');
assert.ok(sharedProjectEditorIndex >= 0 && sharedProjectEditorIndex < curatedRendererIndex);
assert.ok(sharedProjectEditorIndex < projectsRendererIndex);
assert.match(adminSource, /buildProjectBody\(row\.querySelector\('\[data-editor\]'\),e\.project,\{showFilters:false,onChanged:markDirty,filterDefs:\[\]\}\)/);
assert.match(adminSource, /buildProjectBody\(wrap\.querySelector\('\[data-body\]'\), p, \{filterDefs\}\)/);
assert.match(adminSource, /className='curated-project-option'/);
assert.match(adminSource, /class="curated-project-preview"/);
const navigationGuardIndex = adminSource.indexOf('function goToSection(name){');
const navigationConfirmIndex = adminSource.indexOf("if(dirty[currentSection] && name !== currentSection){", navigationGuardIndex);
const navigationTrackerIndex = adminSource.indexOf('deployTrackVersion++;', navigationGuardIndex);
assert.ok(navigationGuardIndex >= 0 && navigationConfirmIndex > navigationGuardIndex && navigationTrackerIndex > navigationConfirmIndex);

console.log('Lightbox BFCache and 3D mount-race contracts validated.');
