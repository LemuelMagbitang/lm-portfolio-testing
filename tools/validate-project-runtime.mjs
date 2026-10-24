import assert from 'node:assert/strict';
import { mountProjects } from '../js/features/projects/browser-runtime.js?v=20261025-03';
import { getProjectForCard, getCardForProject, getProjects } from '../js/features/projects/project-loader.js?v=20261024-02';
import { buildProjectCardElement } from '../js/features/projects/project-card.js?v=20261025-03';
import { buildProjectThumbnailMedia, disposeProjectThumbnailMedia, waitForProjectThumbnailReadiness, mediaTypeFromSrc } from '../js/features/projects/project-thumbnail.js?v=20261025-03';
import { getLightboxSwipeDirection } from '../js/features/lightbox/index.js?v=20261025-02';
import {
  applyProjectCardOrientation,
  getProjectCardOrientation,
  orientationFromAspectRatio,
  observeProjectCardOrientation
} from '../js/features/projects/card-presentation.js';
import { normalizeProjects } from '../js/data/project-normalizer.js?v=20261024-04';
import { parseYouTubeUrl } from '../js/infrastructure/youtube/url.js';
import { siteAssetUrl } from '../js/infrastructure/browser/site-paths.js?v=20261004-01';

const calls = [];
const children = [];
const fragment = {
  appendChild(node) {
    children.push(node);
    return node;
  }
};

const grid = {
  replaceChildren(next) {
    calls.push(['replaceChildren', next]);
  }
};

const fakeDocument = {
  getElementById(id) {
    assert.equal(id, 'portfolioGrid');
    return grid;
  },
  createDocumentFragment() {
    return fragment;
  }
};

const projects = [
  {
    id: 'runtime-test-project',
    title: 'Runtime Test Project',
    filters: ['3d-motion'],
    media: [
      { type: 'image', src: 'media/test.webp' }
    ]
  }
];

const mounted = await mountProjects({
  url: 'data/projects.json',
  documentRef: fakeDocument,
  loadJson: async url => {
    assert.equal(url, 'data/projects.json');
    return projects;
  },
  resolveAssetUrl: value => `/assets/${value}`,
  buildCard: project => ({ project })
});

assert.equal(mounted, true);
assert.equal(children.length, 1);
assert.equal(children[0].project.id, 'runtime-test-project');
assert.equal(calls.length, 1);
assert.equal(calls[0][0], 'replaceChildren');
assert.equal(calls[0][1], fragment);
assert.deepEqual(getProjectForCard(children[0]), {
  id: 'runtime-test-project',
  title: 'Runtime Test Project',
  subtitle: '',
  description: '',
  badge: '',
  badges: [],
  filters: ['3d-motion'],
  thumbnail: {},
  mediaCount: 1,
  capabilities: {
    hasImage: true,
    hasVideo: false,
    hasYouTube: false,
    hasLottie: false,
    hasModel: false
  },
  media: [{ type: 'image', src: 'media/test.webp' }]
});
assert.equal(getProjectForCard({}), null);
assert.equal(getCardForProject('runtime-test-project'), children[0]);
assert.deepEqual(getProjects().map(project => project.id), ['runtime-test-project']);

const partialBuild = await mountProjects({
  url: 'data/projects.json',
  documentRef: fakeDocument,
  loadJson: async () => [
    ...projects,
    {
      id: 'runtime-test-project-2',
      title: 'Partial Build Project',
      media: [{ type: 'image', src: 'media/test-2.webp' }]
    }
  ],
  resolveAssetUrl: value => `/assets/${value}`,
  buildCard: project => project.id === 'runtime-test-project' ? ({ project }) : null
});

assert.equal(partialBuild, false);
assert.deepEqual(getProjects().map(project => project.id), ['runtime-test-project']);
assert.equal(getCardForProject('runtime-test-project'), children[0]);

const missingUrl = await mountProjects({
  documentRef: fakeDocument,
  loadJson: async () => projects,
  buildCard: project => ({ project })
});

assert.equal(missingUrl, false);


const makeElement = () => ({
  className: '',
  dataset: {},
  children: [],
  attributes: new Map(),
  listeners: new Map(),
  style: {
    objectPosition: '',
    transformOrigin: '',
    setProperty(name, value) { this[name] = String(value); }
  },
  classList: {
    values: new Set(),
    add(...names) { names.forEach(name => this.values.add(name)); },
    remove(...names) { names.forEach(name => this.values.delete(name)); }
  },
  append(...nodes) { this.children.push(...nodes); },
  appendChild(node) { this.children.push(node); return node; },
  setAttribute(name, value) { this.attributes.set(name, String(value)); },
  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(handler);
  },
  removeEventListener(name, handler) { this.listeners.get(name)?.delete(handler); },
  dispatchEvent(event) {
    for (const handler of [...(this.listeners.get(event?.type) || [])]) handler(event);
    return true;
  },
  dispatch(name) {
    for (const handler of [...(this.listeners.get(name) || [])]) handler({type:name,target:this});
  },
  textContent: '',
  innerHTML: ''
});

const cardDocument = {
  defaultView: {
    matchMedia: () => ({ matches: false }),
    CustomEvent: globalThis.CustomEvent
  },
  createElement(tagName) {
    const element = makeElement();
    element.tagName = String(tagName).toUpperCase();
    element.ownerDocument = cardDocument;
    return element;
  }
};


const readinessSelectors = [];
const readinessProbeCard = { querySelector(selector) { readinessSelectors.push(selector); return null; } };
assert.equal(await waitForProjectThumbnailReadiness([readinessProbeCard], {count:1}), true);
assert.equal(readinessSelectors[0], '.card-thumbnail img, .card-thumbnail video',
  'First-paint readiness must not wait on Lottie JSON and delay Gallery initialization.');
