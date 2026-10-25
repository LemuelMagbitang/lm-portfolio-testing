#!/usr/bin/env node
import fs from "node:fs";
const errors = [];
const read = (path) => { try { return fs.readFileSync(path, "utf8"); } catch (_) { errors.push(path + " is missing."); return ""; } };
const check = (ok, message) => { if (!ok) errors.push(message); };
let config = {}, heroLoop = [];
try { config = JSON.parse(read("data/video-platform.json")); } catch (e) { errors.push("Invalid video-platform JSON: " + e.message); }
try { heroLoop = JSON.parse(read("data/hero-loop.json")); } catch (e) { errors.push("Invalid hero-loop JSON: " + e.message); }
const migration = read("supabase/migrations/20261025000100_video_library.sql");
const admin = read("supabase/functions/mux-admin/index.ts");
const webhook = read("supabase/functions/mux-webhook/index.ts");
const publicApi = read("supabase/functions/mux-public/index.ts");
const bridge = read("js/infrastructure/mux/public-videos.js");
const player = read("js/infrastructure/mux/player.js");
const hero = read("js/features/hero/index.js");
const footer = read("js/features/footer/index.js");
const styles = read("css/style.css");
const page = read("admin/videos.html"), script = read("admin/videos.js"), cms = read("admin/index.html");
const workflow = read(".github/workflows/site-validation.yml");
const smoke = read("tools/smoke-browser.mjs");
const supabaseConfig = read("supabase/config.toml");
check(migration.includes("create table if not exists public.videos") && migration.includes("create table if not exists public.video_assets"), "Video tables missing.");
check(["mux-admin", "mux-webhook", "mux-public"].every((name) =>
  new RegExp("\\[functions\." + name + "\\]\\s*\\nverify_jwt\\s*=\\s*false").test(supabaseConfig)
), "Supabase Edge Function JWT overrides must match each function's own auth model.");
check(migration.includes("mux_webhook_events") && migration.includes("enable row level security") && migration.includes("revoke all on public.video_assets from anon, authenticated"), "Webhook store or RLS boundary missing.");
check(migration.includes("mux_asset_id text unique") && migration.includes("mux_upload_id text unique"), "Mux asset and upload IDs must be unique.");
check(admin.includes("external_id: asset.external_id || asset.id") && read("supabase/functions/_shared/http.ts").includes("CMS_ADMIN_USER_IDS"), "Admin auth or external_id assignment missing.");
check(admin.includes("function muxTimestampToIso(value: unknown)") &&
  admin.includes("uploaded_at: muxTimestampToIso(remote?.created_at)") &&
  admin.includes("numeric * 1000"),
  "Mux import must convert Unix-second created_at values to ISO timestamps before inserting timestamptz.");
check(admin.includes("MUX_UPLOAD_CORS_ORIGIN") && admin.includes("import-mux") && admin.includes("import-static"), "CORS settings or existing asset import route missing.");
check(read("supabase/functions/_shared/http.ts").includes("function normalizeOrigin") && read("supabase/functions/_shared/http.ts").includes("allowed.includes(requestOrigin)"), "CORS origin matching must normalize configured origins before comparison.");
check(read("supabase/functions/_shared/http.ts").includes('"Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS"'), "Admin CORS preflight must allow PATCH for video detail updates.");
check(webhook.includes("mux-signature") && webhook.includes("crypto.subtle.sign") && webhook.includes("video.asset.ready"), "Webhook signature or lifecycle processing missing.");
check(webhook.includes("video.upload.asset_created") && webhook.includes("video.asset.errored") && webhook.includes("video.asset.deleted") && webhook.includes("processed_at"), "Webhook lifecycle/idempotency incomplete.");
const assetCreatedHandler = webhook.split('if (event.type === "video.upload.asset_created") {')[1]?.split('} else if (event.type === "video.asset.ready") {')[0] || "";
check(assetCreatedHandler.includes("d.new_asset_settings?.meta?.external_id") &&
  assetCreatedHandler.includes('eq("external_id", externalId)') &&
  assetCreatedHandler.includes('eq("mux_upload_id", d.id)') &&
  assetCreatedHandler.includes('mux_upload_id: d.id') &&
  (assetCreatedHandler.split("if (result.error) throw result.error;").length - 1) >= 2,
  "Upload-created webhooks must recover an early-arrival race using the stable external ID and check both database updates.");
