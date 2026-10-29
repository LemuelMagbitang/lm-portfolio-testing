import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initContentReveal } from '../js/features/content-reveal/index.js?v=20261029-09';

const revealSource = await readFile(new URL('../js/features/content-reveal/index.js', import.meta.url), 'utf8');
const revealCss = await readFile(new URL('../css/features/content-reveal.css', import.meta.url), 'utf8');
const mainStyles = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
const compositionSource = await readFile(new URL('../js/app/page-composition.js', import.meta.url), 'utf8');
const bootstrapSource = await readFile(new URL('../js/app/bootstrap.js', import.meta.url), 'utf8');
const rootHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const aboutHtml = await readFile(new URL('../about/index.html', import.meta.url), 'utf8');

assert.doesNotMatch(revealSource, /\bimport\s+.*(?:react|gsap|ScrollTrigger)/i,
  'Content reveal must not add React or GSAP to the public runtime.');
assert.match(revealSource, /IntersectionObserver/);
assert.match(revealSource, /String\(target\.textContent \|\| ''\)\.trim\(\)\.length > 0/,
  'Text-bearing reveal targets must remain opaque before entering the viewport.');
assert.match(revealSource, /target\.matches\?\.\('\.form-container, a, button, input, textarea, select, \[role="button"\]'\)/,
  'Interactive targets must use position-only entrance motion.');
assert.match(revealCss, /data-lm-content-reveal-motion="position-only"[^}]*opacity:\s*1;/,
  'Form-containing reveal targets must never fade their controls to opacity zero.');
