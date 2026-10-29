import assert from 'node:assert/strict';
import { loadCmsJson } from '../js/infrastructure/cms/loader.js';

let timeoutCallback = null;
let clearedTimer = null;
const external = new AbortController();

const timedOut = await loadCmsJson('data/projects.json', { fallback: true }, {
  signal: external.signal,
  fetchImpl: async (_url, options) => {
    assert.ok(options.signal, 'CMS request should receive an AbortSignal');
    assert.equal(
      options.signal.aborted,
      true,
      'loader timeout should abort the same signal used by fetch when an external signal is supplied'
    );
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  },
  setTimeoutImpl: callback => {
    timeoutCallback = callback;
    callback();
    return 41;
  },
  clearTimeoutImpl: id => {
    clearedTimer = id;
  }
});

assert.deepEqual(timedOut, { fallback: true });
assert.equal(clearedTimer, 41);

let requestSignal = null;
const externalAbort = new AbortController();
const cancelled = await loadCmsJson('data/projects.json', 'fallback', {
  signal: externalAbort.signal,
  fetchImpl: async (_url, options) => {
    requestSignal = options.signal;
    externalAbort.abort();
    assert.equal(requestSignal.aborted, true, 'external abort should propagate to the request signal');
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  },
  setTimeoutImpl: callback => callback(),
  clearTimeoutImpl: () => {}
});
assert.equal(cancelled, 'fallback');

console.log('CMS loader timeout/external-abort lifecycle contract passed.');