const readinessLottie = {
  tagName:'LOTTIE-PLAYER',
  dataset:{mediaState:'ready'},
  addEventListener(){},
  removeEventListener(){}
};
const lottieReadinessSelectors = [];
const lottieReadinessCard = { querySelector(selector) { lottieReadinessSelectors.push(selector); return readinessLottie; } };
assert.equal(await waitForProjectThumbnailReadiness([lottieReadinessCard], {count:1,includeLottie:true}), true);
assert.equal(lottieReadinessSelectors[0], '.card-thumbnail img, .card-thumbnail video, .card-thumbnail lottie-player',
  'Explicit callers can still wait for Lottie source readiness.');

assert.equal(mediaTypeFromSrc('models/legacy.obj?raw=1'), 'model',
  'Legacy OBJ paths without an explicit type should infer a 3D thumbnail.');
assert.equal(mediaTypeFromSrc('models/legacy.glb#preview'), 'model');
assert.equal(mediaTypeFromSrc('animations/legacy.json?raw=1'), 'lottie');
assert.equal(mediaTypeFromSrc('https://cdn.example.test/video.webm?token=abc'), 'video',
  'Video URLs with signed query parameters should retain their media type.');
assert.equal(mediaTypeFromSrc('data:video/mp4;base64,AAAA'), 'video',
  'Data URLs should use their declared media MIME type.');
assert.equal(mediaTypeFromSrc('data:image/webp;base64,AAAA'), 'image');
assert.equal(mediaTypeFromSrc('data:application/json;base64,AAAA'), 'lottie',
  'JSON data URLs should be recognized as Lottie-compatible sources.');
const readinessEvents = new Map();
let readinessTimerCleared = false;
let readinessResolved = false;
const readinessPlayer = {
  tagName:'LOTTIE-PLAYER',
  dataset:{mediaState:'loading'},
  addEventListener(name,handler){if(!readinessEvents.has(name))readinessEvents.set(name,new Set());readinessEvents.get(name).add(handler);},
  removeEventListener(name,handler){readinessEvents.get(name)?.delete(handler);},
  dispatch(name){for(const handler of [...(readinessEvents.get(name)||[])])handler({type:name,target:this});}
};
const readinessTimerWindow = {
  setTimeout(){return 101;},
  clearTimeout(id){assert.equal(id,101);readinessTimerCleared=true;}
};
const readinessWait = waitForProjectThumbnailReadiness(
  [{querySelector(){return readinessPlayer;}}],
  {count:1,timeoutMs:1200,windowRef:readinessTimerWindow,includeLottie:true}
).then(()=>{readinessResolved=true;});
readinessPlayer.dispatch('load');
await Promise.resolve();
assert.equal(readinessResolved,false,
  'Lottie data-load must not be mistaken for completed SVG rendering.');
readinessPlayer.dataset.mediaState='ready';
readinessPlayer.dispatch('ready');
await readinessWait;
assert.equal(readinessResolved,true);
assert.equal(readinessTimerCleared,true);
const thumbnailObservers = [];
class TestThumbnailIntersectionObserver {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.targets = new Set();
    thumbnailObservers.push(this);
  }
  observe(target) { this.targets.add(target); }
  unobserve(target) { this.targets.delete(target); }
  trigger(target, isIntersecting) {
    this.callback([{ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }]);
  }
}
const thumbnailDocument = {
  defaultView: {
    matchMedia: () => ({ matches: false }),
    IntersectionObserver: TestThumbnailIntersectionObserver
  },
  createElement(tagName) {
    const element = makeElement();
    element.tagName = String(tagName).toUpperCase();
    element.src = '';
    element.complete = false;
    element.naturalWidth = 0;
    element.listeners = new Map();
    element.playCount = 0;
    element.pauseCount = 0;
    element.addEventListener = (name, callback) => {
      if (!element.listeners.has(name)) element.listeners.set(name, []);
      element.listeners.get(name).push(callback);
    };
    element.removeEventListener = (name, callback) => {
      const listeners = element.listeners.get(name) || [];
      element.listeners.set(name, listeners.filter(listener => listener !== callback));
    };
    element.dispatch = name => (element.listeners.get(name) || []).slice()
      .forEach(callback => callback({ type: name, target: element }));
    element.removeAttribute = name => {
      element.attributes.delete(name);
      if (name === 'src') element.src = '';
    };
    element.play = () => { element.playCount += 1; return Promise.resolve(); };
    element.pause = () => { element.pauseCount += 1; };
    element.load = () => { element.loadCount = (element.loadCount || 0) + 1; };
    element.querySelectorAll = () => [];
    element.matches = selector => selector === '.project-thumb-media';
    return element;
  }
};

const imageThumbnail = buildProjectThumbnailMedia(
  { type: 'image', src: 'media/lazy.webp' },
  'Lazy image',
  { documentRef: thumbnailDocument, resolveAssetUrl: value => '/assets/' + value }
);
assert.equal(imageThumbnail.loading, 'lazy');
assert.equal(imageThumbnail.dataset.mediaState, 'loading');
const preloadObserver = thumbnailObservers.find(observer => observer.options.rootMargin === '640px 0px');
assert.equal(imageThumbnail.src, '');
assert.equal(imageThumbnail.dataset.lazySrc, '/assets/media/lazy.webp');
preloadObserver.trigger(imageThumbnail, true);
assert.equal(imageThumbnail.src, '/assets/media/lazy.webp');
assert.equal(imageThumbnail.dataset.lazySrc, undefined);
imageThumbnail.complete = true;
imageThumbnail.naturalWidth = 100;
imageThumbnail.dispatch('load');
assert.equal(imageThumbnail.classList.values.has('is-media-ready'), true);

