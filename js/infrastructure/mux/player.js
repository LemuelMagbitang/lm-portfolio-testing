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
