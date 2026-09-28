import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SUPPORTED = new Set(['obj','gltf','glb','fbx']);

function cleanExtension(src){
  const clean = (src || '').split('?')[0].split('#')[0].toLowerCase();
  return clean.includes('.') ? clean.split('.').pop() : '';
}

function disposeMaterial(material){
  if (!material) return;
  for (const key of Object.keys(material)) {
    const value = material[key];
    if (value && value.isTexture) value.dispose();
  }
  material.dispose?.();
}

function disposeObject(root){
  root?.traverse?.(node => {
    node.geometry?.dispose?.();
    if (Array.isArray(node.material)) node.material.forEach(disposeMaterial);
    else disposeMaterial(node.material);
  });
}

function findMtlUrl(objUrl){
  const clean = objUrl.split('?')[0].split('#')[0];
  const slash = clean.lastIndexOf('/');
  const file = clean.slice(slash + 1);
  const base = file.replace(/\.[^.]+$/, '');
  const dir = clean.slice(0, slash + 1);
  return `${dir}${base}.mtl`;
}

async function loadObj(url){
  const [{ OBJLoader }, { MTLLoader }] = await Promise.all([
    import('three/addons/loaders/OBJLoader.js'),
    import('three/addons/loaders/MTLLoader.js')
  ]);

  const loadPlainObj = () => new Promise(resolve => {
    new OBJLoader().load(url, resolve, undefined, () => resolve(null));
  });

  // Most simple OBJ exports work without an MTL file. Try the geometry first
  // so an absent optional sidecar does not create a noisy 404 before the real
  // model even gets a chance to render. If the OBJ itself cannot be decoded,
  // make one final attempt with a conventional same-name .mtl sidecar.
  const plain = await loadPlainObj();
  if (plain) return plain;

  return new Promise(resolve => {
    const obj = new OBJLoader();
    const clean = url.split('?')[0].split('#')[0];
    const slash = clean.lastIndexOf('/');
    const file = clean.slice(slash + 1);
    const base = file.replace(/\.[^.]+$/, '');
    const dir = clean.slice(0, slash + 1);
    const mtlUrl = `${dir}${base}.mtl`;
    new MTLLoader().load(mtlUrl, materials => {
      materials.preload();
      obj.setMaterials(materials);
      obj.load(url, resolve, undefined, () => resolve(null));
    }, undefined, () => resolve(null));
  });
}

async function loadModel(url, ext){
  if (ext === 'gltf' || ext === 'glb') {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(url, gltf => resolve({root:gltf.scene,animations:gltf.animations||[]}), undefined, reject);
    });
  }
  if (ext === 'obj') {
    const root = await loadObj(url);
    if(!root) throw new Error('OBJ could not be loaded.');
    return {root,animations:[]};
  }
  if (ext === 'fbx') {
    const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
    return new Promise((resolve, reject) => {
      new FBXLoader().load(url, object => resolve({root:object,animations:object.animations||[]}), undefined, reject);
    });
  }
  throw new Error(`Unsupported 3D model format: .${ext || 'unknown'}`);
}