// Disposing a still thumbnail before it reaches the preload margin must detach
// its observer and prevent a delayed intersection callback from starting a fetch.
const disposedDeferredImage = buildProjectThumbnailMedia(
  { type: 'image', src: 'media/disposed-lazy.webp' },
  'Disposed lazy image',
  { documentRef: thumbnailDocument, resolveAssetUrl: value => '/assets/' + value }
);
assert.equal(disposedDeferredImage.src, '');
assert.equal(disposedDeferredImage.dataset.lazySrc, '/assets/media/disposed-lazy.webp');
disposeProjectThumbnailMedia(disposedDeferredImage);
assert.equal(disposedDeferredImage.src, '');
assert.equal(disposedDeferredImage.dataset.mediaActivated, undefined);
preloadObserver.trigger(disposedDeferredImage, true);
assert.equal(
  disposedDeferredImage.src,
  '',
  'A deferred thumbnail disposed before intersection must not start a late asset request.'
);
assert.equal(disposedDeferredImage.dataset.mediaActivated, undefined);

const videoThumbnail = buildProjectThumbnailMedia(
  { type: 'video', src: 'media/lazy.mp4' },
  'Lazy video',
  { documentRef: thumbnailDocument, resolveAssetUrl: value => '/assets/' + value }
);
const visibilityObserver = thumbnailObservers.find(observer => observer.options.rootMargin === '0px');
assert.equal(videoThumbnail.src, '');
assert.equal(videoThumbnail.dataset.lazySrc, '/assets/media/lazy.mp4');
assert.equal(videoThumbnail.preload, 'none');
preloadObserver.trigger(videoThumbnail, true);
assert.equal(videoThumbnail.src, '/assets/media/lazy.mp4');
assert.equal(videoThumbnail.dataset.lazySrc, undefined);
assert.equal(videoThumbnail.preload, 'metadata');
visibilityObserver.trigger(videoThumbnail, true);
assert.equal(videoThumbnail.playCount, 1);
assert.equal(videoThumbnail.preload, 'auto');
videoThumbnail.dispatch('loadeddata');
assert.equal(videoThumbnail.classList.values.has('is-media-ready'), true);
visibilityObserver.trigger(videoThumbnail, false);
assert.ok(videoThumbnail.pauseCount > 0);
assert.equal(videoThumbnail.src, '/assets/media/lazy.mp4');
disposeProjectThumbnailMedia(videoThumbnail);
assert.equal(videoThumbnail.src, '');

let lottiePlayerWarmups = 0;
const lottieThumbnail = buildProjectThumbnailMedia(
  { type: 'lottie', src: 'media/lazy.json' },
  'Lazy Lottie',
  { documentRef: thumbnailDocument, resolveAssetUrl: value => '/assets/' + value, ensureLottiePlayer: () => {
    lottiePlayerWarmups += 1;
    return Promise.resolve(true);
  } }
);
assert.equal(lottieThumbnail.attributes.has('src'), false);
assert.equal(lottieThumbnail.dataset.lazySrc, '/assets/media/lazy.json');
preloadObserver.trigger(lottieThumbnail, true);
preloadObserver.trigger(lottieThumbnail, true); // duplicate observer notifications must not initialize the player twice
assert.equal(lottieThumbnail.attributes.has('src'), false, 'the player should resolve before Lottie JSON attaches');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(lottiePlayerWarmups, 1);
assert.equal(lottieThumbnail.attributes.get('src'), '/assets/media/lazy.json');
visibilityObserver.trigger(lottieThumbnail, true);
assert.equal(lottieThumbnail.playCount, 0,
  'Visibility alone must not play a Lottie source that is still loading.');
assert.equal(lottieThumbnail.attributes.has('autoplay'), false);
lottieThumbnail.dispatch('load');
assert.equal(lottieThumbnail.dataset.mediaState, 'loading',
  'The Lottie thumbnail must remain hidden until its SVG render is ready.');
assert.equal(lottieThumbnail.classList.values.has('is-media-ready'), false);
assert.equal(lottieThumbnail.playCount, 0);
lottieThumbnail.dispatch('ready');
assert.equal(lottieThumbnail.classList.values.has('is-media-ready'), true);
assert.equal(lottieThumbnail.playCount, 1,
  'A visible Lottie should start only after the source-ready event.');
assert.equal(lottieThumbnail.attributes.has('autoplay'), true);
visibilityObserver.trigger(lottieThumbnail, false);
assert.ok(lottieThumbnail.pauseCount > 0);
assert.equal(lottieThumbnail.attributes.has('autoplay'), false);
disposeProjectThumbnailMedia(lottieThumbnail);
assert.equal(lottieThumbnail.attributes.has('src'), false);

// A transient failure to load the optional player must be recoverable when the
// thumbnail leaves and re-enters the viewport, rather than remaining blank.
let lottieRetryAttempts = 0;
const retryableLottieThumbnail = buildProjectThumbnailMedia(
  { type: 'lottie', src: 'media/retryable.json' },
  'Retryable Lottie',
  {
    documentRef: thumbnailDocument,
    resolveAssetUrl: value => '/assets/' + value,
    ensureLottiePlayer: () => {
      lottieRetryAttempts += 1;
      return Promise.resolve(lottieRetryAttempts > 1);
    }
  }
);
preloadObserver.trigger(retryableLottieThumbnail, true);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(lottieRetryAttempts, 1);
assert.equal(retryableLottieThumbnail.dataset.mediaState, 'error');
assert.equal(retryableLottieThumbnail.classList.values.has('is-media-error'), true);
visibilityObserver.trigger(retryableLottieThumbnail, false);
visibilityObserver.trigger(retryableLottieThumbnail, true);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(lottieRetryAttempts, 2);
assert.equal(
  retryableLottieThumbnail.attributes.get('src'),
  '/assets/media/retryable.json',
  'A later viewport entry should retry player loading after an initial failure.'
);
retryableLottieThumbnail.dispatch('ready');
assert.equal(retryableLottieThumbnail.dataset.mediaState, 'ready');
disposeProjectThumbnailMedia(retryableLottieThumbnail);

