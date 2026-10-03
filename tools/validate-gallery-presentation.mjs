import assert from 'node:assert/strict';
import {
  getResponsiveBaseCount,
  getRowAlignedCount
} from '../js/features/gallery/presentation.js';

assert.equal(getResponsiveBaseCount({ width: 390, height: 844, total: 20 }), 2);
assert.equal(getResponsiveBaseCount({ width: 834, height: 780, total: 20 }), 4);
assert.equal(getResponsiveBaseCount({ width: 834, height: 900, total: 20 }), 6);
assert.equal(getResponsiveBaseCount({ width: 1280, height: 900, total: 20 }), 9);

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

console.log('Gallery presentation boundary validated.');
