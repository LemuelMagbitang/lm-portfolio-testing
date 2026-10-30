import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { normalizeProject, normalizeProjectMedia } from '../js/data/project-normalizer.js?v=20261029-01';
import { mountProjectListPreviews } from '../admin/project-preview-runtime.js?v=20261025-02';
import { createFoilNormalRenderer } from '../js/features/lightbox/foil-normal-renderer.js?v=20261028-08';

const root = process.cwd();
const admin = fs.readFileSync(path.join(root, 'admin/admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'admin/admin.css'), 'utf8');
const siteCss = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const lightboxCss = fs.readFileSync(path.join(root, 'css/features/lightbox.css'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'js/features/lightbox/media-renderer.js'), 'utf8');
const inspectController = fs.readFileSync(path.join(root, 'js/features/lightbox/inspect-controller.js'), 'utf8');
const foilNormalRendererSource = fs.readFileSync(path.join(root, 'js/features/lightbox/foil-normal-renderer.js'), 'utf8');
const previewRuntime = fs.readFileSync(path.join(root, 'admin/project-preview-runtime.js'), 'utf8');
const modelViewer = fs.readFileSync(path.join(root, 'js/infrastructure/three/model-viewer.js'), 'utf8');
const mediaBackgroundEngine = fs.readFileSync(path.join(root, 'js/infrastructure/media-background/engine.js'), 'utf8');
const projectsData = JSON.parse(fs.readFileSync(path.join(root, 'data/projects.json'), 'utf8'));
const hero = fs.readFileSync(path.join(root, 'js/features/hero/index.js'), 'utf8');
const logoLookup = fs.readFileSync(path.join(root, 'js/infrastructure/software-logo/lookup.js'), 'utf8');

function createTestEventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    },
    dispatchEvent(type) {
      for (const callback of [...(listeners.get(type) || [])]) callback();
    }
  };
}
// Browsers without IntersectionObserver must still lazy-load only near-view CMS media.
const fallbackView = createTestEventTarget();
fallbackView.innerHeight = 600;
fallbackView.innerWidth = 800;
let nextFrameId = 0;
const pendingFrames = new Map();
fallbackView.requestAnimationFrame = callback => {
  const id = ++nextFrameId;
  pendingFrames.set(id, callback);
  return id;
};
fallbackView.cancelAnimationFrame = id => pendingFrames.delete(id);
function flushFallbackFrames() {
  while (pendingFrames.size) {
    const batch = [...pendingFrames.entries()];
    batch.forEach(([id, callback]) => {
      pendingFrames.delete(id);
      callback(16);
    });
  }
}
const fallbackDocument = createTestEventTarget();
fallbackDocument.defaultView = fallbackView;
fallbackDocument.documentElement = {clientHeight:600, clientWidth:800};
const previewVideo = {
  listeners:new Map(),
  isConnected:true,
  top:900,
  src:'',
  muted:false,
  loop:false,
  autoplay:false,
  playsInline:false,
  preload:'',
  dataset:{previewType:'video',previewSrc:'previews/demo.mp4'},
  loadCount:0,
  playCount:0,
  pauseCount:0,
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  },
  removeEventListener(type, callback) {
    this.listeners.get(type)?.delete(callback);
  },
  dispatchEvent(type) {
    for (const callback of [...(this.listeners.get(type) || [])]) callback({type,target:this});
  },
  getBoundingClientRect() {
    return {top:this.top,bottom:this.top+120,left:0,right:160};
  },
  load() { this.loadCount++; },
  play() { this.playCount++; return Promise.resolve(); },
  pause() { this.pauseCount++; },
  removeAttribute(name) { if (name === 'src') this.src = ''; },
  setAttribute() {}
};
const fallbackRoot = {
  isConnected:true,
  ownerDocument:fallbackDocument,
  querySelectorAll(selector) {
    return selector === '[data-collapsed-preview-media]' ? [previewVideo] : [];
  },
  contains(node) { return node === previewVideo && node.isConnected; }
};
const disposeFallbackPreviews = mountProjectListPreviews(fallbackRoot, {
  resolveUrl:src => 'https://cdn.example.test/' + String(src).replace(/^\/+/, '')
});
assert.equal(previewVideo.src, '', 'Off-screen CMS video previews must remain unloaded without IntersectionObserver.');
assert.equal(previewVideo.playCount, 0, 'Off-screen CMS video previews must not start playback.');
previewVideo.top = 500;
fallbackDocument.dispatchEvent('scroll');
flushFallbackFrames();
assert.equal(previewVideo.src, 'https://cdn.example.test/previews/demo.mp4', 'A preview entering the viewport should resolve and load its media URL.');
assert.equal(previewVideo.playCount, 1, 'A preview entering the viewport should start playback once.');
previewVideo.top = 900;
fallbackView.dispatchEvent('resize');
flushFallbackFrames();
assert.equal(previewVideo.src, '', 'A preview leaving the viewport should release its media source.');
assert.equal(previewVideo.pauseCount, 1, 'A preview leaving the viewport should pause playback.');
disposeFallbackPreviews();
assert.equal(fallbackView.listeners.get('scroll')?.size || 0, 0, 'Fallback scroll listeners must be removed on cleanup.');
assert.equal(fallbackView.listeners.get('resize')?.size || 0, 0, 'Fallback resize listeners must be removed on cleanup.');
assert.equal(fallbackDocument.listeners.get('scroll')?.size || 0, 0, 'Captured document scroll listeners must be removed on cleanup.');

// A CMS Lottie source that exceeds its visual timeout must remain recoverable.
// Use a short timeout here so the regression stays deterministic in CI.
const cmsLottieView = createTestEventTarget();
cmsLottieView.innerHeight = 600;
cmsLottieView.innerWidth = 800;
cmsLottieView.customElements = {get: name => name === 'lottie-player' ? function LottiePlayer() {} : null};
class ImmediatePreviewObserver {
  constructor(callback) { this.callback = callback; }
  observe(target) { this.callback([{target,isIntersecting:true,intersectionRatio:1}]); }
  disconnect() {}
}
cmsLottieView.IntersectionObserver = ImmediatePreviewObserver;
const makePreviewElement = tagName => {
  const listeners = new Map();
  return {
    tagName: String(tagName || 'span').toUpperCase(),
    className: '',
    dataset: {},
    attributes: new Map(),
    children: [],
    parentNode: null,
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    replaceChildren(...children) {
      this.children.forEach(child => { child.parentNode = null; });
      this.children = [];
      children.forEach(child => this.appendChild(child));
    },
    setAttribute(name,value) { this.attributes.set(name,String(value)); },
    removeAttribute(name) { this.attributes.delete(name); },
    addEventListener(name,callback) {
      if (!listeners.has(name)) listeners.set(name,new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name,callback) { listeners.get(name)?.delete(callback); },
    dispatchEvent(name) {
      for (const callback of [...(listeners.get(name)||[])]) callback({type:name,target:this});
    },
    querySelector(selector) {
      return this.children.find(child => String(selector).includes(child.className) || child.className === selector) || null;
    },
    remove() {
      if (!this.parentNode) return;
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index,1);
      this.parentNode = null;
    },
    pause() {}, stop() {}, load() {},
    getLottie() { return cmsLottieReady ? {} : null; }
  };
};
let cmsLottieReady = false;
const cmsLottieDocument = {
  defaultView: cmsLottieView,
  documentElement: {clientHeight:600,clientWidth:800},
  createElement(tagName) { return makePreviewElement(tagName); }
};
const cmsLottieSurface = makePreviewElement('div');
cmsLottieSurface.querySelector = () =>
  cmsLottieSurface.children.find(child => /project-collapsed-preview-fallback|project-collapsed-preview-error/.test(child.className)) || null;