assert.match(revealSource, /resume-skills-row[\s\S]*?skill-list > li/);
assert.match(revealGroupsSource, /#experienceList > \*/);
assert.match(revealGroupsSource, /#educationList > \*/);
assert.match(revealGroupsSource, /#awardsList > \*/);
const revealGroupsSource = revealSource.match(/const REVEAL_TARGET_GROUPS = \[([\s\S]*?)\n\];/)?.[1] || '';
assert.ok(revealGroupsSource.includes("motion: { distance: 24, durationMs: 560, staggerStepMs: 48, staggerMaxMs: 144 }"),
  'About hero content must use the scoped staggered entrance profile without changing unrelated sections.');
assert.match(revealGroupsSource, /#contact-section #web3-forms-container > \.contact-block > h2/);
assert.doesNotMatch(revealGroupsSource, /\.contact-mobile-tab/,
  'Contact tabs already have their own moving pill and drag state; they must not receive generic reveal transforms.');
assert.doesNotMatch(revealGroupsSource, /\.form-container/,
  'Interactive form containers must not be translated independently of their paired form rows.');
assert.match(revealSource, /prefers-reduced-motion: reduce/);
assert.match(revealSource, /pendingTargets\.forEach\(revealTarget\)/,
  'A live reduced-motion preference change must reveal pending content immediately.');
assert.match(revealSource, /observer\?\.disconnect\?\.\(\)/);
assert.match(revealSource, /target\.style\?\.removeProperty\?\.\('--lm-content-reveal-delay'\)/);
assert.doesNotMatch(revealSource, /\.project-card|#lightboxMediaContainer|\.hero-banner/,
  'Gallery cards, Lightbox media, and animated hero artwork remain owned by their existing features.');
assert.match(revealCss, /opacity var\(--lm-content-reveal-duration, 480ms\)[\s\S]*?translate var\(--lm-content-reveal-duration, 480ms\)/);
assert.match(revealCss, /prefers-reduced-motion:\s*reduce/);
assert.match(revealCss, /focus-within/);
assert.match(mainStyles, /#contactReviewPanel > \.section-title\s*\{[^}]*color:\s*#bdbdbd\s*!important;[^}]*mix-blend-mode:\s*normal\s*!important;/,
  'The review heading must keep a high-contrast, non-blended foreground.');
assert.match(mainStyles, /button\.submit-btn\.submit-btn-secondary\s*\{[^}]*color:\s*#fff\s*!important;[^}]*-webkit-text-fill-color:\s*#fff\s*!important;[^}]*background:\s*#242424\s*!important;[^}]*mix-blend-mode:\s*normal\s*!important;[^}]*isolation:\s*isolate\s*!important;/,
  'The review submit button must use its own high-contrast surface even if rendered outside its original panel.');
assert.match(compositionSource, /content-reveal\/index\.js\?v=20261029-09/);
assert.match(compositionSource, /contentRevealFeature\?\.destroy\?\.\(\)/);
assert.match(bootstrapSource, /app\?\.contentReveal\?\.refresh\?\.\(\)/);
assert.ok(
  bootstrapSource.indexOf('hideInitialPageTransition();') < bootstrapSource.indexOf('app?.contentReveal?.refresh?.()'),
  'Initial content reveal must start after the branded page-transition gate closes.'
);
assert.match(rootHtml, /href="css\/features\/content-reveal\.css\?v=20261029-04"/);
assert.match(aboutHtml, /href="\.\.\/css\/features\/content-reveal\.css\?v=20261029-04"/);

// Exercise the observer and lifecycle with small DOM-shaped fakes.
const selectorTargets = new Map();
const makeTarget = id => {
  const classes = new Set();
  const properties = new Map();
  return {
    id,
    textContent: id,
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
const reviewHeading = makeTarget('review-heading');
selectorTargets.set('.about-hero .about-bio-text > *', [bioHeading, bioCopy]);
selectorTargets.set('main.works-main > .filter-nav-wrapper', [filterRail]);
selectorTargets.set(
  '#contact-section #web3-forms-container > .contact-block > h2',
  [reviewHeading]
);

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
const root = {
  defaultView: windowRef,
  querySelectorAll(selector) { return selectorTargets.get(selector) || []; }
};
const feature = initContentReveal({ root, windowRef });
assert.equal(feature.refresh(), 4, 'The first explicit refresh must attach selected text and section targets.');
const observer = observers[0];

assert.ok(observer, 'A single observer must be created for the feature.');
assert.equal(observer.observed.size, 4);
assert.equal(feature.refresh(), 0, 'Refresh must not attach duplicate observers to an existing target.');
assert.ok(bioHeading.classes.has('lm-content-reveal-target'));
assert.equal(bioHeading.properties.get('--lm-content-reveal-delay'), '0ms');
assert.equal(bioCopy.properties.get('--lm-content-reveal-delay'), '48ms');
assert.equal(bioHeading.properties.get('--lm-content-reveal-distance'), '24px');
assert.equal(bioHeading.properties.get('--lm-content-reveal-duration'), '560ms');
assert.equal(filterRail.properties.get('--lm-content-reveal-distance'), '18px',
  'Untuned targets must retain the existing short movement distance.');
assert.equal(filterRail.properties.get('--lm-content-reveal-duration'), '480ms',
  'The profile must not change unrelated page targets.');
assert.equal(observer.options.threshold, 0.01,
  'Content reveal should start close to viewport entry without waiting for 10% of each target.');
assert.equal(observer.options.rootMargin, '0px 0px 96px 0px',
  'Scroll reveals should trigger slightly before each target enters the viewport.');
assert.equal(reviewHeading.dataset.lmContentRevealMotion, 'position-only',
  'The Contact heading must keep its text opaque while the heading reveal is pending.');
assert.equal(bioHeading.dataset.lmContentRevealMotion, 'position-only',
  'Text-bearing content must remain opaque while its translate reveal is pending.');

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
for (const target of [bioHeading, bioCopy, filterRail, reviewHeading]) {
  assert.ok(!target.classes.has('lm-content-reveal-target'));
  assert.ok(!target.classes.has('is-lm-content-revealed'));
  assert.equal(target.dataset.lmContentRevealState, undefined);
  assert.equal(target.dataset.lmContentRevealMotion, undefined);
  assert.equal(target.properties.has('--lm-content-reveal-delay'), false);
  assert.equal(target.properties.has('--lm-content-reveal-distance'), false);
  assert.equal(target.properties.has('--lm-content-reveal-duration'), false);
  assert.equal(target.properties.has('--lm-content-reveal-ease'), false);
}
assert.equal(mediaListeners.size, 0);

console.log('Content reveal interaction, reduced-motion, decoupling, and cleanup contracts validated.');
