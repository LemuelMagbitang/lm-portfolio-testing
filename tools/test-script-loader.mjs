import assert from 'node:assert/strict';
import { loadScriptOnce } from '../js/infrastructure/browser/script-loader.js?v=20261008-01';

function createFakeDocument() {
  const scripts = [];
  const created = [];
  const timers = new Map();
  let timerId = 0;

  const windowRef = {
    setTimeout(callback) {
      const id = ++timerId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  };

  const documentRef = {
    scripts,
    defaultView: windowRef,
    createElement() {
      const handlers = new Map();
      const element = {
        dataset: {},
        parentNode: null,
        handlers,
        addEventListener(type, handler) { handlers.set(type, handler); },
        removeEventListener(type, handler) {
          if (handlers.get(type) === handler) handlers.delete(type);
        },
        remove() {
          if (this.parentNode) {
            const index = scripts.indexOf(this);
            if (index >= 0) scripts.splice(index, 1);
            this.parentNode = null;
          }
        }
      };
      created.push(element);
      return element;
    },
    head: {
      appendChild(element) {
        element.parentNode = this;
        scripts.push(element);
      }
    }
  };

  return { documentRef, created, timers, windowRef };
}

let capabilityReady = false;
const first = createFakeDocument();
const firstPromise = loadScriptOnce(
  'https://example.test/runtime.js',
  () => capabilityReady,
  first.documentRef,
  1500
);

assert.equal(first.created.length, 1);
first.created[0].handlers.get('error')();
assert.equal(await firstPromise, false);
assert.equal(first.created.length, 1);
assert.equal(first.created[0].parentNode, null);
assert.equal(first.documentRef.scripts.length, 0);

capabilityReady = true;
const secondPromise = loadScriptOnce(
  'https://example.test/runtime.js',
  () => capabilityReady,
  first.documentRef,
  1500
);

assert.equal(await secondPromise, true);
assert.equal(first.created.length, 1, 'successful retry should not create another script when capability is already available');

capabilityReady = false;
const retryDoc = createFakeDocument();
const retryOne = loadScriptOnce(
  'https://example.test/retry.js',
  () => capabilityReady,
  retryDoc.documentRef,
  1500
);
const retryTwo = loadScriptOnce(
  'https://example.test/retry.js',
  () => capabilityReady,
  retryDoc.documentRef,
  1500
);
assert.strictEqual(retryOne, retryTwo, 'concurrent callers should share one in-flight promise');
retryDoc.created[0].handlers.get('error')();
assert.equal(await retryOne, false);

const retryThree = loadScriptOnce(
  'https://example.test/retry.js',
  () => capabilityReady,
  retryDoc.documentRef,
  1500
);
assert.notStrictEqual(retryThree, retryOne, 'a failed load must not poison future attempts');
assert.equal(retryDoc.created.length, 2);
capabilityReady = true;
retryDoc.created[1].handlers.get('load')();
assert.equal(await retryThree, true);

console.log('Browser script-loader retry lifecycle contract passed.');