const cmsLottieWrapper = makePreviewElement('div');
cmsLottieWrapper.parentElement = cmsLottieSurface;
const cmsLottieNode = makePreviewElement('lottie-player');
cmsLottieNode.isConnected = true;
cmsLottieNode.dataset = {previewType:'lottie',previewSrc:'animations/slow.json',previewActive:'false',previewState:'idle'};
cmsLottieNode.parentElement = cmsLottieWrapper;
cmsLottieNode.ownerDocument = cmsLottieDocument;
cmsLottieNode.shadowRoot = {querySelector: selector => selector === 'svg' && cmsLottieReady ? {} : null};
cmsLottieNode.setAttribute = function(name,value) {
  this.attributes.set(name,String(value));
  if (name === 'src') this.src = String(value);
};
cmsLottieNode.removeAttribute = function(name) {
  this.attributes.delete(name);
  if (name === 'src') this.src = '';
};
const cmsLottieRoot = {
  isConnected:true,
  ownerDocument:cmsLottieDocument,
  querySelectorAll: selector => selector === '[data-collapsed-preview-media]' ? [cmsLottieNode] : [],
  contains: node => node === cmsLottieNode && node.isConnected
};
const disposeCmsLottie = mountProjectListPreviews(cmsLottieRoot,{
  resolveUrl:src => 'https://cdn.example.test/' + src,
  lottiePlayerTimeoutMs:100,
  lottieMediaTimeoutMs:12
});
await new Promise(resolve => setTimeout(resolve,30));
assert.equal(cmsLottieNode.dataset.previewState,'error',
  'A delayed CMS Lottie preview must expose a settled fallback state.');
assert.ok(cmsLottieSurface.querySelector('.project-collapsed-preview-fallback'),
  'A delayed CMS Lottie preview must show a visible fallback while waiting.');
cmsLottieReady = true;
cmsLottieNode.dispatchEvent('ready');
await new Promise(resolve => setTimeout(resolve,0));
assert.equal(cmsLottieNode.dataset.previewState,'ready',
  'A late CMS Lottie ready event must recover the preview without viewport re-entry.');
assert.equal(cmsLottieSurface.querySelector('.project-collapsed-preview-fallback'),null,
  'Successful late rendering must clear the temporary fallback.');
disposeCmsLottie();


// Runtime regression checks: normalization must not erase the reverse-side foil switch.
function normalizedBackFoilEnabled(holographic) {
  const media = normalizeProjectMedia({
    type: 'image',
    src: 'assets/projects/test/front.png',
    holographic
  });
  assert.ok(media?.holographic, 'Test holographic settings should survive project-media normalization.');
  return media.holographic.backFoilEnabled;
}

assert.equal(
  normalizedBackFoilEnabled({ style: 'holographic', back: 'back.png', backTexture: 'pattern.png' }),
  true,
  'Legacy records with a back texture should retain their implied back-foil behavior.'
);
assert.equal(
  normalizedBackFoilEnabled({ style: 'holographic', back: 'back.png', backTexture: 'pattern.png', backFoilEnabled: false }),
  false,
  'An explicit CMS opt-out must survive normalization even when a back texture is configured.'
);
assert.equal(
  normalizedBackFoilEnabled({ style: 'holographic', back: 'back.png', backFoilEnabled: true }),
  true,
  'An explicit CMS opt-in must survive normalization.'
);
assert.equal(
  normalizedBackFoilEnabled({ style: 'holographic', back: 'back.png' }),
  false,
  'A clean custom reverse should remain foil-free unless enabled or given a back pattern/mask.'
);
const layeredFoil = normalizeProjectMedia({type:'image',src:'assets/projects/test/front.png',holographic:{style:'cosmos',glitterLayer:true,grainLayer:false}}).holographic;
assert.equal(layeredFoil.glitterLayer, true, 'Glitter layer must survive normalization.');
assert.equal(layeredFoil.grainLayer, false, 'Grain layer supports an explicit opt-out.');
const legacyFoil = normalizeProjectMedia({type:'image',src:'assets/projects/test/front.png',holographic:{style:'cosmos'}}).holographic;
assert.equal(legacyFoil.grainLayer, true, 'Old foil data keeps the legacy grain default.');
assert.equal(legacyFoil.glitterLayer, false, 'Glitter remains opt-in for existing artwork.');

