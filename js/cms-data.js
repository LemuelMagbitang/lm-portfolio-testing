/**
 * Architecture V2 — centralized CMS/data access.
 * Public JSON reads share URL resolution, timeout behavior and response rules.
 */
const DEFAULT_TIMEOUT_MS = 8000;

export function resolveCmsUrl(url, resolveUrl) {
  if (!url) return '';
  return typeof resolveUrl === 'function' ? resolveUrl(url) : String(url);
}

export async function loadCmsJson(url, fallback = null, options = {}) {
  const { resolveUrl, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;
  if (!url) return fallback;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer = null;
  try {
    if (controller) {
      timer = window.setTimeout(
        () => controller.abort(),
        Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
      );
    }
    const response = await fetch(resolveCmsUrl(url, resolveUrl || (value => value)), {
      signal: signal || controller?.signal,
      credentials: 'same-origin',
      cache: 'no-cache'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') console.warn('CMS request timed out:', url);
    return fallback;
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}
