import assert from 'node:assert/strict';
import {
  getResponsiveBaseCount,
  getRowAlignedCount,
  applyGalleryReveal
} from '../js/features/gallery/presentation.js';

assert.equal(getResponsiveBaseCount({ width: 390, height: 844, total: 6 }), 6);
assert.equal(getResponsiveBaseCount({ width: 390, height: 844, total: 8 }), 8);
assert.equal(getResponsiveBaseCount({ width: 390, height: 844, total: 9 }), 6);

assert.equal(getResponsiveBaseCount({ width: 834, height: 780, total: 15 }), 15);
assert.equal(getResponsiveBaseCount({ width: 834, height: 780, total: 16 }), 4);
assert.equal(getResponsiveBaseCount({ width: 834, height: 900, total: 15 }), 15);
assert.equal(getResponsiveBaseCount({ width: 834, height: 900, total: 16 }), 6);

assert.equal(getResponsiveBaseCount({ width: 1280, height: 900, total: 9 }), 9);
assert.equal(getResponsiveBaseCount({ width: 1280, height: 900, total: 15 }), 15);
assert.equal(getResponsiveBaseCount({ width: 1280, height: 900, total: 16 }), 9);

const fakeWindow = { innerWidth: 1280 };
const cards = [
  { getBoundingClientRect: () => ({ top: 100 }) },
  { getBoundingClientRect: () => ({ top: 100 }) },
  { getBoundingClientRect: () => ({ top: 100 }) },
  { getBoundingClientRect: () => ({ top: 320 }) },
  { getBoundingClientRect: () => ({ top: 320 }) },
  { getBoundingClientRect: () => ({ top: 320 }) },
  { getBoundingClientRect: () => ({ top: 540 }) },
  { getBoundingClientRect: () => ({ top: 540 }) },
  { getBoundingClientRect: () => ({ top: 540 }) },
  { getBoundingClientRect: () => ({ top: 760 }) }
];

assert.equal(getRowAlignedCount(cards, 9, fakeWindow), 9);
assert.equal(getRowAlignedCount(cards, 4, fakeWindow), 6);
assert.equal(getRowAlignedCount(cards.slice(0, 2), 9, fakeWindow), 2);

// Regression: during a filter transition, row positions can be misleading
// because previous-filter cards still occupy the CSS grid. The presentation
// boundary must prefer actual grid geometry when it is available.
const geometricWindow = {
  innerWidth: 1280,
  getComputedStyle: () => ({ columnGap: '20px' })
};
const geometricGrid = {
  getBoundingClientRect: () => ({ width: 1000 })
};
const geometricCards = Array.from({ length: 10 }, () => ({
  getBoundingClientRect: () => ({ width: 320, top: 100 })
}));

assert.equal(
  getRowAlignedCount(geometricCards, 4, geometricWindow, geometricGrid),
  6
);

// Regression: media-aware card heights can differ inside the same CSS grid row.
// Show More must include the tallest card in the visible set, not just the
// final card's bottom edge.
const revealCards = [
  { style: {}, getBoundingClientRect: () => ({ bottom: 360 }) },
  { style: {}, getBoundingClientRect: () => ({ bottom: 440 }) },
  { style: {}, getBoundingClientRect: () => ({ bottom: 700 }) }
];
const revealViewport = {
  style: {},
  getBoundingClientRect: () => ({ top: 100 })
};
const revealGrid = {
  style: {},
  querySelectorAll: () => revealCards
};
let resizeObserverCallback = null;
let resizeObserverDisconnected = false;
const revealWindow = {
  innerWidth: 1280,
  ResizeObserver: class {
    constructor(callback) {
      resizeObserverCallback = callback;
    }
    observe(target) {
      assert.equal(target, revealGrid);
    }
    disconnect() {
      resizeObserverDisconnected = true;
    }
  },
  setTimeout(fn) {
    fn();
    return 1;
  },
  clearTimeout() {},
  requestAnimationFrame(fn) {
    fn();
    return 1;
  }
};

const revealCleanup = applyGalleryReveal({
  grid: revealGrid,
  gridViewport: revealViewport,
  filteredCards: revealCards,
  visibleCount: 2,
  expanded: false,
  windowRef: revealWindow,
  desktopPeek: 70
});

assert.equal(revealViewport.style.maxHeight, '410px');

// Regression: late media/layout changes must remeasure the collapsed viewport
// while the gallery remains collapsed.
revealCards[1].getBoundingClientRect = () => ({ bottom: 520 });
resizeObserverCallback?.();
assert.equal(revealViewport.style.maxHeight, '490px');
assert.equal(resizeObserverDisconnected, false);

// The returned cleanup hook must release the observer.
revealCleanup?.();
assert.equal(resizeObserverDisconnected, true);

const styleSource = await (await import('node:fs/promises')).readFile(new URL('../css/style.css', import.meta.url), 'utf8');
const mediaRendererForDensity = await (await import('node:fs/promises')).readFile(new URL('../js/features/lightbox/media-renderer.js', import.meta.url), 'utf8');
assert.match(mediaRendererForDensity, /container\.dataset\.mediaDensity = mediaList\.length > 2 \? 'multi' : 'single'/);
assert.match(mediaRendererForDensity, /container\.setAttribute\(\s*'data-has-youtube'/);
assert.match(styleSource, /data-media-density="multi"\]\[data-has-youtube="true"\]/);
assert.match(styleSource, /calc\(48svh \* var\(--lightbox-artwork-ratio/);

console.log('Gallery presentation boundary validated.');
