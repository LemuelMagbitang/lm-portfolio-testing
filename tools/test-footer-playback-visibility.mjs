import assert from 'node:assert/strict';
import { observeFooterPlaybackVisibility } from '../js/features/footer/playback-visibility.js?v=20261031-01';

class FakeIntersectionObserver {
  static instances = [];
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.targets = new Set();
    this.disconnected = false;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target) { this.targets.add(target); }
  disconnect() { this.disconnected = true; this.targets.clear(); }
  trigger(target, isIntersecting, intersectionRatio = isIntersecting ? 1 : 0) {
    this.callback([{ target, isIntersecting, intersectionRatio }]);
  }
}

const listeners = new Map();
const documentRef = {
  hidden: false,
  addEventListener(type, handler) {
    const handlers = listeners.get(type) || new Set();
    handlers.add(handler);
    listeners.set(type, handlers);
  },
  removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
  dispatch(type) { listeners.get(type)?.forEach(handler => handler()); }
};
const windowRef = { IntersectionObserver: FakeIntersectionObserver };
const target = {};
const states = [];
const visibility = observeFooterPlaybackVisibility({
  target, windowRef, documentRef, rootMargin: '480px 0px',
  onChange: value => states.push(value)
});

assert.deepEqual(states, [false], 'Footer playback must start idle outside its viewport prefetch band.');
assert.equal(visibility.isVisible(), false);
const observer = FakeIntersectionObserver.instances.at(-1);
assert.equal(observer.options.rootMargin, '480px 0px');
assert.equal(observer.options.threshold, 0.01);
assert.ok(observer.targets.has(target));

observer.trigger(target, true);
assert.deepEqual(states, [false, true], 'Entering the prefetch band must enable playback.');
assert.equal(visibility.isVisible(), true);

documentRef.hidden = true;
documentRef.dispatch('visibilitychange');
assert.deepEqual(states, [false, true, false], 'A hidden tab must suspend Footer playback.');
assert.equal(visibility.isVisible(), false);

documentRef.hidden = false;
documentRef.dispatch('visibilitychange');
assert.deepEqual(states, [false, true, false, true], 'Returning to a visible tab resumes while the Footer remains nearby.');
observer.trigger(target, false);
assert.deepEqual(states, [false, true, false, true, false]);
assert.equal(visibility.isVisible(), false);

visibility.destroy();
assert.equal(observer.disconnected, true);
assert.equal(listeners.get('visibilitychange')?.size || 0, 0);
observer.trigger(target, true);
assert.equal(states.length, 5, 'A disposed visibility gate must ignore late observer callbacks.');

const fallbackStates = [];
const fallbackDocument = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {}
};
const fallback = observeFooterPlaybackVisibility({
  target: {}, windowRef: {}, documentRef: fallbackDocument,
  onChange: value => fallbackStates.push(value)
});
assert.deepEqual(fallbackStates, [true], 'Browsers without IntersectionObserver retain eager playback.');
assert.equal(fallback.isVisible(), true);
fallback.destroy();

console.log('Footer playback visibility lifecycle validated.');
