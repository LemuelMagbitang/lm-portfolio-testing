#!/usr/bin/env node
import fs from "node:fs";
const errors = [];
const read = (path) => { try { return fs.readFileSync(path, "utf8"); } catch (_) { errors.push(path + " is missing."); return ""; } };
const check = (ok, message) => { if (!ok) errors.push(message); };
let config = {}, heroLoop = [];
try { config = JSON.parse(read("data/video-platform.json")); } catch (e) { errors.push("Invalid video-platform JSON: " + e.message); }
try { heroLoop = JSON.parse(read("data/hero-loop.json")); } catch (e) { errors.push("Invalid hero-loop JSON: " + e.message); }
const migration = read("supabase/migrations/20261025000100_video_library.sql");
const hardeningMigration = read("supabase/migrations/20261026065337_harden_video_library_search_path_and_fk_indexes.sql");
const admin = read("supabase/functions/mux-admin/index.ts");
const webhook = read("supabase/functions/mux-webhook/index.ts");
const publicApi = read("supabase/functions/mux-public/index.ts");
const bridge = read("js/infrastructure/mux/public-videos.js");
const player = read("js/infrastructure/mux/player.js");
const muxPlayerModuleUrl = "const MUX_PLAYER_MODULE_URL = '../../infrastructure/mux/player.js?v=20261027-02';";
const databaseTypes = read("supabase/functions/_shared/database.types.ts");
const envExample = read("supabase/functions/.env.example");
const ignore = read(".gitignore");
const hero = read("js/features/hero/index.js");
const footer = read("js/features/footer/index.js");
const styles = read("css/style.css");
const page = read("admin/videos.html"), script = read("admin/videos.js"), cms = read("admin/index.html");
const workflow = read(".github/workflows/site-validation.yml");
const smoke = read("tools/smoke-browser.mjs");
const webhookBody = read("supabase/functions/_shared/request-body.ts");
const webhookBodyTest = read("tools/test-mux-webhook-body-limit.mjs");
const supabaseConfig = read("supabase/config.toml");
const muxFeatureSources = [hero, footer, read("js/features/lightbox/media-renderer.js")];
check(hero.includes("await import('../../infrastructure/mux/public-videos.js?v=20261027-01')") &&
  !hero.includes("import { loadPublicMuxVideos } from '../../infrastructure/mux/public-videos.js';"),
  "Optional published Mux feed helper must load dynamically so a feed-helper fetch failure cannot reject page startup.");
