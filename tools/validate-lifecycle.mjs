import assert from 'node:assert/strict';
import { createLifecycle } from '../js/core/lifecycle.js';

const lifecycle = createLifecycle();
const events = [];
const target = {
  handlers: new Map(),
  addEventListener(type, handler) {
    this.handlers.set(type, handler);
    events.push(['add', type]);
  },
  removeEventListener(type, handler) {
    if (this.handlers.get(type) === handler) this.handlers.delete(type);
    events.push(['remove', type]);
  }
};

const removeListener = lifecycle.listen(target, 'change', () => events.push(['event']));
assert.equal(target.handlers.size, 1);

removeListener();
assert.equal(target.handlers.size, 0);

let timerFired = false;
lifecycle.timeout(() => { timerFired = true; }, 25);
lifecycle.cleanup();

await new Promise(resolve => setTimeout(resolve, 40));
assert.equal(timerFired, false);
assert.equal(lifecycle.isDisposed(), true);
assert.equal(events.filter(item => item[0] === 'remove').length, 1);

const afterDispose = lifecycle.listen(target, 'change', () => {});
assert.equal(target.handlers.size, 0);
afterDispose();

console.log('Feature lifecycle boundary validated.');
