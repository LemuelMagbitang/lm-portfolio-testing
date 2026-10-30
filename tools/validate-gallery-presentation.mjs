import assert from 'node:assert/strict';
import {
  getResponsiveBaseCount,
  getRowAlignedCount,
  applyGalleryReveal,
  applyGalleryViewportReveal
} from '../js/features/gallery/presentation.js?v=20261030-01';

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
const revealWindow = {
  innerWidth: 1280,
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

// The returned cleanup hook remains valid even though the collapsed
// measurement no longer depends on a persistent layout observer.
revealCards[1].getBoundingClientRect = () => ({ bottom: 520 });
revealCleanup?.();

const revealViewportLate = { style: {}, getBoundingClientRect: () => ({ top: 100 }) };
const lateMeasureWindow = { ...revealWindow };
applyGalleryReveal({
  grid: revealGrid,
  gridViewport: revealViewportLate,
  filteredCards: revealCards,
  visibleCount: 2,
  expanded: false,
  windowRef: lateMeasureWindow,
  desktopPeek: 70
});
assert.equal(revealViewportLate.style.maxHeight, '490px');

function makeExpansionFixture({
  reducedMotion = false,
  startExpanded = true,
  animateCollapse = false,
  viewportHeight = 180
} = {}) {
  const frames = [];
  const timers = new Map();
  const listeners = new Map();
  const classes = new Set();
  const fadeClasses = new Set();
  let nextTimer = 0;
  const cardClasses = new Set();
  const card = {
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    classList: {
      add(name) { cardClasses.add(name); },
      remove(name) { cardClasses.delete(name); }
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, bottom: 100 }; },
    removeAttribute(name) { delete this.dataset[name]; }
  };
  const viewport = {
    style: { maxHeight: `${viewportHeight}px` },
    offsetHeight: 180,
    classList: {
      add(name) { classes.add(name); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      contains(name) { return classes.has(name); }
    },
    getBoundingClientRect() { return { top: 0, left: 0, width: 500, height: viewportHeight }; },
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
    },
    removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
    dispatch(name, event) {
      for (const handler of [...(listeners.get(name) || [])]) handler({ type: name, target: this, ...event });
    }
  };
  const fadeOverlay = { classList: {
    add(name) { fadeClasses.add(name); },
    remove(name) { fadeClasses.delete(name); },
    contains(name) { return fadeClasses.has(name); }
  } };
  const wrapperClasses = new Set(!startExpanded ? ['expanded'] : []);
  const wrapperAttributes = new Map([['data-expanded', String(!startExpanded)]]);
  const showMoreWrapper = {
    style: {},
    setAttribute(name, value) { wrapperAttributes.set(name, String(value)); },
    getAttribute(name) { return wrapperAttributes.get(name) ?? null; },
    classList: {
      add(name) { wrapperClasses.add(name); },
      remove(...names) { names.forEach(name => wrapperClasses.delete(name)); },
      toggle(name, force) {
        const enabled = force === undefined ? !wrapperClasses.has(name) : Boolean(force);
        if (enabled) wrapperClasses.add(name);
        else wrapperClasses.delete(name);
        return enabled;
      },
      contains(name) { return wrapperClasses.has(name); }
    }
  };
  const buttonClasses = new Set(!startExpanded ? ['expanded'] : []);
  const buttonAttributes = new Map([['aria-expanded', String(!startExpanded)]]);
  const buttonLabel = { textContent: startExpanded ? 'SHOW MORE' : 'SHOW LESS' };
  const showMoreButton = {
    setAttribute(name, value) { buttonAttributes.set(name, String(value)); },
    getAttribute(name) { return buttonAttributes.get(name) ?? null; },
    querySelector(selector) { return selector === '.btn-text' ? buttonLabel : null; },
    classList: {
      toggle(name, force) {
        const enabled = force === undefined ? !buttonClasses.has(name) : Boolean(force);
        if (enabled) buttonClasses.add(name);
        else buttonClasses.delete(name);
        return enabled;
      },
      contains(name) { return buttonClasses.has(name); }
    }
  };
  let settledCalls = 0;
  // Both transition directions require an overflowing result set so the button remains visible.
  const fixtureCards = [card, card];
  const grid = {
    scrollHeight: 720,
    querySelectorAll() { return fixtureCards; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 500, height: 720 }; }
  };
  const windowRef = {
    innerWidth: 1280,
    innerHeight: 900,
    matchMedia() { return { matches: reducedMotion }; },
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {},
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
  const cleanup = applyGalleryReveal({
    grid,
    gridViewport: viewport,
    fadeOverlay,
    showMoreButton,
    showMoreWrapper,
    filteredCards: fixtureCards,
    visibleCount: 1,
    expanded: startExpanded,
    animateExpand: startExpanded,
    animateCollapse,
    windowRef,
    fadeMs: 300,
    onShowMoreSettled() { settledCalls += 1; }
  });
  return {
    frames, timers, viewport, fadeOverlay, showMoreButton, showMoreWrapper,
    buttonLabel, settledCalls: () => settledCalls, cleanup
  };
}

