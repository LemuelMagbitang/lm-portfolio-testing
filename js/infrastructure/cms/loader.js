/**
 * LM. Infrastructure — CMS transport
 *
 * Owns browser/network mechanics for retrieving public CMS JSON. The data
 * layer is responsible for normalizing the returned content; it should not
 * need to know how the HTTP request is performed.
 */

const DEFAULT_TIMEOUT_MS = 8000;

export function resolveCmsUrl(url, resolveUrl) {
  if (!url) return '';
  return typeof resolveUrl === 'function' ? resolveUrl(url) : String(url);
}

export async function loadCmsJson(url, fallback = null, options = {}) {
  const {
    resolveUrl,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    fetchImpl = globalThis.fetch,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout
  } = options;

  if (!url || typeof fetchImpl !== 'function') return fallback;

  const externalSignal = signal || null;
  const controller = typeof AbortController !== 'undefined'
    ? new AbortController()
    : null;
  let timer = null;
  let removeExternalAbort = null;

  try {
    // Both caller cancellation and the loader timeout must terminate the same
    // request signal. Passing an external signal directly while timing out a
    // separate internal controller creates a silent timeout bypass.
    let requestSignal = externalSignal;
    if (controller) {
      requestSignal = controller.signal;
      if (externalSignal) {
        const forwardAbort = () => controller.abort();
        if (externalSignal.aborted) {
          controller.abort();
        } else if (typeof externalSignal.addEventListener === 'function') {
          externalSignal.addEventListener('abort', forwardAbort, { once: true });
          removeExternalAbort = () =>
            externalSignal.removeEventListener?.('abort', forwardAbort);
        }
      }
      if (typeof setTimeoutImpl === 'function') {
        timer = setTimeoutImpl(
          () => controller.abort(),
          Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
        );
      }
    }

    const response = await fetchImpl(
      resolveCmsUrl(url, resolveUrl || (value => value)),
      {
        signal: requestSignal,
        credentials: 'omit',
        cache: 'no-cache'
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') console.warn('CMS request timed out:', url);
    return fallback;
  } finally {
    if (timer !== null && typeof clearTimeoutImpl === 'function') {
      clearTimeoutImpl(timer);
    }
    removeExternalAbort?.();
  }
}
