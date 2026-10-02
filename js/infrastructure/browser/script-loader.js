/*
 * LM. Infrastructure — browser script loader
 *
 * Owns the browser-specific mechanics for loading optional runtime scripts.
 * Feature/core code should depend on the capability, not on document APIs.
 */

const loadedScripts = new Map();

export function loadScriptOnce(src, test = () => true, documentRef = globalThis.document) {
  const url = String(src || '');
  if (!url) return Promise.resolve(false);
  if (test()) return Promise.resolve(true);
  if (!documentRef) return Promise.resolve(false);
  if (loadedScripts.has(url)) return loadedScripts.get(url);

  const promise = new Promise(resolve => {
    const existing = Array.from(documentRef.scripts || [])
      .find(node => node.dataset.lmRuntimeSrc === url);

    if (existing) {
      if (test()) {
        resolve(true);
        return;
      }

      existing.addEventListener('load', () => resolve(test()), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }

    const script = documentRef.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.lmRuntimeSrc = url;
    script.onload = () => resolve(test());
    script.onerror = () => resolve(false);
    documentRef.head.appendChild(script);
  });

  loadedScripts.set(url, promise);
  return promise;
}