const expansionFixture = makeExpansionFixture();
assert.equal(expansionFixture.viewport.style.maxHeight, '180px',
  'Show More must begin at the measured collapsed viewport height.');
assert.equal(expansionFixture.viewport.classList.contains('is-expanding'), true,
  'The viewport transition must be enabled before its target height changes.');
assert.equal(expansionFixture.showMoreButton.getAttribute('aria-expanded'), 'false',
  'Show More must retain its collapsed semantic state while the viewport is expanding.');
assert.equal(expansionFixture.showMoreButton.classList.contains('expanded'), false);
assert.equal(expansionFixture.showMoreWrapper.classList.contains('expanded'), true,
  'Wrapper spacing must enter the expanded layout as the viewport transition begins.');
assert.equal(expansionFixture.buttonLabel.textContent, 'SHOW MORE');
assert.equal(expansionFixture.settledCalls(), 0,
  'The button settlement callback must wait for the viewport transitionend event.');
assert.equal(expansionFixture.showMoreWrapper.classList.contains('is-expanding'), true,
  'The Show More wrapper spacing transition must be enabled before expanded spacing changes.');
while (expansionFixture.frames.length) expansionFixture.frames.shift()();
assert.equal(expansionFixture.viewport.classList.contains('is-expanding'), true);
assert.equal(expansionFixture.viewport.style.maxHeight, '720px',
  'The viewport must expand to the measured natural grid height.');
expansionFixture.viewport.dispatch('transitionend', { propertyName: 'max-height' });
assert.equal(expansionFixture.viewport.style.maxHeight, 'none',
  'After expansion, natural height must be restored.');
assert.equal(expansionFixture.viewport.classList.contains('is-expanding'), false);
assert.equal(expansionFixture.showMoreWrapper.classList.contains('is-expanding'), false);
assert.equal(expansionFixture.fadeOverlay.classList.contains('is-hidden'), true);
assert.equal(expansionFixture.showMoreButton.getAttribute('aria-expanded'), 'true');
assert.equal(expansionFixture.showMoreButton.classList.contains('expanded'), true);
assert.equal(expansionFixture.showMoreWrapper.classList.contains('expanded'), true);
assert.equal(expansionFixture.showMoreWrapper.getAttribute('data-expanded'), 'true');
assert.equal(expansionFixture.buttonLabel.textContent, 'SHOW LESS');
assert.equal(expansionFixture.settledCalls(), 1);
expansionFixture.cleanup?.();

const reducedExpansionFixture = makeExpansionFixture({ reducedMotion: true });
assert.equal(reducedExpansionFixture.viewport.style.maxHeight, 'none',
  'Reduced-motion users must receive the expanded layout without a max-height animation.');
assert.equal(reducedExpansionFixture.viewport.classList.contains('is-expanding'), false);
assert.equal(reducedExpansionFixture.showMoreWrapper.classList.contains('is-expanding'), false);
reducedExpansionFixture.cleanup?.();

// Show Less regression: keep the expanded viewport height for the first paint,
// then transition to the measured collapsed height.
const collapseFixture = makeExpansionFixture({
  startExpanded: false,
  animateCollapse: true,
  viewportHeight: 720
});
assert.equal(collapseFixture.viewport.style.maxHeight, '720px',
  'Show Less must begin at the current expanded viewport height.');
assert.equal(collapseFixture.viewport.classList.contains('is-collapsing'), true,
  'The collapse transition must be enabled before applying the collapsed target.');
