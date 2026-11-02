import { corsHeaders as supabaseCorsHeaders } from "npm:@supabase/supabase-js@2.118.0/cors";
import { serviceDb } from "../_shared/http.ts";

const sdkAllowedHeaders = String(
  supabaseCorsHeaders["Access-Control-Allow-Headers"] ||
  "authorization, x-client-info, apikey, content-type"
);
const publicAllowedHeaders = new Set(
  sdkAllowedHeaders.split(",").map((header) => header.trim().toLowerCase()).filter(Boolean)
);
for (const header of ["cache-control", "pragma", "x-supabase-api-version"]) {
  publicAllowedHeaders.add(header);
}

const PUBLIC_CORS_HEADERS = {
  ...supabaseCorsHeaders,
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": [...publicAllowedHeaders].join(", "),
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin, Access-Control-Request-Headers"
};

function jsonResponse(body: unknown, status = 200, cacheControl = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...PUBLIC_CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl
    }
  });
}

function posterFor(asset: any): string | null {
  if (asset.thumbnail_url) return String(asset.thumbnail_url);
  if (asset.provider !== "mux" || !asset.mux_playback_id || asset.playback_policy !== "public") return null;
  const url = new URL("https://image.mux.com/" + encodeURIComponent(asset.mux_playback_id) + "/thumbnail.jpg");
  url.searchParams.set("time", String(Math.max(0, Number(asset.poster_time_seconds) || 1.5)));
  url.searchParams.set("width", "1600");
  return url.toString();
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    const requestedHeaders = String(
      request.headers.get("access-control-request-headers") || ""
    ).split(",").map((header) => header.trim().toLowerCase()).filter(Boolean);
    const unexpectedHeaders = requestedHeaders.filter((header) => !publicAllowedHeaders.has(header));
    if (unexpectedHeaders.length) {
      console.warn("[Mux Public] CORS preflight requested headers outside the allow-list.", {
        origin: request.headers.get("origin") || null,
        unexpectedHeaders
      });
    }
    return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
  }
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const place = new URL(request.url).searchParams.get("placement");
    const db = serviceDb();
    let query = db.from("videos")
      .select("id, slug, title, description, placement, active_asset_id, sort_order")
      .eq("published", true)
      .not("active_asset_id", "is", null)
      .order("sort_order", { ascending: true });
    if (place) query = query.eq("placement", place);

    const { data: videos, error: ve } = await query;
    if (ve) throw ve;

    const ids = (videos || []).map((video: any) => video.active_asset_id).filter(Boolean);
    const { data: assets, error: ae } = ids.length
      ? await db.from("video_assets")
        .select("id, provider, source_url, asset_status, mux_playback_id, playback_policy, thumbnail_url, poster_time_seconds, duration_seconds, aspect_ratio, resolution_tier")
        .in("id", ids)
      : { data: [], error: null };
    if (ae) throw ae;

    const assetsById = new Map((assets || []).map((asset: any) => [asset.id, asset]));
    const list = (videos || []).map((video: any) => {
      const asset = assetsById.get(video.active_asset_id);
      if (!asset || asset.asset_status !== "ready") return null;
      if (asset.provider === "mux") {
        if (!asset.mux_playback_id || asset.playback_policy !== "public") return null;
        return {
          id: video.id,
          slug: video.slug,
          title: video.title,
          description: video.description,
          placement: video.placement,
          provider: "mux",
          type: "mux",
          playbackId: asset.mux_playback_id,
          playbackPolicy: asset.playback_policy,
          posterUrl: posterFor(asset),
          posterTimeSeconds: asset.poster_time_seconds,
          durationSeconds: asset.duration_seconds,
          aspectRatio: asset.aspect_ratio,
          resolutionTier: asset.resolution_tier || null
        };
      }
      if (asset.provider === "static_mp4" && asset.source_url) {
        return {
          id: video.id,
          slug: video.slug,
          title: video.title,
          description: video.description,
          placement: video.placement,
          provider: "static_mp4",
          type: "video",
          src: asset.source_url,
          posterUrl: posterFor(asset),
          durationSeconds: asset.duration_seconds,
          aspectRatio: asset.aspect_ratio
        };
      }
      return null;
    }).filter(Boolean);

    return jsonResponse({ videos: list }, 200, "public, max-age=30");
  } catch (error) {
    console.error("[Mux Public] Published feed query failed.", {
      reason: error instanceof Error ? error.name : "UnknownError"
    });
    return jsonResponse({ error: "Public video feed is temporarily unavailable." }, 500);
  }
});
