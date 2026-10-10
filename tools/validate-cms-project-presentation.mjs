import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeProjectMedia } from '../js/data/project-normalizer.js?v=20261010-02';
import { mountProjectListPreviews } from '../admin/project-preview-runtime.js?v=20261010-05';
import { createFoilNormalRenderer } from '../js/features/lightbox/foil-normal-renderer.js?v=20261010-04';

const root = process.cwd();
const admin = fs.readFileSync(path.join(root, 'admin/admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'admin/admin.css'), 'utf8');
const siteCss = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'js/features/lightbox/media-renderer.js'), 'utf8');
const foilNormalRendererSource = fs.readFileSync(path.join(root, 'js/features/lightbox/foil-normal-renderer.js'), 'utf8');
const previewRuntime = fs.readFileSync(path.join(root, 'admin/project-preview-runtime.js'), 'utf8');
const modelViewer = fs.readFileSync(path.join(root, 'js/infrastructure/three/model-viewer.js'), 'utf8');
const projectsData = JSON.parse(fs.readFileSync(path.join(root, 'data/projects.json'), 'utf8'));

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
  foilNormalRendererSource.includes('pendingImageCancels=new Set()') &&
  foilNormalRendererSource.includes('pendingImageCancels.add(cancel)') &&
  foilNormalRendererSource.includes('for(const cancelLoad of [...pendingImageCancels])'),
  'Foil pattern image requests must be cancelled when the renderer is destroyed before loading completes.'
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


for (const marker of [
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
assert.ok(/project-preview-runtime\.js\?v=20261010-05/.test(admin),
  'CMS Projects must reference the current preview lifecycle module version.');
assert.ok(/admin\.js\?v=20261010-09/.test(adminHtml),
  'The CMS HTML entrypoint must bust cache after editor JavaScript changes.');
assert.ok(/admin\.css\?v=20261010-04/.test(adminHtml),
  'The CMS HTML entrypoint must bust cache after preview layout CSS changes.');
assert.ok(css.includes('.project-list-item.is-open .project-collapsed-preview{display:flex;flex:0 0 140px;width:140px;height:76px;margin-left:auto;}') &&
  /@media\(max-width:520px\)\{[\s\S]*?\.project-list-item\.is-open \.project-collapsed-preview\{flex-basis:72px;width:72px;height:56px;\}/.test(css),
  'Expanded CMS project cards must retain their own thumbnail with a compact mobile layout.');
assert.ok(/\.media-preview\s*>\s*lottie-player\s*\{[^}]*position:absolute[^}]*display:block[^}]*width:100%[^}]*height:100%/s.test(css),
  'Expanded CMS Lottie previews must receive a concrete visible layout box.');
assert.ok(/data-preview-type="lottie"/.test(admin) && /data-preview-type="model"/.test(admin) && /data-collapsed-preview-media/.test(admin),
  'Collapsed CMS rows expose deferred Lottie and 3D preview targets.');
assert.ok(/ensureLottiePlayer/.test(previewRuntime) &&
  /import\('\.\.\/js\/infrastructure\/lottie\/player\.js'\)/.test(previewRuntime) &&
  /Lottie preview unavailable/.test(previewRuntime),
  'CMS Lottie thumbnails must use the shared fallback loader and expose a useful failed-load state.');
assert.ok(/typeof node\.load === 'function'\) node\.load\(src\)/.test(previewRuntime),
  'Lazy CMS Lottie thumbnails must explicitly load sources assigned after component upgrade.');