// Failed animation previews should retain a real static fallback when the
// project has raster artwork, instead of replacing it with an unavailable label.
const fallbackContainer = {
  children: [],
  appendChild(node) { node.parentNode = this; node.parentElement = this; this.children.push(node); return node; },
  removeChild(node) {
    this.children = this.children.filter(child => child !== node);
    node.parentNode = null;
    node.parentElement = null;
    return node;
  }
};
const fallbackLottie = buildProjectThumbnailMedia(
  { type: 'lottie', src: 'media/broken.json', fallbackSrc: 'media/poster.webp' },
  'Broken animation',
  {
    documentRef: thumbnailDocument,
    resolveAssetUrl: value => '/assets/' + value,
    ensureLottiePlayer: () => Promise.resolve(false)
  }
);
fallbackLottie.parentElement = fallbackContainer;
preloadObserver.trigger(fallbackLottie, true);
await new Promise(resolve => setTimeout(resolve, 0));
const fallbackSurface = fallbackContainer.children.find(node => node.className === 'project-thumb-media-fallback');
assert.ok(fallbackSurface, 'Failed Lottie should retain a visible fallback surface.');
assert.equal(fallbackSurface.dataset.state, 'error');
assert.equal(fallbackSurface.children[0]?.src, '/assets/media/poster.webp',
  'Failed Lottie should show the project static artwork if it exists.');
assert.ok(
  fallbackSurface.children.every(node => !/unavailable/i.test(String(node.textContent || ''))),
  'Preview failure UI should not expose an unavailable error label.'
);
disposeProjectThumbnailMedia(fallbackLottie);

// If the optional player finishes loading after its thumbnail has been
// disposed, the completion must not attach the animation source to dead media.
let resolveLateLottiePlayer;
const lateLottieThumbnail = buildProjectThumbnailMedia(
  { type: 'lottie', src: 'media/late.json' },
  'Late Lottie',
  {
    documentRef: thumbnailDocument,
    resolveAssetUrl: value => '/assets/' + value,
    ensureLottiePlayer: () => new Promise(resolve => {
      resolveLateLottiePlayer = resolve;
    })
  }
);
preloadObserver.trigger(lateLottieThumbnail, true);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(typeof resolveLateLottiePlayer, 'function');
disposeProjectThumbnailMedia(lateLottieThumbnail);
resolveLateLottiePlayer(true);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(
  lateLottieThumbnail.attributes.has('src'),
  false,
  'A late player-load completion must not attach a source after thumbnail disposal.'
);
assert.equal(lateLottieThumbnail.listeners.get('ready')?.length || 0, 0);

const pendingLottieTimers = new Map();
let nextLottieTimer = 0;
const timeoutDocument = {
  defaultView: {
    matchMedia: () => ({matches:false}),
    setTimeout(callback, delay) {
      const id = ++nextLottieTimer;
      pendingLottieTimers.set(id,{callback,delay});
      return id;
    },
    clearTimeout(id) { pendingLottieTimers.delete(id); }
  },
  createElement(tagName) {
    const element = thumbnailDocument.createElement(tagName);
    element.isConnected = true;
    element.ownerDocument = timeoutDocument;
    return element;
  }
};
let resolveTimedOutPlayer;
const timedOutLottie = buildProjectThumbnailMedia(
  {type:'lottie',src:'media/late-after-timeout.json'},
  'Late after timeout',
  {documentRef:timeoutDocument,resolveAssetUrl:value=>'/assets/'+value,
   ensureLottiePlayer:()=>new Promise(resolve=>{resolveTimedOutPlayer=resolve;})}
);
await Promise.resolve();
const playerTimerEntry = [...pendingLottieTimers.entries()].find(([,timer])=>timer.delay===6000);
assert.ok(playerTimerEntry,'Lottie player readiness should keep its 6-second timeout.');
pendingLottieTimers.delete(playerTimerEntry[0]);
playerTimerEntry[1].callback();
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(timedOutLottie.dataset.mediaState,'error',
  'A slow player should settle into a recoverable fallback state after its visual timeout.');
resolveTimedOutPlayer(true);
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(timedOutLottie.attributes.has('src'),true,
  'A slow but successful player load must still attach its source after the visual fallback timeout.');
timedOutLottie.dispatch('ready');
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(timedOutLottie.dataset.mediaState,'ready',
  'Late Lottie readiness must replace the slow-load fallback with the rendered animation.');
disposeProjectThumbnailMedia(timedOutLottie);

const disconnectedFrames = new Map();
let nextDisconnectedFrame = 0;
const disconnectedWindow = {
  matchMedia: () => ({matches:false}),
  CustomEvent: globalThis.CustomEvent,
  requestAnimationFrame(callback) {
    const id = ++nextDisconnectedFrame;
    disconnectedFrames.set(id, callback);
    return id;
  },
  cancelAnimationFrame(id) { disconnectedFrames.delete(id); }
};
const disconnectedDocument = {
  defaultView: disconnectedWindow,
  createElement(tagName) {
    const element = thumbnailDocument.createElement(tagName);
    element.isConnected = false;
    element.ownerDocument = disconnectedDocument;
    return element;
  }
};
function flushDisconnectedFrames() {
  let batches = 0;
  while (disconnectedFrames.size && batches++ < 10) {
    const callbacks = [...disconnectedFrames.entries()];
    callbacks.forEach(([id, callback]) => { disconnectedFrames.delete(id); callback(); });
  }
}
let detachedLottieWarmups = 0;
const detachedLottie = buildProjectThumbnailMedia(
  {type:'lottie',src:'media/detached.json'},
  'Detached Lottie',
  {documentRef:disconnectedDocument,resolveAssetUrl:value=>'/assets/'+value,priority:true,
   ensureLottiePlayer:()=>{detachedLottieWarmups++;return Promise.resolve(true);}}
);
assert.equal(detachedLottie.dataset.mediaActivated,undefined,
  'A priority Lottie must wait for the connected card container.');
assert.equal(detachedLottie.attributes.has('src'),false);
detachedLottie.isConnected=true;
flushDisconnectedFrames();
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(detachedLottieWarmups,1);
assert.equal(detachedLottie.attributes.get('src'),'/assets/media/detached.json');
detachedLottie.dispatch('ready');
assert.equal(detachedLottie.dataset.mediaState,'ready');
disposeProjectThumbnailMedia(detachedLottie);