assert.equal(collapseFixture.showMoreWrapper.classList.contains('is-collapsing'), true,
  'The Show Less wrapper spacing transition must be enabled with the viewport.');
assert.equal(collapseFixture.showMoreButton.getAttribute('aria-expanded'), 'true',
  'Show Less must retain its expanded semantic state while the viewport is collapsing.');
assert.equal(collapseFixture.showMoreButton.classList.contains('expanded'), true);
assert.equal(collapseFixture.showMoreWrapper.classList.contains('expanded'), false,
  'Wrapper spacing must enter the collapsed layout as the viewport transition begins.');
assert.equal(collapseFixture.buttonLabel.textContent, 'SHOW LESS');
assert.equal(collapseFixture.settledCalls(), 0);
while (collapseFixture.frames.length) collapseFixture.frames.shift()();
assert.equal(collapseFixture.viewport.style.maxHeight, '170px',
  'Show Less must animate toward the measured collapsed viewport height.');
collapseFixture.viewport.dispatch('transitionend', { propertyName: 'max-height' });
assert.equal(collapseFixture.viewport.style.maxHeight, '170px',
  'After collapse, the measured collapsed viewport height must remain set.');
assert.equal(collapseFixture.viewport.classList.contains('is-collapsing'), false);
assert.equal(collapseFixture.showMoreWrapper.classList.contains('is-collapsing'), false);
assert.equal(collapseFixture.fadeOverlay.classList.contains('is-hidden'), false);
assert.equal(collapseFixture.showMoreButton.getAttribute('aria-expanded'), 'false');
assert.equal(collapseFixture.showMoreButton.classList.contains('expanded'), false);
assert.equal(collapseFixture.showMoreWrapper.classList.contains('expanded'), false);
assert.equal(collapseFixture.showMoreWrapper.getAttribute('data-expanded'), 'false');
assert.equal(collapseFixture.buttonLabel.textContent, 'SHOW MORE');
assert.equal(collapseFixture.settledCalls(), 1);
collapseFixture.cleanup?.();

const reducedCollapseFixture = makeExpansionFixture({
  reducedMotion: true,
  startExpanded: false,
  animateCollapse: true,
  viewportHeight: 720
});
assert.equal(reducedCollapseFixture.viewport.style.maxHeight, '170px',
  'Reduced-motion Show Less must apply the collapsed layout without animating.');
assert.equal(reducedCollapseFixture.viewport.classList.contains('is-collapsing'), false);
assert.equal(reducedCollapseFixture.showMoreWrapper.classList.contains('is-collapsing'), false);
reducedCollapseFixture.cleanup?.();