check(muxFeatureSources.every(source =>
  source.includes(muxPlayerModuleUrl) &&
  source.includes("async function loadMuxPlayerModule()") &&
  source.includes("const pending = import(moduleUrl)") &&
  source.includes("if (attempt === 1) return false") &&
  !/import\s*\{\s*ensureMux(?:Video|Player)\s*\}\s*from\s*['"][^'"]*infrastructure\/mux\/player\.js/.test(source)
), "Optional Mux helper must be lazily imported with a common cache key, one retry, and a poster-safe failure path; it cannot be a static page dependency.");
check(migration.includes("create table if not exists public.videos") && migration.includes("create table if not exists public.video_assets"), "Video tables missing.");
check(webhook.includes("readRequestBodyLimited(request, 1_048_576)") &&
  webhook.includes("status: 413") &&
  webhookBody.includes("request.body.getReader()") &&
  webhookBody.includes("total > limit") &&
  workflow.includes("node tools/test-mux-webhook-body-limit.mjs") &&
  webhookBodyTest.includes("streamed oversized bodies should be cancelled"),
  "Mux webhook requests must be size-bounded while streaming and regression-tested before signature verification.");
check(admin.includes('readRequestBodyLimited(request, 65_536)') &&
  admin.includes('Request body too large. Keep Video Library requests under 64 KiB.') &&
  admin.includes('Request body must contain valid JSON.') &&
  admin.includes('}, 413);') &&
  admin.includes('}, 400);'),
  "Video Library admin mutations must bound JSON bodies and return explicit 400/413 responses before parsing oversized input.");
check(hardeningMigration.includes("set search_path = pg_catalog") && hardeningMigration.includes("videos_active_asset_id_idx") && hardeningMigration.includes("videos_created_by_idx"), "Video Library hardening migration must fix trigger search_path and index both referencing columns.");
check(databaseTypes.includes("export type Database") && databaseTypes.includes("mux_webhook_events") && databaseTypes.includes("video_assets") && databaseTypes.includes("videos"), "Generated Supabase Database types must cover the Video Library schema.");
check(ignore.includes(".env") && ignore.includes("!.env.example") && envExample.includes("MUX_TOKEN_SECRET=") && envExample.includes("MUX_WEBHOOK_SECRET=") && envExample.includes("CMS_ADMIN_USER_IDS="), "Local secrets must be ignored by Git and documented using a credential-free environment template.");
check(["mux-admin", "mux-webhook", "mux-public"].every((name) =>
  new RegExp("\\[functions\." + name + "\\]\\s*\\nverify_jwt\\s*=\\s*false").test(supabaseConfig)
), "Supabase Edge Function JWT overrides must match each function's own auth model.");
check(migration.includes("mux_webhook_events") && migration.includes("enable row level security") && migration.includes("revoke all on public.video_assets from anon, authenticated"), "Webhook store or RLS boundary missing.");
check(migration.includes("mux_asset_id text unique") && migration.includes("mux_upload_id text unique"), "Mux asset and upload IDs must be unique.");
check(admin.includes("external_id: uploadAttemptId") && read("supabase/functions/_shared/http.ts").includes("CMS_ADMIN_USER_IDS"), "Admin auth or per-attempt external_id assignment missing.");
const sharedHttp = read("supabase/functions/_shared/http.ts");
check(sharedHttp.includes("SUPABASE_SECRET_KEYS") && sharedHttp.includes("SUPABASE_PUBLISHABLE_KEYS") && sharedHttp.includes("SUPABASE_SERVICE_ROLE_KEY") && sharedHttp.includes("SUPABASE_ANON_KEY") && sharedHttp.includes("@supabase/supabase-js@2.118.0"), "Edge Functions must prefer platform-managed modern API keys, retain a logged legacy fallback, and pin supabase-js.");
check(sharedHttp.includes('const timeoutMs = requestMethod === "GET" ? 12_000 : 30_000') &&
  sharedHttp.includes("signal: controller.signal") &&
  sharedHttp.includes('new MuxApiError(504, "Mux API request timed out after "') &&
  sharedHttp.includes('new MuxApiError(503, "Could not confirm the Mux API response. Refresh the asset state before retrying.")') &&
  sharedHttp.includes("clearTimeout(timer)"),
  "Mux API requests must be time-bounded and distinguish known failures from ambiguous network outcomes.");
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
check(
  publicApi.includes('"Access-Control-Allow-Origin": "*"') &&
  publicApi.includes('"Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, cache-control, pragma"') &&
  publicApi.includes('"Access-Control-Allow-Methods": "GET, OPTIONS"') &&
  publicApi.includes('"Access-Control-Max-Age": "86400"'),
  "Public Mux feed CORS preflight must allow expected fetch/Supabase headers and cache successful preflight results."
);
check(bridge.includes("data/video-platform.json") && bridge.includes("/functions/v1/mux-public") && bridge.includes("supabasePublishableKey") && bridge.includes("supabaseAnonKey"), "Public client bridge must prefer the correctly named publishable key and retain legacy config compatibility.");
check(player.includes("@mux/mux-player@3.14.1/+esm") && player.includes('customElements.get("mux-player")'), "Mux Player must use an exact, validated CDN release.");
check(player.includes("@mux/mux-video@0.31.5/dist/mux-video.mjs") &&
  player.includes('customElements.get("mux-video")') &&
  player.includes("timeoutMs = 15000") &&
  player.includes("Promise.race([muxVideoLoaderPromise, waitForModule])"),
  "Mux Video must use its documented module entrypoint and bound loader time so CDN failures cannot keep the hero blank.");
check(hero.includes("loadPublicMuxVideos") && hero.includes("ensureMuxVideo") && hero.includes("mux-video") &&
  hero.includes("if (remoteVideos.length)") &&
  hero.includes("manualSources = config.loopMode === 'mixed'") &&
  hero.includes(": publishedSources;") &&
  hero.includes("sourceOrigin: 'published-cms'") &&
  !hero.includes("LEGACY_HERO_MP4_FALLBACK") &&
  !hero.includes("source.fallbackSrc || fallbackSrc"),
  "Published CMS Hero placements must take precedence over stale manual JSON entries without inheriting the legacy MP4 fallback.");
const heroMuxSetup = hero.split("if (source.type === 'mux') {")[1]?.split("} else if (source.type === 'video') {")[0] || "";
const heroReducedMotionBranch = heroMuxSetup.split("if (reducedMotion) {")[1]?.split("} else {")[0] || "";
check(hero.includes("sourceOrigin: 'published-cms'") &&
  hero.includes("muxPlaybackError") &&
  !hero.includes("LEGACY_HERO_MP4_FALLBACK") &&
  hero.includes("fallbackMuxToNativeVideo") &&
  heroMuxSetup.includes("documentRef.createElement('mux-video')") &&
  heroMuxSetup.includes("setAttribute('autoplay', '')") &&
  heroMuxSetup.includes("setAttribute('disable-tracking', '')") &&
  hero.includes("if (media.localName !== 'mux-player') media.playsInline = true;") &&
  hero.includes("if (!reducedMotion && sources.some(source => source.type === 'mux'))") &&
  hero.includes("const shouldLoop = slides.length === 1") &&
  hero.includes("if (media.localName === 'mux-video') {") &&
  hero.includes("}, 15000);") &&
  hero.includes("!['mux-player', 'mux-video'].includes(media?.localName)") &&
  heroReducedMotionBranch.includes("documentRef.createElement('video')") &&
  !heroReducedMotionBranch.includes("playback-id") &&
  styles.includes(".hero-banner .slide mux-video"),
  "Hero background video must use UI-free Mux Video, muted autoplay, explicit looping, observable startup diagnostics without implicit legacy-MP4 substitution, and poster-only reduced-motion mode.");
check(footer.includes("documentRef.createElement('mux-video')") &&
  footer.includes("media.setAttribute('autoplay', '')") &&
  footer.includes("media.setAttribute('disable-tracking', '')") &&
  footer.includes("!reducedMotion() && index === 0") &&
  footer.includes("const reduceMotionNow = Boolean(reducedMotion())") &&
  footer.includes("source.type !== 'mux'") &&
  footer.includes("type: 'image', src: poster") &&
  footer.includes("mux-video, mux-player") &&
  styles.includes(".footer-animation-slide mux-video"),
  "Footer background must use UI-free Mux Video with tracking disabled; reduced-motion mode must use poster-only images.");
const footerNativeVideo = footer.split("} else if (source.type === 'video') {")[1]?.split("} else if (source.type === 'lottie') {")[0] || "";
check(footerNativeVideo.includes("media.autoplay = Boolean(autoplayAllowed)") &&
  footerNativeVideo.includes("media.preload = autoplayAllowed ? 'auto' : 'none'") &&
  footer.includes("const previousVideo = previous?.querySelector('video')") &&
  footer.includes("const currentVideo = slides[index]?.querySelector('video')") &&
  footer.includes("currentVideo.play?.()"),
  "Footer native video slides must not autoplay while inactive and must pause/resume only the active slide.");
check(cms.includes('href="videos.html"') &&
  page.includes("mux-uploader") &&
  page.includes("https://cdn.jsdelivr.net/npm/@mux/mux-uploader@1.6.0") &&
  !page.includes("https://cdn.jsdelivr.net/npm/@mux/mux-uploader@1\""),
  "CMS must retain its Mux uploader UI and pin the hosted custom element to an exact release.");
check(script.includes("supabasePublishableKey") && script.includes("saved.supabaseAnonKey") && page.includes('id="supabasePublishableKey"'), "Video Library admin must prefer the modern publishable-key field and migrate per-device legacy settings.");
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
check(script.includes('payload?.code==="mux_api_timeout"') &&
  script.includes('payload?.code==="mux_api_unconfirmed"') &&
  script.includes("refresh the asset state before retrying"),
  "The video CMS must give actionable guidance when a Mux upload outcome is ambiguous.");
const uploadRoute = admin.split('route[4] === "upload") {')[1]?.split('if (request.method === "POST" && route.length === 3 && route[0] === "videos" && route[2] === "unpublish")')[0] || "";
check(uploadRoute.includes("const uploadAttemptId = crypto.randomUUID()") &&
  uploadRoute.includes('.eq("upload_state", currentUploadState)') &&
  uploadRoute.includes('.eq("external_id", String(asset.external_id || asset.id))') &&
  uploadRoute.includes('claimQuery.select("id").maybeSingle()') &&
  uploadRoute.includes('external_id: uploadAttemptId') &&
  uploadRoute.indexOf('claimQuery.select("id").maybeSingle()') < uploadRoute.indexOf('muxRequest("/uploads", "POST"') &&
  uploadRoute.includes('updatedAtMs') &&
  uploadRoute.includes('Date.now() - updatedAtMs > 5 * 60 * 1000') &&
  uploadRoute.includes('current?.mux_upload_id !== upload.id'),
  "Mux upload creation must reserve the asset with compare-and-swap, isolate webhook correlation per attempt, recover stale reservations, and account for fast-webhook races.");
check(uploadRoute.includes("error instanceof MuxApiError && error.status >= 500") &&
  uploadRoute.includes('upload_state: responseUnconfirmed ? "awaiting_upload" : "failed"') &&
  admin.includes('error.status === 504 ? 504 : 502') &&
  admin.includes('"mux_api_unconfirmed"'),
  "Ambiguous Mux failures must retain the upload reservation long enough for webhook recovery instead of immediately duplicating a potentially-created upload.");
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
  read("js/features/lightbox/media-renderer.js").includes("ensureMuxPlayer") &&
  read("js/features/projects/project-card.js").includes("declaredThumbnailType === 'mux' ? 'image'") &&
  read("js/features/footer/index.js").includes("ensureMuxVideo") &&
  hero.includes("manualSources = config.loopMode === 'mixed'") &&
  hero.includes(": publishedSources;"),
  "Mux thumbnails must remain poster-only, project lightboxes must retain interactive Mux Player, and live published Hero placements must be selected for background playback.");