let detachedModelMounts=0,detachedModelCleanups=0,detachedModelBackground=null;
const detachedModel=buildProjectThumbnailMedia(
  {type:'model',src:'models/detached.glb',background:{type:'color',color:'#123456'}},
  'Detached model',
  {documentRef:disconnectedDocument,resolveAssetUrl:value=>'/assets/'+value,
   mountModelViewer:async(container,src,options)=>{
     detachedModelMounts++;detachedModelBackground=options.background;
     assert.equal(src,'/assets/models/detached.glb');
     return ()=>{detachedModelCleanups++;};
   }}
);
assert.equal(detachedModelMounts,0,'A 3D thumbnail must not mount WebGL while detached.');
detachedModel.isConnected=true;
flushDisconnectedFrames();
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(detachedModelMounts,1);
assert.deepEqual(detachedModelBackground,{type:'color',color:'#123456'});
assert.equal(detachedModel.dataset.mediaState,'ready');
disposeProjectThumbnailMedia(detachedModel);
assert.equal(detachedModelCleanups,1);

let modelMounts = 0;
let modelCleanups = 0;
const lifecycleModelThumbnail = buildProjectThumbnailMedia(
  {type:'model',src:'models/lifecycle.glb'},
  'Lifecycle model',
  {
    documentRef: thumbnailDocument,
    resolveAssetUrl: value => '/assets/' + value,
    mountModelViewer: async (container, src, options) => {
      modelMounts += 1;
      assert.equal(src, '/assets/models/lifecycle.glb');
      assert.equal(options.thumbnail, true);
      assert.equal(options.hint, false);
      assert.equal(options.autoRotate, false);
      return () => { modelCleanups += 1; };
    }
  }
);
assert.equal(lifecycleModelThumbnail.dataset.mediaActivated, undefined,
  '3D card previews must not start WebGL while outside the viewport.');
visibilityObserver.trigger(lifecycleModelThumbnail, true);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(modelMounts, 1);
assert.equal(lifecycleModelThumbnail.dataset.mediaState, 'ready');
visibilityObserver.trigger(lifecycleModelThumbnail, false);
assert.equal(modelCleanups, 1,
  'A 3D preview should dispose its renderer when leaving the viewport.');
assert.equal(lifecycleModelThumbnail.dataset.mediaState, 'idle');
visibilityObserver.trigger(lifecycleModelThumbnail, true);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(modelMounts, 2,
  'Re-entering the viewport should create only one new static preview.');
disposeProjectThumbnailMedia(lifecycleModelThumbnail);
assert.equal(modelCleanups, 2,
  'Unmounting a card should release the final WebGL preview.');

const autoFoilCard = buildProjectCardElement({
  id:'auto-foil-card',
  title:'Auto foil card',
  thumbnail:{},
  media:[{type:'image',src:'media/front.webp',holographic:{style:'cosmos',intensity:0.61,texture:'foil.svg',textureMode:'tile'}}]
},{
  documentRef:cardDocument,
  resolveAssetUrl:value=>'/assets/'+value
});
assert.equal(autoFoilCard.children[0].children.some(child=>child.className==='project-thumb-foil'),true,
  'A generated thumbnail should inherit the first image artwork’s foil settings.');

const autoFoilMedia = autoFoilCard.children[0].children[0];
const autoFoilOverlay = autoFoilCard.children[0].children.find(child=>child.className==='project-thumb-foil');
assert.ok(autoFoilMedia && autoFoilOverlay);
assert.equal(autoFoilOverlay.classList.values.has('is-foil-ready'),false);
autoFoilMedia.dispatch('load');
assert.equal(autoFoilMedia.dataset.mediaState,'ready');
assert.equal(autoFoilOverlay.classList.values.has('is-foil-ready'),true,
  'Foil should reveal after decoded thumbnail media is ready.');
autoFoilMedia.dispatch('error');
assert.equal(autoFoilOverlay.classList.values.has('is-foil-ready'),false,
  'Foil should hide when thumbnail media reports an error.');
disposeProjectThumbnailMedia(autoFoilCard);

const autoFoilFromThumbnailCard = buildProjectCardElement({
  id:'auto-foil-from-thumbnail-settings',
  title:'Auto foil from thumbnail settings',
  thumbnail:{src:'',holographic:{style:'aurora',intensity:0.24}},
  media:[{type:'image',src:'media/plain-front.webp'}]
},{
  documentRef:cardDocument,
  resolveAssetUrl:value=>'/assets/'+value
});
const inheritedThumbnailFoil = autoFoilFromThumbnailCard.children[0].children.find(child=>child.className==='project-thumb-foil');
assert.ok(inheritedThumbnailFoil,
  'A generated image thumbnail should inherit its saved thumbnail-level foil settings when media has none.');
assert.equal(inheritedThumbnailFoil.style['--thumb-holo-intensity'],'0.24');
assert.equal(inheritedThumbnailFoil.dataset.holoStyle,'aurora');

const combinedEffectsProject = {
  id:'combined-effects-thumbnail',
  title:'Combined effects thumbnail',
  thumbnail:{src:''},
  media:[
    {type:'image',src:'media/combined-front.webp',holographic:{
      style:'aurora',intensity:0.37,texture:'foil.svg',textureMode:'tile',
      back:'media/combined-back.webp',backFoilEnabled:true,backIntensity:0.82
    }},
    {type:'lottie',src:'media/combined-motion.json'},
    {type:'model',src:'models/combined.glb',background:{type:'color',color:'#123456'}}
  ]
};
const combinedEffectsCard = buildProjectCardElement(combinedEffectsProject,{
  documentRef:cardDocument,
  resolveAssetUrl:value=>'/assets/'+value
});
const combinedThumbnail = combinedEffectsCard.children[0];
const combinedFoilOverlay = combinedThumbnail.children.find(child=>child.className==='project-thumb-foil');
assert.equal(combinedThumbnail.dataset.thumbnailType,'image',
  'Auto thumbnail selection should preserve the first image despite Lottie/3D gallery media.');
