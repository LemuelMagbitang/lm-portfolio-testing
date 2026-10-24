/* =====================================================================
   0. STATE + STORAGE
   ===================================================================== */
const STORAGE_KEY = 'lm_cms_connection_v2';
const LEGACY_STORAGE_KEY = 'lm_cms_connection_v1';
const SESSION_STORAGE_KEY = 'lm_cms_session_v1';
let conn = null;          // { owner, repo, branch, token }
let currentSection = 'hero';
let dirty = {};           // { hero: bool, ... }
let cache = {};           // { hero: { json, sha } }

// Use the managed single-flight player loader for all CMS Lottie surfaces.
// The project-row lifecycle imports this same module, sharing one in-flight load.
void import('../js/infrastructure/lottie/player.js')
  .then(({ensureLottiePlayer}) => ensureLottiePlayer())
  .catch(() => false);

function formatTimedValue(ms, unit){
  const n = Number(ms) || 0;
  return unit === 's' ? Number((n / 1000).toFixed(3)).toString() : Math.round(n).toString();
}
function toMs(value, unit){
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * (unit === 's' ? 1000 : 1)) : 0;
}

const CMS_IMAGE_MEDIA_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'svg'
]);
const CMS_VIDEO_MEDIA_EXTENSIONS = new Set([
  'mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'
]);
const CMS_MODEL_MEDIA_EXTENSIONS = new Set([
  'glb', 'gltf', 'obj', 'mtl', 'fbx', 'dae', 'usd', 'usdz', 'bin', 'ktx2', 'basis'
]);

// Reject media references that the public site cannot resolve or decode after
// publication. The CMS preview can display blob/data URLs, but those values are
// temporary and must never be committed as durable content-model references.
function validateCmsMediaSource(type, source, label = 'Media') {
  const value = String(source || '').trim();
  const context = String(label || 'Media');

  if (!['image', 'video', 'lottie'].includes(type)) {
    throw new Error(`${context}: choose Image, Video, or Lottie as the media type.`);
  }
  if (!value) {
    throw new Error(`${context}: choose a media source before saving.`);
  }
  if (/^(?:blob|data):/i.test(value)) {
    throw new Error(`${context}: temporary blob/data URLs cannot be saved. Upload the file to the Media Library and select its repository path.`);
  }
  if (/^javascript:/i.test(value)) {
    throw new Error(`${context}: JavaScript URLs are not valid media sources.`);
  }

  const isExternal = /^(?:https?:)?\/\//i.test(value);
  let pathname = '';
  if (isExternal) {
    let parsed;
    try {
      parsed = new URL(value, document.baseURI);
    } catch (_) {
      throw new Error(`${context}: enter a valid HTTP(S) media URL.`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`${context}: media URLs must use HTTP or HTTPS.`);
    }
    pathname = parsed.pathname;
  } else {
    pathname = value.split(/[?#]/, 1)[0].replace(/^\/+/, '');
    if (!pathname.startsWith('assets/') || /^[a-z][a-z\d+.-]*:/i.test(pathname)) {
      throw new Error(`${context}: local media must be selected from the Media Library under assets/, or supplied as an HTTP(S) URL.`);
    }
  }

  const extension = (pathname.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
  const knownTypeExtension =
    CMS_IMAGE_MEDIA_EXTENSIONS.has(extension) ||
    CMS_VIDEO_MEDIA_EXTENSIONS.has(extension) ||
    CMS_MODEL_MEDIA_EXTENSIONS.has(extension) ||
    extension === 'json';

  // Signed/dynamic external endpoints may intentionally omit a filename
  // extension. Their response Content-Type is authoritative, so do not guess.
  if (isExternal && !knownTypeExtension) return value;

  if (type === 'image' &&
      (CMS_VIDEO_MEDIA_EXTENSIONS.has(extension) ||
       CMS_MODEL_MEDIA_EXTENSIONS.has(extension) ||
       extension === 'json')) {
    throw new Error(`${context}: the .${extension} source is not an image. Match the selected media type to the file.`);
  }
  if (type === 'video' &&
      (CMS_IMAGE_MEDIA_EXTENSIONS.has(extension) ||
       CMS_MODEL_MEDIA_EXTENSIONS.has(extension) ||
       extension === 'json')) {
    throw new Error(`${context}: the .${extension} source is not a video. Match the selected media type to the file.`);
  }
  if (type === 'lottie' && extension && extension !== 'json') {
    throw new Error(`${context}: Lottie media must reference a .json animation file.`);
  }

  if (!isExternal && !extension) {
    throw new Error(`${context}: local media source must include a supported file extension.`);
  }
  if (!isExternal && type === 'image' && !CMS_IMAGE_MEDIA_EXTENSIONS.has(extension)) {
    throw new Error(`${context}: .${extension} is not a supported local image format.`);
  }
  if (!isExternal && type === 'video' && !CMS_VIDEO_MEDIA_EXTENSIONS.has(extension)) {
    throw new Error(`${context}: .${extension} is not a supported local video format.`);
  }
  if (!isExternal && type === 'lottie' && extension !== 'json') {
    throw new Error(`${context}: Lottie media must reference a .json animation file.`);
  }

  return value;
}

/* THE FIX FOR "everything 404s with the CMS's own folder stuck in the
   URL" — every preview image in this tool (project thumbnails, media
   items, the profile photo, skill logos, folder previews) is built
   from a path stored in data/*.json, like
   "assets/projects/haeru/web-og-image.webp". Those paths are written
   to be resolved from the SITE ROOT — same rule the public site
   itself follows everywhere.

   A plain `<img src="assets/...">` resolves relative to wherever THIS
   PAGE currently is, not the site root — so it only ever worked by
   coincidence, back when this file lived at the repo root and "this
   page" and "the site root" happened to be the same place. The moment
   this tool moves anywhere else (a /admin/ folder, a subfolder, a
   fresh CMS session opened from a different link), every one of those
   previews breaks, because the browser goes looking for
   ".../wherever-this-page-is/assets/..." instead.

   Fetching every preview straight from GitHub's raw content instead
   makes this permanently immune to that: it never depends on where
   this tool itself is hosted or served from, ever again — only on
   which repo it's connected to, which it already knows. */
// Shared by every preview in the CMS that loads a path someone typed
// or picked by hand (a project thumbnail, an artwork, the profile
// photo) — as opposed to something looked up automatically, like a
// software skill's auto logo, where a miss is expected and normal
// rather than something to act on. Replaces a broken preview with an
// actual way forward instead of a dead sentence: click through to
// Media Library, upload the file, come back and re-pick it.
function handleMissingFile(el, kind){
  const host = el.closest('.media-preview') || el.parentElement;
  if (!host) return;
  host.innerHTML = '';
  const note = document.createElement('div');
  note.className = 'missing-file-note';
  const icon = document.createElement('i');
  icon.className = 'fa-solid fa-triangle-exclamation';
  note.appendChild(icon);
  note.appendChild(document.createTextNode(` Couldn't find this ${kind || 'file'}. `));
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = 'Go to Media Library';
  link.addEventListener('click', (e) => { e.preventDefault(); goToSection('media'); });
  note.appendChild(link);
  host.appendChild(note);
}

// Shared by Media Library's own dropzone and the "Choose a file"
// picker's upload area — same upload mechanics either way (tile per
// file, its own local preview the instant it's dropped, a progress
// spinner, then swapped for the real uploaded version), so there's
// exactly one place to fix if anything about uploading itself ever
// needs to change. What happens once every file settles — which
// screen re-navigates to show it — stays with each caller, since
// Media Library and the picker want different things there.
function cmsUploadNeedsWebP(file){
  const name=String(file?.name||'');
  const type=String(file?.type||'').toLowerCase();
  // Preserve PNGs byte-for-byte. They may contain transparency, grayscale
  // foil masks, or texture maps, and Canvas WebP encoding is not guaranteed
  // to be lossless. JPEGs are only candidates; conversion is kept only when
  // the encoded WebP is smaller than the original.
  if(!/\.(jpe?g)$/i.test(name)) return false;
  return !type || ['image/jpeg','image/jpg','application/octet-stream'].includes(type);
}

function cmsWebPTargetName(name){
  return String(name||'').replace(/\.(?:jpe?g)$/i,'.webp');
}

function convertCmsUploadToWebP(file){
  if(!cmsUploadNeedsWebP(file)) return Promise.resolve({file,converted:false});
  // Encoding is an optional optimization, never a prerequisite for uploading
  // the original. Any unavailable browser API or conversion failure falls back
  // to the untouched file rather than blocking Media Library uploads.
  if(typeof URL?.createObjectURL!=='function' || typeof File!=='function'){
    return Promise.resolve({file,converted:false});
  }

  return new Promise(resolve=>{
    let objectUrl='';
    try{objectUrl=URL.createObjectURL(file);}catch(_){resolve({file,converted:false});return;}
    let image;
    try{image=new Image();}catch(_){try{URL.revokeObjectURL(objectUrl);}catch(__){}resolve({file,converted:false});return;}
    let canvas=null;
    let settled=false;
    const cleanup=()=>{
      try{URL.revokeObjectURL(objectUrl);}catch(_){}
      image.onload=null;
      image.onerror=null;
      if(canvas){canvas.width=0;canvas.height=0;canvas=null;}
    };
    const retainOriginal=()=>{
      if(settled)return;
      settled=true;
      cleanup();
      resolve({file,converted:false});
    };

    image.onload=()=>{
      if(settled)return;
      try{
        const width=Number(image.naturalWidth)||0;
        const height=Number(image.naturalHeight)||0;
        if(width<1||height<1){retainOriginal();return;}
        canvas=document.createElement('canvas');
        canvas.width=width;
        canvas.height=height;
        const context=canvas.getContext('2d',{alpha:true});
        if(!context){retainOriginal();return;}
        context.drawImage(image,0,0,width,height);
        // Generate a high-quality JPEG-derived WebP candidate. Keep it only
        // when the browser returns a valid, strictly smaller WebP payload.
        canvas.toBlob(blob=>{
          if(settled)return;
          try{
            if(!blob || blob.type!=='image/webp' || blob.size>=file.size){
              retainOriginal();
              return;
            }
            const targetName=cmsWebPTargetName(file.name);
            const convertedFile=new File([blob],targetName,{
              type:'image/webp',
              lastModified:file.lastModified||Date.now()
            });
            settled=true;
            cleanup();
            resolve({file:convertedFile,converted:true});
          }catch(_){retainOriginal();}
        },'image/webp',0.92);
      }catch(_){retainOriginal();}
    };
    image.onerror=retainOriginal;
    try{image.src=objectUrl;}catch(_){retainOriginal();}
  });
}
function uniqueCmsUploadName(name, usedNames){
  if(!usedNames.has(name)) return name;
  const dot=name.lastIndexOf('.');
  const stem=dot>0?name.slice(0,dot):name;
  const extension=dot>0?name.slice(dot):'';
  let suffix=2;
  let candidate=stem+'-'+suffix+extension;
  while(usedNames.has(candidate)){suffix+=1;candidate=stem+'-'+suffix+extension;}
  return candidate;
}

async function uploadFilesToFolder(fileList,folder,gridEl,currentTree){
  const files=Array.from(fileList||[]);
  if(!files.length)return;
  if(!gridEl)throw new Error('Media Library upload target is no longer available.');

  // Stage all selected files against one exact branch snapshot. Nothing is
  // committed until every readable file has been converted (if beneficial)
  // and uploaded as a Git blob, so one multi-file batch produces one commit.
  let uploadParentSha,uploadTree;
  try{
    uploadParentSha=await GH.getBranchHead();
    if(!uploadParentSha)throw new Error(`Couldn't resolve the current ${conn.branch} branch head.`);
    uploadTree=(await GH.getTree(uploadParentSha)||[]).slice();
    setMediaTreeCache(uploadTree);
  }catch(err){
    toast("Couldn't refresh the Media Library before upload: "+err.message,true);
    return;
  }
  const emptyBanner=gridEl.querySelector('.banner.muted');
  if(emptyBanner)emptyBanner.remove();

  const reservedNames=new Set();
  const jobs=files.map(file=>{
    const isPreviewable=/^image\/|^video\//.test(file.type)||cmsUploadNeedsWebP(file);
    const localUrl=isPreviewable?URL.createObjectURL(file):null;
    const tile=document.createElement('div');
    tile.className='media-tile is-uploading';
    const thumbInner=!localUrl?FILE_ICON_SVG
      :file.type.startsWith('video/')?'<video src="'+localUrl+'" muted></video>'
      :'<img src="'+localUrl+'">';
    tile.innerHTML=
      '<div class="thumb">'+thumbInner+'<div class="upload-overlay"><i class="fa-solid fa-circle-notch spin"></i></div></div>'+
      '<div class="meta"><div class="fname">'+esc(file.name)+'</div></div>'+
      '<div class="upload-status">Preparing…</div>';
    gridEl.prepend(tile);
    return {file,originalName:file.name,targetName:file.name,path:folder+'/'+file.name,tile,localUrl,converted:false,blobSha:null,staged:false};
  });
  const stagedJobs=[];
  const entries=[];
  toast('Preparing '+jobs.length+' file'+(jobs.length===1?'':'s')+' for one commit…');

  for(const job of jobs){
    try{
      if(cmsUploadNeedsWebP(job.file)){
        const status=job.tile.querySelector('.upload-status');
        if(status)status.textContent='Optimizing image…';
      }
      const conversion=await convertCmsUploadToWebP(job.file);
      let uploadFile=conversion.file;
      job.converted=conversion.converted;
      const desiredName=conversion.converted ? cmsWebPTargetName(job.originalName) : job.originalName;
      job.targetName=uniqueCmsUploadName(desiredName,reservedNames);
      reservedNames.add(job.targetName);
      if(uploadFile.name!==job.targetName){
        uploadFile=new File([uploadFile],job.targetName,{
          type:uploadFile.type||job.file.type,
          lastModified:uploadFile.lastModified||job.file.lastModified||Date.now()
        });
      }
      job.file=uploadFile;
      job.path=folder+'/'+job.targetName;
      const filename=job.tile.querySelector('.fname');
      if(filename)filename.textContent=job.targetName;
      if(job.converted){
        if(job.localUrl)URL.revokeObjectURL(job.localUrl);
        job.localUrl=URL.createObjectURL(job.file);
        const thumbnail=job.tile.querySelector('.thumb img');
        if(thumbnail)thumbnail.src=job.localUrl;
      }
      const status=job.tile.querySelector('.upload-status');
      if(status)status.textContent='Staging for commit…';
      const dataUrl=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result);
        reader.onerror=()=>reject(reader.error||new Error('Could not read the selected file.'));
        reader.readAsDataURL(job.file);
      });
      if(typeof dataUrl!=='string'||!dataUrl.includes(','))throw new Error('Could not encode this file for upload.');
      const base64=dataUrl.slice(dataUrl.indexOf(',')+1);
      if(!base64)throw new Error('This file produced an empty upload payload.');
      job.blobSha=await GH.createBlob(base64,'base64');
      job.staged=true;
      entries.push({
        path:job.path,
        mode:'100644',
        type:'blob',
        sha:job.blobSha
      });
      stagedJobs.push(job);
      if(status)status.textContent='Ready to save…';
    }catch(err){
      job.tile.classList.remove('is-uploading');
      job.tile.classList.add('is-error');
      const overlay=job.tile.querySelector('.upload-overlay');
      if(overlay)overlay.innerHTML='<i class="fa-solid fa-triangle-exclamation" style="color:#ff8f87"></i>';
      const status=job.tile.querySelector('.upload-status');
      if(status)status.textContent='Failed — '+(err?.message||'Could not stage this file.');
      toast(job.originalName+': '+(err?.message||'Could not stage this file.'),true);
    }
  }

  if(!entries.length)return;
  try{
    const latestHead=await GH.getBranchHead();
    if(latestHead!==uploadParentSha)throw new Error('The repository changed while files were being prepared. No upload was committed; refresh the Media Library and retry.');
    await ghCommitTreeEntries(
      entries,
      'CMS: upload '+stagedJobs.length+' media file'+(stagedJobs.length===1?'':'s')+' to '+folder,
      uploadParentSha
    );
    // The new tree differs only at these uploaded paths. Update the local tree
    // immediately so previews resolve to the new blob SHAs without a second
    // blocking tree request or a stale pre-upload view.
    stagedJobs.forEach(job=>{
      const existingIndex = uploadTree.findIndex(item => item.type === 'blob' && item.path === job.path);
      const existing=existingIndex>=0?uploadTree[existingIndex]:null;
      const entry={path:job.path,type:'blob',sha:job.blobSha,mode:existing?.mode==='100755'?'100755':'100644'};
      if(existingIndex>=0)uploadTree[existingIndex]=entry;
      else uploadTree.push(entry);
    });
    setMediaTreeCache(uploadTree);
    stagedJobs.forEach(job=>{
      // Switch to the committed, SHA-keyed remote URL before releasing the
      // temporary local preview, so the tile never points at a revoked blob.
      const preview=job.tile.querySelector('.thumb img, .thumb video');
      if(preview){
        preview.src=ghRawUrl(job.path,job.blobSha);
        if(preview.tagName==='VIDEO')preview.load();
      }
      if(job.localUrl){URL.revokeObjectURL(job.localUrl);job.localUrl=null;}
      // The temporary upload tile has no full-preview/action bindings. Keep it
      // non-interactive until the owning renderer replaces it with a real tile.
      job.tile.style.pointerEvents='none';
      job.tile.setAttribute('aria-disabled','true');
      job.tile.classList.remove('is-uploading');
      job.tile.classList.add('is-done');
      job.tile.querySelector('.upload-overlay')?.remove();
      job.tile.querySelector('.upload-status')?.remove();
    });
    toast('Uploaded '+stagedJobs.length+' file'+(stagedJobs.length===1?'':'s')+' in one GitHub commit.');
  }catch(err){
    stagedJobs.forEach(job=>{
      job.tile.classList.remove('is-uploading');
      job.tile.classList.add('is-error');
      const overlay=job.tile.querySelector('.upload-overlay');
      if(overlay)overlay.innerHTML='<i class="fa-solid fa-triangle-exclamation" style="color:#ff8f87"></i>';
      const status=job.tile.querySelector('.upload-status');
      if(status)status.textContent='Commit failed — '+(err?.message||'Could not publish this batch.');
    });
    toast('Upload batch was not committed: '+(err?.message||'Unknown GitHub error.'),true);
  }
}

function ghRawUrl(path, version){
  if (!path) return '';
  // Keep external and transient local previews untouched. Internal media
  // carries its Git blob SHA as a query key so replacements refresh.
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path;
  const assetPath = String(path).replace(/^\/+/, '');
  const raw = `https://raw.githubusercontent.com/${conn.owner}/${conn.repo}/${conn.branch}/${assetPath}`;
  const cacheKey = version || mediaTreeShaByPath?.get(assetPath);
  return cacheKey ? `${raw}?v=${encodeURIComponent(String(cacheKey).slice(0, 12))}` : raw;
}

const SECTIONS = {
  hero:     { file: 'data/hero.json',     label: 'Hero Messages' },
  heroLoop: { file: 'data/hero-loop.json', label: 'Hero Loop Animation' },
  footerLoop: { file: 'data/footer-loop.json', label: 'Footer Animation' },
  filters:  { file: 'data/filters.json',  label: 'Filters & Badges' },
  projects: { file: 'data/projects.json', label: 'Projects' },
  about:    { file: 'data/about.json',    label: 'About Page' },
  reviews:  { file: 'data/reviews.json',  label: 'Reviews' },
  curatedViews: { file: 'data/curated-views.json', label: 'Curated Views' },
  settings: { file: 'data/settings.json', label: 'Settings & Toggles' }
};

function isSafeRepoName(value){
  return /^[A-Za-z0-9_.-]{1,100}$/.test(String(value || ''));
}
function isSafeBranchName(value){
  const branch = String(value || '');
  return branch.length >= 1 && branch.length <= 255
    && /^[A-Za-z0-9._/-]+$/.test(branch)
    && !branch.startsWith('/')
    && !branch.endsWith('/')
    && !branch.includes('//')
    && !branch.includes('..');
}
function isValidConnection(value){
  return !!value
    && typeof value === 'object'
    && typeof value.token === 'string'
    && /^github_pat_[A-Za-z0-9_]+$/.test(value.token)
    && isSafeRepoName(value.owner)
    && isSafeRepoName(value.repo)
    && isSafeBranchName(value.branch);
}
function readStoredConnection(storage, key){
  try{
    const raw = storage.getItem(key);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidConnection(parsed) ? parsed : null;
  }catch(e){ return null; }
}
function loadConn(){
  // Drop the older v1 persistent key rather than silently preserving a
  // credential format that did not have the session-first policy.
  try{ window.localStorage.removeItem(LEGACY_STORAGE_KEY); }catch(e){}
  return readStoredConnection(window.sessionStorage, SESSION_STORAGE_KEY)
    || readStoredConnection(window.localStorage, STORAGE_KEY);
}
function saveConn(c, remember){
  try{
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(c));
    if(remember) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    else window.localStorage.removeItem(STORAGE_KEY);
  }catch(e){
    // Storage can be blocked by privacy mode. The in-memory connection still works.
  }
}
function clearConn(){
  try{ window.sessionStorage.removeItem(SESSION_STORAGE_KEY); }catch(e){}
  try{ window.localStorage.removeItem(STORAGE_KEY); }catch(e){}
  try{ window.localStorage.removeItem(LEGACY_STORAGE_KEY); }catch(e){}
}

/* =====================================================================
   1. GITHUB CLIENT
   ===================================================================== */
function b64EncodeUtf8(str){
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}
function b64DecodeUtf8(b64){
  const bin = atob(b64.replace(/\n/g,''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}
function authHeaders(){
  return {
    'Authorization': 'Bearer ' + conn.token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}
function hasUnsafeCmsPathSegments(filePath) {
  const raw = String(filePath || '').trim().replace(/\\/g, '/');
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return true;

  // Check literal paths and up to three rounds of URL decoding. This rejects
  // dot-segment traversal whether it appears directly, via encoded slashes,
  // or behind nested percent-encoding before a request reaches the GitHub API.
  const candidates = [raw];
  let candidate = raw;
  for (let decodeStep = 0; decodeStep < 3; decodeStep += 1) {
    let decoded;
    try {
      decoded = decodeURIComponent(candidate).replace(/\\/g, '/');
    } catch (_) {
      break;
    }
    if (decoded === candidate) break;
    candidates.push(decoded);
    candidate = decoded;
  }

  return candidates.some(value =>
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.split('/').some(segment => segment === '.' || segment === '..')
  );
}

function normalizeCmsPath(filePath) {
  const raw = String(filePath || '').trim().replace(/\\/g, '/');
  if (!raw || hasUnsafeCmsPathSegments(raw)) return null;
  const value = raw.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  return value || null;
}

const CMS_WRITABLE_PATHS = new Set([
  'data/about.json',
  'data/filters.json',
  'data/footer-loop.json',
  'data/hero-loop.json',
  'data/hero.json',
  'data/projects.json',
  'data/curated-views.json',
  'data/reviews.json',
  'data/settings.json',
  'index.html',
  'about/index.html',
  '404.html',
  'success/index.html',
  'css/style.css',
  'js/script.js',
  'js/infrastructure/media-background/engine.js'
]);

function isCmsWritablePath(filePath) {
  const value = normalizeCmsPath(filePath);
  return Boolean(value && (CMS_WRITABLE_PATHS.has(value) || value.startsWith('assets/')));
}

function assertCmsWritablePath(filePath) {
  const value = normalizeCmsPath(filePath);
  if (!value || !(CMS_WRITABLE_PATHS.has(value) || value.startsWith('assets/'))) {
    throw new Error('CMS write blocked: this editor can only modify site content, media, and its known reference files.');
  }
  return value;
}

function apiPath(filePath) {
  const value = normalizeCmsPath(filePath);
  if (!value) throw new Error('Invalid GitHub repository path.');
  return value.split('/').map(encodeURIComponent).join('/');
}

function githubFetch(url, init = {}) {
  return fetch(url, {
    ...init,
    credentials: 'omit',
    cache: init.cache || 'no-store',
    referrerPolicy: init.referrerPolicy || 'no-referrer'
  });
}

const GH = {
  async getFile(path, ref=conn.branch){
    const url = `https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}/contents/${apiPath(path)}?ref=${encodeURIComponent(ref)}`;
    const res = await githubFetch(url, { headers: authHeaders() });
    if(res.status === 404) return { json: null, sha: null, missing: true };
    if(!res.ok){
      const e = await res.json().catch(()=>({}));
      throw new Error(e.message || `GitHub error ${res.status}`);
    }
    const data = await res.json();
    const text = b64DecodeUtf8(data.content);
    let json;
    try{ json = JSON.parse(text); }catch(e){ throw new Error(`${path} isn't valid JSON — check it hasn't been hand-edited into a broken state.`); }
    return { json, sha: data.sha, missing:false };
  },
  async putFile(path, obj, sha, message){
    path = assertCmsWritablePath(path);
    const url = `https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}/contents/${apiPath(path)}`;
    const body = {
      message,
      content: b64EncodeUtf8(JSON.stringify(obj, null, 2) + '\n'),
      branch: conn.branch
    };
    if(sha) body.sha = sha;
    const res = await githubFetch(url, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    if(!res.ok){
      const e = await res.json().catch(()=>({}));
      throw new Error(e.message || `GitHub error ${res.status}`);
    }
    return res.json();
  },
  async testAuth(){
    const url = `https://api.github.com/repos/${conn.owner}/${conn.repo}`;
    const res = await githubFetch(url, { headers: authHeaders() });
    if(res.status === 404) throw new Error('Repository not found — check the username and repo name.');
    if(res.status === 401) throw new Error('Token rejected — check it was copied in full.');
    if(res.status === 403) throw new Error('Token doesn\'t have access to this repo — check its repository access & Contents permission.');
    if(!res.ok) throw new Error(`Could not reach GitHub (error ${res.status}).`);
    return res.json();
  },
  async getTree(ref=conn.branch){
    const url = `https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
    const res = await githubFetch(url, { headers: authHeaders() });
    if(!res.ok){
      const e = await res.json().catch(()=>({}));
      throw new Error(e.message || `GitHub error ${res.status}`);
    }
    const data = await res.json();
    return data.tree || [];
  },
  async getTextFile(path, ref=conn.branch){
    const url = `https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}/contents/${apiPath(path)}?ref=${encodeURIComponent(ref)}`;
    const res = await githubFetch(url, { headers: authHeaders() });
    if(res.status === 404) throw new Error(`${path} was not found in the repository.`);
    if(!res.ok){
      const e = await res.json().catch(()=>({}));
      throw new Error(e.message || `GitHub error ${res.status}`);
    }
    const data = await res.json();
    if(Array.isArray(data)) throw new Error(`${path} is a directory, not a text file.`);
    return { text:b64DecodeUtf8(data.content || ''), sha:data.sha };
  },
  async getBranchHead(){
    const branchPath = conn.branch.split('/').map(encodeURIComponent).join('/');
    const url = `https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}/git/ref/heads/${branchPath}`;
    const res = await githubFetch(url, { headers: authHeaders() });
    if(!res.ok){
      const e = await res.json().catch(()=>({}));
      throw new Error(e.message || `GitHub error ${res.status}`);
    }
    return (await res.json()).object?.sha;
  },
  async createBlob(content, encoding='utf-8'){
    const url = `https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}/git/blobs`;
    const res = await githubFetch(url, {
      method:'POST', headers:{...authHeaders(),'Content-Type':'application/json'},
      body:JSON.stringify({content,encoding})
    });
    if(!res.ok){
      const e = await res.json().catch(()=>({}));
      throw new Error(e.message || `GitHub error ${res.status}`);
    }
    return (await res.json()).sha;
  },
  async createTree(baseTreeSha, treeEntries){
    const url = `https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}/git/trees`;
    const res = await githubFetch(url, {
      method:'POST', headers:{...authHeaders(),'Content-Type':'application/json'},
      body:JSON.stringify({base_tree:baseTreeSha,tree:treeEntries})
    });
    if(!res.ok){
      const e = await res.json().catch(()=>({}));
      throw new Error(e.message || `GitHub error ${res.status}`);
    }
    return (await res.json()).sha;
  },
  async createCommit(message, treeSha, parentSha){
    const url = `https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}/git/commits`;
    const res = await githubFetch(url, {
      method:'POST', headers:{...authHeaders(),'Content-Type':'application/json'},
      body:JSON.stringify({message,tree:treeSha,parents:[parentSha]})
    });
    if(!res.ok){
      const e = await res.json().catch(()=>({}));
      throw new Error(e.message || `GitHub error ${res.status}`);
    }
    return await res.json();
  },
  async updateBranch(commitSha){
    const branchPath = conn.branch.split('/').map(encodeURIComponent).join('/');
    const url = `https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}/git/refs/heads/${branchPath}`;
    const res = await githubFetch(url, {
      method:'PATCH', headers:{...authHeaders(),'Content-Type':'application/json'},
      body:JSON.stringify({sha:commitSha,force:false})
    });
    if(!res.ok){
      const e = await res.json().catch(()=>({}));
      if (res.status === 409 || res.status === 422) {
        throw new Error('The repository changed while saving. Reload the CMS and review the current content before saving again.');
      }
      throw new Error(e.message || `GitHub error ${res.status}`);
    }
    return await res.json();
  },
  // The branch-head check prevents starting from a stale parent. The final
  // ref update is non-forced, so GitHub will reject invalid ref updates rather
  // than rewriting unrelated history.
  async commitFiles(files, message){
    if(!Array.isArray(files) || !files.length) throw new Error('Nothing to commit.');
    const safeFiles = files.map(file => {
      const safePath = assertCmsWritablePath(file?.path);
      if (file?.mode !== undefined && file.mode !== '100644') {
        throw new Error('CMS write blocked: only regular repository files can be saved.');
      }
      return { ...file, path: safePath, mode: '100644' };
    });
    const parentSha = await GH.getBranchHead();
    if(!parentSha) throw new Error(`Couldn't resolve the current ${conn.branch} branch head.`);
    const commitUrl = `https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}/git/commits/${encodeURIComponent(parentSha)}`;
    const commitRes = await githubFetch(commitUrl, { headers: authHeaders() });
    if(!commitRes.ok){
      const e=await commitRes.json().catch(()=>({}));
      throw new Error(e.message || `GitHub error ${commitRes.status}`);
    }
    const commitData = await commitRes.json();
    // Compare cached file versions against the exact parent commit. Reading the
    // branch name here would allow a concurrent update to slip between checks.
    for (const file of safeFiles) {
      if (!Object.prototype.hasOwnProperty.call(file, 'expectedSha')) continue;
      const current = await GH.getFile(file.path, parentSha);
      if ((current.sha ?? null) !== (file.expectedSha ?? null)) {
        throw new Error(`The repository changed since this editor loaded ${file.path}. Reload the CMS and review the current content before saving again.`);
      }
    }
    const latestParentSha = await GH.getBranchHead();
    if (latestParentSha !== parentSha) {
      throw new Error('The repository changed while saving. Reload the CMS and review the current content before saving again.');
    }
    const entries=[];
    for (const file of safeFiles) {
      if(!file?.path) continue;
      const sha = await GH.createBlob(file.content ?? '', file.encoding || 'utf-8');
      entries.push({path:file.path,mode:'100644',type:'blob',sha});
    }
    if(!entries.length) throw new Error('Nothing to commit.');
    const newTreeSha = await GH.createTree(commitData.tree.sha, entries);
    const newCommit = await GH.createCommit(message, newTreeSha, parentSha);
    await GH.updateBranch(newCommit.sha);
    return newCommit;
  },
  async uploadBinary(path, dataUrl, message, existingSha){
    path = assertCmsWritablePath(path);
    const base64 = dataUrl.split(',')[1]; // strip the "data:*/*;base64," prefix
    const url = `https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}/contents/${apiPath(path)}`;
    const body = { message, content: base64, branch: conn.branch };
    if (existingSha) body.sha = existingSha;
    const res = await githubFetch(url, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    if(!res.ok){
      const e = await res.json().catch(()=>({}));
      throw new Error(e.message || `GitHub error ${res.status}`);
    }
    return res.json();
  },
  async deleteFile(path, sha, message){
    const safePath = normalizeCmsPath(path);
    if (!safePath || !safePath.startsWith('assets/')) {
      throw new Error('CMS delete blocked: only media assets can be deleted from the Media Library.');
    }
    path = safePath;
    const url = `https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}/contents/${apiPath(path)}`;
    const res = await githubFetch(url, {
      method: 'DELETE',
      headers: { ...authHeaders(), 'Content-Type':'application/json' },
      body: JSON.stringify({ message, sha, branch: conn.branch })
    });
    if(!res.ok){
      const e = await res.json().catch(()=>({}));
      throw new Error(e.message || `GitHub error ${res.status}`);
    }
    return res.json();
  },
  async getCheckRuns(sha){
    const url = 'https://api.github.com/repos/' + encodeURIComponent(conn.owner) + '/' +
      encodeURIComponent(conn.repo) + '/commits/' + encodeURIComponent(sha) + '/check-runs?per_page=50';
    const res = await githubFetch(url, { headers: authHeaders() });
    if(!res.ok) return []; // Status-read permissions never block a completed content save.
    const data = await res.json();
    return data.check_runs || [];
  }
};

/* =====================================================================
   2. TOASTS
   ===================================================================== */
function toast(msg, isError){
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  const icon = document.createElement('i');
  icon.className = 'fa-solid ' + (isError ? 'fa-triangle-exclamation' : 'fa-check');
  icon.setAttribute('aria-hidden', 'true');
  icon.style.marginRight = '8px';
  icon.style.color = isError ? '#e0584f' : '#2ecc71';
  el.appendChild(icon);
  el.appendChild(document.createTextNode(String(msg ?? '')));
  wrap.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(),300); }, isError ? 5000 : 3200);
}

/* =====================================================================
   3. CONNECT FLOW
   ===================================================================== */
document.getElementById('btnConnect').addEventListener('click', async () => {
  const owner = document.getElementById('inOwner').value.trim();
  const repo = document.getElementById('inRepo').value.trim();
  const branch = document.getElementById('inBranch').value.trim() || 'main';
  const token = document.getElementById('inToken').value.trim();
  const remember = document.getElementById('inRemember').checked;
  const errBox = document.getElementById('connectError');
  errBox.style.display = 'none';

  if(!owner || !repo || !token){
    errBox.textContent = 'Fill in username, repository, and token.';
    errBox.style.display = 'block';
    return;
  }
  if(!isSafeRepoName(owner) || !isSafeRepoName(repo) || !isSafeBranchName(branch)){
    errBox.textContent = 'Use a valid GitHub username/repository and branch name.';
    errBox.style.display = 'block';
    return;
  }
  if(!/^github_pat_[A-Za-z0-9_]+$/.test(token)){
    errBox.textContent = 'Use a GitHub fine-grained token (github_pat_…) scoped to this repository.';
    errBox.style.display = 'block';
    return;
  }
  const btn = document.getElementById('btnConnect');
  btn.disabled = true; btn.textContent = 'Connecting…';

  conn = { owner, repo, branch, token };
  try{
    await GH.testAuth();
    saveConn(conn, remember);
    enterApp();
  }catch(err){
    errBox.textContent = err.message;
    errBox.style.display = 'block';
    conn = null;
  }finally{
    btn.disabled = false; btn.textContent = 'Connect';
  }
});

document.getElementById('btnDisconnect').addEventListener('click', () => {
  if(Object.values(dirty).some(Boolean)){
    if(!confirm('You have unsaved changes that will be lost. Disconnect anyway?')) return;
  }
  clearConn();
  location.reload();
});

function enterApp(){
  document.getElementById('connectScreen').style.display = 'none';
  // Remove the credential field entirely after connection. Keeping a
  // password input in the active DOM can cause browser password managers
  // to surface save/update-password UI during unrelated dialogs such as
  // the Media Picker. The token is already retained in session state.
  const tokenInput = document.getElementById('inToken');
  tokenInput?.closest('.field')?.remove();
  document.getElementById('app').classList.add('active');
  document.getElementById('topbar').classList.add('active');
  const repoLabel = document.getElementById('repoLabel');
  repoLabel.replaceChildren();
  const branchIcon = document.createElement('i');
  branchIcon.className = 'fa-solid fa-code-branch';
  branchIcon.setAttribute('aria-hidden', 'true');
  repoLabel.appendChild(branchIcon);
  repoLabel.appendChild(document.createTextNode(' ' + conn.owner + '/' + conn.repo + ' · ' + conn.branch));
  // Do not overwrite a section selected during the tiny window between
  // exposing the app shell and finishing the async restore/connect flow.
  // Hero is only the fallback initial destination when nothing else has
  // already been selected.
  if (currentSection === 'hero') goToSection('hero');
}

(function boot(){
  const saved = loadConn();
  if(saved && saved.token){
    conn = saved;
    GH.testAuth().then(enterApp).catch(()=>{
      // stale/revoked token — fall back to connect screen, prefill what we can
      document.getElementById('inOwner').value = saved.owner || '';
      document.getElementById('inRepo').value = saved.repo || '';
      document.getElementById('inBranch').value = saved.branch || 'main';
      conn = null;
    });
  }
})();

/* =====================================================================
   4. NAV
   ===================================================================== */
document.querySelectorAll('.nav-item[data-section]').forEach(el => {
  el.addEventListener('click', () => goToSection(el.dataset.section));
});

/* Mobile drawer: the sidebar (aside.sidebar) is the drawer itself —
   see the max-width:720px rules above — this just toggles the two
   classes that slide it in/out and dim the page behind it. Desktop
   never sees these classes do anything, since the drawer CSS they
   control only exists inside that same media query. */
function setDrawerOpen(open){
  document.querySelector('aside.sidebar')?.classList.toggle('drawer-open', open);
  document.getElementById('sidebarBackdrop')?.classList.toggle('active', open);
}
document.getElementById('mobileMenuBtn')?.addEventListener('click', () => setDrawerOpen(true));
document.getElementById('sidebarBackdrop')?.addEventListener('click', () => setDrawerOpen(false));

function goToSection(name){
  if(dirty[currentSection] && name !== currentSection){
    if(!confirm('You have unsaved changes in ' + (SECTIONS[currentSection]?.label||currentSection) + '. Leave without saving?')){
      return;
    }
    dirty[currentSection] = false;
    updateDirtyDots();
  }

  // Only invalidate the previous section's deployment tracker after
  // navigation has actually been approved. Cancelling the unsaved-change
  // confirmation must leave the current section's “Deploying…” state intact.
  deployTrackVersion++;
  const deployStatus = document.getElementById('saveStatus');
  const deployStatusText = document.getElementById('saveStatusText');
  if (deployStatus) deployStatus.classList.remove('deploying', 'deploy-failed');
  if (deployStatusText) deployStatusText.textContent = '';
  setDrawerOpen(false); // picking a section is done with the drawer, same as tapping outside it
  currentSection = name;
  // Section-level impact dots clear when the editor visits that section.
  // Project-level dots remain until the affected project itself is opened.
  lastMediaImpact.sections = (lastMediaImpact.sections||[]).filter(key=>key!==name);
  updateMediaImpactIndicators();
  document.querySelectorAll('.nav-item[data-section]').forEach(el=>{
    el.classList.toggle('active', el.dataset.section === name);
  });

  const label = SECTIONS[name]?.label || (name === 'guide' ? 'Setup Guide' : name === 'media' ? 'Media Library' : name);
  document.getElementById('topbarSection').textContent = label;
  const saveBtn = document.getElementById('btnSaveTop');
  const statusEl = document.getElementById('saveStatus');
  const savable = !!SECTIONS[name];
  // Keep the navbar/save bar permanently visible while the CMS is open.
  // Non-savable views (Media Library / Guide) simply disable the save action.
  saveBtn.style.display = '';
  saveBtn.disabled = !savable;
  statusEl.style.display = '';
  currentSave = null;

  render();
}

function updateDirtyDots(){
  Object.keys(SECTIONS).forEach(k=>{
    const d = document.getElementById('dirty-'+k);
    if(d) d.style.display = dirty[k] ? 'block' : 'none';
  });
}

const editRevision = Object.create(null);
function getEditRevision(name){ return Number(editRevision[name]||0); }
function markDirty(){
  dirty[currentSection]=true;
  editRevision[currentSection]=getEditRevision(currentSection)+1;
  updateDirtyDots();
}

window.addEventListener('beforeunload', (e) => {
  if(Object.values(dirty).some(Boolean)){ e.preventDefault(); e.returnValue = ''; }
});

/* =====================================================================
   5. DATA LOADING
   ===================================================================== */
async function loadSection(name){
  if(cache[name]) return cache[name];
  const { file } = SECTIONS[name];
  const result = await GH.getFile(file);
  cache[name] = result;
  return result;
}

async function saveSection(name,obj,commitMessage,revisionSnapshot={}){
  const {file}=SECTIONS[name];
  const existing=cache[name]||{};
  const savedRevision=revisionSnapshot[name]??getEditRevision(name);
  const result=await GH.putFile(file,obj,existing.sha,commitMessage);
  cache[name]={json:obj,sha:result.content.sha,missing:false};
  // The user may keep editing while GitHub is committing the snapshot. Preserve
  // the unsaved dot when the in-editor model has changed since this Save began.
  dirty[name]=getEditRevision(name)!==savedRevision;
  updateDirtyDots();
  return result.commit&&result.commit.sha;
}

// Saves several CMS JSON files in one Git commit. This is important for
// settings that logically belong together (such as Hero Loop entries and
// heroTiming) so one click produces one repository revision and one Pages
// deployment instead of a chain of superseding deployments.
async function saveSectionsAtomic(files,message,revisionSnapshot={}){
  if(!Array.isArray(files) || !files.length) throw new Error('Nothing to commit.');
  const versionedFiles = files.map(file => {
    const previous = cache[file.name];
    if (!previous || !Object.prototype.hasOwnProperty.call(previous, 'sha')) {
      throw new Error(`Couldn't verify the original version of ${file.path}. Reload the CMS before saving again.`);
    }
    return { ...file, expectedSha: previous.sha ?? null };
  });
  const commit = await GH.commitFiles(versionedFiles, message);
  // Once the commit lands, remain dirty until every written file has been
  // read back and verified. A concurrent follow-up edit must not be paired
  // with this editor's older JSON in the cache.
  for (const file of files) dirty[file.name] = true;
  const snapshots = [];
  try {
    for (const file of files) {
      const parsed = JSON.parse(file.content);
      const fresh = await GH.getFile(file.path);
      if (fresh.missing || JSON.stringify(fresh.json) !== JSON.stringify(parsed)) {
        throw new Error(`The commit was created, but the repository now contains different content for ${file.path}. Reload the CMS and review the current content before saving again.`);
      }
      snapshots.push({ name: file.name, json: parsed, sha: fresh.sha });
    }
  } catch (error) {
    updateDirtyDots();
    throw error;
  }
  for(const snapshot of snapshots){
    cache[snapshot.name]={json:snapshot.json,sha:snapshot.sha,missing:false};
    const savedRevision=revisionSnapshot[snapshot.name]??getEditRevision(snapshot.name);
    dirty[snapshot.name]=getEditRevision(snapshot.name)!==savedRevision;
  }
  updateDirtyDots();
  return commit.sha;
}

/* =====================================================================
   6. RENDER ROUTER
   ===================================================================== */
const content = document.getElementById('content');
let renderVersion = 0;

async function render(){
  const version = ++renderVersion;
  const section = currentSection;
  disposeProjectListPreviews();
  disposeProjectListPreviews = () => {};
  const isCurrentRender = () => version === renderVersion && section === currentSection;

  if(section === 'guide'){ if(isCurrentRender()) renderGuide(); return; }
  if(section === 'media'){ await RENDERERS.media(null, isCurrentRender); return; }

  content.innerHTML = `<div class="loading-row"><i class="fa-solid fa-circle-notch spin"></i> Loading ${SECTIONS[section].label.toLowerCase()}…</div>`;
  try{
    const data = await loadSection(section);
    // Navigation can change while GitHub is responding. Never let an older
    // section request paint into the section the user selected afterward.
    if(version !== renderVersion || section !== currentSection) return;
    if(RENDERERS[section]) await RENDERERS[section](data, isCurrentRender);
    if(!isCurrentRender()) return;
  }catch(err){
    if(version !== renderVersion || section !== currentSection) return;
    content.innerHTML = '<div class="banner info" style="border-color:rgba(224,88,79,.4)"><i class="fa-solid fa-triangle-exclamation" style="color:#e0584f"></i><div><strong>Couldn\'t load this file.</strong><br><span data-error-message></span></div></div>';
    content.querySelector('[data-error-message]')?.replaceChildren(document.createTextNode(String(err?.message || 'Unknown error.')));
  }
}

function sectionHead(title, desc, extraBtns){
  return `
    <div class="content-head">
      <div>
        <h2>${title}</h2>
        <p>${desc}</p>
      </div>
      ${extraBtns ? `<div class="head-actions">${extraBtns}</div>` : ''}
    </div>`;
}

let currentSave = null; // { onCollect, name, filePath }

function wireSave(onCollect, name, filePath){
  const saveContext = { onCollect, name, filePath };
  currentSave = saveContext;
  const saveBtn = document.getElementById('btnSaveTop');
  if (saveBtn) saveBtn.disabled = false;
  const status = document.getElementById('saveStatus');
  const statusText = document.getElementById('saveStatusText');
  if (dirty[name]) {
    status.classList.remove('saved');
    statusText.textContent = 'Unsaved changes';
  } else {
    status.classList.add('saved');
    statusText.textContent = 'All changes saved';
  }
  return saveContext;
}

/* Use the Checks API, which is the optional least-privilege permission documented
   for this CMS. Never treat the separate `validate` job as deployment state:
   the Pages workflow exposes its own `build`, `deploy`, and `report-build-status` checks. */
let deployTrackVersion = 0;
async function trackDeployStatus(sha, isCurrent=()=>true){
  const trackVersion = ++deployTrackVersion;
  if (!sha || !isCurrent()) return;
  const status = document.getElementById('saveStatus');
  const statusText = document.getElementById('saveStatusText');
  if (!status) return;

  status.classList.remove('saved', 'deploy-failed', 'deploy-warning');
  status.classList.add('deploying');
  statusText.textContent = 'Checking Pages deployment…';

  const deadline = Date.now() + 120000;
  let trackedSha = sha;
  let followedNewerCommit = false;
  let observedPageChecks = [];
  let observedValidationCheck = null;

  const newestFirst = (a, b) =>
    Date.parse(b.started_at || b.completed_at || 0) - Date.parse(a.started_at || a.completed_at || 0);
  const setValidationWarning = check => {
    status.classList.remove('saved', 'deploying', 'deploy-failed');
    status.classList.add('deploy-warning');
    const phrase = followedNewerCommit
      ? 'Latest changes are live on site — validation failed — '
      : 'Live on site — validation failed — ';
    statusText.innerHTML = phrase + '<a href="' + attr(check.details_url || check.html_url || '#') +
      '" target="_blank" rel="noopener noreferrer">view validation details</a>';
  };
  const setDeploymentFailure = check => {
    status.classList.remove('saved', 'deploying', 'deploy-warning');
    status.classList.add('deploy-failed');
    statusText.innerHTML = 'Deploy failed — <a href="' + attr(check.details_url || check.html_url || '#') +
      '" target="_blank" rel="noopener noreferrer">view deployment details</a>';
  };
  const isHardFailure = check =>
    check?.status === 'completed' &&
    !!check.conclusion &&
    !['success', 'neutral', 'skipped', 'cancelled'].includes(check.conclusion);
  const latestNamedCheck = (checks, name) =>
    checks.filter(check => String(check.name || '').toLowerCase() === name)
      .sort(newestFirst)[0] || null;

  while (Date.now() < deadline && trackVersion === deployTrackVersion && isCurrent()) {
    let branchHead = null;
    try { branchHead = await GH.getBranchHead(); } catch (_) {}
    if (branchHead && branchHead !== trackedSha) {
      trackedSha = branchHead;
      if (trackedSha !== sha) followedNewerCommit = true;
    }

    let checks = [];
    try { checks = await GH.getCheckRuns(trackedSha); } catch (_) {}
    if (trackVersion !== deployTrackVersion || !isCurrent()) return;

    const buildCheck = latestNamedCheck(checks, 'build');
    const deployCheck = latestNamedCheck(checks, 'deploy');
    const reportCheck = latestNamedCheck(checks, 'report-build-status');
    observedValidationCheck = latestNamedCheck(checks, 'validate');
    observedPageChecks = [buildCheck, deployCheck, reportCheck].filter(Boolean);

    // Only Pages build/deploy failures can be reported as deployment failures.
    const failedPageCheck = [buildCheck, deployCheck].find(isHardFailure);
    if (failedPageCheck) {
      setDeploymentFailure(failedPageCheck);
      return;
    }

    const pagesSucceeded =
      buildCheck?.status === 'completed' && buildCheck.conclusion === 'success' &&
      deployCheck?.status === 'completed' && deployCheck.conclusion === 'success';

    if (pagesSucceeded) {
      if (observedValidationCheck?.status === 'completed' &&
          observedValidationCheck.conclusion &&
          observedValidationCheck.conclusion !== 'success') {
        setValidationWarning(observedValidationCheck);
        return;
      }
      if (observedValidationCheck && observedValidationCheck.status !== 'completed') {
        status.classList.remove('saved', 'deploy-failed', 'deploy-warning');
        status.classList.add('deploying');
        statusText.textContent = 'Site is live — checking validation…';
        await new Promise(resolve => setTimeout(resolve, 4000));
        continue;
      }
      status.classList.remove('deploying', 'deploy-failed', 'deploy-warning');
      status.classList.add('saved');
      statusText.textContent = followedNewerCommit ? 'Latest changes live on site' : 'Live on site';
      return;
    }

    const cancelledPageCheck = [buildCheck, deployCheck].find(check =>
      check?.status === 'completed' && check.conclusion === 'cancelled');
    if (cancelledPageCheck) {
      statusText.textContent = 'Deployment superseded or cancelled — checking latest commit…';
    }
    await new Promise(resolve => setTimeout(resolve, 4000));
  }

  if (trackVersion !== deployTrackVersion || !isCurrent()) return;

  const buildCheck = latestNamedCheck(observedPageChecks, 'build');
  const deployCheck = latestNamedCheck(observedPageChecks, 'deploy');
  const pagesSucceeded =
    buildCheck?.status === 'completed' && buildCheck.conclusion === 'success' &&
    deployCheck?.status === 'completed' && deployCheck.conclusion === 'success';

  if (pagesSucceeded) {
    if (observedValidationCheck?.status === 'completed' &&
        observedValidationCheck.conclusion &&
        observedValidationCheck.conclusion !== 'success') {
      setValidationWarning(observedValidationCheck);
      return;
    }
    status.classList.remove('deploying', 'deploy-failed');
    status.classList.add('saved');
    if (observedValidationCheck && observedValidationCheck.status !== 'completed') {
      status.classList.add('deploy-warning');
      statusText.innerHTML = 'Live on site — validation is still running — <a href="' +
        attr(observedValidationCheck.details_url || observedValidationCheck.html_url || '#') +
        '" target="_blank" rel="noopener noreferrer">view validation status</a>';
    } else {
      statusText.textContent = followedNewerCommit ? 'Latest changes live on site' : 'Live on site';
    }
    return;
  }

  status.classList.remove('deploying', 'saved', 'deploy-warning', 'deploy-failed');
  const cancelledPageCheck = [buildCheck, deployCheck].find(check =>
    check?.status === 'completed' && check.conclusion === 'cancelled');
  if (cancelledPageCheck) {
    statusText.innerHTML = 'Deployment cancelled — <a href="' +
      attr(cancelledPageCheck.details_url || cancelledPageCheck.html_url || '#') +
      '" target="_blank" rel="noopener noreferrer">view deployment details</a>';
  } else if (observedPageChecks.some(check => check.status !== 'completed')) {
    const pendingCheck = observedPageChecks.find(check => check.status !== 'completed');
    statusText.innerHTML = 'Deployment still running — <a href="' +
      attr(pendingCheck.details_url || pendingCheck.html_url || '#') +
      '" target="_blank" rel="noopener noreferrer">view deployment status</a>';
  } else if (observedValidationCheck?.status === 'completed' &&
             observedValidationCheck.conclusion &&
             observedValidationCheck.conclusion !== 'success') {
    status.classList.add('deploy-warning');
    statusText.innerHTML = 'Commit saved — Pages deployment not detected; validation failed — <a href="' +
      attr(observedValidationCheck.details_url || observedValidationCheck.html_url || '#') +
      '" target="_blank" rel="noopener noreferrer">view validation details</a>';
  } else {
    const actionsUrl = 'https://github.com/' + encodeURIComponent(conn.owner) + '/' +
      encodeURIComponent(conn.repo) + '/actions';
    statusText.innerHTML = 'Committed — Pages deployment not found yet — <a href="' + attr(actionsUrl) +
      '" target="_blank" rel="noopener noreferrer">check Actions</a>';
  }
}

document.getElementById('btnSaveTop').addEventListener('click', async () => {
  if (!currentSave) return;
  const saveContext = currentSave;
  const saveStartedVersion = renderVersion;
  const { onCollect, name, filePath } = saveContext;
  const editRevisionAtStart=Object.fromEntries(Object.keys(SECTIONS).map(key=>[key,getEditRevision(key)]));
  const btn = document.getElementById('btnSaveTop');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i>&nbsp; <span>Saving…</span>';
  let obj;
  try{ obj = await onCollect(); }
  catch(err){
    if(renderVersion === saveStartedVersion && currentSave === saveContext){
      btn.disabled = false;
      btn.innerHTML = orig;
    }
    toast(err.message, true);
    return;
  }
  try{
    let commitSha;
    if(saveContext.combined==='filtersWithProjects' && name==='filters'){
      commitSha=await saveSectionsAtomic([
        {name:'filters',path:SECTIONS.filters.file,content:JSON.stringify(obj,null,2)+'\n',encoding:'utf-8'},
        {name:'projects',path:SECTIONS.projects.file,content:JSON.stringify(saveContext.extraData(),null,2)+'\n',encoding:'utf-8'}
      ],'CMS: delete filter and clear project tags',editRevisionAtStart);
      toast(`Saved — filter/attribute changes and project cleanup committed to ${conn.branch}.`);
    }else if(saveContext.combined && name==='heroLoop'){
      const sr=await loadSection('settings');
      const next={...(sr.json||{}),heroTiming:{...(sr.json?.heroTiming||{}),loopMode:obj.mode,transitionStyle:obj.transition,crossfadeMs:obj.interval}};
      commitSha=await saveSectionsAtomic([
        {name:'heroLoop',path:SECTIONS.heroLoop.file,content:JSON.stringify(obj.items||[],null,2)+'\n',encoding:'utf-8'},
        {name:'settings',path:SECTIONS.settings.file,content:JSON.stringify(next,null,2)+'\n',encoding:'utf-8'}
      ],'CMS: update hero loop and transition settings',editRevisionAtStart);
      toast(`Saved — hero loop and transition settings committed to ${conn.branch}.`);
    }else{
      commitSha=await saveSection(name,obj,`CMS: update ${filePath}`,editRevisionAtStart);
      toast(`Saved — ${filePath} committed to ${conn.branch}.`);
    }
    // The commit belongs to the section that initiated this save. Do not
    // update the status bar or begin deployment polling on a different
    // section the user navigated to while the GitHub request was in flight.
    if(renderVersion===saveStartedVersion&&currentSave===saveContext){
      btn.disabled=false;
      btn.innerHTML=orig;
      const newerEditsRemain=Object.keys(editRevisionAtStart).some(key=>getEditRevision(key)!==(editRevisionAtStart[key]||0));
      if(newerEditsRemain){
        const status=document.getElementById('saveStatus');
        const statusText=document.getElementById('saveStatusText');
        status?.classList.remove('saved','deploying','deploy-failed');
        if(statusText)statusText.textContent='Saved snapshot; newer edits remain unsaved';
      }else{
        trackDeployStatus(commitSha,()=>renderVersion===saveStartedVersion&&currentSave===saveContext);
      }
    }
  }catch(err){
    toast(err.message, true);
    if(renderVersion === saveStartedVersion && currentSave === saveContext){
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }
});

function flagUnsaved(){
  markDirty();
  const status = document.getElementById('saveStatus');
  const statusText = document.getElementById('saveStatusText');
  status.classList.remove('saved');
  statusText.textContent = 'Unsaved changes';
}

/* =====================================================================
   7. SECTION: HERO MESSAGES
   ===================================================================== */
const RENDERERS = {};

RENDERERS.hero = function(data){
  let items = withUids((data.json || []).map(x => ({ label:x.label||'', text:x.text||'', author:x.author||'', source:x.source||'', weight: (x.weight===undefined||x.weight===null)?1:x.weight })));
  const MAX = 180;
  let openUid = null;

  function paint(){
    content.innerHTML = sectionHead(
      'Hero Messages',
      'Rotates at random on every homepage load. Leave any field but the statement blank and that line simply won\'t render. Drag the handle to reorder, or click a card to expand it.'
    ) + `
      <div class="banner info"><i class="fa-solid fa-dice"></i><div>
        <strong>Rarity / weight</strong> — the number next to each message controls how often it's picked.
        1 is normal odds. Set one to 3 to make it show up 3× as often, or 0.2 to make it a rare easter egg.
      </div></div>
      <div id="heroList"></div>
      <button class="add-btn" id="addHero"><i class="fa-solid fa-plus"></i> Add message</button>
    `;
    const list = document.getElementById('heroList');
    if(!items.length){
      list.innerHTML = `<div class="banner muted">No hero messages yet — add one below.</div>`;
    }
    items.forEach((item) => {
      const over = item.text.length > MAX;
      const isOpen = item._uid === openUid;
      const card = document.createElement('div');
      card.className = 'card-item';
      card.dataset.uid = item._uid;
      const preview = (item.label ? item.label + ' — ' : '') + (item.text || '(empty)');
      card.innerHTML = `
        <div class="card-item-head collapsible-head" data-toggle-open>
          <span class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></span>
          <span class="preview-line">${esc(preview)}</span>
          <div class="card-item-actions">
            <button class="icon-btn" data-act="up" title="Move up"><i class="fa-solid fa-arrow-up"></i></button>
            <button class="icon-btn" data-act="down" title="Move down"><i class="fa-solid fa-arrow-down"></i></button>
            <button class="icon-btn" data-act="dup" title="Duplicate"><i class="fa-solid fa-copy"></i></button>
            <button class="icon-btn" data-act="del" title="Delete" style="color:#e0584f"><i class="fa-solid fa-trash"></i></button>
            <button class="icon-btn" data-act="toggle"><i class="fa-solid fa-chevron-${isOpen?'up':'down'}"></i></button>
          </div>
        </div>
        <div class="collapsible-body" style="display:${isOpen?'block':'none'};margin-top:16px;" data-body></div>
      `;
      if (isOpen) buildHeroBody(card.querySelector('[data-body]'), item, over);

      card.querySelector('[data-toggle-open]').addEventListener('click', (e)=>{
        if(e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act !== 'toggle') return;
        openUid = isOpen ? null : item._uid; paint();
      });
      card.querySelector('[data-act="del"]').addEventListener('click', (e)=>{
        e.stopPropagation();
        if(!confirm('Delete this message?')) return;
        items = items.filter(x => x._uid !== item._uid); flagUnsaved(); paint();
      });
      card.querySelector('[data-act="dup"]').addEventListener('click', (e)=>{
        e.stopPropagation();
        const i = items.indexOf(item);
        items.splice(i+1,0,{...item, _uid: uid()}); flagUnsaved(); paint();
      });
      card.querySelector('[data-act="up"]').addEventListener('click', (e)=>{
        e.stopPropagation();
        const i = items.indexOf(item);
        if(i===0) return;
        animateReorder(() => document.getElementById('heroList'), () => { [items[i-1],items[i]]=[items[i],items[i-1]]; flagUnsaved(); paint(); });
      });
      card.querySelector('[data-act="down"]').addEventListener('click', (e)=>{
        e.stopPropagation();
        const i = items.indexOf(item);
        if(i===items.length-1) return;
        animateReorder(() => document.getElementById('heroList'), () => { [items[i+1],items[i]]=[items[i],items[i+1]]; flagUnsaved(); paint(); });
      });
      list.appendChild(card);
    });
    document.getElementById('addHero').addEventListener('click', ()=>{
      items.push({label:'',text:'',author:'',source:'',weight:1,_uid:uid()});
      openUid = items[items.length-1]._uid;
      flagUnsaved(); paint();
    });
    enableDragReorder(() => document.getElementById('heroList'), items, flagUnsaved, paint);
    wireSave(()=> items.map(x=>({label:x.label,text:x.text,author:x.author,source:x.source,weight:x.weight})), 'hero', SECTIONS.hero.file);
  }

  function buildHeroBody(el, item, over){
    el.innerHTML = `
      <div class="row">
        <div class="field"><label class="field-label">Label <span style="opacity:.5">(optional)</span></label><input data-f="label" value="${attr(item.label)}" placeholder="e.g. On design"></div>
        <div class="field" style="max-width:130px"><label class="field-label">Weight</label><input data-f="weight" type="number" min="0" step="0.1" value="${item.weight}"></div>
      </div>
      <div class="field">
        <label class="field-label">Statement</label>
        <textarea data-f="text" rows="3" placeholder="The statement itself…">${esc(item.text)}</textarea>
        <div class="charcount ${over?'over':''}" data-cc>${item.text.length} / ${MAX}${over?' — over the limit, will be trimmed on the site':''}</div>
      </div>
      <div class="row">
        <div class="field"><label class="field-label">Author <span style="opacity:.5">(optional)</span></label><input data-f="author" value="${attr(item.author)}" placeholder="e.g. Donald A. Norman"></div>
        <div class="field"><label class="field-label">Source <span style="opacity:.5">(optional)</span></label><input data-f="source" value="${attr(item.source)}" placeholder="e.g. The Design of Everyday Things"></div>
      </div>
    `;
    // No local MAX here — this function already sees the outer MAX
    // declared in paint() above, via normal closure scoping. A
    // duplicate `const MAX = 180` used to sit right here, AFTER the
    // template above already used it. Because it's a const, that
    // redeclaration governed the whole function from the top, not
    // just from its own line down — so the reference above was
    // reaching for a MAX that technically didn't exist yet ("temporal
    // dead zone"), which is exactly the crash in your screenshot. This
    // is why editing, moving, or adding a hero message made the field
    // panel throw instead of rendering.
    el.querySelectorAll('[data-f]').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        const f = inp.dataset.f;
        item[f] = f==='weight' ? (parseFloat(inp.value)||0) : inp.value;
        if(f==='text'){
          const cc = el.querySelector('[data-cc]');
          const len = inp.value.length;
          cc.textContent = `${len} / ${MAX}${len>MAX?' — over the limit, will be trimmed on the site':''}`;
          cc.classList.toggle('over', len>MAX);
          const preview = el.closest('.card-item').querySelector('.preview-line');
          if (preview) preview.textContent = (item.label ? item.label + ' — ' : '') + (item.text || '(empty)');
        }
        if(f==='label'){
          const preview = el.closest('.card-item').querySelector('.preview-line');
          if (preview) preview.textContent = (item.label ? item.label + ' — ' : '') + (item.text || '(empty)');
        }
        flagUnsaved();
      });
    });
  }

  paint();
};

/* =====================================================================
   8. SECTION: HERO LOOP ANIMATION
   ===================================================================== */
RENDERERS.footerLoop=async function(data, isCurrent=()=>true){
  const raw = data?.json && typeof data.json === 'object' && !Array.isArray(data.json) ? data.json : {};
  let mode = raw.mode === 'manual' ? 'manual' : 'hero';
  let manual = {
    type: ['image','video','lottie'].includes(raw.manual?.type) ? raw.manual.type : 'image',
    src: String(raw.manual?.src || ''),
    alt: String(raw.manual?.alt || 'Footer animation'),
    focus: String(raw.manual?.focus || '50% 50%'),
    zoom: Number.isFinite(Number(raw.manual?.zoom)) ? Number(raw.manual.zoom) : 1,
    rotate: Number.isFinite(Number(raw.manual?.rotate)) ? Number(raw.manual.rotate) : 0
  };

  content.innerHTML = sectionHead(
    'Footer Animation',
    'Give the footer its own visual breathing room. By default it inherits the Hero Loop source and timing; switch to Manual to use one selected image, video, or Lottie animation.'
  ) + `
    <div class="panel">
      <div class="row">
        <div class="field">
          <label class="field-label">Source mode</label>
          <select id="fl_mode">
            <option value="hero" ${mode==='hero'?'selected':''}>Use Hero settings</option>
            <option value="manual" ${mode==='manual'?'selected':''}>Use one selected media</option>
          </select>
        </div>
      </div>
      <div class="banner info" id="fl_help"></div>
    </div>
    <div class="panel" id="fl_manual_panel" style="display:${mode==='manual'?'block':'none'};">
      <h3>Selected footer media</h3>
      <p class="panel-sub">Only one source is used here. Image and Lottie stay visually quiet; video is muted, inline, and loops.</p>
      <div class="row">
        <div class="field" style="max-width:180px">
          <label class="field-label">Media type</label>
          <select id="fl_type">
            <option value="image" ${manual.type==='image'?'selected':''}>Image</option>
            <option value="video" ${manual.type==='video'?'selected':''}>Video</option>
            <option value="lottie" ${manual.type==='lottie'?'selected':''}>Lottie</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label">Source path or URL</label>
          <input id="fl_src" value="${attr(manual.src)}" placeholder="assets/projects/your-folder/footer.jpg / .mp4 / .json">
        </div>
      </div>
      <div class="row">
        <div class="field"><label class="field-label">Focus (x% y%)</label><input id="fl_focus" value="${attr(manual.focus)}" placeholder="50% 50%"></div>
        <div class="field"><label class="field-label">Zoom</label><input id="fl_zoom" type="number" step="0.05" value="${manual.zoom}"></div>
        <div class="field"><label class="field-label">Rotation</label><input id="fl_rotate" type="number" step="1" value="${manual.rotate}"></div>
      </div>
      <div id="fl_preview"></div>
    </div>
  `;

  const help = content.querySelector('#fl_help');
  const manualPanel = content.querySelector('#fl_manual_panel');
  const modeEl = content.querySelector('#fl_mode');
  const typeEl = content.querySelector('#fl_type');
  const srcEl = content.querySelector('#fl_src');
  const focusEl = content.querySelector('#fl_focus');
  const zoomEl = content.querySelector('#fl_zoom');
  const rotateEl = content.querySelector('#fl_rotate');
  const preview = content.querySelector('#fl_preview');

  function paintHelp(){
    help.innerHTML = mode === 'hero'
      ? '<i class="fa-solid fa-link"></i><div><strong>Linked to Hero.</strong> Footer artwork follows the Hero Loop source mode and transition timing in the Hero Loop Animation tab and Settings.</div>'
      : '<i class="fa-solid fa-hand-pointer"></i><div><strong>Manual footer source.</strong> The footer ignores Hero artwork selection and renders only the media configured below.</div>';
    manualPanel.style.display = mode === 'manual' ? 'block' : 'none';
  }

  function refreshPreview(){
    if(mode !== 'manual'){
      preview.innerHTML = '<div class="banner muted"><i class="fa-solid fa-eye"></i><div>The live footer is currently inheriting Hero settings.</div></div>';
      return;
    }
    const source = manual.src ? ghRawUrl(manual.src) : '';
    if(!source){
      preview.innerHTML = '<div class="banner muted">Choose a source to preview the footer media.</div>';
      return;
    }
    if(manual.type === 'video'){
      preview.innerHTML = `<div class="media-preview"><video src="${attr(source)}" muted autoplay loop playsinline controls></video></div>`;
    }else if(manual.type === 'lottie'){
      preview.innerHTML = `<div class="media-preview"><lottie-player src="${attr(source)}" autoplay loop background="transparent" style="width:100%;height:100%;"></lottie-player></div>`;
    }else{
      preview.innerHTML = `<div class="media-preview"><img src="${attr(source)}" alt="${attr(manual.alt)}" onerror="handleMissingFile(this,'image')"></div>`;
    }
  }

  modeEl.addEventListener('change', ()=>{
    mode = modeEl.value === 'manual' ? 'manual' : 'hero';
    paintHelp(); refreshPreview(); flagUnsaved();
  });
  typeEl.addEventListener('change', ()=>{
    manual.type = typeEl.value;
    refreshPreview(); flagUnsaved();
  });
  srcEl.addEventListener('input', ()=>{
    manual.src = srcEl.value; refreshPreview(); flagUnsaved();
  });
  focusEl.addEventListener('input', ()=>{ manual.focus = focusEl.value; flagUnsaved(); });
  zoomEl.addEventListener('input', ()=>{ manual.zoom = parseFloat(zoomEl.value)||1; flagUnsaved(); });
  rotateEl.addEventListener('input', ()=>{ manual.rotate = parseFloat(rotateEl.value)||0; flagUnsaved(); });

  attachMediaBrowseButton(srcEl, () => refreshPreview(), () => ({
    kind: manual.type === 'lottie' ? 'lottie' : manual.type === 'video' ? 'video' : 'image',
    title: manual.type === 'lottie' ? 'Choose a Lottie JSON file' : manual.type === 'video' ? 'Choose a footer video' : 'Choose a footer image'
  }));

  paintHelp();
  refreshPreview();
  wireSave(()=>{
    if(mode === 'manual'){
      manual.src = validateCmsMediaSource(manual.type, manual.src, 'Manual footer media');
      if(!Number.isFinite(Number(manual.zoom)) || Number(manual.zoom) < 0.5){
        throw new Error('Manual footer media: Zoom must be a finite number of at least 0.5.');
      }
      if(!Number.isFinite(Number(manual.rotate))){
        throw new Error('Manual footer media: Rotation must be a finite number.');
      }
    }
    return { mode, manual };
  }, 'footerLoop', SECTIONS.footerLoop.file);
};

RENDERERS.heroLoop=async function(data, isCurrent=()=>true){
  let settingsResult; try{ settingsResult=await loadSection('settings'); }catch(e){ settingsResult={json:{}}; }
  if(!isCurrent()) return;
  const timing=(settingsResult.json||{}).heroTiming||{};
  let mode=['latest','manual','mixed'].includes(timing.loopMode)?timing.loopMode:'latest';
  let transition=['kenburns','fade','none'].includes(timing.transitionStyle)?timing.transitionStyle:'kenburns';
  let interval=Number(timing.crossfadeMs)||3500;
  let intervalUnit='s';
  const fadeUnits=new Map();
  let items=withUids((Array.isArray(data.json)?data.json:[]).map(x=>({type:x.type||'image',src:x.src||'',alt:x.alt||'',focus:x.focus||'50% 50%',zoom:x.zoom||1,rotate:x.rotate||0,fadeInMs:Number.isFinite(Number(x.fadeInMs))?Math.max(0,Number(x.fadeInMs)):1500,fadeOutMs:Number.isFinite(Number(x.fadeOutMs))?Math.max(0,Number(x.fadeOutMs)):1500,zoomTransition:typeof x.zoomTransition==='boolean'?x.zoomTransition:transition==='kenburns',fadeTransition:typeof x.fadeTransition==='boolean'?x.fadeTransition:transition!=='none'})));
  let openUid=items[0]?items[0]._uid:null;
  function paint(){
    content.innerHTML=sectionHead('Hero Loop Animation','Choose automatic latest-project looping or a manual list. Manual entries support image, video, Lottie JSON, zoom, focus and rotation.')+`<div class="panel"><div class="row"><div class="field"><label class="field-label">Loop source</label><select id="hl_mode"><option value="latest" ${mode==='latest'?'selected':''}>Latest projects (up to 5)</option><option value="manual" ${mode==='manual'?'selected':''}>Only what I add</option><option value="mixed" ${mode==='mixed'?'selected':''}>My additions + latest fill (up to 5)</option></select></div><div class="field"><label class="field-label">Transition</label><select id="hl_transition"><option value="kenburns" ${transition==='kenburns'?'selected':''}>Zoom + fade</option><option value="fade" ${transition==='fade'?'selected':''}>Fade only</option><option value="none" ${transition==='none'?'selected':''}>None</option></select></div><div class="field"><label class="field-label">Slide interval</label><div class="time-field"><input id="hl_interval" type="number" min="${intervalUnit==='s'?0.5:500}" step="${intervalUnit==='s'?0.1:100}" value="${formatTimedValue(interval,intervalUnit)}"><select id="hl_interval_unit" aria-label="Slide interval unit"><option value="s" ${intervalUnit==='s'?'selected':''}>seconds</option><option value="ms" ${intervalUnit==='ms'?'selected':''}>milliseconds</option></select></div></div></div><div class="banner info"><i class="fa-solid fa-circle-info"></i><div><strong>Loop source</strong> controls what supplies the hero: <strong>Latest projects</strong> uses the newest project order (up to 5); <strong>Only what I add</strong> uses only this list; <strong>My additions + latest fill</strong> puts your manual entries first, then fills the remaining slots with newest projects until there are 5.</div></div></div><div id="heroLoopItems"></div><button class="add-btn" id="hl_add"><i class="fa-solid fa-plus"></i> Add hero artwork</button>`;
    const list=document.getElementById('heroLoopItems');
    if(mode==='latest') list.innerHTML='<div class="banner muted">Manual entries are stored but ignored while Latest projects is selected.</div>';
    items.forEach(item=>{
      const open=item._uid===openUid,row=document.createElement('div');row.className='card-item';row.dataset.uid=item._uid;
      row.innerHTML=`<div class="card-item-head collapsible-head" data-open><span class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></span><span class="preview-line">${esc(item.alt||item.src||'(empty)')}</span><div class="card-item-actions"><button class="icon-btn" data-a="up"><i class="fa-solid fa-arrow-up"></i></button><button class="icon-btn" data-a="down"><i class="fa-solid fa-arrow-down"></i></button><button class="icon-btn" data-a="del" style="color:#e0584f"><i class="fa-solid fa-trash"></i></button><button class="icon-btn" data-a="toggle"><i class="fa-solid fa-chevron-${open?'up':'down'}"></i></button></div></div><div class="collapsible-body" style="display:${open?'block':'none'};margin-top:16px" data-body></div>`;
      if(open){
        const body=row.querySelector('[data-body]');
        body.innerHTML=`<div class="row"><div class="field" style="max-width:180px"><label class="field-label">Type</label><select data-f="type"><option value="image" ${item.type==='image'?'selected':''}>Image</option><option value="video" ${item.type==='video'?'selected':''}>Video</option><option value="lottie" ${item.type==='lottie'?'selected':''}>Lottie (JSON)</option></select></div><div class="field"><label class="field-label">Source path or URL</label><input data-f="src" value="${attr(item.src)}"></div></div><div class="row"><div class="field"><label class="field-label">Alt / label</label><input data-f="alt" value="${attr(item.alt)}"></div><div class="field"><label class="field-label">Zoom</label><input data-f="zoom" type="number" min="0.5" step="0.05" value="${item.zoom}"></div></div><div class="row"><div class="field"><label class="field-label">Fade in</label><div class="time-field"><input data-time-f="fadeInMs" type="number" min="0" step="${(fadeUnits.get(item._uid)?.in||'s')==='s'?0.1:100}" value="${formatTimedValue(item.fadeInMs,fadeUnits.get(item._uid)?.in||'s')}"><select data-time-unit="fadeInMs" aria-label="Fade in unit"><option value="s" ${(fadeUnits.get(item._uid)?.in||'s')==='s'?'selected':''}>seconds</option><option value="ms" ${(fadeUnits.get(item._uid)?.in||'s')==='ms'?'selected':''}>milliseconds</option></select></div></div><div class="field"><label class="field-label">Fade out</label><div class="time-field"><input data-time-f="fadeOutMs" type="number" min="0" step="${(fadeUnits.get(item._uid)?.out||'s')==='s'?0.1:100}" value="${formatTimedValue(item.fadeOutMs,fadeUnits.get(item._uid)?.out||'s')}"><select data-time-unit="fadeOutMs" aria-label="Fade out unit"><option value="s" ${(fadeUnits.get(item._uid)?.out||'s')==='s'?'selected':''}>seconds</option><option value="ms" ${(fadeUnits.get(item._uid)?.out||'s')==='ms'?'selected':''}>milliseconds</option></select></div></div></div><div class="row"><div class="field"><label class="field-label">Focus (x% y%)</label><input data-f="focus" value="${attr(item.focus)}"></div><div class="field"><label class="field-label">Rotate (deg)</label><input data-f="rotate" type="number" step="1" value="${item.rotate}"></div></div><div class="row"><div class="field"><label class="field-label">Artwork transitions</label><label class="check-row"><input type="checkbox" data-toggle="zoomTransition" ${item.zoomTransition?'checked':''}> Enable zoom motion</label><label class="check-row"><input type="checkbox" data-toggle="fadeTransition" ${item.fadeTransition?'checked':''}> Enable fade in/out</label></div></div><div class="field"><label class="field-label">Focus picker</label><div class="focus-picker" data-picker><div data-preview style="position:absolute;inset:0"></div><div class="focus-crosshair" data-crosshair></div></div></div>`;
        const picker=body.querySelector('[data-picker]'),cross=body.querySelector('[data-crosshair]'),preview=body.querySelector('[data-preview]');
        const setCross=()=>{const q=(item.focus||'50% 50%').split(' ').map(v=>parseFloat(v)||50);cross.style.left=q[0]+'%';cross.style.top=q[1]+'%';};
        function refreshHeroPreview(){
          preview.innerHTML=''; if(!item.src) return;
          let media;
          if(item.type==='video'){media=document.createElement('video');media.src=ghRawUrl(item.src);media.muted=true;media.loop=true;media.autoplay=true;media.playsInline=true;}
          else if(item.type==='lottie'){media=document.createElement('lottie-player');media.setAttribute('src',ghRawUrl(item.src));media.setAttribute('autoplay','');media.setAttribute('loop','');media.setAttribute('background','transparent');}
          else {media=document.createElement('img');media.src=ghRawUrl(item.src);}
          media.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;opacity:.55;';
          const focus=item.focus||'50% 50%';media.style.objectPosition=focus;media.style.transformOrigin=focus;media.style.transform=`scale(${item.zoom||1}) rotate(${item.rotate||0}deg)`;preview.appendChild(media);
        }
        setCross();refreshHeroPreview();
        attachMediaBrowseButton(body.querySelector('[data-f="src"]'), () => refreshHeroPreview(), () => ({
          kind: item.type === 'lottie' ? 'lottie' : item.type === 'video' ? 'video' : 'image',
          title: item.type === 'lottie' ? 'Choose a Lottie JSON file' : item.type === 'video' ? 'Choose a video file' : 'Choose an image file'
        }));
        let dragging=false;
        const pointer=e=>{
          const r=picker.getBoundingClientRect();
          const x=Math.max(0,Math.min(100,((e.clientX-r.left)/r.width)*100));
          const y=Math.max(0,Math.min(100,((e.clientY-r.top)/r.height)*100));
          item.focus=`${x.toFixed(0)}% ${y.toFixed(0)}%`;
          body.querySelector('[data-f="focus"]').value=item.focus;
          setCross();
          refreshHeroPreview();
          flagUnsaved();
        };
        picker.style.touchAction='none';
        picker.addEventListener('pointerdown',e=>{
          if(e.pointerType==='mouse' && e.button!==0) return;
          dragging=true;
          picker.setPointerCapture?.(e.pointerId);
          pointer(e);
        });
        picker.addEventListener('pointermove',e=>{
          if(dragging) {
            e.preventDefault();
            pointer(e);
          }
        });
        const finishPointer=()=>{
          dragging=false;
        };
        picker.addEventListener('pointerup',e=>{
          finishPointer();
          try { picker.releasePointerCapture?.(e.pointerId); } catch (_) {}
        });
        picker.addEventListener('pointercancel',finishPointer);
        body.querySelectorAll('[data-f]').forEach(inp=>inp.addEventListener('input',()=>{const f=inp.dataset.f;item[f]=(f==='zoom'||f==='rotate')?(parseFloat(inp.value)||0):inp.value;row.querySelector('.preview-line').textContent=item.alt||item.src||'(empty)';if(f==='focus')setCross();refreshHeroPreview();flagUnsaved();}));
        body.querySelectorAll('[data-toggle]').forEach(inp=>inp.addEventListener('change',()=>{item[inp.dataset.toggle]=inp.checked;flagUnsaved();}));
        body.querySelectorAll('[data-time-f]').forEach(inp=>inp.addEventListener('input',()=>{const f=inp.dataset.timeF;const unit=body.querySelector(`[data-time-unit="${f}"]`)?.value||'s';item[f]=Math.max(0,toMs(inp.value,unit));flagUnsaved();}));
        body.querySelectorAll('[data-time-unit]').forEach(sel=>sel.addEventListener('change',()=>{const f=sel.dataset.timeUnit;const unit=sel.value;const units={...(fadeUnits.get(item._uid)||{})};units[f==='fadeInMs'?'in':'out']=unit;fadeUnits.set(item._uid,units);const field=body.querySelector(`[data-time-f="${f}"]`);if(field)field.value=formatTimedValue(item[f],unit);flagUnsaved();}));
      }
      row.querySelector('[data-open]').addEventListener('click',e=>{if(e.target.closest('[data-a]')&&e.target.closest('[data-a]').dataset.a!=='toggle')return;openUid=open?null:item._uid;paint();});
      row.querySelector('[data-a=del]').addEventListener('click',e=>{e.stopPropagation();items=items.filter(x=>x._uid!==item._uid);flagUnsaved();paint();});
      row.querySelector('[data-a=up]').addEventListener('click',e=>{e.stopPropagation();const i=items.indexOf(item);if(i>0){[items[i-1],items[i]]=[items[i],items[i-1]];flagUnsaved();paint();}});
      row.querySelector('[data-a=down]').addEventListener('click',e=>{e.stopPropagation();const i=items.indexOf(item);if(i<items.length-1){[items[i+1],items[i]]=[items[i],items[i+1]];flagUnsaved();paint();}});
      list.appendChild(row);
    });
    document.getElementById('hl_mode').addEventListener('change',e=>{mode=e.target.value;flagUnsaved();paint();});
    document.getElementById('hl_transition').addEventListener('change',e=>{transition=e.target.value;flagUnsaved();});
    document.getElementById('hl_interval').addEventListener('input',e=>{interval=Math.max(500,toMs(e.target.value,intervalUnit)||3500);flagUnsaved();});
    document.getElementById('hl_interval_unit').addEventListener('change',e=>{intervalUnit=e.target.value;const input=document.getElementById('hl_interval');if(input)input.value=formatTimedValue(interval,intervalUnit);flagUnsaved();});
    document.getElementById('hl_add').addEventListener('click',()=>{const x={type:'image',src:'',alt:'',focus:'50% 50%',zoom:1,rotate:0,fadeInMs:1500,fadeOutMs:1500,zoomTransition:transition==='kenburns',fadeTransition:transition!=='none',_uid:uid()};items.push(x);fadeUnits.set(x._uid,{in:'s',out:'s'});openUid=x._uid;mode='manual';flagUnsaved();paint();});
    enableDragReorder(()=>document.getElementById('heroLoopItems'),items,flagUnsaved,paint);
    wireSave(()=>{
      if(mode !== 'latest'){
        if(mode === 'manual' && !items.length){
          throw new Error('Manual Hero Loop mode needs at least one media item.');
        }
        items.forEach((item,index)=>{
          item.src = validateCmsMediaSource(item.type, item.src, `Hero artwork ${index + 1}`);
          if(!Number.isFinite(Number(item.zoom)) || Number(item.zoom) < 0.5){
            throw new Error(`Hero artwork ${index + 1}: Zoom must be a finite number of at least 0.5.`);
          }
          if(!Number.isFinite(Number(item.rotate))){
            throw new Error(`Hero artwork ${index + 1}: Rotation must be a finite number.`);
          }
          for(const key of ['fadeInMs','fadeOutMs']){
            if(!Number.isFinite(Number(item[key])) || Number(item[key]) < 0){
              throw new Error(`Hero artwork ${index + 1}: ${key} must be a finite, non-negative number.`);
            }
          }
        });
      }
      if(!Number.isFinite(Number(interval)) || Number(interval) < 500){
        throw new Error('Hero Loop: Slide interval must be at least 500 milliseconds.');
      }
      return {
        items: items.map(x=>({
          type:x.type,src:x.src,alt:x.alt,focus:x.focus,zoom:x.zoom,rotate:x.rotate,
          fadeInMs:x.fadeInMs,fadeOutMs:x.fadeOutMs,
          zoomTransition:x.zoomTransition,fadeTransition:x.fadeTransition
        })),
        mode,transition,interval
      };
    }, 'heroLoop', SECTIONS.heroLoop.file);
    currentSave.combined=true;
  }
  paint();
};

/* =====================================================================
   8. SECTION: FILTERS & BADGES
   ===================================================================== */
RENDERERS.filters = async function(data, isCurrent=()=>true){
  const raw=data.json||[];
  const filterItems=Array.isArray(raw)?raw:(raw.filters||[]);
  let badgeItems=withUids((Array.isArray(raw)?[]:(raw.badges||[])).map(x=>({
    label: typeof x === 'string' ? x : (x&&x.label)||''
  })));
  let items=withUids(filterItems.map(x=>({id:x.id||'',label:x.label||''})));
  const originalIds=new Map(items.map(item=>[item._uid,item.id]));
  const originalBadgeLabels=new Map(badgeItems.map(item=>[item._uid,String(item.label||'').trim()]));
  const deletedFilterIds=new Set();
  const deletedBadgeLabels=new Set();

  function getFilterRenameMap(){
    const renames=new Map();
    items.forEach(item=>{
      const original=originalIds.get(item._uid);
      if(original && item.id && original!==item.id) renames.set(original,item.id);
    });
    return renames;
  }

  function getBadgeRenameMap(){
    const renames=new Map();
    badgeItems.forEach(item=>{
      const original=originalBadgeLabels.get(item._uid);
      const next=String(item.label||'').trim();
      if(original && next && original!==next) renames.set(original,next);
    });
    return renames;
  }

  function hasProjectFilterImpact(){
    return deletedFilterIds.size > 0
      || deletedBadgeLabels.size > 0
      || getFilterRenameMap().size > 0
      || getBadgeRenameMap().size > 0;
  }

  function cloneProjects(projects){
    try{return structuredClone(projects);}catch(e){return JSON.parse(JSON.stringify(projects));}
  }

  async function buildProjectsAfterFilterChanges(saveContext){
    if(!saveContext) return null;
    if(!hasProjectFilterImpact()){
      delete saveContext.combined;
      delete saveContext.extraData;
      return null;
    }

    const result=await loadSection('projects');
    const source=Array.isArray(result.json)?result.json:[];
    const projects=cloneProjects(source);
    const filterRenames=getFilterRenameMap();
    const badgeRenames=getBadgeRenameMap();
    let changed=0;

    projects.forEach(project=>{
      const filters=Array.isArray(project.filters)?project.filters:[];
      const nextFilters=[];
      filters.forEach(id=>{
        if(deletedFilterIds.has(id)){
          changed++;
          return;
        }
        const mapped=filterRenames.get(id);
        if(mapped && mapped!==id) {
          nextFilters.push(mapped);
          changed++;
          return;
        }
        nextFilters.push(id);
      });
      project.filters=nextFilters;

      const badges=Array.isArray(project.badges)
        ? project.badges
        : (project.badge ? [project.badge] : []);
      const nextBadges=[];
      badges.forEach(label=>{
        const value=String(label||'').trim();
        if(!value) return;
        if(deletedBadgeLabels.has(value)){
          changed++;
          return;
        }
        const mapped=badgeRenames.get(value);
        if(mapped && mapped!==value){
          nextBadges.push(mapped);
          changed++;
          return;
        }
        nextBadges.push(value);
      });
      project.badges=[...new Set(nextBadges)];
      project.badge=project.badges[0]||'';
    });

    saveContext.combined='filtersWithProjects';
    saveContext.extraData=()=>projects;
    saveContext.projectFilterChangeCount=changed;
    saveContext.projectBadgeChangeCount=changed;
    return {projects,changed};
  }

  function isValidFilterId(id){
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
  }

  function paint(){
    content.innerHTML = sectionHead(
      'Filters & Badges',
      'These become the tabs above the project grid, the matching nav-bar dropdown items, and the badge options for each project. Drag the handle to reorder.'
    ) + `
      <div class="banner info"><i class="fa-solid fa-circle-info"></i><div>
        The <strong>ALL</strong> tab always exists automatically and isn't listed here.
        IDs use lowercase letters, numbers, and hyphens. Renaming an existing filter automatically migrates matching project tags when you save; deleting a filter removes its tag from every affected project.
      </div></div>
      <div id="filterList"></div>
      <button class="add-btn" id="addFilter"><i class="fa-solid fa-plus"></i> Add filter tab</button>
      <div class="panel" style="margin-top:18px;background:#141414;"><h3>Project attributes</h3><p class="panel-sub">Optional attributes can be assigned independently of filter tabs. Renaming or deleting an attribute automatically updates matching projects when you save.</p><div class="tagbox" id="badgeList"></div><button class="add-btn" id="addBadge"><i class="fa-solid fa-plus"></i> Add attribute</button></div>
    `;
    const list = document.getElementById('filterList');
    items.forEach((item)=>{
      const row = document.createElement('div');
      row.className = 'card-item';
      row.dataset.uid = item._uid;
      row.innerHTML = `
        <div class="card-item-head">
          <span class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></span>
          <span class="item-title">${esc(item.label) || 'New tab'}</span>
          <div class="card-item-actions">
            <button class="icon-btn" data-act="up"><i class="fa-solid fa-arrow-up"></i></button>
            <button class="icon-btn" data-act="down"><i class="fa-solid fa-arrow-down"></i></button>
            <button class="icon-btn" data-act="del" style="color:#e0584f"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
        <div class="row">
          <div class="field"><label class="field-label">ID</label><input data-f="id" value="${attr(item.id)}" placeholder="e.g. 3d-motion"></div>
          <div class="field"><label class="field-label">Button label</label><input data-f="label" value="${attr(item.label)}" placeholder="e.g. 3D & MOTION"></div>
        </div>
      `;
      row.querySelectorAll('[data-f]').forEach(inp=>{
        inp.addEventListener('input', ()=>{
          item[inp.dataset.f]=inp.value;
          if (inp.dataset.f === 'label') row.querySelector('.item-title').textContent = item.label || 'New tab';
          flagUnsaved();
        });
      });
      row.querySelector('[data-act="del"]').addEventListener('click',async ()=>{
        try{
          const filterId=item.id;
          if(filterId){
            const result=await loadSection('projects');
            const projects=Array.isArray(result.json)?result.json:[];
            const affected=projects.filter(project=>Array.isArray(project.filters)&&project.filters.includes(filterId)).length;
            deletedFilterIds.add(filterId);
            items=items.filter(x=>x._uid!==item._uid);
            flagUnsaved();
            paint();
            toast(affected
              ? `Deleted “${item.label || item.id}”; its tag will be cleared from ${affected} project${affected===1?'':'s'} when saved.`
              : `Deleted “${item.label || item.id}”. No projects were using it.`);
          }else{
            items=items.filter(x=>x._uid!==item._uid);
            flagUnsaved();
            paint();
            toast('Deleted the empty filter.');
          }
        }catch(err){toast('Could not delete filter: '+err.message,true);}
      });
      row.querySelector('[data-act="up"]').addEventListener('click', ()=>{
        const i = items.indexOf(item); if(i===0) return;
        animateReorder(() => document.getElementById('filterList'), () => { [items[i-1],items[i]]=[items[i],items[i-1]]; flagUnsaved(); paint(); });
      });
      row.querySelector('[data-act="down"]').addEventListener('click', ()=>{
        const i = items.indexOf(item); if(i===items.length-1) return;
        animateReorder(() => document.getElementById('filterList'), () => { [items[i+1],items[i]]=[items[i],items[i+1]]; flagUnsaved(); paint(); });
      });
      list.appendChild(row);
    });
    const badgeBox=document.getElementById('badgeList');
    if(badgeBox){
      badgeBox.innerHTML='';
      badgeItems.forEach((item)=>{
        const r=document.createElement('div');
        r.className='tag-pill';
        r.innerHTML=`<input value="${attr(item.label)}" style="flex:1;min-width:120px;padding:4px 0;border:0;background:transparent;"><button type="button">&times;</button>`;
        const inp=r.querySelector('input');
        inp.addEventListener('input',()=>{
          item.label=inp.value;
          flagUnsaved();
        });
        r.querySelector('button').addEventListener('click',async()=>{
          try{
            const original=originalBadgeLabels.get(item._uid);
            const result=await loadSection('projects');
            const projects=Array.isArray(result.json)?result.json:[];
            const affected=original
              ? projects.filter(project=>{
                  const badges=Array.isArray(project.badges)?project.badges:(project.badge?[project.badge]:[]);
                  return badges.some(value=>String(value||'').trim()===original);
                }).length
              : 0;
            if(original) deletedBadgeLabels.add(original);
            badgeItems=badgeItems.filter(x=>x._uid!==item._uid);
            flagUnsaved();
            paint();
            toast(affected
              ? `Deleted “${item.label || original}”; its attribute will be cleared from ${affected} project${affected===1?'':'s'} when saved.`
              : `Deleted “${item.label || original || 'empty attribute'}”. No projects were using it.`);
          }catch(err){
            toast('Could not delete attribute: '+err.message,true);
          }
        });
        badgeBox.appendChild(r);
      });
    }
    document.getElementById('addFilter').addEventListener('click', ()=>{ items.push({id:'',label:'',_uid:uid()}); flagUnsaved(); paint(); });
    document.getElementById('addBadge').addEventListener('click', ()=>{ badgeItems.push('New Badge'); flagUnsaved(); paint(); });
    enableDragReorder(() => document.getElementById('filterList'), items, flagUnsaved, paint);
    let saveContext=null;
    saveContext=wireSave(async()=>{
      const seen=new Set();
      for(const it of items){
        const id=it.id.trim();
        const label=it.label.trim();
        if(!id||!label) throw new Error('Every filter needs both an ID and a label.');
        if(!isValidFilterId(id)) throw new Error(`Filter ID “${id}” is invalid. Use lowercase letters, numbers, and hyphens only (e.g. 3d-motion).`);
        if(seen.has(id)) throw new Error(`Duplicate filter ID “${id}”. Every filter must have a unique ID.`);
        seen.add(id);
      }
      const seenBadges=new Set();
      for(const it of badgeItems){
        const label=String(it.label||'').trim();
        if(!label) continue;
        if(seenBadges.has(label)) throw new Error(`Duplicate project attribute “${label}”. Each attribute must have a unique label.`);
        seenBadges.add(label);
      }
      const payload={filters:items.map(x=>({id:x.id.trim(),label:x.label.trim()})),badges:badgeItems.map(x=>String(x.label||'').trim()).filter(Boolean)};
      await buildProjectsAfterFilterChanges(saveContext);
      return payload;
    }, 'filters', SECTIONS.filters.file);
  }
  paint();
};

/* =====================================================================
   OPEN GRAPH IMAGE — local 1200×630 normalization + versioned publish
   ===================================================================== */
const OG_CANVAS_W = 1200;
const OG_CANVAS_H = 630;

function readFileAsDataUrl(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(reader.error || new Error('Couldn\'t read the selected file.'));
    reader.readAsDataURL(file);
  });
}

function normalizeOgImage(file){
  if(!file || !String(file.type||'').startsWith('image/')){
    return Promise.reject(new Error('Open Graph images must be an image file.'));
  }
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>{
      try{
        const canvas=document.createElement('canvas');
        canvas.width=OG_CANVAS_W; canvas.height=OG_CANVAS_H;
        const ctx=canvas.getContext('2d');
        ctx.fillStyle='#121212'; ctx.fillRect(0,0,OG_CANVAS_W,OG_CANVAS_H);
        const scale=Math.max(OG_CANVAS_W/img.naturalWidth, OG_CANVAS_H/img.naturalHeight);
        const drawW=img.naturalWidth*scale, drawH=img.naturalHeight*scale;
        const dx=(OG_CANVAS_W-drawW)/2, dy=(OG_CANVAS_H-drawH)/2;
        ctx.drawImage(img,dx,dy,drawW,drawH);
        canvas.toBlob(blob=>{
          if(!blob) return reject(new Error('The browser could not create the normalized JPEG.'));
          const reader=new FileReader();
          reader.onload=()=>resolve({blob,dataUrl:reader.result});
          reader.onerror=()=>reject(reader.error || new Error('Couldn\'t encode the normalized JPEG.'));
          reader.readAsDataURL(blob);
        },'image/jpeg',0.9);
      }catch(err){ reject(err); }
      finally{ URL.revokeObjectURL(url); }
    };
    img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('Couldn\'t decode the selected image.')); };
    img.src=url;
  });
}

function metaAttr(value){
  return String(value ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function replaceMetaContent(html, attrName, value, attrKey='property'){
  const re=new RegExp(`(<meta\\s+${attrKey}=["']${attrName}["'][^>]*content=["'])[^"']*(["'][^>]*>)`,'i');
  return html.replace(re,`$1${metaAttr(value)}$2`);
}
function replaceOgMetaTags(html, imageUrl, altText){
  let out=html;
  out=replaceMetaContent(out,'og:image',imageUrl,'property');
  out=replaceMetaContent(out,'og:image:secure_url',imageUrl,'property');
  out=replaceMetaContent(out,'og:image:alt',altText || 'Lemuel Magbitang — 3D & Motion Illustrator portfolio','property');
  out=replaceMetaContent(out,'twitter:image',imageUrl,'name');
  return out;
}

async function publishOgImage(file, localSettings){
  const normalized=await normalizeOgImage(file);
  const rawB64=String(normalized.dataUrl).split(',')[1];
  const serverSettingsResult=await GH.getFile('data/settings.json');
  const serverSettings=serverSettingsResult.json || {};
  let version=Math.max(2,Number(serverSettings.ogImageVersion)||2)+1;
  const tree=await GH.getTree();
  let path=`assets/projects/site/og-image-v${version}.jpg`;
  while(tree.some(item=>item.type==='blob' && item.path===path)){
    version+=1; path=`assets/projects/site/og-image-v${version}.jpg`;
  }

  const alt=String(serverSettings.ogImageAlt || 'Lemuel Magbitang — 3D & Motion Illustrator portfolio');
  const nextSettings={...serverSettings,ogImage:path,ogImageVersion:version,ogImageAlt:alt,ogImageWidth:OG_CANVAS_W,ogImageHeight:OG_CANVAS_H};
  const indexText=await GH.getTextFile('index.html');
  const aboutText=await GH.getTextFile('about/index.html');
  const baseMatch=indexText.text.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']+)["']/i);
  const siteRoot=baseMatch ? new URL('/',baseMatch[1]).href : (window.location.origin + '/');
  const imageUrl=new URL(path + `?v=${version}`,siteRoot).href;
  const nextIndex=replaceOgMetaTags(indexText.text,imageUrl,alt);
  const nextAbout=replaceOgMetaTags(aboutText.text,imageUrl,alt);
  const commit=await GH.commitFiles([
    {path,content:rawB64,encoding:'base64'},
    {path:'data/settings.json',content:JSON.stringify(nextSettings,null,2)+'\n',encoding:'utf-8'},
    {path:'index.html',content:nextIndex,encoding:'utf-8'},
    {path:'about/index.html',content:nextAbout,encoding:'utf-8'}
  ],`CMS: update Open Graph image to v${version}`);
  const fresh=await GH.getFile('data/settings.json');
  cache.settings=fresh;
  if(localSettings){
    localSettings.ogImage=path;
    localSettings.ogImageVersion=version;
    localSettings.ogImageAlt=alt;
    localSettings.ogImageWidth=OG_CANVAS_W;
    localSettings.ogImageHeight=OG_CANVAS_H;
  }
  return {path,version,imageUrl,commitSha:commit.sha};
}

const CMS_SOCIAL_PLATFORMS = [
  { key:'instagram', label:'Instagram', icon:'fa-brands fa-instagram' },
  { key:'tiktok', label:'TikTok', icon:'fa-brands fa-tiktok' },
  { key:'youtube', label:'YouTube', icon:'fa-brands fa-youtube' },
  { key:'behance', label:'Behance', icon:'fa-brands fa-behance' },
  { key:'artstation', label:'ArtStation', icon:'fa-brands fa-artstation' },
  { key:'linkedin', label:'LinkedIn', icon:'fa-brands fa-linkedin-in' },
  { key:'x', label:'X', icon:'fa-brands fa-x-twitter' },
  { key:'facebook', label:'Facebook', icon:'fa-brands fa-facebook-f' },
  { key:'dribbble', label:'Dribbble', icon:'fa-brands fa-dribbble' },
  { key:'vimeo', label:'Vimeo', icon:'fa-brands fa-vimeo-v' }
];

/* =====================================================================
   9. SECTION: SETTINGS & TOGGLES
   ===================================================================== */
RENDERERS.settings = function(data){
  let s = data.json || {};
  s.formsEnabled = s.formsEnabled || {project:true, review:true};
  s.web3forms = s.web3forms || {projectKey:'', reviewKey:''};
  s.socials = s.socials && typeof s.socials === 'object' ? s.socials : {};
  s.heroTiming = s.heroTiming || {fadeMs:600, autoRotateMs:0, crossfadeMs:3500, kenBurnsFromScale:1, kenBurnsToScale:1.15, kenBurnsDurationS:14, loopMode:'latest', transitionStyle:'kenburns'};
  s.showHeroMessage = s.showHeroMessage !== false;
  s.showFooterMessage = s.showFooterMessage === true;
  s.defaultVideoPoster = String(s.defaultVideoPoster || '').trim();
  const feedbackDefaults = {
    enabled: false, soundEnabled: true, hapticsEnabled: false, volume: 0.12,
    navigationSound: 'assets/projects/site/sounds/navigation.wav',
    selectionSound: 'assets/projects/site/sounds/selection.wav'
  };
  s.interactionFeedback = {
    ...feedbackDefaults,
    ...(s.interactionFeedback && typeof s.interactionFeedback === 'object' ? s.interactionFeedback : {})
  };
  s.interactionFeedback.enabled = s.interactionFeedback.enabled === true;
  s.interactionFeedback.soundEnabled = s.interactionFeedback.soundEnabled !== false;
  s.interactionFeedback.hapticsEnabled = s.interactionFeedback.hapticsEnabled === true;
  const feedbackVolume = Number(s.interactionFeedback.volume);
  s.interactionFeedback.volume = Number.isFinite(feedbackVolume)
    ? Math.max(0, Math.min(0.3, feedbackVolume)) : feedbackDefaults.volume;
  s.interactionFeedback.navigationSound = String(s.interactionFeedback.navigationSound || '');
  s.interactionFeedback.selectionSound = String(s.interactionFeedback.selectionSound || '');
  s.ogImage = s.ogImage || 'assets/projects/site/og-image.jpg';
  s.ogImageVersion = Math.max(1, Number(s.ogImageVersion) || 2);
  s.ogImageAlt = s.ogImageAlt || 'Lemuel Magbitang — 3D & Motion Illustrator portfolio';

  content.innerHTML = sectionHead('Settings & Toggles', 'Site-wide switches and the values behind them. Nothing here needs the HTML touched again.') + `

    <div class="panel">
      <h3>Toggles</h3>
      <p class="panel-sub">Flip these on or off — no add/remove, just switches.</p>
      ${toggleRow('protectionEnabled','Right-click / drag-save protection','Disables right-click and drag-to-save on lightbox artwork.', s.protectionEnabled)}
      ${toggleRow('formsEnabled.project','"Start a Project" form','Shows the form when on; shows an Email Me button when off.', s.formsEnabled.project)}
      ${toggleRow('formsEnabled.review','"Leave a Review" form','Shows the form when on; shows an Email Me button when off.', s.formsEnabled.review)}
      ${toggleRow('showReviews','Reviews section','Shows or hides the whole client-reviews strip above the footer.', s.showReviews)}
      ${toggleRow('showSoftwareLogos','Software skill logos','Shows every Software Skill (About page) as its logo instead of its name. One switch for the whole list — set a specific logo per skill from the About page itself.', s.showSoftwareLogos)}
      ${toggleRow('showHeroMessage','Hero message in hero','Show or hide the rotating statement over the homepage hero artwork.', s.showHeroMessage)}
      ${toggleRow('showFooterMessage','Hero message in footer','Show the current hero statement above the footer links. The footer grows naturally with longer messages.', s.showFooterMessage)}
    </div>

    <div class="panel">
      <h3>Hero Video</h3>
      <p class="panel-sub">Optional fallback poster for hero videos while media is loading. A poster set on an individual Hero Loop item takes priority. Leave this empty to show the neutral dark surface until the first video frame is ready; the Open Graph image is never used as a fallback.</p>
      <div class="field">
        <label class="field-label" for="s_default_video_poster">Default video poster (optional)</label>
        <input id="s_default_video_poster" value="${attr(s.defaultVideoPoster)}" placeholder="assets/projects/site/banner/hero-poster.webp" autocomplete="off" spellcheck="false">
      </div>
      <div class="hint">Choose an image from the Media Library or enter an image path under <code class="k">assets/</code>. HTTPS image URLs are also supported.</div>
    </div>

    <div class="panel">
      <h3>Interaction Feedback</h3>
      <p class="panel-sub">Optional, subtle sounds and supported-device haptics. Off on the public site until enabled here; visitors can disable feedback locally.</p>
      ${toggleRow('interactionFeedback.enabled','Enable interface feedback','Master switch. Disabled by default.', s.interactionFeedback.enabled)}
      ${toggleRow('interactionFeedback.soundEnabled','Sound cues','Play brief sounds only after a real click; files are fetched on demand.', s.interactionFeedback.soundEnabled)}
      ${toggleRow('interactionFeedback.hapticsEnabled','Supported-device haptics','Use a short vibration where the browser supports it.', s.interactionFeedback.hapticsEnabled)}
      <div class="field">
        <label class="field-label" for="s_feedback_volume">Sound volume (0–0.30)</label>
        <input id="s_feedback_volume" type="number" min="0" max="0.3" step="0.01" value="${attr(s.interactionFeedback.volume)}">
      </div>
      <div class="row">
        <div class="field">
          <label class="field-label" for="s_feedback_navigation">Navigation cue file</label>
          <input id="s_feedback_navigation" value="${attr(s.interactionFeedback.navigationSound)}" placeholder="assets/projects/site/sounds/navigation.wav">
          <button class="ghost" id="s_feedback_preview_navigation" type="button">Preview navigation cue</button>
        </div>
        <div class="field">
          <label class="field-label" for="s_feedback_selection">Selection cue file</label>
          <input id="s_feedback_selection" value="${attr(s.interactionFeedback.selectionSound)}" placeholder="assets/projects/site/sounds/selection.wav">
          <button class="ghost" id="s_feedback_preview_selection" type="button">Preview selection cue</button>
        </div>
      </div>
      <div class="hint">Use Browse to select an audio file from the Media Library. Upload replacements under assets/ first, then select the saved path. Previews play only when pressed.</div>
    </div>

    <div class="panel">
      <h3>Forms</h3>
      <p class="panel-sub">Web3Forms keys and where a successful submission redirects to.</p>
      <div class="row">
        <div class="field"><label class="field-label">Project form — API key</label><input id="s_pkey" value="${attr(s.web3forms.projectKey)}"></div>
        <div class="field"><label class="field-label">Review form — API key</label><input id="s_rkey" value="${attr(s.web3forms.reviewKey)}"></div>
      </div>
      <div class="field"><label class="field-label">Success redirect URL</label><input id="s_redirect" value="${attr(s.redirectUrl||'')}"></div>
    </div>

    <div class="panel">
      <h3>Contact & Socials</h3>
      <p class="panel-sub">Choose which supported profiles appear in the public footer/contact areas. Empty URLs are not published; the public site keeps a consistent platform order.</p>
      <div class="field"><label class="field-label">Contact email</label><input id="s_email" value="${attr(s.contactEmail||'')}"></div>
      <div id="socialEditor" class="social-editor"></div>
      <button class="ghost" id="addSocial" type="button"><i class="fa-solid fa-plus"></i> Add social profile</button>
      <div class="hint">Supported options include Instagram, TikTok, YouTube, Behance, ArtStation, LinkedIn, X, Facebook, Dribbble, and Vimeo.</div>
    </div>

    <div class="panel">
      <h3>SEO & Social Preview</h3>
      <div class="field"><label class="field-label">Site title</label><input id="s_title" value="${attr(s.siteTitle||'')}"></div>
      <div class="field"><label class="field-label">Meta description</label><textarea id="s_desc" rows="2">${esc(s.siteDescription||'')}</textarea></div>
    </div>

    <div class="panel og-panel">
      <div class="panel-heading-row">
        <div><h3>Open Graph Image</h3><p class="panel-sub">Current social/share image. New uploads are automatically center-cropped and encoded to <strong>1200 × 630 px JPEG</strong>, then published as the next version. The CMS updates both page templates automatically.</p></div>
        <span class="og-version" id="ogVersionLabel">v${s.ogImageVersion}</span>
      </div>
      <div class="og-editor">
        <div class="og-preview-wrap"><img id="ogPreview" src="${attr(ghRawUrl(s.ogImage))}" alt="Open Graph image preview" onerror="handleMissingFile(this,'Open Graph image')"></div>
        <div class="og-controls">
          <div class="field"><label class="field-label">Current file</label><input id="ogPath" value="${attr(s.ogImage)}" readonly></div>
          <div class="field"><label class="field-label">Output size</label><div class="og-spec"><span>1200 × 630 px</span><span>JPEG</span></div></div>
          <div class="og-actions">
            <label class="ghost file-btn"><i class="fa-solid fa-image"></i> Choose new image<input id="ogFile" type="file" accept="image/*" hidden></label>
            <button class="primary" id="ogPublish" type="button" disabled><i class="fa-solid fa-cloud-arrow-up"></i> Upload &amp; publish</button>
          </div>
          <div class="hint" id="ogStatus">Upload a replacement image. The original file is kept in git history; the new version gets its own v# filename so social caches can refresh cleanly.</div>
        </div>
      </div>
    </div>

  `;

  content.querySelectorAll('input[data-toggle]').forEach(t=>{
    t.addEventListener('change', ()=>{
      const path = t.dataset.toggle.split('.');
      if(path.length===1) s[path[0]] = t.checked;
      else s[path[0]][path[1]] = t.checked;
      flagUnsaved();
    });
  });
  const feedbackNavigationInput = content.querySelector('#s_feedback_navigation');
  const feedbackSelectionInput = content.querySelector('#s_feedback_selection');
  const feedbackVolumeInput = content.querySelector('#s_feedback_volume');
  const feedbackPreviewNavigation = content.querySelector('#s_feedback_preview_navigation');
  const feedbackPreviewSelection = content.querySelector('#s_feedback_preview_selection');
  const defaultVideoPosterInput = content.querySelector('#s_default_video_poster');
  [feedbackNavigationInput, feedbackSelectionInput, feedbackVolumeInput, defaultVideoPosterInput].forEach(input => input?.addEventListener('input', flagUnsaved));
  attachMediaBrowseButton(defaultVideoPosterInput, null, { kind: 'image', title: 'Choose default video poster' });
  attachMediaBrowseButton(feedbackNavigationInput, null, { kind: 'other', title: 'Choose navigation cue sound' });
  attachMediaBrowseButton(feedbackSelectionInput, null, { kind: 'other', title: 'Choose selection cue sound' });

  let feedbackPreviewAudio = null;
  function previewFeedbackSound(input) {
    const source = String(input?.value || '').trim();
    if (!source) { toast('Choose a sound file before previewing.', true); return; }
    const url = /^https:\/\//i.test(source) ? source : ghRawUrl(source);
    try {
      feedbackPreviewAudio?.pause();
      const audio = new Audio(url);
      feedbackPreviewAudio = audio;
      audio.preload = 'none';
      const level = Number(feedbackVolumeInput?.value);
      audio.volume = Number.isFinite(level) ? Math.max(0, Math.min(0.3, level)) : 0.12;
      audio.addEventListener('ended', () => {
        if (feedbackPreviewAudio === audio) feedbackPreviewAudio = null;
        audio.removeAttribute('src');
      }, { once: true });
      const playback = audio.play();
      if (playback && typeof playback.catch === 'function') playback.catch(() => toast('Preview was blocked. Check the file format/path and try again.', true));
    } catch (_) { toast('Could not preview this sound file. Check its path and format.', true); }
  }
  feedbackPreviewNavigation?.addEventListener('click', () => previewFeedbackSound(feedbackNavigationInput));
  feedbackPreviewSelection?.addEventListener('click', () => previewFeedbackSound(feedbackSelectionInput));

  const socialEditor = content.querySelector('#socialEditor');
  const addSocialBtn = content.querySelector('#addSocial');
  let socialRows = Object.entries(s.socials)
    .filter(([key]) => CMS_SOCIAL_PLATFORMS.some(platform => platform.key === key))
    .map(([key, url]) => ({ key, url: String(url || '') }));

  function availableSocialKey() {
    const used = new Set(socialRows.map(row => row.key));
    return CMS_SOCIAL_PLATFORMS.find(platform => !used.has(platform.key))?.key || null;
  }

  function syncSocialOptions() {
    const selects = socialEditor?.querySelectorAll('select[data-social-key]') || [];
    const used = socialRows.map(row => row.key);
    selects.forEach((select, index) => {
      Array.from(select.options).forEach(option => {
        option.disabled = used.includes(option.value) && option.value !== socialRows[index].key;
      });
    });
    if (addSocialBtn) addSocialBtn.disabled = !availableSocialKey();
  }

  function paintSocialRows() {
    if (!socialEditor) return;
    socialEditor.innerHTML = socialRows.map((row, index) => `
      <div class="social-row" data-social-index="${index}">
        <div class="field">
          <label class="field-label">Platform</label>
          <div class="social-platform-select">
            <i class="${CMS_SOCIAL_PLATFORMS.find(platform => platform.key === row.key)?.icon || 'fa-solid fa-link'}"></i>
            <select data-social-key aria-label="Social platform">
              ${CMS_SOCIAL_PLATFORMS.map(platform => `<option value="${attr(platform.key)}" ${platform.key === row.key ? 'selected' : ''}>${esc(platform.label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field-label">Profile URL</label>
          <input data-social-url value="${attr(row.url)}" placeholder="https://...">
        </div>
        <button class="icon-btn social-remove" type="button" data-social-remove title="Remove social profile" aria-label="Remove social profile"><i class="fa-solid fa-trash"></i></button>
      </div>`).join('');

    socialEditor.querySelectorAll('[data-social-index]').forEach(rowEl => {
      const index = Number(rowEl.dataset.socialIndex);
      const row = socialRows[index];
      const platformSelect = rowEl.querySelector('[data-social-key]');
      const urlInput = rowEl.querySelector('[data-social-url]');

      platformSelect.addEventListener('change', event => {
        const duplicate = socialRows.some((item, itemIndex) => itemIndex !== index && item.key === event.target.value);
        if (duplicate) {
          event.target.value = row.key;
          toast('That social platform is already selected.', true);
          return;
        }
        row.key = event.target.value;
        flagUnsaved();
        paintSocialRows();
      });

      urlInput.addEventListener('input', event => {
        row.url = event.target.value;
        flagUnsaved();
      });

      rowEl.querySelector('[data-social-remove]').addEventListener('click', () => {
        socialRows.splice(index, 1);
        flagUnsaved();
        paintSocialRows();
      });
    });

    syncSocialOptions();
  }

  addSocialBtn?.addEventListener('click', () => {
    const key = availableSocialKey();
    if (!key) return;
    socialRows.push({ key, url: '' });
    flagUnsaved();
    paintSocialRows();
    const latest = socialEditor?.querySelector('[data-social-index]:last-child [data-social-url]');
    latest?.focus();
  });

  paintSocialRows();

  content.querySelectorAll('.panel input, .panel textarea').forEach(el=>{
    if(el.hasAttribute('data-toggle') || el.readOnly || el.closest('#socialEditor')) return;
    el.addEventListener('input', flagUnsaved);
  });

  const ogFileInput=content.querySelector('#ogFile');
  const ogPublishBtn=content.querySelector('#ogPublish');
  const ogPreview=content.querySelector('#ogPreview');
  const ogStatus=content.querySelector('#ogStatus');
  let pendingOgFile=null;
  if(ogFileInput){
    ogFileInput.addEventListener('change',()=>{
      const file=ogFileInput.files?.[0] || null;
      pendingOgFile=file;
      if(!file){ ogPublishBtn.disabled=true; return; }
      const local=URL.createObjectURL(file);
      ogPreview.src=local;
      ogPreview.onload=()=>URL.revokeObjectURL(local);
      ogPublishBtn.disabled=false;
      ogStatus.textContent=`Ready: ${file.name}. It will be normalized to 1200 × 630 px before publishing.`;
    });
  }
  if(ogPublishBtn){
    ogPublishBtn.addEventListener('click',async()=>{
      if(!pendingOgFile) return;
      const hadOtherChanges=!!dirty.settings;
      ogPublishBtn.disabled=true;
      if(ogFileInput) ogFileInput.disabled=true;
      ogStatus.textContent='Normalizing, uploading, and updating the page templates…';
      try{
        const result=await publishOgImage(pendingOgFile,s);
        if(content.querySelector('#ogPath')) content.querySelector('#ogPath').value=result.path;
        if(content.querySelector('#ogVersionLabel')) content.querySelector('#ogVersionLabel').textContent='v'+result.version;
        ogPreview.src=result.imageUrl;
        pendingOgFile=null;
        if(ogFileInput){ogFileInput.value='';ogFileInput.disabled=false;}
        dirty.settings=hadOtherChanges;
        updateDirtyDots();
        ogStatus.textContent=`Published v${result.version}. The public index, About page, and settings now point to ${result.path}.`;
        toast(`Open Graph image v${result.version} published.`);
        trackDeployStatus(result.commitSha);
      }catch(err){
        ogStatus.textContent='Upload failed — '+err.message;
        toast('Open Graph image: '+err.message,true);
        ogPublishBtn.disabled=false;
        if(ogFileInput) ogFileInput.disabled=false;
      }
    });
  }

  function validateVideoPosterPath(raw, label) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (/^https:\/\//i.test(value)) {
      try {
        const url = new URL(value);
        if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
      } catch (_) {}
      throw new Error(label + ' must be a valid HTTPS image URL.');
    }
    const path = value.split(/[?#]/, 1)[0];
    const forbidden = value.includes(String.fromCharCode(92))
      || Array.from(value).some(character => character.charCodeAt(0) < 32);
    let decodedPath = path;
    try { decodedPath = decodeURIComponent(path); }
    catch (_) { throw new Error(label + ' contains an invalid URL escape.'); }
    if (!value.startsWith('assets/') || forbidden ||
        [path, decodedPath].some(candidate => candidate.split('/').some(part => !part || part === '.' || part === '..')) ||
        !/\.(?:apng|avif|gif|jpe?g|png|svg|webp)$/i.test(path)) {
      throw new Error(label + ' must be an image under assets/ or a valid HTTPS image URL.');
    }
    return value;
  }

  function validateFeedbackSoundPath(raw, label) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (/^https:\/\//i.test(value)) {
      try { const url = new URL(value); if (url.protocol === 'https:') return url.href; } catch (_) {}
      throw new Error(label + ' must be a valid HTTPS URL.');
    }
    const path = value.split(/[?#]/, 1)[0];
    const forbidden = value.includes(String.fromCharCode(92))
      || Array.from(value).some(character => character.charCodeAt(0) < 32);
    if (!value.startsWith('assets/') || forbidden ||
        path.split('/').some(part => !part || part === '.' || part === '..') ||
        !/\.(?:wav|mp3|ogg|m4a|aac|flac|webm)$/i.test(path)) {
      throw new Error(label + ' must point to audio under assets/ or an HTTPS audio URL.');
    }
    return value;
  }

  wireSave(()=>({
    protectionEnabled: s.protectionEnabled,
    defaultVideoPoster: validateVideoPosterPath(val('s_default_video_poster'), 'Default video poster'),
    formsEnabled: { project: s.formsEnabled.project, review: s.formsEnabled.review },
    showReviews: s.showReviews,
    showSoftwareLogos: s.showSoftwareLogos,
    showHeroMessage: s.showHeroMessage,
    showFooterMessage: s.showFooterMessage,
    interactionFeedback: (() => {
      const rawVolume = val('s_feedback_volume').trim();
      const volume = Number(rawVolume);
      if (!rawVolume || !Number.isFinite(volume) || volume < 0 || volume > 0.3) {
        throw new Error('Feedback sound volume must be a number between 0 and 0.30.');
      }
      return {
        enabled: s.interactionFeedback.enabled === true,
        soundEnabled: s.interactionFeedback.soundEnabled !== false,
        hapticsEnabled: s.interactionFeedback.hapticsEnabled === true,
        volume,
        navigationSound: validateFeedbackSoundPath(val('s_feedback_navigation'), 'Navigation cue'),
        selectionSound: validateFeedbackSoundPath(val('s_feedback_selection'), 'Selection cue')
      };
    })(),
    web3forms: { projectKey: val('s_pkey'), reviewKey: val('s_rkey') },
    redirectUrl: val('s_redirect'),
    contactEmail: val('s_email'),
    socials: Object.fromEntries(
      socialRows
        .filter(row => row.key && row.url.trim())
        .map(row => [row.key, row.url.trim()])
    ),
    siteTitle: val('s_title'),
    siteDescription: val('s_desc'),
    heroTiming: s.heroTiming,
    ogImage: s.ogImage,
    ogImageVersion: s.ogImageVersion,
    ogImageAlt: s.ogImageAlt,
    ogImageWidth: OG_CANVAS_W,
    ogImageHeight: OG_CANVAS_H
  }), 'settings', SECTIONS.settings.file);

  function toggleRow(key, label, desc, checked){
    return `<div class="toggle-row">
      <div><div class="t-label">${label}</div><div class="t-desc">${desc}</div></div>
      <label class="switch"><input type="checkbox" data-toggle="${key}" ${checked?'checked':''}><span class="slider"></span></label>
    </div>`;
  }
};

/* =====================================================================
   10. SECTION: REVIEWS
   ===================================================================== */
RENDERERS.reviews = async function(data, isCurrent=()=>true){
  let items = withUids((data.json||[]).map(x=>({stars:x.stars||5, quote:x.quote||'', author:x.author||''})));
  let showReviews = true;
  let openUid = null;
  try{ const set = await loadSection('settings'); showReviews = !!(set.json && set.json.showReviews); }catch(e){}
  if(!isCurrent()) return;

  function paint(){
    content.innerHTML = sectionHead('Reviews','Client testimonials in the scrolling strip above the footer. Drag the handle to reorder, or click a card to expand it.') +
      (!showReviews ? `<div class="banner info"><i class="fa-solid fa-eye-slash"></i><div><strong>The reviews section is currently hidden</strong> on the live site. Turn it on from <a href="#" id="goSettings" style="color:#fff;text-decoration:underline">Settings &amp; Toggles</a> when you're ready to show it.</div></div>` : '') +
      `<div id="reviewList"></div>
      <button class="add-btn" id="addReview"><i class="fa-solid fa-plus"></i> Add review</button>`;

    const gs = document.getElementById('goSettings');
    if(gs) gs.addEventListener('click', (e)=>{ e.preventDefault(); goToSection('settings'); });

    const list = document.getElementById('reviewList');
    items.forEach((item)=>{
      const isOpen = item._uid === openUid;
      const row = document.createElement('div');
      row.className = 'card-item';
      row.dataset.uid = item._uid;
      const stars = '★'.repeat(Math.max(0,Math.min(5,Math.round(item.stars||0))));
      const preview = `${stars}  ${item.quote || '(empty)'}${item.author ? ' — ' + item.author : ''}`;
      row.innerHTML = `
        <div class="card-item-head collapsible-head" data-toggle-open>
          <span class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></span>
          <span class="preview-line">${esc(preview)}</span>
          <div class="card-item-actions">
            <button class="icon-btn" data-act="up"><i class="fa-solid fa-arrow-up"></i></button>
            <button class="icon-btn" data-act="down"><i class="fa-solid fa-arrow-down"></i></button>
            <button class="icon-btn" data-act="del" style="color:#e0584f"><i class="fa-solid fa-trash"></i></button>
            <button class="icon-btn" data-act="toggle"><i class="fa-solid fa-chevron-${isOpen?'up':'down'}"></i></button>
          </div>
        </div>
        <div class="collapsible-body" style="display:${isOpen?'block':'none'};margin-top:16px;" data-body></div>
      `;
      if (isOpen) buildReviewBody(row.querySelector('[data-body]'), item, row);

      row.querySelector('[data-toggle-open]').addEventListener('click', (e)=>{
        if(e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act !== 'toggle') return;
        openUid = isOpen ? null : item._uid; paint();
      });
      row.querySelector('[data-act="del"]').addEventListener('click', (e)=>{
        e.stopPropagation();
        if(!confirm('Delete this review?'))return;
        items = items.filter(x=>x._uid!==item._uid); flagUnsaved(); paint();
      });
      row.querySelector('[data-act="up"]').addEventListener('click', (e)=>{
        e.stopPropagation();
        const i = items.indexOf(item);
        if(i===0)return;
        animateReorder(() => document.getElementById('reviewList'), () => { [items[i-1],items[i]]=[items[i],items[i-1]]; flagUnsaved(); paint(); });
      });
      row.querySelector('[data-act="down"]').addEventListener('click', (e)=>{
        e.stopPropagation();
        const i = items.indexOf(item);
        if(i===items.length-1)return;
        animateReorder(() => document.getElementById('reviewList'), () => { [items[i+1],items[i]]=[items[i],items[i+1]]; flagUnsaved(); paint(); });
      });
      list.appendChild(row);
    });
    document.getElementById('addReview').addEventListener('click', ()=>{
      const item = {stars:5,quote:'',author:'',_uid:uid()};
      items.push(item); openUid = item._uid; flagUnsaved(); paint();
    });
    enableDragReorder(() => document.getElementById('reviewList'), items, flagUnsaved, paint);
    wireSave(()=> items.map(x=>({stars:x.stars,quote:x.quote,author:x.author})), 'reviews', SECTIONS.reviews.file);
  }

  function buildReviewBody(el, item, row){
    el.innerHTML = `
      <div class="field"><label class="field-label">Rating</label>
        <div class="stars-input" data-stars>${[1,2,3,4,5].map(n=>`<i class="fa-solid fa-star" data-n="${n}"></i>`).join('')}</div>
      </div>
      <div class="field"><label class="field-label">Quote</label><textarea data-f="quote" rows="2">${esc(item.quote)}</textarea></div>
      <div class="field"><label class="field-label">Author</label><input data-f="author" value="${attr(item.author)}" placeholder="e.g. Studio A"></div>
    `;
    function updatePreview(){
      const stars = '★'.repeat(Math.max(0,Math.min(5,Math.round(item.stars||0))));
      const preview = row.querySelector('.preview-line');
      if (preview) preview.textContent = `${stars}  ${item.quote || '(empty)'}${item.author ? ' — ' + item.author : ''}`;
    }
    const starEls = el.querySelectorAll('[data-stars] i');
    function paintStars(){ starEls.forEach(se=> se.classList.toggle('filled', +se.dataset.n <= item.stars)); }
    paintStars();
    starEls.forEach(se=> se.addEventListener('click', ()=>{ item.stars = +se.dataset.n; paintStars(); updatePreview(); flagUnsaved(); }));
    el.querySelectorAll('[data-f]').forEach(inp=> inp.addEventListener('input', ()=>{ item[inp.dataset.f]=inp.value; updatePreview(); flagUnsaved(); }));
  }

  paint();
};


function extractYouTubeId(url){
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
    /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

const SOURCE_TYPE_RULES = {
  image: { label:'image', extensions:['jpg','jpeg','png','gif','webp','svg','avif'] },
  video: { label:'video', extensions:['mp4','webm','mov','m4v'] },
  lottie: { label:'Lottie animation', extensions:['json'] },
  model: { label:'3D model', extensions:['obj','gltf','glb','fbx'] },
  youtube: { label:'YouTube video', extensions:[] }
};

function sourceExtension(src){
  const value=String(src||'').trim().split('#')[0].split('?')[0];
  const match=value.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : '';
}

function validateMediaSource(type, src){
  const value=String(src||'').trim();
  if(!value) return null;
  if(type==='youtube') return extractYouTubeId(value) ? null : 'This source is not a recognized YouTube link. Choose a YouTube URL or change the media type.';
  const rule=SOURCE_TYPE_RULES[type];
  if(!rule) return null;
  const ext=sourceExtension(value);
  if(!ext) return null;
  if(rule.extensions.includes(ext)) return null;
  const actualKind=fileKind(value);
  const actualLabel = actualKind==='other' ? `a .${ext} file` : (SOURCE_TYPE_RULES[actualKind]?.label || `a .${ext} file`);
  const expected = rule.extensions.map(x=>'.'+x.toUpperCase()).join(', ');
  return `Source type mismatch: this is ${actualLabel}, but the media type is set to ${rule.label}. Use ${expected}, or change the selected type.`;
}

function sourceTypeErrorHtml(message){
  return `<div class="source-type-error" role="alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><div><strong>Source type error</strong><p>${esc(message)}</p></div></div>`;
}

function mediaSupportsBackground(type){
  return type === 'lottie' || type === 'model';
}

function normalizeEditorBackground(value){
  if (!value || typeof value !== 'object') return null;
  if (value.type !== 'solid' || !/^#[0-9a-f]{6}$/i.test(String(value.color || ''))) return null;
  return { type:'solid', color:String(value.color).toUpperCase() };
}

function backgroundControlHtml(background){
  const normalized = normalizeEditorBackground(background);
  const enabled = !!normalized;
  const color = normalized?.color || '#121212';
  return `
    <div class="field media-bg-control" data-bg-control>
      <label class="field-label">Background color</label>
      <div class="media-bg-row">
        <label class="media-bg-toggle"><input type="checkbox" data-bg-enabled ${enabled?'checked':''}> <span>Use background</span></label>
        <div class="media-bg-color">
          <span class="media-bg-color-picker" data-bg-picker>
            <span class="media-bg-swatch" data-bg-swatch style="background:${attr(color)}" aria-hidden="true"></span>
            <input data-bg-color type="color" value="${attr(color)}" aria-label="Choose background color" ${enabled?'':'disabled'}>
          </span>
          <span class="media-bg-hex" data-bg-hex>${esc(color)}</span>
        </div>
        <button type="button" class="ghost media-bg-reset" data-bg-reset>Reset</button>
      </div>
      <div class="hint">Used behind transparent Lottie and 3D artwork.</div>
    </div>
  `;
}

function wireBackgroundControl(root, getType, getBackground, setBackground, onChanged){
  const control = root?.querySelector('[data-bg-control]');
  if (!control) return;

  const enabledInput = control.querySelector('[data-bg-enabled]');
  const colorInput = control.querySelector('[data-bg-color]');
  const resetButton = control.querySelector('[data-bg-reset]');

  function sync(){
    const supported = mediaSupportsBackground(getType());
    control.hidden = !supported;
    if (!supported) return;

    const bg = normalizeEditorBackground(getBackground());
    enabledInput.checked = !!bg;
    colorInput.disabled = !bg;
    colorInput.value = bg?.color || '#121212';
    const swatch = control.querySelector('[data-bg-swatch]');
    const hex = control.querySelector('[data-bg-hex]');
    if (swatch) swatch.style.background = colorInput.value;
    if (hex) hex.textContent = colorInput.value.toUpperCase();
  }

  enabledInput.addEventListener('change', () => {
    setBackground(enabledInput.checked ? {
      type:'solid',
      color:colorInput.value || '#121212'
    } : null);
    sync();
    onChanged?.();
  });

  colorInput.addEventListener('input', () => {
    if (!enabledInput.checked) return;
    setBackground({type:'solid', color:colorInput.value || '#121212'});
    const swatch = control.querySelector('[data-bg-swatch]');
    const hex = control.querySelector('[data-bg-hex]');
    if (swatch) swatch.style.background = colorInput.value;
    if (hex) hex.textContent = colorInput.value.toUpperCase();
    onChanged?.();
  });

  resetButton.addEventListener('click', () => {
    setBackground(null);
    sync();
    onChanged?.();
  });

  root.__bgEditorSync = sync;
  sync();
}

function normalizeEditorHolographic(value){
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const styles = new Set(['holographic','cosmos','brushed','beams','crosshatch','shattered','glitter','waves','cat-eye','iridescent','aurora']);
  const style = String(value.style || '').trim().toLowerCase();
  const intensityValue = Number(value.intensity);
  const intensity = Number.isFinite(intensityValue) ? Math.max(0, Math.min(1, intensityValue)) : 0.7;
  const texture = String(value.texture || '').trim();
  const textureModeValue = String(value.textureMode || 'fill').trim().toLowerCase();
  const textureMode = ['tile','fill'].includes(textureModeValue) ? textureModeValue : 'fill';
  const back = String(value.back || '').trim();
  const mask = String(value.mask || '').trim();
  // Back-side foil data is valid only while a custom reverse image exists.
  const backTexture = back ? String(value.backTexture || '').trim() : '';
  const backTextureModeValue = String(value.backTextureMode || 'fill').trim().toLowerCase();
  const backTextureMode = ['tile','fill'].includes(backTextureModeValue) ? backTextureModeValue : 'fill';
  const backMask = back ? String(value.backMask || '').trim() : '';
  const glitterLayer = value.glitterLayer === true;
  const grainLayer = value.grainLayer !== false;
  const backFoilEnabled = Boolean(back) && (
    value.backFoilEnabled === true ||
    (value.backFoilEnabled == null && Boolean(backTexture || backMask))
  );
  return {
    style: styles.has(style) ? style : 'holographic',
    intensity, textureMode, glitterLayer, grainLayer, ...(back ? {backTextureMode} : {}),
    ...(texture ? {texture} : {}), ...(back ? {back, backFoilEnabled} : {}), ...(mask ? {mask} : {}),
    ...(backTexture ? {backTexture} : {}), ...(backMask ? {backMask} : {})
  };
}

function holographicControlHtml(holographic){
  const value = normalizeEditorHolographic(holographic);
  const enabled = !!value;
  const style = value?.style || 'holographic';
  const intensity = Number.isFinite(Number(value?.intensity)) ? Number(value.intensity) : 0.7;
  const textureMode = value?.textureMode || 'fill';
  const backTextureMode = value?.backTextureMode || 'fill';
  return `
    <div class="field holographic-control" data-holo-control>
      <label class="field-label">Holographic Effect</label>
      <label class="media-bg-toggle holo-enable-row"><input type="checkbox" data-holo-enabled ${enabled?'checked':''}> <span>Enable interactive foil</span></label>
      <div class="holo-options" data-holo-options>
        <div class="holo-style-intensity holo-main-controls">
          <div class="field"><label class="field-label">Effect style</label><select data-holo-style aria-label="Holographic effect style">
            <option value="holographic" ${style==='holographic'?'selected':''}>Smooth prism foil</option>
            <option value="cosmos" ${style==='cosmos'?'selected':''}>Cosmos galaxy foil</option>
            <option value="brushed" ${style==='brushed'?'selected':''}>Fine brushed foil</option>
            <option value="beams" ${style==='beams'?'selected':''}>Vertical light beams</option>
            <option value="crosshatch" ${style==='crosshatch'?'selected':''}>Crosshatch foil</option>
            <option value="shattered" ${style==='shattered'?'selected':''}>Shattered ice</option>
            <option value="glitter" ${style==='glitter'?'selected':''}>Glitter / starfield</option>
            <option value="waves" ${style==='waves'?'selected':''}>Water waves</option>
            <option value="cat-eye" ${style==='cat-eye'?'selected':''}>Cat-eye lens</option>
            <option value="iridescent" ${style==='iridescent'?'selected':''}>Pearlescent foil</option>
            <option value="aurora" ${style==='aurora'?'selected':''}>Aurora gradient</option>
          </select></div>
          <div class="field"><label class="field-label">Foil strength <span data-holo-intensity-value>${Math.round(intensity*100)}%</span></label>
            <input data-holo-intensity type="range" min="0" max="1" step="0.01" value="${intensity}" aria-label="Holographic foil strength" aria-valuetext="${Math.round(intensity*100)}%">
          </div>
        </div>
        <details class="holo-settings-group" data-holo-front-settings>
          <summary>Advanced foil options <span>Textures, masks and reverse side</span></summary>
          <div class="holo-settings-panel">
            <div class="field"><label class="field-label">Front foil pattern <span style="opacity:.5">(optional)</span></label>
              <input data-holo-texture aria-label="Front foil pattern source" value="${attr(value?.texture || '')}" placeholder="Choose a pattern PNG / SVG">
              <div class="holo-field-note">Small motifs tile; full-card maps fill the surface.</div>
              <select data-holo-texture-mode aria-label="Front pattern mapping">
                <option value="tile" ${textureMode==='tile'?'selected':''}>Tile pattern</option>
                <option value="fill" ${textureMode==='fill'?'selected':''}>Fill card</option>
              </select>
            </div>
            <div class="field"><label class="field-label">Front foil mask <span style="opacity:.5">(optional)</span></label>
              <input data-holo-mask aria-label="Front foil mask source" value="${attr(value?.mask || '')}" placeholder="Choose a front mask PNG / SVG">
              <div class="holo-field-note">White reveals foil; black hides it. Front only.</div>
            </div>
            <div class="field holo-surface-layers">
              <label class="field-label">Additional surface layers</label>
              <label class="media-bg-toggle"><input type="checkbox" data-holo-grain-layer ${value?.grainLayer !== false ? 'checked' : ''}> <span>Fine grain texture</span></label>
              <label class="media-bg-toggle"><input type="checkbox" data-holo-glitter-layer ${value?.glitterLayer === true ? 'checked' : ''}> <span>Glitter / starfield overlay</span></label>
              <p class="holo-field-note">These layers are masked to the artwork and respond to moving foil light. Grain stays enabled for older effects unless turned off.</p>
            </div>
            <div class="field holo-back-source"><label class="field-label">Back card image <span style="opacity:.5">(optional)</span></label>
              <input data-holo-back aria-label="Custom reverse card image source" value="${attr(value?.back || '')}" placeholder="assets/projects/your-folder/back.png / .jpg / .svg">
            </div>
            <div class="holo-back-settings" data-holo-back-options ${value?.back ? '' : 'hidden'}>
              <label class="media-bg-toggle holo-enable-row holo-back-enable-row"><input type="checkbox" data-holo-back-enabled ${value?.backFoilEnabled?'checked':''}> <span>Enable interactive foil on back</span></label>
              <details class="holo-settings-group holo-back-group">
                <summary>Reverse-side foil options <span>Pattern and mask (optional)</span></summary>
                <div class="holo-settings-panel">
                  <div class="field"><label class="field-label">Back foil pattern <span style="opacity:.5">(optional)</span></label>
                    <input data-holo-back-texture aria-label="Back foil pattern source" value="${attr(value?.backTexture || '')}" placeholder="Choose a back pattern PNG / SVG">
                    <select data-holo-back-texture-mode aria-label="Back pattern mapping">
                      <option value="tile" ${backTextureMode==='tile'?'selected':''}>Tile pattern</option>
                      <option value="fill" ${backTextureMode==='fill'?'selected':''}>Fill card</option>
                    </select>
                  </div>
                  <div class="field"><label class="field-label">Back foil mask <span style="opacity:.5">(optional)</span></label>
                    <input data-holo-back-mask aria-label="Back foil mask source" value="${attr(value?.backMask || '')}" placeholder="Choose a back mask PNG / SVG">
                    <div class="holo-field-note">Leave both settings blank for a clean reverse.</div>
                  </div>
                </div>
              </details>
            </div>
            <p class="holo-field-note">Eleven foil finishes are available. Move to tilt the artwork; click or tap to flip.</p>
          </div>
        </details>
      </div>
    </div>
  `;
}
function wireHolographicControl(root, getType, getEffect, setEffect, onChanged){
  const control=root?.querySelector('[data-holo-control]');if(!control)return;
  const enabledInput=control.querySelector('[data-holo-enabled]'),options=control.querySelector('[data-holo-options]');
  const styleInput=control.querySelector('[data-holo-style]'),intensityInput=control.querySelector('[data-holo-intensity]');
  const intensityLabel=control.querySelector('[data-holo-intensity-value]'),textureInput=control.querySelector('[data-holo-texture]');
  const textureModeInput=control.querySelector('[data-holo-texture-mode]'),backInput=control.querySelector('[data-holo-back]');
  const maskInput=control.querySelector('[data-holo-mask]'),backOptions=control.querySelector('[data-holo-back-options]');
  const grainLayerInput=control.querySelector('[data-holo-grain-layer]'),glitterLayerInput=control.querySelector('[data-holo-glitter-layer]');
  const backTextureInput=control.querySelector('[data-holo-back-texture]'),backTextureModeInput=control.querySelector('[data-holo-back-texture-mode]');
  const backMaskInput=control.querySelector('[data-holo-back-mask]');
  const backFoilInput=control.querySelector('[data-holo-back-enabled]');
  function syncVisibility(){options.hidden=!enabledInput.checked;if(backOptions)backOptions.hidden=!String(backInput.value||'').trim();}
  function updateIntensityAccessibility(){const percent=Math.round(Number(intensityInput.value)*100);if(intensityLabel)intensityLabel.textContent=percent+'%';intensityInput.setAttribute('aria-valuetext',percent+'%');}
  function sync(){
    const supported=String(getType()||'').toLowerCase()==='image';control.hidden=!supported;if(!supported)return;
    const value=normalizeEditorHolographic(getEffect());enabledInput.checked=!!value;
    styleInput.value=value?.style||'holographic';intensityInput.value=String(value?.intensity??0.7);
    textureInput.value=value?.texture||'';textureModeInput.value=value?.textureMode||'fill';
    backInput.value=value?.back||'';maskInput.value=value?.mask||'';
    if(backTextureInput)backTextureInput.value=value?.backTexture||'';
    if(backTextureModeInput)backTextureModeInput.value=value?.backTextureMode||'fill';
    if(backMaskInput)backMaskInput.value=value?.backMask||'';
    if(backFoilInput)backFoilInput.checked=!!value?.backFoilEnabled;
    if(grainLayerInput)grainLayerInput.checked=value?.grainLayer!==false;
    if(glitterLayerInput)glitterLayerInput.checked=value?.glitterLayer===true;
    updateIntensityAccessibility();syncVisibility();
  }
  function read(){
    const backSrc=backInput.value.trim();
    const backTexture=backTextureInput?.value.trim()||'';
    const backMask=backMaskInput?.value.trim()||'';
    return {
      style:styleInput.value||'holographic',
      intensity:Math.max(0,Math.min(1,Number(intensityInput.value)||0)),
      textureMode:textureModeInput.value||'fill',
      grainLayer:grainLayerInput ? grainLayerInput.checked : true,
      glitterLayer:glitterLayerInput ? glitterLayerInput.checked : false,
      ...(textureInput.value.trim()?{texture:textureInput.value.trim()}:{}),
      ...(backSrc?{back:backSrc,backFoilEnabled:!!backFoilInput?.checked}:{}),
      ...(maskInput.value.trim()?{mask:maskInput.value.trim()}:{}),
      ...(backSrc&&backTexture?{backTexture,backTextureMode:backTextureModeInput.value||'fill'}:{}),
      ...(backSrc&&backMask?{backMask}:{})
    };
  }
  enabledInput.addEventListener('change',()=>{setEffect(enabledInput.checked?read():null);sync();onChanged?.();});
  styleInput.addEventListener('change',()=>{if(enabledInput.checked){setEffect(read());onChanged?.();}});
  intensityInput.addEventListener('input',()=>{updateIntensityAccessibility();if(enabledInput.checked){setEffect(read());onChanged?.();}});
  const update=()=>{syncVisibility();if(enabledInput.checked){setEffect(read());onChanged?.();}};
  [textureInput,backInput,maskInput,backTextureInput,backMaskInput].filter(Boolean).forEach(el=>el.addEventListener('input',update));
  [textureModeInput,backTextureModeInput,grainLayerInput,glitterLayerInput].filter(Boolean).forEach(el=>el.addEventListener('change',update));
  backFoilInput?.addEventListener('change',update);
  root.__holoEditorSync=sync;sync();
}

function releasePreviewMedia(root) {
  if (!root) return;
  const backgroundHosts = [];
  if (root.classList?.contains('lm-media-background-host')) backgroundHosts.push(root);
  root.querySelectorAll?.('.lm-media-background-host').forEach(host => backgroundHosts.push(host));
  backgroundHosts.forEach(host => {
    try { globalThis.LMMediaBackground?.clear?.(host); } catch (_) {}
  });

  const mediaNodes = [];
  if (root.matches?.('video,audio')) mediaNodes.push(root);
  root.querySelectorAll?.('video,audio').forEach(media => mediaNodes.push(media));
  mediaNodes.forEach(media => {
    try { media.pause?.(); } catch (_) {}
    try {
      media.removeAttribute('src');
      media.querySelectorAll?.('source').forEach(source => source.removeAttribute('src'));
      media.load?.();
    } catch (_) {}
  });

  const lottieNodes = [];
  if (root.matches?.('lottie-player')) lottieNodes.push(root);
  root.querySelectorAll?.('lottie-player').forEach(player => lottieNodes.push(player));
  lottieNodes.forEach(player => {
    try { player.pause?.(); } catch (_) {}
    try { player.stop?.(); } catch (_) {}
    try { player.removeAttribute('src'); } catch (_) {}
  });
}

function buildMediaPreviewHtml(m){
  const sourceError = validateMediaSource(m.type, m.src);
  if (sourceError) return `<div class="media-preview media-preview-error">${sourceTypeErrorHtml(sourceError)}</div>`;
  if (!m.src) {
    return `<div class="media-preview"><span class="empty-note">Enter a source above to see a preview</span></div>`;
  }
  if (m.type === 'video') {
    return `<div class="media-preview"><video src="${attr(ghRawUrl(m.src))}" muted preload="metadata" controls onerror="handleMissingFile(this,'video')"></video></div>`;
  }
  if (m.type === 'youtube') {
    const id = extractYouTubeId(m.src);
    if (!id) return `<div class="media-preview"><span class="empty-note">Couldn't recognize this as a YouTube link</span></div>`;
    return `<div class="media-preview"><img src="https://img.youtube.com/vi/${id}/hqdefault.jpg" alt="YouTube thumbnail"><span class="yt-badge">YOUTUBE</span></div>`;
  }
  if (m.type === 'lottie') {
    return `<div class="media-preview"><lottie-player src="${attr(ghRawUrl(m.src))}" autoplay loop background="transparent" style="width:100%;height:100%;"></lottie-player></div>`;
  }
  if (m.type === 'model') {
    return `<div class="media-preview model-preview"><div class="model-viewer-shell admin-model-viewer" data-model-preview aria-label="Interactive 3D model"><span class="empty-note">Loading 3D preview…</span></div></div>`;
  }
  // image
  return `<div class="media-preview"><img src="${attr(ghRawUrl(m.src))}" alt="" onerror="handleMissingFile(this,'image')"></div>`;
}

function validateProjectEditorModel(project, { requireFilters = true } = {}){
  if (!project || typeof project !== 'object') throw new Error('Project data is invalid.');
  if (!String(project.title || '').trim()) throw new Error('Every project needs a title.');
  if (!String(project.subtitle || '').trim()) throw new Error(`"${project.title}" needs a subtitle.`);
  if (requireFilters && (!Array.isArray(project.filters) || !project.filters.length)) {
    throw new Error(`"${project.title}" needs at least one filter tab.`);
  }
  if (!project.id) project.id = slugify(project.title);
  return project;
}

const DEFAULT_ARTWORK_GROUP_COLOR = '#849573';
function normalizeArtworkGroupColor(value) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_ARTWORK_GROUP_COLOR;
}

function serializeProjectEditorModel(project){
  const badges = Array.isArray(project.badges)
    ? [...new Set(project.badges.map(value => String(value || '').trim()).filter(Boolean))]
    : (project.badge ? [String(project.badge).trim()] : []);
  return {
    id:project.id,
    title:project.title,
    subtitle:project.subtitle,
    // Keep the first attribute in the legacy field so older readers remain compatible,
    // while badges[] is now the canonical CMS/public contract.
    badge:badges[0] || '',
    badges,
    filters:Array.isArray(project.filters) ? [...project.filters] : [],
    description:project.description,
    ...(project.extensions && typeof project.extensions === 'object' && !Array.isArray(project.extensions)
      ? {extensions:project.extensions}
      : {}),
    thumbnail:{
      type:project.thumbnail?.type || 'image',
      src:project.thumbnail?.src || '',
      focus:project.thumbnail?.focus,
      zoom:project.thumbnail?.zoom,
      ...(project.thumbnail?.background && typeof project.thumbnail.background === 'object'
        ? {background:project.thumbnail.background}
        : {})
    },
    mediaGroups:(Array.isArray(project.mediaGroups) ? project.mediaGroups : []).map(group => ({
      id:String(group.id || ''),
      name:String(group.name || ''),
      layout:['grid','stack','cards'].includes(group.layout) ? group.layout : 'grid',
      color:normalizeArtworkGroupColor(group.color)
    })).filter(group => group.id && group.name),
    media:(Array.isArray(project.media) ? project.media : []).map(media => ({
      type:media.type,
      src:media.src,
      caption:media.caption,
      ...(media.groupId ? {groupId:String(media.groupId)} : {}),
      orientation:media.orientation,
      ...(media.background && typeof media.background === 'object'
        ? {background:media.background}
        : {}),
      ...(media.holographic && typeof media.holographic === 'object' && !Array.isArray(media.holographic)
        ? {holographic:normalizeEditorHolographic(media.holographic)}
        : {})
    }))
  };
}

function buildProjectBody(el, p, options = {}){
  const markChanged = typeof options.onChanged === 'function' ? options.onChanged : flagUnsaved;
  const filterDefs = Array.isArray(options.filterDefs) ? options.filterDefs : [];
  const badgeDefs = Array.isArray(options.badgeDefs) ? options.badgeDefs : [];
  p.badges = Array.isArray(p.badges)
    ? [...new Set(p.badges.map(value => String(value || '').trim()).filter(Boolean))]
    : (p.badge ? [String(p.badge).trim()] : []);
  p.badge = p.badges[0] || '';
  p.mediaGroups = Array.isArray(p.mediaGroups)
    ? p.mediaGroups.filter(group => group && typeof group === 'object').map(group => ({
        id:String(group.id || ''),
        name:String(group.name || ''),
        layout:['grid','stack','cards'].includes(group.layout) ? group.layout : 'grid',
        color:normalizeArtworkGroupColor(group.color)
      })).filter(group => group.id && group.name)
    : [];
  const validArtworkGroupIds = new Set(p.mediaGroups.map(group => group.id));
  (Array.isArray(p.media) ? p.media : []).forEach(media => {
    if (media.groupId && !validArtworkGroupIds.has(String(media.groupId))) delete media.groupId;
  });
  // Only one artwork editor stays expanded at a time. This keeps projects
  // with long galleries compact and gives the selected artwork clear focus.
  let openMediaUid = null;
  el.innerHTML = `
    <div class="row">
      <div class="field"><label class="field-label">Title</label><input data-f="title" value="${attr(p.title)}"></div>
      <div class="field"><label class="field-label">Subtitle</label><input data-f="subtitle" value="${attr(p.subtitle)}"></div>
    </div>

    <div class="field">
      <label class="field-label">Project attributes <span style="opacity:.5">(select all that apply; separate from filter tabs)</span></label>
      <div class="chip-select" data-badges>
        ${badgeDefs.map(label=>{
          const value = String(label || '').trim();
          return value ? `<button type="button" class="chip ${p.badges.includes(value)?'selected':''}" data-badge-value="${attr(value)}">${esc(value)}</button>` : '';
        }).join('') || '<span class="hint">No project attributes defined yet — add some under Filters & Badges.</span>'}
      </div>
    </div>

    <div class="field" style="${options.showFilters === false ? 'display:none' : ''}">
      <label class="field-label">Filter tabs this shows under</label>
      <div class="chip-select" data-filters>
        ${filterDefs.map(f=>`<button type="button" class="chip ${p.filters.includes(f.id)?'selected':''}" data-fid="${attr(f.id)}">${esc(f.label)}</button>`).join('') || '<span class="hint">No filters defined yet — add some under Filters & Badges.</span>'}
      </div>
    </div>

    <div class="field">
      <label class="field-label">Description <span style="opacity:.5">(optional — shown when the card opens)</span></label>
      <textarea data-f="description" rows="4">${esc(p.description)}</textarea>
    </div>

    <div class="panel project-editor-panel project-thumbnail-panel">
      <h3>Thumbnail</h3>
      <p class="panel-sub">Leave the image blank and the site uses the first media item instead.</p>
      <div class="two-col">
        <div>
          <div class="row">
            <div class="field" style="max-width:180px"><label class="field-label">Thumbnail type</label><select data-f="thumb-type"><option value="image" ${p.thumbnail.type==='image'?'selected':''}>Image</option><option value="video" ${p.thumbnail.type==='video'?'selected':''}>Video</option><option value="lottie" ${p.thumbnail.type==='lottie'?'selected':''}>Lottie (JSON animation)</option><option value="model" ${p.thumbnail.type==='model'?'selected':''}>3D model</option></select></div>
            <div class="field"><label class="field-label">Source path or URL</label><input data-f="thumb-src" value="${attr(p.thumbnail.src)}" placeholder="assets/projects/your-folder/thumb.jpg / .mp4 / .json"></div>
          </div>
          <div class="row">
            <div class="field"><label class="field-label">Zoom</label><input data-f="thumb-zoom" type="number" step="0.05" value="${p.thumbnail.zoom}"></div>
            <div class="field"><label class="field-label">Focus (x% y%)</label><input data-f="thumb-focus" value="${attr(p.thumbnail.focus)}"></div>
          </div>
          ${backgroundControlHtml(p.thumbnail.background)}
        </div>
        <div>
          <label class="field-label">Drag to set focus point</label>
          <div class="focus-picker" data-focuspicker>
            <img data-thumb-img style="display:none" onerror="handleMissingFile(this,'thumbnail')">
            <div class="focus-crosshair" data-crosshair></div>
          </div>
          <p class="hint" data-thumb-fallback-note style="display:none">Preview is the project's first media item — no thumbnail file is set, same as the live site.</p>
        </div>
      </div>
    </div>

    <div class="panel project-editor-panel project-media-panel">
      <h3>Media (lightbox gallery)</h3>
      <p class="panel-sub">Order here is the order in the lightbox. Drag the handle to reorder. Ungrouped artwork keeps the original vertical list.</p>
      <section class="artwork-group-manager" data-artwork-groups aria-label="Artwork groups">
        <div class="artwork-group-manager-heading">
          <div class="artwork-group-manager-copy">
            <strong>Artwork groups</strong>
            <span>Create a group once, then assign it from any artwork card. Group colors identify grouped artwork; ungrouped items keep their existing appearance.</span>
          </div>
          <span class="artwork-group-count" data-group-count>0 groups</span>
        </div>
        <div class="artwork-group-create-row">
          <div class="field">
            <label class="field-label" for="artworkGroupName">New group name</label>
            <input id="artworkGroupName" data-new-group-name maxlength="80" placeholder="e.g. Character studies">
          </div>
          <div class="field">
            <label class="field-label" for="artworkGroupLayout">Layout</label>
            <select id="artworkGroupLayout" data-new-group-layout>
              <option value="grid">Grid / Tiling (columns)</option>
              <option value="stack">Horizontal Stack</option>
              <option value="cards">Horizontal Card Layout</option>
            </select>
          </div>
          <div class="field artwork-group-color-field">
            <label class="field-label" for="artworkGroupColor">Group color</label>
            <input id="artworkGroupColor" data-new-group-color type="color" value="#849573" aria-label="Color for new artwork group">
          </div>
          <button class="primary artwork-group-create-button" type="button" data-group-create>Create group</button>
        </div>
        <p class="artwork-group-selection-status" data-group-status role="status" aria-live="polite">Create a group above, then assign it directly from an artwork card.</p>
        <div class="artwork-group-list" data-artwork-group-list></div>
      </section>
      <div data-medialist></div>
      <button class="add-btn" data-addmedia type="button"><i class="fa-solid fa-plus"></i> Add media item</button>
    </div>
  `;

  // Thumbnail preview: an explicit thumbnail.src always wins; empty,
  // and it falls back to the project's first image/YouTube media item
  // — exactly what the live site's fillMissingThumbnails() does, so
  // what you see while dragging the focus point is what visitors see,
  // not a blank box that only appears once you type a path by hand.
  function refreshThumbPreview(){
    const picker = el.querySelector('[data-focuspicker]');
    const note = el.querySelector('[data-thumb-fallback-note]');
    if(!picker) return;
    const old = picker.querySelector('[data-thumb-media]');
    if (old) { releasePreviewMedia(old); old.remove(); }
    const oldSourceError = picker.querySelector('[data-thumb-source-error]');
    if (oldSourceError) oldSourceError.remove();
    const explicit = p.thumbnail.src;
    const fallback = explicit ? null : computeFallbackThumb(p.media, p.thumbnail);
    const src = explicit ? {type:p.thumbnail.type||'image',src:explicit,background:p.thumbnail.background||null} : fallback;
    if(!src || !src.src){ if(note) note.style.display='none'; return; }
    const sourceError = validateMediaSource(src.type, src.src);
    if (sourceError) {
      const error = document.createElement('div');
      error.className = 'source-type-error source-type-error-inline';
      error.dataset.thumbSourceError = '';
      error.setAttribute('role','alert');
      error.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><div><strong>Source type error</strong><p>' + esc(sourceError) + '</p></div>';
      picker.appendChild(error);
      if(note) note.style.display='none';
      return;
    }
    let media;
    if(src.type==='video'){
      media=document.createElement('video'); media.src=ghRawUrl(src.src); media.muted=true; media.loop=true; media.autoplay=true; media.playsInline=true;
    }else if(src.type==='lottie'){
      media=document.createElement('lottie-player'); media.setAttribute('src',ghRawUrl(src.src)); media.setAttribute('autoplay',''); media.setAttribute('loop',''); media.setAttribute('background','transparent');
    }else if(src.type==='model'){
      media=document.createElement('div'); media.className='admin-model-thumb-placeholder'; media.innerHTML='<i class="fa-solid fa-cube" aria-hidden="true"></i><strong>3D VIEW</strong><small>Uses the first 3D artwork</small>';
    }else{
      media=document.createElement('img'); media.src=ghRawUrl(src.src); media.alt=p.title||'Project thumbnail';
    }
    media.setAttribute('data-thumb-media',''); media.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;';
    const focus=p.thumbnail.focus||'50% 50%'; media.style.objectPosition=focus; media.style.transformOrigin=focus; media.style.transform=`scale(${p.thumbnail.zoom||1})`;
    const sourceBackground = src.background && typeof src.background === 'object' ? src.background : null;
    if (sourceBackground) picker.setAttribute('data-background', JSON.stringify(sourceBackground)); else picker.removeAttribute('data-background');
    picker.insertBefore(media,picker.querySelector('[data-crosshair]'));
    if (globalThis.LMMediaBackground) {
      const pickerBackground = ['lottie','model'].includes(src.type) && sourceBackground ? sourceBackground : {type:'none'};
      globalThis.LMMediaBackground.apply(picker, pickerBackground, ghRawUrl);
    }
    if(note) note.style.display=fallback?'':'none';
  }
  wireBackgroundControl(
    el,
    () => p.thumbnail.type,
    () => p.thumbnail.background,
    value => { p.thumbnail.background = value; refreshThumbPreview(); },
    () => { refreshThumbPreview(); markChanged(); }
  );

  attachMediaBrowseButton(el.querySelector('[data-f="thumb-src"]'), () => refreshThumbPreview(), () => ({
    kind: p.thumbnail.type === 'lottie' ? 'lottie' : p.thumbnail.type === 'video' ? 'video' : p.thumbnail.type === 'model' ? 'model' : 'image',
    title: p.thumbnail.type === 'lottie' ? 'Choose a Lottie JSON file' : p.thumbnail.type === 'video' ? 'Choose a video file' : p.thumbnail.type === 'model' ? 'Choose a 3D model' : 'Choose an image file'
  }));

  // simple fields
  el.querySelectorAll('[data-f]').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      const f = inp.dataset.f;
      if(f==='thumb-src'){
        p.thumbnail.src = inp.value;
        refreshThumbPreview();
      } else if(f==='thumb-type'){
        p.thumbnail.type = inp.value;
        refreshThumbPreview();
      }
      // THE FIX: typing a new zoom or focus value used to update
      // p.thumbnail but never re-render refreshThumbPreview() —
      // only loading a new image (thumb-src, above) did that. So
      // the preview looked frozen on whatever it last showed while
      // you adjusted the very things it's supposed to demonstrate,
      // which read as "zoom isn't doing what I typed" even though
      // the saved value was correct all along. Now every field that
      // touches the crop calls refreshThumbPreview() the same way
      // Profile Photo's equivalent fields already did.
      else if(f==='thumb-zoom') { p.thumbnail.zoom = parseFloat(inp.value)||1; refreshThumbPreview(); }
      else if(f==='thumb-focus'){ p.thumbnail.focus = inp.value; setFromFocusStr(); refreshThumbPreview(); }
      else {
        p[f] = inp.value;
        if (f==='title') {
          const titleEl = el.closest('.card-item').querySelector('.item-title');
          titleEl.innerHTML = `${esc(p.title)||'(untitled project)'} ${p.badges?.length?`<span style="color:#666;font-weight:500"> — ${esc(p.badges.join(' · '))}</span>`:''}`;
        }
      }
      markChanged();
    });
  });
  el.querySelectorAll('[data-badge-value]').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      const value = String(chip.dataset.badgeValue || '').trim();
      if (!value) return;
      if (p.badges.includes(value)) p.badges = p.badges.filter(item => item !== value);
      else p.badges.push(value);
      p.badge = p.badges[0] || '';
      chip.classList.toggle('selected', p.badges.includes(value));
      const titleEl = el.closest('.card-item').querySelector('.item-title');
      titleEl.innerHTML = `${esc(p.title)||'(untitled project)'} ${p.badges.length?`<span style="color:#666;font-weight:500"> — ${esc(p.badges.join(' · '))}</span>`:''}`;
      markChanged();
    });
  });

  // filter chips
  el.querySelectorAll('[data-fid]').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      const id = chip.dataset.fid;
      if(p.filters.includes(id)) p.filters = p.filters.filter(x=>x!==id);
      else p.filters.push(id);
      chip.classList.toggle('selected');
      markChanged();
    });
  });

  // focus picker
  const picker = el.querySelector('[data-focuspicker]');
  const crosshair = el.querySelector('[data-crosshair]');
  function setFromFocusStr(){
    const parts = (p.thumbnail.focus||'50% 50%').split(' ').map(s=>parseFloat(s)||50);
    crosshair.style.left = parts[0] + '%';
    crosshair.style.top = parts[1] + '%';
  }
  setFromFocusStr();
  refreshThumbPreview();
  function pointerToFocus(e){
    const rect = picker.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const x = Math.max(0, Math.min(100, (cx/rect.width)*100));
    const y = Math.max(0, Math.min(100, (cy/rect.height)*100));
    p.thumbnail.focus = `${x.toFixed(0)}% ${y.toFixed(0)}%`;
    crosshair.style.left = x+'%'; crosshair.style.top = y+'%';
    el.querySelector('[data-f="thumb-focus"]').value = p.thumbnail.focus;
    // THE FIX: this updated the crosshair dot's own position and the
    // text field beside it, but never touched the actual preview
    // image — so dragging looked like it worked (the dot moved) while
    // the crop/zoom shown never changed to match. Same gap the Zoom
    // and Focus text fields just above had, and the same fix: call
    // the one function that actually re-renders the image with the
    // current zoom + focus + rotate, on every change, not just once
    // when the project is first opened.
    refreshThumbPreview();
    markChanged();
  }
  let dragging=false;
  picker.style.touchAction='none';
  picker.addEventListener('pointerdown', e=>{
    if(e.pointerType==='mouse' && e.button!==0) return;
    dragging=true;
    picker.setPointerCapture?.(e.pointerId);
    pointerToFocus(e);
  });
  picker.addEventListener('pointermove', e=>{
    if(!dragging) return;
    e.preventDefault();
    pointerToFocus(e);
  });
  picker.addEventListener('pointerup', e=>{
    dragging=false;
    try { picker.releasePointerCapture?.(e.pointerId); } catch (_) {}
  });
  picker.addEventListener('pointercancel', ()=>{ dragging=false; });

  // Artwork groups are project-owned layout metadata. Media rows persist only groupId.
  const groupNameInput = el.querySelector('[data-new-group-name]');
  const groupLayoutInput = el.querySelector('[data-new-group-layout]');
  const groupColorInput = el.querySelector('[data-new-group-color]');
  const createGroupButton = el.querySelector('[data-group-create]');
  const groupList = el.querySelector('[data-artwork-group-list]');
  const groupCountLabel = el.querySelector('[data-group-count]');
  const groupStatus = el.querySelector('[data-group-status]');
  let medWrap = el.querySelector('[data-medialist]');

  const CREATE_ARTWORK_GROUP_OPTION = '__create_artwork_group__';

  function artworkGroupFor(media) {
    return p.mediaGroups.find(group => group.id === String(media?.groupId || '')) || null;
  }

  function artworkGroupOptionMarkup(media = null) {
    return '<option value="">Ungrouped — vertical list</option>' + p.mediaGroups.map(group =>
      '<option value="' + attr(group.id) + '"' + (media?.groupId === group.id ? ' selected' : '') + '>' +
        esc(group.name || group.id) + '</option>'
    ).join('') +
      '<option value="' + CREATE_ARTWORK_GROUP_OPTION + '">+ Create new group…</option>';
  }

  function syncArtworkGroupCard(row, media) {
    if (!row || !media) return;
    const group = artworkGroupFor(media);
    const selector = row.querySelector('[data-artwork-group-select]');
    const badge = row.querySelector('[data-artwork-group-badge]');
    const badgeName = badge?.querySelector('[data-artwork-group-name]');
    const badgeSwatch = badge?.querySelector('[data-artwork-group-swatch]');
    if (selector) selector.value = group?.id || '';
    if (!group) {
      row.classList.remove('has-artwork-group');
      row.style.removeProperty('--artwork-group-color');
      if (badge) { badge.hidden = true; badge.removeAttribute('aria-label'); }
      if (badgeName) badgeName.textContent = '';
      if (badgeSwatch) badgeSwatch.style.removeProperty('background-color');
      return;
    }
    const color = normalizeArtworkGroupColor(group.color);
    row.classList.add('has-artwork-group');
    row.style.setProperty('--artwork-group-color', color);
    if (badge) {
      badge.hidden = false;
      badge.setAttribute('aria-label', 'Assigned to artwork group ' + (group.name || group.id));
    }
    if (badgeName) badgeName.textContent = group.name || group.id;
    if (badgeSwatch) badgeSwatch.style.backgroundColor = color;
  }

  function syncArtworkGroupCards() {
    if (!medWrap) return;
    medWrap.querySelectorAll('.card-item[data-uid]').forEach(row => {
      const media = p.media.find(item => item._uid === row.dataset.uid);
      if (media) syncArtworkGroupCard(row, media);
    });
  }

  function syncArtworkGroupSelectors() {
    if (!medWrap) return;
    medWrap.querySelectorAll('.card-item[data-uid]').forEach(row => {
      const media = p.media.find(item => item._uid === row.dataset.uid);
      const selector = row.querySelector('[data-artwork-group-select]');
      if (!media || !selector) return;
      const group = artworkGroupFor(media);
      selector.innerHTML = artworkGroupOptionMarkup(media);
      selector.value = group?.id || '';
      syncArtworkGroupCard(row, media);
    });
  }

  function updateArtworkGroupCounts() {
    if (!groupList) return;
    groupList.querySelectorAll('[data-group-card]').forEach(card => {
      const group = p.mediaGroups.find(item => item.id === card.dataset.groupCard);
      if (!group) return;
      const count = p.media.filter(media => media.groupId === group.id).length;
      const countNode = card.querySelector('[data-group-assigned-count]');
      if (countNode) countNode.textContent = count + ' artwork' + (count === 1 ? '' : 's');
      const removeButton = card.querySelector('[data-remove-group]');
      if (removeButton) removeButton.setAttribute('aria-label', 'Remove ' + group.name + ' and unassign ' + count + ' artwork' + (count === 1 ? '' : 's'));
    });
  }

  function paintGroups() {
    if (!groupList) return;
    const groupCount = p.mediaGroups.length;
    if (groupCountLabel) groupCountLabel.textContent = groupCount + ' group' + (groupCount === 1 ? '' : 's');
    groupList.innerHTML = p.mediaGroups.map(group => {
      const color = normalizeArtworkGroupColor(group.color);
      const count = p.media.filter(media => media.groupId === group.id).length;
      return '<article class="artwork-group-card" data-group-card="' + attr(group.id) + '" style="--artwork-group-color:' + color + '">' +
        '<div class="artwork-group-card-fields">' +
          '<div class="field"><label class="field-label" for="artwork-group-name-' + attr(group.id) + '">Group name</label>' +
            '<input id="artwork-group-name-' + attr(group.id) + '" data-edit-group-name value="' + attr(group.name) + '" maxlength="80"></div>' +
          '<div class="field"><label class="field-label" for="artwork-group-layout-' + attr(group.id) + '">Layout</label>' +
            '<select id="artwork-group-layout-' + attr(group.id) + '" data-edit-group-layout>' +
              '<option value="grid" ' + (group.layout === 'grid' ? 'selected' : '') + '>Grid / Tiling</option>' +
              '<option value="stack" ' + (group.layout === 'stack' ? 'selected' : '') + '>Horizontal Stack</option>' +
              '<option value="cards" ' + (group.layout === 'cards' ? 'selected' : '') + '>Horizontal Card Layout</option>' +
            '</select></div>' +
          '<div class="field artwork-group-color-field"><label class="field-label" for="artwork-group-color-' + attr(group.id) + '">Color</label>' +
            '<input id="artwork-group-color-' + attr(group.id) + '" type="color" data-edit-group-color value="' + color + '" aria-label="Color for ' + attr(group.name) + '"></div>' +
          '<div class="artwork-group-card-meta"><span data-group-assigned-count>' + count + ' artwork' + (count === 1 ? '' : 's') + '</span>' +
            '<button type="button" data-remove-group>Remove group</button></div>' +
        '</div></article>';
    }).join('');

    groupList.querySelectorAll('[data-group-card]').forEach(card => {
      const group = p.mediaGroups.find(item => item.id === card.dataset.groupCard);
      if (!group) return;
      const nameInput = card.querySelector('[data-edit-group-name]');
      nameInput?.addEventListener('input', () => {
        group.name = nameInput.value;
        syncArtworkGroupSelectors();
        syncArtworkGroupCards();
        if (groupStatus) groupStatus.textContent = 'Group name updated. Remember to publish your changes.';
        markChanged();
      });
      nameInput?.addEventListener('change', () => {
        if (!String(group.name || '').trim()) group.name = group.id;
        nameInput.value = group.name;
        syncArtworkGroupSelectors();
        syncArtworkGroupCards();
      });
      card.querySelector('[data-edit-group-layout]')?.addEventListener('change', event => {
        group.layout = ['grid','stack','cards'].includes(event.target.value) ? event.target.value : 'grid';
        if (groupStatus) groupStatus.textContent = 'Layout updated. Remember to publish your changes.';
        markChanged();
      });
      card.querySelector('[data-edit-group-color]')?.addEventListener('input', event => {
        group.color = normalizeArtworkGroupColor(event.target.value);
        card.style.setProperty('--artwork-group-color', group.color);
        syncArtworkGroupCards();
        if (groupStatus) groupStatus.textContent = 'Group color updated across assigned artwork. Remember to publish your changes.';
        markChanged();
      });
      card.querySelector('[data-remove-group]')?.addEventListener('click', () => {
        const assignedCount = p.media.filter(media => media.groupId === group.id).length;
        const confirmed = assignedCount === 0 || window.confirm(
          'Remove artwork group "' + group.name + '"? This will unassign ' + assignedCount +
          ' artwork item' + (assignedCount === 1 ? '' : 's') + ', but will not delete the artwork itself.'
        );
        if (!confirmed) return;
        p.media.forEach(media => { if (media.groupId === group.id) delete media.groupId; });
        p.mediaGroups = p.mediaGroups.filter(item => item.id !== group.id);
        markChanged();
        paintGroups();
        paintMedia();
        if (groupStatus) groupStatus.textContent = assignedCount
          ? 'Group removed; ' + assignedCount + ' artwork' + (assignedCount === 1 ? ' is' : 's are') + ' now ungrouped.'
          : 'Group removed.';
      });
    });
    updateArtworkGroupCounts();
  }

  function createArtworkGroupRecord(requestedName, requestedColor, requestedLayout = 'grid') {
    const requested = String(requestedName || '').trim();
    const name = requested || 'Artwork Group ' + (p.mediaGroups.length + 1);
    const baseId = slugify(name) || 'artwork-group';
    let id = baseId, suffix = 2;
    while (p.mediaGroups.some(group => group.id === id)) id = baseId + '-' + suffix++;
    const group = {
      id,
      name,
      layout: ['grid','stack','cards'].includes(requestedLayout) ? requestedLayout : 'grid',
      color: normalizeArtworkGroupColor(requestedColor)
    };
    p.mediaGroups.push(group);
    return group;
  }

  createGroupButton?.addEventListener('click', () => {
    const group = createArtworkGroupRecord(groupNameInput?.value, groupColorInput?.value, groupLayoutInput?.value);
    const { id, name } = group;
    if (groupNameInput) groupNameInput.value = '';
    if (groupLayoutInput) groupLayoutInput.value = 'grid';
    if (groupColorInput) groupColorInput.value = DEFAULT_ARTWORK_GROUP_COLOR;
    markChanged();
    paintGroups();
    syncArtworkGroupSelectors();
    if (groupStatus) groupStatus.textContent = 'Created ' + name + '. Assign it from an artwork card below.';
    const newGroupCard = Array.from(groupList?.querySelectorAll('[data-group-card]') || []).find(card => card.dataset.groupCard === id);
    newGroupCard?.querySelector('[data-edit-group-name]')?.focus();
    toast('Artwork group created: ' + name + '.');
  });

  function paintMedia(){
    const freshWrap = document.createElement('div');
    freshWrap.setAttribute('data-medialist', '');
    p.media.forEach((m)=>{
      const isOpen = openMediaUid === m._uid;
      const row = document.createElement('div');
      row.className = 'card-item';
      row.style.background = '#191919';
      row.dataset.uid = m._uid;
      const groupOptionMarkup = artworkGroupOptionMarkup(m);
      row.innerHTML = `
        <div class="card-item-head collapsible-head" data-toggle-open>
          <span class="drag-handle" aria-hidden="true"><i class="fa-solid fa-grip-vertical"></i></span>
          <span class="item-title">${m.caption ? esc(m.caption) : '(' + esc(m.type) + ')'}</span>
          <div class="card-item-actions">
            <button class="icon-btn" data-mact="up" title="Move up"><i class="fa-solid fa-arrow-up"></i></button>
            <button class="icon-btn" data-mact="down" title="Move down"><i class="fa-solid fa-arrow-down"></i></button>
            <button class="icon-btn" data-mact="del" title="Delete" style="color:#e0584f"><i class="fa-solid fa-trash"></i></button>
            <button class="icon-btn" data-mact="toggle"><i class="fa-solid fa-chevron-${isOpen?'up':'down'}"></i></button>
          </div>
        </div>
        <div class="artwork-card-group-controls">
          <div class="artwork-card-group-summary">
            <label class="artwork-card-group-label" for="artwork-group-assign-${attr(m._uid)}">Artwork group</label>
            <span class="artwork-group-badge" data-artwork-group-badge hidden>
              <span class="artwork-group-color-swatch" data-artwork-group-swatch aria-hidden="true"></span>
              <span data-artwork-group-name></span>
            </span>
          </div>
          <select class="artwork-card-group-select" data-artwork-group-select id="artwork-group-assign-${attr(m._uid)}" aria-label="Artwork group for ${attr(m.caption || m.type)}">
            ${groupOptionMarkup}
          </select>
        </div>
        <form class="artwork-card-inline-group-create" data-inline-group-create hidden>
          <div class="field">
            <label class="field-label" for="artwork-inline-group-name-${attr(m._uid)}">New group name</label>
            <input id="artwork-inline-group-name-${attr(m._uid)}" data-inline-group-name maxlength="80" required placeholder="e.g. Character studies">
          </div>
          <div class="field artwork-group-color-field">
            <label class="field-label" for="artwork-inline-group-color-${attr(m._uid)}">Group color</label>
            <input id="artwork-inline-group-color-${attr(m._uid)}" type="color" data-inline-group-color value="${DEFAULT_ARTWORK_GROUP_COLOR}" aria-label="Color for the new artwork group">
          </div>
          <div class="artwork-card-inline-group-actions">
            <button type="submit" class="primary">Create &amp; assign</button>
            <button type="button" data-inline-group-cancel>Cancel</button>
          </div>
        </form>
        <div class="collapsible-body media-editor-body" style="display:${isOpen?'block':'none'};" data-mbody>
          <div class="row media-editor-row">
            <div class="field" style="max-width:140px"><label class="field-label">Type</label>
              <select data-mf="type">
                <option value="image" ${m.type==='image'?'selected':''}>Image</option>
                <option value="video" ${m.type==='video'?'selected':''}>Video</option>
                <option value="youtube" ${m.type==='youtube'?'selected':''}>YouTube</option>
                <option value="lottie" ${m.type==='lottie'?'selected':''}>Lottie (JSON animation)</option>
                <option value="model" ${m.type==='model'?'selected':''}>3D model</option>
              </select>
            </div>
            <div class="field"><label class="field-label">Source (file path or URL)</label><input data-mf="src" value="${attr(m.src)}" placeholder="assets/projects/your-folder/artwork.jpg"></div>
          </div>
          <div class="row media-editor-row media-editor-meta">
            <div class="field"><label class="field-label">Caption <span style="opacity:.5">(optional)</span></label><input data-mf="caption" value="${attr(m.caption)}"></div>
            <div class="field" style="max-width:180px"><label class="field-label">Orientation</label>
              <select data-mf="orientation">
                <option value="" ${!m.orientation?'selected':''}>Auto</option>
                <option value="landscape" ${m.orientation==='landscape'?'selected':''}>Landscape</option>
                <option value="portrait" ${m.orientation==='portrait'?'selected':''}>Portrait</option>
                <option value="square" ${m.orientation==='square'?'selected':''}>Square</option>
              </select>
            </div>
          </div>
          <div data-mediapreview></div>
           ${backgroundControlHtml(m.background)}
           ${m.type === 'image' ? holographicControlHtml(m.holographic) : holographicControlHtml(null)}
        </div>
      `;
      row.querySelector('[data-toggle-open]').addEventListener('click', (e)=>{
        if (e.target.closest('[data-mact]') && e.target.closest('[data-mact]').dataset.mact !== 'toggle') return;
        openMediaUid = toggleExclusiveOpenUid(openMediaUid, m._uid);
        paintMedia();
      });
      syncArtworkGroupCard(row, m);
      const groupSelector = row.querySelector('[data-artwork-group-select]');
      const inlineGroupForm = row.querySelector('[data-inline-group-create]');
      const inlineGroupName = row.querySelector('[data-inline-group-name]');
      const inlineGroupColor = row.querySelector('[data-inline-group-color]');
      groupSelector?.addEventListener('change', event => {
        const nextGroupId = String(event.target.value || '');
        if (nextGroupId === CREATE_ARTWORK_GROUP_OPTION) {
          // Keep the current assignment intact while the inline form is open.
          groupSelector.value = String(m.groupId || '');
          if (inlineGroupForm) inlineGroupForm.hidden = false;
          inlineGroupName?.focus({ preventScroll: true });
          return;
        }
        if (nextGroupId && p.mediaGroups.some(group => group.id === nextGroupId)) m.groupId = nextGroupId;
        else delete m.groupId;
        syncArtworkGroupCard(row, m);
        updateArtworkGroupCounts();
        if (groupStatus) {
          const assignedGroup = artworkGroupFor(m);
          groupStatus.textContent = assignedGroup
            ? 'Artwork assigned to ' + assignedGroup.name + '.'
            : 'Artwork ungrouped; its original appearance is preserved.';
        }
        markChanged();
      });
      inlineGroupForm?.addEventListener('submit', event => {
        event.preventDefault();
        const requestedName = String(inlineGroupName?.value || '').trim();
        if (!requestedName) {
          inlineGroupName?.focus();
          return;
        }
        const group = createArtworkGroupRecord(requestedName, inlineGroupColor?.value, 'grid');
        m.groupId = group.id;
        inlineGroupForm.hidden = true;
        if (inlineGroupName) inlineGroupName.value = '';
        if (inlineGroupColor) inlineGroupColor.value = DEFAULT_ARTWORK_GROUP_COLOR;
        markChanged();
        paintGroups();
        syncArtworkGroupSelectors();
        syncArtworkGroupCards();
        updateArtworkGroupCounts();
        if (groupStatus) groupStatus.textContent = 'Created and assigned ' + group.name + '. Remember to publish your changes.';
        toast('Created and assigned artwork group: ' + group.name + '.');
        try { groupSelector?.focus({ preventScroll: true }); } catch (_) { groupSelector?.focus(); }
      });
      row.querySelector('[data-inline-group-cancel]')?.addEventListener('click', () => {
        if (inlineGroupForm) inlineGroupForm.hidden = true;
        if (groupSelector) groupSelector.value = String(m.groupId || '');
        try { groupSelector?.focus({ preventScroll: true }); } catch (_) { groupSelector?.focus(); }
      });
      const previewEl = row.querySelector('[data-mediapreview]');
      let modelViewerCleanup = null;
      let previewGeneration = 0;
      let previewDisposed = false;

      // Invalidate the container token as well as the local generation. The
      // viewer loader may still be awaiting a large model file when this row is
      // repainted; deleting the token makes mountModelViewer discard the
      // eventual result instead of creating WebGL resources in detached DOM.
      function invalidateCurrentModelViewer() {
        const host = previewEl.querySelector('[data-model-preview]');
        const cleanup = modelViewerCleanup || host?.__modelViewerCleanup;
        modelViewerCleanup = null;
        try { cleanup?.(); } catch (_) {}
        if (host?.__modelViewerMountToken) {
          delete host.__modelViewerMountToken;
        }
      }

      function disposeMediaPreview() {
        if (previewDisposed) return;
        previewDisposed = true;
        previewGeneration += 1;
        invalidateCurrentModelViewer();
        releasePreviewMedia(previewEl);
        previewEl.replaceChildren();
      }
      row.__disposeMediaPreview = disposeMediaPreview;

      async function refreshPreview(){
        if (previewDisposed) return;
        const generation = ++previewGeneration;
        invalidateCurrentModelViewer();
        releasePreviewMedia(previewEl);
        previewEl.innerHTML = buildMediaPreviewHtml(m);
        wirePreviewAspect(previewEl.firstElementChild, m);
        const previewBox = previewEl.firstElementChild;
        if (previewBox && m.type === 'lottie' && m.background && globalThis.LMMediaBackground) {
          globalThis.LMMediaBackground.apply(previewBox, m.background, ghRawUrl);
        }
        if (m.type === 'model' && m.src) {
          const host = previewEl.querySelector('[data-model-preview]');
          try {
            const { mountModelViewer } = await import('../js/infrastructure/three/model-viewer.js?v=20261023-01');
            // The row may have been deleted/rebuilt while the module import
            // was pending. Do not mount unless this generation still owns the
            // live preview host.
            if (previewDisposed || generation !== previewGeneration ||
                !row.isConnected || !host?.isConnected ||
                previewEl.querySelector('[data-model-preview]') !== host) return;

            const cleanup = await mountModelViewer(host, ghRawUrl(m.src), {
              background: m.background || null,
              orientation: m.orientation || 'auto',
              onOrientationDetected: (detected) => {
                if (previewDisposed || generation !== previewGeneration ||
                    !row.isConnected || !host.isConnected ||
                    previewEl.querySelector('[data-model-preview]') !== host) return;
                const box = previewEl.firstElementChild;
                if (box) {
                  box.dataset.orientation = detected;
                  fitPreviewAspect(box, detected === 'landscape' ? 16/9 : detected === 'portrait' ? 9/16 : 1);
                }
              },
              resolveUrl: ghRawUrl
            });

            // If a repaint/removal raced the loader, tear down its result
            // immediately rather than retaining a detached WebGL renderer.
            if (previewDisposed || generation !== previewGeneration ||
                !row.isConnected || !host.isConnected ||
                previewEl.querySelector('[data-model-preview]') !== host) {
              try { cleanup?.(); } catch (_) {}
              return;
            }
            modelViewerCleanup = typeof cleanup === 'function' ? cleanup : null;
          } catch (err) {
            if (previewDisposed || generation !== previewGeneration ||
                !row.isConnected || !host?.isConnected ||
                previewEl.querySelector('[data-model-preview]') !== host) return;
            host.innerHTML = `<div class="model-viewer-error"><strong>Couldn't load this 3D source.</strong><br><span>Check that the file exists and is a supported OBJ, GLTF, GLB, or FBX file.</span></div>`;
          }
        }
        // If this is (or might become) the project's fallback
        // thumbnail — first image/YouTube item, thumbnail.src left
        // blank — the focus-picker preview needs to follow along too.
        if (!previewDisposed && generation === previewGeneration &&
            typeof refreshThumbPreview === 'function') refreshThumbPreview();
      }
      wireBackgroundControl(
        row,
        () => m.type,
        () => m.background,
        value => { m.background = value; refreshPreview(); },
        () => { refreshPreview(); markChanged(); }
      );
      wireHolographicControl(
        row,
        () => m.type,
        () => m.holographic,
        value => { m.holographic = value; },
        () => { refreshPreview(); markChanged(); }
      );
      attachMediaBrowseButton(row.querySelector('[data-holo-texture]'), null, {
        kind:'image',
        title:'Choose a foil / pattern image'
      });
      attachMediaBrowseButton(row.querySelector('[data-holo-mask]'), null, {
        kind:'image',
        title:'Choose a front holographic mask'
      });
      attachMediaBrowseButton(row.querySelector('[data-holo-back]'), null, {
        kind:'image',
        title:'Choose a back image'
      });
      attachMediaBrowseButton(row.querySelector('[data-holo-back-texture]'), null, {
        kind:'image',
        title:'Choose a back foil / pattern image'
      });
      attachMediaBrowseButton(row.querySelector('[data-holo-back-mask]'), null, {
        kind:'image',
        title:'Choose a back holographic mask'
      });
      refreshPreview();
      attachMediaBrowseButton(row.querySelector('[data-mf="src"]'), () => refreshPreview(), () => ({
        kind: m.type === 'lottie' ? 'lottie' : m.type === 'video' ? 'video' : m.type === 'model' ? 'model' : m.type === 'youtube' ? 'other' : 'image',
        title: m.type === 'model' ? 'Choose a 3D model' : m.type === 'lottie' ? 'Choose a Lottie JSON file' : 'Choose media'
      }));

      row.querySelectorAll('[data-mf]').forEach(inp=> inp.addEventListener('input', ()=>{
        m[inp.dataset.mf]=inp.value;
        if (inp.dataset.mf === 'caption') row.querySelector('.item-title').textContent = m.caption || '(' + m.type + ')';
        if (inp.dataset.mf === 'type' || inp.dataset.mf === 'src') {
          refreshPreview();
          row.__bgEditorSync?.();
          row.__holoEditorSync?.();
        }
        markChanged();
      }));
      row.querySelectorAll('[data-mf]').forEach(inp=> inp.addEventListener('change', ()=>{
        if (inp.dataset.mf === 'type') { row.querySelector('.item-title').textContent = m.caption || '(' + m.type + ')'; refreshPreview(); }
      }));
      row.querySelector('[data-mact="del"]').addEventListener('click', ()=>{
        const idx = p.media.findIndex(x=>x._uid===m._uid);
        if (idx > -1) p.media.splice(idx, 1);
        if (openMediaUid === m._uid) openMediaUid = null;
        markChanged(); paintGroups(); paintMedia();
      });
      row.querySelector('[data-mact="up"]').addEventListener('click', ()=>{
        const mi = p.media.indexOf(m); if(mi===0)return;
        animateReorder(() => el.querySelector('[data-medialist]'), () => { [p.media[mi-1],p.media[mi]]=[p.media[mi],p.media[mi-1]]; markChanged(); paintMedia(); });
      });
      row.querySelector('[data-mact="down"]').addEventListener('click', ()=>{
        const mi = p.media.indexOf(m); if(mi===p.media.length-1)return;
        animateReorder(() => el.querySelector('[data-medialist]'), () => { [p.media[mi+1],p.media[mi]]=[p.media[mi],p.media[mi+1]]; markChanged(); paintMedia(); });
      });
      freshWrap.appendChild(row);
    });
    // Dispose old previews before detaching the rows. This is important
    // for drag reorder, edits, delete, and collapse/expand because each repaint
    // creates a fresh media-list DOM subtree.
    Array.from(medWrap.querySelectorAll('.card-item[data-uid]')).forEach(oldRow => {
      oldRow.__disposeMediaPreview?.();
    });
    medWrap.replaceWith(freshWrap);
    medWrap = freshWrap;
    enableDragReorder(() => el.querySelector('[data-medialist]'), p.media, markChanged, paintMedia);
    // Covers add/delete/reorder even when the list is empty (each
    // row's own refreshPreview() already covers edits to that row).
    refreshThumbPreview();
    paintGroups();
  }
  paintMedia();
  el.querySelector('[data-addmedia]').addEventListener('click', ()=>{
    const fresh = {type:'image',src:'',caption:'',orientation:'',background:null,holographic:null,_uid:uid()};
    p.media.push(fresh);
    openMediaUid = fresh._uid; // new artwork becomes the sole open editor
    markChanged(); paintMedia();
  });
}

RENDERERS.curatedViews = async function(data, isCurrent=()=>true){
  const raw=Array.isArray(data.json)?data.json:[];
  // The Curated Views editor can render from its own file immediately. Main
  // Portfolio projects are secondary hydration data used for labels and the
  // Add Project picker, so a slow/unavailable projects request must never
  // block the primary Curated Views editor shell.
  let mains=[];
  let mainById=new Map();
  let views=withUids(raw.map(v=>({
    id:String(v.id||slugify(v.name||'')),name:String(v.name||''),slug:String(v.slug||v.id||slugify(v.name||'')),
    projects:withUids((Array.isArray(v.projects)?v.projects:[]).map(e=>{
      if(e?.source==='curated'&&e.project){
        const p=e.project;
        return {source:'curated',_uid:uid(),project:{
          id:String(p.id||slugify(p.title||'')),title:p.title||'',subtitle:p.subtitle||'',badge:p.badge||'',
          badges:Array.isArray(p.badges)?[...new Set(p.badges.map(x=>String(x||'').trim()).filter(Boolean))]:(p.badge?[String(p.badge).trim()]:[]),filters:[],description:p.description||'',
          extensions:p.extensions && typeof p.extensions === 'object' && !Array.isArray(p.extensions) ? structuredClone(p.extensions) : undefined,
          thumbnail:{type:p.thumbnail?.type||'image',src:p.thumbnail?.src||'',focus:p.thumbnail?.focus||'50% 50%',zoom:p.thumbnail?.zoom||1,background:p.thumbnail?.background||null},
          mediaGroups:Array.isArray(p.mediaGroups)?p.mediaGroups.map(g=>({id:String(g.id||''),name:String(g.name||''),layout:String(g.layout||'grid'),color:normalizeArtworkGroupColor(g.color)})):[],
          media:withUids(Array.isArray(p.media)?p.media.map(m=>({type:m.type||'image',src:m.src||'',caption:m.caption||'',groupId:String(m.groupId||''),orientation:m.orientation||'',background:m.background||null,holographic:m.holographic && typeof m.holographic === 'object' && !Array.isArray(m.holographic) ? structuredClone(m.holographic) : null})):[])
        }};
      }
      return {source:'main',projectId:String(e?.projectId||''),_uid:uid()};
    }))
  })));
  let openUid=null;
  let mainProjectsReady=Promise.resolve();
  const uniqueSlug=name=>{
    const base=slugify(name)||'curated-view';let s=base,n=2;
    while(views.some(v=>v.slug===s))s=`${base}-${n++}`;return s;
  };
  const uniqueProjectId=(view,title)=>{
    const used=new Set(mains.map(p=>String(p.id||slugify(p.title||''))));
    view.projects.forEach(e=>{if(e.source==='curated'&&e.project?.id)used.add(e.project.id);});
    const base=slugify(title)||'curated-project';let id=base,n=2;
    while(used.has(id))id=`${base}-${n++}`;return id;
  };
  const viewUrl=v=>`${new URL('../',location.href).href}#${encodeURIComponent(v.slug)}`;
  const copyLink=async v=>{const u=viewUrl(v);try{await navigator.clipboard.writeText(u);toast('Curated View link copied.');}catch(e){prompt('Copy this Curated View link:',u);}};
  const label=e=>e.source==='curated'?e.project?.title||'(untitled curated project)':mainById.get(e.projectId)?.title||`(missing main project: ${e.projectId||'unknown'})`;
  const serialize=v=>({id:v.id,name:v.name,slug:v.slug,projects:v.projects.map(e=>{
    if(e.source==='main')return {source:'main',projectId:e.projectId};
    const p=validateProjectEditorModel(e.project,{requireFilters:false});p.filters=[];
    return {source:'curated',project:serializeProjectEditorModel(p)};
  })});

  function paint(){
    content.innerHTML=sectionHead('Curated Views','Unlisted presentations built from the same portfolio projects. Main projects stay referenced; curated-only projects belong only to the view that owns them.')+`
      <div class="banner info"><i class="fa-solid fa-link"></i><div>A Curated View is not a separate website or a copy of your portfolio. Anyone with its link can open it, and changes here never reorder or delete Main Portfolio projects.</div></div>
      <div id="curatedViewList"></div><button class="add-btn" id="addCuratedView"><i class="fa-solid fa-plus"></i> Create Curated View</button>`;
    const list=document.getElementById('curatedViewList');
    if(!views.length)list.innerHTML='<div class="banner muted">No Curated Views yet — create one below.</div>';
    views.forEach(v=>{
      const open=v._uid===openUid,card=document.createElement('div');card.className='card-item';card.dataset.uid=v._uid;
      card.innerHTML=`<div class="card-item-head collapsible-head" data-toggle-open><span class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></span><span class="project-item-label"><span class="item-title">${esc(v.name)||'(untitled Curated View)'}</span><span class="project-preview-text">#${esc(v.slug)} · ${v.projects.length} project${v.projects.length===1?'':'s'}</span></span><div class="card-item-actions"><button class="icon-btn" data-act="copy" title="Copy link"><i class="fa-solid fa-link"></i></button><button class="icon-btn" data-act="up" title="Move up"><i class="fa-solid fa-arrow-up"></i></button><button class="icon-btn" data-act="down" title="Move down"><i class="fa-solid fa-arrow-down"></i></button><button class="icon-btn" data-act="del" title="Delete" style="color:#e0584f"><i class="fa-solid fa-trash"></i></button><button class="icon-btn" data-act="toggle"><i class="fa-solid fa-chevron-${open?'up':'down'}"></i></button></div></div><div class="collapsible-body" style="display:${open?'block':'none'};margin-top:16px" data-body></div>`;
      card.querySelector('[data-toggle-open]').onclick=e=>{if(e.target.closest('[data-act]')?.dataset.act!=='toggle'&&e.target.closest('[data-act]'))return;openUid=open?null:v._uid;paint();};
      card.querySelector('[data-act="copy"]').onclick=e=>{e.stopPropagation();copyLink(v);};
      card.querySelector('[data-act="del"]').onclick=e=>{e.stopPropagation();if(!confirm(`Delete "${v.name||'this Curated View'}"? Main Portfolio projects will not be deleted.`))return;views=views.filter(x=>x!==v);if(openUid===v._uid)openUid=null;markDirty();paint();};
      card.querySelector('[data-act="up"]').onclick=e=>{e.stopPropagation();const i=views.indexOf(v);if(i===0)return;[views[i-1],views[i]]=[views[i],views[i-1]];markDirty();paint();};
      card.querySelector('[data-act="down"]').onclick=e=>{e.stopPropagation();const i=views.indexOf(v);if(i===views.length-1)return;[views[i+1],views[i]]=[views[i],views[i+1]];markDirty();paint();};
      if(open)buildBody(card.querySelector('[data-body]'),v);
      list.appendChild(card);
    });
    document.getElementById('addCuratedView').onclick=()=>{const name=prompt('Curated View name:');if(!name?.trim())return;const s=uniqueSlug(name.trim()),v={id:s,name:name.trim(),slug:s,projects:[],_uid:uid()};views.push(v);openUid=v._uid;markDirty();paint();};
    wireSave(()=>views.map(serialize),'curatedViews',SECTIONS.curatedViews.file);
  }

  function buildBody(el,v){
    el.innerHTML=`<div class="row"><div class="field"><label class="field-label">Name</label><input data-name value="${attr(v.name)}"></div><div class="field"><label class="field-label">Unlisted link</label><div class="browse-row"><input value="#${attr(v.slug)}" readonly><button type="button" class="icon-btn" data-copy title="Copy link"><i class="fa-solid fa-copy"></i></button></div></div></div><div class="panel" style="background:#141414"><h3 style="font-size:.85rem">Projects in this view</h3><p class="panel-sub">Add existing Main Portfolio projects or create a Curated-only project. Order here does not affect the Main Portfolio.</p><div data-list></div><div class="row" style="margin-top:12px"><button class="add-btn" type="button" data-add><i class="fa-solid fa-plus"></i> Add Project</button><button class="ghost" type="button" data-create><i class="fa-solid fa-file-circle-plus"></i> Create Project</button></div></div>`;
    el.querySelector('[data-name]').oninput=e=>{v.name=e.target.value;markDirty();};
    el.querySelector('[data-copy]').onclick=()=>copyLink(v);
    const host=el.querySelector('[data-list]');
    function repaint(){
      host.innerHTML='';
      v.projects.forEach(e=>{
        const row=document.createElement('div');row.className='card-item';row.dataset.uid=e._uid;
        row.innerHTML=`<div class="card-item-head"><span class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></span><span class="project-item-label"><span class="item-title">${esc(label(e))}</span><span class="project-preview-text">${e.source==='main'?'Main Portfolio reference':'Curated-only project'}</span></span><div class="card-item-actions"><button class="icon-btn" data-up><i class="fa-solid fa-arrow-up"></i></button><button class="icon-btn" data-down><i class="fa-solid fa-arrow-down"></i></button><button class="icon-btn" data-remove style="color:#e0584f"><i class="fa-solid fa-trash"></i></button></div></div>${e.source==='curated'?'<div data-editor style="margin-top:14px"></div>':''}`;
        row.querySelector('[data-remove]').onclick=()=>{if(e.source==='curated'&&!confirm(`Delete curated-only project "${e.project?.title||'this project'}"? It belongs only to this view.`))return;v.projects.splice(v.projects.indexOf(e),1);markDirty();repaint();};
        row.querySelector('[data-up]').onclick=()=>{const i=v.projects.indexOf(e);if(i===0)return;[v.projects[i-1],v.projects[i]]=[v.projects[i],v.projects[i-1]];markDirty();repaint();};
        row.querySelector('[data-down]').onclick=()=>{const i=v.projects.indexOf(e);if(i===v.projects.length-1)return;[v.projects[i+1],v.projects[i]]=[v.projects[i],v.projects[i+1]];markDirty();repaint();};
        if(e.source==='curated')buildProjectBody(row.querySelector('[data-editor]'),e.project,{showFilters:false,onChanged:markDirty,filterDefs:[]});
        host.appendChild(row);
      });
      if(!v.projects.length)host.innerHTML='<div class="banner muted">No projects in this view yet.</div>';
    }
    el.querySelector('[data-add]').onclick=async()=>{
      await mainProjectsReady;
      if(!isCurrent()) return;
      const overlay=document.createElement('div');overlay.className='media-picker-overlay curated-project-picker-overlay';
      overlay.innerHTML=`<div class="media-picker-dialog curated-project-picker-dialog" role="dialog" aria-modal="true" aria-label="Add Main Portfolio projects"><div class="media-picker-head"><div><strong>Add Project</strong><span class="media-picker-sub">Choose an existing Main Portfolio project to add to this view.</span></div><button class="icon-btn" data-close type="button"><i class="fa-solid fa-xmark"></i></button></div><div class="media-picker-toolbar curated-project-picker-toolbar"><div class="curated-picker-help">Only projects not already in this Curated View are shown.</div><input class="picker-search" data-search type="search" placeholder="Search by project title or subtitle…" aria-label="Search Main Portfolio projects"></div><div class="media-picker-scroll curated-project-picker-scroll"><div class="curated-project-grid" data-grid></div></div></div>`;
      const opener=document.activeElement;
      let closed=false;
      document.body.appendChild(overlay);
      const grid=overlay.querySelector('[data-grid]');
      const search=overlay.querySelector('[data-search]');
      const close=()=>{
        if(closed)return;
        closed=true;
        document.removeEventListener('keydown',escHandler);
        overlay.remove();
        if(opener && typeof opener.focus==='function') opener.focus({preventScroll:true});
      };
      function escHandler(e){ if(e.key==='Escape') close(); }
      overlay.querySelector('[data-close]').onclick=close;
      overlay.onclick=e=>{if(e.target===overlay)close();};
      document.addEventListener('keydown',escHandler);
      search.focus({preventScroll:true});
      function draw(){
        const q=search.value.trim().toLowerCase();
        const used=new Set(v.projects.filter(x=>x.source==='main').map(x=>x.projectId));
        grid.innerHTML='';
        const available=mains.filter(p=>{
          const id=String(p.id||slugify(p.title||''));
          return !used.has(id) && (!q || `${p.title||''} ${p.subtitle||''}`.toLowerCase().includes(q));
        });
        available.forEach(p=>{
          const id=String(p.id||slugify(p.title||''));
          const b=document.createElement('button');
          b.type='button';
          b.className='curated-project-option';
          b.setAttribute('aria-label',`Add ${p.title||'untitled project'} to this Curated View`);
          const thumb=p.thumbnail?.src
            ? {type:p.thumbnail.type||'image',src:p.thumbnail.src,background:p.thumbnail.background||null,orientation:''}
            : computeFallbackThumb(p.media,p.thumbnail);
          let preview='';
          if(thumb?.src){
            if(thumb.type==='image') preview=`<img src="${attr(ghRawUrl(thumb.src))}" alt="" loading="lazy">`;
            else if(thumb.type==='video') preview=`<video src="${attr(ghRawUrl(thumb.src))}" muted playsinline preload="metadata"></video>`;
            else if(thumb.type==='lottie') preview=`<lottie-player src="${attr(ghRawUrl(thumb.src))}" autoplay loop background="transparent"></lottie-player>`;
          }
          if(!preview){
            const icon=thumb?.type==='model'?'fa-cube':'fa-image';
            preview=`<span class="curated-project-placeholder"><i class="fa-solid ${icon}" aria-hidden="true"></i><span>No thumbnail preview</span></span>`;
          }
          b.innerHTML=`<span class="curated-project-preview">${preview}<span class="curated-project-type">${esc(thumb?.type||'project')}</span></span><span class="curated-project-meta"><span class="curated-project-title">${esc(p.title||'(untitled project)')}</span><span class="curated-project-subtitle">${esc(p.subtitle||'No subtitle')}</span></span>`;
          b.onclick=()=>{v.projects.push({source:'main',projectId:id,_uid:uid()});markDirty();close();repaint();};
          grid.appendChild(b);
        });
        if(!grid.children.length)grid.innerHTML='<div class="banner muted curated-project-empty">No available Main Portfolio projects match this search.</div>';
      };
      search.oninput=draw;draw();
    };
    el.querySelector('[data-create]').onclick=async()=>{
      await mainProjectsReady;
      if(!isCurrent()) return;
      const title=prompt('Curated-only project title:');
      if(!title?.trim())return;
      v.projects.push({source:'curated',project:{id:uniqueProjectId(v,title.trim()),title:title.trim(),subtitle:'',badge:'',badges:[],filters:[],description:'',thumbnail:{type:'image',src:'',focus:'50% 50%',zoom:1},media:[],_uid:uid()},_uid:uid()});
      markDirty();repaint();
    };
    repaint();
  }

  paint();

  // Hydrate Main Portfolio references after the editor is already usable.
  // Updating labels in place preserves the open view and any unsaved edits.
  mainProjectsReady=loadSection('projects').then(pResult=>{
    if(!isCurrent()) return;
    mains=Array.isArray(pResult.json)?pResult.json:[];
    mainById=new Map(mains.map(p=>[String(p.id||slugify(p.title||'')),p]));
    views.forEach(v=>{
      const card=list.querySelector(`.card-item[data-uid="${v._uid}"]`);
      if(!card) return;
      v.projects.forEach(e=>{
        if(e.source!=='main') return;
        const row=card.querySelector(`.card-item[data-uid="${e._uid}"]`);
        const title=row?.querySelector('.item-title');
        if(title) title.textContent=label(e);
      });
    });
  }).catch(()=>{});

  return Promise.resolve();
}

function buildProjectListPreviewHtml(project){
  const explicit = project?.thumbnail?.src ? {
    type: project.thumbnail.type || 'image',
    src: project.thumbnail.src,
    background: project.thumbnail.background || null,
    orientation: project.thumbnail.orientation || 'auto'
  } : null;
  const fallback = explicit ? null : computeFallbackThumb(project?.media || [], project?.thumbnail || {});
  const preview = explicit || fallback;
  const type = String(preview?.type || project?.thumbnail?.type || project?.media?.[0]?.type || 'image').toLowerCase();
  const source = String(preview?.src || '').trim();
  const background = preview?.background && typeof preview.background === 'object' ? preview.background : null;
  const orientation = String(preview?.orientation || 'auto');
  const title = String(project?.title || 'Project artwork');

  if (source && type === 'image' && !validateMediaSource('image', source)) {
    return `<span class="project-collapsed-image-wrap"><img src="${attr(ghRawUrl(source))}" alt="" loading="lazy" decoding="async"></span>`;
  }
  if (source && ['video','lottie','model'].includes(type) && !validateMediaSource(type, source)) {
    if (type === 'video') return `<span class="project-collapsed-image-wrap project-collapsed-media-wrap"><video class="project-collapsed-media" data-collapsed-preview-media data-preview-type="video" data-preview-src="${attr(source)}" muted loop playsinline preload="none" aria-label="${attr(title)}"></video></span>`;
    if (type === 'lottie') return `<span class="project-collapsed-image-wrap project-collapsed-media-wrap"><lottie-player class="project-collapsed-media" data-collapsed-preview-media data-preview-type="lottie" data-preview-src="${attr(source)}" background="transparent" preserveAspectRatio="xMidYMid slice"></lottie-player></span>`;
    return `<span class="project-collapsed-image-wrap project-collapsed-media-wrap"><div class="model-viewer-shell project-collapsed-model" data-collapsed-preview-media data-preview-type="model" data-preview-src="${attr(source)}" data-preview-orientation="${attr(orientation)}" data-preview-background="${attr(JSON.stringify(background || {}))}" role="img" aria-label="${attr(title)}"></div></span>`;
  }
  const icons = {video:'fa-solid fa-film',youtube:'fa-brands fa-youtube',lottie:'fa-solid fa-wand-magic-sparkles',model:'fa-solid fa-cube',image:'fa-regular fa-image'};
  const label = {video:'VIDEO',youtube:'YOUTUBE',lottie:'LOTTIE',model:'3D',image:'MEDIA'};
  return `<span class="project-collapsed-placeholder"><i class="${icons[type] || icons.image}" aria-hidden="true"></i><span>${label[type] || 'MEDIA'}</span></span>`;
}

let projectListPreviewRuntimePromise = null;
let disposeProjectListPreviews = () => {};
function activateProjectListPreviews(root){
  let disposed = false, cleanup = () => {};
  if (!projectListPreviewRuntimePromise) projectListPreviewRuntimePromise = import('./project-preview-runtime.js?v=20261023-01');
  projectListPreviewRuntimePromise.then(({mountProjectListPreviews}) => {
    if (disposed || !root?.isConnected) return;
    cleanup = mountProjectListPreviews(root, {resolveUrl:ghRawUrl});
    if (disposed) cleanup();
  }).catch(error => { if (!disposed) console.warn('CMS Projects: media thumbnail previews could not be mounted.', error); });
  return () => { disposed = true; try { cleanup(); } catch (_) {} };
}

RENDERERS.projects = async function(data, isCurrent=()=>true){
  let items = withUids((data.json||[]).map(p=>({
    id:p.id||slugify(p.title||''), title:p.title||'', subtitle:p.subtitle||'',
    badges:Array.isArray(p.badges) ? [...new Set(p.badges.map(x=>String(x||'').trim()).filter(Boolean))] : (p.badge ? [String(p.badge).trim()] : []),
    badge:p.badge||'',
    filters:Array.isArray(p.filters)?[...p.filters]:[], description:p.description||'',
    extensions:p.extensions && typeof p.extensions === 'object' && !Array.isArray(p.extensions) ? structuredClone(p.extensions) : undefined,
    thumbnail:{ type:(p.thumbnail&&p.thumbnail.type)||'image', src:(p.thumbnail&&p.thumbnail.src)||'', focus:(p.thumbnail&&p.thumbnail.focus)||'50% 50%', zoom:(p.thumbnail&&p.thumbnail.zoom)||1, background:(p.thumbnail&&p.thumbnail.background)||null },
    mediaGroups:Array.isArray(p.mediaGroups)?p.mediaGroups.map(g=>({id:String(g.id||''),name:String(g.name||''),layout:String(g.layout||'grid'),color:normalizeArtworkGroupColor(g.color)})):[],
          media:withUids(Array.isArray(p.media)?p.media.map(m=>({type:m.type||'image',src:m.src||'',caption:m.caption||'',groupId:String(m.groupId||''),orientation:m.orientation||'',background:m.background||null,holographic:m.holographic && typeof m.holographic === 'object' && !Array.isArray(m.holographic) ? structuredClone(m.holographic) : null})):[])
  })));
  let filterDefs = [];
  let badgeDefs = [];
  try{
    const f = await loadSection('filters'); const raw=f.json||[];
    filterDefs=Array.isArray(raw)?raw:(raw.filters||[]);
    badgeDefs=Array.isArray(raw)?[]:(Array.isArray(raw.badges)?raw.badges:[]);
  }catch(e){}
  if(!isCurrent()) return;
  // Projects opens as a list by default. A project only enters its
  // expanded editing state after the visitor explicitly opens that row.
  let openUid = null;

  function paint(){
    disposeProjectListPreviews();
    disposeProjectListPreviews = () => {};
    content.innerHTML = sectionHead('Projects', 'Order here is the order on the page. Drag the handle to reorder, or click a project to expand and edit it.') + `
      <div id="projList"></div>
      <button class="add-btn" id="addProj"><i class="fa-solid fa-plus"></i> Add project</button>
    `;
    const list = document.getElementById('projList');
    if(!items.length) list.innerHTML = `<div class="banner muted">No projects yet — add one below.</div>`;

    items.forEach((p)=>{
      const isOpen = p._uid === openUid;
      const projectIndex = items.indexOf(p);
      const wrap = document.createElement('div');
      wrap.className = 'card-item project-list-item' + (isOpen ? ' is-open' : ' is-collapsed');
      wrap.dataset.uid = p._uid;
      const projectPreview = buildProjectListPreviewHtml(p);
      wrap.innerHTML = `
        <div class="card-item-head project-card-head" data-toggle-open>
          <span class="drag-handle" title="Drag to reorder"><i class="fa-solid fa-grip-vertical"></i></span>
          <span class="project-item-label">
            <span class="item-title">${esc(p.title)||'(untitled project)'} ${lastMediaImpact.projectIds.includes(String(p.id||slugify(p.title||'')))?'<span class="media-impact-dot" title="A media path was updated in this project" aria-label="Media path updated"></span>':''} ${p.badges?.length?`<span class="project-attribute-summary"> — ${esc(p.badges.join(' · '))}</span>`:''}</span>
            <span class="project-preview-text">${esc(p.subtitle||'')}</span>
          </span>
          <span class="project-collapsed-preview" aria-hidden="true">${projectPreview}</span>
          <div class="card-item-actions project-card-actions">
            <button class="icon-btn" data-act="up" type="button" title="Move project up" aria-label="Move project up" ${projectIndex===0?'disabled':''}><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>
            <button class="icon-btn" data-act="down" type="button" title="Move project down" aria-label="Move project down" ${projectIndex===items.length-1?'disabled':''}><i class="fa-solid fa-arrow-down" aria-hidden="true"></i></button>
            <button class="icon-btn project-delete-action" data-act="del" type="button" title="Delete project" aria-label="Delete project"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
            <button class="icon-btn project-toggle-action" data-act="toggle" type="button" title="${isOpen ? 'Collapse project' : 'Expand project'}" aria-label="${isOpen ? 'Collapse project' : 'Expand project'}" aria-expanded="${isOpen ? 'true' : 'false'}"><i class="fa-solid fa-chevron-${isOpen?'up':'down'}" aria-hidden="true"></i></button>
          </div>
        </div>
        <div data-body class="project-editor-body" style="display:${isOpen?'block':'none'};margin-top:16px;"></div>
      `;
      wrap.querySelector('[data-toggle-open]').addEventListener('click', (e)=>{
        if(e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act !== 'toggle') return;
        const impactId=String(p.id||slugify(p.title||''));
        if(!isOpen && lastMediaImpact.projectIds.includes(impactId)){
          lastMediaImpact.projectIds=lastMediaImpact.projectIds.filter(id=>id!==impactId);
        }
        openUid = toggleExclusiveOpenUid(openUid, p._uid); paint();
      });
      wrap.querySelector('[data-act="del"]').addEventListener('click',(e)=>{
        e.stopPropagation();
        if(!confirm(`Delete "${p.title||'this project'}"?`))return;
        items = items.filter(x=>x._uid!==p._uid); if(openUid===p._uid)openUid=null; flagUnsaved(); paint();
      });
      wrap.querySelector('[data-act="up"]').addEventListener('click',(e)=>{
        e.stopPropagation();
        const i = items.indexOf(p); if(i===0)return;
        animateReorder(() => document.getElementById('projList'), () => { [items[i-1],items[i]]=[items[i],items[i-1]]; flagUnsaved(); paint(); });
      });
      wrap.querySelector('[data-act="down"]').addEventListener('click',(e)=>{
        e.stopPropagation();
        const i = items.indexOf(p); if(i===items.length-1)return;
        animateReorder(() => document.getElementById('projList'), () => { [items[i+1],items[i]]=[items[i],items[i+1]]; flagUnsaved(); paint(); });
      });

      if(isOpen) buildProjectBody(wrap.querySelector('[data-body]'), p, {filterDefs, badgeDefs});
      list.appendChild(wrap);
    });

    disposeProjectListPreviews = activateProjectListPreviews(list);

    document.getElementById('addProj').addEventListener('click', ()=>{
      const p = {id:'',title:'',subtitle:'',badge:'',badges:[],filters:[],description:'',thumbnail:{type:'image',src:'',focus:'50% 50%',zoom:1},media:[],_uid:uid()};
      items.push(p);
      openUid = p._uid; flagUnsaved(); paint();
    });
    enableDragReorder(() => document.getElementById('projList'), items, flagUnsaved, paint);

    wireSave(()=>{
      items.forEach(p => validateProjectEditorModel(p));
      return items.map(serializeProjectEditorModel);
    }, 'projects', SECTIONS.projects.file);
  }

  paint();
};

/* =====================================================================
   12. SECTION: ABOUT PAGE
   ===================================================================== */
RENDERERS.about = function(data){
  let a = data.json || {};
  // Each software skill can be shown as its logo instead of its name
  // — see buildSoftwareSkills() below — so it's an object, not a
  // plain string, going forward: {name, icon}. This normalizes older
  // data (a plain array of strings) into that shape on load, so it
  // still opens correctly instead of erroring on the first skill.
  // Multimedia Skills has no logo option (styles like "3D Modeling"
  // don't have a brand mark to show), so it stays plain strings.
  a.softwareSkills = (a.softwareSkills || []).map(s => typeof s === 'string' ? { name: s, icon: '' } : s);
  a.multimediaSkills = a.multimediaSkills || [];
  // Normalizes the old plain-string photo ("assets/.../profile.webp")
  // into the same {src, zoom, focus, rotate} shape a project's
  // thumbnail already uses, so data saved before this editor existed
  // still loads without an error — it just opens with zoom/rotate at
  // their defaults and focus centered.
  a.photo = typeof a.photo === 'string' ? { src: a.photo } : (a.photo || {});
  a.photo.zoom = a.photo.zoom || 1;
  a.photo.focus = a.photo.focus || '50% 50%';
  a.photo.rotate = a.photo.rotate || 0;
  // withUids() gives each entry a stable ._uid, which is how
  // enableDragReorder tracks a card through a drag — the same
  // mechanism Hero Messages, Filters & Badges, and Projects already
  // use, so dragging one of these feels identical to dragging those.
  a.experience = withUids((a.experience || []).map(x=>({...x,startDate:x.startDate||'',endDate:x.endDate||''})));
  a.education = withUids((a.education || []).map(x=>({...x,school:x.school||x.title||'',degree:x.degree||'',graduationDate:x.graduationDate||''})));
  a.awards = withUids(a.awards || []);

  function paint(){
    content.innerHTML = sectionHead('About Page','The whole About page as one record — nothing here needs the HTML touched again.') + `
      <div class="panel">
        <h3>Header</h3>
        <div class="field"><label class="field-label">Headline</label><input id="a_headline" value="${attr(a.headline||'')}"></div>
        <div class="field"><label class="field-label">Subhead</label><input id="a_subhead" value="${attr(a.subhead||'')}"></div>
        <div class="field"><label class="field-label">Bio</label><textarea id="a_bio" rows="4">${esc(a.bio||'')}</textarea></div>
      </div>

      <div class="panel" style="background:#141414;">
        <h3 style="font-size:.85rem">Profile Photo</h3>
        <p class="panel-sub">Shown as a circle on the About page — the preview matches that shape, and the same zoom/focus/rotate a project thumbnail supports work here too.</p>
        <div class="two-col">
          <div>
            <div class="field"><label class="field-label">Path or URL</label><input id="a_photo" value="${attr(a.photo.src)}" placeholder="assets/projects/site/profile.webp"></div>
            <p class="hint">Pick from Media Library, paste a repo path, or a full image URL.</p>
            <div class="row">
              <div class="field"><label class="field-label">Zoom</label><input id="a_photo_zoom" type="number" step="0.05" value="${a.photo.zoom}"></div>
              <div class="field"><label class="field-label">Rotate (deg)</label><input id="a_photo_rotate" type="number" step="1" value="${a.photo.rotate}"></div>
            </div>
            <div class="field"><label class="field-label">Focus (x% y%)</label><input id="a_photo_focus" value="${attr(a.photo.focus)}"></div>
          </div>
          <div>
            <label class="field-label">Drag to set focus point</label>
            <div class="focus-picker" id="a_photo_focuspicker">
              <img id="a_photo_focusimg" style="display:none" onerror="handleMissingFile(this,'photo')">
              <div class="focus-crosshair" id="a_photo_crosshair"></div>
            </div>
            <label class="field-label" style="margin-top:16px">Preview (circle, as shown on the page)</label>
            <div id="a_photo_preview" style="width:140px;height:140px;border-radius:50%;overflow:hidden;background:#0a0a0a repeating-conic-gradient(#151515 0% 25%,#0a0a0a 0% 50%) 0 0/16px 16px;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;"></div>
          </div>
        </div>
      </div>

      <div class="panel">
        <h3>Software Skills</h3>
        <p class="panel-sub">Click the small square on any skill to set a specific logo by hand — otherwise it's looked up automatically. Whether logos show at all, site-wide, is the "Software skill logos" switch in Settings &amp; Toggles.</p>
        <div class="tagbox" id="tags_software"></div>
      </div>
      <div class="panel">
        <h3>Multimedia Skills</h3>
        <div class="tagbox" id="tags_multimedia"></div>
      </div>

      <div class="panel">
        <h3>Work Experience</h3>
        <div id="expList"></div>
        <button class="add-btn" id="addExp"><i class="fa-solid fa-plus"></i> Add role</button>
      </div>

      <div class="panel">
        <h3>Education</h3>
        <div id="eduList"></div>
        <button class="add-btn" id="addEdu"><i class="fa-solid fa-plus"></i> Add entry</button>
      </div>

      <div class="panel">
        <h3>Awards & Recognition</h3>
        <div id="awList"></div>
        <button class="add-btn" id="addAward"><i class="fa-solid fa-plus"></i> Add entry</button>
      </div>
    `;
    ['a_headline','a_subhead','a_bio'].forEach(id=>document.getElementById(id).addEventListener('input',flagUnsaved));

    // Profile photo: live circular preview + zoom/rotate/focus, the
    // same three adjustments a project's thumbnail already supports —
    // see buildProjectBody's focus picker above for the original of
    // this pattern; kept separate rather than shared because the two
    // work off different-shaped state (p.thumbnail vs a.photo), and
    // this section is only ever built once per visit to About Page,
    // not repainted on every keystroke the way a project card is.
    const photoInput = document.getElementById('a_photo');
    const photoZoomInput = document.getElementById('a_photo_zoom');
    const photoRotateInput = document.getElementById('a_photo_rotate');
    const photoFocusInput = document.getElementById('a_photo_focus');
    const photoPreviewBox = document.getElementById('a_photo_preview');
    const photoPicker = document.getElementById('a_photo_focuspicker');
    const photoFocusImg = document.getElementById('a_photo_focusimg');
    const photoCrosshair = document.getElementById('a_photo_crosshair');

    function refreshPhotoPreview(){
      const src = a.photo.src.trim();
      const transform = `scale(${a.photo.zoom||1}) rotate(${a.photo.rotate||0}deg)`;
      // transform-origin has to match object-position here, same
      // reasoning as the project thumbnail preview above — otherwise
      // the zoom scales from dead center regardless of where the
      // focus point actually is, which is exactly the "zoom doesn't
      // zoom on that location" bug.
      photoPreviewBox.innerHTML = src
        ? `<img src="${attr(ghRawUrl(src))}" style="width:100%;height:100%;object-fit:cover;display:block;object-position:${attr(a.photo.focus)};transform-origin:${attr(a.photo.focus)};transform:${transform}" onerror="this.parentElement.innerHTML='&lt;i class=&quot;fa-solid fa-triangle-exclamation&quot; style=&quot;color:#e0584f;font-size:22px&quot; title=&quot;Couldn\\'t find this file — see the preview above&quot;&gt;&lt;/i&gt;'">`
        : `<i class="fa-solid fa-user" style="color:#555;font-size:32px"></i>`;
      photoFocusImg.style.display = src ? '' : 'none';
      if (src) photoFocusImg.src = ghRawUrl(src);
    }
    function setPhotoCrosshairFromFocusStr(){
      const parts = (a.photo.focus||'50% 50%').split(' ').map(s=>parseFloat(s)||50);
      photoCrosshair.style.left = parts[0] + '%';
      photoCrosshair.style.top = parts[1] + '%';
    }
    setPhotoCrosshairFromFocusStr();
    refreshPhotoPreview();

    photoInput.addEventListener('input', () => { a.photo.src = photoInput.value; flagUnsaved(); refreshPhotoPreview(); });
    attachMediaBrowseButton(photoInput, () => { a.photo.src = photoInput.value; flagUnsaved(); refreshPhotoPreview(); });
    photoZoomInput.addEventListener('input', () => { a.photo.zoom = parseFloat(photoZoomInput.value) || 1; flagUnsaved(); refreshPhotoPreview(); });
    photoRotateInput.addEventListener('input', () => { a.photo.rotate = parseFloat(photoRotateInput.value) || 0; flagUnsaved(); refreshPhotoPreview(); });
    photoFocusInput.addEventListener('input', () => { a.photo.focus = photoFocusInput.value; setPhotoCrosshairFromFocusStr(); flagUnsaved(); refreshPhotoPreview(); });

    function pointerToPhotoFocus(e){
      const rect = photoPicker.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const x = Math.max(0, Math.min(100, (cx/rect.width)*100));
      const y = Math.max(0, Math.min(100, (cy/rect.height)*100));
      a.photo.focus = `${x.toFixed(0)}% ${y.toFixed(0)}%`;
      photoCrosshair.style.left = x+'%'; photoCrosshair.style.top = y+'%';
      photoFocusInput.value = a.photo.focus;
      flagUnsaved();
      refreshPhotoPreview();
    }
    let draggingPhotoFocus = false;
    photoPicker.style.touchAction='none';
    photoPicker.addEventListener('pointerdown', e=>{
      if(e.pointerType==='mouse' && e.button!==0) return;
      draggingPhotoFocus=true;
      photoPicker.setPointerCapture?.(e.pointerId);
      pointerToPhotoFocus(e);
    });
    photoPicker.addEventListener('pointermove', e=>{
      if(!draggingPhotoFocus) return;
      e.preventDefault();
      pointerToPhotoFocus(e);
    });
    photoPicker.addEventListener('pointerup', e=>{
      draggingPhotoFocus=false;
      try { photoPicker.releasePointerCapture?.(e.pointerId); } catch (_) {}
    });
    photoPicker.addEventListener('pointercancel', ()=>{ draggingPhotoFocus=false; });

    buildSoftwareSkills('tags_software', a.softwareSkills);
    buildTagBox('tags_multimedia', a.multimediaSkills, 'e.g. 3D Modeling');
    buildExperience();
    buildEducation();
    buildSimpleRepeater('awList', a.awards, 'addAward', [{f:'title',ph:'Award title'},{f:'detail',ph:'Where / when'}]);

    wireSave(()=>({
      headline: val('a_headline'), subhead: val('a_subhead'), bio: val('a_bio'),
      // a.photo is a live object (src/zoom/focus/rotate) mutated
      // directly by the photo editor's fields above, not a plain
      // input value — val('a_photo') alone would only ever save the
      // path and silently drop the zoom/focus/rotate you just set.
      photo: { src: a.photo.src, zoom: a.photo.zoom, focus: a.photo.focus, rotate: a.photo.rotate },
      softwareSkills: a.softwareSkills, multimediaSkills: a.multimediaSkills,
      // _uid only exists so drag-reordering can tell entries apart
      // in this editor — mapping to explicit fields here strips it
      // before it reaches about.json, same as every other draggable
      // list in this CMS (Hero Messages, Filters, Projects) already does.
      experience: a.experience.map(x=>({role:x.role,company:x.company,startDate:x.startDate||'',endDate:x.endDate||'',bullets:x.bullets})),
      education: a.education.map(x=>({school:x.school||'',degree:x.degree||'',graduationDate:x.graduationDate||'',title:x.title||'',detail:x.detail||''})),
      awards: a.awards.map(x=>({title:x.title,detail:x.detail}))
    }), 'about', SECTIONS.about.file);
  }

  function buildTagBox(id, arr, placeholder){
    const box = document.getElementById(id);
    function repaint(){
      box.innerHTML = '';
      arr.forEach((tag,i)=>{
        const pill = document.createElement('span');
        pill.className = 'tag-pill';
        pill.innerHTML = `${esc(tag)} <button type="button">&times;</button>`;
        pill.querySelector('button').addEventListener('click', ()=>{ arr.splice(i,1); flagUnsaved(); repaint(); });
        box.appendChild(pill);
      });
      const inp = document.createElement('input');
      inp.placeholder = placeholder;
      inp.addEventListener('keydown', e=>{
        if(e.key==='Enter' && inp.value.trim()){
          e.preventDefault(); arr.push(inp.value.trim()); flagUnsaved(); repaint();
        }
      });
      box.appendChild(inp);
    }
    repaint();
  }

  // Software Skills' own version of buildTagBox: each entry is
  // {name, icon} instead of a plain string, so every skill can be
  // shown as its logo instead of its name on the live site. Kept
  // separate from buildTagBox rather than adding an "icons?" flag to
  // it, since Multimedia Skills (buildTagBox's only other caller)
  // has no logo concept at all — categories like "3D Modeling" don't
  // have a brand mark — so it stays exactly as simple as it was.
  // Turns "Adobe After Effects" into "adobeaftereffects" — the slug
  // format Simple Icons (a free public library of brand/product
  // logos) keys its icons by. Same normalization used on the public
  // site's own copy of this lookup in script.js's fillSkillList.
  // Same lookup chain as the public site's fillSkillList in script.js
  // (manual icon → Simple Icons → Iconify discovery → initials) — kept here too
  // so this swatch preview shows what a skill will actually look like
  // rather than just "has an icon path or doesn't." Whether it's
  // actually shown as a logo at all, site-wide, is the one switch in
  // Settings & Toggles — this box just prepares each skill for
  // whichever way that switch is set.

  // Keep the CMS preview on the same logo adapter used by the public site.
  // admin.js is intentionally a classic script, so it loads the feature's
  // ES module through one cached dynamic import instead of duplicating the
  // provider map, aliases, scoring, and discovery logic here.
  const SOFTWARE_LOGO_LOOKUP = import('../js/infrastructure/software-logo/lookup.js?v=20261008-01');

  async function findAutomaticSoftwareLogoCandidates(name){
    const lookup=await SOFTWARE_LOGO_LOOKUP;
    return lookup.findSoftwareLogoCandidates(name);
  }

  async function findAutomaticSoftwareLogoDiscovery(name){
    const lookup=await SOFTWARE_LOGO_LOOKUP;
    return lookup.findSoftwareLogoDiscoveryCandidates(name);
  }

  function buildSoftwareSkills(id, arr){
    const box = document.getElementById(id);

    function applyAdminLogoTone(image, candidate = '') {
      if (!image) return;
      try {
        const canvas=document.createElement('canvas'); canvas.width=16; canvas.height=16;
        const ctx=canvas.getContext('2d',{willReadFrequently:true}); if(!ctx) throw new Error('tone canvas unavailable');
        ctx.clearRect(0,0,16,16); ctx.drawImage(image,0,0,16,16);
        const pixels=ctx.getImageData(0,0,16,16).data;
        let weighted=0,weight=0;
        for(let i=0;i<pixels.length;i+=4){
          const alpha=pixels[i+3]/255; if(alpha<=.03) continue;
          weighted+=((0.2126*pixels[i]+0.7152*pixels[i+1]+0.0722*pixels[i+2])/255)*alpha;
          weight+=alpha;
        }
        image.dataset.logoTone=weight&&weighted/weight<.45 ? 'dark' : 'light';
      }catch(_){
        image.dataset.logoTone=/krita/i.test(candidate)||/cdn\.simpleicons\.org/i.test(candidate) ? 'dark' : 'unknown';
      }
    }

    function preloadCandidates(host, name, candidates, index = 0, onExhausted){
      if(!host || !host.isConnected || !candidates[index]){
        onExhausted?.();
        return;
      }

      const candidate = candidates[index];
      const probe = new Image();
      probe.crossOrigin = 'anonymous';
      probe.onload = () => {
        if(!host.isConnected) return;
        applyAdminLogoTone(probe, candidate);
        probe.className='skill-logo';
        probe.alt=name;
        probe.title=name;
        probe.loading='lazy';
        host.replaceChildren(probe);
      };
      probe.onerror = () => preloadCandidates(host,name,candidates,index+1,onExhausted);
      probe.src = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(candidate) || candidate.startsWith('data:') || candidate.startsWith('blob:')
        ? candidate
        : ghRawUrl(candidate);
    }

    function repaint(){
      box.innerHTML='';

      arr.forEach((skill,i)=>{
        const hasManualIcon=!!skill.icon;
        const pill=document.createElement('span');
        pill.className='skill-editor-row';
        pill.innerHTML = [
          '<span class="skill-pill-icon" data-iconbtn title="',
          hasManualIcon ? 'Change logo' : 'Automatic logo lookup — click to set a specific logo',
          '"><span class="skill-pill-logo-placeholder" aria-hidden="true">',
          esc((skill.name||'').slice(0,2).toUpperCase()),
          '</span></span>',
          '<span class="skill-pill-name">',esc(skill.name),'</span>',
          hasManualIcon ? '<button type="button" class="clear-icon-btn" data-clearicon title="Use the automatic lookup instead">&times;</button>' : '',
          '<button type="button" data-removeskill title="Remove ',esc(skill.name),'">&times;</button>'
        ].join('');

        const host=pill.querySelector('[data-iconbtn]');

        async function discoverAfterDirectFails(){
          try {
            const discovered=await findAutomaticSoftwareLogoDiscovery(skill.name);
            if(!pill.isConnected || host.querySelector('img.skill-logo')) return;
            preloadCandidates(host,skill.name,discovered);
          } catch (error) {
            // Logo discovery is enhancement-only. A provider/network failure
            // must leave the editable skill row usable instead of creating an
            // unhandled promise rejection in the CMS.
            console.warn('CMS: automatic software-logo discovery failed.', error);
          }
        }

        const showAutomatic=async()=>{
          try {
            const direct=await findAutomaticSoftwareLogoCandidates(skill.name);
            if(!pill.isConnected) return;
            if(direct.length){
              preloadCandidates(host,skill.name,direct,0,discoverAfterDirectFails);
            }else{
              await discoverAfterDirectFails();
            }
          } catch (error) {
            console.warn('CMS: automatic software-logo lookup failed.', error);
          }
        };

        // Commit the pill before probing its logo. preloadCandidates has an
        // intentional connected-node guard so detached previews cannot mount
        // into stale DOM or trigger work that can never be displayed.
        box.appendChild(pill);

        if(hasManualIcon){
          const manualUrl=ghRawUrl(skill.icon);
          preloadCandidates(host,skill.name,[manualUrl],0,showAutomatic);
        }else{
          showAutomatic();
        }

        host.addEventListener('click',()=>{
          openMediaPicker(path=>{
            skill.icon=path;
            flagUnsaved();
            repaint();
          });
        });

        const clearBtn=pill.querySelector('[data-clearicon]');
        if(clearBtn) clearBtn.addEventListener('click',e=>{
          e.stopPropagation();
          skill.icon='';
          flagUnsaved();
          repaint();
        });

        pill.querySelector('[data-removeskill]').addEventListener('click',()=>{
          arr.splice(i,1);
          flagUnsaved();
          repaint();
        });

      });
    }

    repaint();
  }


  function buildSimpleRepeater(listId, arr, addBtnId, fields){
    function repaint(){
      const list = document.getElementById(listId);
      list.innerHTML = '';
      arr.forEach((item,i)=>{
        const row = document.createElement('div');
        row.className = 'card-item';
        row.dataset.uid = item._uid;
        row.innerHTML = `
          <div class="card-item-head">
            <span class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></span>
            <span class="item-title">${esc(item[fields[0].f] || ('Entry ' + (i+1)))}</span>
            <div class="card-item-actions">
              <button class="icon-btn" data-act="up" title="Move up"><i class="fa-solid fa-arrow-up"></i></button>
              <button class="icon-btn" data-act="down" title="Move down"><i class="fa-solid fa-arrow-down"></i></button>
              <button class="icon-btn" data-act="del" title="Delete" style="color:#e0584f"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
          <div class="row">
            ${fields.map(f=>`<div class="field"><input data-f="${f.f}" value="${attr(item[f.f]||'')}" placeholder="${f.ph}"></div>`).join('')}
          </div>
        `;
        row.querySelectorAll('[data-f]').forEach(inp=> inp.addEventListener('input', ()=>{
          item[inp.dataset.f]=inp.value;
          if (inp.dataset.f === fields[0].f) row.querySelector('.item-title').textContent = item[fields[0].f] || ('Entry ' + (i+1));
          flagUnsaved();
        }));
        row.querySelector('[data-act="del"]').addEventListener('click', ()=>{ arr.splice(i,1); flagUnsaved(); repaint(); });
        row.querySelector('[data-act="up"]').addEventListener('click', ()=>{ if(i===0)return; animateReorder(() => document.getElementById(listId), () => { [arr[i-1],arr[i]]=[arr[i],arr[i-1]]; flagUnsaved(); repaint(); }); });
        row.querySelector('[data-act="down"]').addEventListener('click', ()=>{ if(i===arr.length-1)return; animateReorder(() => document.getElementById(listId), () => { [arr[i+1],arr[i]]=[arr[i],arr[i+1]]; flagUnsaved(); repaint(); }); });
        list.appendChild(row);
      });
    }
    document.getElementById(addBtnId).addEventListener('click', ()=>{
      const blank = { _uid: uid() }; fields.forEach(f=>blank[f.f]=''); arr.push(blank); flagUnsaved(); repaint();
    });
    repaint();
    // Attached once, not inside repaint(): unlike the full-screen
    // sections (Hero Messages, Projects, etc.) this repaint() only
    // ever clears and refills #listId's children — the container
    // itself never gets recreated — so one set of listeners on that
    // stable container is all this ever needs. Re-running this inside
    // repaint() would stack a fresh set of listeners on the same node
    // every single edit.
    enableDragReorder(() => document.getElementById(listId), arr, flagUnsaved, repaint);
  }

  function buildEducation(){
    const list=document.getElementById('eduList'); const openUids=new Set();
    function repaint(){
      list.innerHTML='';
      a.education.forEach((edu,i)=>{
        const open=openUids.has(edu._uid), row=document.createElement('div'); row.className='card-item'; row.dataset.uid=edu._uid;
        row.innerHTML=`<div class="card-item-head collapsible-head" data-toggle-open><span class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></span><span class="preview-line">${esc(edu.school||edu.title||'New education entry')}${edu.degree?' — '+esc(edu.degree):''}${edu.graduationDate?' · '+esc(edu.graduationDate):''}</span><div class="card-item-actions"><button class="icon-btn" data-act="up"><i class="fa-solid fa-arrow-up"></i></button><button class="icon-btn" data-act="down"><i class="fa-solid fa-arrow-down"></i></button><button class="icon-btn" data-act="del" style="color:#e0584f"><i class="fa-solid fa-trash"></i></button><button class="icon-btn" data-act="toggle"><i class="fa-solid fa-chevron-${open?'up':'down'}"></i></button></div></div><div class="collapsible-body" style="display:${open?'block':'none'};margin-top:16px;"><div class="row"><div class="field"><label class="field-label">School name</label><input data-f="school" value="${attr(edu.school||'')}" placeholder="University, college, school, or training provider"></div><div class="field"><label class="field-label">Degree or other <span style="opacity:.5">(optional)</span></label><input data-f="degree" value="${attr(edu.degree||'')}" placeholder="Degree, certificate, diploma, course, etc."></div></div><div class="field"><label class="field-label">Graduation / completion date <span style="opacity:.5">(optional)</span></label><div class="row"><input data-date-for="graduationDate" type="month" value="${/^\d{4}-\d{2}$/.test(edu.graduationDate||'')?edu.graduationDate:''}" style="max-width:150px"><input data-f="graduationDate" type="text" value="${attr(edu.graduationDate||'')}" placeholder="YYYY-MM or text such as Mid-2025"></div></div></div>`;
        row.querySelector('[data-toggle-open]').addEventListener('click',e=>{if(e.target.closest('[data-act]')&&e.target.closest('[data-act]').dataset.act!=='toggle')return;open?openUids.delete(edu._uid):openUids.add(edu._uid);repaint();});
        row.querySelectorAll('[data-f]').forEach(inp=>inp.addEventListener('input',()=>{edu[inp.dataset.f]=inp.value;row.querySelector('.preview-line').textContent=(edu.school||edu.title||'New education entry')+(edu.degree?' — '+edu.degree:'')+(edu.graduationDate?' · '+edu.graduationDate:'');flagUnsaved();}));
        row.querySelectorAll('[data-date-for]').forEach(inp=>inp.addEventListener('change',()=>{const f=inp.dataset.dateFor;edu[f]=inp.value;const text=row.querySelector('[data-f="'+f+'"]');if(text)text.value=inp.value;row.querySelector('.preview-line').textContent=(edu.school||edu.title||'New education entry')+(edu.degree?' — '+edu.degree:'')+(edu.graduationDate?' · '+edu.graduationDate:'');flagUnsaved();}));
        row.querySelector('[data-act=del]').addEventListener('click',e=>{e.stopPropagation();a.education.splice(i,1);flagUnsaved();repaint();});
        row.querySelector('[data-act=up]').addEventListener('click',e=>{e.stopPropagation();if(i===0)return;animateReorder(()=>document.getElementById('eduList'),()=>{[a.education[i-1],a.education[i]]=[a.education[i],a.education[i-1]];flagUnsaved();repaint();});});
        row.querySelector('[data-act=down]').addEventListener('click',e=>{e.stopPropagation();if(i===a.education.length-1)return;animateReorder(()=>document.getElementById('eduList'),()=>{[a.education[i+1],a.education[i]]=[a.education[i],a.education[i+1]];flagUnsaved();repaint();});});
        list.appendChild(row);
      });
    }
    document.getElementById('addEdu').addEventListener('click',()=>{const fresh={school:'',degree:'',graduationDate:'',_uid:uid()};a.education.push(fresh);openUids.add(fresh._uid);flagUnsaved();repaint();});
    repaint(); enableDragReorder(()=>document.getElementById('eduList'),a.education,flagUnsaved,repaint);
  }

  function buildExperience(){
    const list = document.getElementById('expList');
    // Collapsed by default, same reasoning as the project artwork
    // list — a full work history is the longest thing on this page,
    // and only one entry is usually being edited at a time. A brand
    // new entry (see addExp below) is added straight into this set so
    // it opens ready to fill in instead of collapsing on itself.
    const openUids = new Set();

    function repaint(){
      list.innerHTML = '';
      a.experience.forEach((exp,i)=>{
        exp.bullets = exp.bullets || [];
        const isOpen = openUids.has(exp._uid);
        const row = document.createElement('div');
        row.className = 'card-item';
        row.dataset.uid = exp._uid;
        row.innerHTML = `
          <div class="card-item-head collapsible-head" data-toggle-open>
            <span class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></span>
            <span class="preview-line">${esc(exp.role||'New role')}${exp.company?' — '+esc(exp.company):''}</span>
            <div class="card-item-actions">
              <button class="icon-btn" data-act="up" title="Move up"><i class="fa-solid fa-arrow-up"></i></button>
              <button class="icon-btn" data-act="down" title="Move down"><i class="fa-solid fa-arrow-down"></i></button>
              <button class="icon-btn" data-act="del" title="Delete" style="color:#e0584f"><i class="fa-solid fa-trash"></i></button>
              <button class="icon-btn" data-act="toggle"><i class="fa-solid fa-chevron-${isOpen?'up':'down'}"></i></button>
            </div>
          </div>
          <div class="collapsible-body" style="display:${isOpen?'block':'none'};margin-top:16px;" data-body>
            <div class="row">
              <div class="field"><label class="field-label">Role</label><input data-f="role" value="${attr(exp.role)}"></div>
              <div class="field"><label class="field-label">Company</label><input data-f="company" value="${attr(exp.company)}"></div>
            </div>
            <div class="row">
              <div class="field"><label class="field-label">Start date <span style="opacity:.5">(optional)</span></label><div class="row"><input data-date-for="startDate" type="month" value="${/^\d{4}-\d{2}$/.test(exp.startDate)?exp.startDate:''}" style="max-width:150px"><input data-f="startDate" type="text" value="${attr(exp.startDate)}" placeholder="YYYY-MM or Present"></div></div>
              <div class="field"><label class="field-label">End date <span style="opacity:.5">(optional)</span></label><div class="row"><input data-date-for="endDate" type="month" value="${/^\d{4}-\d{2}$/.test(exp.endDate)?exp.endDate:''}" style="max-width:150px"><input data-f="endDate" type="text" value="${attr(exp.endDate)}" placeholder="YYYY-MM or Present"></div></div>
            </div>
            <div class="subrepeater" data-bullets></div>
            <button class="add-btn" data-addbullet type="button" style="margin-top:10px"><i class="fa-solid fa-plus"></i> Add bullet</button>
          </div>
        `;
        row.querySelector('[data-toggle-open]').addEventListener('click', (e)=>{
          if (e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act !== 'toggle') return;
          if (isOpen) openUids.delete(exp._uid); else openUids.add(exp._uid);
          repaint();
        });
        row.querySelectorAll('[data-f]').forEach(inp=> inp.addEventListener('input', ()=>{
          exp[inp.dataset.f]=inp.value;
          row.querySelector('.preview-line').textContent = (exp.role||'New role') + (exp.company?' — '+exp.company:'');
          flagUnsaved();
        }));
        row.querySelectorAll('[data-date-for]').forEach(inp=>inp.addEventListener('change',()=>{ const f=inp.dataset.dateFor; exp[f]=inp.value; const text=row.querySelector('[data-f="'+f+'"]'); if(text) text.value=inp.value; row.querySelector('.preview-line').textContent=(exp.role||'New role')+(exp.company?' — '+exp.company:'')+((exp.startDate||exp.endDate)?' · '+(exp.startDate||'')+'–'+(exp.endDate||''):''); flagUnsaved(); }));
        row.querySelector('[data-act="del"]').addEventListener('click', (e)=>{ e.stopPropagation(); a.experience.splice(i,1); flagUnsaved(); repaint(); });
        row.querySelector('[data-act="up"]').addEventListener('click', (e)=>{ e.stopPropagation(); if(i===0)return; animateReorder(() => document.getElementById('expList'), () => { [a.experience[i-1],a.experience[i]]=[a.experience[i],a.experience[i-1]]; flagUnsaved(); repaint(); }); });
        row.querySelector('[data-act="down"]').addEventListener('click', (e)=>{ e.stopPropagation(); if(i===a.experience.length-1)return; animateReorder(() => document.getElementById('expList'), () => { [a.experience[i+1],a.experience[i]]=[a.experience[i],a.experience[i+1]]; flagUnsaved(); repaint(); }); });

        const bWrap = row.querySelector('[data-bullets]');
        function repaintBullets(){
          bWrap.innerHTML = '';
          exp.bullets.forEach((b,bi)=>{
            const brow = document.createElement('div');
            brow.style.display='flex'; brow.style.gap='8px'; brow.style.marginBottom='8px';
            brow.innerHTML = `<textarea rows="2" style="flex:1">${esc(b)}</textarea><button class="icon-btn" style="color:#e0584f;flex-shrink:0"><i class="fa-solid fa-trash"></i></button>`;
            brow.querySelector('textarea').addEventListener('input', (e)=>{ exp.bullets[bi]=e.target.value; flagUnsaved(); });
            brow.querySelector('button').addEventListener('click', ()=>{ exp.bullets.splice(bi,1); flagUnsaved(); repaintBullets(); });
            bWrap.appendChild(brow);
          });
        }
        repaintBullets();
        row.querySelector('[data-addbullet]').addEventListener('click', ()=>{ exp.bullets.push(''); flagUnsaved(); repaintBullets(); });
        list.appendChild(row);
      });
    }
    document.getElementById('addExp').addEventListener('click', ()=>{
      const fresh = {role:'',company:'',startDate:'',endDate:'',bullets:[''],_uid:uid()};
      a.experience.push(fresh);
      openUids.add(fresh._uid);
      flagUnsaved(); repaint();
    });
    repaint();
    // Same reasoning as buildSimpleRepeater above: #expList's own node
    // is never recreated by repaint(), only its children are, so this
    // is attached once rather than inside repaint().
    enableDragReorder(() => document.getElementById('expList'), a.experience, flagUnsaved, repaint);
  }

  paint();
};

/* =====================================================================
   13. MEDIA LIBRARY
   ===================================================================== */
let mediaTreeCache = null; // raw flat tree from GitHub, refetched on demand
let mediaTreeShaByPath = new Map();
let mediaTreeRequestId = 0;
let mediaTreeRequest = null;
let mediaCurrentPath = 'assets';

function setMediaTreeCache(tree){
  mediaTreeCache = Array.isArray(tree) ? tree : null;
  mediaTreeShaByPath = new Map(
    (mediaTreeCache || [])
      .filter(item => item && item.type === 'blob' && item.path && item.sha)
      .map(item => [item.path, item.sha])
  );
  return mediaTreeCache;
}
async function loadMediaTree(force){
  if (!force && mediaTreeRequest) return mediaTreeRequest;
  if (mediaTreeCache && !force) return mediaTreeCache;
  const requestId = ++mediaTreeRequestId;
  const request = GH.getTree().then(tree => {
    if (requestId !== mediaTreeRequestId) return mediaTreeRequest || mediaTreeCache || tree;
    return setMediaTreeCache(tree);
  }).finally(() => {
    if (requestId === mediaTreeRequestId) mediaTreeRequest = null;
  });
  mediaTreeRequest = request;
  return request;
}

function fileKind(path){
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (['jpg','jpeg','png','gif','webp','svg','avif'].includes(ext)) return 'image';
  if (['mp4','webm','mov','m4v'].includes(ext)) return 'video';
  if (ext === 'json') return 'lottie';
  if (['obj','gltf','glb','fbx'].includes(ext)) return 'model';
  return 'other';
}

/* Inline SVG icons for the folder/file browser, used instead of the
   Font Awesome <i> icons the rest of the CMS uses. Two reasons:

   1. This exact tile (folder icon + name underneath) has been reported
      as broken multiple times, in a way I haven't been able to
      reproduce or fully explain from code alone. An inline SVG can't
      fail to load the way an icon FONT can (blocked request, slow
      CDN, a font that loads but a glyph mapping that doesn't) — so
      this removes an entire category of possible cause, confirmed or
      not, rather than adding another theoretical CSS patch on top of
      the two from previous rounds.
   2. It puts the folder icon and the file-type icons on the same
      footing: both are always literally present in the page as soon
      as it renders, nothing to wait on or fail silently.

   FOLDER_ICON_SVG / FILE_ICON_SVG use stroke="currentColor" so they
   pick up whatever CSS color is set on their wrapping element, same
   as a font icon would. */
const FOLDER_ICON_SVG = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.7c0-.94.76-1.7 1.7-1.7h4.46c.4 0 .78.15 1.08.42l1.3 1.18c.3.27.68.42 1.08.42h6.68c.94 0 1.7.76 1.7 1.7v9.08c0 .94-.76 1.7-1.7 1.7H4.7c-.94 0-1.7-.76-1.7-1.7V6.7z"/></svg>';
const FILE_ICON_SVG = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z"/><path d="M14 3.5v4h4" stroke-linecap="round"/></svg>';
const BROKEN_IMAGE_SVG_ESCAPED = FILE_ICON_SVG.replace(/"/g, '&quot;');
const MODEL_ICON_SVG = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"><path d="M12 3l7.5 4.25v9.5L12 21l-7.5-4.25v-9.5L12 3z"/><path d="M4.5 7.25L12 11.5l7.5-4.25M12 11.5V21"/></svg>';

// One shared builder for both the Media Library screen's own grid and
// the "Choose a file" picker popup — previously each had its own
// near-identical copy of this markup, which is exactly how a fix to
// one and not the other went unnoticed for a couple of rounds. Now
// there's exactly one place that decides what a tile looks like.
function mediaActionButtonHtml(action,label,icon,tone=''){
  const toneClass=tone?' '+tone:'';
  return `<button class="icon-btn media-action-btn${toneClass}" data-${action} type="button" title="${attr(label)}" aria-label="${attr(label)}"><i class="fa-solid ${icon}" aria-hidden="true"></i></button>`;
}

function folderTileHtml(name, previewPath){
  const thumbHtml = previewPath
    ? `<img src="${attr(ghRawUrl(previewPath))}" loading="lazy" onerror="this.parentElement.innerHTML='${FOLDER_ICON_SVG.replace(/"/g, '&quot;')}'">`
    : FOLDER_ICON_SVG;
  const badge = `<span class="tile-badge" title="Folder"><i class="fa-solid fa-folder"></i></span>`;
  return `<div class="thumb">${thumbHtml}${badge}</div><div class="meta"><div class="fname">${esc(name)}</div></div><div class="tile-actions folder-actions">${mediaActionButtonHtml('folder-rename','Rename folder','fa-pen')}</div>`;
}

function fileTileHtml(item){
  const kind = fileKind(item.path);
  const name = item.path.split('/').pop();
  const thumbHtml = kind === 'image'
    ? `<img src="${attr(ghRawUrl(item.path))}" loading="lazy" onerror="this.parentElement.innerHTML='${BROKEN_IMAGE_SVG_ESCAPED}'">`
    : kind === 'video'
    ? `<video src="${attr(ghRawUrl(item.path))}" muted preload="metadata"></video>`
    : kind === 'lottie'
    ? `<lottie-player src="${attr(ghRawUrl(item.path))}" autoplay loop background="transparent" style="width:100%;height:100%;"></lottie-player>`
    : kind === 'model'
    ? MODEL_ICON_SVG
    : FILE_ICON_SVG;
  // A video's tile shows its first frame — often indistinguishable
  // from a still photo at this size. The play-icon badge is the same
  // cue the public site's own lightbox thumbnails already use for
  // this, so it reads consistently for you across both.
  const badge = kind === 'video' ? `<span class="tile-badge" title="Video"><i class="fa-solid fa-play"></i></span>` : kind === 'lottie' ? `<span class="tile-badge" title="Lottie JSON"><i class="fa-solid fa-wand-magic-sparkles"></i></span>` : kind === 'model' ? `<span class="tile-badge" title="3D Model"><i class="fa-solid fa-cube"></i></span>` : '';
  return `<div class="thumb">${thumbHtml}${badge}</div><div class="meta"><div class="fname">${esc(name)}</div></div>`;
}

let activeMediaFullPreviewState = null;

function closeMediaFullPreview(){
  const state=activeMediaFullPreviewState;
  if(!state)return;
  activeMediaFullPreviewState=null;
  document.removeEventListener('keydown',state.onKeydown,true);
  state.cleanups.splice(0).reverse().forEach(cleanup=>{try{cleanup();}catch(_){}});
  state.overlay.remove();
  document.body.style.overflow=state.previousBodyOverflow;
  if(state.trigger?.isConnected){try{state.trigger.focus({preventScroll:true});}catch(_){state.trigger.focus();}}
}

function formatMediaFileSize(value){
  if(value===null||value===undefined||value===''||!Number.isFinite(Number(value))||Number(value)<0) return 'Size unavailable';
  const bytes=Math.round(Number(value));
  if(bytes<1024) return bytes.toLocaleString('en-US')+' '+(bytes===1?'byte':'bytes');
  const units=['KiB','MiB','GiB','TiB'];
  let size=bytes,unitIndex=-1;
  do{size/=1024;unitIndex+=1;}while(size>=1024&&unitIndex<units.length-1);
  const readable=size.toLocaleString('en-US',{maximumFractionDigits:2,minimumFractionDigits:size<10?2:1});
  return readable+' '+units[unitIndex]+' ('+bytes.toLocaleString('en-US')+' bytes)';
}

function openMediaFullPreview(item,trigger){
  closeMediaFullPreview();
  const kind=fileKind(item.path);
  const fileName=item.path.split('/').pop()||item.path;
  const src=ghRawUrl(item.path);
  const overlay=document.createElement('div');
  overlay.className='media-full-preview-overlay';
  overlay.dataset.kind=kind;
  const dialog=document.createElement('section');
  dialog.className='media-full-preview-dialog';
  dialog.setAttribute('role','dialog');
  dialog.setAttribute('aria-modal','true');
  dialog.setAttribute('aria-label','Preview '+fileName);
  dialog.tabIndex=-1;

  const head=document.createElement('header');
  head.className='media-full-preview-head';
  const heading=document.createElement('div');
  heading.className='media-full-preview-heading';
  const title=document.createElement('strong');
  title.className='media-full-preview-title';
  title.textContent=fileName;
  const pathLabel=document.createElement('span');
  pathLabel.className='media-full-preview-path';
  pathLabel.textContent=item.path;
  const sizeLabel=document.createElement('span');
  sizeLabel.className='media-full-preview-size';
  sizeLabel.textContent='File size · '+formatMediaFileSize(item.size);
  const hasExactSize=item.size!==null&&item.size!==undefined&&item.size!==''&&Number.isFinite(Number(item.size))&&Number(item.size)>=0;
  sizeLabel.title=hasExactSize?'Exact repository blob size: '+Number(item.size).toLocaleString('en-US')+' bytes':'Repository blob size unavailable';
  const kindLabel=document.createElement('span');
  kindLabel.className='media-full-preview-kind';
  kindLabel.textContent=kind==='model'?'3D MODEL':kind.toUpperCase();
  heading.append(title,pathLabel,sizeLabel);
  const closeButton=document.createElement('button');
  closeButton.type='button';
  closeButton.className='icon-btn media-full-preview-close';
  closeButton.setAttribute('aria-label','Close full preview');
  closeButton.title='Close preview';
  closeButton.innerHTML='<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
  head.append(heading,kindLabel,closeButton);

  const stage=document.createElement('div');
  stage.className='media-full-preview-stage';
  stage.setAttribute('aria-busy','true');
  stage.dataset.previewStage='';
  const status=document.createElement('div');
  status.className='media-full-preview-status';
  status.setAttribute('role','status');
  status.setAttribute('aria-live','polite');
  status.textContent='Loading preview…';
  stage.appendChild(status);
  dialog.append(head,stage);
  overlay.appendChild(dialog);

  const state={overlay,dialog,stage,status,trigger,previousBodyOverflow:document.body.style.overflow,cleanups:[],onKeydown:null};
  activeMediaFullPreviewState=state;
  const ready=()=>{
    if(!overlay.isConnected)return;
    stage.setAttribute('aria-busy','false');
    status.hidden=true;
    status.classList.remove('is-error');
  };
  const showError=message=>{
    if(!overlay.isConnected)return;
    stage.setAttribute('aria-busy','false');
    status.hidden=false;
    status.classList.add('is-error');
    status.textContent=message;
  };
  state.onKeydown=event=>{
    if(event.key==='Escape'){event.preventDefault();closeMediaFullPreview();return;}
    if(event.key!=='Tab')return;
    const focusable=Array.from(dialog.querySelectorAll('button:not(:disabled),a[href],video[controls],[tabindex="0"]'))
      .filter(el=>!el.hidden&&el.getAttribute('aria-hidden')!=='true');
    if(!focusable.length){event.preventDefault();dialog.focus();return;}
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  closeButton.addEventListener('click',closeMediaFullPreview);
  overlay.addEventListener('click',event=>{if(event.target===overlay)closeMediaFullPreview();});
  document.body.style.overflow='hidden';
  document.body.appendChild(overlay);
  document.addEventListener('keydown',state.onKeydown,true);
  closeButton.focus({preventScroll:true});

  if(kind==='image'){
    const image=document.createElement('img');
    image.className='media-full-preview-media';
    image.alt=fileName;
    image.decoding='async';
    image.loading='eager';
    image.addEventListener('load',ready,{once:true});
    image.addEventListener('error',()=>showError('This image could not be loaded. Check the repository path or network connection.'),{once:true});
    state.cleanups.push(()=>{image.onload=null;image.onerror=null;});
    image.src=src;
    stage.insertBefore(image,status);
    if(image.complete&&image.naturalWidth>0)ready();
  }else if(kind==='video'){
    const video=document.createElement('video');
    video.className='media-full-preview-media';
    video.controls=true;
    video.playsInline=true;
    video.preload='metadata';
    video.setAttribute('aria-label',fileName);
    video.addEventListener('loadedmetadata',ready,{once:true});
    video.addEventListener('canplay',ready,{once:true});
    video.addEventListener('error',()=>showError('This video could not be loaded or decoded by this browser.'),{once:true});
    state.cleanups.push(()=>{video.pause();video.removeAttribute('src');video.load();});
    video.src=src;
    stage.insertBefore(video,status);
  }else if(kind==='lottie'){
    let failed=false;
    const loadingTimer=setTimeout(()=>{if(!failed)showError('The animation is taking longer than expected. Check the JSON file and connection.');},15000);
    state.cleanups.push(()=>clearTimeout(loadingTimer));
    (async()=>{
      try{
        const {ensureLottiePlayer}=await import('../js/infrastructure/lottie/player.js');
        if(!overlay.isConnected)return;
        const playerReady=await ensureLottiePlayer();
        if(!overlay.isConnected)return;
        if(!playerReady)throw new Error('The Lottie player could not be loaded. Check your connection.');
        const player=document.createElement('lottie-player');
        player.className='media-full-preview-media media-full-preview-lottie';
        player.setAttribute('src',src);
        player.setAttribute('autoplay','');
        player.setAttribute('loop','');
        player.setAttribute('controls','');
        player.setAttribute('background','transparent');
        player.setAttribute('renderer','svg');
        player.setAttribute('aria-label',fileName);
        player.addEventListener('ready',()=>{failed=false;clearTimeout(loadingTimer);ready();},{once:true});
        player.addEventListener('error',()=>{failed=true;clearTimeout(loadingTimer);showError('The Lottie JSON could not be rendered.');},{once:true});
        stage.insertBefore(player,status);
        const revealTimer=setTimeout(()=>{if(overlay.isConnected&&stage.contains(player))ready();},1200);
        state.cleanups.push(()=>clearTimeout(revealTimer));
      }catch(error){
        failed=true;
        clearTimeout(loadingTimer);
        showError(error?.message||'The Lottie preview could not be initialized.');
      }
    })();
  }else if(kind==='model'){
    const host=document.createElement('div');
    host.className='media-full-preview-model model-viewer-shell';
    host.setAttribute('aria-label',fileName+' interactive 3D preview');
    host.setAttribute('role','region');
    stage.insertBefore(host,status);
    let modelCleanup=null;
    state.cleanups.push(()=>{
      try{(modelCleanup||host.__modelViewerCleanup)?.();}catch(_){}
      if(host.__modelViewerMountToken)delete host.__modelViewerMountToken;
    });
    (async()=>{
      try{
        const {mountModelViewer}=await import('../js/infrastructure/three/model-viewer.js?v=20261023-01');
        if(!overlay.isConnected)return;
        modelCleanup=await mountModelViewer(host,src,{hint:true,resolveUrl:ghRawUrl,enablePan:true,enableZoom:true});
        if(!overlay.isConnected){
          try{modelCleanup?.();}catch(_){}
          if(host.__modelViewerMountToken)delete host.__modelViewerMountToken;
          return;
        }
        ready();
      }catch(error){showError(error?.message||'The 3D model could not be previewed.');}
    })();
  }else{
    const message=document.createElement('div');
    message.className='media-full-preview-unsupported';
    message.textContent='This file type does not have an inline preview.';
    const link=document.createElement('a');
    link.href=src;
    link.target='_blank';
    link.rel='noopener noreferrer';
    link.textContent='Open original file in a new tab';
    message.appendChild(link);
    stage.insertBefore(message,status);
    ready();
  }
}

// Recursively finds the first image anywhere inside folderPath — not
// just its immediate children, so a folder that only holds
// sub-folders full of images (rather than images directly) still
// gets a real preview instead of the plain icon. Sorted so the same
// folder always shows the same preview rather than whichever order
// the GitHub API happened to return that time.
function findFolderPreviewImage(tree, folderPath){
  const prefix = folderPath + '/';
  const images = tree.filter(item =>
    item.type === 'blob' &&
    item.path.startsWith(prefix) &&
    fileKind(item.path) === 'image'
  );
  images.sort((a, b) => a.path.localeCompare(b.path));
  return images.length ? images[0].path : null;
}

function safeFolderName(name){
  const trimmed=String(name||'').trim();
  if(!trimmed || trimmed==='.' || trimmed==='..' || /[\\/]/.test(trimmed) || /[\u0000-\u001f]/.test(trimmed)) return null;
  if(trimmed.length>80) return null;
  return trimmed;
}
function joinRepoPath(parent,name){ return [String(parent||'').replace(/^\/+|\/+$/g,''),name].filter(Boolean).join('/'); }
function remapNestedPath(current,oldPath,newPath){
  return current===oldPath ? newPath : current.startsWith(oldPath+'/') ? newPath+current.slice(oldPath.length) : current;
}
async function createMediaFolder(parentPath,onDone){
  const name=safeFolderName(prompt('New folder name:','New Folder'));
  if(!name) return;
  const folderPath=joinRepoPath(parentPath||'assets',name);
  const tree=await loadMediaTree(true);
  if(tree.some(item=>item.path===folderPath || item.path.startsWith(folderPath+'/'))){ toast('A folder or file with that name already exists here.',true); return; }
  await GH.commitFiles([{path:folderPath+'/.gitkeep',content:'',encoding:'utf-8'}],`CMS: create folder ${folderPath}`);
  await loadMediaTree(true);
  toast(`Created folder ${folderPath}.`);
  if(onDone) onDone(folderPath);
}
const MEDIA_REFERENCE_FILES = [
  'index.html',
  'about/index.html',
  '404.html',
  'success/index.html',
  'css/style.css',
  'js/script.js',
  'js/infrastructure/media-background/engine.js',
  'data/about.json',
  'data/curated-views.json',
  'data/filters.json',
  'data/footer-loop.json',
  'data/hero-loop.json',
  'data/hero.json',
  'data/projects.json',
  'data/reviews.json',
  'data/settings.json'
];

let lastMediaImpact = { sections:[], projectIds:[], projectTitles:[], changedFiles:[], oldPath:'', newPath:'' };

function mediaPathBoundary(source,index,path,isFolder){
  const before=index>0?source[index-1]:'';
  const after=source[index+path.length]||'';
  const beforeOK=!before || ['/','.', '"',"'","`",':','=','(','[',',','{'].includes(before) || /\s/.test(before);
  const afterDelimiters=isFolder?['/','?','#','"',"'","`",',',')','}',']']:['?','#','"',"'","`",',',')','}',']'];
  const afterOK=!after || afterDelimiters.includes(after) || /\s/.test(after);
  return beforeOK&&afterOK;
}

function replaceMediaPathReferences(source,oldPath,newPath,isFolder){
  let cursor=0,searchAt=0,out='',changed=false;
  while(searchAt<source.length){
    const index=source.indexOf(oldPath,searchAt);
    if(index<0)break;
    searchAt=index+oldPath.length;
    if(!mediaPathBoundary(source,index,oldPath,isFolder))continue;
    out+=source.slice(cursor,index)+newPath;
    cursor=index+oldPath.length;
    changed=true;
  }
  return changed?out+source.slice(cursor):source;
}

function valueReferencesMediaPath(value,oldPath,isFolder){
  if(typeof value==='string')return replaceMediaPathReferences(value,oldPath,'__MEDIA_PATH_MATCH__',isFolder)!==value;
  if(Array.isArray(value))return value.some(item=>valueReferencesMediaPath(item,oldPath,isFolder));
  if(value&&typeof value==='object')return Object.values(value).some(item=>valueReferencesMediaPath(item,oldPath,isFolder));
  return false;
}

// The destructive-delete audit is deliberately more conservative than Rename:
// decode percent-encoded URL path bytes before checking, but never rewrite the
// decoded text. This catches spaces, encoded separators, and mixed-case escapes.
function decodeMediaPathEscapes(source){
  return String(source||'').replace(/(?:%[0-9a-f]{2})+/gi,encoded=>{
    try{return decodeURIComponent(encoded);}
    catch(_){return encoded;}
  });
}
function mediaSourceReferencesPath(source,oldPath,isFolder){
  const value=String(source||'');
  if(replaceMediaPathReferences(value,oldPath,'__MEDIA_PATH_MATCH__',isFolder)!==value)return true;
  const decoded=decodeMediaPathEscapes(value);
  return decoded!==value&&replaceMediaPathReferences(decoded,oldPath,'__MEDIA_PATH_MATCH__',isFolder)!==decoded;
}
function valueReferencesMediaPathForDeletion(value,oldPath,isFolder){
  if(typeof value==='string')return mediaSourceReferencesPath(value,oldPath,isFolder);
  if(Array.isArray(value))return value.some(item=>valueReferencesMediaPathForDeletion(item,oldPath,isFolder));
  if(value&&typeof value==='object')return Object.values(value).some(item=>valueReferencesMediaPathForDeletion(item,oldPath,isFolder));
  return false;
}

function updateMediaImpactIndicators(){
  const sectionSet=new Set(lastMediaImpact.sections||[]);
  document.querySelectorAll('.nav-item[data-section]').forEach(nav=>{
    let dot=nav.querySelector('.media-impact-dot');
    const isAffected=sectionSet.has(nav.dataset.section);
    if(isAffected&&!dot){
      dot=document.createElement('span');
      dot.className='media-impact-dot';
      dot.setAttribute('aria-label','Asset reference updated — review this section');
      dot.title='A media path was updated here. Review this section.';
      nav.appendChild(dot);
    }else if(!isAffected&&dot)dot.remove();
  });
}

function mediaImpactSummary(impact){
  const labels=[...new Set((impact.sections||[]).map(key=>SECTIONS[key]?.label||key))];
  const parts=[];
  if(labels.length)parts.push('Affected sections: '+labels.join(', '));
  if(impact.projectTitles?.length)parts.push('Affected projects: '+impact.projectTitles.join(', '));
  const other=(impact.changedFiles||[]).filter(file=>!Object.values(SECTIONS).some(section=>section.file===file));
  if(other.length)parts.push('Other site files: '+other.length);
  if(!(impact.changedFiles||[]).length)return 'No references were found in the scanned website and data files.';
  return impact.changedFiles.length+' reference file'+(impact.changedFiles.length===1?'':'s')+' will be updated.'+(parts.length?'\n'+parts.join('\n'):'');
}


function mediaDeletionReferenceMessage(filePath, impact){
  const labels=[...new Set((impact.sections||[]).map(key=>SECTIONS[key]?.label||key))];
  const lines=[];
  lines.push('Deletion blocked: '+filePath+' is referenced by '+impact.changedFiles.length+' tracked website/CMS file'+(impact.changedFiles.length===1?'':'s')+'.');
  if(labels.length)lines.push('Affected CMS sections: '+labels.join(', ')+'.');
  if(impact.projectTitles?.length){
    const titles=impact.projectTitles.slice(0,8);
    lines.push('Affected projects/views: '+titles.join(', ')+(impact.projectTitles.length>titles.length?' and '+(impact.projectTitles.length-titles.length)+' more':'')+'.');
  }
  const files=(impact.changedFiles||[]).slice(0,8);
  if(files.length)lines.push('Reference locations: '+files.join(', ')+(impact.changedFiles.length>files.length?' and '+(impact.changedFiles.length-files.length)+' more':'')+'.');
  lines.push('No deletion was made. Remove or replace these references first, save the changes, refresh the Media Library, and retry. Use Rename instead when moving an asset.');
  return lines.join(' ');
}

async function prepareMediaReferenceUpdates(oldPath,newPath,parentSha,tree,isFolder,scanOnly=false){
  const candidates=new Set(MEDIA_REFERENCE_FILES);
  const referenceExtensions=scanOnly
    ? /\.(?:html?|css|m?js|cjs|json|svg|xml|webmanifest|md|mdx|txt|ya?ml|toml|ts|tsx|jsx|vue|svelte|astro|scss|sass|less|php|py|sh|ini|conf|csv)$/i
    : /\.(?:html?|css|m?js|cjs|json|svg|xml|webmanifest)$/i;
  (tree||[]).forEach(item=>{
    const filePath=String(item?.path||'');
    if(item?.type!=='blob'||!referenceExtensions.test(filePath))return;
    // Never rewrite the tool's own implementation while renaming user data.
    if(filePath==='admin/admin.js'||filePath.endsWith('.map'))return;
    if(filePath.startsWith('node_modules/')||filePath.startsWith('vendor/'))return;
    candidates.add(filePath);
  });
  // Read tracked website/CMS text assets in a small worker pool from one
  // immutable commit. This covers modules/components and future data files
  // without firing hundreds of simultaneous requests or serially blocking UI.
  const paths=[...candidates],files=new Array(paths.length);
  let nextIndex=0;
  const worker=async()=>{
    while(true){
      const index=nextIndex++;
      if(index>=paths.length)return;
      const filePath=paths[index];
      try{files[index]={filePath,current:await GH.getTextFile(filePath,parentSha)};}
      catch(err){if(/was not found in the repository/i.test(err.message||'')){files[index]=null;continue;}throw err;}
    }
  };
  await Promise.all(Array.from({length:Math.min(8,paths.length)},()=>worker()));
  const matched=[];
  for(const record of files.filter(Boolean)){
    if(scanOnly){
      if(mediaSourceReferencesPath(record.current.text,oldPath,isFolder))matched.push({...record,next:record.current.text});
      continue;
    }
    const next=replaceMediaPathReferences(record.current.text,oldPath,newPath,isFolder);
    if(next!==record.current.text)matched.push({...record,next});
  }
  const blobShas=scanOnly?[]:await Promise.all(matched.map(record=>GH.createBlob(record.next,'utf-8')));
  const sections=new Set(),projectIds=new Set(),projectTitles=new Set(),projectTitlesById=new Map();
  const sourceModes=new Map((tree||[]).filter(item=>item?.path).map(item=>[item.path,item.mode||'100644']));
  const entries=matched.map((record,index)=>{
    const filePath=record.filePath;
    const section=Object.entries(SECTIONS).find(([,config])=>config.file===filePath);
    if(section)sections.add(section[0]);
    if(filePath==='data/projects.json'){
      try{
        const projects=JSON.parse(record.current.text);
        if(Array.isArray(projects))projects.forEach(project=>{
          const referencesMedia=scanOnly
            ? valueReferencesMediaPathForDeletion(project,oldPath,isFolder)
            : valueReferencesMediaPath(project,oldPath,isFolder);
          if(!project||typeof project!=='object'||!referencesMedia)return;
          const id=String(project.id||slugify(project.title||''));
          const title=String(project.title||id||'Untitled project');
          if(id)projectIds.add(id);
          if(title)projectTitles.add(title);
          if(id&&title)projectTitlesById.set(id,title);
        });
      }catch(_){}
    }else if(filePath==='data/curated-views.json'){
      try{
        const views=JSON.parse(record.current.text);
        if(Array.isArray(views))views.forEach(view=>{
          (Array.isArray(view?.projects)?view.projects:[]).forEach(entry=>{
            const referencesMedia=scanOnly
              ? valueReferencesMediaPathForDeletion(entry.project,oldPath,isFolder)
              : valueReferencesMediaPath(entry.project,oldPath,isFolder);
            if(entry?.source!=='curated'||!referencesMedia)return;
            const title=String(entry.project?.title||entry.project?.id||'Untitled curated project');
            projectTitles.add(String(view?.name||view?.slug||'Curated View')+' / '+title);
          });
        });
      }catch(_){}
    }
    // If a text asset being moved contains a self-reference, write its
    // updated contents at the destination path instead of recreating the old
    // path after the delete entry.
    const outputPath=!isFolder&&filePath===oldPath
      ? newPath
      : isFolder&&filePath.startsWith(oldPath+'/')
        ? newPath+filePath.slice(oldPath.length)
        : filePath;
    return {path:outputPath,mode:sourceModes.get(filePath)||'100644',type:'blob',sha:blobShas[index]};
  });
  // Main Portfolio assets are also visible through any Curated View that
  // references those project IDs. Mark those tabs even when their own JSON
  // does not need a textual path replacement.
  if(projectIds.size){
    const curatedRecord=files.find(record=>record?.filePath==='data/curated-views.json');
    if(curatedRecord){
      try{
        const views=JSON.parse(curatedRecord.current.text);
        if(Array.isArray(views))views.forEach(view=>{
          (Array.isArray(view?.projects)?view.projects:[]).forEach(entry=>{
            if(entry?.source!=='main')return;
            const id=String(entry.projectId||'');
            if(!projectIds.has(id))return;
            sections.add('curatedViews');
            projectTitles.add(String(view?.name||view?.slug||'Curated View')+' → '+(projectTitlesById.get(id)||id));
          });
        });
      }catch(_){}
    }
  }
  return {entries:scanOnly?[]:entries,changedFiles:matched.map(record=>record.filePath),sections:[...sections],projectIds:[...projectIds],projectTitles:[...projectTitles]};
}

function recordMediaImpact(impact,oldPath,newPath){
  lastMediaImpact={
    sections:[...(impact.sections||[])],
    projectIds:[...(impact.projectIds||[])],
    projectTitles:[...(impact.projectTitles||[])],
    changedFiles:[...(impact.changedFiles||[])],
    oldPath,newPath
  };
  updateMediaImpactIndicators();
}

function setMediaOperationStatus(message,isError=false){
  const grid=document.getElementById('mediaGrid')||document.getElementById('pickerGrid');
  if(!grid?.parentNode)return;
  let status=document.getElementById('mediaOperationStatus');
  if(!status||!status.isConnected){
    status=document.createElement('div');
    status.id='mediaOperationStatus';
    status.className='banner info';
    status.style.marginBottom='12px';
    status.style.gridColumn='1/-1';
    status.setAttribute('role','status');
    grid.parentNode.insertBefore(status,grid);
  }
  status.classList.toggle('media-operation-error',!!isError);
  status.setAttribute('role',isError?'alert':'status');
  status.textContent=String(message||'');
}

function applyMediaTreeEntries(baseTree,entries){
  // Media Library builds folders from file paths; keep the fallback cache to blobs
  // only so deleted implicit Git tree nodes cannot resurrect the old folder name.
  const byPath=new Map((baseTree||[]).filter(item=>item?.type==='blob'&&item.path).map(item=>[item.path,{...item}]));
  (entries||[]).forEach(entry=>{
    if(!entry?.path)return;
    if(entry.sha===null){byPath.delete(entry.path);return;}
    const previous=byPath.get(entry.path)||{};
    byPath.set(entry.path,{...previous,...entry,type:entry.type||'blob',mode:entry.mode||previous.mode||'100644'});
  });
  return [...byPath.values()].sort((a,b)=>String(a.path).localeCompare(String(b.path)));
}

async function refreshMediaTreeAfterCommit(baseTree,entries){
  const localTree=applyMediaTreeEntries(baseTree,entries);
  setMediaTreeCache(localTree);
  try{
    const remoteTree=await loadMediaTree(true);
    return Array.isArray(remoteTree)?remoteTree:localTree;
  }catch(error){
    // The Git commit has already succeeded. Keep the deterministic tree built
    // from that commit's exact changes and let the user continue working.
    setMediaTreeCache(localTree);
    setMediaOperationStatus('Rename committed, but the live Media Library refresh failed. The renamed paths are applied locally; use Refresh to reconcile with GitHub. '+(error?.message||''),true);
    return localTree;
  }
}

async function renameMediaFile(oldPath,onDone){
  if(!oldPath || !oldPath.startsWith('assets/')){toast('Only files inside the Media Library can be renamed.',true);return;}
  const oldName=oldPath.split('/').pop();
  const rawName=prompt('Rename file:',oldName);
  if(rawName===null)return;
  const name=String(rawName).trim();
  if(!name || name===oldName)return;
  if(name.includes('/') || name.includes(String.fromCharCode(92)) || Array.from(name).some(ch=>ch.charCodeAt(0)<32) || name==='.' || name==='..' || name.length>180){
    toast('Enter a valid file name without folder separators.',true);return;
  }
  setMediaOperationStatus('Checking the current branch and destination…');
  const parent=oldPath.slice(0,oldPath.lastIndexOf('/'));
  const newPath=joinRepoPath(parent,name);
  const parentSha=await GH.getBranchHead();
  if(!parentSha)throw new Error(`Couldn't resolve the current ${conn.branch} branch head.`);
  const tree=await GH.getTree(parentSha);
  const source=tree.find(item=>item.type==='blob'&&item.path===oldPath);
  if(!source){setMediaOperationStatus('Rename blocked: this file no longer exists in the current branch. Refresh and try again.',true);toast('This file no longer exists in the current branch. Refresh and try again.',true);return;}
  if(tree.some(item=>item.path===newPath || item.path.startsWith(newPath+'/'))){setMediaOperationStatus('Rename blocked: a file or folder with that name already exists here.',true);toast('A file or folder with that name already exists here.',true);return;}
  setMediaOperationStatus('Scanning tracked website and CMS files for references…');
  toast('Checking where this file is used…');
  const impact=await prepareMediaReferenceUpdates(oldPath,newPath,parentSha,tree,false);
  const entryByPath=new Map([
    [newPath,{path:newPath,mode:source.mode||'100644',type:'blob',sha:source.sha}],
    [oldPath,{path:oldPath,mode:'100644',type:'blob',sha:null}]
  ]);
  // Reference-file writes have final say when a renamed text file references
  // itself: its destination should contain rewritten data, not the old blob.
  impact.entries.forEach(entry=>entryByPath.set(entry.path,entry));
  const entries=[...entryByPath.values()];
  if(!confirm('Rename “'+oldPath+'” to “'+newPath+'”?\n'+mediaImpactSummary(impact))){setMediaOperationStatus('Rename cancelled. No repository changes were made.');return;}
  setMediaOperationStatus('Committing rename and reference updates…');
  await ghCommitTreeEntries(entries,`CMS: rename file ${oldPath} → ${newPath} and update references`,parentSha);
  Object.entries(SECTIONS).forEach(([key,section])=>{if(impact.changedFiles.includes(section.file))delete cache[key];});
  recordMediaImpact(impact,oldPath,newPath);
  const refreshedTree=await refreshMediaTreeAfterCommit(tree,entries);
  setMediaOperationStatus('Renamed file: '+oldPath+' → '+newPath);
  toast('Renamed '+oldName+' to '+name+(impact.changedFiles.length?' and updated '+impact.changedFiles.length+' reference file'+(impact.changedFiles.length===1?'':'s'):'')+'.');
  if(onDone)await onDone(newPath,refreshedTree,impact);
}

async function renameMediaFolder(oldPath,onDone){
  if(!oldPath || oldPath==='assets'){toast('The Media Library root cannot be renamed.',true);return;}
  const oldName=oldPath.split('/').pop();
  const rawName=prompt('Rename folder:',oldName);
  if(rawName===null)return;
  const name=safeFolderName(rawName);
  if(!name){setMediaOperationStatus('Rename blocked: enter a valid folder name without folder separators.',true);toast('Enter a valid folder name without folder separators.',true);return;}
  if(name===oldName)return;
  setMediaOperationStatus('Checking the current branch and destination…');
  const parent=oldPath.includes('/')?oldPath.slice(0,oldPath.lastIndexOf('/')):'';
  const newPath=joinRepoPath(parent,name);
  if(newPath===oldPath)return;
  const parentSha=await GH.getBranchHead();
  if(!parentSha)throw new Error(`Couldn't resolve the current ${conn.branch} branch head.`);
  const tree=await GH.getTree(parentSha);
  if(tree.some(item=>item.path===newPath||item.path.startsWith(newPath+'/'))){setMediaOperationStatus('Rename blocked: that destination already exists.',true);toast('That destination already exists.',true);return;}
  const prefix=oldPath+'/';
  const moving=tree.filter(item=>item.type==='blob'&&item.path.startsWith(prefix));
  if(!moving.length){setMediaOperationStatus('Rename blocked: that folder has no tracked files to move.',true);toast('That folder has no tracked files to move.',true);return;}
  setMediaOperationStatus('Scanning tracked website and CMS files for references…');
  toast('Checking which projects and sections use this folder…');
  const impact=await prepareMediaReferenceUpdates(oldPath,newPath,parentSha,tree,true);
  const entryByPath=new Map();
  moving.forEach(item=>{
    const suffix=item.path.slice(prefix.length);
    entryByPath.set(newPath+'/'+suffix,{path:newPath+'/'+suffix,mode:item.mode||'100644',type:'blob',sha:item.sha});
    entryByPath.set(item.path,{path:item.path,mode:'100644',type:'blob',sha:null});
  });
  // Apply rewritten self-referencing files at their destination paths.
  impact.entries.forEach(entry=>entryByPath.set(entry.path,entry));
  const entries=[...entryByPath.values()];
  if(!confirm('Rename “'+oldPath+'” to “'+newPath+'”?\n'+mediaImpactSummary(impact))){setMediaOperationStatus('Rename cancelled. No repository changes were made.');return;}
  setMediaOperationStatus('Committing rename and reference updates…');
  await ghCommitTreeEntries(entries,`CMS: rename folder ${oldPath} → ${newPath} and update references`,parentSha);
  mediaCurrentPath=remapNestedPath(mediaCurrentPath,oldPath,newPath);
  mediaPickerPath=remapNestedPath(mediaPickerPath,oldPath,newPath);
  Object.entries(SECTIONS).forEach(([key,section])=>{if(impact.changedFiles.includes(section.file))delete cache[key];});
  recordMediaImpact(impact,oldPath,newPath);
  const refreshedTree=await refreshMediaTreeAfterCommit(tree,entries);
  setMediaOperationStatus('Renamed folder: '+oldPath+' → '+newPath);
  toast('Renamed '+oldName+' to '+name+(impact.changedFiles.length?' and updated '+impact.changedFiles.length+' reference file'+(impact.changedFiles.length===1?'':'s'):'')+'.');
  if(onDone)await onDone(newPath,refreshedTree,impact);
}

async function ghCommitTreeEntries(entries,message,parentSha){
  if(!entries.length) throw new Error('Nothing to commit.');
  if(!parentSha) parentSha=await GH.getBranchHead();
  if(!parentSha) throw new Error(`Couldn't resolve the current ${conn.branch} branch head.`);
  const commitUrl=`https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}/git/commits/${encodeURIComponent(parentSha)}`;
  const res=await githubFetch(commitUrl,{headers:authHeaders()});
  if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.message||`GitHub error ${res.status}`);}
  const base=(await res.json()).tree.sha;
  const treeSha=await GH.createTree(base,entries);
  const commit=await GH.createCommit(message,treeSha,parentSha);
  const currentHead=await GH.getBranchHead();
  if(currentHead!==parentSha)throw new Error('The repository changed while preparing this media operation. Nothing was applied; refresh the Media Library and retry.');
  await GH.updateBranch(commit.sha);
  return commit;
}
/* =====================================================================
   13a. MEDIA PICKER MODAL — "Browse…" popup usable from any field
   =====================================================================
   Same folder/file browser as the Media Library screen, as a pick-one-
   and-close overlay — so choosing a Source/Photo/Thumbnail means
   clicking the file you want instead of alt-tabbing to Media Library,
   copying a path, and tabbing back to paste it. Reads the same cached
   tree (mediaTreeCache / loadMediaTree above) so it never re-fetches
   just because it's opened from a different screen. */
let mediaPickerPath = 'assets';

function childrenOfPath(tree, path){
  const prefix = path ? path + '/' : '';
  const folders = new Set();
  const files = [];
  tree.forEach(item => {
    if (!item.path.startsWith(prefix)) return;
    const rest = item.path.slice(prefix.length);
    if (!rest) return;
    const slash = rest.indexOf('/');
    if (slash === -1) { if (item.type === 'blob' && rest !== '.gitkeep') files.push(item); }
    else folders.add(rest.slice(0, slash));
  });
  return { folders: [...folders].sort(), files: files.sort((a,b)=>a.path.localeCompare(b.path)) };
}

function openMediaPicker(onPick, options={}){
  const overlay=document.createElement('div');
  overlay.className='media-picker-overlay';
  overlay.innerHTML=`
    <div class="media-picker-dialog" role="dialog" aria-modal="true" aria-label="Choose a file">
      <div class="media-picker-head"><div><strong>Choose a file</strong><span class="media-picker-sub" data-picker-title>Media Library</span></div><button class="icon-btn" data-close-picker type="button" title="Close"><i class="fa-solid fa-xmark"></i></button></div>
      <div class="media-picker-toolbar">
        <div class="media-picker-pathbar">
          <div class="media-folder-crumb" id="pickerCrumbs"></div>
        </div>
        <div class="media-picker-control-row">
          <input class="picker-search" id="pickerSearch" type="search" placeholder="Search files…" autocomplete="off">
          <select class="picker-kind" id="pickerKind" title="Filter file type">
            <option value="">All files</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
            <option value="lottie">Lottie JSON</option>
            <option value="model">3D Models</option>
            <option value="other">Other files</option>
          </select>
          <div class="media-picker-actions"><button class="ghost" id="pickerNewFolder" type="button"><i class="fa-solid fa-folder-plus"></i> New folder</button><button class="ghost" id="pickerRenameFolder" type="button"><i class="fa-solid fa-pen"></i> Rename folder</button><button class="ghost" id="pickerRefresh" type="button" title="Refresh"><i class="fa-solid fa-rotate"></i></button></div>
        </div>
      </div>
      <div class="dropzone dropzone-compact" id="pickerDropzone"><i class="fa-solid fa-cloud-arrow-up"></i>Drag a file here, or click to upload into this folder<input type="file" id="pickerFileInput" multiple style="display:none"></div>
      <div class="media-picker-scroll"><div class="media-grid" id="pickerGrid"></div></div>
    </div>`;
  document.body.appendChild(overlay);

  let closed=false;
  let pickerTree=null;
  let pickerSearch='';
  let pickerKind=options.kind||'';
  let needsInitialRefresh=true;
  let pickerPaintVersion=0;
  const titleEl=overlay.querySelector('[data-picker-title]');
  if(titleEl && options.title) titleEl.textContent=options.title;
  const kindSelect=overlay.querySelector('#pickerKind');
  if(kindSelect) kindSelect.value=pickerKind;
  const searchInput=overlay.querySelector('#pickerSearch');
  const close=()=>{ if(closed)return; closed=true; overlay.remove(); document.removeEventListener('keydown',escHandler); };
  function escHandler(e){ if(e.key==='Escape') close(); }
  overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
  overlay.querySelector('[data-close-picker]').addEventListener('click',close);
  document.addEventListener('keydown',escHandler);

  async function handlePickerUpload(fileList){
    if(!fileList?.length)return;
    const grid=overlay.querySelector('#pickerGrid');
    await uploadFilesToFolder(fileList,mediaPickerPath||'assets',grid,pickerTree||[]);
    await loadMediaTree(true);
    await paintPicker();
  }
  overlay.querySelector('#pickerDropzone').addEventListener('click',()=>overlay.querySelector('#pickerFileInput').click());
  overlay.querySelector('#pickerFileInput').addEventListener('change',e=>handlePickerUpload(e.target.files));
  ['dragenter','dragover'].forEach(evt=>overlay.querySelector('#pickerDropzone').addEventListener(evt,e=>{e.preventDefault();e.currentTarget.classList.add('hover');}));
  ['dragleave','drop'].forEach(evt=>overlay.querySelector('#pickerDropzone').addEventListener(evt,e=>{e.preventDefault();e.currentTarget.classList.remove('hover');}));
  overlay.querySelector('#pickerDropzone').addEventListener('drop',e=>{if(e.dataTransfer.files.length)handlePickerUpload(e.dataTransfer.files);});
  overlay.querySelector('#pickerNewFolder').addEventListener('click',async()=>{ try{await createMediaFolder(mediaPickerPath||'assets',async p=>{mediaPickerPath=p;await paintPicker();});}catch(err){toast(err.message,true);} });
  overlay.querySelector('#pickerRenameFolder').addEventListener('click',async event=>{
    const button=event.currentTarget;
    button.disabled=true;
    try{
      await renameMediaFolder(mediaPickerPath,async(p,nextTree)=>{
        if(Array.isArray(nextTree))setMediaTreeCache(nextTree);
        mediaPickerPath=p;
        await paintPicker();
      });
    }catch(err){
      const message=err?.message||'Could not rename this folder.';
      setMediaOperationStatus('Folder rename failed: '+message,true);
      toast(message,true);
    }finally{if(button.isConnected)button.disabled=false;}
  });
  overlay.querySelector('#pickerRefresh').addEventListener('click',async()=>{try{await loadMediaTree(true);await paintPicker();toast('Refreshed.');}catch(err){toast(err.message,true);}});
  kindSelect?.addEventListener('change',()=>{pickerKind=kindSelect.value;paintPicker();});
  searchInput?.addEventListener('input',()=>{pickerSearch=searchInput.value.trim().toLowerCase();paintPicker();});

  async function paintPicker(forceRefresh=false){
    const paintVersion=++pickerPaintVersion;
    const shouldRefresh=forceRefresh||needsInitialRefresh;
    needsInitialRefresh=false;
    const grid=overlay.querySelector('#pickerGrid');
    let tree;
    try { tree=await loadMediaTree(shouldRefresh); }
    catch(err) {
      if(closed||paintVersion!==pickerPaintVersion)return;
      grid.innerHTML=`<div class="banner info" style="grid-column:1/-1;border-color:rgba(224,88,79,.4)">Couldn’t load your files — ${esc(err.message)}</div>`;
      return;
    }
    if(closed||paintVersion!==pickerPaintVersion)return;
    pickerTree=tree;
    const {folders,files}=childrenOfPath(tree,mediaPickerPath);
    const visibleFiles=files.filter(item=>{
      const kind=fileKind(item.path);
      const kindOk=!pickerKind||kind===pickerKind;
      const searchOk=!pickerSearch||item.path.toLowerCase().includes(pickerSearch);
      return kindOk&&searchOk;
    });
    const parts=mediaPickerPath.split('/').filter(Boolean);
    const crumbWrap=overlay.querySelector('#pickerCrumbs');
    crumbWrap.innerHTML='';
    parts.forEach((seg,i)=>{
      const pathHere=parts.slice(0,i+1).join('/');
      const btn=document.createElement('button');btn.type='button';btn.textContent=seg;btn.addEventListener('click',()=>{mediaPickerPath=pathHere;paintPicker();});crumbWrap.appendChild(btn);
      if(i<parts.length-1){const sep=document.createElement('span');sep.textContent='/';crumbWrap.appendChild(sep);}
    });
    overlay.querySelector('#pickerRenameFolder').disabled=mediaPickerPath==='assets';
    grid.innerHTML='';
    if(!folders.length&&!visibleFiles.length) grid.innerHTML=`<div class="banner muted" style="grid-column:1/-1">${pickerSearch||pickerKind?'No matching files in this folder.':'Nothing here yet — use New folder or upload a file above.'}</div>`;
    folders.forEach(f=>{
      const path=mediaPickerPath+'/'+f; const tile=document.createElement('div'); tile.className='media-tile folder-tile'; tile.innerHTML=folderTileHtml(f,findFolderPreviewImage(tree,path));
      tile.addEventListener('click',()=>{mediaPickerPath=path;paintPicker();});
      tile.querySelector('[data-folder-rename]')?.addEventListener('click',async e=>{
        e.stopPropagation();
        const button=e.currentTarget;
        button.disabled=true;
        try{
          await renameMediaFolder(path,async(p,nextTree)=>{
            if(Array.isArray(nextTree))setMediaTreeCache(nextTree);
            mediaPickerPath=p;
            await paintPicker();
          });
        }catch(err){
          const message=err?.message||'Could not rename this folder.';
          setMediaOperationStatus('Folder rename failed: '+message,true);
          toast(message,true);
        }finally{if(button.isConnected)button.disabled=false;}
      });
      grid.appendChild(tile);
    });
    visibleFiles.forEach(item=>{
      const tile=document.createElement('div'); tile.className='media-tile media-select-tile'; tile.style.cursor='pointer'; tile.innerHTML=fileTileHtml(item); tile.addEventListener('click',()=>{onPick(item.path);close();}); grid.appendChild(tile);
    });
  }
  paintPicker();
}

// Drops a small "Browse…" icon-button next to an existing path input,
// wrapping the two in one row so the label stays put above them. Picking
// a file writes the path into the input, fires a real `input` event (so
// whatever this field was already wired to do on typing still runs), and
// calls onPicked with the chosen path for anything that needs to react
// beyond that — a live preview, most often.
function attachMediaBrowseButton(inputEl, onPicked, optionsOrProvider){
  if(!inputEl || !inputEl.parentNode || inputEl.closest('.browse-row')) return null;
  const row = document.createElement('div');
  row.className = 'browse-row';
  inputEl.parentNode.insertBefore(row, inputEl);
  row.appendChild(inputEl);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.title = 'Browse media library';
  btn.innerHTML = '<i class="fa-solid fa-folder-open"></i>';
  row.appendChild(btn);
  btn.addEventListener('click', () => {
    const options = typeof optionsOrProvider === 'function' ? (optionsOrProvider() || {}) : (optionsOrProvider || {});
    openMediaPicker(path => {
      inputEl.value = path;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      if (onPicked) onPicked(path);
    }, options);
  });
  return btn;
}

/* =====================================================================
   13b. PREVIEW ASPECT-RATIO AUTO-FIT
   =====================================================================
   Every .media-preview box starts at a neutral 16/10 placeholder (see
   the CSS above) and is resized here, once the real media is loaded, to
   its true aspect ratio — a square render stays square, a phone
   screenshot stays tall, a wide banner stays wide — instead of every
   preview being force-cropped into the same landscape frame regardless
   of what it actually is. Clamped so a very extreme panorama or a very
   tall image still stays a reasonably sized box in this UI. */
function fitPreviewAspect(boxEl, ratio){
  if (!boxEl || !ratio || !isFinite(ratio) || ratio <= 0) return;
  boxEl.style.aspectRatio = Math.max(9/16, Math.min(21/9, ratio));
}

const lottiePreviewDimensionCache = new Map();

function loadLottiePreviewDimensions(url){
  if (!url) return Promise.resolve(null);
  const cached = lottiePreviewDimensionCache.get(url);
  if (cached) return cached;

  const request = fetch(url, {
    credentials: 'omit',
    cache: 'force-cache'
  }).then(async response => {
    if (!response.ok) return null;
    const payload = await response.json();
    const width = Number(payload?.w);
    const height = Number(payload?.h);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const dimensions = { width, height };
    lottiePreviewDimensionCache.set(url, Promise.resolve(dimensions));
    return dimensions;
  }).catch(() => null);

  lottiePreviewDimensionCache.set(url, request);
  return request;
}

function fitExactPreviewAspect(boxEl, width, height){
  const w = Number(width);
  const h = Number(height);
  if (!boxEl || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
  boxEl.style.aspectRatio = w + ' / ' + h;
}

function wirePreviewAspect(boxEl, m){
  if (!boxEl) return;
  if (m.type === 'model') {
    const orientation = m.orientation || 'auto';
    fitPreviewAspect(boxEl, orientation === 'landscape' ? 16/9 : orientation === 'portrait' ? 9/16 : 1);
    return;
  }
  if (m.type === 'video') {
    const v = boxEl.querySelector('video');
    if (v) v.addEventListener('loadedmetadata', () => fitPreviewAspect(boxEl, v.videoWidth / v.videoHeight), { once: true });
    return;
  }
  if (m.type === 'youtube') {
    // No cheap way to read the real embed ratio without another network
    // call, so this uses the same rule of thumb the live lightbox already
    // uses: a /shorts/ link is portrait, everything else is landscape.
    fitPreviewAspect(boxEl, /\/shorts\//.test(m.src || '') ? 9/16 : 16/9);
    return;
  }
  if (m.type === 'lottie') {
    const url = ghRawUrl(m.src);
    loadLottiePreviewDimensions(url).then(dimensions => {
      if (!dimensions || !boxEl.isConnected) return;
      fitExactPreviewAspect(boxEl, dimensions.width, dimensions.height);
    });
    return;
  }
  const img = boxEl.querySelector('img');
  if (img) {
    if (img.complete && img.naturalWidth) fitPreviewAspect(boxEl, img.naturalWidth / img.naturalHeight);
    else img.addEventListener('load', () => fitPreviewAspect(boxEl, img.naturalWidth / img.naturalHeight), { once: true });
  }
}

/* =====================================================================
   13c. PROJECT THUMBNAIL FALLBACK
   =====================================================================
   Mirrors fillMissingThumbnails() in the live site's js/script.js: if a
   project has no explicit thumbnail, the card uses its first Image-type
   media item, or failing that its first YouTube-type item's thumbnail.
   Used here purely to preview what the live site will show — it never
   writes anything into thumbnail.src itself, same as the live site
   only ever fills in the rendered preview, never the underlying data. 3D fallbacks
   also carry the CMS-selected thumbnail ratio so the editor mirrors the live media list. */
function computeFallbackThumb(media, thumbnail = {}){
  const thumbnailBackground = thumbnail?.background && typeof thumbnail.background === 'object'
    ? thumbnail.background
    : null;
  const firstUsable=(media||[]).find(m=>m&&m.src&&['image','video','lottie','model'].includes(m.type));
  if(firstUsable) return {
    type:firstUsable.type,
    src:firstUsable.src,
    background:firstUsable.background || thumbnailBackground,
    orientation:firstUsable.orientation||''
  };
  const yt=(media||[]).find(m=>m&&m.type==='youtube'&&m.src);
  if(yt){
    const id=extractYouTubeId(yt.src);
    if(id) return {
      type:'image',
      src:`https://img.youtube.com/vi/${id}/hqdefault.jpg`,
      background:thumbnailBackground
    };
  }
  return null;
}
function computeFallbackThumbSrc(media){ const x=computeFallbackThumb(media); return x?x.src:''; }

RENDERERS.media = async function(data, isCurrent=()=>true){
  content.innerHTML = `<div class="loading-row"><i class="fa-solid fa-circle-notch spin"></i> Loading your files…</div>`;
  let tree;
  try{ tree = await loadMediaTree(false); }
  catch(err){
    if(!isCurrent()) return;
    content.innerHTML = `<div class="content-head"><div><h2>Media Library</h2></div></div><div class="banner info" style="border-color:rgba(224,88,79,.4)"><i class="fa-solid fa-triangle-exclamation" style="color:#e0584f"></i><div><strong>Couldn't load your files.</strong><br>${esc(err.message)}</div></div>`;
    return;
  }
  if(!isCurrent()) return;
  paint();

  function childrenOf(path){
    const prefix = path ? path + '/' : '';
    const folders = new Set();
    const files = [];
    tree.forEach(item => {
      if (!item.path.startsWith(prefix)) return;
      const rest = item.path.slice(prefix.length);
      if (!rest) return;
      const slash = rest.indexOf('/');
      if (slash === -1) {
        if (item.type === 'blob') files.push(item);
      } else {
        folders.add(rest.slice(0, slash));
      }
    });
    return { folders: [...folders].sort(), files: files.sort((a,b)=>a.path.localeCompare(b.path)) };
  }

  function paint(){
    if(!isCurrent()) return;
    const { folders, files } = childrenOf(mediaCurrentPath);
    const crumbs = mediaCurrentPath.split('/');

    content.innerHTML = sectionHead('Media Library', 'Everything your projects and hero can point to — upload new files here, then copy the path into a Source or Photo field elsewhere in the CMS.') + `
      <div class="media-toolbar">
        <div class="field">
          <label class="field-label">Upload to folder</label>
          <input id="uploadPath" value="${attr(mediaCurrentPath)}">
        </div>
        <div class="media-toolbar-actions"><button class="ghost" id="btnNewFolder" type="button"><i class="fa-solid fa-folder-plus"></i> New folder</button><button class="icon-btn media-toolbar-icon" id="btnRenameFolder" type="button" title="Rename current folder" aria-label="Rename current folder"><i class="fa-solid fa-pen" aria-hidden="true"></i></button><button class="ghost" id="btnRefresh" type="button"><i class="fa-solid fa-rotate"></i> Refresh</button></div>
      </div>

      <div class="dropzone" id="dropzone">
        <i class="fa-solid fa-cloud-arrow-up"></i>
        Drag files here, or click to choose — images and videos both work
        <input type="file" id="fileInput" multiple style="display:none">
      </div>

      <div class="media-folder-crumb" id="crumbs"></div>
      <div class="media-grid" id="mediaGrid"></div>
    `;

    // breadcrumb
    const crumbWrap = document.getElementById('crumbs');
    crumbs.forEach((seg, i) => {
      const pathHere = crumbs.slice(0, i+1).join('/');
      const btn = document.createElement('button');
      btn.textContent = seg;
      btn.addEventListener('click', () => { mediaCurrentPath = pathHere; paint(); });
      crumbWrap.appendChild(btn);
      if (i < crumbs.length - 1) {
        const sep = document.createElement('span');
        sep.textContent = '/';
        sep.style.color = '#444';
        crumbWrap.appendChild(sep);
      }
    });

    // grid
    const grid = document.getElementById('mediaGrid');
    if (!folders.length && !files.length) {
      grid.innerHTML = `<div class="banner muted" style="grid-column:1/-1">Nothing in this folder yet — upload something above.</div>`;
    }
    folders.forEach(f => {
      const tile = document.createElement('div');
      tile.className = 'media-tile folder-tile';
      const folderPath = mediaCurrentPath + '/' + f;
      tile.innerHTML = folderTileHtml(f, findFolderPreviewImage(tree, folderPath));
      tile.addEventListener('click', () => { mediaCurrentPath = folderPath; paint(); });
      tile.querySelector('[data-folder-rename]')?.addEventListener('click', async e => {
        e.stopPropagation();
        const button=e.currentTarget;
        button.disabled=true;
        try{
          await renameMediaFolder(folderPath,async(p,nextTree)=>{
            if(!isCurrent())return;
            tree=Array.isArray(nextTree)?nextTree:await loadMediaTree(true);
            if(!isCurrent())return;
            mediaCurrentPath=p;
            paint();
          });
        }catch(err){
          const message=err?.message||'Could not rename this folder.';
          setMediaOperationStatus('Folder rename failed: '+message,true);
          toast(message,true);
        }finally{if(button.isConnected)button.disabled=false;}
      });
      grid.appendChild(tile);
    });
    files.forEach(item => {
      const tile = document.createElement('div');
      tile.className = 'media-tile';
      tile.innerHTML = fileTileHtml(item) + `
        <div class="tile-actions" aria-label="File actions">
          ${mediaActionButtonHtml('rename','Rename file','fa-pen')}
          ${mediaActionButtonHtml('copy','Copy file path','fa-copy')}
          ${mediaActionButtonHtml('del','Delete file','fa-trash','media-delete-action')}
        </div>
      `;
      const previewThumb=tile.querySelector('.thumb');
      if(previewThumb){
        const previewName=item.path.split('/').pop()||item.path;
        previewThumb.dataset.viewFull='true';
        previewThumb.tabIndex=0;
        previewThumb.setAttribute('role','button');
        previewThumb.setAttribute('aria-haspopup','dialog');
        previewThumb.setAttribute('aria-label','Open full preview of '+previewName);
        const cue=document.createElement('span');
        cue.className='tile-view-cue';
        cue.setAttribute('aria-hidden','true');
        cue.innerHTML='<i class="fa-solid fa-expand"></i><span>View</span>';
        previewThumb.appendChild(cue);
        previewThumb.addEventListener('click',event=>{event.stopPropagation();openMediaFullPreview(item,previewThumb);});
        previewThumb.addEventListener('keydown',event=>{
          if(event.target!==previewThumb||(event.key!=='Enter'&&event.key!==' '))return;
          event.preventDefault();
          event.stopPropagation();
          openMediaFullPreview(item,previewThumb);
        });
      }
      tile.querySelector('[data-rename]').addEventListener('click', async event => {
        event.stopPropagation();
        const button=event.currentTarget;
        button.disabled=true;
        try{
          await renameMediaFile(item.path,async(newPath,nextTree)=>{
            if(!isCurrent())return;
            tree=Array.isArray(nextTree)?nextTree:await loadMediaTree(true);
            if(!isCurrent())return;
            mediaCurrentPath=newPath.slice(0,newPath.lastIndexOf('/'))||'assets';
            paint();
          });
        }catch(err){
          const message=err?.message||'Could not rename this file.';
          setMediaOperationStatus('File rename failed: '+message,true);
          toast(message,true);
        }finally{if(button.isConnected)button.disabled=false;}
      });
      tile.querySelector('[data-copy]').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(item.path); toast('Path copied — paste it into a Source or Photo field.'); }
        catch(e){ prompt('Copy this path:', item.path); }
      });
      tile.querySelector('[data-del]').addEventListener('click', async event => {
        const button=event.currentTarget;
        const deletedName=item.path.split('/').pop() || item.path;
        if(button.disabled)return;
        button.disabled=true;
        let deleted=false;
        try {
          setMediaOperationStatus('Checking tracked website and CMS references before deletion…');
          const parentSha=await GH.getBranchHead();
          if(!parentSha)throw new Error('Could not resolve the current branch head. Refresh the Media Library and retry.');
          const snapshot=await GH.getTree(parentSha);
          const source=snapshot.find(entry=>entry?.type==='blob'&&entry.path===item.path);
          if(!source)throw new Error('This file no longer exists on the current branch. Refresh the Media Library and retry.');
          if(source.sha!==item.sha)throw new Error('This file changed after the Media Library was loaded. Refresh the Media Library and review the current file before retrying.');
          const impact=await prepareMediaReferenceUpdates(item.path,'__MEDIA_PATH_AUDIT__',parentSha,snapshot,false,true);
          if(!isCurrent())return;
          if(impact.changedFiles.length){
            const message=mediaDeletionReferenceMessage(item.path,impact);
            setMediaOperationStatus(message,true);
            toast('Deletion blocked because the file is still referenced. See the Media Library status.',true);
            return;
          }
          const latestHead=await GH.getBranchHead();
          if(latestHead!==parentSha)throw new Error('The repository changed during the reference scan. No deletion was made; refresh the Media Library and retry.');
          if(!confirm('No references were found in the tracked website/CMS text files scanned. Delete "'+item.path+'" from the current branch? The file will remain in Git history.')){
            setMediaOperationStatus('Deletion cancelled. No repository changes were made.');
            return;
          }
          setMediaOperationStatus('Deleting unreferenced media file…');
          await ghCommitTreeEntries([{path:item.path,mode:source.mode||'100644',type:'blob',sha:null}],'CMS: delete unreferenced media file '+item.path,parentSha);
          deleted=true;
          toast('Deleted '+deletedName+'.');
          try {
            tree=await loadMediaTree(true);
            if(!isCurrent())return;
            paint();
          } catch(refreshError) {
            if(!isCurrent())return;
            const message='Deleted '+deletedName+', but the Media Library could not refresh. Use Refresh to reconcile with GitHub. '+(refreshError?.message||'');
            setMediaOperationStatus(message,true);
            toast('File deleted, but refresh failed. Use Refresh.',true);
          }
        } catch(err) {
          if(isCurrent()){
            const message=(err?.message||'Could not safely delete this media file.')+(deleted?' The deletion commit succeeded; refresh the Media Library before continuing.':'');
            setMediaOperationStatus(message,true);
            toast(message,true);
          }
        } finally {
          if(button.isConnected)button.disabled=false;
        }
      });

      grid.appendChild(tile);
    });

    document.getElementById('btnNewFolder').addEventListener('click', async () => {
      try { await createMediaFolder(mediaCurrentPath || 'assets', async p => {
          if(!isCurrent()) return;
          mediaCurrentPath=p;
          paint();
        }); } catch(err){ toast(err.message,true); }
    });
    document.getElementById('btnRenameFolder').disabled = mediaCurrentPath==='assets';
    document.getElementById('btnRenameFolder').addEventListener('click', async () => {
      const button=document.getElementById('btnRenameFolder');
      button.disabled=true;
      try { await renameMediaFolder(mediaCurrentPath, async (p,nextTree) => {
          if(!isCurrent()) return;
          tree=Array.isArray(nextTree)?nextTree:await loadMediaTree(true);
          if(!isCurrent())return;
          mediaCurrentPath=p;
          paint();
        }); } catch(err){
          const message=err?.message||'Could not rename this folder.';
          setMediaOperationStatus('Folder rename failed: '+message,true);
          toast(message,true);
        }
      finally { if(button.isConnected)button.disabled=mediaCurrentPath==='assets'; }
    });

    document.getElementById('btnRefresh').addEventListener('click', async event => {
      const button=event.currentTarget;
      button.disabled=true;
      try {
        const refreshedTree=await loadMediaTree(true);
        if(!isCurrent())return;
        tree=refreshedTree;
        paint();
        toast('Refreshed.');
      } catch(err) {
        if(isCurrent())toast(`Couldn't refresh Media Library: ${err.message}`,true);
      } finally {
        if(button.isConnected)button.disabled=false;
      }
    });

    // upload
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => handleFiles(fileInput.files));
    ['dragenter','dragover'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add('hover'); }));
    ['dragleave','drop'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove('hover'); }));
    dropzone.addEventListener('drop', e => { if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });

    async function handleFiles(fileList){
      const folder = document.getElementById('uploadPath').value.trim().replace(/^\/+|\/+$/g,'') || 'assets';
      const grid = document.getElementById('mediaGrid');
      await uploadFilesToFolder(fileList, folder, grid, tree);
      if(!isCurrent()) return;
      // Full refresh once the batch settles — this is what replaces the
      // temporary tiles above with the real, permanent ones (with their
      // Copy path / Delete buttons) sourced from the actual repo state.
      tree = await loadMediaTree(true);
      if(!isCurrent()) return;
      mediaCurrentPath = folder;
      paint();
    }
  }
};


/* =====================================================================
   13b. SETUP GUIDE
   ===================================================================== */
function renderGuide(){
  document.querySelectorAll('.nav-item[data-section]').forEach(el=> el.classList.toggle('active', el.dataset.section==='guide'));
  content.innerHTML = `
    <div class="content-head"><div><h2>Setup Guide</h2><p>How this tool is wired to your repo.</p></div></div>

    <div class="panel">
      <h3>Where each screen writes to</h3>
      <p class="panel-sub">Every save here is a normal git commit — full history, nothing lost.</p>
      <div class="hint" style="font-size:13px;line-height:2">
        Hero Messages → <code class="k">data/hero.json</code><br>
        Filters & Badges → <code class="k">data/filters.json</code><br>
        Projects → <code class="k">data/projects.json</code><br>
        About Page → <code class="k">data/about.json</code><br>
        Reviews → <code class="k">data/reviews.json</code><br>
        Curated Views → <code class="k">data/curated-views.json</code><br>
        Settings & Toggles → <code class="k">data/settings.json</code>
      </div>
    </div>

    <div class="panel">
      <h3>Public content sections are live</h3>
      <p class="panel-sub">Every screen above is read directly by the site — <code class="k">index.html</code> and <code class="k">about/index.html</code>
      fetch each JSON file on load and rebuild that part of the page from it. Curated Views is currently a CMS-only authoring surface;
      its public hash-based runtime is intentionally deferred. Editing the live-backed sections here and saving is the whole workflow now;
      nothing needs a follow-up code change for those sections.</p>
    </div>

    <div class="panel">
      <h3>Media Library</h3>
      <p class="panel-sub">Upload and delete the actual image/video files your content points to, right from the CMS —
      no more editing files through GitHub's web uploader. Copy a file's path from there straight into a Source, Photo,
      or Thumbnail field on any other screen.</p>
    </div>

    <div class="panel">
      <h3>Where this file lives</h3>
      <p class="panel-sub">Keep <code class="k">admin.html</code> somewhere not linked from your public nav — e.g. the repo root, or an <code class="k">/admin/</code> folder.
      It's meaningless to a visitor without your token, but it's still worth keeping it out of search engines (already set via <code class="k">noindex</code>).</p>
    </div>
  `;
}

/* =====================================================================
   14. HELPERS
   ===================================================================== */
function esc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function attr(s){ return esc(s).replace(/"/g,'&quot;'); }
function val(id){ return document.getElementById(id).value; }
function numVal(id){ return parseFloat(document.getElementById(id).value)||0; }
function slugify(s){ return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }
function toggleExclusiveOpenUid(currentUid, selectedUid){
  return currentUid === selectedUid ? null : selectedUid;
}
function uid(){ return Math.random().toString(36).slice(2) + Date.now().toString(36); }

/* Ensures every item in a list has a stable client-side-only _uid,
   used purely to track "this DOM card is the same item" across a
   repaint so animateReorder() can animate it moving, and by the drag
   handlers to know what's being dragged. Never saved — every save
   function already whitelists its own fields, so _uid is naturally
   dropped when writing back to GitHub. */
function withUids(list){
  return (list || []).map(it => (it._uid ? it : { ...it, _uid: uid() }));
}

/* FLIP-style reorder animation: records each [data-uid] child's
   current position, lets renderFn() rebuild the list however it wants
   (even a full innerHTML wipe-and-rebuild, or a whole-node replaceWith
   — both are used elsewhere in this file), then plays a smooth
   transform from the old position to the new one.

   getContainer is a function, not a static element, and is called
   twice — once before renderFn() and once after — because several of
   this file's repaint patterns replace the container node itself
   (content.innerHTML = ... rebuilds it fresh; replaceWith() swaps in
   a new node). A container captured before the render would be a
   detached, unchanged husk by the time this function tries to read
   its "after" positions; re-fetching it is what makes this work
   regardless of which repaint pattern the caller uses. */
function animateReorder(getContainer, renderFn){
  const before = getContainer();
  const oldRects = {};
  if (before) {
    Array.from(before.children).forEach(el => {
      if (el.dataset && el.dataset.uid) oldRects[el.dataset.uid] = el.getBoundingClientRect();
    });
  }
  renderFn();
  const after = getContainer();
  if (!after) return;
  Array.from(after.children).forEach(el => {
    const uidKey = el.dataset && el.dataset.uid;
    const old = uidKey && oldRects[uidKey];
    if (!old) return;
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left, dy = old.top - now.top;
    if (dx || dy) {
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform 220ms cubic-bezier(.2,.8,.2,1)';
        el.style.transform = '';
      });
    }
  });
}

/* Makes every direct [data-uid] child of getContainer()'s current
   result draggable by its .drag-handle, reordering itemsArr (an array
   of objects each carrying a ._uid from withUids()) live as you drag,
   then calling onChange() (typically flagUnsaved) and repainting
   through animateReorder(). getContainer is a function rather than a
   static element for the same reason animateReorder's is: some
   repaint patterns replace the container node, so listeners are
   attached to whatever's live at call time and the reorder logic
   re-resolves it rather than trusting a reference that may already be
   stale by the time a drag actually happens. Dragging only activates
   from the handle itself — not the whole card — so text can still be
   selected normally inside the card's inputs. */
function enableDragReorder(getContainer, itemsArr, onChange, painter){
  const container = getContainer();
  if (!container) return;
  let draggingUid = null;

  container.addEventListener('mousedown', e => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const card = handle.closest('[data-uid]');
    if (card) card.setAttribute('draggable', 'true');
  });
  ['mouseup','dragend'].forEach(evt => container.addEventListener(evt, () => {
    const live = getContainer();
    if (live) live.querySelectorAll('[data-uid][draggable="true"]').forEach(c => c.removeAttribute('draggable'));
  }));

  container.addEventListener('dragstart', e => {
    const card = e.target.closest('[data-uid]');
    if (!card || card.getAttribute('draggable') !== 'true') return;
    draggingUid = card.dataset.uid;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', draggingUid); } catch(err){}
  });

  container.addEventListener('dragend', e => {
    const card = e.target.closest('[data-uid]');
    if (card) card.classList.remove('dragging');
    draggingUid = null;
  });

  container.addEventListener('dragover', e => {
    if (!draggingUid) return;
    e.preventDefault();
    const overCard = e.target.closest('[data-uid]');
    if (!overCard || overCard.dataset.uid === draggingUid) return;

    const fromIdx = itemsArr.findIndex(it => it._uid === draggingUid);
    const toIdx = itemsArr.findIndex(it => it._uid === overCard.dataset.uid);
    if (fromIdx === -1 || toIdx === -1) return;

    const rect = overCard.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    let insertAt = toIdx + (before ? 0 : 1);
    if (insertAt > fromIdx) insertAt--;
    if (insertAt === fromIdx) return;

    animateReorder(getContainer, () => {
      const [moved] = itemsArr.splice(fromIdx, 1);
      itemsArr.splice(insertAt, 0, moved);
      onChange();
      painter();
    });
  });
}
// Automatic software logos use Iconify; automatic lookup uses Simple Icons and Iconify discovery.
