import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initContentReveal } from '../js/features/content-reveal/index.js?v=20261031-03';

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
const revealGroupsSource = revealSource.match(/const REVEAL_TARGET_GROUPS = \[([\s\S]*?)\n\];/)?.[1] || '';
assert.match(revealGroupsSource, /#softwareSkillsList > li/);
assert.match(revealGroupsSource, /#multimediaSkillsList > li/);
assert.match(revealGroupsSource, /#experienceList > \*/);
assert.match(revealGroupsSource, /#educationList > \*/);
assert.match(revealGroupsSource, /#awardsList > \*/);
assert.ok(revealGroupsSource.includes("motion: { distance: 16, durationMs: 520, staggerStepMs: 36, staggerMaxMs: 108 }"),
  'About hero content must use the scoped staggered entrance profile without changing unrelated sections.');
assert.match(revealGroupsSource, /selector: 'main\.works-main > \.filter-nav-wrapper'[\s\S]*?animateOnSoftNavigation: true/,
  'The Design filter rail must retain its entrance motion during SPA route handoffs.');
assert.match(revealGroupsSource, /selector: '#portfolioGridViewport'[\s\S]*?animateOnSoftNavigation: true[\s\S]*?motion: \{ distance: 10, durationMs: 480, startDelayMs: 64, staggerStepMs: 0, staggerMaxMs: 0 \}/,
  'The Design grid viewport must follow the filter rail with a restrained position-only entrance.');
assert.match(revealGroupsSource, /#contact-section #web3-forms-container > \.contact-block > h2/);
assert.doesNotMatch(revealGroupsSource, /\.contact-mobile-tab/,
  'Contact tabs already have their own moving pill and drag state; they must not receive generic reveal transforms.');
assert.doesNotMatch(revealGroupsSource, /\.form-container/,
  'Interactive form containers must not be translated independently of their paired form rows.');
assert.match(revealSource, /prefers-reduced-motion: reduce/);
assert.match(revealSource, /const STAGGER_STEP_MS = 32;/);
assert.match(revealSource, /const STAGGER_MAX_MS = 112;/);
assert.match(revealSource, /'cubic-bezier\(.22,1,.36,1\)'/);
assert.match(revealCss, /opacity 420ms/);
assert.match(revealSource, /pendingTargets\.forEach\(revealTarget\)/,
  'A live reduced-motion preference change must reveal pending content immediately.');
assert.match(revealSource, /observer\?\.disconnect\?\.\(\)/);
assert.match(revealSource, /target\.style\?\.removeProperty\?\.\('--lm-content-reveal-delay'\)/);
assert.doesNotMatch(revealSource, /\.project-card|#lightboxMediaContainer|\.hero-banner/,
  'Gallery cards, Lightbox media, and animated hero artwork remain owned by their existing features.');
assert.match(revealCss, /opacity 420ms[\s\S]*?translate var\(--lm-content-reveal-duration, 460ms\)/);
assert.match(revealCss, /prefers-reduced-motion:\s*reduce/);
assert.match(revealCss, /focus-within/);
assert.match(mainStyles, /#contactReviewPanel > \.section-title\s*\{[^}]*color:\s*#bdbdbd\s*!important;[^}]*mix-blend-mode:\s*normal\s*!important;/,
  'The review heading must keep a high-contrast, non-blended foreground.');
assert.match(mainStyles, /button\.submit-btn\.submit-btn-secondary\s*\{[^}]*color:\s*#fff\s*!important;[^}]*-webkit-text-fill-color:\s*#fff\s*!important;[^}]*background:\s*#242424\s*!important;[^}]*mix-blend-mode:\s*normal\s*!important;[^}]*isolation:\s*isolate\s*!important;/,
  'The review submit button must use its own high-contrast surface even if rendered outside its original panel.');
assert.match(compositionSource, /content-reveal\/index\.js\?v=20261031-03/);
assert.match(compositionSource, /contentRevealFeature\?\.destroy\?\.\(\)/);
assert.match(bootstrapSource, /app\?\.contentReveal\?\.refresh\?\.\(\)/);
assert.ok(
  bootstrapSource.indexOf('hideInitialPageTransition();') < bootstrapSource.indexOf('app?.contentReveal?.refresh?.()'),
  'Initial content reveal must start after the branded page-transition gate closes.'
);
assert.match(rootHtml, /href="css\/features\/content-reveal\.css\?v=20261031-05"/);
assert.match(aboutHtml, /href="\.\.\/css\/features\/content-reveal\.css\?v=20261031-05"/);

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
const skillHeadingA = makeTarget('skill-heading-a');
const skillHeadingB = makeTarget('skill-heading-b');
const skillItemA = makeTarget('skill-item-a');
const skillItemB = makeTarget('skill-item-b');
const skillItemC = makeTarget('multimedia-skill-item-a');
const skillItemD = makeTarget('multimedia-skill-item-b');
const resumeHeadingA = makeTarget('resume-heading-a');
const resumeHeadingB = makeTarget('resume-heading-b');
const experienceA = makeTarget('experience-a');
const experienceB = makeTarget('experience-b');
const educationA = makeTarget('education-a');
const awardsA = makeTarget('awards-a');
const filterRail = makeTarget('filter-rail');
const projectGridViewport = makeTarget('project-grid-viewport');
const reviewHeading = makeTarget('review-heading');
selectorTargets.set('.about-hero .about-bio-text > *', [bioHeading, bioCopy]);
selectorTargets.set('.about-page main .resume-skills-row > .resume-block > h3', [skillHeadingA, skillHeadingB]);
selectorTargets.set('#softwareSkillsList > li', [skillItemA, skillItemB]);
selectorTargets.set('#multimediaSkillsList > li', [skillItemC, skillItemD]);
selectorTargets.set('.about-page main .resume-main > .resume-block > h3', [resumeHeadingA, resumeHeadingB]);
selectorTargets.set('#experienceList > *', [experienceA, experienceB]);
selectorTargets.set('#educationList > *', [educationA]);
selectorTargets.set('#awardsList > *', [awardsA]);
selectorTargets.set('main.works-main > .filter-nav-wrapper', [filterRail]);
selectorTargets.set('#portfolioGridViewport', [projectGridViewport]);
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
assert.equal(feature.refresh(), 17, 'The first explicit refresh must attach About and Works reveal targets.');
const observer = observers[0];

assert.ok(observer, 'A single observer must be created for the feature.');
assert.equal(observer.observed.size, 17);
assert.equal(feature.refresh(), 0, 'Refresh must not attach duplicate observers to an existing target.');
assert.ok(bioHeading.classes.has('lm-content-reveal-target'));
assert.equal(bioHeading.properties.get('--lm-content-reveal-delay'), '0ms');
assert.equal(bioCopy.properties.get('--lm-content-reveal-delay'), '36ms');
assert.equal(bioHeading.properties.get('--lm-content-reveal-distance'), '16px');
assert.equal(bioHeading.properties.get('--lm-content-reveal-duration'), '520ms');
assert.equal(bioHeading.properties.get('--lm-content-reveal-ease'), 'cubic-bezier(.22,1,.36,1)');
assert.equal(skillHeadingA.properties.get('--lm-content-reveal-delay'), '0ms');
assert.equal(skillHeadingB.properties.get('--lm-content-reveal-delay'), '32ms');
assert.equal(skillItemA.properties.get('--lm-content-reveal-duration'), '440ms');
assert.equal(skillItemA.properties.get('--lm-content-reveal-delay'), '0ms');
assert.equal(skillItemB.properties.get('--lm-content-reveal-delay'), '28ms');
assert.equal(skillItemC.properties.get('--lm-content-reveal-delay'), '0ms');
assert.equal(skillItemD.properties.get('--lm-content-reveal-delay'), '28ms',
  'The Multimedia Skills column must restart its own stagger instead of inheriting the Software Skills delay.');
assert.equal(experienceA.properties.get('--lm-content-reveal-delay'), '0ms');
assert.equal(experienceB.properties.get('--lm-content-reveal-delay'), '28ms');
assert.equal(educationA.properties.get('--lm-content-reveal-delay'), '0ms',
  'Each About timeline section must restart its own stagger.');
assert.equal(awardsA.properties.get('--lm-content-reveal-delay'), '0ms',
  'Award entries must not inherit delay from earlier resume sections.');
assert.equal(filterRail.properties.get('--lm-content-reveal-distance'), '14px',
  'Untuned targets must retain the existing short movement distance.');
assert.equal(filterRail.properties.get('--lm-content-reveal-duration'), '460ms',
  'The profile must not change unrelated page targets.');
assert.equal(projectGridViewport.properties.get('--lm-content-reveal-distance'), '10px');
assert.equal(projectGridViewport.properties.get('--lm-content-reveal-duration'), '480ms');
assert.equal(projectGridViewport.properties.get('--lm-content-reveal-delay'), '64ms');
assert.equal(projectGridViewport.dataset.lmContentRevealMotion, 'position-only',
  'The grid viewport must move as a unit without fading or hiding readable project content.');
assert.equal(observer.options.threshold, 0.01,
  'Content reveal should start close to viewport entry without waiting for 10% of each target.');
assert.equal(observer.options.rootMargin, '0px 0px 96px 0px',
  'Scroll reveals should trigger slightly before each target enters the viewport.');
assert.equal(reviewHeading.dataset.lmContentRevealMotion, 'position-only',
  'The Contact heading must keep its text opaque while the heading reveal is pending.');
assert.equal(bioHeading.dataset.lmContentRevealMotion, 'position-only',
  'Text-bearing content must remain opaque while its translate reveal is pending.');

observer.callback([
  { target: bioHeading, isIntersecting: true, intersectionRatio: 0.5 },
  { target: projectGridViewport, isIntersecting: true, intersectionRatio: 0.5 }
]);
assert.ok(projectGridViewport.classes.has('is-lm-content-revealed'));
assert.equal(projectGridViewport.dataset.lmContentRevealState, 'shown');
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
for (const target of [bioHeading, bioCopy, skillHeadingA, skillHeadingB, skillItemA, skillItemB, skillItemC, skillItemD, resumeHeadingA, resumeHeadingB, experienceA, experienceB, educationA, awardsA, filterRail, projectGridViewport, reviewHeading]) {
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

// Soft-navigation policy: About's ordinary first-viewport targets are mounted
// immediately, while the Design filter/grid targets opt into their own entrance.
motionQuery.matches = false;
windowRef.innerHeight = 900;
bioHeading.getBoundingClientRect = () => ({ bottom: 120, top: 40 });
filterRail.getBoundingClientRect = () => ({ bottom: 360, top: 280 });
projectGridViewport.getBoundingClientRect = () => ({ bottom: 760, top: 420 });
const softNavigationFeature = initContentReveal({
  root,
  windowRef,
  immediateVisible: true
});
assert.equal(softNavigationFeature.refresh(), 17);
assert.equal(bioHeading.dataset.lmContentRevealState, 'shown',
  'Ordinary visible About content must remain immediate during soft navigation.');
assert.equal(filterRail.dataset.lmContentRevealState, 'pending',
  'The Design filter rail must still animate during an SPA route handoff.');
assert.equal(projectGridViewport.dataset.lmContentRevealState, 'pending',
  'The Design grid must still animate during an SPA route handoff.');
assert.equal(projectGridViewport.dataset.lmContentRevealMotion, 'position-only');
softNavigationFeature.destroy();
assert.equal(mediaListeners.size, 0);

console.log('Content reveal interaction, soft-navigation choreography, reduced-motion, decoupling, and cleanup contracts validated.');