const styleSource = await (await import('node:fs/promises')).readFile(new URL('../css/style.css', import.meta.url), 'utf8');
const galleryControllerForFilters = await (await import('node:fs/promises')).readFile(new URL('../js/features/gallery/index.js', import.meta.url), 'utf8');
const galleryPresentationSource = await (await import('node:fs/promises')).readFile(new URL('../js/features/gallery/presentation.js', import.meta.url), 'utf8');
const worksMarkup = await (await import('node:fs/promises')).readFile(new URL('../index.html', import.meta.url), 'utf8');
const mediaRendererForDensity = await (await import('node:fs/promises')).readFile(new URL('../js/features/lightbox/media-renderer.js', import.meta.url), 'utf8');
assert.match(galleryControllerForFilters, /function setFilterButtonLabel\(button, value\)/);
assert.match(galleryControllerForFilters, /setFilterButtonLabel\(allButton, 'ALL'\)/);
assert.match(galleryControllerForFilters, /setFilterButtonLabel\(button, filter\.label \|\| filter\.name \|\| filter\.id\)/);
assert.match(worksMarkup, /class="filter-tab-label">ALL<\/span>/);
assert.match(styleSource, /\.filter-tabs \.tab-btn \{[\s\S]*?display: inline-flex;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;/);
assert.match(styleSource, /\.filter-tabs \.filter-tab-label \{[\s\S]*?width: max-content;[\s\S]*?margin-inline: auto;[\s\S]*?line-height: inherit;[\s\S]*?text-align: center;/);
assert.match(galleryControllerForFilters, /const isDirectActivation = event\?\.isTrusted !== false;/);
assert.match(galleryControllerForFilters, /if \(isDirectActivation\) playShowMoreBounce\(\)/);
assert.match(galleryControllerForFilters, /animateExpand: nextExpanded && isDirectActivation[\s\S]*?animateCollapse: !nextExpanded && isDirectActivation/);
assert.match(galleryControllerForFilters, /if \(showMoreTransitionPending\) return;/);
assert.match(galleryControllerForFilters, /setAttribute\('aria-disabled', 'true'\)/);
assert.match(galleryControllerForFilters, /onShowMoreSettled: settleShowMoreToggle/);
assert.match(galleryPresentationSource, /viewportTransitionCompletion = \(\) => \{[\s\S]*?syncShowMoreButtonState\(\)/);
assert.match(galleryPresentationSource, /const syncShowMoreButtonState = \(\) => \{[\s\S]*?setAttribute\('aria-expanded', String\(expanded\)\)/);
assert.match(styleSource, /\.btn-show-more:not\(\.expanded\):hover\{[\s\S]*?background:#fff !important;[\s\S]*?color:#000 !important;/);
assert.match(styleSource, /\.btn-show-more\.expanded:hover\{[\s\S]*?background:#fff !important;[\s\S]*?color:#000 !important;/);
assert.match(styleSource, /\.btn-show-more\.is-interacting\{[\s\S]*?animation:show-more-interaction-bounce 420ms/);
assert.match(styleSource, /\.portfolio-grid-viewport\.is-expanding,[\s\S]*?\.portfolio-grid-viewport\.is-collapsing\s*\{\s*transition:\s*max-height 560ms/);
assert.match(styleSource, /\.show-more-wrapper\.is-expanding,[\s\S]*?\.show-more-wrapper\.is-collapsing\s*\{[\s\S]*?margin-top 560ms[\s\S]*?min-height 560ms[\s\S]*?padding-bottom 560ms/);
assert.match(styleSource, /@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?\.btn-show-more\.is-interacting\{animation:none!important;\}[\s\S]*?\.portfolio-grid-viewport\.is-expanding,[\s\S]*?\.portfolio-grid-viewport\.is-collapsing,[\s\S]*?\.show-more-wrapper\.is-expanding,[\s\S]*?\.show-more-wrapper\.is-collapsing\{transition:none!important;\}/);
assert.match(galleryPresentationSource, /const startExpansion = \(\) => \{[\s\S]*?grid\.scrollHeight[\s\S]*?viewport\.style\.maxHeight/);
assert.match(galleryPresentationSource, /if \(!animateExpand \|\| !expanded \|\| reducedMotion\) return false/);
assert.match(mediaRendererForDensity, /container\.dataset\.mediaDensity = mediaList\.length > 2 \? 'multi' : 'single'/);
assert.match(mediaRendererForDensity, /container\.setAttribute\(\s*'data-has-youtube'/);
assert.match(styleSource, /data-media-density="multi"\]\[data-has-youtube="true"\]/);
assert.match(styleSource, /calc\(58svh \* var\(--lightbox-artwork-ratio/);



function makeGalleryRevealCard({ left = 0, top = 900, width = 100, height = 100 } = {}) {
  const listeners = new Map();
  const classes = new Set();
  const styleValues = new Map();
  const dataset = {};
  return {
    dataset,
    style: {
      setProperty(name, value) { styleValues.set(name, String(value)); },
      removeProperty(name) { styleValues.delete(name); },
      getPropertyValue(name) { return styleValues.get(name) || ''; }
    },
    classList: {
      add(name) { classes.add(name); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      contains(name) { return classes.has(name); }
    },
    getBoundingClientRect() { return { left, top, width, height, right: left + width, bottom: top + height }; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    removeAttribute(name) {
      if (name === 'data-gallery-reveal-state') delete dataset.galleryRevealState;
      if (name === 'data-gallery-reveal-complete') delete dataset.galleryRevealComplete;
    },
    _listeners: listeners
  };
}

class FakeGalleryIntersectionObserver {
  static instances = [];
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.observed = new Set();
    this.disconnected = false;
    FakeGalleryIntersectionObserver.instances.push(this);
  }
  observe(target) { this.observed.add(target); }
  unobserve(target) { this.observed.delete(target); }
  disconnect() { this.disconnected = true; this.observed.clear(); }
  trigger(target, isIntersecting = true) {
    this.callback([{ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }]);
  }
}

let nextGalleryTimer = 0;
const galleryTimers = new Map();
const galleryRevealWindow = {
  innerWidth: 1280,
  innerHeight: 700,
  IntersectionObserver: FakeGalleryIntersectionObserver,
  getComputedStyle: () => ({ gridTemplateColumns: '100px 100px 100px' }),
  matchMedia: () => ({ matches: false }),
  setTimeout(callback) { const id = ++nextGalleryTimer; galleryTimers.set(id, callback); return id; },
  clearTimeout(id) { galleryTimers.delete(id); }
};
const galleryRevealGrid = {};
const revealCardOne = makeGalleryRevealCard({ left: 0, top: 900 });
const revealCardTwo = makeGalleryRevealCard({ left: 100, top: 900 });
const revealCardThree = makeGalleryRevealCard({ left: 200, top: 900 });
const observerCountBefore = FakeGalleryIntersectionObserver.instances.length;
const cancelViewportReveal = applyGalleryViewportReveal({
  grid: galleryRevealGrid,
  cards: [revealCardOne, revealCardTwo, revealCardThree],
  windowRef: galleryRevealWindow
});
const galleryObserver = FakeGalleryIntersectionObserver.instances.at(-1);
assert.equal(FakeGalleryIntersectionObserver.instances.length, observerCountBefore + 1);
assert.equal(galleryObserver.options.rootMargin, '-24px 0px -24px 0px');
assert.equal(galleryObserver.options.threshold, 0.01);
assert.equal(revealCardOne.dataset.galleryRevealState, 'pending');
assert.equal(revealCardTwo.style.getPropertyValue('--gallery-scroll-reveal-delay'), '35ms');
assert.equal(revealCardThree.style.getPropertyValue('--gallery-scroll-reveal-delay'), '70ms');
galleryObserver.trigger(revealCardTwo);
assert.equal(revealCardTwo.dataset.galleryRevealComplete, 'true');
assert.equal(revealCardTwo.dataset.galleryRevealState, 'revealing');
assert.equal(galleryObserver.observed.has(revealCardTwo), false);
revealCardTwo._listeners.get('transitionend')?.({ target: revealCardTwo, propertyName: 'opacity' });
assert.equal(revealCardTwo.dataset.galleryRevealState, undefined);
assert.equal(revealCardTwo.classList.contains('has-gallery-scroll-reveal'), false);
assert.equal(revealCardTwo.style.getPropertyValue('--gallery-scroll-reveal-delay'), '');
cancelViewportReveal();
assert.equal(galleryObserver.disconnected, true);
assert.equal(revealCardOne.dataset.galleryRevealState, undefined);

const observerCountAfterReveal = FakeGalleryIntersectionObserver.instances.length;
applyGalleryViewportReveal({ grid: galleryRevealGrid, cards: [revealCardTwo], windowRef: galleryRevealWindow });
assert.equal(FakeGalleryIntersectionObserver.instances.length, observerCountAfterReveal);

const reducedMotionCard = makeGalleryRevealCard({ top: 900 });
applyGalleryViewportReveal({
  grid: galleryRevealGrid,
  cards: [reducedMotionCard],
  windowRef: { ...galleryRevealWindow, matchMedia: () => ({ matches: true }) }
});
assert.equal(reducedMotionCard.dataset.galleryRevealComplete, 'true');
assert.equal(reducedMotionCard.dataset.galleryRevealState, undefined);
assert.equal(reducedMotionCard.classList.contains('has-gallery-scroll-reveal'), false);

const filterTransitionCard = makeGalleryRevealCard({ left: 100, top: 100 });
applyGalleryViewportReveal({
  grid: galleryRevealGrid,
  cards: [filterTransitionCard],
  windowRef: galleryRevealWindow,
  skipVisibleReveal: true
});
assert.equal(filterTransitionCard.dataset.galleryRevealComplete, 'true');
assert.equal(filterTransitionCard.dataset.galleryRevealState, undefined);
assert.equal(filterTransitionCard.classList.contains('has-gallery-scroll-reveal'), false);
assert.match(styleSource, /\.project-card\.has-gallery-scroll-reveal\[data-gallery-reveal-state="pending"\]/);
assert.match(styleSource, /prefers-reduced-motion:\s*reduce[\s\S]*?\.project-card\.has-gallery-scroll-reveal/);

console.log('Gallery presentation boundary validated.');