assert.ok(combinedFoilOverlay,
  'An auto-generated image thumbnail should retain foil with Lottie and 3D media in the same project.');
assert.equal(combinedFoilOverlay.style['--thumb-holo-intensity'],'0.37',
  'Generated card foil should use front strength.');
assert.equal(combinedFoilOverlay.dataset.holoStyle,'aurora');
const normalizedCombinedEffects = normalizeProjects([combinedEffectsProject])[0];
assert.equal(normalizedCombinedEffects.media[0].holographic.intensity,0.37);
assert.equal(normalizedCombinedEffects.media[0].holographic.backIntensity,0.82,
  'Combined media projects should retain the independent back strength.');
assert.equal(normalizedCombinedEffects.media[1].type,'lottie');
assert.equal(normalizedCombinedEffects.media[2].type,'model');
disposeProjectThumbnailMedia(combinedEffectsCard);

const normalizedSeparateThumbnailFoil = normalizeProjects([{
  id:'separate-thumbnail-foil-strengths',title:'Separate thumbnail foil strengths',
  thumbnail:{src:'',holographic:{style:'aurora',intensity:0.24,back:'media/back.webp',backFoilEnabled:true,backIntensity:0.81}},
  media:[{type:'image',src:'media/front.webp'}]
}])[0];
assert.equal(normalizedSeparateThumbnailFoil.thumbnail.holographic.intensity,0.24);
assert.equal(normalizedSeparateThumbnailFoil.thumbnail.holographic.backIntensity,0.81,
  'Automatic thumbnail normalization must preserve independent back strength.');
assert.equal(inheritedThumbnailFoil.style['--thumb-holo-intensity'],'0.24',
  'Static foil thumbnails use front strength; back strength is used by the interactive flip preview.');

const inferredModelCard = buildProjectCardElement({
  id:'auto-model-from-extension',
  title:'Auto model from extension',
  thumbnail:{src:''},
  media:[{src:'models/legacy.obj?raw=1'}]
},{
  documentRef:cardDocument,
  resolveAssetUrl:value=>'/assets/'+value
});
assert.equal(inferredModelCard.children[0].dataset.thumbnailType,'model');
assert.equal(inferredModelCard.children[0].children[0].className,'project-thumb-model',
  'A generated thumbnail for an untyped OBJ asset should use the 3D preview path.');

const explicitFoilCard = buildProjectCardElement({
  id:'explicit-foil-card',
  title:'Explicit foil card',
  thumbnail:{type:'image',src:'media/thumb.webp',holographic:{style:'aurora',intensity:0.4}},
  media:[{type:'image',src:'media/front.webp'}]
},{
  documentRef:cardDocument,
  resolveAssetUrl:value=>'/assets/'+value
});
assert.equal(explicitFoilCard.children[0].children.some(child=>child.className==='project-thumb-foil'),true,
  'An explicit thumbnail may apply its own saved front-foil strength.');

const capabilityCard = buildProjectCardElement({
  id: 'capability-regression',
  title: 'Capability Regression',
  filters: ['3d-motion'],
  mediaCount: 2,
  capabilities: {
    hasImage: true,
    hasVideo: false,
    hasYouTube: false,
    hasLottie: false,
    hasModel: true
  },
  thumbnail: { type: 'model', src: 'models/test.glb' },
  media: [
    { type: 'image', src: 'media/test.webp' },
    { type: 'model', src: 'models/test.glb' }
  ]
}, {
  documentRef: cardDocument,
  resolveAssetUrl: value => '/assets/' + value
});

assert.equal(capabilityCard.className, 'project-card');
assert.equal(capabilityCard.classList.values.has('has-media-image'), true);
assert.equal(capabilityCard.classList.values.has('has-media-model'), true);
assert.equal(capabilityCard.classList.values.has('has-multiple-media'), true);
assert.equal(capabilityCard.children[0]?.children[0]?.dataset?.modelThumb, 'models/test.glb');
assert.equal(capabilityCard.children[0]?.children?.length, 1);
assert.equal(capabilityCard.children[0]?.children[0]?.children[0]?.children[1]?.textContent, '3D ARTWORK');
assert.equal(capabilityCard.children[0]?.children[0]?.children[0]?.children[2]?.textContent, 'View project');

const presentationRegressionCard = buildProjectCardElement({
  id: 'presentation-regression',
  title: 'Presentation Regression',
  thumbnail: { type: 'image', src: 'media/presentation.webp', orientation: 'landscape' },
  media: [{ type: 'image', src: 'media/presentation.webp' }]
}, {
  documentRef: cardDocument,
  resolveAssetUrl: value => '/assets/' + value
});
assert.equal(presentationRegressionCard.dataset.cardOrientation, 'landscape');
assert.equal(presentationRegressionCard.classList.values.has('card-orientation-landscape'), true);

const emptyMediaCard = buildProjectCardElement({
  id: 'empty-media-fallback',
  title: 'Empty Media Fallback',
  thumbnail: { src: '' },
  media: []
}, {
  documentRef: cardDocument,
  resolveAssetUrl: value => '/assets/' + value
});
const emptyMediaSurface = emptyMediaCard.children[0];
assert.equal(emptyMediaSurface.children.length, 1,
  'Cards with no usable media source must retain a visible fallback surface.');
assert.equal(emptyMediaSurface.children[0].className,
  'project-thumb-media-fallback project-thumb-static-fallback');
assert.equal(emptyMediaSurface.children[0].children[1].textContent, 'PROJECT ARTWORK',
  'The empty-card fallback must use a neutral label rather than an unavailable error message.');

assert.equal(orientationFromAspectRatio(1000, 1000), 'square');
assert.equal(orientationFromAspectRatio(1600, 1000), 'landscape');
assert.equal(orientationFromAspectRatio(600, 1000), 'portrait');
assert.equal(orientationFromAspectRatio(0, 1000), 'auto');

