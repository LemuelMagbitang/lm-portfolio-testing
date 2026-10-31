/**
 * Footer playback visibility gate.
 *
 * A short prefetch band lets media prepare before the Footer enters view,
 * while keeping streamed playback and recurring timers idle for the rest of
 * the page visit. Browsers without IntersectionObserver retain eager behavior.
 */
export function observeFooterPlaybackVisibility({
  target,
  windowRef = globalThis.window,
  documentRef = windowRef?.document,
  onChange = () => {},
  rootMargin = '480px 0px'
} = {}) {
  if (!target || !windowRef || typeof onChange !== 'function') {
    return { isVisible: () => true, destroy() {} };
  }

  const Observer = windowRef.IntersectionObserver || globalThis.IntersectionObserver;
  let intersects = typeof Observer !== 'function';
  let disposed = false;
  let lastVisible = null;
  let observer = null;

  const sync = () => {
    if (disposed) return;
    const visible = Boolean(intersects && !documentRef?.hidden);
    if (visible === lastVisible) return;
    lastVisible = visible;
    onChange(visible);
  };

  const handleDocumentVisibility = () => sync();

  if (typeof Observer === 'function') {
    observer = new Observer(entries => {
      if (disposed) return;
      const entry = entries.find(item => item?.target === target);
      if (!entry) return;
      intersects = Boolean(entry.isIntersecting && Number(entry.intersectionRatio) > 0);
      sync();
    }, {
      root: null,
      rootMargin,
      threshold: 0.01
    });
    observer.observe(target);
  }

  documentRef?.addEventListener?.('visibilitychange', handleDocumentVisibility);
  sync();

  return {
    isVisible: () => Boolean(!disposed && intersects && !documentRef?.hidden),
    destroy() {
      if (disposed) return;
      disposed = true;
      observer?.disconnect?.();
      documentRef?.removeEventListener?.('visibilitychange', handleDocumentVisibility);
    }
  };
}
