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
export async function ensureMuxVideo(importer) {
  if (typeof globalThis.customElements === "undefined") return false;
  if (globalThis.customElements.get("mux-video")) return true;
  if (!muxVideoLoaderPromise) {
    const load = typeof importer === "function" ? importer : () => import("https://cdn.jsdelivr.net/npm/@mux/mux-video@0.31.5/+esm");
    muxVideoLoaderPromise = Promise.resolve().then(load).then(() => Boolean(globalThis.customElements.get("mux-video"))).catch(() => false);
  }
  return muxVideoLoaderPromise;
}
