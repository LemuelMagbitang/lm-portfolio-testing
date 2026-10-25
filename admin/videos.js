const CONFIG_KEY = "lm_mux_video_config_v1";
const SESSION_KEY = "lm_mux_video_session_v1";
const $ = (id) => document.getElementById(id);
let config = { supabaseUrl: "", supabaseAnonKey: "" };
let inFlight = false;
let muxImportAssets = [];
function status(id, message, kind = "") { const node = $(id); if (node) { node.textContent = message || ""; node.className = "status" + (kind ? " " + kind : ""); } }
function slugify(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "mux-video";
}
function placementLabel(value) {
  return ({ hero: "Homepage hero loop", project: "Project media / lightbox", background: "Background (not connected yet)", footer: "Footer (not connected yet)", other: "Other (not connected yet)" })[value] || String(value || "Unknown");
}
function normalizeBase(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Use an HTTPS Supabase project URL.");
  return url.origin;
}
function getSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch (_) { return null; } }
function saveSession(value) { sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); }
async function loadConfig() {
  let file = {};
  try { const response = await fetch("../data/video-platform.json", { cache: "no-cache", credentials: "omit" }); if (response.ok) file = await response.json(); } catch (_) {}
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}"); } catch (_) {}
  config = { supabaseUrl: saved.supabaseUrl || file.supabaseUrl || "", supabaseAnonKey: saved.supabaseAnonKey || file.supabaseAnonKey || "" };
  $("supabaseUrl").value = config.supabaseUrl; $("supabaseAnonKey").value = config.supabaseAnonKey;
}
function updatePanels() {
  const configured = Boolean(config.supabaseUrl && config.supabaseAnonKey), signed = Boolean(getSession()?.access_token);
  $("loginPanel").classList.toggle("hidden", !configured || signed);
  $("workspace").classList.toggle("hidden", !configured || !signed);
  $("signOutButton").classList.toggle("hidden", !signed);
}
async function refreshToken() {
  const session = getSession(); if (!session?.refresh_token) return null;
  const response = await fetch(config.supabaseUrl + "/auth/v1/token?grant_type=refresh_token", { method: "POST",
    headers: { apikey: config.supabaseAnonKey, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: session.refresh_token }), credentials: "omit" });
  if (!response.ok) { sessionStorage.removeItem(SESSION_KEY); return null; }
  const updated = await response.json(); saveSession(updated); return updated.access_token;
}
async function token() {
  const session = getSession(); if (!session?.access_token) throw new Error("Sign in to the video CMS first.");
  if (!session.expires_at || Number(session.expires_at) * 1000 > Date.now() + 30000) return session.access_token;
  const updated = await refreshToken(); if (!updated) throw new Error("Your session expired. Sign in again."); return updated;
}
function describeApiError(statusCode, payload) {
  const detail = String(payload?.detail || payload?.error || payload?.message || payload?.msg || "").trim();
  if (payload?.code === "mux_auth_failed") {
    return "Mux rejected the server API credentials (upstream HTTP " + Number(payload?.upstreamStatus || statusCode) +
      "). Verify MUX_TOKEN_ID and MUX_TOKEN_SECRET are a matching pair from the same Mux environment, and that the token has Mux Video Read permission." +
      (detail ? " Mux detail: " + detail : "");
  }
  if (payload?.code === "mux_asset_not_found") {
    return "Mux could not find this asset in the environment selected by the server token. Confirm the asset ID and that it belongs to the same Mux environment as MUX_TOKEN_ID/MUX_TOKEN_SECRET." +
      (detail ? " Mux detail: " + detail : "");
  }
  if (payload?.code === "mux_api_error") {
    return "Mux API request failed (upstream HTTP " + Number(payload?.upstreamStatus || statusCode) + ")." +
      (detail ? " Mux detail: " + detail : "");
  }
  if (statusCode === 401) {
    return "Unauthorized (401). Sign in again. If sign-in succeeds but the request still fails, verify mux-admin is deployed with verify_jwt = false and that the CMS session is valid." +
      (detail ? " Server detail: " + detail : "");
  }
  if (statusCode === 403) {
    return "Forbidden (403). The signed-in Supabase Auth user's UID must be included in the server-side CMS_ADMIN_USER_IDS secret." +
      (detail ? " Server detail: " + detail : "");
  }
  if (statusCode === 404) {
    return "Not found (404). Check that mux-admin is deployed to the Supabase project configured above." +
      (detail ? " Server detail: " + detail : "");
  }
  if (statusCode >= 500) {
    return "Backend error (" + statusCode + "). Check Supabase Edge Function logs, database access, and the required Mux/Supabase secrets." +
      (detail ? " Server detail: " + detail : "");
  }
  return detail || "Request failed with HTTP " + statusCode;
}
async function api(route, options = {}) {
  const base = normalizeBase(config.supabaseUrl); let auth = await token();
  const call = (value) => fetch(base + "/functions/v1/mux-admin/" + route.replace(/^\/+/, ""), { method: options.method || "GET",
    headers: { apikey: config.supabaseAnonKey, Authorization: "Bearer " + value, ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body), credentials: "omit" });
  let response;
  try {
    response = await call(auth);
    if (response.status === 401) { auth = await refreshToken(); if (auth) response = await call(auth); }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || "");
    throw new Error("Could not reach the Supabase admin API. Check the browser origin against CMS_ALLOWED_ORIGINS and inspect CORS/network errors." +
      (detail ? " " + detail : ""));
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(describeApiError(response.status, payload));
  return payload;
}
function button(label, action, primary = false) { const el = document.createElement("button"); el.type = "button"; el.className = "button" + (primary ? " primary" : ""); el.textContent = label; el.addEventListener("click", action); return el; }
function assetStatus(asset) {
  if (!asset) return "No asset"; if (asset.provider === "static_mp4") return "Static MP4 ready";
  if (asset.asset_status === "ready") return "Ready"; if (asset.asset_status === "errored" || asset.upload_state === "failed") return "Failed";
  if (asset.asset_status === "preparing") return "Processing"; if (asset.upload_state === "awaiting_upload") return "Awaiting upload";
  return String(asset.asset_status || asset.upload_state || "Not started");
}
async function loadMuxImportAssets() {
  const select = $("muxAssetSelect");
  if (!select) return;
  const hint = $("muxAssetsHint"), refresh = $("refreshMuxAssetsButton"), previous = select.value;
  select.replaceChildren();
  const loading = document.createElement("option"); loading.value = ""; loading.textContent = "Loading Mux uploads…"; select.append(loading);
  select.disabled = true; if (refresh) refresh.disabled = true;
  try {
    const result = await api("mux-assets");
    muxImportAssets = Array.isArray(result.assets) ? result.assets : [];
    select.replaceChildren();
    const placeholder = document.createElement("option"); placeholder.value = "";
    placeholder.textContent = muxImportAssets.length ? "Choose a Mux video…" : "No unlinked videos found in recent Mux assets";
    select.append(placeholder);
    for (const asset of muxImportAssets) {
      const option = document.createElement("option"); option.value = String(asset.id || "");
      const duration = Number.isFinite(Number(asset.durationSeconds)) ? " · " + Math.round(Number(asset.durationSeconds)) + " sec" : "";
      const date = asset.createdAt ? " · " + new Date(asset.createdAt).toLocaleDateString() : "";
      option.textContent = String(asset.title || "Untitled Mux video") + " · " + String(asset.status || "unknown") + duration + date;
      select.append(option);
    }
    select.value = muxImportAssets.some(asset => String(asset.id) === previous) ? previous : "";
    if (hint) hint.textContent = muxImportAssets.length
      ? muxImportAssets.length + " unlinked, public-playback video(s) found in the most recent " + Number(result.checked || 100) + " Mux assets. Select one; IDs stay behind the scenes."
      : "No unlinked, public-playback videos found in recent Mux assets. Videos already linked to this CMS appear under Video records below.";
  } catch (error) {
    muxImportAssets = []; select.replaceChildren();
    const failed = document.createElement("option"); failed.value = ""; failed.textContent = "Could not load Mux uploads"; select.append(failed);
    if (hint) hint.textContent = "Could not load Mux uploads. Try Refresh uploads. " + (error?.message || "");
  } finally {
    select.disabled = false; if (refresh) refresh.disabled = false;
  }
}
function suggestImportDetails() {
  const id = String($("muxAssetSelect")?.value || "");
  $("muxAssetId").value = id;
  const asset = muxImportAssets.find(item => String(item.id) === id);
  if (!asset) return;
  $("importTitle").value = String(asset.title || "Imported Mux video");
  $("importSlug").value = slugify(asset.title || "mux-video");
}
async function refreshList() {
  status("listStatus", "Loading video records…");
  try { const result = await api("videos"); renderVideos(Array.isArray(result.videos) ? result.videos : []); status("listStatus", result.videos?.length ? "Loaded " + result.videos.length + " record(s)." : "No video records yet.", "good"); }
  catch (error) { status("listStatus", error.message, "bad"); }
}
function renderVideos(videos) {
  const list = $("videoList"); list.replaceChildren();
  for (const video of videos) {
    const card = document.createElement("article"); card.className = "video-card";
    const header = document.createElement("div"); header.className = "video-head";
    const title = document.createElement("strong"); title.textContent = video.title || video.slug;
    const chip = document.createElement("span"); chip.className = "chip"; chip.textContent = video.published ? "Published" : "Draft"; header.append(title, chip);
    const assets = Array.isArray(video.assets) ? video.assets : [], latest = assets[0] || null;
    const meta = document.createElement("div"); meta.className = "video-meta";
    meta.textContent = "slug: " + video.slug + " · placement: " + video.placement + " · latest: " + assetStatus(latest) +
      (latest?.mux_asset_id ? " · Mux asset ID: " + latest.mux_asset_id : "") +
      (latest?.mux_playback_id ? " · playback ID: " + latest.mux_playback_id : "") +
      (video.active_asset_id ? " · active version: " + video.active_asset_id : "");
    const actions = document.createElement("div"); actions.className = "row";
    if (latest?.asset_status === "ready" && (!video.published || video.active_asset_id !== latest.id)) actions.append(button("Publish latest ready version", async () => {
      try { await api("videos/" + encodeURIComponent(video.id) + "/publish", { method: "POST", body: { assetId: latest.id } }); status("listStatus", "Published " + video.title + ".", "good"); await refreshList(); }
      catch (error) { status("listStatus", error.message, "bad"); }
    }, true));
    actions.append(button("Upload new Mux version", async () => {
      try { const created = await api("videos/" + encodeURIComponent(video.id) + "/assets", { method: "POST", body: {} }); await startUpload(video, created.asset); }
      catch (error) { status("listStatus", error.message, "bad"); }
    }));
    const placementRow = document.createElement("div"); placementRow.className = "row"; placementRow.style.margin = "0 0 12px";
    const placementLabelEl = document.createElement("label"); placementLabelEl.className = "hint"; placementLabelEl.textContent = "Website placement";
    const placementSelect = document.createElement("select"); placementSelect.className = "placement-select";
    placementSelect.setAttribute("aria-label", "Website placement for " + (video.title || video.slug));
    const placementOptions = [["hero", "Homepage hero loop"], ["project", "Project media / lightbox"], ["background", "Background (not connected yet)"], ["footer", "Footer (not connected yet)"], ["other", "Other (not connected yet)"]];
    if (!placementOptions.some(([value]) => value === video.placement)) placementOptions.push([String(video.placement || "other"), placementLabel(video.placement)]);
    for (const [value, labelText] of placementOptions) {
      const option = document.createElement("option"); option.value = value; option.textContent = labelText;
      option.selected = value === video.placement; placementSelect.append(option);
    }
    placementLabelEl.append(placementSelect);
    placementRow.append(placementLabelEl, button("Save placement", async () => {
      try {
        await api("videos/" + encodeURIComponent(video.id) + "/placement", { method: "POST", body: { placement: placementSelect.value } });
        status("listStatus", "Placement saved. " + (placementSelect.value === "hero" ? "The published video is now available to the homepage hero feed." : placementSelect.value === "project" ? "The published video is available in the Projects CMS Mux selector." : "This placement is saved, but its page integration is not wired yet."), "good");
        await refreshList();
      } catch (error) { status("listStatus", error.message, "bad"); }
    }));
    card.append(header, meta, placementRow, actions); list.append(card);
  }
}
async function startUpload(video, asset) {
  const flow = $("uploadFlow"); flow.classList.remove("hidden"); flow.replaceChildren();
  const heading = document.createElement("strong"); heading.textContent = "Upload: " + video.title;
  const message = document.createElement("p"); message.className = "status"; flow.append(heading, message); message.textContent = "Creating upload URL…";
  try {
    const result = await api("videos/" + encodeURIComponent(video.id) + "/assets/" + encodeURIComponent(asset.id) + "/upload", { method: "POST", body: {} });
    const uploader = document.createElement("mux-uploader"); uploader.setAttribute("endpoint", result.uploadUrl); uploader.setAttribute("pausable", ""); uploader.style.marginTop = "12px";
    uploader.addEventListener("progress", (event) => { const v = event.detail; const p = typeof v === "number" ? v : Number(v?.progress); message.textContent = Number.isFinite(p) ? "Uploading… " + Math.round(p) + "%" : "Uploading…"; });
    uploader.addEventListener("success", async () => { message.textContent = "Upload transferred; waiting for Mux processing and webhook confirmation…"; await refreshList(); });
    uploader.addEventListener("uploaderror", async () => { message.textContent = "Upload failed. Check file/network, then create a fresh asset version before retrying."; message.className = "status bad"; await refreshList(); });
    flow.append(uploader); message.textContent = "Choose an MP4. It uploads directly from this browser to Mux.";
  } catch (error) { message.textContent = error.message; message.className = "status bad"; }
}
$("configForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { config = { supabaseUrl: normalizeBase($("supabaseUrl").value), supabaseAnonKey: $("supabaseAnonKey").value.trim() }; if (!config.supabaseAnonKey) throw new Error("Enter the public key.");
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); status("configStatus", "Saved public connection settings on this device.", "good"); updatePanels(); if (getSession()?.access_token) await refreshList();
  } catch (error) { status("configStatus", error.message, "bad"); }
});
$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault(); status("loginStatus", "Signing in…");
  try { const response = await fetch(normalizeBase(config.supabaseUrl) + "/auth/v1/token?grant_type=password", { method: "POST",
    headers: { apikey: config.supabaseAnonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: $("loginEmail").value.trim(), password: $("loginPassword").value }), credentials: "omit" });
    const result = await response.json().catch(() => ({})); if (!response.ok || !result.access_token) throw new Error(result.msg || result.message || "Sign-in failed.");
    saveSession(result); $("loginPassword").value = ""; updatePanels(); await refreshList(); await loadMuxImportAssets();
  } catch (error) { sessionStorage.removeItem(SESSION_KEY); updatePanels(); status("loginStatus", error.message, "bad"); }
});
$("signOutButton").addEventListener("click", () => { sessionStorage.removeItem(SESSION_KEY); updatePanels(); $("videoList").replaceChildren(); status("listStatus", "Signed out."); });
$("newVideoForm").addEventListener("submit", async (event) => {
  event.preventDefault(); if (inFlight) return; inFlight = true; const submitter = event.submitter; if (submitter) submitter.disabled = true; status("uploadStatus", "Creating video and asset records…");
  try { const result = await api("videos", { method: "POST", body: { title: $("videoTitle").value.trim(), slug: $("videoSlug").value.trim(), placement: $("videoPlacement").value, description: $("videoDescription").value.trim() } });
    await refreshList(); await startUpload(result.video, result.asset); status("uploadStatus", "Record created. Upload your file, then wait for webhook processing.", "good");
  } catch (error) { status("uploadStatus", error.message, "bad"); } finally { inFlight = false; if (submitter) submitter.disabled = false; }
});
$("muxAssetSelect").addEventListener("change", suggestImportDetails);
$("refreshMuxAssetsButton").addEventListener("click", loadMuxImportAssets);
$("importMuxForm").addEventListener("submit", async (event) => {
  event.preventDefault(); status("importStatus", "Adding selected Mux video…");
  try {
    const muxAssetId = String($("muxAssetSelect").value || "").trim();
    if (!muxAssetId) throw new Error("Choose a Mux upload first.");
    await api("videos/import-mux", { method: "POST", body: { muxAssetId, title: $("importTitle").value.trim(), slug: $("importSlug").value.trim(), placement: $("importPlacement").value } });
    status("importStatus", "Video added. Wait until its record says Ready, then publish it.", "good");
    await refreshList(); await loadMuxImportAssets();
  } catch (error) { status("importStatus", error.message, "bad"); }
});
$("staticVideoForm").addEventListener("submit", async (event) => {
  event.preventDefault(); status("staticStatus", "Registering existing MP4…");
  try { await api("videos/import-static", { method: "POST", body: { title: $("staticTitle").value.trim(), slug: $("staticSlug").value.trim(), placement: $("staticPlacement").value, sourceUrl: $("staticSourceUrl").value.trim() } });
    status("staticStatus", "Registered as a draft. Publish when ready.", "good"); await refreshList();
  } catch (error) { status("staticStatus", error.message, "bad"); }
});
$("refreshButton").addEventListener("click", async () => { await refreshList(); await loadMuxImportAssets(); });
await loadConfig(); updatePanels();
if (getSession()?.access_token && config.supabaseUrl && config.supabaseAnonKey) { await refreshList(); await loadMuxImportAssets(); }