export async function mountModelViewer(container, src, options = {}) {
  if (!container) throw new Error('3D viewer container is missing.');
  if (container.__modelViewerCleanup) container.__modelViewerCleanup();
  if (!src) throw new Error('3D model source is empty.');

  const url = src;
  const ext = cleanExtension(url);
  if (!SUPPORTED.has(ext)) throw new Error(`Unsupported 3D model format: .${ext || 'unknown'}`);

  container.innerHTML = '';
  container.style.position = 'relative';

  // Transparent renderer + shared media-background system lets the same
  // Lottie/3D presentation use a solid, gradient, pattern, image, video,
  // or procedural background. The helper is loaded by script.js on the
  // public site and by admin/index.html for CMS previews.
  const backgroundConfig = options.background && typeof options.background === 'object' ? options.background : null;
  if (globalThis.LMMediaBackground && backgroundConfig) {
    const resolveBackgroundUrl = typeof options.resolveUrl === 'function'
      ? options.resolveUrl
      : (value => {
          if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) || String(value).startsWith('data:') || String(value).startsWith('blob:')) return value;
          try { return new URL(String(value).replace(/^\/+/, ''), document.baseURI).href; } catch (e) { return value; }
        });
    globalThis.LMMediaBackground.apply(container, backgroundConfig, resolveBackgroundUrl);
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  camera.position.set(0, 0.8, 3.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  const ambient = new THREE.HemisphereLight(0xffffff, 0x222222, 2.2);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 1.25);
  fill.position.set(-4, 2, -3);
  scene.add(fill);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = options.enablePan !== false;
  controls.enableZoom = options.enableZoom !== false;
  controls.minDistance = 0.01;
  controls.maxDistance = 100;
  controls.target.set(0, 0, 0);
  controls.touches.ONE = THREE.TOUCH.ROTATE;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  // Passive preview state: OrbitControls is off and the canvas itself does
  // not receive pointer input. The surrounding lightbox therefore owns the
  // mouse wheel and mobile swipe until the user intentionally opens 3D.
  controls.enabled = false;

  let root;
  let mixers = [];
  let frameHandle = 0;
  let resizeObserver = null;
  let disposed = false;

  try {
    const loaded = await loadModel(url, ext);
    if (!loaded?.root) throw new Error('3D model contains no scene.');
    root = loaded.root;
    scene.add(root);

    // Center and frame the entire asset without permanently changing its
    // imported proportions. This keeps OBJ/FBX/glTF models at a sensible
    // starting distance while OrbitControls remains free to zoom further in.
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    root.position.sub(center);

    const maxSize = Math.max(size.x, size.y, size.z, 0.001);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    let distance = (maxSize * 0.68) / Math.tan(fov / 2);
    distance = Math.max(distance, 0.1);
    camera.near = Math.max(distance / 100, 0.001);
    camera.far = Math.max(distance * 100, 100);
    camera.position.set(distance * 0.95, distance * 0.45, distance * 1.15);
    camera.updateProjectionMatrix();
    controls.maxDistance = Math.max(distance * 20, 10);
    controls.minDistance = Math.max(distance / 1000, 0.01);
    controls.target.set(0, 0, 0);

    for (const clip of loaded.animations || []) {
      const mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(clip).play();
      mixers.push(mixer);
    }

    // Two-step interaction model:
    // 1) the model behaves like a media thumbnail: the WebGL canvas is not
    //    allowed to capture gestures, so wheel/finger movement keeps scrolling
    //    the surrounding project media list;
    // 2) a deliberate click/tap opens the focused 3D state, where OrbitControls
    //    takes over until the visitor presses the back button.
    const activate = document.createElement('button');
    activate.type = 'button';
    activate.className = 'model-viewer-activate';
    activate.setAttribute('aria-label', 'Open interactive 3D view');
    activate.innerHTML = '<span class="model-viewer-activate-content"><i class="fa-solid fa-cube" aria-hidden="true"></i><strong>VIEW 3D</strong></span>';
    container.appendChild(activate);

    const ui = document.createElement('div');
    ui.className = 'model-viewer-ui';

    let hint = null;
    if (options.hint !== false) {
      hint = document.createElement('div');
      hint.className = 'model-viewer-hint';
      hint.textContent = 'Drag to orbit · pinch / wheel to zoom · two-finger / right-drag to pan';
      hint.hidden = true;
      ui.appendChild(hint);
    }

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'model-viewer-back';
    back.setAttribute('aria-label', 'Exit interactive 3D view');
    back.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> BACK TO MEDIA';
    back.hidden = true;
    ui.appendChild(back);
    container.appendChild(ui);

    const setInteractive = (active) => {
      if (disposed) return;
      controls.enabled = active;
      container.classList.toggle('is-interactive', active);
      activate.hidden = active;
      back.hidden = !active;
      if (hint) hint.hidden = !active;
      renderer.domElement.style.pointerEvents = active ? 'auto' : 'none';
      renderer.domElement.style.touchAction = active ? 'none' : 'auto';
      container.dataset.interactive = active ? 'true' : 'false';
      if (!active) {
        // Clear any stuck pointer state before returning gesture ownership
        // to the lightbox/page.
        controls.reset();
        if (typeof options.onDeactivate === 'function') options.onDeactivate();
      } else if (typeof options.onActivate === 'function') {
        options.onActivate();
      }
    };

    // Guard against a mobile swipe being interpreted as a click. The
    // activation affordance should fire only on a deliberate tap/click, not
    // when the visitor is scrolling through the project media list.
    let activationStartX = 0;
    let activationStartY = 0;
    let activationMoved = false;
    activate.addEventListener('pointerdown', (event) => {
      activationStartX = event.clientX;
      activationStartY = event.clientY;
      activationMoved = false;
    });
    activate.addEventListener('pointermove', (event) => {
      if (Math.hypot(event.clientX - activationStartX, event.clientY - activationStartY) > 10) activationMoved = true;
    });
    activate.addEventListener('pointercancel', () => { activationMoved = true; });
    activate.addEventListener('click', (event) => {
      if (activationMoved) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      setInteractive(true);
      // Focus the canvas for keyboard users without forcing a page jump.
      try { renderer.domElement.focus({ preventScroll: true }); } catch (_) { renderer.domElement.focus(); }
    });

    back.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setInteractive(false);
      activate.focus({ preventScroll: true });
    });

    renderer.domElement.setAttribute('tabindex', '0');
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D model.');
    renderer.domElement.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setInteractive(false);
        activate.focus({ preventScroll: true });
      }
    });
    renderer.domElement.style.pointerEvents = 'none';
    renderer.domElement.style.touchAction = 'auto';
  } catch (err) {
    renderer.dispose();
    throw err;
  }

  const resize = () => {
    if (disposed) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  const clock = new THREE.Clock();
  const render = () => {
    if (disposed) return;
    frameHandle = requestAnimationFrame(render);
    const delta = clock.getDelta();
    mixers.forEach(mixer => mixer.update(delta));
    controls.update();
    renderer.render(scene, camera);
  };
  render();

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frameHandle);
    resizeObserver?.disconnect();
    controls.dispose();
    disposeObject(root);
    scene.clear();
    renderer.dispose();
    if (renderer.domElement.parentNode === container) renderer.domElement.remove();
    const bgLayer=container.querySelector(':scope > .lm-media-background-layer'); if(bgLayer) bgLayer.remove();
    const bgOverlay=container.querySelector(':scope > .lm-media-background-overlay'); if(bgOverlay) bgOverlay.remove();
    delete container.__modelViewerCleanup;
  };
  container.__modelViewerCleanup = cleanup;
  return cleanup;
}
