import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initContentReveal } from '../js/features/content-reveal/index.js?v=20261029-02';

const revealSource = await readFile(new URL('../js/features/content-reveal/index.js', import.meta.url), 'utf8');
const revealCss = await readFile(new URL('../css/features/content-reveal.css', import.meta.url), 'utf8');
const compositionSource = await readFile(new URL('../js/app/page-composition.js', import.meta.url), 'utf8');
const bootstrapSource = await readFile(new URL('../js/app/bootstrap.js', import.meta.url), 'utf8');
const rootHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const aboutHtml = await readFile(new URL('../about/index.html', import.meta.url), 'utf8');

assert.doesNotMatch(revealSource, /\bimport\s+.*(?:react|gsap|ScrollTrigger)/i,
  'Content reveal must not add React or GSAP to the public runtime.');
assert.match(revealSource, /IntersectionObserver/);
assert.match(revealSource, /prefers-reduced-motion: reduce/);
assert.match(revealSource, /pendingTargets\.forEach\(revealTarget\)/,
  'A live reduced-motion preference change must reveal pending content immediately.');
assert.match(revealSource, /observer\?\.disconnect\?\.\(\)/);
assert.match(revealSource, /target\.style\?\.removeProperty\?\.\('--lm-content-reveal-delay'\)/);
assert.doesNotMatch(revealSource, /\.project-card|#lightboxMediaContainer|\.hero-banner/,
  'Gallery cards, Lightbox media, and animated hero artwork remain owned by their existing features.');
assert.match(revealCss, /transition:[\s\S]*?opacity 720ms[\s\S]*?translate 720ms/);
assert.match(revealCss, /prefers-reduced-motion:\s*reduce/);
assert.match(revealCss, /focus-within/);
assert.match(compositionSource, /content-reveal\/index\.js\?v=20261029-01/);
assert.match(compositionSource, /contentRevealFeature\?\.destroy\?\.\(\)/);
assert.match(bootstrapSource, /app\?\.contentReveal\?\.refresh\?\.\(\)/);
assert.ok(
  bootstrapSource.indexOf('hideInitialPageTransition();') < bootstrapSource.indexOf('app?.contentReveal?.refresh?.()'),
  'Initial content reveal must start after the branded page-transition gate closes.'
);
assert.match(rootHtml, /href="css\/features\/content-reveal\.css\?v=20261029-01"/);
assert.match(aboutHtml, /href="\.\.\/css\/features\/content-reveal\.css\?v=20261029-01"/);

// Exercise the observer and lifecycle with small DOM-shaped fakes.
const selectorTargets = new Map();
const makeTarget = id => {
  const classes = new Set();
  const properties = new Map();
  return {
    id,
    dataset: {},
    style: {
      setProperty(name, value) { properties.set(name, value); },
      removeProperty(name) { properties.delete(name); }
    },
    classList: {
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      contains(name) { return classes.has(name); }
    },
    closest() { return null; },
    get properties() { return properties; },
    get classes() { return classes; }
  };
};
const bioHeading = makeTarget('bio-heading');
const bioCopy = makeTarget('bio-copy');
const filterRail = makeTarget('filter-rail');
selectorTargets.set('.about-hero .about-bio-text > *', [bioHeading, bioCopy]);
selectorTargets.set('main.works-main > .filter-nav-wrapper', [filterRail]);

const mediaListeners = new Set();
const motionQuery = {
  matches: false,
  addEventListener(type, handler) { if (type === 'change') mediaListeners.add(handler); },
  removeEventListener(type, handler) { if (type === 'change') mediaListeners.delete(handler); }
};
const observers = [];
class FakeIntersectionObserver {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.observed = new Set();
    this.disconnected = false;
    observers.push(this);
  }
  observe(target) { this.observed.add(target); }
  unobserve(target) { this.observed.delete(target); }
  disconnect() { this.disconnected = true; this.observed.clear(); }
}
const windowRef = {
  IntersectionObserver: FakeIntersectionObserver,
  matchMedia(query) { return query === '(prefers-reduced-motion: reduce)' ? motionQuery : { matches: false }; }
};
const root = { defaultView: windowRef, querySelectorAll(selector) { return selectorTargets.get(selector) || []; } };
const feature = initContentReveal({ root, windowRef });
assert.equal(feature.refresh(), 3, 'The first explicit refresh must attach the selected targets.');
const observer = observers[0];

assert.ok(observer, 'A single observer must be created for the feature.');
assert.equal(observer.observed.size, 3);
assert.equal(feature.refresh(), 0, 'Refresh must not attach duplicate observers to an existing target.');
assert.ok(bioHeading.classes.has('lm-content-reveal-target'));
assert.equal(bioHeading.properties.get('--lm-content-reveal-delay'), '0ms');
assert.equal(bioCopy.properties.get('--lm-content-reveal-delay'), '70ms');

observer.callback([{ target: bioHeading, isIntersecting: true, intersectionRatio: 0.5 }]);
assert.ok(bioHeading.classes.has('is-lm-content-revealed'));
assert.equal(bioHeading.dataset.lmContentRevealState, 'shown');
assert.ok(!observer.observed.has(bioHeading), 'A completed item must be unobserved.');

motionQuery.matches = true;
mediaListeners.forEach(handler => handler({ matches: true }));
assert.ok(bioCopy.classes.has('is-lm-content-revealed'),
  'Enabling reduced motion must not leave remaining content hidden.');
assert.ok(filterRail.classes.has('is-lm-content-revealed'));
assert.ok(observer.disconnected);

feature.destroy();
for (const target of [bioHeading, bioCopy, filterRail]) {
  assert.ok(!target.classes.has('lm-content-reveal-target'));
  assert.ok(!target.classes.has('is-lm-content-revealed'));
  assert.equal(target.dataset.lmContentRevealState, undefined);
  assert.equal(target.properties.has('--lm-content-reveal-delay'), false);
}
assert.equal(mediaListeners.size, 0);

console.log('Content reveal interaction, reduced-motion, decoupling, and cleanup contracts validated.');