assert.ok(/IntersectionObserver/.test(previewRuntime) && /mountModelViewer\(node,src,\{[\s\S]*?thumbnail:true/.test(previewRuntime),
  'CMS multimedia thumbnails are mounted lazily in static 3D mode.');
assert.ok(/options\.thumbnail === true/.test(modelViewer), 'The 3D viewer supports static thumbnail rendering.');
assert.ok(/model-viewer\.js\?v=20261010-12/.test(admin),
  'The expanded CMS 3D editor must use the same current viewer module as collapsed thumbnails.');

assert.ok(/let openUid\s*=\s*null/.test(admin), 'Projects must start with every project row closed.');
assert.ok(/isOpen \? ' is-open' : ' is-collapsed'/.test(admin) || /isOpen \? ' is-open' : ' is-collapsed'/.test(admin.replace(/\n/g,'')),
  'Projects renderer must expose explicit open/collapsed row state.');
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
  'aria-label="Holographic foil strength"',
  'data-holo-texture aria-label="Front foil pattern source"',
  'data-holo-mask aria-label="Front foil mask source"',
  'data-holo-back aria-label="Custom reverse card image source"',
  'data-holo-back-texture aria-label="Back foil pattern source"',
  'data-holo-back-mask aria-label="Back foil mask source"'
]) {
  assert.ok(admin.includes(marker), `CMS foil control is missing an accessible name: ${marker}`);
}
assert.ok(/function updateIntensityAccessibility\(\)/.test(admin) &&
  /setAttribute\('aria-valuetext',percent\+'%'\)/.test(admin) &&
  /updateIntensityAccessibility\(\)/.test(admin),
  'CMS foil strength must announce its updated percentage to assistive technology.');

assert.ok(/data-holo-intensity type="range" min="0" max="1" step="0\.01"/.test(admin),
  'CMS foil strength should have fine-grained control.');

assert.ok(renderer.includes("const HOLOGRAPHIC_COSMOS_MAPS = {") &&
  renderer.includes("'cosmos-bottom': 'assets/holographic/cosmos-bottom.png'") &&
  renderer.includes("'cosmos-middle': 'assets/holographic/cosmos-middle-trans.png'") &&
  renderer.includes("'cosmos-top': 'assets/holographic/cosmos-top-trans.png'"),
  'Each Cosmos layer must have its own source luminance map.');
assert.ok(renderer.includes("modes.push('luminance')") &&
  renderer.includes('applyHolographicMask(layer, faceMaskUrl, faceArtworkUrl, mapUrl)'),
  'Cosmos grayscale values must drive spectral layer coverage through luminance masks.');
assert.ok(renderer.includes("['cosmos-bottom', 'lightbox-holographic-cosmos-layer lightbox-holographic-cosmos-bottom']") &&
  renderer.includes("['cosmos-middle', 'lightbox-holographic-cosmos-layer lightbox-holographic-cosmos-middle']") &&
  renderer.includes("['cosmos-top', 'lightbox-holographic-cosmos-layer lightbox-holographic-cosmos-top']"),
  'Cosmos maps must be separate DOM layers in bottom/middle/top order.');
assert.ok(siteCss.includes('.lightbox-holographic-grain-layer') && siteCss.includes('url("../assets/holographic/grain.webp")') &&
  siteCss.includes('.lightbox-holographic-glitter-layer') && siteCss.includes('url("../assets/holographic/glitter.png")'),
  'Grain and glitter must be independently composited layers.');
for (const [layerName, depth] of [['cosmos-bottom','1px'],['cosmos-middle','2px'],['cosmos-top','3.5px'],['grain-layer','4px'],['glitter-layer','5px']]) {
  const selector = '#lightboxMediaContainer .lightbox-holographic-' + layerName + '{';
  const cssLines = siteCss.split(/\r?\n/);
  const ruleStart = cssLines.findIndex(line => line.startsWith(selector));
  const rule = ruleStart >= 0 ? cssLines.slice(ruleStart).join('\n').split('}')[0] : '';
  assert.ok(rule.includes('transform:translateZ(' + depth + ')'), `The ${layerName} layer must keep its own depth plane.`);
}
assert.ok(siteCss.includes('background-size:210% 190%,160% 160%,340% 280%') &&
  siteCss.includes('background-size:230% 220%,170% 170%,300% 240%') &&
  siteCss.includes('background-size:250% 230%,280% 230%'),
  'Cosmos spectral layers must use independent scales and movement for an iridescent response.');
assert.ok(renderer.includes('applyHolographicMask(texture, faceMaskUrl, faceArtworkUrl, faceTextureUrl, {') &&
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
