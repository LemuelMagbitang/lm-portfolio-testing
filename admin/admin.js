/* =====================================================================
   0. STATE + STORAGE
   ===================================================================== */
const STORAGE_KEY = 'lm_cms_connection_v1';
let conn = null;          // { owner, repo, branch, token }
let currentSection = 'hero';
let dirty = {};           // { hero: bool, ... }
let cache = {};           // { hero: { json, sha } }

/* THE FIX FOR "everything 404s with the CMS's own folder stuck in the
   URL" — every preview image in this tool (project thumbnails, media
   items, the profile photo, skill logos, folder previews) is built
   from a path stored in data/*.json, like
   "assets/projects/haeru/web-og-image.jpg". Those paths are written
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
async function uploadFilesToFolder(fileList, folder, gridEl, currentTree){
  const files = Array.from(fileList);
  const emptyBanner = gridEl.querySelector('.banner.muted');
  if (emptyBanner) emptyBanner.remove();

  const jobs = files.map(file => {
    const path = folder + '/' + file.name;
    const isPreviewable = /^image\/|^video\//.test(file.type);
    const localUrl = isPreviewable ? URL.createObjectURL(file) : null;
    const tile = document.createElement('div');
    tile.className = 'media-tile is-uploading';
    const thumbInner = !localUrl ? FILE_ICON_SVG
      : file.type.startsWith('video/') ? `<video src="${localUrl}" muted></video>`
      : `<img src="${localUrl}">`;
    tile.innerHTML = `
      <div class="thumb">${thumbInner}<div class="upload-overlay"><i class="fa-solid fa-circle-notch spin"></i></div></div>
      <div class="meta"><div class="fname">${esc(file.name)}</div></div>
      <div class="upload-status">Uploading…</div>
    `;
    gridEl.prepend(tile);
    return { file, path, tile, localUrl };
  });

  for (const job of jobs) {
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(job.file);
      });
      // Check for an existing file at this exact path first, so a
      // same-name upload overwrites cleanly instead of erroring.
      let existingSha = null;
      const existing = currentTree.find(t => t.path === job.path);
      if (existing) existingSha = existing.sha;

      await GH.uploadBinary(job.path, dataUrl, `CMS: upload ${job.path}`, existingSha);

      job.tile.classList.remove('is-uploading');
      job.tile.classList.add('is-done');
      const overlay = job.tile.querySelector('.upload-overlay');
      if (overlay) overlay.remove();
      const status = job.tile.querySelector('.upload-status');
      if (status) status.remove();
      toast(`Uploaded ${job.file.name}.`);
    } catch(err){
      job.tile.classList.remove('is-uploading');
      job.tile.classList.add('is-error');
      const overlay = job.tile.querySelector('.upload-overlay');
      if (overlay) overlay.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#ff8f87"></i>';
      const status = job.tile.querySelector('.upload-status');
      if (status) status.textContent = 'Failed — ' + err.message;
      toast(`${job.file.name}: ${err.message}`, true);
    } finally {
      if (job.localUrl) URL.revokeObjectURL(job.localUrl);
    }
  }
}

function ghRawUrl(path){
  if (!path) return '';
  // Already a full URL (http/https), an embedded data: image, or a
  // local blob: preview for a file still mid-upload — none of those
  // are repo-relative paths, so they pass through completely unchanged.
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path;
  return `https://raw.githubusercontent.com/${conn.owner}/${conn.repo}/${conn.branch}/${path.replace(/^\/+/, '')}`;
}

const SECTIONS = {
  hero:     { file: 'data/hero.json',     label: 'Hero Messages' },
  heroLoop: { file: 'data/hero-loop.json', label: 'Hero Loop Animation' },
  filters:  { file: 'data/filters.json',  label: 'Filters & Badges' },
  projects: { file: 'data/projects.json', label: 'Projects' },
  about:    { file: 'data/about.json',    label: 'About Page' },
  reviews:  { file: 'data/reviews.json',  label: 'Reviews' },
  settings: { file: 'data/settings.json', label: 'Settings & Toggles' }
};

function loadConn(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(e){ return null; }
}
function saveConn(c, remember){
  if(remember){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); }catch(e){}
  }
}
function clearConn(){
  try{ localStorage.removeItem(STORAGE_KEY); }catch(e){}
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
const GH = {
  async getFile(path){
    const url = `https://api.github.com/repos/${conn.owner}/${conn.repo}/contents/${path}?ref=${encodeURIComponent(conn.branch)}`;
    const res = await fetch(url, { headers: authHeaders() });
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
    const url = `https://api.github.com/repos/${conn.owner}/${conn.repo}/contents/${path}`;
    const body = {
      message,
      content: b64EncodeUtf8(JSON.stringify(obj, null, 2) + '\n'),
      branch: conn.branch
    };
    if(sha) body.sha = sha;
    const res = await fetch(url, {
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
    const res = await fetch(url, { headers: authHeaders() });
    if(res.status === 404) throw new Error('Repository not found — check the username and repo name.');
    if(res.status === 401) throw new Error('Token rejected — check it was copied in full.');
    if(res.status === 403) throw new Error('Token doesn\'t have access to this repo — check its repository access & Contents permission.');
    if(!res.ok) throw new Error(`Could not reach GitHub (error ${res.status}).`);
    return res.json();
  },
  async getTree(){
    const url = `https://api.github.com/repos/${conn.owner}/${conn.repo}/git/trees/${encodeURIComponent(conn.branch)}?recursive=1`;
    const res = await fetch(url, { headers: authHeaders() });
    if(!res.ok){
      const e = await res.json().catch(()=>({}));
      throw new Error(e.message || `GitHub error ${res.status}`);
    }
    const data = await res.json();
    return data.tree || [];
  },
  async uploadBinary(path, dataUrl, message, existingSha){
    const base64 = dataUrl.split(',')[1]; // strip the "data:*/*;base64," prefix
    const url = `https://api.github.com/repos/${conn.owner}/${conn.repo}/contents/${path}`;
    const body = { message, content: base64, branch: conn.branch };
    if (existingSha) body.sha = existingSha;
    const res = await fetch(url, {
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
    const url = `https://api.github.com/repos/${conn.owner}/${conn.repo}/contents/${path}`;
    const res = await fetch(url, {
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
    const url = `https://api.github.com/repos/${conn.owner}/${conn.repo}/commits/${sha}/check-runs`;
    const res = await fetch(url, { headers: authHeaders() });
    if(!res.ok) return []; // don't fail the save over a status-check read
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
  el.innerHTML = `<i class="fa-solid ${isError?'fa-triangle-exclamation':'fa-check'}" style="color:${isError?'#e0584f':'#2ecc71'};margin-right:8px;"></i>${msg}`;
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
  document.getElementById('app').classList.add('active');
  document.getElementById('topbar').classList.add('active');
  document.getElementById('repoLabel').innerHTML =
    `<i class="fa-solid fa-code-branch"></i> ${conn.owner}/${conn.repo} <span style="color:#555">·</span> ${conn.branch}`;
  goToSection('hero');
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
  setDrawerOpen(false); // picking a section is done with the drawer, same as tapping outside it
  if(dirty[currentSection] && name !== currentSection){
    if(!confirm('You have unsaved changes in ' + (SECTIONS[currentSection]?.label||currentSection) + '. Leave without saving?')){
      return;
    }
    dirty[currentSection] = false;
    updateDirtyDots();
  }
  currentSection = name;
  document.querySelectorAll('.nav-item[data-section]').forEach(el=>{
    el.classList.toggle('active', el.dataset.section === name);
  });

  const label = SECTIONS[name]?.label || (name === 'guide' ? 'Setup Guide' : name === 'media' ? 'Media Library' : name);
  document.getElementById('topbarSection').textContent = label;
  const saveBtn = document.getElementById('btnSaveTop');
  const savable = !!SECTIONS[name];
  saveBtn.style.display = savable ? '' : 'none';
  document.getElementById('saveStatus').style.display = savable ? '' : 'none';
  currentSave = null;

  render();
}

function updateDirtyDots(){
  Object.keys(SECTIONS).forEach(k=>{
    const d = document.getElementById('dirty-'+k);
    if(d) d.style.display = dirty[k] ? 'block' : 'none';
  });
}

function markDirty(){ dirty[currentSection] = true; updateDirtyDots(); }

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

async function saveSection(name, obj, commitMessage){
  const { file } = SECTIONS[name];
  const existing = cache[name] || {};
  const result = await GH.putFile(file, obj, existing.sha, commitMessage);
  cache[name] = { json: obj, sha: result.content.sha, missing:false };
  dirty[name] = false;
  updateDirtyDots();
  return result.commit && result.commit.sha; // the commit itself, for deploy-status tracking
}

/* =====================================================================
   6. RENDER ROUTER
   ===================================================================== */
const content = document.getElementById('content');

async function render(){
  if(currentSection === 'guide'){ renderGuide(); return; }
  if(currentSection === 'media'){ RENDERERS.media(); return; }

  content.innerHTML = `<div class="loading-row"><i class="fa-solid fa-circle-notch spin"></i> Loading ${SECTIONS[currentSection].label.toLowerCase()}…</div>`;
  try{
    const data = await loadSection(currentSection);
    if(RENDERERS[currentSection]) RENDERERS[currentSection](data);
  }catch(err){
    content.innerHTML = `<div class="banner info" style="border-color:rgba(224,88,79,.4)"><i class="fa-solid fa-triangle-exclamation" style="color:#e0584f"></i><div><strong>Couldn't load this file.</strong><br>${err.message}</div></div>`;
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
  currentSave = { onCollect, name, filePath };
  const status = document.getElementById('saveStatus');
  const statusText = document.getElementById('saveStatusText');
  if (dirty[name]) {
    status.classList.remove('saved');
    statusText.textContent = 'Unsaved changes';
  } else {
    status.classList.add('saved');
    statusText.textContent = 'All changes saved';
  }
}

/* Polls GitHub's own Pages-deploy check runs for a commit, so "saved"
   can mean "the live site actually rebuilt from this", not just "the
   commit went through". GitHub Pages builds usually take 20–60
   seconds; this checks every 4s for up to 2 minutes. If the repo's
   Pages setup doesn't use Actions (no check runs ever appear) this
   quietly falls back to the plain "committed" message rather than
   hanging in a "deploying" state forever. */
async function trackDeployStatus(sha){
  if (!sha) return;
  const status = document.getElementById('saveStatus');
  const statusText = document.getElementById('saveStatusText');
  if (!status) return;

  status.classList.remove('saved', 'deploy-failed');
  status.classList.add('deploying');
  statusText.textContent = 'Deploying…';

  const deadline = Date.now() + 120000; // 2 minutes
  let sawAnyCheck = false;

  while (Date.now() < deadline) {
    let runs;
    try { runs = await GH.getCheckRuns(sha); }
    catch(err){ runs = []; }

    const pagesRuns = runs.filter(r => /pages/i.test(r.name || ''));
    const relevant = pagesRuns.length ? pagesRuns : runs;

    if (relevant.length) {
      sawAnyCheck = true;
      const allDone = relevant.every(r => r.status === 'completed');
      if (allDone) {
        const failed = relevant.find(r => r.conclusion && r.conclusion !== 'success');
        if (failed) {
          status.classList.remove('deploying');
          status.classList.add('deploy-failed');
          statusText.innerHTML = `Deploy failed — <a href="${attr(failed.html_url||'#')}" target="_blank">view details</a>`;
        } else {
          status.classList.remove('deploying');
          status.classList.add('saved');
          statusText.textContent = 'Live on site';
        }
        return;
      }
    }
    await new Promise(r => setTimeout(r, 4000));
  }

  // Timed out without a clear answer — don't leave a spinner running
  // forever, and don't claim success we didn't confirm.
  status.classList.remove('deploying');
  if (sawAnyCheck) {
    statusText.textContent = 'Still deploying — check GitHub';
  } else {
    status.classList.add('saved');
    statusText.textContent = 'Committed — check GitHub for deploy status';
  }
}

document.getElementById('btnSaveTop').addEventListener('click', async () => {
  if (!currentSave) return;
  const { onCollect, name, filePath } = currentSave;
  let obj;
  try{ obj = onCollect(); }
  catch(err){ toast(err.message, true); return; }

  const btn = document.getElementById('btnSaveTop');
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i>&nbsp; <span>Saving…</span>';
  try{
    let commitSha;
    if(currentSave && currentSave.combined && name==='heroLoop'){
      commitSha=await saveSection('heroLoop',obj.items||[],'CMS: update data/hero-loop.json');
      const sr=await loadSection('settings');
      const next={...(sr.json||{}),heroTiming:{...(sr.json?.heroTiming||{}),loopMode:obj.mode,transitionStyle:obj.transition,crossfadeMs:obj.interval}};
      const settingsSha=await saveSection('settings',next,'CMS: update hero loop settings');
      commitSha=settingsSha||commitSha;
      toast(`Saved — hero loop and transition settings committed to ${conn.branch}.`);
    }else{
      commitSha=await saveSection(name,obj,`CMS: update ${filePath}`);
      toast(`Saved — ${filePath} committed to ${conn.branch}.`);
    }
    btn.disabled=false;btn.innerHTML=orig;trackDeployStatus(commitSha);
  }catch(err){
    toast(err.message, true);
    btn.disabled = false; btn.innerHTML = orig;
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
RENDERERS.heroLoop=async function(data){
  let settingsResult; try{ settingsResult=await loadSection('settings'); }catch(e){ settingsResult={json:{}}; }
  const timing=(settingsResult.json||{}).heroTiming||{};
  let mode=timing.loopMode==='manual'?'manual':'latest';
  let transition=['kenburns','fade','none'].includes(timing.transitionStyle)?timing.transitionStyle:'kenburns';
  let interval=Number(timing.crossfadeMs)||3500;
  let items=withUids((Array.isArray(data.json)?data.json:[]).map(x=>({type:x.type||'image',src:x.src||'',alt:x.alt||'',focus:x.focus||'50% 50%',zoom:x.zoom||1,rotate:x.rotate||0})));
  let openUid=items[0]?items[0]._uid:null;
  function paint(){
    content.innerHTML=sectionHead('Hero Loop Animation','Choose automatic latest-project looping or a manual list. Manual entries support image, video, Lottie JSON, zoom, focus and rotation.')+`<div class="panel"><div class="row"><div class="field"><label class="field-label">Loop source</label><select id="hl_mode"><option value="latest" ${mode==='latest'?'selected':''}>Latest projects (up to 5)</option><option value="manual" ${mode==='manual'?'selected':''}>Only what I add</option></select></div><div class="field"><label class="field-label">Transition</label><select id="hl_transition"><option value="kenburns" ${transition==='kenburns'?'selected':''}>Zoom + fade</option><option value="fade" ${transition==='fade'?'selected':''}>Fade only</option><option value="none" ${transition==='none'?'selected':''}>None</option></select></div><div class="field"><label class="field-label">Slide interval (ms)</label><input id="hl_interval" type="number" min="500" step="100" value="${interval}"></div></div><div class="banner info"><i class="fa-solid fa-circle-info"></i><div><strong>Latest mode</strong> keeps explicit project thumbnails unchanged. Projects without a thumbnail contribute their first usable image, video or Lottie media. The loop uses up to five projects, so 1–4 projects simply loop that many.</div></div></div><div id="heroLoopItems"></div><button class="add-btn" id="hl_add"><i class="fa-solid fa-plus"></i> Add hero artwork</button>`;
    const list=document.getElementById('heroLoopItems');
    if(mode==='latest') list.innerHTML='<div class="banner muted">Manual entries are stored but ignored while Latest projects is selected.</div>';
    items.forEach(item=>{
      const open=item._uid===openUid,row=document.createElement('div');row.className='card-item';row.dataset.uid=item._uid;
      row.innerHTML=`<div class="card-item-head collapsible-head" data-open><span class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></span><span class="preview-line">${esc(item.alt||item.src||'(empty)')}</span><div class="card-item-actions"><button class="icon-btn" data-a="up"><i class="fa-solid fa-arrow-up"></i></button><button class="icon-btn" data-a="down"><i class="fa-solid fa-arrow-down"></i></button><button class="icon-btn" data-a="del" style="color:#e0584f"><i class="fa-solid fa-trash"></i></button><button class="icon-btn" data-a="toggle"><i class="fa-solid fa-chevron-${open?'up':'down'}"></i></button></div></div><div class="collapsible-body" style="display:${open?'block':'none'};margin-top:16px" data-body></div>`;
      if(open){
        const body=row.querySelector('[data-body]');
        body.innerHTML=`<div class="row"><div class="field" style="max-width:180px"><label class="field-label">Type</label><select data-f="type"><option value="image" ${item.type==='image'?'selected':''}>Image</option><option value="video" ${item.type==='video'?'selected':''}>Video</option><option value="lottie" ${item.type==='lottie'?'selected':''}>Lottie (JSON)</option></select></div><div class="field"><label class="field-label">Source path or URL</label><input data-f="src" value="${attr(item.src)}"></div></div><div class="row"><div class="field"><label class="field-label">Alt / label</label><input data-f="alt" value="${attr(item.alt)}"></div><div class="field"><label class="field-label">Zoom</label><input data-f="zoom" type="number" min="0.5" step="0.05" value="${item.zoom}"></div></div><div class="row"><div class="field"><label class="field-label">Focus (x% y%)</label><input data-f="focus" value="${attr(item.focus)}"></div><div class="field"><label class="field-label">Rotate (deg)</label><input data-f="rotate" type="number" step="1" value="${item.rotate}"></div></div><div class="field"><label class="field-label">Focus picker</label><div class="focus-picker" data-picker><div data-preview style="position:absolute;inset:0"></div><div class="focus-crosshair" data-crosshair></div></div></div>`;
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
        let dragging=false;const pointer=e=>{const r=picker.getBoundingClientRect(),x=Math.max(0,Math.min(100,((e.touches?e.touches[0].clientX:e.clientX)-r.left)/r.width*100)),y=Math.max(0,Math.min(100,((e.touches?e.touches[0].clientY:e.clientY)-r.top)/r.height*100));item.focus=`${x.toFixed(0)}% ${y.toFixed(0)}%`;body.querySelector('[data-f="focus"]').value=item.focus;setCross();refreshHeroPreview();flagUnsaved();};picker.addEventListener('mousedown',e=>{dragging=true;pointer(e)});window.addEventListener('mousemove',e=>{if(dragging)pointer(e)});window.addEventListener('mouseup',()=>dragging=false);picker.addEventListener('touchstart',pointer,{passive:true});picker.addEventListener('touchmove',pointer,{passive:true});
        body.querySelectorAll('[data-f]').forEach(inp=>inp.addEventListener('input',()=>{const f=inp.dataset.f;item[f]=(f==='zoom'||f==='rotate')?(parseFloat(inp.value)||0):inp.value;row.querySelector('.preview-line').textContent=item.alt||item.src||'(empty)';if(f==='focus')setCross();refreshHeroPreview();flagUnsaved();}));
      }
      row.querySelector('[data-open]').addEventListener('click',e=>{if(e.target.closest('[data-a]')&&e.target.closest('[data-a]').dataset.a!=='toggle')return;openUid=open?null:item._uid;paint();});
      row.querySelector('[data-a=del]').addEventListener('click',e=>{e.stopPropagation();items=items.filter(x=>x._uid!==item._uid);flagUnsaved();paint();});
      row.querySelector('[data-a=up]').addEventListener('click',e=>{e.stopPropagation();const i=items.indexOf(item);if(i>0){[items[i-1],items[i]]=[items[i],items[i-1]];flagUnsaved();paint();}});
      row.querySelector('[data-a=down]').addEventListener('click',e=>{e.stopPropagation();const i=items.indexOf(item);if(i<items.length-1){[items[i+1],items[i]]=[items[i],items[i+1]];flagUnsaved();paint();}});
      list.appendChild(row);
    });
    document.getElementById('hl_mode').addEventListener('change',e=>{mode=e.target.value;flagUnsaved();paint();});
    document.getElementById('hl_transition').addEventListener('change',e=>{transition=e.target.value;flagUnsaved();});
    document.getElementById('hl_interval').addEventListener('input',e=>{interval=Math.max(500,parseInt(e.target.value,10)||3500);flagUnsaved();});
    document.getElementById('hl_add').addEventListener('click',()=>{const x={type:'image',src:'',alt:'',focus:'50% 50%',zoom:1,rotate:0,_uid:uid()};items.push(x);openUid=x._uid;mode='manual';flagUnsaved();paint();});
    enableDragReorder(()=>document.getElementById('heroLoopItems'),items,flagUnsaved,paint);
    wireSave(()=>({items:items.map(x=>({type:x.type,src:x.src,alt:x.alt,focus:x.focus,zoom:x.zoom,rotate:x.rotate})),mode,transition,interval}), 'heroLoop', SECTIONS.heroLoop.file);
    currentSave.combined=true;
  }
  paint();
};

/* =====================================================================
   8. SECTION: FILTERS & BADGES
   ===================================================================== */
RENDERERS.filters = function(data){
  const raw=data.json||[];
  const filterItems=Array.isArray(raw)?raw:(raw.filters||[]);
  let badgeItems=Array.isArray(raw)?[]:(raw.badges||[]);
  let items=withUids(filterItems.map(x=>({id:x.id||'',label:x.label||''})));
  badgeItems=badgeItems.map(x=>typeof x==='string'?x:(x&&x.label)||'').filter(Boolean);

  function paint(){
    content.innerHTML = sectionHead(
      'Filters & Badges',
      'These become the tabs above the project grid, the matching nav-bar dropdown items, and the badge options for each project. Drag the handle to reorder.'
    ) + `
      <div class="banner info"><i class="fa-solid fa-circle-info"></i><div>
        The <strong>ALL</strong> tab always exists automatically and isn't listed here — every project belongs to it.
        Whatever you type as the <strong>ID</strong> is what a project's <code class="k">filters</code> array will match, so
        renaming an ID after projects are already tagged to it will need those projects re-tagged too.
      </div></div>
      <div id="filterList"></div>
      <button class="add-btn" id="addFilter"><i class="fa-solid fa-plus"></i> Add filter tab</button>
      <div class="panel" style="margin-top:18px;background:#141414;"><h3>Project badges</h3><p class="panel-sub">One final-output badge per project. These are separate from filter tabs.</p><div class="tagbox" id="badgeList"></div><button class="add-btn" id="addBadge"><i class="fa-solid fa-plus"></i> Add badge</button></div>
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
      row.querySelector('[data-act="del"]').addEventListener('click', ()=>{
        if(!confirm('Delete this filter tab? Projects tagged with it will need re-tagging.')) return;
        items = items.filter(x=>x._uid!==item._uid); flagUnsaved(); paint();
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
    if(badgeBox){ badgeBox.innerHTML=''; badgeItems.forEach((badge,i)=>{ const r=document.createElement('div'); r.className='tag-pill'; r.innerHTML=`<input value="${attr(badge)}" style="flex:1;min-width:120px;padding:4px 0;border:0;background:transparent;"><button type="button">&times;</button>`; const inp=r.querySelector('input'); inp.addEventListener('input',()=>{badgeItems[i]=inp.value;flagUnsaved();}); r.querySelector('button').addEventListener('click',()=>{badgeItems.splice(i,1);flagUnsaved();paint();}); badgeBox.appendChild(r); }); }
    document.getElementById('addFilter').addEventListener('click', ()=>{ items.push({id:'',label:'',_uid:uid()}); flagUnsaved(); paint(); });
    document.getElementById('addBadge').addEventListener('click', ()=>{ badgeItems.push('New Badge'); flagUnsaved(); paint(); });
    enableDragReorder(() => document.getElementById('filterList'), items, flagUnsaved, paint);
    wireSave(()=>{
      for(const it of items){ if(!it.id.trim()||!it.label.trim()) throw new Error('Every filter needs both an ID and a label.'); }
      return {filters:items.map(x=>({id:x.id,label:x.label})),badges:badgeItems.map(x=>x.trim()).filter(Boolean)};
    }, 'filters', SECTIONS.filters.file);
  }
  paint();
};

/* =====================================================================
   9. SECTION: SETTINGS & TOGGLES
   ===================================================================== */
RENDERERS.settings = function(data){
  let s = data.json || {};
  s.formsEnabled = s.formsEnabled || {project:true, review:true};
  s.web3forms = s.web3forms || {projectKey:'', reviewKey:''};
  s.socials = s.socials || {instagram:'',tiktok:'',youtube:''};
  s.heroTiming = s.heroTiming || {fadeMs:600, autoRotateMs:0, crossfadeMs:3500, kenBurnsFromScale:1, kenBurnsToScale:1.15, kenBurnsDurationS:14};

  content.innerHTML = sectionHead('Settings & Toggles', 'Site-wide switches and the values behind them. Nothing here needs the HTML touched again.') + `

    <div class="panel">
      <h3>Toggles</h3>
      <p class="panel-sub">Flip these on or off — no add/remove, just switches.</p>
      ${toggleRow('protectionEnabled','Right-click / drag-save protection','Disables right-click and drag-to-save on lightbox artwork.', s.protectionEnabled)}
      ${toggleRow('formsEnabled.project','"Start a Project" form','Shows the form when on; shows an Email Me button when off.', s.formsEnabled.project)}
      ${toggleRow('formsEnabled.review','"Leave a Review" form','Shows the form when on; shows an Email Me button when off.', s.formsEnabled.review)}
      ${toggleRow('showCardBadges','Project card badges','Shows the pill (e.g. "3D Design") on every project card.', s.showCardBadges)}
      ${toggleRow('showReviews','Reviews section','Shows or hides the whole client-reviews strip above the footer.', s.showReviews)}
      ${toggleRow('showSoftwareLogos','Software skill logos','Shows every Software Skill (About page) as its logo instead of its name. One switch for the whole list — set a specific logo per skill from the About page itself.', s.showSoftwareLogos)}
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
      <div class="field"><label class="field-label">Contact email</label><input id="s_email" value="${attr(s.contactEmail||'')}"></div>
      <div class="row">
        <div class="field"><label class="field-label"><i class="fa-brands fa-instagram"></i> Instagram</label><input id="s_ig" value="${attr(s.socials.instagram)}"></div>
        <div class="field"><label class="field-label"><i class="fa-brands fa-tiktok"></i> TikTok</label><input id="s_tt" value="${attr(s.socials.tiktok)}"></div>
        <div class="field"><label class="field-label"><i class="fa-brands fa-youtube"></i> YouTube</label><input id="s_yt" value="${attr(s.socials.youtube)}"></div>
      </div>
    </div>

    <div class="panel">
      <h3>SEO & Social Preview</h3>
      <div class="field"><label class="field-label">Site title</label><input id="s_title" value="${attr(s.siteTitle||'')}"></div>
      <div class="field"><label class="field-label">Meta description</label><textarea id="s_desc" rows="2">${esc(s.siteDescription||'')}</textarea></div>
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
  content.querySelectorAll('.panel input, .panel textarea').forEach(el=>{
    if(el.hasAttribute('data-toggle')) return;
    el.addEventListener('input', flagUnsaved);
  });

  wireSave(()=>({
    protectionEnabled: s.protectionEnabled,
    formsEnabled: { project: s.formsEnabled.project, review: s.formsEnabled.review },
    showCardBadges: s.showCardBadges,
    showReviews: s.showReviews,
    showSoftwareLogos: s.showSoftwareLogos,
    web3forms: { projectKey: val('s_pkey'), reviewKey: val('s_rkey') },
    redirectUrl: val('s_redirect'),
    contactEmail: val('s_email'),
    socials: { instagram: val('s_ig'), tiktok: val('s_tt'), youtube: val('s_yt') },
    siteTitle: val('s_title'),
    siteDescription: val('s_desc'),
    heroTiming: s.heroTiming
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
RENDERERS.reviews = async function(data){
  let items = withUids((data.json||[]).map(x=>({stars:x.stars||5, quote:x.quote||'', author:x.author||''})));
  let showReviews = true;
  let openUid = null;
  try{ const set = await loadSection('settings'); showReviews = !!(set.json && set.json.showReviews); }catch(e){}

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

function buildMediaPreviewHtml(m){
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
  // image
  return `<div class="media-preview"><img src="${attr(ghRawUrl(m.src))}" alt="" onerror="handleMissingFile(this,'image')"></div>`;
}

RENDERERS.projects = async function(data){
  let items = withUids((data.json||[]).map(p=>({
    id:p.id||slugify(p.title||''), title:p.title||'', subtitle:p.subtitle||'', badge:p.badge||'',
    filters:Array.isArray(p.filters)?[...p.filters]:[], description:p.description||'',
    thumbnail:{ type:(p.thumbnail&&p.thumbnail.type)||'image', src:(p.thumbnail&&p.thumbnail.src)||'', focus:(p.thumbnail&&p.thumbnail.focus)||'50% 50%', zoom:(p.thumbnail&&p.thumbnail.zoom)||1 },
    media:withUids(Array.isArray(p.media)?p.media.map(m=>({type:m.type||'image',src:m.src||'',caption:m.caption||'',orientation:m.orientation||''})):[])
  })));
  let filterDefs = [];
  try{ const f = await loadSection('filters'); const raw=f.json||[]; filterDefs=Array.isArray(raw)?raw:(raw.filters||[]); }catch(e){}
  let openUid = items.length ? items[0]._uid : null;

  function paint(){
    content.innerHTML = sectionHead('Projects', 'Order here is the order on the page. Drag the handle to reorder, or click a project to expand and edit it.') + `
      <div id="projList"></div>
      <button class="add-btn" id="addProj"><i class="fa-solid fa-plus"></i> Add project</button>
    `;
    const list = document.getElementById('projList');
    if(!items.length) list.innerHTML = `<div class="banner muted">No projects yet — add one below.</div>`;

    items.forEach((p)=>{
      const wrap = document.createElement('div');
      wrap.className = 'card-item';
      wrap.dataset.uid = p._uid;
      const isOpen = p._uid===openUid;
      wrap.innerHTML = `
        <div class="card-item-head" style="cursor:pointer" data-toggle-open>
          <span class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></span>
          <span class="item-title">${esc(p.title)||'(untitled project)'} ${p.badge?`<span style="color:#666;font-weight:500"> — ${esc(p.badge)}</span>`:''}</span>
          <div class="card-item-actions">
            <button class="icon-btn" data-act="up" title="Move up"><i class="fa-solid fa-arrow-up"></i></button>
            <button class="icon-btn" data-act="down" title="Move down"><i class="fa-solid fa-arrow-down"></i></button>
            <button class="icon-btn" data-act="del" title="Delete" style="color:#e0584f"><i class="fa-solid fa-trash"></i></button>
            <button class="icon-btn" data-act="toggle"><i class="fa-solid fa-chevron-${isOpen?'up':'down'}"></i></button>
          </div>
        </div>
        <div data-body style="display:${isOpen?'block':'none'};margin-top:16px;"></div>
      `;
      wrap.querySelector('[data-toggle-open]').addEventListener('click', (e)=>{
        if(e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act !== 'toggle') return;
        openUid = isOpen ? null : p._uid; paint();
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

      if(isOpen) buildProjectBody(wrap.querySelector('[data-body]'), p);
      list.appendChild(wrap);
    });

    document.getElementById('addProj').addEventListener('click', ()=>{
      const p = {id:'',title:'',subtitle:'',badge:'',filters:[],description:'',thumbnail:{type:'image',src:'',focus:'50% 50%',zoom:1},media:[],_uid:uid()};
      items.push(p);
      openUid = p._uid; flagUnsaved(); paint();
    });
    enableDragReorder(() => document.getElementById('projList'), items, flagUnsaved, paint);

    wireSave(()=>{
      for(const p of items){
        if(!p.title.trim()) throw new Error('Every project needs a title.');
        if(!p.subtitle.trim()) throw new Error(`"${p.title}" needs a subtitle.`);
        if(!p.filters.length) throw new Error(`"${p.title}" needs at least one filter tab.`);
        if(!p.id) p.id = slugify(p.title);
      }
      return items.map(p=>({
        id:p.id, title:p.title, subtitle:p.subtitle, badge:p.badge, filters:p.filters, description:p.description,
        thumbnail:{type:p.thumbnail.type||'image',src:p.thumbnail.src,focus:p.thumbnail.focus,zoom:p.thumbnail.zoom},
        media:p.media.map(m=>({type:m.type,src:m.src,caption:m.caption,orientation:m.orientation}))
      }));
    }, 'projects', SECTIONS.projects.file);
  }

  function buildProjectBody(el, p){
    // Which artwork cards are expanded, by _uid. Starts empty (every
    // artwork loads collapsed to just its title bar) so opening a
    // project with a dozen images doesn't dump a dozen full editors
    // on screen at once — newly-added artworks are the one exception,
    // added straight into this set so they open ready to fill in.
    const openMediaUids = new Set();
    el.innerHTML = `
      <div class="row">
        <div class="field"><label class="field-label">Title</label><input data-f="title" value="${attr(p.title)}"></div>
        <div class="field"><label class="field-label">Subtitle</label><input data-f="subtitle" value="${attr(p.subtitle)}"></div>
      </div>

      <div class="field">
        <label class="field-label">Badge <span style="opacity:.5">(one only — the final output, not the software)</span></label>
        <select data-f="badge"><option value="">— none —</option>${badgeOptions(p.badge)}</select>
      </div>

      <div class="field">
        <label class="field-label">Filter tabs this shows under</label>
        <div class="chip-select" data-filters>
          ${filterDefs.map(f=>`<button type="button" class="chip ${p.filters.includes(f.id)?'selected':''}" data-fid="${attr(f.id)}">${esc(f.label)}</button>`).join('') || '<span class="hint">No filters defined yet — add some under Filters & Badges.</span>'}
        </div>
      </div>

      <div class="field">
        <label class="field-label">Description <span style="opacity:.5">(optional — shown when the card opens)</span></label>
        <textarea data-f="description" rows="4">${esc(p.description)}</textarea>
      </div>

      <div class="panel" style="background:#141414;">
        <h3 style="font-size:.85rem">Thumbnail</h3>
        <p class="panel-sub">Leave the image blank and the site uses the first media item instead.</p>
        <div class="two-col">
          <div>
            <div class="row">
              <div class="field" style="max-width:180px"><label class="field-label">Thumbnail type</label><select data-f="thumb-type"><option value="image" ${p.thumbnail.type==='image'?'selected':''}>Image</option><option value="video" ${p.thumbnail.type==='video'?'selected':''}>Video</option><option value="lottie" ${p.thumbnail.type==='lottie'?'selected':''}>Lottie (JSON animation)</option></select></div>
              <div class="field"><label class="field-label">Source path or URL</label><input data-f="thumb-src" value="${attr(p.thumbnail.src)}" placeholder="assets/projects/your-folder/thumb.jpg / .mp4 / .json"></div>
            </div>
            <div class="row">
              <div class="field"><label class="field-label">Zoom</label><input data-f="thumb-zoom" type="number" step="0.05" value="${p.thumbnail.zoom}"></div>
              <div class="field"><label class="field-label">Focus (x% y%)</label><input data-f="thumb-focus" value="${attr(p.thumbnail.focus)}"></div>
            </div>
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

      <div class="panel" style="background:#141414;">
        <h3 style="font-size:.85rem">Media (lightbox gallery)</h3>
        <p class="panel-sub">Order here is the order in the lightbox. Drag the handle to reorder.</p>
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
      const old = picker.querySelector('[data-thumb-media]'); if(old) old.remove();
      const explicit = p.thumbnail.src;
      const fallback = explicit ? null : computeFallbackThumb(p.media);
      const src = explicit ? {type:p.thumbnail.type||'image',src:explicit} : fallback;
      if(!src || !src.src){ if(note) note.style.display='none'; return; }
      let media;
      if(src.type==='video'){
        media=document.createElement('video'); media.src=ghRawUrl(src.src); media.muted=true; media.loop=true; media.autoplay=true; media.playsInline=true;
      }else if(src.type==='lottie'){
        media=document.createElement('lottie-player'); media.setAttribute('src',ghRawUrl(src.src)); media.setAttribute('autoplay',''); media.setAttribute('loop',''); media.setAttribute('background','transparent');
      }else{
        media=document.createElement('img'); media.src=ghRawUrl(src.src); media.alt=p.title||'Project thumbnail';
      }
      media.setAttribute('data-thumb-media',''); media.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;';
      const focus=p.thumbnail.focus||'50% 50%'; media.style.objectPosition=focus; media.style.transformOrigin=focus; media.style.transform=`scale(${p.thumbnail.zoom||1})`;
      picker.insertBefore(media,picker.querySelector('[data-crosshair]'));
      if(note) note.style.display=fallback?'':'none';
    }
    attachMediaBrowseButton(el.querySelector('[data-f="thumb-src"]'), () => refreshThumbPreview());

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
          if (f==='title' || f==='badge') {
            const titleEl = el.closest('.card-item').querySelector('.item-title');
            titleEl.innerHTML = `${esc(p.title)||'(untitled project)'} ${p.badge?`<span style="color:#666;font-weight:500"> — ${esc(p.badge)}</span>`:''}`;
          }
        }
        flagUnsaved();
      });
    });
    el.querySelector('select[data-f="badge"]').addEventListener('change', function(){
      const titleEl = el.closest('.card-item').querySelector('.item-title');
      titleEl.innerHTML = `${esc(p.title)||'(untitled project)'} ${p.badge?`<span style="color:#666;font-weight:500"> — ${esc(p.badge)}</span>`:''}`;
    });

    // filter chips
    el.querySelectorAll('[data-fid]').forEach(chip=>{
      chip.addEventListener('click', ()=>{
        const id = chip.dataset.fid;
        if(p.filters.includes(id)) p.filters = p.filters.filter(x=>x!==id);
        else p.filters.push(id);
        chip.classList.toggle('selected');
        flagUnsaved();
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
      const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
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
      flagUnsaved();
    }
    let dragging=false;
    picker.addEventListener('mousedown', e=>{ dragging=true; pointerToFocus(e); });
    window.addEventListener('mousemove', e=>{ if(dragging) pointerToFocus(e); });
    window.addEventListener('mouseup', ()=> dragging=false);
    picker.addEventListener('touchstart', e=>{ pointerToFocus(e); }, {passive:true});
    picker.addEventListener('touchmove', e=>{ pointerToFocus(e); }, {passive:true});

    // media list
    let medWrap = el.querySelector('[data-medialist]');
    function paintMedia(){
      const freshWrap = document.createElement('div');
      freshWrap.setAttribute('data-medialist', '');
      p.media.forEach((m)=>{
        const isOpen = openMediaUids.has(m._uid);
        const row = document.createElement('div');
        row.className = 'card-item';
        row.style.background = '#191919';
        row.dataset.uid = m._uid;
        row.innerHTML = `
          <div class="card-item-head collapsible-head" data-toggle-open>
            <span class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></span>
            <span class="item-title">${m.caption ? esc(m.caption) : '(' + m.type + ')'}</span>
            <div class="card-item-actions">
              <button class="icon-btn" data-mact="up" title="Move up"><i class="fa-solid fa-arrow-up"></i></button>
              <button class="icon-btn" data-mact="down" title="Move down"><i class="fa-solid fa-arrow-down"></i></button>
              <button class="icon-btn" data-mact="del" title="Delete" style="color:#e0584f"><i class="fa-solid fa-trash"></i></button>
              <button class="icon-btn" data-mact="toggle"><i class="fa-solid fa-chevron-${isOpen?'up':'down'}"></i></button>
            </div>
          </div>
          <div class="collapsible-body" style="display:${isOpen?'block':'none'};margin-top:16px;" data-mbody>
            <div class="row">
              <div class="field" style="max-width:140px"><label class="field-label">Type</label>
                <select data-mf="type">
                  <option value="image" ${m.type==='image'?'selected':''}>Image</option>
                  <option value="video" ${m.type==='video'?'selected':''}>Video</option>
                  <option value="youtube" ${m.type==='youtube'?'selected':''}>YouTube</option>
                  <option value="lottie" ${m.type==='lottie'?'selected':''}>Lottie (JSON animation)</option>
                </select>
              </div>
              <div class="field"><label class="field-label">Source (file path or URL)</label><input data-mf="src" value="${attr(m.src)}" placeholder="assets/projects/your-folder/artwork.jpg"></div>
            </div>
            <div class="row">
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
          </div>
        `;
        row.querySelector('[data-toggle-open]').addEventListener('click', (e)=>{
          if (e.target.closest('[data-mact]') && e.target.closest('[data-mact]').dataset.mact !== 'toggle') return;
          if (isOpen) openMediaUids.delete(m._uid); else openMediaUids.add(m._uid);
          paintMedia();
        });
        const previewEl = row.querySelector('[data-mediapreview]');
        function refreshPreview(){
          previewEl.innerHTML = buildMediaPreviewHtml(m);
          wirePreviewAspect(previewEl.firstElementChild, m);
          // If this is (or might become) the project's fallback
          // thumbnail — first image/YouTube item, thumbnail.src left
          // blank — the focus-picker preview needs to follow along too.
          if (typeof refreshThumbPreview === 'function') refreshThumbPreview();
        }
        refreshPreview();
        attachMediaBrowseButton(row.querySelector('[data-mf="src"]'), () => refreshPreview());

        row.querySelectorAll('[data-mf]').forEach(inp=> inp.addEventListener('input', ()=>{
          m[inp.dataset.mf]=inp.value;
          if (inp.dataset.mf === 'caption') row.querySelector('.item-title').textContent = m.caption || '(' + m.type + ')';
          if (inp.dataset.mf === 'type' || inp.dataset.mf === 'src') refreshPreview();
          flagUnsaved();
        }));
        row.querySelectorAll('[data-mf]').forEach(inp=> inp.addEventListener('change', ()=>{
          if (inp.dataset.mf === 'type') { row.querySelector('.item-title').textContent = m.caption || '(' + m.type + ')'; refreshPreview(); }
        }));
        row.querySelector('[data-mact="del"]').addEventListener('click', ()=>{
          const idx = p.media.findIndex(x=>x._uid===m._uid);
          if (idx > -1) p.media.splice(idx, 1);
          flagUnsaved(); paintMedia();
        });
        row.querySelector('[data-mact="up"]').addEventListener('click', ()=>{
          const mi = p.media.indexOf(m); if(mi===0)return;
          animateReorder(() => el.querySelector('[data-medialist]'), () => { [p.media[mi-1],p.media[mi]]=[p.media[mi],p.media[mi-1]]; flagUnsaved(); paintMedia(); });
        });
        row.querySelector('[data-mact="down"]').addEventListener('click', ()=>{
          const mi = p.media.indexOf(m); if(mi===p.media.length-1)return;
          animateReorder(() => el.querySelector('[data-medialist]'), () => { [p.media[mi+1],p.media[mi]]=[p.media[mi],p.media[mi+1]]; flagUnsaved(); paintMedia(); });
        });
        freshWrap.appendChild(row);
      });
      medWrap.replaceWith(freshWrap);
      medWrap = freshWrap;
      enableDragReorder(() => el.querySelector('[data-medialist]'), p.media, flagUnsaved, paintMedia);
      // Covers add/delete/reorder even when the list is empty (each
      // row's own refreshPreview() already covers edits to that row).
      refreshThumbPreview();
    }
    paintMedia();
    el.querySelector('[data-addmedia]').addEventListener('click', ()=>{
      const fresh = {type:'image',src:'',caption:'',orientation:'',_uid:uid()};
      p.media.push(fresh);
      openMediaUids.add(fresh._uid); // new artwork opens straight into edit mode
      flagUnsaved(); paintMedia();
    });
  }

  function badgeOptions(current){
    const suggested=['2D Illustration','3D Design','Motion Graphics','UI/UX Design','Brand Design'];
    let configured=[]; const raw=cache.filters?.json; if(raw && !Array.isArray(raw)) configured=raw.badges||[];
    const set=new Set([...suggested,...configured].filter(Boolean)); if(current)set.add(current);
    return [...set].map(b=>`<option value="${attr(b)}" ${b===current?'selected':''}>${esc(b)}</option>`).join('');
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
  // Normalizes the old plain-string photo ("assets/.../profile.jpg")
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
            <div class="field"><label class="field-label">Path or URL</label><input id="a_photo" value="${attr(a.photo.src)}" placeholder="assets/projects/site/profile.jpg"></div>
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
      const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      const x = Math.max(0, Math.min(100, (cx/rect.width)*100));
      const y = Math.max(0, Math.min(100, (cy/rect.height)*100));
      a.photo.focus = `${x.toFixed(0)}% ${y.toFixed(0)}%`;
      photoCrosshair.style.left = x+'%'; photoCrosshair.style.top = y+'%';
      photoFocusInput.value = a.photo.focus;
      flagUnsaved();
      refreshPhotoPreview();
    }
    let draggingPhotoFocus = false;
    photoPicker.addEventListener('mousedown', e=>{ draggingPhotoFocus=true; pointerToPhotoFocus(e); });
    window.addEventListener('mousemove', e=>{ if(draggingPhotoFocus) pointerToPhotoFocus(e); });
    window.addEventListener('mouseup', ()=> draggingPhotoFocus=false);
    photoPicker.addEventListener('touchstart', e=>{ pointerToPhotoFocus(e); }, {passive:true});
    photoPicker.addEventListener('touchmove', e=>{ pointerToPhotoFocus(e); }, {passive:true});

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
  // (manual icon → Simple Icons → Clearbit → initials) — kept here too
  // so this swatch preview shows what a skill will actually look like
  // rather than just "has an icon path or doesn't." Whether it's
  // actually shown as a logo at all, site-wide, is the one switch in
  // Settings & Toggles — this box just prepares each skill for
  // whichever way that switch is set.
  const SOFTWARE_DOMAINS = {
    krita: 'krita.org', blender: 'blender.org', figma: 'figma.com',
    'davinci resolve': 'blackmagicdesign.com', 'cinema 4d': 'maxon.net',
    zbrush: 'maxon.net', maya: 'autodesk.com', '3ds max': 'autodesk.com',
    'autodesk maya': 'autodesk.com', unity: 'unity.com',
    'unreal engine': 'unrealengine.com', procreate: 'procreate.com',
    sketch: 'sketch.com', sketchup: 'sketchup.com',
    'substance painter': 'substance3d.com', 'substance designer': 'substance3d.com',
    'affinity photo': 'affinity.serif.com', 'affinity designer': 'affinity.serif.com',
    houdini: 'sidefx.com', 'clip studio paint': 'clipstudio.net'
  };
  function skillLogoSlug(name){
    return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  function skillLogoAttempts(skill){
    const attempts = [];
    if (skill.icon) attempts.push(ghRawUrl(skill.icon));
    const slug = skillLogoSlug(skill.name);
    if (slug) attempts.push(`https://cdn.simpleicons.org/${slug}`);
    const domain = SOFTWARE_DOMAINS[(skill.name || '').toLowerCase()];
    if (domain) attempts.push(`https://logo.clearbit.com/${domain}?size=64`);
    return attempts;
  }

  function buildSoftwareSkills(id, arr){
    const box = document.getElementById(id);
    function repaint(){
      box.innerHTML = '';
      arr.forEach((skill,i)=>{
        const attempts = skillLogoAttempts(skill);
        const hasManualIcon = !!skill.icon;
        const pill = document.createElement('span');
        pill.className = 'skill-editor-row';
        pill.innerHTML = `
          <span class="skill-pill-icon" data-iconbtn title="${hasManualIcon ? 'Change logo' : 'Click to set a specific logo by hand'}">
            <img data-attempt="0" src="${attr(attempts[0] || '')}">
            <i class="fa-solid fa-image fallback-icon" style="display:none"></i>
          </span>
          <span class="skill-pill-name">${esc(skill.name)}</span>
          ${hasManualIcon ? `<button type="button" class="clear-icon-btn" data-clearicon title="Use the automatic lookup instead">&times;</button>` : ''}
          <button type="button" data-removeskill title="Remove ${esc(skill.name)}">&times;</button>
        `;
        const img = pill.querySelector('img');
        if (!attempts.length) { img.style.display = 'none'; pill.querySelector('.fallback-icon').style.display = 'flex'; }
        img.addEventListener('error', () => {
          const next = parseInt(img.dataset.attempt, 10) + 1;
          if (next < attempts.length) { img.dataset.attempt = next; img.src = attempts[next]; }
          else { img.style.display = 'none'; pill.querySelector('.fallback-icon').style.display = 'flex'; }
        });
        pill.querySelector('[data-iconbtn]').addEventListener('click', ()=>{
          openMediaPicker(path => { skill.icon = path; flagUnsaved(); repaint(); });
        });
        const clearBtn = pill.querySelector('[data-clearicon]');
        if (clearBtn) clearBtn.addEventListener('click', (e)=>{ e.stopPropagation(); skill.icon = ''; flagUnsaved(); repaint(); });
        pill.querySelector('[data-removeskill]').addEventListener('click', ()=>{ arr.splice(i,1); flagUnsaved(); repaint(); });
        box.appendChild(pill);
      });
      const inp = document.createElement('input');
      inp.placeholder = 'e.g. Blender';
      inp.addEventListener('keydown', e=>{
        if(e.key==='Enter' && inp.value.trim()){
          e.preventDefault(); arr.push({ name: inp.value.trim(), icon: '' }); flagUnsaved(); repaint();
        }
      });
      box.appendChild(inp);
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
let mediaCurrentPath = 'assets';

async function loadMediaTree(force){
  if (mediaTreeCache && !force) return mediaTreeCache;
  mediaTreeCache = await GH.getTree();
  return mediaTreeCache;
}

function fileKind(path){
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (['jpg','jpeg','png','gif','webp','svg','avif'].includes(ext)) return 'image';
  if (['mp4','webm','mov','m4v'].includes(ext)) return 'video';
  if (ext === 'json') return 'lottie';
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

// One shared builder for both the Media Library screen's own grid and
// the "Choose a file" picker popup — previously each had its own
// near-identical copy of this markup, which is exactly how a fix to
// one and not the other went unnoticed for a couple of rounds. Now
// there's exactly one place that decides what a tile looks like.
function folderTileHtml(name, previewPath){
  // A folder's tile shows whatever's actually inside it — the same
  // idea as a project card falling back to its first media item when
  // no thumbnail is set — rather than a generic folder icon standing
  // in for every folder regardless of what it holds. previewPath
  // comes from findFolderPreviewImage() below; no image found (an
  // empty folder, or one with only videos/other files) still falls
  // back to the folder icon.
  //
  // THE FOLDER/FILE BADGE: once a folder shows a real photo instead of
  // a generic icon, it looks exactly like a selectable image tile —
  // there's nothing left to tell them apart at a glance except
  // clicking one and finding out. The small folder-icon chip in the
  // corner is that missing cue: every folder gets it, image and video
  // files never do, so "this opens into more things" vs "this is the
  // thing itself" is visible without a click.
  const thumbHtml = previewPath
    ? `<img src="${attr(ghRawUrl(previewPath))}" loading="lazy" onerror="this.parentElement.innerHTML='${FOLDER_ICON_SVG.replace(/"/g, '&quot;')}'">`
    : FOLDER_ICON_SVG;
  const badge = previewPath ? `<span class="tile-badge" title="Folder"><i class="fa-solid fa-folder"></i></span>` : '';
  return `<div class="thumb">${thumbHtml}${badge}</div><div class="meta"><div class="fname">${esc(name)}</div></div>`;
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
    : FILE_ICON_SVG;
  // A video's tile shows its first frame — often indistinguishable
  // from a still photo at this size. The play-icon badge is the same
  // cue the public site's own lightbox thumbnails already use for
  // this, so it reads consistently for you across both.
  const badge = kind === 'video' ? `<span class="tile-badge" title="Video"><i class="fa-solid fa-play"></i></span>` : kind === 'lottie' ? `<span class="tile-badge" title="Lottie JSON"><i class="fa-solid fa-wand-magic-sparkles"></i></span>` : '';
  return `<div class="thumb">${thumbHtml}${badge}</div><div class="meta"><div class="fname">${esc(name)}</div></div>`;
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
    if (slash === -1) { if (item.type === 'blob') files.push(item); }
    else folders.add(rest.slice(0, slash));
  });
  return { folders: [...folders].sort(), files: files.sort((a,b)=>a.path.localeCompare(b.path)) };
}

function openMediaPicker(onPick){
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2000;display:flex;align-items:center;justify-content:center;padding:24px;';
  overlay.innerHTML = `
    <div style="background:var(--panel);border:1px solid var(--line);border-radius:12px;width:100%;max-width:640px;height:min(82vh,640px);max-height:82vh;display:flex;flex-direction:column;overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--line);flex-shrink:0;">
        <strong style="color:#fff;font-size:.95rem">Choose a file</strong>
        <button class="icon-btn" data-close-picker type="button"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div style="padding:14px 20px 0;flex-shrink:0;">
        <div class="media-folder-crumb" id="pickerCrumbs"></div>
      </div>
      <!-- Same dropzone as Media Library, so you don't have to close
           this, go find that screen, upload, then come back and
           re-navigate to where you were — drop or pick a file and it
           uploads straight into whichever folder is open right now. -->
      <div style="padding:10px 20px 0;flex-shrink:0;">
        <div class="dropzone dropzone-compact" id="pickerDropzone">
          <i class="fa-solid fa-cloud-arrow-up"></i>
          Drag a file here, or click to upload it into this folder
          <input type="file" id="pickerFileInput" multiple style="display:none">
        </div>
      </div>
      <!-- height:min(82vh,640px) above turns this into a fixed-size
           window instead of one that only happens to be tall enough
           for however many folders/files are in view right now — so
           a folder with 60 files scrolls internally here exactly the
           same way a folder with 3 files does, rather than the whole
           modal trying (and on some phones, failing) to grow past the
           viewport. overscroll-behavior:contain keeps a fast scroll to
           the end of a long folder from bleeding into the page behind
           the modal, the same fix already used on the lightbox. -->
      <div class="media-grid" id="pickerGrid" style="padding:14px 20px 20px;overflow-y:auto;overscroll-behavior:contain;flex:1 1 auto;min-height:0;"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  function close(){ overlay.remove(); }
  overlay.addEventListener('click', e=>{ if(e.target===overlay) close(); });
  overlay.querySelector('[data-close-picker]').addEventListener('click', close);
  document.addEventListener('keydown', function escHandler(e){
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
  });

  const pickerDropzone = overlay.querySelector('#pickerDropzone');
  const pickerFileInput = overlay.querySelector('#pickerFileInput');
  pickerDropzone.addEventListener('click', () => pickerFileInput.click());
  pickerFileInput.addEventListener('change', () => handlePickerUpload(pickerFileInput.files));
  ['dragenter','dragover'].forEach(evt => pickerDropzone.addEventListener(evt, e => { e.preventDefault(); pickerDropzone.classList.add('hover'); }));
  ['dragleave','drop'].forEach(evt => pickerDropzone.addEventListener(evt, e => { e.preventDefault(); pickerDropzone.classList.remove('hover'); }));
  pickerDropzone.addEventListener('drop', e => { if (e.dataTransfer.files.length) handlePickerUpload(e.dataTransfer.files); });

  let pickerTree = null; // set by paintPicker below, read here for sha lookups on overwrite
  async function handlePickerUpload(fileList){
    const grid = overlay.querySelector('#pickerGrid');
    await uploadFilesToFolder(fileList, mediaPickerPath || 'assets', grid, pickerTree || []);
    await loadMediaTree(true);
    paintPicker();
  }

  async function paintPicker(){
    const grid = overlay.querySelector('#pickerGrid');
    let tree;
    try { tree = await loadMediaTree(false); }
    catch(err){
      grid.innerHTML = `<div class="banner info" style="grid-column:1/-1;border-color:rgba(224,88,79,.4)">Couldn't load your files — ${esc(err.message)}</div>`;
      return;
    }
    pickerTree = tree; // read by handlePickerUpload above for overwrite sha lookups

    const { folders, files } = childrenOfPath(tree, mediaPickerPath);
    const crumbs = mediaPickerPath.split('/');
    const crumbWrap = overlay.querySelector('#pickerCrumbs');
    crumbWrap.innerHTML = '';
    crumbs.forEach((seg, i) => {
      const pathHere = crumbs.slice(0, i+1).join('/');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = seg;
      btn.addEventListener('click', () => { mediaPickerPath = pathHere; paintPicker(); });
      crumbWrap.appendChild(btn);
      if (i < crumbs.length - 1) {
        const sep = document.createElement('span'); sep.textContent = '/'; sep.style.color = '#444';
        crumbWrap.appendChild(sep);
      }
    });

    grid.innerHTML = '';
    if (!folders.length && !files.length) {
      // Actionable, not just descriptive — clicking through to Media
      // Library and picking up right where you left off (a fresh
      // Now that this popup can upload directly (see the dropzone
      // above), an empty folder is just a plain heads-up rather than
      // a dead end pointing you somewhere else.
      grid.innerHTML = `<div class="banner muted" style="grid-column:1/-1">Nothing here yet — drag a file into the box above, or click it to choose one.</div>`;
    }
    folders.forEach(f => {
      const tile = document.createElement('div');
      tile.className = 'media-tile folder-tile';
      tile.innerHTML = folderTileHtml(f, findFolderPreviewImage(tree, mediaPickerPath + '/' + f));
      tile.addEventListener('click', () => { mediaPickerPath = mediaPickerPath + '/' + f; paintPicker(); });
      grid.appendChild(tile);
    });
    files.forEach(item => {
      const tile = document.createElement('div');
      tile.className = 'media-tile';
      tile.style.cursor = 'pointer';
      tile.innerHTML = fileTileHtml(item);
      tile.addEventListener('click', () => { onPick(item.path); close(); });
      grid.appendChild(tile);
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
function attachMediaBrowseButton(inputEl, onPicked){
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
    openMediaPicker(path => {
      inputEl.value = path;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      if (onPicked) onPicked(path);
    });
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

function wirePreviewAspect(boxEl, m){
  if (!boxEl) return;
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
   only ever fills in the rendered <img>, never the underlying data. */
function computeFallbackThumb(media){
  const firstUsable=(media||[]).find(m=>m&&m.src&&['image','video','lottie'].includes(m.type));
  if(firstUsable) return {type:firstUsable.type,src:firstUsable.src};
  const yt=(media||[]).find(m=>m&&m.type==='youtube'&&m.src);
  if(yt){ const id=extractYouTubeId(yt.src); if(id) return {type:'image',src:`https://img.youtube.com/vi/${id}/hqdefault.jpg`}; }
  return null;
}
function computeFallbackThumbSrc(media){ const x=computeFallbackThumb(media); return x?x.src:''; }

RENDERERS.media = async function(){
  content.innerHTML = `<div class="loading-row"><i class="fa-solid fa-circle-notch spin"></i> Loading your files…</div>`;
  let tree;
  try{ tree = await loadMediaTree(false); }
  catch(err){
    content.innerHTML = `<div class="content-head"><div><h2>Media Library</h2></div></div><div class="banner info" style="border-color:rgba(224,88,79,.4)"><i class="fa-solid fa-triangle-exclamation" style="color:#e0584f"></i><div><strong>Couldn't load your files.</strong><br>${err.message}</div></div>`;
    return;
  }
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
    const { folders, files } = childrenOf(mediaCurrentPath);
    const crumbs = mediaCurrentPath.split('/');

    content.innerHTML = sectionHead('Media Library', 'Everything your projects and hero can point to — upload new files here, then copy the path into a Source or Photo field elsewhere in the CMS.') + `
      <div class="media-toolbar">
        <div class="field">
          <label class="field-label">Upload to folder</label>
          <input id="uploadPath" value="${attr(mediaCurrentPath)}">
        </div>
        <button class="ghost" id="btnRefresh"><i class="fa-solid fa-rotate"></i> Refresh</button>
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
      tile.innerHTML = folderTileHtml(f, findFolderPreviewImage(tree, mediaCurrentPath + '/' + f));
      tile.addEventListener('click', () => { mediaCurrentPath = mediaCurrentPath + '/' + f; paint(); });
      grid.appendChild(tile);
    });
    files.forEach(item => {
      const tile = document.createElement('div');
      tile.className = 'media-tile';
      tile.innerHTML = fileTileHtml(item) + `
        <div class="tile-actions">
          <button class="ghost" data-copy>Copy path</button>
          <button class="danger" data-del>Delete</button>
        </div>
      `;
      tile.querySelector('[data-copy]').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(item.path); toast('Path copied — paste it into a Source or Photo field.'); }
        catch(e){ prompt('Copy this path:', item.path); }
      });
      tile.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm(`Delete "${item.path}"? This can't be undone from here (though it stays in git history).`)) return;
        try {
          await GH.deleteFile(item.path, item.sha, `CMS: delete ${item.path}`);
          toast(`Deleted ${name}.`);
          tree = await loadMediaTree(true);
          paint();
        } catch(err){ toast(err.message, true); }
      });
      grid.appendChild(tile);
    });

    document.getElementById('btnRefresh').addEventListener('click', async () => {
      tree = await loadMediaTree(true);
      paint();
      toast('Refreshed.');
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
      // Full refresh once the batch settles — this is what replaces the
      // temporary tiles above with the real, permanent ones (with their
      // Copy path / Delete buttons) sourced from the actual repo state.
      tree = await loadMediaTree(true);
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
        Settings & Toggles → <code class="k">data/settings.json</code>
      </div>
    </div>

    <div class="panel">
      <h3>All six are live</h3>
      <p class="panel-sub">Every screen above is read directly by the site — <code class="k">index.html</code> and <code class="k">about/index.html</code>
      fetch each JSON file on load and rebuild that part of the page from it. Editing here and saving is the whole workflow now;
      nothing needs a follow-up code change.</p>
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