const supportedHolographicStyles = [
  'holographic', 'cosmos', 'brushed', 'beams', 'crosshatch', 'shattered',
  'glitter', 'waves', 'cat-eye', 'iridescent', 'aurora'
];
const editorStyleContract = admin.match(/const styles = new Set\(\[(.*?)\]\);/);
assert.ok(editorStyleContract, 'CMS holographic controls must declare their supported finish list.');
const editorStyleIds = [...editorStyleContract[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
assert.deepEqual(
  [...editorStyleIds].sort(),
  [...supportedHolographicStyles].sort(),
  'CMS and public project normalization must support the same holographic style IDs.'
);
for (const style of supportedHolographicStyles) {
  const normalizedStyle = normalizeProjectMedia({
    type: 'image',
    src: 'assets/projects/test/front.png',
    holographic: { style, intensity: 0.65 }
  })?.holographic?.style;
  assert.equal(normalizedStyle, style, `Public normalization must preserve the ${style} foil finish.`);
  assert.ok(siteCss.includes(`data-holo-style="${style}"`), `The public stylesheet must define a ${style} finish profile.`);
}

assert.ok(
  foilNormalRendererSource.includes('float broadSpecular=') &&
  foilNormalRendererSource.includes('float fresnel=') &&
  foilNormalRendererSource.includes('diffuse*0.12'),
  'Foil relief should combine broad diffuse reflection with a grazing-angle Fresnel response.'
);
assert.ok(
  foilNormalRendererSource.includes('view?.requestAnimationFrame') &&
  foilNormalRendererSource.includes('cancelAnimationFrame'),
  'Foil redraws should be frame-coalesced and pending animation frames cancelled on teardown.'
);
assert.ok(
  foilNormalRendererSource.includes('let compactTarget = isCompactFoilTarget(view)') &&
  foilNormalRendererSource.includes('compactTarget?0.58:0.85') &&
  foilNormalRendererSource.includes('const maxSide=compactTarget?640:1024') &&
  foilNormalRendererSource.includes('MOBILE_DRAW_INTERVAL_MS = 32') &&
  foilNormalRendererSource.includes('scheduleDrawTimer') &&
  foilNormalRendererSource.includes('drawTimer!==null') &&
  foilNormalRendererSource.includes('now-lastDrawTime<MOBILE_DRAW_INTERVAL_MS'),
  'Compact foil relief must use the responsive intensity policy, reduced backing resolution, a bounded canvas, and timer-throttled GPU redraws.'
);
assert.ok(
  renderer.includes("let hoverAvailable = !compactTarget && supportsFoilHover(windowRef)") &&
  renderer.includes("surface.dataset.holoMotion = hoverAvailable ? 'pointer' : 'static'") &&
  renderer.includes("{ eager: !compactTarget }") &&
  renderer.includes("if (holo?.back && !isCompactFoilTarget(windowRef))") &&
  renderer.includes("const nextHoverAvailable = !isCompactFoilTarget(windowRef)") &&
  !renderer.includes('startFoilAutoRotation(') &&
  !renderer.includes('autoRotationAvailable ?'),
  'Compact holographic groups must remain static, use lazy reverse artwork, and avoid continuous per-surface auto-motion while desktop hover remains available.'
);
assert.ok(
  foilNormalRendererSource.includes('pendingImageCancels=new Set()') &&
  foilNormalRendererSource.includes('pendingImageCancels.add(cancel)') &&
  foilNormalRendererSource.includes('for(const cancelLoad of [...pendingImageCancels])'),
  'Foil pattern image requests must be cancelled when the renderer is destroyed before loading completes.'
);
assert.ok(
  renderer.includes('clipMaskUrl: cosmosClipUrl') &&
  renderer.includes("modes.push('alpha')") &&
  renderer.includes("size: '50% 50%', repeat: 'repeat', position: '0 0'") && renderer.includes("clipMaskSize: '50% 50%'"),
  'Cosmos effects must intersect the top-map alpha clip and tile the original map without stretching.'
);
assert.ok(
  siteCss.includes('background-size:180px auto,260% 220%') &&
  siteCss.includes('background-size:144px auto,170% 170%,300% 240%') &&
  siteCss.includes('background-repeat:repeat,no-repeat,no-repeat'),
  'Grain and glitter assets must tile at preserved aspect ratios rather than stretching to the artwork bounds.'
);
for (const style of ['beams','crosshatch','cat-eye','iridescent','aurora','waves']) {
  assert.ok(siteCss.includes(`data-holo-style="${style}"`), `Foil finish ${style} must keep an explicit material profile.`);
}
assert.ok(
  /data-holo-style="beams"[^}]*[\s\S]{0,1200}mix-blend-mode:soft-light/.test(siteCss) &&
  /data-holo-style="cat-eye"[^}]*[\s\S]{0,1600}rgba\(255,255,255,\.52\)/.test(siteCss) &&
  /data-holo-style="aurora"[^}]*[\s\S]{0,1200}mix-blend-mode:soft-light/.test(siteCss),
  'High-brightness finishes must emphasize contrast and matte color instead of white-heavy screen blending.'
);
assert.ok(
  /repeating-radial-gradient\(ellipse at var\(--holo-foil-x,50%\) var\(--holo-foil-y,50%\),transparent 0 5px/.test(siteCss),
  'Water waves must render a tighter series of concentric drop rings.'
);

// Exercise the renderer teardown with unresolved Image requests (not just source checks).
const pendingFoilImages = [];
class PendingFoilImage {
  constructor() { this.onload = null; this.onerror = null; this._src = ''; this.removedSource = false; pendingFoilImages.push(this); }
  set src(value) { this._src = value; }
  get src() { return this._src; }
  removeAttribute(name) { if (name === 'src') { this.removedSource = true; this._src = ''; } }
}
const foilView = {
  Image: PendingFoilImage,
  devicePixelRatio: 1,
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame() { throw new Error('No frame should be requested before foil maps load.'); },
  cancelAnimationFrame() {}
};
const glConstants = {
  VERTEX_SHADER:1, FRAGMENT_SHADER:2, COMPILE_STATUS:3, LINK_STATUS:4,
  ARRAY_BUFFER:5, STATIC_DRAW:6, DEPTH_TEST:7, CULL_FACE:8, UNPACK_FLIP_Y_WEBGL:9,
  TEXTURE0:10, TEXTURE_2D:11, TEXTURE_MIN_FILTER:12, TEXTURE_MAG_FILTER:13,
  LINEAR:14, TEXTURE_WRAP_S:15, TEXTURE_WRAP_T:16, CLAMP_TO_EDGE:17,
  RGBA:18, UNSIGNED_BYTE:19, COLOR_BUFFER_BIT:20, FLOAT:21, TRIANGLE_STRIP:22
};
const foilGl = {
  ...glConstants,
  createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => true,
  getShaderInfoLog: () => '', createProgram: () => ({}), attachShader() {}, linkProgram() {},
  getProgramParameter: () => true, getProgramInfoLog: () => '', createBuffer: () => ({}),
  bindBuffer() {}, bufferData() {}, getAttribLocation: () => 0, getUniformLocation: () => ({}),
  useProgram() {}, disable() {}, pixelStorei() {}, createTexture: () => ({}), activeTexture() {},
  bindTexture() {}, texParameteri() {}, texImage2D() {}, uniform1i() {}, uniform2f() {},
  deleteTexture() {}, deleteBuffer() {}, deleteProgram() {}, deleteShader() {},
  getExtension: () => ({loseContext() {}}), uniform1f() {}, viewport() {}, clearColor() {},
  clear() {}, enableVertexAttribArray() {}, vertexAttribPointer() {}, drawArrays() {}
};
const foilCanvas = {
  ownerDocument: { defaultView: foilView },
  dataset: {},
  width: 0,
  height: 0,
  getContext: () => foilGl,
  getBoundingClientRect: () => ({width:320,height:420})
};
const foilController = createFoilNormalRenderer(foilCanvas, ['pending-map-a.webp','pending-map-b.webp']);
assert.equal(pendingFoilImages.length, 2, 'The foil renderer should begin loading the configured normal maps.');
assert.ok(pendingFoilImages.every(image => image.src.startsWith('pending-map-')), 'Normal map requests should be pending before teardown.');
foilController.destroy();
foilController.destroy();
assert.ok(pendingFoilImages.every(image => image.removedSource && image.src === ''), 'Destroying the renderer should release every pending normal-map source.');
assert.ok(pendingFoilImages.every(image => image.onload === null && image.onerror === null), 'Destroying the renderer should detach pending image callbacks.');
assert.equal(foilCanvas.width, 0, 'Destroying the renderer should release its drawing surface.');
await Promise.resolve();
await Promise.resolve();
assert.notEqual(foilCanvas.dataset.normalMapStatus, 'ready', 'A destroyed renderer must not become ready after pending image requests resolve.');


const groupedProject = normalizeProject({
  id:'group-contract-test',title:'Group contract',subtitle:'Optional layout groups',
  mediaGroups:[
    {id:'studies',name:'Studies',layout:'grid',color:'#B6D2A7'},
    {id:'legacy',name:'Legacy group',layout:'stack'},
    {id:'card-stack',name:'Card stack',layout:'cards'},
    {id:'sticker-set',name:'Sticker set',layout:'sticker'}
  ],
  media:[
    {type:'image',src:'assets/projects/test/one.jpg',groupId:'studies'},
    {type:'image',src:'assets/projects/test/two.jpg',groupId:'missing-group'}
  ]
});
assert.deepEqual(groupedProject.mediaGroups,[
  {id:'studies',name:'Studies',layout:'grid',gridColumns:3,color:'#b6d2a7'},
  {id:'legacy',name:'Legacy group',layout:'stack',gridColumns:3,color:'#849573'},
  {id:'card-stack',name:'Card stack',layout:'cards',gridColumns:3,color:'#849573'},
  {id:'sticker-set',name:'Sticker set',layout:'sticker',gridColumns:3,color:'#849573'}
], 'Group colors and Grid column defaults must persist, including for legacy groups.');
assert.equal(groupedProject.media[0].groupId,'studies',
  'Artwork membership must survive normalization.');
assert.equal(groupedProject.media[1].groupId,undefined,
  'Unknown group references must fall back to the default ungrouped presentation.');
assert.ok(inspectController.includes('function openArtworkInspect') &&
  renderer.includes('lightbox-artwork-group-items') &&
  renderer.includes("entry.addEventListener('click',onEntryClick,true)") &&
  renderer.includes('inspectController.isInspectingEntry(entry)') &&
  inspectController.includes("description.textContent=caption") &&
  inspectController.includes('description.hidden=!caption') &&
  renderer.includes("desktopAction.textContent = 'HOVER EDGE / CLICK'") &&
  renderer.includes("touchAction.textContent = 'TAP TO FLIP'") &&
  renderer.includes("desktopRecommendation.textContent = 'Switch to desktop for the full effect.'") &&
  !renderer.includes('Best viewed on desktop for full effect.') &&
  renderer.includes("faceLabel.textContent = isBack ? 'BACK' : 'FRONT'") &&
  inspectController.includes("footer.append(description,back)") &&
  inspectController.includes("if(foilHint)footer.appendChild(foilHint)") &&
  !renderer.includes('Tap to flip · Move to explore the light.') &&
  inspectController.includes(`back.innerHTML='<i class="fa-solid fa-arrow-left" aria-hidden="true"></i>'`) &&
  !renderer.includes('inspectTrigger') &&
  !inspectController.includes('inspectTrigger') &&
  !renderer.includes('holdOpened = true') &&
  !inspectController.includes('holdOpened = true'),
  'Grouped artwork opens Inspect by direct selection without a chip or hold gesture; foil tap-to-flip remains available inside Inspect.');
const focused3dActivation = renderer.match(/onActivate:\s*\(\)\s*=>\s*\{([\s\S]*?)\},\s*onDeactivate:/)?.[1] || '';
assert.ok(focused3dActivation && !/lightbox\.scrollTop|pre3dScrollTop/.test(focused3dActivation),
  'Entering the 3D inspection layer must not rewrite the Lightbox scroll position.');
assert.ok(lightboxCss.includes('data-artwork-effective-layout="grid"') &&
  lightboxCss.includes('data-artwork-effective-layout="stack"') &&
  lightboxCss.includes('data-artwork-effective-layout="cards"') &&
  lightboxCss.includes('data-artwork-effective-layout="sticker"') &&
  renderer.includes("const supportedLayouts = new Set(['grid','stack','cards','sticker'])") &&
  siteCss.includes('backdrop-filter:blur(18px)') &&
  siteCss.includes('background:transparent;box-shadow:none;'),
  'Artwork groups must use the four CMS-driven layout states without altering the blurred Inspector backdrop.');
assert.ok(!admin.includes('value="flow"') &&
  !renderer.includes('inspectTrigger') &&
  !siteCss.includes('.lightbox-artwork-inspect-trigger') &&
  inspectController.includes('lightbox-inspect-footer') &&
  inspectController.includes('documentRef.body.appendChild(overlay)') &&
  renderer.includes('modelFocusPlaceholder.replaceWith(modelEntry)') &&
  renderer.includes('modelFocusOverlay.appendChild(modelEntry)') &&
  renderer.includes('lightbox-3d-scroll-preservation-spacer') &&
  renderer.includes('restoreModelFocusScroll(scrollTarget)') &&
  inspectController.includes('buildInspectTransform') &&
  siteCss.includes('.lightbox-inspect-mode::before') &&
  siteCss.includes('.lightbox-3d-focus-overlay::before') &&
  siteCss.includes('.lightbox-inspect-footer') &&
  siteCss.includes('background:transparent!important;') &&
  siteCss.includes('@media (hover:hover) and (pointer:fine)') &&
  !siteCss.includes('data-artwork-layout="flow"'),
  'Flow is retired; grouped artwork has no in-card Inspect chip and uses centered 3D-style Inspect with desktop-only hover.');
assert.ok(
  lightboxCss.includes('grid-template-columns:repeat(5,minmax(0,1fr))') &&
  lightboxCss.includes('grid-template-columns:repeat(4,minmax(0,1fr))') &&
  lightboxCss.includes('grid-template-columns:repeat(3,minmax(0,1fr))') &&
  lightboxCss.includes('grid-template-columns:repeat(2,minmax(0,1fr))') &&
  lightboxCss.includes('width:100%;max-width:100%;min-width:0;height:auto;max-height:none;') &&
  lightboxCss.includes('padding:0;') &&
  !lightboxCss.includes('width:125%;max-width:none;min-width:0;margin-inline:-12.5%;') &&
  lightboxCss.includes('--artwork-grid-gap:6px;') &&
  lightboxCss.includes('--artwork-grid-gap-half:3px;') &&
  lightboxCss.includes('--artwork-stack-gap:6px;') &&
  lightboxCss.includes('flex:0 0 calc((100% - 12px) / 3);') &&
  lightboxCss.includes('flex-basis:calc((100% - 6px) / 2);') &&
  lightboxCss.includes('border-radius:0!important;') &&
  renderer.includes('entry.dataset.artworkEffectiveLayout = effectiveLayout') &&
  lightboxCss.includes('translate:var(--artwork-row-center-shift,0px) 0;') &&
  lightboxCss.includes('z-index:var(--artwork-layout-layer,1)') &&
  lightboxCss.includes('--artwork-shared-width:min(calc(clamp(222px,33svh,294px) * var(--lightbox-artwork-ratio,1)),36vw,330px)') &&
  lightboxCss.includes('max-height:clamp(222px,33svh,294px)') &&
  lightboxCss.includes('--artwork-shared-width:min(calc(clamp(192px,31.5svh,240px) * var(--lightbox-artwork-ratio,1)),49.5vw,210px)') &&
  lightboxCss.includes('max-height:clamp(192px,31.5svh,240px)') &&
  lightboxCss.includes('position:relative;margin-inline:0;z-index:1;') &&
  lightboxCss.includes('[data-artwork-layout="cards"],[data-artwork-effective-layout="cards"],[data-artwork-layout="sticker"],[data-artwork-effective-layout="sticker"]') &&
  lightboxCss.includes('padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;') &&
  lightboxCss.includes('filter:drop-shadow(0 0 1px rgba(255,255,255,.78)) drop-shadow(0 5px 6px rgba(0,0,0,.30))') &&
  lightboxCss.includes('filter:drop-shadow(0 6px 7px rgba(0,0,0,.32))') &&
  lightboxCss.includes('row-gap:0;padding:2px clamp(8px,3vw,24px);') &&
  lightboxCss.includes('column-gap:clamp(0px,.2vw,2px);row-gap:0;') &&
  lightboxCss.includes('gap:0 1px;padding:2px clamp(8px,4vw,18px);') &&
  lightboxCss.includes(':focus-visible:not(.is-inspect-focus-return)') &&
  !lightboxCss.includes('inset:4px 4px -5px') &&
  renderer.includes('function centerArtworkGroupRows') &&
  renderer.includes("entry.classList.add('is-artwork-selected')") &&
  renderer.includes('const rotation = Number((((stableSeed / 0xFFFFFFFF) * 2 - 1) * 14).toFixed(2));') &&
  renderer.includes('const mobileRotation = Number((rotation * 0.8).toFixed(2));') &&
  lightboxCss.includes('rotate(var(--artwork-effective-sticker-rotation,0deg))') &&
  renderer.includes('selectGroupedArtworkEntry(entry, section)') &&
  admin.includes('<option value="cards">Horizontal Card Stack</option>') &&
  admin.includes('<option value="sticker">Sticker Card Layout</option>'),
  'Grid/Stack must use 100% sizing, 6px spacing and square edges; Card Stack and Sticker layouts retain their existing responsive sizing, collage and focus behavior.');
assert.ok(!siteCss.slice(siteCss.indexOf('/* Calm, clean artwork groups')).includes('overflow-x:auto') &&
  !siteCss.slice(siteCss.indexOf('/* Calm, clean artwork groups')).includes('scroll-snap-type'),
  'Grouped artwork presentation must not use horizontal gallery scrolling.');
assert.ok(foilNormalRendererSource.includes('uniform float u_uvScale;') &&
  foilNormalRendererSource.includes('fract(v_uv*u_uvScale)') &&
  renderer.includes("uvScale: config.style === 'cosmos' ? 2"),
  'Cosmos color maps, mask tiling and shader relief must share the 2x2 tile scale.');

for (const marker of [
  "data-artwork-groups",
  "data-artwork-group-select",
  "data-inline-group-create",
  "data-inline-group-name",
  "data-inline-group-color",
  "data-inline-group-cancel",
  "data-group-create",
  "data-new-group-color",
  "data-edit-group-layout",
  "data-edit-group-color",
  "Remove group",
  "project-list-item",
  "project-card-head",
  "project-collapsed-preview",
  "buildProjectListPreviewHtml(p)",
  "project-card-actions",
  "project-editor-body"
]) {
  assert.ok(admin.includes(marker), `admin.js is missing Projects presentation marker: ${marker}`);
}

for (const marker of [
  ".project-list-item",
  ".project-card-head",
  ".project-collapsed-preview",
  ".project-list-item.is-open .project-collapsed-preview",
  ".project-card-actions"
]) {
  assert.ok(css.includes(marker), `admin.css is missing Projects presentation rule: ${marker}`);
}

assert.ok(/loading="lazy"/.test(admin), 'Collapsed project image previews must be lazy-loaded.');
assert.ok(/decoding="async"/.test(admin), 'Collapsed project image previews must decode asynchronously.');
assert.ok(/computeFallbackThumb\(project\?\.media/.test(admin), 'Collapsed previews must reuse the existing thumbnail fallback contract.');
assert.ok(/project-preview-runtime\.js\?v=20261025-02/.test(admin),
  'CMS Projects must reference the current preview lifecycle module version.');
assert.ok(/admin\.js\?v=\d{8}-\d{2}/.test(adminHtml),
  'The CMS HTML entrypoint must use a versioned cache-busting URL for editor JavaScript.');
assert.ok(/admin\.css\?v=\d{8}-\d{2}/.test(adminHtml),
  'The CMS HTML entrypoint must use a versioned cache-busting URL for preview layout CSS.');
assert.ok(admin.includes('function formatMediaFileSize(value){'),
  'CMS full Media Library previews must format sizes from the GitHub tree metadata.');
assert.ok(admin.includes("sizeLabel.textContent='File size · '+formatMediaFileSize(item.size)"),
  'CMS full Media Library previews must show the file size in the preview header.');
assert.ok(css.includes('.media-full-preview-size{'),
  'CMS full Media Library preview file-size metadata must have a dedicated readable style.');
assert.ok(/function mediaActionButtonHtml\(action,label,icon,tone=''/s.test(admin),
  'Media Library actions must share one accessible icon-button builder.');
for (const marker of [
  "mediaActionButtonHtml('folder-rename','Rename folder','fa-pen')",
  "mediaActionButtonHtml('rename','Rename file','fa-pen')",
  "mediaActionButtonHtml('copy','Copy file path','fa-copy')",
  "mediaActionButtonHtml('del','Delete file','fa-trash','media-delete-action')",
  'aria-label="${attr(label)}"'
]) {
  assert.ok(admin.includes(marker), `CMS Media Library action is missing an accessible icon label: ${marker}`);
}
for (const marker of ['.media-action-btn:hover','.media-delete-action:hover','.media-toolbar-icon:focus-visible']) {
  assert.ok(css.includes(marker), `CMS Media Library icon-action style is missing: ${marker}`);
}
assert.ok(admin.includes('class="panel project-editor-panel project-thumbnail-panel"') &&
  admin.includes('class="panel project-editor-panel project-media-panel"'),
  'Project editor sections must use the flatter editor-panel surface rather than another nested card.');
const groupManagerStart = admin.indexOf('<section class="artwork-group-manager"');
const groupManagerEnd = admin.indexOf('<div data-medialist></div>', groupManagerStart);
const groupManagerMarkup = groupManagerStart >= 0 && groupManagerEnd > groupManagerStart
  ? admin.slice(groupManagerStart, groupManagerEnd)
  : '';
const groupManagerRule = (css.match(/\.artwork-group-manager\s*\{([^}]*)\}/) || [])[1] || '';
const cardTemplateStart = admin.indexOf('function paintMedia(){', admin.indexOf('function paintGroups()'));
const cardSelectorStart = admin.indexOf('data-artwork-group-select', cardTemplateStart);
const cardBodyStart = admin.indexOf('data-mbody', cardTemplateStart);
assert.ok(groupManagerMarkup.includes('data-group-create') &&
  groupManagerMarkup.includes('data-new-group-color') &&
  groupManagerMarkup.includes('data-artwork-group-list') &&
  groupManagerMarkup.includes('data-group-count') &&
  !admin.includes('data-artwork-group-disclosure') &&
  !admin.includes('data-group-target') &&
  !admin.includes('data-media-select'),
  'Artwork groups must use one cohesive create/manage section without duplicated selection controls.');
assert.ok(!/position\s*:\s*(?:sticky|fixed)/i.test(groupManagerRule),
  'The artwork-group manager must remain in normal document flow on every viewport.');
assert.ok(cardSelectorStart >= cardTemplateStart && cardBodyStart > cardSelectorStart &&
  admin.includes('data-edit-group-color') &&
  admin.includes('syncArtworkGroupCards()') &&
  admin.includes('group.color = normalizeArtworkGroupColor(event.target.value)'),
  'Each card must expose an always-visible group selector, accessible group color editor, and live color propagation.');
assert.ok(admin.includes("const CREATE_ARTWORK_GROUP_OPTION = '__create_artwork_group__'") &&
  admin.includes("nextGroupId === CREATE_ARTWORK_GROUP_OPTION") &&
  admin.includes('createArtworkGroupRecord(requestedName, inlineGroupColor?.value, \'grid\')') &&
  admin.includes('m.groupId = group.id;') &&
  admin.includes('groupSelector?.focus({ preventScroll: true })') &&
  css.includes('.artwork-card-inline-group-create[hidden]{display:none!important;}') &&
  css.includes('@media(max-width:720px)') &&
  css.includes('@media(max-width:520px)'),
  'Each artwork card must support an accessible in-context create-and-assign flow that stays usable on smaller screens.');
assert.ok(css.includes('.project-media-panel [data-medialist]>.card-item.has-artwork-group') &&
  css.includes('.artwork-group-badge[hidden]') &&
  css.includes('@media(max-width:720px)') &&
  css.includes('@media(max-width:520px)'),
  'Only assigned cards receive a visible group accent while group controls remain responsive.');
assert.ok(css.includes('.project-media-panel [data-medialist]>.card-item{') &&
  css.includes('background:transparent!important;border:0;border-bottom:1px solid var(--line-soft)'),
  'Individual artworks must use compact divider rows rather than stacked nested cards.');
const removeGroupHandlerStart = admin.indexOf("card.querySelector('[data-remove-group]')?.addEventListener('click'");
const removeGroupUnassignStart = admin.indexOf('p.media.forEach(media => { if (media.groupId === group.id) delete media.groupId; });', removeGroupHandlerStart);
const removeGroupHandler = removeGroupHandlerStart >= 0 && removeGroupUnassignStart > removeGroupHandlerStart
  ? admin.slice(removeGroupHandlerStart, removeGroupUnassignStart + 100)
  : '';
assert.ok(removeGroupHandler.includes('assignedCount === 0 || window.confirm(') &&
  removeGroupHandler.includes('if (!confirmed) return;') &&
  removeGroupHandler.indexOf('window.confirm(') < removeGroupHandler.indexOf('if (!confirmed) return;') &&
  removeGroupHandler.indexOf('if (!confirmed) return;') < removeGroupHandler.indexOf('p.media.forEach'),
  'Removing a group with assigned artwork must require confirmation before unassigning; cancelling must preserve the assignments.');
assert.ok(css.includes('.project-list-item.is-open .project-collapsed-preview{display:flex;flex:0 0 140px;width:140px;height:76px;margin-left:auto;}') &&
  /@media\(max-width:520px\)\{[\s\S]*?\.project-list-item\.is-open \.project-collapsed-preview\{flex-basis:72px;width:72px;height:56px;\}/.test(css),
  'Expanded CMS project cards must retain their own thumbnail with a compact mobile layout.');
assert.ok(/\.media-preview\s*>\s*lottie-player\s*\{[^}]*position:absolute[^}]*display:block[^}]*width:100%[^}]*height:100%/s.test(css),
  'Expanded CMS Lottie previews must receive a concrete visible layout box.');
