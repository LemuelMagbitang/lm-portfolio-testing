import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

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

function loadObj(url){
  return new Promise(resolve => {
    const obj = new OBJLoader();
    const finishWithoutMtl = () => obj.load(url, resolve, undefined, () => resolve(null));
    const mtlUrl = findMtlUrl(url);
    new MTLLoader().load(mtlUrl, materials => {
      materials.preload();
      obj.setMaterials(materials);
      obj.load(url, resolve, undefined, () => resolve(null));
    }, undefined, finishWithoutMtl);
  });
}

function loadModel(url, ext){
  return new Promise((resolve, reject) => {
    if (ext === 'gltf' || ext === 'glb') {
      new GLTFLoader().load(url, gltf => resolve({ root: gltf.scene, animations: gltf.animations || [] }), undefined, reject);
      return;
    }
    if (ext === 'obj') {
      loadObj(url).then(root => root ? resolve({root, animations:[]}) : reject(new Error('OBJ could not be loaded.')));
      return;
    }
    if (ext === 'fbx') {
      new FBXLoader().load(url, object => resolve({ root: object, animations: object.animations || [] }), undefined, reject);
      return;
    }
    reject(new Error(`Unsupported 3D model format: .${ext || 'unknown'}`));
  });
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

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  camera.position.set(0, 0.8, 3.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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

    if (options.hint !== false) {
      const hint = document.createElement('div');
      hint.className = 'model-viewer-hint';
      hint.textContent = 'Drag to orbit · pinch / wheel to zoom · two-finger / right-drag to pan';
      container.appendChild(hint);
    }
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
    delete container.__modelViewerCleanup;
  };
  container.__modelViewerCleanup = cleanup;
  return cleanup;
}
