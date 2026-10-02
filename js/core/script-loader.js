/*
 * LM. Core — external/local script loader
 *
 * Provides one idempotent loader for optional browser integrations. Core code
 * knows how to load a script; integrations decide which script they need.
 */

const loadedScripts = new Map();

export function loadScriptOnce(src, test = () => true) {
  const url = String(src || '');
  if (!url) return Promise.resolve(false);
  if (test()) return Promise.resolve(true);
  if (loadedScripts.has(url)) return loadedScripts.get(url);

  const promise = new Promise(resolve => {
    const existing = Array.from(document.scripts || [])
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

    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.lmRuntimeSrc = url;
    script.onload = () => resolve(test());
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  loadedScripts.set(url, promise);
  return promise;
}
