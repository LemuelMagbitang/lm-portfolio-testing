const TIMEOUT_MS = 1400;
export async function loadPublicMuxVideos(placement = "hero", options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const resolveUrl = typeof options.resolveUrl === "function" ? options.resolveUrl : (value) => value;
  if (typeof fetchImpl !== "function") return [];
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const setTimer = options.setTimeoutImpl || globalThis.setTimeout;
  const clearTimer = options.clearTimeoutImpl || globalThis.clearTimeout;
  const timer = setTimer(() => controller?.abort(), Math.max(300, Number(options.timeoutMs) || TIMEOUT_MS));
  try {
    const configResponse = await fetchImpl(resolveUrl("data/video-platform.json"), { cache: "no-cache", credentials: "omit", signal: controller?.signal });
    if (!configResponse.ok) return [];
    const config = await configResponse.json();
    const base = String(config?.supabaseUrl || "").trim().replace(/\/+$/, "");
    const key = String(config?.supabaseAnonKey || "").trim();
    if (!base || !key) return [];
    const response = await fetchImpl(base + "/functions/v1/mux-public?placement=" + encodeURIComponent(placement), {
      headers: { apikey: key }, cache: "no-store", credentials: "omit", signal: controller?.signal
    });
    if (!response.ok) return [];
    const payload = await response.json();
    if (!Array.isArray(payload?.videos)) return [];
    return payload.videos.map((item) => {
      if (item?.provider === "mux" && String(item.playbackId || "").trim()) return {
        type: "mux", playbackId: String(item.playbackId).trim(), src: "", poster: String(item.posterUrl || ""),
        alt: String(item.title || "Portfolio hero reel"), fadeInMs: 1500, fadeOutMs: 2000, zoomTransition: false, fadeTransition: true
      };
      if (item?.provider === "static_mp4" && String(item.src || "").trim()) return {
        type: "video", src: String(item.src).trim(), poster: String(item.posterUrl || ""), alt: String(item.title || "Portfolio video"),
        fadeInMs: 1500, fadeOutMs: 2000, zoomTransition: false, fadeTransition: true
      };
      return null;
    }).filter(Boolean);
  } catch (_) { return []; }
  finally { if (typeof clearTimer === "function") clearTimer(timer); }
}
