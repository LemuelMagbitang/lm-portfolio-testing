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
const page = read("admin/videos.html"), script = read("admin/videos.js"), cms = read("admin/index.html");
const workflow = read(".github/workflows/site-validation.yml");
const supabaseConfig = read("supabase/config.toml");
check(migration.includes("create table if not exists public.videos") && migration.includes("create table if not exists public.video_assets"), "Video tables missing.");
check(["mux-admin", "mux-webhook", "mux-public"].every((name) =>
  new RegExp("\\[functions\." + name + "\\]\\s*\\nverify_jwt\\s*=\\s*false").test(supabaseConfig)
), "Supabase Edge Function JWT overrides must match each function's own auth model.");
check(migration.includes("mux_webhook_events") && migration.includes("enable row level security") && migration.includes("revoke all on public.video_assets from anon, authenticated"), "Webhook store or RLS boundary missing.");
check(migration.includes("mux_asset_id text unique") && migration.includes("mux_upload_id text unique"), "Mux asset and upload IDs must be unique.");
check(admin.includes("external_id: asset.external_id || asset.id") && read("supabase/functions/_shared/http.ts").includes("CMS_ADMIN_USER_IDS"), "Admin auth or external_id assignment missing.");
check(admin.includes("MUX_UPLOAD_CORS_ORIGIN") && admin.includes("import-mux") && admin.includes("import-static"), "CORS settings or existing asset import route missing.");
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
check(cms.includes('href="videos.html"') && page.includes("mux-uploader"), "CMS link or Mux Uploader UI missing.");
check(script.includes("videos/import-mux") && script.includes("videos/import-static"), "CMS import flows missing.");
check(Array.isArray(heroLoop) && heroLoop.some((item) => item.type === "video" && item.src), "Legacy MP4 fallback must remain.");
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
check(!/MUX_TOKEN_SECRET\s*[:=]\s*["'][^"']+["']/.test(admin + webhook + publicApi), "Literal Mux secret appears in code.");
if (errors.length) { console.error("Mux integration contract: FAIL"); errors.forEach((e) => console.error(" - " + e)); process.exit(1); }
console.log("Mux integration contract: PASS");
console.log(" - Database/RLS, Direct Upload, existing asset import and static MP4 registration");
console.log(" - Signed webhook lifecycle and deduplication");
console.log(" - Optional Mux hero with checked-in MP4 fallback");
console.log(" - Video Library link and public-config safety");