assert.equal(getLightboxSwipeDirection(-120, 18), 1);
assert.equal(getLightboxSwipeDirection(120, -14), -1);
assert.equal(getLightboxSwipeDirection(40, 4), 0);
assert.equal(getLightboxSwipeDirection(-120, 110), 0);
assert.equal(getLightboxSwipeDirection(-120, 18, { threshold: 140 }), 0);

assert.equal(getProjectCardOrientation({
  thumbnail: { orientation: 'portrait' },
  media: [{ type: 'image', src: 'media/test.webp', orientation: 'landscape' }]
}), 'portrait');

assert.equal(getProjectCardOrientation({
  thumbnail: { orientation: 'auto' },
  media: [{ type: 'image', src: 'media/test.webp', orientation: 'landscape' }]
}), 'landscape');

assert.equal(getProjectCardOrientation({
  thumbnail: { src: 'media/thumb.webp', orientation: 'auto' },
  media: [{ type: 'image', src: 'media/test.webp', orientation: 'portrait' }]
}, {
  width: 1600,
  height: 1000,
  mediaType: 'image'
}), 'landscape');

assert.equal(getProjectCardOrientation({
  thumbnail: { orientation: 'auto' },
  media: [{ type: 'youtube', src: 'https://www.youtube.com/shorts/test' }]
}, {
  mediaType: 'youtube'
}), 'square');

const youtubeFallbackCard = buildProjectCardElement({
  id: 'youtube-fallback-regression',
  title: 'YouTube Fallback Regression',
  thumbnail: { type: 'image', src: '' },
  media: [{ type: 'youtube', src: 'https://www.youtube.com/shorts/abcdefgh' }]
}, {
  documentRef: cardDocument,
  resolveAssetUrl: value => value,
  parseYouTubeUrl
});
assert.equal(youtubeFallbackCard.children[0]?.dataset?.thumbnailType, 'youtube');
assert.equal(youtubeFallbackCard.dataset.cardOrientation, 'square');

const youtubeIntrinsicMedia = makeElement();
youtubeIntrinsicMedia.tagName = 'IMG';
youtubeIntrinsicMedia.naturalWidth = 1280;
youtubeIntrinsicMedia.naturalHeight = 720;
const youtubeIntrinsicCard = makeElement();

observeProjectCardOrientation(
  youtubeIntrinsicCard,
  {
    thumbnail: { src: '', orientation: 'auto' },
    media: [{ type: 'youtube', src: 'https://www.youtube.com/shorts/abcdefgh' }]
  },
  youtubeIntrinsicMedia,
  { mediaType: 'youtube' }
);

assert.equal(
  youtubeIntrinsicCard.dataset.cardOrientation,
  'square',
  'YouTube fallback thumbnails must stay square even when the fallback image is 16:9'
);

const deferredImageListeners = {};
const deferredImage = {
  tagName: 'IMG',
  naturalWidth: 0,
  naturalHeight: 0,
  addEventListener(name, callback) {
    deferredImageListeners[name] = callback;
  },
  removeEventListener(name) {
    delete deferredImageListeners[name];
  }
};
const deferredImageCard = makeElement();
const disposeDeferredImage = observeProjectCardOrientation(
  deferredImageCard,
  {
    thumbnail: { src: 'media/deferred.webp', orientation: 'auto' },
    media: [{ type: 'image', src: 'media/deferred.webp' }]
  },
  deferredImage,
  { mediaType: 'image' }
);

assert.equal(
  deferredImageCard.dataset.cardOrientation,
  'square',
  'Unloaded image thumbnails should receive a stable square tier before dimensions are available'
);
assert.equal(typeof deferredImageListeners.load, 'function');

deferredImage.naturalWidth = 1600;
deferredImage.naturalHeight = 1000;
deferredImageListeners.load();

assert.equal(
  deferredImageCard.dataset.cardOrientation,
  'landscape',
  'Explicit image thumbnails must refine to their intrinsic landscape tier after <img> load'
);

disposeDeferredImage();
assert.equal(deferredImageListeners.load, undefined);

const fallbackImageListeners = {};
const fallbackImage = {
  tagName: 'IMG',
  naturalWidth: 0,
  naturalHeight: 0,
  addEventListener(name, callback) {
    fallbackImageListeners[name] = callback;
  },
  removeEventListener(name) {
    delete fallbackImageListeners[name];
  }
};
const fallbackImageCard = makeElement();
const disposeFallbackImage = observeProjectCardOrientation(
  fallbackImageCard,
  {
    thumbnail: { src: '', orientation: 'auto' },
    media: [{ type: 'image', src: 'media/fallback-intrinsic.webp' }]
  },
  fallbackImage,
  { mediaType: 'image' }
);

assert.equal(
  fallbackImageCard.dataset.cardOrientation,
  'square',
  'Fallback image thumbnails should receive a stable square tier before dimensions are available'
);
assert.equal(typeof fallbackImageListeners.load, 'function');

fallbackImage.naturalWidth = 1600;
fallbackImage.naturalHeight = 900;
fallbackImageListeners.load();

assert.equal(
  fallbackImageCard.dataset.cardOrientation,
  'landscape',
  'Fallback image thumbnails must refine to the first media item intrinsic landscape tier after load'
);

disposeFallbackImage();
assert.equal(fallbackImageListeners.load, undefined);

const presentationCard = makeElement();
assert.equal(applyProjectCardOrientation(presentationCard, 'landscape'), 'landscape');
assert.equal(presentationCard.dataset.cardOrientation, 'landscape');
assert.equal(presentationCard.classList.values.has('card-orientation-landscape'), true);
assert.equal(presentationCard.classList.values.has('card-orientation-square'), false);


