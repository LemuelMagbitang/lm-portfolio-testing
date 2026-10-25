import { authorizeAdmin, corsHeaders, isSafePublicMp4Reference, jsonResponse, MuxApiError, muxRequest, safeSlug, safeText } from "../_shared/http.ts";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const fields = ["message", "details", "hint", "code"];
    const parts = fields.map((key) => record[key])
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (parts.length) return parts.join(" | ");
  }
  return "Unexpected video CMS error.";
}
function placement(value: unknown): string | null {
  const item = String(value || "project").trim().toLowerCase();
  return ["hero", "project", "background", "footer", "other"].includes(item) ? item : null;
}

// Mux returns created_at as Unix seconds (often a numeric string), whereas
// Postgres timestamptz expects an ISO timestamp or another parseable date.
function muxTimestampToIso(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return new Date().toISOString();
  const numeric = Number(raw);
  const millis = Number.isFinite(numeric)
    ? (Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric)
    : Date.parse(raw);
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  try {
    const auth = await authorizeAdmin(request);
    if (!auth.ok) return jsonResponse(request, { error: auth.error }, auth.status);
    const db = auth.db;
    const parts = new URL(request.url).pathname.split("/").filter(Boolean);
    const at = parts.indexOf("mux-admin");
    const route = parts.slice(at >= 0 ? at + 1 : 0);
    const body = request.method === "GET" ? {} : await request.json().catch(() => ({}));

    if (request.method === "GET" && route.length === 1 && route[0] === "videos") {
      const { data: videos, error: ve } = await db.from("videos").select("*").order("created_at", { ascending: false });
      if (ve) throw ve;
      const ids = (videos || []).map((v: any) => v.id);
      const { data: assets, error: ae } = ids.length ? await db.from("video_assets").select("*").in("video_id", ids).order("created_at", { ascending: false }) : { data: [], error: null };
      if (ae) throw ae;
      return jsonResponse(request, { videos: (videos || []).map((v: any) => {
        const versions = (assets || []).filter((a: any) => a.video_id === v.id);
        return { ...v, assets: versions, activeAsset: versions.find((a: any) => a.id === v.active_asset_id) || null };
      })});
    }

    if (request.method === "POST" && route.length === 1 && route[0] === "videos") {
      const title = safeText(body.title);
      const slug = safeSlug(body.slug);
      const place = placement(body.placement);
      if (!title || !slug || !place) return jsonResponse(request, { error: "Provide title, lowercase slug and placement." }, 400);
      const videoId = crypto.randomUUID();
      const assetId = crypto.randomUUID();
      const { data: video, error: ve } = await db.from("videos").insert({
        id: videoId, title, slug, placement: place, description: safeText(body.description, 2000), published: false, created_by: auth.user.id
      }).select("*").single();
      if (ve) throw new Error("Mux returned the asset, but inserting the CMS video row failed: " + errorMessage(ve));
      const { data: asset, error: ae } = await db.from("video_assets").insert({
        id: assetId, video_id: videoId, provider: "mux", external_id: assetId, upload_state: "not_started"
      }).select("*").single();
      if (ae) {
        const cleanup = await db.from("videos").delete().eq("id", videoId);
        throw new Error("The CMS video row was created, but inserting the Mux asset row failed: " + errorMessage(ae) +
          (cleanup.error ? " | Video-row cleanup also failed: " + errorMessage(cleanup.error) : ""));
      }
      return jsonResponse(request, { video, asset }, 201);
    }

    if (request.method === "POST" && route.length === 2 && route[0] === "videos" && route[1] === "import-mux") {
      const muxAssetId = safeText(body.muxAssetId, 255);
      const slug = safeSlug(body.slug);
      const place = placement(body.placement);
      if (!muxAssetId || !slug || !place) return jsonResponse(request, { error: "Provide Mux asset ID, lowercase slug and placement." }, 400);
      const { data: existing, error: existingError } = await db.from("video_assets").select("id,video_id").eq("mux_asset_id", muxAssetId).maybeSingle();
      if (existingError) throw new Error("Import failed while checking for an existing asset in video_assets: " + errorMessage(existingError));
      if (existing) return jsonResponse(request, { error: "This asset is already linked to a CMS video.", videoId: existing.video_id }, 409);
      const remote = await muxRequest("/assets/" + encodeURIComponent(muxAssetId));
      const videoId = crypto.randomUUID();
      const assetId = crypto.randomUUID();
      const playbackIds = Array.isArray(remote?.playback_ids) ? remote.playback_ids : [];
      const playback = playbackIds.find((p: any) => p.policy === "public") || playbackIds[0] || null;
      const { data: video, error: ve } = await db.from("videos").insert({
        id: videoId, title: safeText(body.title) || safeText(remote?.meta?.title) || "Imported Mux video",
        slug, placement: place, published: false, created_by: auth.user.id
      }).select("*").single();
      if (ve) throw ve;
      const { data: asset, error: ae } = await db.from("video_assets").insert({
        id: assetId, video_id: videoId, provider: "mux",
        external_id: safeText(remote?.meta?.external_id, 128) || assetId,
        mux_upload_id: remote?.upload_id || null, mux_asset_id: remote?.id || muxAssetId,
        mux_playback_id: playback?.id || null, playback_policy: playback?.policy || null,
        upload_state: "uploaded", asset_status: remote?.status || "preparing",
        processing_state: remote?.progress?.state || null, duration_seconds: remote?.duration ?? null,
        aspect_ratio: remote?.aspect_ratio || null, resolution_tier: remote?.resolution_tier || null,
        uploaded_at: muxTimestampToIso(remote?.created_at),
        last_error: remote?.errors ? JSON.stringify(remote.errors) : null
      }).select("*").single();
      if (ae) { await db.from("videos").delete().eq("id", videoId); throw ae; }
      return jsonResponse(request, { video, asset }, 201);
    }

    if (request.method === "POST" && route.length === 2 && route[0] === "videos" && route[1] === "import-static") {
      const title = safeText(body.title);
      const slug = safeSlug(body.slug);
      const place = placement(body.placement);
      const source = safeText(body.sourceUrl, 2048);
      if (!title || !slug || !place || !source) return jsonResponse(request, { error: "Provide title, slug, placement and source URL/path." }, 400);
      if (!isSafePublicMp4Reference(source) || !/\.mp4(?:[?#].*)?$/i.test(source)) return jsonResponse(request, { error: "Use an HTTPS MP4 or safe site-relative MP4 path; blob/data URLs and parent paths are disallowed." }, 400);
      const videoId = crypto.randomUUID();
      const assetId = crypto.randomUUID();
      const { data: video, error: ve } = await db.from("videos").insert({ id: videoId, title, slug, placement: place, published: false, created_by: auth.user.id }).select("*").single();
      if (ve) throw ve;
      const { data: asset, error: ae } = await db.from("video_assets").insert({
        id: assetId, video_id: videoId, provider: "static_mp4", external_id: assetId,
        source_url: source, original_filename: source.split("/").pop()?.split("?")[0] || null,
        upload_state: "uploaded", asset_status: "ready", processing_state: "completed"
      }).select("*").single();
      if (ae) { await db.from("videos").delete().eq("id", videoId); throw ae; }
      return jsonResponse(request, { video, asset }, 201);
    }

    if (request.method === "POST" && route.length === 3 && route[0] === "videos" && route[2] === "assets") {
      const videoId = route[1];
      const { data: video, error } = await db.from("videos").select("id").eq("id", videoId).maybeSingle();
      if (error) throw error;
      if (!video) return jsonResponse(request, { error: "Video record not found." }, 404);
      const assetId = crypto.randomUUID();
      const { data: asset, error: ie } = await db.from("video_assets").insert({ id: assetId, video_id: videoId, provider: "mux", external_id: assetId, upload_state: "not_started" }).select("*").single();
      if (ie) throw ie;
      return jsonResponse(request, { asset }, 201);
    }

    if (request.method === "POST" && route.length === 5 && route[0] === "videos" && route[2] === "assets" && route[4] === "upload") {
      const videoId = route[1];
      const assetId = route[3];
      const { data: video, error: ve } = await db.from("videos").select("*").eq("id", videoId).maybeSingle();
      if (ve) throw ve;
      if (!video) return jsonResponse(request, { error: "Video record not found." }, 404);
      const { data: asset, error: ae } = await db.from("video_assets").select("*").eq("id", assetId).eq("video_id", videoId).maybeSingle();
      if (ae) throw ae;
      if (!asset) return jsonResponse(request, { error: "Asset version not found." }, 404);
      if (asset.provider !== "mux") return jsonResponse(request, { error: "Only Mux assets can be uploaded through this route." }, 409);
      if (asset.mux_asset_id && asset.asset_status === "ready") return jsonResponse(request, { error: "Already ready; create a new version to replace it." }, 409);
      if (asset.mux_upload_id && ["awaiting_upload", "uploaded"].includes(asset.upload_state)) return jsonResponse(request, { error: "An upload has already been created for this version. Create a fresh version before retrying." }, 409);
      const origin = Deno.env.get("MUX_UPLOAD_CORS_ORIGIN");
      if (!origin) throw new Error("MUX_UPLOAD_CORS_ORIGIN is not configured.");
      const upload = await muxRequest("/uploads", "POST", {
        cors_origin: new URL(origin).origin,
        timeout: 3600,
        new_asset_settings: {
          playback_policies: ["public"], video_quality: "basic",
          meta: { title: video.title, creator_id: Deno.env.get("MUX_CREATOR_ID") || "lemuel-magbitang", external_id: asset.external_id || asset.id }
        }
      });
      const { error: ue } = await db.from("video_assets").update({
        mux_upload_id: upload.id, upload_state: "awaiting_upload", asset_status: null,
        processing_state: null, mux_asset_id: null, mux_playback_id: null, playback_policy: null, uploaded_at: null, last_error: null
      }).eq("id", assetId);
      if (ue) throw ue;
      return jsonResponse(request, { uploadId: upload.id, uploadUrl: upload.url, timeout: upload.timeout }, 201);
    }

    if (request.method === "POST" && route.length === 3 && route[0] === "videos" && route[2] === "publish") {
      const assetId = safeText(body.assetId, 128);
      const { data: asset, error: ae } = await db.from("video_assets").select("*").eq("id", assetId).eq("video_id", route[1]).maybeSingle();
      if (ae) throw ae;
      if (!asset || asset.asset_status !== "ready") return jsonResponse(request, { error: "Only a ready asset can be published." }, 409);
      if (asset.provider === "mux" && (!asset.mux_playback_id || asset.playback_policy !== "public")) return jsonResponse(request, { error: "Public website needs a public playback ID." }, 409);
      if (asset.provider === "static_mp4" && !asset.source_url) return jsonResponse(request, { error: "Static MP4 URL is missing." }, 409);
      const { data: video, error } = await db.from("videos").update({ active_asset_id: asset.id, published: true }).eq("id", route[1]).select("*").single();
      if (error) throw error;
      return jsonResponse(request, { video, asset });
    }
    return jsonResponse(request, { error: "Video CMS route not found." }, 404);
  } catch (error) {
    if (error instanceof MuxApiError) {
      const authFailure = error.status === 401 || error.status === 403;
      const assetNotFound = error.status === 404;
      return jsonResponse(request, {
        error: authFailure ? "Mux rejected the server API credentials." : assetNotFound ? "Mux could not find the requested asset." : "Mux API request failed.",
        code: authFailure ? "mux_auth_failed" : assetNotFound ? "mux_asset_not_found" : "mux_api_error",
        upstreamStatus: error.status,
        detail: error.message
      }, 502);
    }
    return jsonResponse(request, { error: errorMessage(error) }, 500);
  }
});
