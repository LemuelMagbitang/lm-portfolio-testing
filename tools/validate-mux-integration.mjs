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
check(migration.includes("create table if not exists public.videos") && migration.includes("create table if not exists public.video_assets"), "Video tables missing.");
check(migration.includes("mux_webhook_events") && migration.includes("enable row level security") && migration.includes("revoke all on public.video_assets from anon, authenticated"), "Webhook store or RLS boundary missing.");
check(migration.includes("mux_asset_id text unique") && migration.includes("mux_upload_id text unique"), "Mux asset and upload IDs must be unique.");
check(admin.includes("external_id: asset.external_id || asset.id") && read("supabase/functions/_shared/http.ts").includes("CMS_ADMIN_USER_IDS"), "Admin auth or external_id assignment missing.");
check(admin.includes("MUX_UPLOAD_CORS_ORIGIN") && admin.includes("import-mux") && admin.includes("import-static"), "CORS settings or existing asset import route missing.");
check(webhook.includes("mux-signature") && webhook.includes("crypto.subtle.sign") && webhook.includes("video.asset.ready"), "Webhook signature or lifecycle processing missing.");
check(webhook.includes("video.upload.asset_created") && webhook.includes("video.asset.errored") && webhook.includes("video.asset.deleted") && webhook.includes("processed_at"), "Webhook lifecycle/idempotency incomplete.");
check(webhook.includes("async function unpublishActiveAssets") &&
  webhook.includes("await unpublishActiveAssets(db, affectedAssets.map((item: any) => item.id))") &&
  webhook.includes("await unpublishActiveAssets(db, [asset.id])"),
  "Errored and deleted active assets must be unpublished with checked database updates.");
check(webhook.includes('.or("asset_status.is.null,asset_status.eq.preparing,asset_status.eq.ready")') &&
  webhook.includes('.or("asset_status.is.null,asset_status.eq.preparing")'),
  "Upload-created webhook must preserve ready/failed/deleted states when events arrive out of order.");
check(publicApi.includes('eq("published", true)') && publicApi.includes('asset.playback_policy !== "public"'), "Public feed must restrict published/public-playback assets.");
check(bridge.includes("data/video-platform.json") && bridge.includes("/functions/v1/mux-public"), "Public client bridge missing.");
check(player.includes("@mux/mux-player@3/+esm") && player.includes('customElements.get("mux-player")'), "Mux Player loading check missing.");
check(hero.includes("loadPublicMuxVideos") && hero.includes("ensureMuxPlayer") && hero.includes("mux-player"), "Hero source adapter missing.");
check(cms.includes('href="videos.html"') && page.includes("mux-uploader"), "CMS link or Mux Uploader UI missing.");
check(script.includes("videos/import-mux") && script.includes("videos/import-static"), "CMS import flows missing.");
check(Array.isArray(heroLoop) && heroLoop.some((item) => item.type === "video" && item.src), "Legacy MP4 fallback must remain.");
check(config.supabaseUrl === "" && config.supabaseAnonKey === "", "Public config must remain blank until provisioned.");
check(workflow.includes("validate-mux-integration.mjs"), "CI validator is not configured.");
check(!/MUX_TOKEN_SECRET\s*[:=]\s*["'][^"']+["']/.test(admin + webhook + publicApi), "Literal Mux secret appears in code.");
if (errors.length) { console.error("Mux integration contract: FAIL"); errors.forEach((e) => console.error(" - " + e)); process.exit(1); }
console.log("Mux integration contract: PASS");
console.log(" - Database/RLS, Direct Upload, existing asset import and static MP4 registration");
console.log(" - Signed webhook lifecycle and deduplication");
console.log(" - Optional Mux hero with checked-in MP4 fallback");
console.log(" - Video Library link and public-config safety");
