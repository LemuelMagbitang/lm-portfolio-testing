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
  const fallbackScrollOptions = {capture:true,passive:true};
  let fallbackFrame = 0;
  function setNodeVisibility(node, isVisible) {
    if (isVisible) {
      visible.add(node);
      activate(node);
      return;
    }
    const wasVisible = visible.delete(node);
    if (wasVisible || active.has(node) || node.dataset?.previewActive === 'true' ||
        (node.dataset?.previewType === 'model' && node.__modelViewerMountToken)) {
      deactivate(node);
    }
  }
  function checkFallbackVisibility() {
    fallbackFrame = 0;
    if (disposed) return;
    const viewportHeight = Number(view?.innerHeight) || Number(doc?.documentElement?.clientHeight) || 0;
    const viewportWidth = Number(view?.innerWidth) || Number(doc?.documentElement?.clientWidth) || 0;
    nodes.forEach(node => {
      let nearViewport = false;
      if (viewportHeight > 0 && viewportWidth > 0 && node?.isConnected &&
          root.contains(node) && typeof node.getBoundingClientRect === 'function') {
        const rect = node.getBoundingClientRect();
        nearViewport = Number.isFinite(rect?.top) && Number.isFinite(rect?.bottom) &&
          Number.isFinite(rect?.left) && Number.isFinite(rect?.right) &&
          rect.bottom >= -120 && rect.top <= viewportHeight + 120 &&
          rect.right >= -120 && rect.left <= viewportWidth + 120;
      }
      setNodeVisibility(node, nearViewport);
    });
  }
  function scheduleFallbackCheck() {
    if (disposed || fallbackFrame) return;
    if (typeof view?.requestAnimationFrame === 'function') {
      fallbackFrame = view.requestAnimationFrame(checkFallbackVisibility);
    } else {
      checkFallbackVisibility();
    }
  }
  const observer = typeof view?.IntersectionObserver === 'function'
    ? new view.IntersectionObserver(entries => entries.forEach(entry => {
        setNodeVisibility(entry.target, entry.isIntersecting && entry.intersectionRatio > 0);
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
  if(observer) {
    nodes.forEach(node=>observer.observe(node));
  } else {
    // Preserve near-viewport loading on browsers without IntersectionObserver.
    // The document capture listener also catches scrolling inside CMS panels.
    view?.addEventListener?.('scroll',scheduleFallbackCheck,fallbackScrollOptions);
    view?.addEventListener?.('resize',scheduleFallbackCheck,fallbackScrollOptions);
    doc?.addEventListener?.('scroll',scheduleFallbackCheck,fallbackScrollOptions);
    checkFallbackVisibility();
  }
  return ()=>{
    if(disposed)return;
    disposed=true;
    observer?.disconnect();
    if(!observer) {
      view?.removeEventListener?.('scroll',scheduleFallbackCheck,fallbackScrollOptions);
      view?.removeEventListener?.('resize',scheduleFallbackCheck,fallbackScrollOptions);
      doc?.removeEventListener?.('scroll',scheduleFallbackCheck,fallbackScrollOptions);
      if(fallbackFrame && typeof view?.cancelAnimationFrame === 'function') view.cancelAnimationFrame(fallbackFrame);
      fallbackFrame=0;
    }
    nodes.forEach(node=>{visible.add(node);deactivate(node);});visible.clear();
  };
}