check(webhook.includes('const { data: old, error: oldError }') && webhook.includes("if (oldError) throw oldError;"),
  "Webhook deduplication reads must fail on database errors.");

// Verify both terminal lifecycle handlers call the shared cleanup helper, and
// verify that the helper fails loudly when the unpublish database update fails.
// Keep this behavioral contract independent of how each handler collects IDs.
const unpublishHelper = webhook.match(/async function unpublishActiveAssets\(db: any, assetIds: string\[\]\) \{([\s\S]*?)\n\}/)?.[1] || "";
const erroredHandler = webhook.split('} else if (event.type === "video.asset.errored") {')[1]?.split('} else if (event.type === "video.asset.deleted") {')[0] || "";
const deletedHandler = webhook.split('} else if (event.type === "video.asset.deleted") {')[1]?.split('} else if (["video.upload.errored"')[0] || "";
const cleanupCall = "await unpublishActiveAssets(db, affectedAssets.map((item: any) => item.id))";
check(unpublishHelper.includes('.update({ published: false, active_asset_id: null })') &&
  unpublishHelper.includes("if (error) throw error;") &&
  erroredHandler.includes(cleanupCall) &&
  deletedHandler.includes(cleanupCall),
  "Errored and deleted active assets must be unpublished with checked database updates.");

check(migration.includes("last_mux_event_created_at timestamptz") &&
  webhook.includes('Date.parse(String(event.created_at || ""))') &&
  webhook.includes("const newerEventFilter =") &&
  (webhook.match(/\.or\(newerEventFilter\)/g) || []).length >= 5 &&
  webhook.includes("const assetCreatedFilter = [") &&
  webhook.includes("and(asset_status.eq.preparing,last_mux_event_created_at.lt.") &&
  (webhook.match(/eq\("last_mux_event_created_at", eventCreatedAt\)/g) || []).length >= 3,
  "Mux lifecycle updates must enforce ordering, preserve terminal states, and retry cleanup idempotently.");
check(publicApi.includes('eq("published", true)') && publicApi.includes('asset.playback_policy !== "public"'), "Public feed must restrict published/public-playback assets.");
check(bridge.includes("data/video-platform.json") && bridge.includes("/functions/v1/mux-public"), "Public client bridge missing.");
check(player.includes("@mux/mux-player@3/+esm") && player.includes('customElements.get("mux-player")'), "Mux Player loading check missing.");
check(hero.includes("loadPublicMuxVideos") && hero.includes("ensureMuxPlayer") && hero.includes("mux-player"), "Hero source adapter missing.");
const heroMuxSetup = hero.split("if (source.type === 'mux') {")[1]?.split("} else if (source.type === 'video') {")[0] || "";
const heroReducedMotionBranch = heroMuxSetup.split("if (reducedMotion) {")[1]?.split("} else {")[0] || "";
check(hero.includes("assets/projects/site/banner/hero-reel.mp4") &&
  hero.includes("fallbackMuxToNativeVideo") &&
  hero.includes("setAttribute('autoplay', 'muted')") &&
  !heroMuxSetup.includes("playsInline") &&
  !heroMuxSetup.includes("playsinline") &&
  hero.includes("if (media.localName !== 'mux-player') media.playsInline = true;") &&
  hero.includes("if (!reducedMotion && sources.some(source => source.type === 'mux'))") &&
  heroReducedMotionBranch.includes("documentRef.createElement('video')") &&
  !heroReducedMotionBranch.includes("playback-id") &&
  styles.includes(".hero-banner .slide mux-player::part(center)"),
  "Hero Mux playback must autoplay muted in normal mode, render poster-only native media for reduced motion, avoid unsupported playsInline handling, hide UI and retain fallback.");
