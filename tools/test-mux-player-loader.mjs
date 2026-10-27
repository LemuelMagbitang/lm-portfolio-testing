import assert from 'node:assert/strict';
import { ensureMuxPlayer, ensureMuxVideo } from '../js/infrastructure/mux/player.js?v=20261027-01';

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
const registered = new Set();
Object.defineProperty(globalThis, 'customElements', {
  configurable: true,
  writable: true,
  value: {
    get(name) {
      return registered.has(name) ? { name } : undefined;
    }
  }
});

try {
  let playerAttempts = 0;
  assert.equal(await ensureMuxPlayer(async () => {
    playerAttempts += 1;
    throw new Error('simulated transient Mux Player CDN failure');
  }), false);
  assert.equal(playerAttempts, 1);

  assert.equal(await ensureMuxPlayer(async () => {
    playerAttempts += 1;
    registered.add('mux-player');
    return {};
  }), true, 'Mux Player should recover on a later call after an import failure.');
  assert.equal(playerAttempts, 2);
  assert.equal(await ensureMuxPlayer(async () => {
    throw new Error('a registered player should not need another import');
  }), true);
  assert.equal(playerAttempts, 2, 'a registered custom element should be reused.');

  let videoAttempts = 0;
  assert.equal(await ensureMuxVideo(async () => {
    videoAttempts += 1;
    throw new Error('simulated transient Mux Video CDN failure');
  }, 1000), false);
  assert.equal(videoAttempts, 1);

  assert.equal(await ensureMuxVideo(async () => {
    videoAttempts += 1;
    return {};
  }, 1000), false, 'An import that does not register mux-video must fail safely.');
  assert.equal(videoAttempts, 2);

  assert.equal(await ensureMuxVideo(async () => {
    videoAttempts += 1;
    registered.add('mux-video');
    return {};
  }, 1000), true, 'Mux Video should recover after rejected and unregistered imports.');
  assert.equal(videoAttempts, 3);
  assert.equal(await ensureMuxVideo(async () => {
    throw new Error('a registered video element should not need another import');
  }, 1000), true);
  assert.equal(videoAttempts, 3, 'a registered custom element should be reused.');

  console.log('Mux player loader retry lifecycle contract passed.');
} finally {
  if (originalDescriptor) {
    Object.defineProperty(globalThis, 'customElements', originalDescriptor);
  } else {
    delete globalThis.customElements;
  }
}
