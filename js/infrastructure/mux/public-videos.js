const CONFIG_TIMEOUT_MS = 3000;
const FEED_TIMEOUT_MS = 8000;

async function fetchJsonWithTimeout(fetchImpl, url, init, timeoutMs, setTimer, clearTimer) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimer(() => controller?.abort(), Math.max(300, Number(timeoutMs) || 1000));
  try {
    const response = await fetchImpl(url, {
      ...init,
      ...(controller ? { signal: controller.signal } : {})
    });
    if (!response.ok) return { ok: false, status: response.status, data: null, error: null };
    return { ok: true, status: response.status, data: await response.json(), error: null };
  } catch (error) {
    return { ok: false, status: 0, data: null, error };
  } finally {
    if (typeof clearTimer === "function") clearTimer(timer);
  }
}

function warn(message, detail) {
  if (typeof globalThis.console?.warn !== "function") return;
  if (detail) globalThis.console.warn(message, detail);
  else globalThis.console.warn(message);
}

export async function loadPublicMuxVideos(placement = "hero", options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const resolveUrl = typeof options.resolveUrl === "function" ? options.resolveUrl : (value) => value;
  if (typeof fetchImpl !== "function") return [];

  const setTimer = options.setTimeoutImpl || globalThis.setTimeout;
  const clearTimer = options.clearTimeoutImpl || globalThis.clearTimeout;
  const configTimeoutMs = Math.max(500, Number(options.configTimeoutMs) || CONFIG_TIMEOUT_MS);
  const feedTimeoutMs = Math.max(1000, Number(options.timeoutMs) || FEED_TIMEOUT_MS);

  // Use an independent timer for each request. The public config request and
  // the cross-origin Supabase call must not consume one shared timeout budget:
  // the latter requires a browser CORS preflight before its GET can begin.
  const configResult = await fetchJsonWithTimeout(
    fetchImpl,
    resolveUrl("data/video-platform.json"),
    { cache: "no-cache", credentials: "omit" },
    configTimeoutMs,
    setTimer,
    clearTimer
  );
  if (!configResult.ok) {
    warn("[Hero Mux] Could not load data/video-platform.json.", {
      status: configResult.status || null,
      reason: configResult.error?.name || configResult.error?.message || null
    });
    return [];
  }

  const config = configResult.data;
  const base = String(config?.supabaseUrl || "").trim().replace(/\/+$/, "");
  const key = String(config?.supabasePublishableKey || config?.supabaseAnonKey || "").trim();
  if (!base || !key) return [];

  const feedResult = await fetchJsonWithTimeout(
    fetchImpl,
    base + "/functions/v1/mux-public?placement=" + encodeURIComponent(placement),
    { headers: { apikey: key }, cache: "no-store", credentials: "omit" },
    feedTimeoutMs,
    setTimer,
    clearTimer
  );
  if (!feedResult.ok) {
    warn("[Hero Mux] Published video feed request failed; keeping the configured Hero list as fallback.", {
      status: feedResult.status || null,
      reason: feedResult.error?.name || feedResult.error?.message || null
    });
    return [];
  }

  const payload = feedResult.data;
  if (!Array.isArray(payload?.videos)) {
    warn("[Hero Mux] Published video feed response did not contain a videos array.");
    return [];
  }

  const videos = payload.videos.map((item) => {
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

  if (payload.videos.length && !videos.length) {
    warn("[Hero Mux] Published Hero feed contained no supported playable sources.");
  }
  return videos;
}
