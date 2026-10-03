/**
 * Small lifecycle primitive for browser features.
 *
 * A feature owns the resources it creates. This helper centralizes teardown
 * without forcing features to share state or depend on one another.
 */

export function createLifecycle() {
  let disposed = false;
  const cleanups = new Set();

  function add(cleanup) {
    if (typeof cleanup !== 'function') return () => {};

    if (disposed) {
      try { cleanup(); } catch (_) {}
      return () => {};
    }

    cleanups.add(cleanup);
    return () => {
      if (!cleanups.delete(cleanup)) return;
      try { cleanup(); } catch (_) {}
    };
  }

  function listen(target, type, handler, options) {
    if (!target?.addEventListener) return () => {};
    target.addEventListener(type, handler, options);
    return add(() => target.removeEventListener(type, handler, options));
  }

  function timeout(callback, delay, windowRef = globalThis.window) {
    if (typeof windowRef?.setTimeout !== 'function') return () => {};
    const id = windowRef.setTimeout(() => {
      if (disposed) return;
      try { callback?.(); } catch (_) {}
    }, delay);
    return add(() => windowRef.clearTimeout?.(id));
  }

  function interval(callback, delay, windowRef = globalThis.window) {
    if (typeof windowRef?.setInterval !== 'function') return () => {};
    const id = windowRef.setInterval(() => {
      if (disposed) return;
      try { callback?.(); } catch (_) {}
    }, delay);
    return add(() => windowRef.clearInterval?.(id));
  }

  function animationFrame(callback, windowRef = globalThis.window) {
    if (typeof windowRef?.requestAnimationFrame !== 'function') return () => {};
    const id = windowRef.requestAnimationFrame(() => {
      if (disposed) return;
      try { callback?.(); } catch (_) {}
    });
    return add(() => windowRef.cancelAnimationFrame?.(id));
  }

  function observe(observer, target, options) {
    if (!observer || typeof observer.observe !== 'function' || !target) return () => {};
    observer.observe(target, options);
    return add(() => observer.disconnect?.());
  }

  function cleanup() {
    if (disposed) return;
    disposed = true;

    const pending = Array.from(cleanups);
    cleanups.clear();
    pending.reverse().forEach(fn => {
      try { fn(); } catch (_) {}
    });
  }

  return {
    add,
    listen,
    timeout,
    interval,
    animationFrame,
    observe,
    isDisposed: () => disposed,
    cleanup,
    destroy: cleanup
  };
}