check(footer.includes("media.controls = false") &&
  footer.includes("media.setAttribute('autoplay', 'muted')") &&
  footer.includes("media.style.setProperty('--controls', 'none')") &&
  !footer.includes("media.setAttribute('playsinline'") &&
  footer.includes("!reducedMotion() && index === 0") &&
  footer.includes("const reduceMotionNow = Boolean(reducedMotion())") &&
  footer.includes("source.type !== 'mux'") &&
  footer.includes("type: 'image', src: poster") &&
  styles.includes(".footer-animation-slide mux-player::part(center)") &&
  styles.includes("--controls:none"),
  "Footer Mux playback must autoplay only the active muted slide without visible controls; reduced-motion mode must use poster-only images.");
const footerNativeVideo = footer.split("} else if (source.type === 'video') {")[1]?.split("} else if (source.type === 'lottie') {")[0] || "";
check(footerNativeVideo.includes("media.autoplay = Boolean(autoplayAllowed)") &&
  footerNativeVideo.includes("media.preload = autoplayAllowed ? 'auto' : 'none'") &&
  footer.includes("const previousVideo = previous?.querySelector('video')") &&
  footer.includes("const currentVideo = slides[index]?.querySelector('video')") &&
  footer.includes("currentVideo.play?.()"),
  "Footer native video slides must not autoplay while inactive and must pause/resume only the active slide.");
check(cms.includes('href="videos.html"') && page.includes("mux-uploader"), "CMS link or Mux Uploader UI missing.");
check(page.includes('rel="icon" type="image/png" href="../assets/projects/site/favicon.png"'),
  "Mux Media Library must declare its project-relative favicon instead of requesting /favicon.ico.");
check(script.includes('badge.id="inspectorBadge"') &&
  !script.includes('$("inspectorBadge").textContent') &&
  script.includes('if(!host)return;host.replaceChildren();'),
  "Mux Media Library inspector must keep its recreated status badge attached after replacing inspector content.");
check(script.includes("videos/import-mux") && script.includes("videos/import-static"), "CMS import flows missing.");
check(admin.includes('route[0] === "mux-assets"') && admin.includes('route[2] === "placement"') &&
  admin.includes('"/assets?limit=100"') && admin.includes('request.method === "PATCH"') &&
  admin.includes('route[2] === "unpublish"'),
  "The Mux admin API must support asset discovery, safe metadata editing, publish state and legacy placement compatibility.");
check(page.includes('id="muxAssetSelect"') && page.includes('id="refreshMuxAssetsButton"') &&
  script.includes('api("mux-assets")') && script.includes('No unlinked public-playback assets found') &&
  page.includes('id="sidebar"') && page.includes('id="signOutButton"') &&
  page.includes('id="searchInput"') && page.includes('id="statusFilter"') &&
  page.includes('id="providerFilter"') && page.includes('id="gridViewButton"') &&
  page.includes('id="listViewButton"') && page.includes('id="assetInspector"'),
  "Mux Media Library must include persistent navigation, logout, search/filter, grid/list, title-based import and a details inspector.");
check(!/Website Placements|Website placement/i.test(page + script) &&
  !script.includes('"/placement"') &&
  script.includes('method:"PATCH"') && script.includes('"/unpublish"'),
  "The Mux media library must not expose website placement controls and must support editing/unpublishing.");
check(script.includes("describeApiError") && script.includes("CMS_ADMIN_USER_IDS"), "CMS API errors should explain HTTP status and admin allowlist setup.");
const mainCmsScript = read("admin/admin.js");
check(mainCmsScript.includes('data-picker-source="cms"') &&
  mainCmsScript.includes('data-picker-source="mux"') &&
  mainCmsScript.includes('data-picker-panel="mux"') &&
  mainCmsScript.includes('returnSelectionObject') &&
  mainCmsScript.includes("function openMuxMediaPicker"),
  "CMS media selection must offer CMS and Mux sources in one accessible picker.");
