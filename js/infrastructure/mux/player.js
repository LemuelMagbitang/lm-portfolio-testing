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
export async function ensureMuxVideo(importer, timeoutMs = 6000) {
  if (typeof globalThis.customElements === "undefined") return false;
  if (globalThis.customElements.get("mux-video")) return true;
  if (!muxVideoLoaderPromise) {
    const load = typeof importer === "function"
      ? importer
      : () => import("https://cdn.jsdelivr.net/npm/@mux/mux-video@0.31.5/dist/mux-video.mjs");
    muxVideoLoaderPromise = new Promise(resolve => {
      let settled = false;
      let timer = null;
      const finish = value => {
        if (settled) return;
        settled = true;
        if (timer !== null) globalThis.clearTimeout(timer);
        resolve(Boolean(value));
      };
      timer = globalThis.setTimeout(() => finish(false), Math.max(500, Number(timeoutMs) || 6000));
      Promise.resolve().then(load)
        .then(() => finish(Boolean(globalThis.customElements.get("mux-video"))))
        .catch(() => finish(false));
    }).catch(() => false);
  }
  return muxVideoLoaderPromise;
}
