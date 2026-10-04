import assert from 'node:assert/strict';
import {
  getResponsiveBaseCount,
  getRowAlignedCount
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

console.log('Gallery presentation boundary validated.');
