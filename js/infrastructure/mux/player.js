let loaderPromise = null;
export async function ensureMuxPlayer(importer) {
  if (typeof globalThis.customElements === "undefined") return false;
  if (globalThis.customElements.get("mux-player")) return true;
  if (!loaderPromise) {
    const load = typeof importer === "function" ? importer : () => import("https://cdn.jsdelivr.net/npm/@mux/mux-player@3/+esm");
    loaderPromise = Promise.resolve().then(load).then(() => Boolean(globalThis.customElements.get("mux-player"))).catch(() => false);
  }
  return loaderPromise;
}

let muxVideoLoaderPromise = null;
export async function ensureMuxVideo(importer, timeoutMs = 15000) {
  if (typeof globalThis.customElements === "undefined") return false;
  if (globalThis.customElements.get("mux-video")) return true;
  if (!muxVideoLoaderPromise) {
    const load = typeof importer === "function"
      ? importer
      : () => import("https://cdn.jsdelivr.net/npm/@mux/mux-video@0.31.5/dist/mux-video.mjs");
    // Keep the import promise alive if a caller's bounded wait expires. A slow
    // module graph may still register mux-video later, and subsequent callers
    // should be able to observe that registration instead of inheriting a
    // permanently cached timeout=false result.
    muxVideoLoaderPromise = Promise.resolve()
      .then(load)
      .then(() => Boolean(globalThis.customElements.get("mux-video")))
      .catch(() => false);
  }

  let timer = null;
  const waitForModule = new Promise(resolve => {
    timer = globalThis.setTimeout(
      () => resolve(false),
      Math.max(1000, Number(timeoutMs) || 15000)
    );
  });
  try {
    const ready = await Promise.race([muxVideoLoaderPromise, waitForModule]);
    return Boolean(ready || globalThis.customElements.get("mux-video"));
  } finally {
    if (timer !== null) globalThis.clearTimeout(timer);
  }
}