check(bridge.includes("CONFIG_TIMEOUT_MS = 3000") &&
  bridge.includes("FEED_TIMEOUT_MS = 8000") &&
  bridge.includes("fetchJsonWithTimeout") &&
  bridge.includes("Published video feed request failed"),
  "Public config and cross-origin published-feed requests must have separate bounded timeouts and observable failures.");
check(player.includes("timeoutMs = 15000") &&
  player.includes("Promise.race") &&
  player.includes("Keep the import promise alive"),
  "Mux Video loader must allow a realistic startup window without caching a timed-out wait as a permanent failure.");
check(hero.includes("configTimeoutMs: 3000") &&
  hero.includes("timeoutMs: 8000") &&
  hero.includes("startup-timeout") &&
  hero.includes("muxFallbackReason") &&
  hero.includes("Switching to the local MP4 fallback"),
  "Hero must expose selected Mux source/fallback diagnostics and avoid the previous short silent startup fallback.");
check(read("supabase/functions/_shared/http.ts").includes("export class MuxApiError") &&
  read("supabase/functions/_shared/http.ts").includes("throw new MuxApiError(response.status") &&
  admin.includes("instanceof MuxApiError") && admin.includes('code: authFailure ? "mux_auth_failed"'),
  "Mux upstream HTTP status must be preserved and surfaced as a structured admin API error.");
