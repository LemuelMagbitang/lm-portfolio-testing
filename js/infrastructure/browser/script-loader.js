/*
 * LM. Infrastructure — browser script loader
 *
 * Owns the browser-specific mechanics for loading optional runtime scripts.
 * Feature/core code should depend on the capability, not on document APIs.
 */

const loadedScripts = new Map();
const SCRIPT_LOAD_TIMEOUT_MS = 8000;

export function loadScriptOnce(
  src,
  test = () => true,
  documentRef = globalThis.document,
  timeoutMs = SCRIPT_LOAD_TIMEOUT_MS
) {
  const url = String(src || '');
  if (!url) return Promise.resolve(false);
  if (test()) return Promise.resolve(true);
  if (!documentRef) return Promise.resolve(false);
  if (loadedScripts.has(url)) return loadedScripts.get(url);

  const promise = new Promise(resolve => {
    let settled = false;
    let timer = null;

    const finish = value => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        (documentRef.defaultView || globalThis).clearTimeout?.(timer);
      }
      resolve(value);
    };

    const boundedTimeout = Math.max(1000, Number(timeoutMs) || SCRIPT_LOAD_TIMEOUT_MS);
    const timeout = () => finish(test());

    const existing = Array.from(documentRef.scripts || [])
      .find(node => node.dataset.lmRuntimeSrc === url);

    if (existing) {
      if (test()) {
        finish(true);
        return;
      }

      existing.addEventListener('load', () => finish(test()), { once: true });
      existing.addEventListener('error', () => finish(false), { once: true });
      timer = (documentRef.defaultView || globalThis).setTimeout?.(timeout, boundedTimeout) ?? null;
      return;
    }

    const script = documentRef.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.lmRuntimeSrc = url;
    script.onload = () => finish(test());
    script.onerror = () => finish(false);
    timer = (documentRef.defaultView || globalThis).setTimeout?.(timeout, boundedTimeout) ?? null;
    documentRef.head.appendChild(script);
  });

  loadedScripts.set(url, promise);
  return promise;
}
