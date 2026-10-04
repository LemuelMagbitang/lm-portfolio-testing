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
  container.dataset.ready = 'false';
  container.setAttribute('aria-busy', 'true');

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
  controls.enabled = false;

  let root;
  let mixers = [];
  let frameHandle = 0;
  let resizeObserver = null;
  let disposed = false;
  let fitToViewport = null;
  let fitRequested = false;
  let lastSize = { width: 0, height: 0 };
  let renderLoopActive = false;

  const activate = document.createElement('div');
  activate.className = 'model-viewer-activate';
  activate.setAttribute('aria-hidden', 'true');
  activate.setAttribute('role', 'presentation');
  activate.innerHTML = '<span class="model-viewer-activate-content"><i class="fa-solid fa-cube" aria-hidden="true"></i><strong>CLICK FOR 3D VIEW</strong></span>';
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
  back.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>BACK TO MEDIA</span>';
  back.hidden = true;
  ui.appendChild(back);
  container.appendChild(ui);

  try {
    const loaded = await loadModel(url, ext);
    if (!loaded?.root) throw new Error('3D model contains no scene.');
    root = loaded.root;
    scene.add(root);

    // Center the asset once. Its camera framing is recalculated whenever the
    // shell changes between thumbnail and full-device focus mode.
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const modelRadius = Math.max(sphere.radius, 0.001);
    root.position.sub(center);

    // Orientation is controlled by the CMS media item. Auto derives a useful
    // 2D presentation shape from the model's width/height; square is the
    // stable fallback for unusual or essentially flat bounds.
    const requestedOrientation = String(options.orientation || 'auto').toLowerCase();
    let detectedOrientation = requestedOrientation;
    if (!['landscape', 'portrait', 'square'].includes(detectedOrientation)) {
      const ratio = size.y > 0.0001 ? size.x / size.y : 1;
      detectedOrientation = ratio > 1.15 ? 'landscape' : ratio < 0.85 ? 'portrait' : 'square';
    }
    container.dataset.orientation = detectedOrientation;
    if (typeof options.onOrientationDetected === 'function') options.onOrientationDetected(detectedOrientation);

    fitToViewport = () => {
      if (!root) return;
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      const aspect = width / height;
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.01));
      const limitingHalfFov = Math.min(vFov, hFov) / 2;
      const padding = 0.84;
      const distance = Math.max(
        modelRadius / Math.sin(Math.max(limitingHalfFov, 0.01)) / padding,
        modelRadius * 1.5
      );
      const direction = camera.position.clone().sub(controls.target);
      if (direction.lengthSq() < 0.000001) direction.set(0.85, 0.42, 1.05);
      direction.normalize();
      camera.position.copy(controls.target).add(direction.multiplyScalar(distance));
      camera.near = Math.max(distance / 100, 0.001);
      camera.far = Math.max(distance * 100, 100);
      camera.updateProjectionMatrix();
      controls.maxDistance = Math.max(distance * 20, 10);
      controls.minDistance = Math.max(distance / 1000, 0.01);
      controls.target.set(0, 0, 0);
      controls.update();
    };

    for (const clip of loaded.animations || []) {
      const mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(clip).play();
      mixers.push(mixer);
    }

    // Passive media state: the shell is the tap target, while its WebGL
    // canvas is completely inert. We intentionally do not intercept pointer
    // movement or touch scrolling here, so the lightbox retains normal media
    // navigation until a deliberate click/tap is made.
    container.setAttribute('role', 'button');
    container.setAttribute('tabindex', '0');
    container.setAttribute('aria-label', 'Open interactive 3D view');
    container.setAttribute('aria-expanded', 'false');

    const setInteractive = (active) => {
      if (disposed) return;
      controls.enabled = active;
      renderLoopActive = active;
      container.classList.toggle('is-interactive', active);
      activate.hidden = active;
      back.hidden = !active;
      if (hint) hint.hidden = !active;
      renderer.domElement.style.pointerEvents = active ? 'auto' : 'none';
      renderer.domElement.style.touchAction = active ? 'none' : 'auto';
      container.dataset.interactive = active ? 'true' : 'false';
      container.setAttribute('aria-expanded', active ? 'true' : 'false');
      container.setAttribute('aria-label', active ? 'Interactive 3D model. Press Escape to return to media.' : 'Open interactive 3D view');
      // The passive shell acts like a button. Once active it becomes a region
      // containing a real Back button; this avoids nesting interactive controls
      // inside an ARIA button.
      if (active) {
        container.removeAttribute('role');
        container.setAttribute('role', 'region');
      } else {
        container.setAttribute('role', 'button');
      }
      container.setAttribute('tabindex', active ? '-1' : '0');
      fitRequested = true;
      if (active) {
        if (typeof options.onActivate === 'function') options.onActivate();
        // Activation can begin from keyboard or a pointer tap. Move focus to
        // the visible Back control so keyboard users have an immediate,
        // deterministic way out of the full-screen 3D state.
        requestAnimationFrame(() => {
          try { back.focus({ preventScroll: true }); } catch (_) { back.focus(); }
        });
      } else {
        controls.reset();
        if (typeof options.onDeactivate === 'function') options.onDeactivate();
      }
      requestAnimationFrame(() => { if (typeof resizeViewer === 'function') resizeViewer(); });
      setRenderLoop(active);
    };

    let gestureStartX = 0;
    let gestureStartY = 0;
    let gestureMoved = false;
    container.addEventListener('pointerdown', (event) => {
      if (controls.enabled || event.button > 0) return;
      gestureStartX = event.clientX;
      gestureStartY = event.clientY;
      gestureMoved = false;
    }, { passive: true });
    container.addEventListener('pointermove', (event) => {
      if (controls.enabled) return;
      if (Math.hypot(event.clientX - gestureStartX, event.clientY - gestureStartY) > 10) gestureMoved = true;
    }, { passive: true });
    container.addEventListener('pointercancel', () => { gestureMoved = true; }, { passive: true });
    container.addEventListener('click', (event) => {
      if (controls.enabled || event.target.closest('.model-viewer-ui')) return;
      if (gestureMoved) {
        gestureMoved = false;
        return;
      }
      event.preventDefault();
      setInteractive(true);
    });
    container.addEventListener('keydown', (event) => {
      if (!controls.enabled && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        setInteractive(true);
      }
    });

    // Keep Escape available while the model itself is actively being
    // manipulated without making the WebGL canvas focusable. The canvas is
    // purely visual; the outer shell owns the accessible interaction state.
    const onDocumentKeydown = (event) => {
      if (!controls.enabled || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setInteractive(false);
      requestAnimationFrame(() => {
        try { container.focus({ preventScroll: true }); } catch (_) { container.focus(); }
      });
    };
    document.addEventListener('keydown', onDocumentKeydown, true);
    container.__modelViewerKeydownCleanup = () => document.removeEventListener('keydown', onDocumentKeydown, true);

    // Explicitly pass wheel movement to the lightbox scroller while passive.
    // This makes scrolling dependable even in browsers that treat a WebGL
    // region as a wheel/gesture boundary. The 3D canvas remains uninvolved.
    container.addEventListener('wheel', (event) => {
      if (controls.enabled) return;
      const scroller = container.closest('.lightbox-modal');
      if (!scroller) return;
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      if (max <= 0) return;
      const current = scroller.scrollTop;
      const next = Math.max(0, Math.min(max, current + event.deltaY));
      if (next !== current) {
        scroller.scrollTop = next;
        event.preventDefault();
      }
    }, { passive: false });

    back.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setInteractive(false);
      requestAnimationFrame(() => { try { container.focus({ preventScroll: true }); } catch (_) { container.focus(); } });
    });

    // Do not make the renderer canvas focusable while marking it decorative.
    // A focused aria-hidden canvas causes an accessibility warning in Chromium
    // when the 3D focus layer changes. Keyboard semantics belong to the
    // outer model-viewer shell instead.
    renderer.domElement.removeAttribute('tabindex');
    renderer.domElement.removeAttribute('aria-hidden');
    renderer.domElement.style.pointerEvents = 'none';
    renderer.domElement.style.touchAction = 'auto';
    container.dataset.ready = 'true';
    container.setAttribute('aria-busy', 'false');
  } catch (err) {
    container.dataset.ready = 'false';
    container.setAttribute('aria-busy', 'false');
    const label = activate.querySelector('strong');
    if (label) label.textContent = '3D VIEW UNAVAILABLE';
    const backUi = back;
    if (backUi) backUi.hidden = true;
    renderer?.dispose?.();
    throw err;
  }

  const resizeViewer = () => {
    if (disposed) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (fitToViewport && (fitRequested || lastSize.width === 0)) {
      fitToViewport();
      fitRequested = false;
    }
    lastSize = { width, height };
    if (!renderLoopActive) renderer.render(scene, camera);
  };

  resizeObserver = new ResizeObserver(() => resizeViewer());
  resizeObserver.observe(container);
  resizeViewer();

  const clock = new THREE.Clock();
  const renderOnce = () => {
    if (disposed) return;
    controls.update();
    renderer.render(scene, camera);
  };
  const render = () => {
    if (disposed || !renderLoopActive) {
      frameHandle = 0;
      return;
    }
    frameHandle = requestAnimationFrame(render);
    const delta = clock.getDelta();
    mixers.forEach(mixer => mixer.update(delta));
    controls.update();
    renderer.render(scene, camera);
  };
  function setRenderLoop(active) {
    renderLoopActive = !!active;
    if (renderLoopActive && !frameHandle) {
      clock.start();
      frameHandle = requestAnimationFrame(render);
    } else if (!renderLoopActive) {
      if (frameHandle) cancelAnimationFrame(frameHandle);
      frameHandle = 0;
      renderOnce();
    }
  }

  // The model is a static thumbnail until explicitly activated. This is a
  // major battery/GPU saving on mobile and also avoids hidden WebGL work in
  // the project media list.
  resizeViewer();
  renderOnce();

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    renderLoopActive = false;
    cancelAnimationFrame(frameHandle);
    resizeObserver?.disconnect();
    controls.dispose();
    container.__modelViewerKeydownCleanup?.();
    delete container.__modelViewerKeydownCleanup;
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