check(script.includes('"mux_auth_failed"') &&
  script.includes("MUX_TOKEN_ID and MUX_TOKEN_SECRET") &&
  script.includes("Mux Video Read permission"),
  "CMS must explain how to resolve rejected Mux API credentials.");
check(
  fs.existsSync("assets/projects/site/banner/hero-reel.mp4") &&
  hero.includes("fallbackMuxToNativeVideo") &&
  !hero.includes("LEGACY_HERO_MP4_FALLBACK"),
  "The legacy MP4 asset must remain available but must not be automatically substituted for the published Mux Hero source."
);
const supabaseUrl = String(config.supabaseUrl || "").trim();
const supabaseKey = String(config.supabasePublishableKey || config.supabaseAnonKey || "").trim();
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
check(smoke.includes("**/data/video-platform.json") && smoke.includes("must not silently become the legacy reel"), "Browser smoke test must stub the hosted video backend and remain deterministic.");
check(!/MUX_TOKEN_SECRET\s*[:=]\s*["'][^"']+["']/.test(admin + webhook + publicApi), "Literal Mux secret appears in code.");
if (errors.length) { console.error("Mux integration contract: FAIL"); errors.forEach((e) => console.error(" - " + e)); process.exit(1); }
console.log("Mux integration contract: PASS");
console.log(" - Database/RLS, Direct Upload, existing asset import and static MP4 registration");
console.log(" - Signed webhook lifecycle and deduplication");
console.log(" - Optional Mux hero with checked-in MP4 fallback");
console.log(" - Video Library link and public-config safety");
