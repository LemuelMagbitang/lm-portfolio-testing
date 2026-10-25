import { jsonResponse, serviceDb } from "../_shared/http.ts";
function posterFor(asset: any): string | null {
  if (asset.thumbnail_url) return String(asset.thumbnail_url);
  if (asset.provider !== "mux" || !asset.mux_playback_id || asset.playback_policy !== "public") return null;
  const url = new URL("https://image.mux.com/" + encodeURIComponent(asset.mux_playback_id) + "/thumbnail.jpg");
  url.searchParams.set("time", String(Math.max(0, Number(asset.poster_time_seconds) || 1.5)));
  url.searchParams.set("width", "1600");
  return url.toString();
}
Deno.serve(async (request: Request) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "apikey, content-type", "Access-Control-Allow-Methods": "GET, OPTIONS" };
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "GET") return jsonResponse(request, { error: "Method not allowed." }, 405, true);
  try {
    const place = new URL(request.url).searchParams.get("placement");
    const db = serviceDb();
    let query = db.from("videos").select("*").eq("published", true).order("sort_order", { ascending: true });
    if (place) query = query.eq("placement", place);
    const { data: videos, error: ve } = await query;
    if (ve) throw ve;
    const ids = (videos || []).map((v: any) => v.active_asset_id).filter(Boolean);
    const { data: assets, error: ae } = ids.length ? await db.from("video_assets").select("*").in("id", ids) : { data: [], error: null };
    if (ae) throw ae;
    const list = (videos || []).map((video: any) => {
      const asset = (assets || []).find((a: any) => a.id === video.active_asset_id);
      if (!asset || asset.asset_status !== "ready") return null;
      if (asset.provider === "mux") {
        if (!asset.mux_playback_id || asset.playback_policy !== "public") return null;
        return { id: video.id, slug: video.slug, title: video.title, description: video.description, placement: video.placement,
          provider: "mux", type: "mux", playbackId: asset.mux_playback_id, playbackPolicy: asset.playback_policy,
          posterUrl: posterFor(asset), posterTimeSeconds: asset.poster_time_seconds, durationSeconds: asset.duration_seconds, aspectRatio: asset.aspect_ratio,
          resolutionTier: asset.resolution_tier || null };
      }
      if (asset.provider === "static_mp4" && asset.source_url) return {
        id: video.id, slug: video.slug, title: video.title, description: video.description, placement: video.placement,
        provider: "static_mp4", type: "video", src: asset.source_url, posterUrl: posterFor(asset),
        durationSeconds: asset.duration_seconds, aspectRatio: asset.aspect_ratio
      };
      return null;
    }).filter(Boolean);
    return new Response(JSON.stringify({ videos: list }), { status: 200, headers: {
      ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=30"
    }});
  } catch (_) { return jsonResponse(request, { error: "Public video feed is temporarily unavailable." }, 500, true); }
});