check(mainCmsScript.includes("loadPublishedMuxVideoCatalog") &&
  mainCmsScript.includes("function openMuxMediaPicker") &&
  mainCmsScript.includes("data-mux-selection") &&
  mainCmsScript.includes("data-mux-browse") &&
  mainCmsScript.includes("data-thumb-mux-browse") &&
  mainCmsScript.includes("data-hero-mux-browse") &&
  mainCmsScript.includes("fl_mux_browse") &&
  mainCmsScript.includes("Mux video (streamed)") &&
  mainCmsScript.includes("muxPosterUrl") &&
  read("admin/admin.css").includes("Unified Mux video picker"),
  "CMS Projects, thumbnails, hero/footer sources and the shared picker must support title-based Mux selection with responsive UI.");
check(read("js/data/project-normalizer.js").includes("normalized.thumbnail.playbackId = playbackId") &&
  read("js/features/lightbox/media-renderer.js").includes("function renderMuxVideo") &&
  read("js/features/projects/project-card.js").includes("declaredThumbnailType === 'mux' ? 'image'") &&
  read("js/features/footer/index.js").includes("ensureMuxPlayer") &&
  hero.includes("manualSources.length ? manualSources : remoteVideos"),
  "Mux thumbnails must remain poster-only, project lightboxes must stream Mux, and explicit hero/footer picks must be preserved.");
check(read("supabase/functions/_shared/http.ts").includes("export class MuxApiError") &&
  read("supabase/functions/_shared/http.ts").includes("throw new MuxApiError(response.status") &&
  admin.includes("instanceof MuxApiError") && admin.includes('code: authFailure ? "mux_auth_failed"'),
  "Mux upstream HTTP status must be preserved and surfaced as a structured admin API error.");
check(script.includes('"mux_auth_failed"') &&
  script.includes("MUX_TOKEN_ID and MUX_TOKEN_SECRET") &&
  script.includes("Mux Video Read permission"),
  "CMS must explain how to resolve rejected Mux API credentials.");
check(
  (Array.isArray(heroLoop) && heroLoop.some((item) => item.type === "video" && item.src)) ||
  (hero.includes("assets/projects/site/banner/hero-reel.mp4") &&
   fs.existsSync("assets/projects/site/banner/hero-reel.mp4") &&
   hero.includes("fallbackMuxToNativeVideo")),
  "Legacy MP4 fallback must remain as a checked-in hero slide or a runtime fallback for the selected Mux slide."
);
const supabaseUrl = String(config.supabaseUrl || "").trim();
const supabaseKey = String(config.supabaseAnonKey || "").trim();
function isPublicSupabaseKey(value) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  const parts = value.split(".");
  if (parts.length !== 3 || !/^eyJ[A-Za-z0-9_-]+$/.test(parts[0])) return false;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return claims.role === "anon";
  } catch (_) { return false; }
}
let validPublicConfig = !supabaseUrl && !supabaseKey;
if (supabaseUrl && supabaseKey) {
  try {
    const parsed = new URL(supabaseUrl);
    validPublicConfig = parsed.protocol === "https:" &&
      /^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname) &&
      !parsed.port && parsed.pathname === "/" && !parsed.search && !parsed.hash &&
      isPublicSupabaseKey(supabaseKey);
  } catch (_) { validPublicConfig = false; }
}
check(validPublicConfig, "Public config must be blank or contain an HTTPS Supabase project URL and a publishable/anon key (never a secret/service-role key).");
check(workflow.includes("validate-mux-integration.mjs"), "CI validator is not configured.");
check(smoke.includes("**/data/video-platform.json") && smoke.includes("local MP4 fallback"), "Browser smoke test must stub the hosted video backend and remain deterministic.");
check(!/MUX_TOKEN_SECRET\s*[:=]\s*["'][^"']+["']/.test(admin + webhook + publicApi), "Literal Mux secret appears in code.");
if (errors.length) { console.error("Mux integration contract: FAIL"); errors.forEach((e) => console.error(" - " + e)); process.exit(1); }
console.log("Mux integration contract: PASS");
console.log(" - Database/RLS, Direct Upload, existing asset import and static MP4 registration");
console.log(" - Signed webhook lifecycle and deduplication");
console.log(" - Optional Mux hero with checked-in MP4 fallback");
console.log(" - Video Library link and public-config safety");