// Regression: projects with no explicit thumbnail src still rely on thumbnail
// focus/zoom/rotation when the first media item becomes the fallback artwork.
const normalizedFallback = normalizeProjects([{
  id: 'fallback-presentation',
  title: 'Fallback Presentation',
  thumbnail: {
    type: 'image',
    src: '',
    focus: '50% 30%',
    zoom: 1.25,
    rotate: 2
  },
  media: [{ type: 'image', src: 'media/fallback.webp' }]
}])[0];

assert.deepEqual(normalizedFallback.thumbnail, {
  type: 'image',
  focus: '50% 30%',
  zoom: 1.25,
  rotate: 2
});

let fallbackBackgroundCalls = 0;
const fallbackCard = buildProjectCardElement(normalizedFallback, {
  documentRef: cardDocument,
  resolveAssetUrl: value => '/assets/' + value,
  applyMediaBackground: (element, background) => {
    fallbackBackgroundCalls += 1;
    assert.equal(element.className, 'card-thumbnail');
    assert.deepEqual(background, { type: 'color', color: '#222222' });
    return Promise.resolve(true);
  }
});

// Gallery cards no longer render a separate 3D availability badge.
const fallbackThumbnail = fallbackCard.children[0];
const fallbackMedia = fallbackThumbnail.children[0];
assert.equal(fallbackMedia.style.objectPosition, '50% 30%');
assert.equal(fallbackMedia.style.transformOrigin, '50% 30%');
assert.equal(fallbackMedia.style['--thumb-zoom'], '1.25');
assert.equal(fallbackMedia.style['--thumb-rotate'], '2deg');
assert.equal(fallbackBackgroundCalls, 0);

const normalizedThumbnailBackground = normalizeProjects([{
  id: 'fallback-thumbnail-background',
  title: 'Fallback Thumbnail Background',
  thumbnail: {
    src: '',
    background: { type: 'color', color: '#111111' }
  },
  media: [{
    type: 'image',
    src: 'media/fallback-thumbnail-background.webp'
  }]
}])[0];

let thumbnailBackgroundCalls = 0;
buildProjectCardElement(normalizedThumbnailBackground, {
  documentRef: cardDocument,
  resolveAssetUrl: value => '/assets/' + value,
  applyMediaBackground: (element, background) => {
    thumbnailBackgroundCalls += 1;
    assert.equal(element.className, 'card-thumbnail');
    assert.deepEqual(background, { type: 'color', color: '#111111' });
  }
});

assert.equal(
  thumbnailBackgroundCalls,
  1,
  'Thumbnail background should survive when the first media item supplies the fallback thumbnail'
);

const normalizedBackground = normalizeProjects([{
  id: 'fallback-background',
  title: 'Fallback Background',
  thumbnail: {
    src: '',
    focus: '50% 50%',
    zoom: 1
  },
  media: [{
    type: 'image',
    src: 'media/background.webp',
    background: { type: 'color', color: '#222222' }
  }]
}])[0];

let mediaBackgroundCalls = 0;
buildProjectCardElement(normalizedBackground, {
  documentRef: cardDocument,
  resolveAssetUrl: value => '/assets/' + value,
  applyMediaBackground: (element, background) => {
    mediaBackgroundCalls += 1;
    assert.equal(element.className, 'card-thumbnail');
    assert.deepEqual(background, { type: 'color', color: '#222222' });
    return Promise.resolve(true);
  }
});
assert.equal(mediaBackgroundCalls, 1);

const normalizedBackgroundPrecedence = normalizeProjects([{
  id: 'fallback-background-precedence',
  title: 'Fallback Background Precedence',
  thumbnail: {
    src: '',
    background: { type: 'color', color: '#111111' }
  },
  media: [{
    type: 'image',
    src: 'media/background-precedence.webp',
    background: { type: 'color', color: '#222222' }
  }]
}])[0];

let precedenceBackground = null;
buildProjectCardElement(normalizedBackgroundPrecedence, {
  documentRef: cardDocument,
  resolveAssetUrl: value => '/assets/' + value,
  applyMediaBackground: (element, background) => {
    precedenceBackground = background;
    return Promise.resolve(true);
  }
});

assert.deepEqual(
  precedenceBackground,
  { type: 'color', color: '#222222' },
  'Media background should override thumbnail background when the media item is the fallback source'
);

assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/watch?v=abcdefgh'), {
  id: 'abcdefgh',
  isShort: false
});
assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/shorts/abcdefgh?si=test'), {
  id: 'abcdefgh',
  isShort: true
});
assert.deepEqual(parseYouTubeUrl('https://youtu.be/abcdefgh'), {
  id: 'abcdefgh',
  isShort: false
});
assert.deepEqual(parseYouTubeUrl('https://example.com/watch?v=abcdefgh'), {
  id: null,
  isShort: false
});
assert.deepEqual(parseYouTubeUrl('not-a-url'), {
  id: null,
  isShort: false
});

const pathDocument = {
  baseURI: 'https://example.com/portfolio/',
  scripts: []
};
const pathWindow = {
  location: { href: 'https://example.com/portfolio/' }
};
const pathOptions = { documentRef: pathDocument, windowRef: pathWindow };

assert.equal(
  siteAssetUrl('assets/artwork.webp', pathOptions),
  'https://example.com/portfolio/assets/artwork.webp'
);
assert.equal(
  siteAssetUrl('https://cdn.example.com/artwork.webp', pathOptions),
  'https://cdn.example.com/artwork.webp'
);
assert.equal(
  siteAssetUrl('//cdn.example.com/artwork.webp', pathOptions),
  '//cdn.example.com/artwork.webp'
);
assert.equal(
  siteAssetUrl('data:image/png;base64,AAA', pathOptions),
  'data:image/png;base64,AAA'
);
assert.equal(siteAssetUrl('javascript:alert(1)', pathOptions), '');
assert.equal(siteAssetUrl('vbscript:msgbox(1)', pathOptions), '');
assert.equal(siteAssetUrl('ftp://example.com/file.zip', pathOptions), '');
assert.equal(siteAssetUrl('file:///etc/passwd', pathOptions), '');

console.log('Projects runtime boundary validation passed.');