assert.ok(hero.includes('timeoutMs: 3500') &&
  hero.includes('manual loop unavailable; showing latest project media as a fallback.') &&
  hero.includes('sources = latestSources.slice(0, 5);'),
  'A missing or slow manual hero-loop file must fall back to project media rather than leaving the hero blank.');
assert.ok(/if \(bundled\) \{[\s\S]*?candidates\.push\(bundled\);[\s\S]*?\} else \{[\s\S]*?simpleIconsUrl\(slug\)/.test(logoLookup),
  'Known software with bundled logos must prefer local assets and avoid predictable Simple Icons 404 requests.');
assert.ok(/data-preview-type="lottie"/.test(admin) && /data-preview-type="model"/.test(admin) && /data-collapsed-preview-media/.test(admin),
  'Collapsed CMS rows expose deferred Lottie and 3D preview targets.');
assert.ok(/ensureLottiePlayer/.test(previewRuntime) &&
  /import\('\.\.\/js\/infrastructure\/lottie\/player\.js'\)/.test(previewRuntime) &&
  /setPreviewFallback\(node, 'lottie'\)/.test(previewRuntime),
  'CMS Lottie thumbnails must use the shared fallback loader and expose a useful failed-load state.');
assert.ok(/typeof node\.load === 'function'\) node\.load\(src\)/.test(previewRuntime),
  'Lazy CMS Lottie thumbnails must explicitly load sources assigned after component upgrade.');
