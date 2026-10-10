/**
 * CMS project-row preview lifecycle, isolated from data and editor markup.
 * Media loads only near the viewport; hidden 3D viewers release WebGL resources.
 */
export function mountProjectListPreviews(root, {resolveUrl = value => value} = {}) {
  if (!root) return () => {};
  const doc = root.ownerDocument || globalThis.document;
  const view = doc?.defaultView || globalThis.window;
  const nodes = Array.from(root.querySelectorAll?.('[data-collapsed-preview-media]') || []);
  if (!nodes.length) return () => {};
  let disposed = false;
  const visible = new Set(), active = new Map();
  let modelQueue = Promise.resolve();
  const observer = typeof view?.IntersectionObserver === 'function'
    ? new view.IntersectionObserver(entries => entries.forEach(entry => {
        const node = entry.target;
        if (entry.isIntersecting && entry.intersectionRatio > 0) { visible.add(node); activate(node); }
        else { visible.delete(node); deactivate(node); }
      }), {root:null,rootMargin:'120px 0px',threshold:0.01})
    : null;
  const ownsNode = node => !disposed && !!node?.isConnected && root.contains(node) && visible.has(node);
  const sourceUrl = node => { const raw=String(node?.dataset?.previewSrc||'').trim(); return raw ? resolveUrl(raw) : ''; };
  function readBackground(node) {
    try {
      const value=JSON.parse(node.dataset.previewBackground||'{}');
      return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length ? value : null;
    } catch (_) { return null; }
  }
  function deactivate(node) {
    const resource=active.get(node); active.delete(node); node.dataset.previewActive='false';
    if(resource?.type==='video') {
      try{node.pause();}catch(_){} node.removeAttribute('src'); try{node.load();}catch(_){}
    } else if(resource?.type==='lottie') {
      try{node.pause?.();node.stop?.();}catch(_){} node.removeAttribute('src');
    } else if(resource?.type==='model') {
      try{resource.cleanup?.();}catch(_){}
      if(node.__modelViewerMountToken)delete node.__modelViewerMountToken;
      if(node.__modelViewerCleanup){try{node.__modelViewerCleanup();}catch(_){}}
      node.replaceChildren();
    } else if(node.dataset.previewType==='model') {
      if(node.__modelViewerMountToken)delete node.__modelViewerMountToken;
      node.replaceChildren();
    }
    node.dataset.previewState='idle';
  }
  function activate(node) {
    if(!ownsNode(node)||node.dataset.previewActive==='true'||node.dataset.previewState==='loading')return;
    const type=String(node.dataset.previewType||'').toLowerCase(),src=sourceUrl(node);
    if(!src||!['video','lottie','model'].includes(type))return;
    node.dataset.previewActive='true';node.dataset.previewState='loading';
    if(type==='video') {
      node.muted=true;node.loop=true;node.autoplay=true;node.playsInline=true;node.preload='metadata';node.src=src;
      try{node.load();}catch(_){} const playback=node.play?.();if(playback&&typeof playback.catch==='function')playback.catch(()=>{});
      active.set(node,{type:'video'});node.dataset.previewState='ready';return;
    }
    if(type==='lottie') {
      node.setAttribute('background','transparent');node.setAttribute('preserveAspectRatio','xMidYMid slice');
      node.setAttribute('autoplay','');node.setAttribute('loop','');node.setAttribute('src',src);
      active.set(node,{type:'lottie'});node.dataset.previewState='ready';return;
    }
    const job=modelQueue.then(async()=>{
      if(!ownsNode(node)||node.dataset.previewActive!=='true')return;
      try {
        const {mountModelViewer}=await import('../js/infrastructure/three/model-viewer.js?v=20261010-12');
        if(!ownsNode(node)||node.dataset.previewActive!=='true')return;
        const cleanup=await mountModelViewer(node,src,{
          thumbnail:true,hint:false,alt:node.getAttribute('aria-label')||'3D artwork preview',
          orientation:node.dataset.previewOrientation||'auto',background:readBackground(node),resolveUrl
        });
        if(typeof cleanup!=='function')return;
        if(!ownsNode(node)||node.dataset.previewActive!=='true'){try{cleanup();}catch(_){}return;}
        active.set(node,{type:'model',cleanup});node.dataset.previewState='ready';
      } catch(_) {
        if(!ownsNode(node)||node.dataset.previewActive!=='true')return;
        node.dataset.previewState='error';node.innerHTML='<span class="project-collapsed-preview-error">3D preview unavailable</span>';
      }
    });
    modelQueue=job.catch(()=>{});
  }
  if(observer)nodes.forEach(node=>observer.observe(node));
  else {nodes.forEach(node=>visible.add(node));nodes.forEach(activate);}
  return ()=>{
    if(disposed)return;disposed=true;observer?.disconnect();
    nodes.forEach(node=>{visible.add(node);deactivate(node);});visible.clear();
  };
}
