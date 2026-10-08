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
    let observedScript = null;
    let ownsScript = false;
    let removeListeners = () => {};

    const finish = value => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        (documentRef.defaultView || globalThis).clearTimeout?.(timer);
      }
      removeListeners();
      if (!value && ownsScript && observedScript?.parentNode) {
        observedScript.remove();
      }
      resolve(value);
    };

    const boundedTimeout = Math.max(1000, Number(timeoutMs) || SCRIPT_LOAD_TIMEOUT_MS);
    const onLoad = () => finish(test());
    const onError = () => finish(false);

    const observeScript = (script, owned) => {
      observedScript = script;
      ownsScript = owned;
      script.addEventListener('load', onLoad, { once: true });
      script.addEventListener('error', onError, { once: true });
      removeListeners = () => {
        script.removeEventListener?.('load', onLoad);
        script.removeEventListener?.('error', onError);
      };
      timer = (documentRef.defaultView || globalThis).setTimeout?.(
        () => finish(test()),
        boundedTimeout
      ) ?? null;
    };

    const existing = Array.from(documentRef.scripts || [])
      .find(node => node.dataset.lmRuntimeSrc === url);

    if (existing) {
      if (test()) {
        finish(true);
        return;
      }
      observeScript(existing, existing.dataset.lmRuntimeManaged === 'true');
      return;
    }

    const script = documentRef.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.lmRuntimeSrc = url;
    script.dataset.lmRuntimeManaged = 'true';
    observeScript(script, true);
    documentRef.head.appendChild(script);
  });

  loadedScripts.set(url, promise);

  // Cache only live/successful loads. A transient network/CDN failure must
  // never poison later capability requests for the lifetime of the page.
  void promise.then(result => {
    if (!result && loadedScripts.get(url) === promise) {
      loadedScripts.delete(url);
    }
  });

  return promise;
}