assert.ok(/IntersectionObserver/.test(previewRuntime) && /mountModelViewer\(node,src,\{[\s\S]*?thumbnail:true/.test(previewRuntime),
  'CMS multimedia thumbnails are mounted lazily in static 3D mode.');
assert.ok(/options\.thumbnail === true/.test(modelViewer), 'The 3D viewer supports static thumbnail rendering.');
assert.ok(/model-viewer\.js\?v=20261024-02/.test(admin),
  'The expanded CMS 3D editor must use the current viewer module cache key.');
assert.match(mediaBackgroundEngine, /function releaseLayerMedia\(layer\) \{[\s\S]*?media\.pause\?\.\(\)[\s\S]*?removeAttribute\('src'\)[\s\S]*?media\.load\?\.\(\)/);
assert.match(mediaBackgroundEngine, /function clear\(host\) \{[\s\S]*?releaseLayerMedia\(oldLayer\)[\s\S]*?oldLayer\.remove\(\)/);
assert.match(mediaBackgroundEngine, /global\.LMMediaBackground = \{ DEFAULTS, normalize: normalizeBackground, apply, clear \}/);
assert.match(admin, /function releasePreviewMedia\(root\) \{/);
assert.match(admin, /releasePreviewMedia\(old\); old\.remove\(\)/);
assert.match(admin, /releasePreviewMedia\(previewEl\);\s*previewEl\.replaceChildren\(\)/);
assert.match(admin, /releasePreviewMedia\(previewEl\);\s*previewEl\.innerHTML = buildMediaPreviewHtml\(m\)/);

assert.ok(/let openUid\s*=\s*null/.test(admin), 'Projects must start with every project row closed.');
assert.ok(/isOpen \? ' is-open' : ' is-collapsed'/.test(admin) || /isOpen \? ' is-open' : ' is-collapsed'/.test(admin.replace(/\n/g,'')),
  'Projects renderer must expose explicit open/collapsed row state.');

const exclusiveDisclosure = admin.match(/function toggleExclusiveOpenUid\(currentUid, selectedUid\)\s*\{[^}]*\}/);
assert.ok(exclusiveDisclosure, 'Projects and artwork must share the exclusive-open disclosure helper.');
const toggleExclusiveOpenUid = vm.runInNewContext('(' + exclusiveDisclosure[0] + ')');
assert.equal(toggleExclusiveOpenUid(null, 'project-a'), 'project-a',
  'Opening an item should make it the only open item.');
assert.equal(toggleExclusiveOpenUid('project-a', 'project-a'), null,
  'Selecting the currently open item should collapse it.');
assert.equal(toggleExclusiveOpenUid('project-a', 'project-b'), 'project-b',
  'Opening another item should replace the previous open item.');

const projectsRendererSource = admin.match(/RENDERERS\.projects = async function[\s\S]*?(?=RENDERERS\.about)/);
assert.ok(projectsRendererSource, 'CMS Projects renderer should remain a distinct section.');
assert.match(projectsRendererSource[0], /openUid = toggleExclusiveOpenUid\(openUid, p\._uid\); paint\(\);/,
  'Opening a project must collapse the previously open project.');
assert.match(admin, /let openMediaUid = null/,
  'Artwork should keep exactly one active editor ID instead of a multi-open set.');
assert.match(admin, /const isOpen = openMediaUid === m\._uid;/,
  'Artwork expansion should derive from the single active artwork ID.');
assert.match(admin, /openMediaUid = toggleExclusiveOpenUid\(openMediaUid, m\._uid\);[\s\S]*?paintMedia\(\);/,
  'Opening artwork must collapse the previously expanded artwork.');
assert.match(admin, /if \(openMediaUid === m\._uid\) openMediaUid = null;/,
  'Deleting the active artwork should clear its disclosure state.');
assert.match(admin, /openMediaUid = fresh\._uid; \/\/ new artwork becomes the sole open editor/,
  'New artwork should open immediately and replace any previously expanded artwork.');
assert.doesNotMatch(admin, /openMediaUids/,
  'The artwork editor must not retain a multi-open state set.');

const snapHelperStart = admin.indexOf('function snapCmsCardToStart(uidValue){');
const snapHelperEnd = admin.indexOf('\n}\nfunction uid()', snapHelperStart);
assert.ok(snapHelperStart >= 0 && snapHelperEnd > snapHelperStart,
  'The shared CMS card snap helper should remain a separate function.');
const snapCalls = [];
const targetCard = {
  isConnected: true,
  dataset: { uid: 'target-card' },
  getBoundingClientRect: () => ({ top: 360 })
};
const snapWindow = {
  scrollY: 100,
  requestAnimationFrame(callback) { callback(); },
  scrollTo(...args) { snapCalls.push(args); }
};
const snapDocument = {
  querySelectorAll(selector) {
    assert.equal(selector, '.card-item[data-uid]');
    return [targetCard];
  },
  getElementById(id) {
    assert.equal(id, 'topbar');
    return { getBoundingClientRect: () => ({ height: 58 }) };
  },
  documentElement: { scrollTop: 100 }
};
const snapHelperSource = admin.slice(snapHelperStart, snapHelperEnd + 2);
const snapToStart = vm.runInNewContext('(' + snapHelperSource + ')', {
  window: snapWindow,
  document: snapDocument
});
snapToStart('target-card');
assert.deepEqual(snapCalls, [[0, 390]],
  'Opening a card should align its top edge below the fixed CMS top bar.');
snapCalls.length = 0;
targetCard.isConnected = false;
snapToStart('target-card');
assert.equal(snapCalls.length, 0,
  'The snap helper must not scroll to a card detached before the scheduled frame.');

const heroDisclosureSourceStart = admin.indexOf('RENDERERS.hero = function(data){');
const reviewsDisclosureSourceStart = admin.indexOf('RENDERERS.reviews = async function');
const aboutDisclosureSourceStart = admin.indexOf('RENDERERS.about = function(data){', reviewsDisclosureSourceStart);
assert.ok(heroDisclosureSourceStart >= 0 && reviewsDisclosureSourceStart > heroDisclosureSourceStart,
  'Hero Messages and Reviews renderer boundaries should remain discoverable.');
assert.ok(aboutDisclosureSourceStart > reviewsDisclosureSourceStart,
  'The Reviews renderer should remain separately testable.');
assert.ok(admin.slice(heroDisclosureSourceStart, reviewsDisclosureSourceStart).includes('if (willOpen) snapCmsCardToStart(item._uid);'),
  'Hero Messages must snap only when opening a card.');
assert.ok(admin.slice(reviewsDisclosureSourceStart, aboutDisclosureSourceStart).includes('if (willOpen) snapCmsCardToStart(item._uid);'),
  'Reviews must snap only when opening a card.');
for (const marker of [
  'if(willOpen)snapCmsCardToStart(item._uid);',
  'if (willOpen) snapCmsCardToStart(p._uid);',
  'if (willOpen) snapCmsCardToStart(m._uid);',
  'if(willOpen)snapCmsCardToStart(v._uid);',
  'if(!open)snapCmsCardToStart(edu._uid);',
  'if (!isOpen) snapCmsCardToStart(exp._uid);',
  'snapCmsCardToStart(openUid)',
  'snapCmsCardToStart(x._uid)',
  'snapCmsCardToStart(fresh._uid)'
]) {
  assert.ok(admin.includes(marker), 'A CMS card-opening path is missing its snap behavior: ' + marker);
}
assert.ok(css.includes('.project-list-item.is-collapsed .project-card-head'),
  'Closed Project rows need a dedicated card-shell header layout.');
assert.ok(css.includes('.project-list-item.is-open .project-card-head'),
  'Expanded Project rows need an explicit original-header layout.');
assert.ok(css.includes('corner-shape:squircle'),
  'CMS Project presentation should progressively enhance rounded surfaces as squircles.');

assert.ok(/function holographicControlHtml\(/.test(admin), 'CMS Projects must expose the holographic image control.');
assert.ok(/data-holo-grain-layer/.test(admin) && /data-holo-glitter-layer/.test(admin),
  'CMS foil settings expose independent grain and glitter layers.');
assert.ok(/holo-style-intensity holo-main-controls/.test(admin) &&
  /<summary>Advanced foil options/.test(admin),
  'CMS foil controls should keep style/strength visible and tuck texture/mask/reverse options into Advanced.');
for (const marker of [
  'data-holo-style aria-label="Holographic effect style"',
  'aria-label="Front foil strength slider"',
  'data-holo-texture aria-label="Front foil pattern source"',
  'data-holo-mask aria-label="Front foil mask source"',
  'data-holo-back aria-label="Custom reverse card image source"',
  'data-holo-back-texture aria-label="Back foil pattern source"',
  'data-holo-back-mask aria-label="Back foil mask source"'
]) {
  assert.ok(admin.includes(marker), `CMS foil control is missing an accessible name: ${marker}`);
}
assert.ok(/function syncFromRange\(rangeInput,numberInput,label\)/.test(admin) &&
  admin.includes("rangeInput?.setAttribute?.('aria-valuetext',percent+'%')") &&
  admin.includes("syncFromRange(intensityInput,intensityNumberInput,intensityLabel)"),
  'CMS foil strength must announce its updated percentage to assistive technology.');

assert.ok(/data-holo-intensity type="range" min="0" max="1" step="0\.01"/.test(admin),
  'CMS foil strength should have fine-grained control.');
assert.ok(admin.includes('data-holo-intensity-number type="number" min="0" max="1" step="0.01"'),
  'Front strength must have a synchronized, bounded numeric input.');
assert.ok(admin.includes('data-holo-back-intensity-number type="number" min="0" max="1" step="0.01"'),
  'Back strength must have its own synchronized, bounded numeric input.');
assert.ok(admin.includes('function normalizeFoilStrength(value, fallback = 0.7)') &&
  admin.includes("numberInput.setAttribute?.('aria-invalid','true')"),
  'Foil strength must validate empty and non-numeric values.');
assert.ok(admin.includes('backStrengthControl.hidden=!hasBack||!Boolean(backFoilInput?.checked)'),
  'Back strength control must only show when back foil is enabled.');

const foilHelperStart = admin.indexOf('function normalizeFoilStrength(value, fallback = 0.7){');
const foilHelperEnd = admin.indexOf('\nfunction holographicControlHtml', foilHelperStart);
assert.ok(foilHelperStart >= 0 && foilHelperEnd > foilHelperStart,
  'Foil strength normalization helpers should remain separately testable.');
const foilHelperSource = admin.slice(foilHelperStart, foilHelperEnd);
const foilHelpers = vm.runInNewContext(
  '(()=>{' + foilHelperSource + ';return {normalizeFoilStrength,normalizeEditorHolographic};})()'
);
assert.equal(foilHelpers.normalizeFoilStrength('',0.7),0.7);
assert.equal(foilHelpers.normalizeFoilStrength('not-a-number',null),null);
assert.equal(foilHelpers.normalizeFoilStrength(1.24),1);
assert.equal(foilHelpers.normalizeFoilStrength(-0.12),0);
assert.equal(foilHelpers.normalizeFoilStrength(0.735),0.74);
assert.equal(foilHelpers.normalizeEditorHolographic({style:'cosmos',intensity:0.46,back:'back.png',backFoilEnabled:true}).backIntensity,0.46,
  'Existing foil settings without a separate reverse strength should inherit the front strength.');

function makeFoilField({value='',checked=false,textContent=''}={}) {
  const listeners=new Map(), attributes=new Map();
  return {
    value:String(value),checked,hidden:false,textContent,attributes,
    addEventListener(type,callback){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(callback);},
    setAttribute(name,next){attributes.set(name,String(next));},
    removeAttribute(name){attributes.delete(name);},
    dispatch(type){for(const callback of [...(listeners.get(type)||[])])callback({target:this});}
  };
}
const foilSelectors = [
  ['[data-holo-enabled]',makeFoilField({checked:true})],
  ['[data-holo-options]',{hidden:false}],
  ['[data-holo-style]',makeFoilField({value:'cosmos'})],
  ['[data-holo-intensity]',makeFoilField({value:'0.42'})],
  ['[data-holo-intensity-number]',makeFoilField({value:'0.42'})],
  ['[data-holo-intensity-value]',makeFoilField()],
  ['[data-holo-texture]',makeFoilField()],
  ['[data-holo-texture-mode]',makeFoilField({value:'fill'})],
  ['[data-holo-back]',makeFoilField({value:'assets/back.png'})],
  ['[data-holo-mask]',makeFoilField()],
  ['[data-holo-back-options]',{hidden:false}],
  ['[data-holo-grain-layer]',makeFoilField({checked:true})],
  ['[data-holo-glitter-layer]',makeFoilField()],
  ['[data-holo-back-texture]',makeFoilField()],
  ['[data-holo-back-texture-mode]',makeFoilField({value:'fill'})],
  ['[data-holo-back-mask]',makeFoilField()],
  ['[data-holo-back-enabled]',makeFoilField({checked:true})],
  ['[data-holo-back-strength-control]',{hidden:false}],
  ['[data-holo-back-intensity]',makeFoilField({value:'0.83'})],
  ['[data-holo-back-intensity-number]',makeFoilField({value:'0.83'})],
  ['[data-holo-back-intensity-value]',makeFoilField()]
];
const foilFields=new Map(foilSelectors);
const foilControl={hidden:false,querySelector(selector){return foilFields.get(selector)||null;}};
const foilRoot={querySelector(selector){return selector==='[data-holo-control]'?foilControl:null;}};
const wireStart=admin.indexOf('function wireHolographicControl(root, getType, getEffect, setEffect, onChanged){');
const wireEnd=admin.indexOf('\nfunction releasePreviewMedia',wireStart);
assert.ok(wireStart>=0&&wireEnd>wireStart,'Holographic control wiring should remain a standalone CMS helper.');
const wireSource=admin.slice(wireStart,wireEnd);
const wireHolographicControl=vm.runInNewContext('('+wireSource+')',{
  normalizeFoilStrength:foilHelpers.normalizeFoilStrength,
  normalizeEditorHolographic:foilHelpers.normalizeEditorHolographic
});
let foilModel={style:'cosmos',intensity:0.42,back:'assets/back.png',backFoilEnabled:true,backIntensity:0.83};
let foilChanged=0;
wireHolographicControl(foilRoot,()=> 'image',()=>foilModel,value=>{foilModel=value;},()=>{foilChanged++;});
const frontRange=foilFields.get('[data-holo-intensity]');
const frontNumber=foilFields.get('[data-holo-intensity-number]');
const backRange=foilFields.get('[data-holo-back-intensity]');
const backNumber=foilFields.get('[data-holo-back-intensity-number]');
const backStrengthControl=foilFields.get('[data-holo-back-strength-control]');
assert.equal(frontRange.value,'0.42');
assert.equal(frontNumber.value,'0.42');
assert.equal(backRange.value,'0.83');
assert.equal(backNumber.value,'0.83');
assert.equal(backStrengthControl.hidden,false);

frontRange.value='0.61';frontRange.dispatch('input');
assert.equal(frontNumber.value,'0.61','Moving the front slider should update its numeric input.');
assert.equal(foilModel.intensity,0.61);
backRange.value='0.59';backRange.dispatch('input');
assert.equal(backNumber.value,'0.59','Moving the reverse slider should update its numeric input.');
assert.equal(foilModel.backIntensity,0.59);
frontNumber.value='0.23';frontNumber.dispatch('input');
assert.equal(frontRange.value,'0.23','Typing front strength should update the slider.');
assert.equal(foilModel.intensity,0.23);
backNumber.value='0.34';backNumber.dispatch('input');
assert.equal(backRange.value,'0.34','Typing reverse strength should update the slider.');
assert.equal(foilModel.backIntensity,0.34);

const intactBack=foilModel.backIntensity;
backNumber.value='not-a-number';backNumber.dispatch('input');
assert.equal(backNumber.attributes.get('aria-invalid'),'true',
  'Non-numeric back strength input should be marked invalid.');
assert.equal(foilModel.backIntensity,intactBack,
  'Invalid back strength must not overwrite the last valid model value.');
backNumber.dispatch('change');
assert.equal(backNumber.value,'0.34','Leaving invalid back strength should restore the last valid value.');
assert.equal(backNumber.attributes.has('aria-invalid'),false);

const intactFront=foilModel.intensity;
frontNumber.value='';frontNumber.dispatch('input');
assert.equal(frontNumber.attributes.get('aria-invalid'),'true',
  'Empty numeric input should be marked invalid without silently overwriting the saved value.');
assert.equal(foilModel.intensity,intactFront);
frontNumber.dispatch('change');
assert.equal(frontNumber.value,'0.23','Leaving an invalid field should restore the last valid slider value.');
assert.equal(frontNumber.attributes.has('aria-invalid'),false);

frontNumber.value='1.7';frontNumber.dispatch('input');
assert.equal(frontRange.value,'1');
assert.equal(frontNumber.value,'1.00','Out-of-range typing should be clamped immediately.');
assert.equal(foilModel.intensity,1);
frontNumber.value='-0.3';frontNumber.dispatch('input');
assert.equal(frontRange.value,'0');
assert.equal(frontNumber.value,'0.00');
assert.equal(foilModel.intensity,0);

{
  const backEnabled=foilFields.get('[data-holo-back-enabled]');
  backEnabled.checked=false;backEnabled.dispatch('change');
  assert.equal(backStrengthControl.hidden,true,
    'The reverse strength control should be hidden when reverse foil is disabled.');
  assert.equal(foilModel.backFoilEnabled,false);
  assert.equal(foilModel.backIntensity,0.34,'Disabling reverse foil should retain its independent strength for re-enabling.');
  backEnabled.checked=true;backEnabled.dispatch('change');
  assert.equal(backStrengthControl.hidden,false);
  assert.equal(foilModel.backFoilEnabled,true);
}
assert.ok(foilChanged>=6,'Valid edits should propagate to the CMS project model immediately.');
assert.ok(admin.includes('project.thumbnail?.holographic') && admin.includes('p.thumbnail?.holographic'),
  'Explicit thumbnail foil settings must survive CMS load and save.');


assert.ok(renderer.includes('const faceStrength = isFront ? frontStrength : backStrength') &&
  renderer.includes('intensity: isFront ? config.intensity : config.backIntensity') &&
  renderer.includes('resolveFoilIntensity(config.intensity, compactTarget)') &&
  renderer.includes('resolveFoilIntensity(config.backIntensity, compactTarget)'),
  'The interactive foil preview must preserve independent front/back configuration while applying the responsive intensity cap.');
assert.ok(renderer.includes("const HOLOGRAPHIC_COSMOS_MAPS = {") &&
  renderer.includes("'cosmos-bottom': 'assets/holographic/cosmos-bottom.webp'") &&
  renderer.includes("'cosmos-middle': 'assets/holographic/cosmos-middle-trans.webp'") &&
  renderer.includes("'cosmos-top': 'assets/holographic/cosmos-top-trans.webp'"),
  'Each Cosmos layer must have its own source luminance map.');
assert.ok(renderer.includes("modes.push('luminance')") &&
  renderer.includes("applyFaceHolographicMask(layer, mapUrl, { size: '50% 50%', repeat: 'repeat', position: '0 0' })"),
  'Cosmos grayscale values must drive spectral layer coverage through luminance masks.');
assert.ok(renderer.includes("['cosmos-bottom', 'lightbox-holographic-cosmos-layer lightbox-holographic-cosmos-bottom']") &&
  renderer.includes("['cosmos-middle', 'lightbox-holographic-cosmos-layer lightbox-holographic-cosmos-middle']") &&
  renderer.includes("['cosmos-top', 'lightbox-holographic-cosmos-layer lightbox-holographic-cosmos-top']"),
  'Cosmos maps must be separate DOM layers in bottom/middle/top order.');
assert.ok(siteCss.includes('.lightbox-holographic-grain-layer') && siteCss.includes('url("../assets/holographic/grain.webp")') &&
  siteCss.includes('.lightbox-holographic-glitter-layer') && siteCss.includes('url("../assets/holographic/glitter.webp")'),
  'Grain and glitter must be independently composited layers.');
for (const [layerName, depth] of [['cosmos-bottom','1px'],['cosmos-middle','2px'],['cosmos-top','3.5px'],['grain-layer','4px'],['glitter-layer','5px']]) {
  const selector = ':is(#lightboxMediaContainer,.lightbox-inspect-mode) .lightbox-holographic-' + layerName + '{';
  const cssLines = siteCss.split(/\r?\n/);
  const ruleStart = cssLines.findIndex(line => line.startsWith(selector));
  const rule = ruleStart >= 0 ? cssLines.slice(ruleStart).join('\n').split('}')[0] : '';
  assert.ok(rule.includes('transform:translateZ(' + depth + ')'), `The ${layerName} layer must keep its own depth plane.`);
}
assert.ok(siteCss.includes('background-size:210% 190%,160% 160%,340% 280%') &&
  siteCss.includes('background-size:230% 220%,170% 170%,300% 240%') &&
  siteCss.includes('background-size:250% 230%,280% 230%'),
  'Cosmos spectral layers must use independent scales and movement for an iridescent response.');
assert.ok(renderer.includes('applyFaceHolographicMask(texture, faceTextureUrl, {') &&
  renderer.includes('texture.style.backgroundImage =') &&
  renderer.includes("texture.style.mixBlendMode = 'color-dodge'"),
  'Monochrome front/back foil patterns must luminance-mask their own spectral color gradients.');
const cosmosDemo = projectsData.flatMap(project => project.media || []).find(item => item?.holographic?.style === 'cosmos');
assert.ok(cosmosDemo?.holographic?.grainLayer === true && cosmosDemo?.holographic?.glitterLayer === true,
  'The Cosmos sample artwork demonstrates both optional layers.');
assert.ok(siteCss.includes('--holo-visual-intensity:calc(var(--holo-intensity,.7) * .68)'),
  'The visual foil intensity must be scaled separately from the CMS value to avoid clipping layered highlights.');
assert.ok(/value="cosmos"/.test(admin) && /Cosmos galaxy foil/.test(admin),
  'CMS holographic style picker must expose the optional Cosmos finish.');
assert.ok(/data-holo-enabled/.test(admin), 'CMS Projects must expose an enable/disable control for holographic images.');
assert.ok(/data-holo-texture/.test(admin) && /data-holo-back/.test(admin),
  'CMS holographic images must support optional texture and back-image sources.');
assert.ok(/data-holo-mask/.test(admin) &&
  /white reveals foil; black hides it\. front only/i.test(admin) &&
  /data-holo-back-mask/.test(admin) &&
  /Leave both settings blank for a clean reverse/i.test(admin),
  'CMS holographic masks must be independent for the front and optional custom back.');
assert.ok(/data-holo-texture-mode/.test(admin) &&
  /Small motifs tile; full-card maps fill the surface/i.test(admin) &&
  /data-holo-back-texture-mode/.test(admin),
  'CMS holographic textures must support independent front/back tile or fill mapping.');
assert.ok(/attachMediaBrowseButton\(row\.querySelector\('\[data-holo-mask\]'\)/.test(admin),
  'CMS holographic masks must use the existing upload-capable Media Library picker.');
assert.ok(/attachMediaBrowseButton\([^\n]+\n(?:.|\n){0,700}data-holo-texture/.test(admin) ||
  /data-holo-texture/.test(admin) && /kind:\s*'image'/.test(admin),
  'CMS holographic source fields must use the existing Media Library image picker.');
assert.ok(/holographic:normalizeEditorHolographic\(media\.holographic\)/.test(admin),
  'CMS project serialization must preserve per-media holographic settings.');
assert.ok(/m\.holographic/.test(admin),
  'CMS project hydration must preserve per-media holographic settings.');

console.log('CMS Projects presentation contract validated.');
