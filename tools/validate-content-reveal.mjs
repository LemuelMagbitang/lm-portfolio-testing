import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initContentReveal } from '../js/features/content-reveal/index.js?v=20261101-04';

const revealSource = await readFile(new URL('../js/features/content-reveal/index.js', import.meta.url), 'utf8');
const revealCss = await readFile(new URL('../css/features/content-reveal.css', import.meta.url), 'utf8');
const mainStyles = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
const compositionSource = await readFile(new URL('../js/app/page-composition.js', import.meta.url), 'utf8');
const bootstrapSource = await readFile(new URL('../js/app/bootstrap.js', import.meta.url), 'utf8');
const heroSource = await readFile(new URL('../js/features/hero/index.js', import.meta.url), 'utf8');
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
assert.ok(revealGroupsSource.includes("motion: { distance: 24, durationMs: 560, staggerStepMs: 48, staggerMaxMs: 144 }"),
  'About hero must retain its established reveal profile.');
assert.match(revealGroupsSource, /selector: '\.hero-section:not\(\.about-hero\)'[\s\S]*?distance: 12,[\s\S]*?mobileDistance: 8,[\s\S]*?durationMs: 460,[\s\S]*?threshold: 0\.01/,
  'The Works hero must use a short fade/translate entrance without changing About.');
assert.match(revealGroupsSource, /selector: 'main\.works-main > \.filter-nav-wrapper, #portfolioGridViewport'[\s\S]*?profile: 'animated-content'[\s\S]*?distance: 20,[\s\S]*?mobileDistance: 12,[\s\S]*?durationMs: 480,[\s\S]*?threshold: 0\.05,[\s\S]*?staggerStepMs: 48,[\s\S]*?staggerMaxMs: 48/,
  'The AnimatedContent-inspired profile must be confined to Design and remain brief.');
assert.match(revealGroupsSource, /#contact-section #web3-forms-container > \.contact-block > h2/);
assert.doesNotMatch(revealGroupsSource, /\.contact-mobile-tab/,
  'Contact tabs already have their own moving pill and drag state; they must not receive generic reveal transforms.');
assert.doesNotMatch(revealGroupsSource, /\.form-container/,
  'Interactive form containers must not be translated independently of their paired form rows.');
assert.match(revealSource, /prefers-reduced-motion: reduce/);
assert.match(revealSource, /const STAGGER_STEP_MS = 44;/);
assert.match(revealSource, /const STAGGER_MAX_MS = 160;/);
assert.match(revealSource, /DEFAULT_REVEAL_EASE/);
assert.match(revealCss, /opacity var\(--lm-content-reveal-duration, 480ms\)/);
assert.match(revealSource, /pendingTargets\.forEach\(revealTarget\)/,
  'A live reduced-motion preference change must reveal pending content immediately.');
assert.match(revealSource, /observer\?\.disconnect\?\.\(\)/);
assert.match(revealSource, /target\.style\?\.removeProperty\?\.\('--lm-content-reveal-delay'\)/);
assert.doesNotMatch(revealSource, /\.project-card|#lightboxMediaContainer|\.hero-banner/,
  'Gallery cards, Lightbox media, and animated hero artwork remain owned by their existing features.');
assert.match(revealCss, /opacity var\(--lm-content-reveal-duration, 480ms\)[\s\S]*?translate var\(--lm-content-reveal-duration, 480ms\)/);
assert.match(revealCss, /prefers-reduced-motion:\s*reduce/);
assert.match(revealCss, /focus-within/);
assert.match(revealCss, /--lm-content-reveal-distance:\s*12px\s*!important;/,
  "The narrow Design grid entrance must honor its reduced 18px travel distance.");
assert.match(mainStyles, /#contactReviewPanel > \.section-title\s*\{[^}]*color:\s*#bdbdbd\s*!important;[^}]*mix-blend-mode:\s*normal\s*!important;/,
  'The review heading must keep a high-contrast, non-blended foreground.');
assert.match(mainStyles, /button\.submit-btn\.submit-btn-secondary\s*\{[^}]*color:\s*#fff\s*!important;[^}]*-webkit-text-fill-color:\s*#fff\s*!important;[^}]*background:\s*#242424\s*!important;[^}]*mix-blend-mode:\s*normal\s*!important;[^}]*isolation:\s*isolate\s*!important;/,
  'The review submit button must use its own high-contrast surface even if rendered outside its original panel.');
assert.match(compositionSource, /content-reveal\/index\.js\?v=20261101-04/);
assert.match(compositionSource, /contentRevealFeature\?\.destroy\?\.\(\)/);
assert.match(bootstrapSource, /app\?\.contentReveal\?\.refresh\?\.\(\)/);
assert.match(heroSource, /firstSlidePoster[\s\S]*?waitForHeroMedia\(firstSlidePoster, 'image', windowRef, 1500\)/,
  'The first hero poster should settle before the loading gate closes, without waiting for video playback.');
assert.match(compositionSource, /const \[settingsFeature\] = await Promise\.all\(\[settingsPromise\]\)/,
  'The Works first viewport must not wait for normalized project data.');
assert.match(compositionSource, /if \(initialContactNavigation\) \{[\s\S]*?settleInBackground\(heroPromise,[\s\S]*?galleryFeature = await galleryPromise;[\s\S]*?galleryFeatureRef = galleryFeature;/,
  'Direct Contact-anchor loads must not wait for the off-screen Hero poster, but must settle Gallery layout before anchor positioning.');
assert.doesNotMatch(compositionSource, /if \(hasProjectGallery\) await projectsPromise/,
  'Gallery hydration must not hold the initial first viewport.');
assert.match(compositionSource, /settleInBackground\(\s*galleryPromise/,
  'The Gallery must settle in the background after the first Hero is available.');
assert.ok(
  bootstrapSource.indexOf('hideInitialPageTransition();') < bootstrapSource.indexOf('app?.contentReveal?.refresh?.()'),
  'Initial content reveal must start after the branded page-transition gate closes.'
);
assert.match(rootHtml, /href="css\/features\/content-reveal\.css\?v=20261101-04"/);
assert.match(aboutHtml, /href="\.\.\/css\/features\/content-reveal\.css\?v=20261101-04"/);
assert.doesNotMatch(aboutHtml, /<link\b[^>]*rel=["']preload["'][^>]*profile\.jpg/i,
  'The About profile image must not keep a redundant head preload that can become unused after a soft route handoff.');
assert.match(aboutHtml, /id="aboutPhoto"[^>]*loading="eager"[^>]*fetchpriority="high"/,
  'The visible About portrait must retain eager, high-priority loading.');

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
const designHero = makeTarget('design-hero');
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
selectorTargets.set('.hero-section:not(.about-hero)', [designHero]);
selectorTargets.set('main.works-main > .filter-nav-wrapper, #portfolioGridViewport', [filterRail, projectGridViewport]);
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
assert.equal(feature.refresh(), 18, 'The first explicit refresh must attach About and Works reveal targets.');
const observer = observers[0];

assert.ok(observer, 'A single observer must be created for the feature.');
assert.equal(observer.observed.size, 18);
assert.equal(feature.refresh(), 0, 'Refresh must not attach duplicate observers to an existing target.');
assert.ok(bioHeading.classes.has('lm-content-reveal-target'));
assert.equal(bioHeading.properties.get('--lm-content-reveal-delay'), '0ms');
assert.equal(bioCopy.properties.get('--lm-content-reveal-delay'), '48ms');
assert.equal(bioHeading.properties.get('--lm-content-reveal-distance'), '24px');
assert.equal(bioHeading.properties.get('--lm-content-reveal-duration'), '560ms');
assert.equal(bioHeading.properties.get('--lm-content-reveal-ease'), 'cubic-bezier(.16,1,.3,1)');
assert.equal(bioHeading.dataset.lmContentRevealThreshold, '0.01');
assert.equal(skillHeadingA.properties.get('--lm-content-reveal-delay'), '0ms');
assert.equal(skillHeadingB.properties.get('--lm-content-reveal-delay'), '44ms');
assert.equal(skillItemA.properties.get('--lm-content-reveal-duration'), '460ms');
assert.equal(skillItemA.properties.get('--lm-content-reveal-delay'), '0ms');
assert.equal(skillItemB.properties.get('--lm-content-reveal-delay'), '32ms');
assert.equal(skillItemC.properties.get('--lm-content-reveal-delay'), '0ms');
assert.equal(skillItemD.properties.get('--lm-content-reveal-delay'), '32ms',
  'The Multimedia Skills column must restart its own stagger instead of inheriting the Software Skills delay.');
assert.equal(experienceA.properties.get('--lm-content-reveal-delay'), '0ms');
assert.equal(experienceB.properties.get('--lm-content-reveal-delay'), '30ms');
assert.equal(educationA.properties.get('--lm-content-reveal-delay'), '0ms',
  'Each About timeline section must restart its own stagger.');
assert.equal(awardsA.properties.get('--lm-content-reveal-delay'), '0ms',
  'Award entries must not inherit delay from earlier resume sections.');
assert.equal(designHero.properties.get('--lm-content-reveal-distance'), '12px');
assert.equal(designHero.properties.get('--lm-content-reveal-duration'), '460ms');
assert.equal(designHero.dataset.lmContentRevealThreshold, '0.01');
assert.equal(designHero.dataset.lmContentRevealMotion, 'position-only');
assert.equal(filterRail.properties.get('--lm-content-reveal-distance'), '20px');
assert.equal(filterRail.properties.get('--lm-content-reveal-duration'), '480ms');
assert.equal(filterRail.properties.get('--lm-content-reveal-delay'), '0ms');
assert.equal(filterRail.properties.get('--lm-content-reveal-ease'), 'cubic-bezier(.22,1,.36,1)');
assert.equal(filterRail.dataset.lmContentRevealThreshold, '0.05');
assert.equal(filterRail.dataset.lmContentRevealProfile, 'animated-content');
assert.equal(projectGridViewport.properties.get('--lm-content-reveal-distance'), '20px');
assert.equal(projectGridViewport.properties.get('--lm-content-reveal-duration'), '480ms');
assert.equal(projectGridViewport.properties.get('--lm-content-reveal-delay'), '48ms');
assert.equal(projectGridViewport.dataset.lmContentRevealThreshold, '0.05');
assert.equal(projectGridViewport.dataset.lmContentRevealMotion, 'position-only',
  'The grid viewport must move as a unit without fading or hiding readable project content.');
assert.deepEqual(observer.options.threshold, [0.01, 0.05],
  'Observer supports the default and Design entrance visibility thresholds.');
assert.equal(observer.options.rootMargin, '0px 0px 96px 0px',
  'Scroll reveals should trigger slightly before each target enters the viewport.');
assert.equal(reviewHeading.dataset.lmContentRevealMotion, 'position-only',
  'The Contact heading must keep its text opaque while the heading reveal is pending.');
assert.equal(bioHeading.dataset.lmContentRevealMotion, 'position-only',
  'Text-bearing content must remain opaque while its translate reveal is pending.');

observer.callback([{ target: projectGridViewport, isIntersecting: true, intersectionRatio: 0.03 }]);
assert.equal(projectGridViewport.dataset.lmContentRevealState, 'pending', 'Design must wait for its visibility threshold.');
observer.callback([
  { target: bioHeading, isIntersecting: true, intersectionRatio: 0.5 },
  { target: designHero, isIntersecting: true, intersectionRatio: 0.05 },
  { target: projectGridViewport, isIntersecting: true, intersectionRatio: 0.05 }
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
for (const target of [bioHeading, bioCopy, skillHeadingA, skillHeadingB, skillItemA, skillItemB, skillItemC, skillItemD, resumeHeadingA, resumeHeadingB, experienceA, experienceB, educationA, awardsA, designHero, filterRail, projectGridViewport, reviewHeading]) {
  assert.ok(!target.classes.has('lm-content-reveal-target'));
  assert.ok(!target.classes.has('is-lm-content-revealed'));
  assert.equal(target.dataset.lmContentRevealState, undefined);
  assert.equal(target.dataset.lmContentRevealMotion, undefined);
  assert.equal(target.dataset.lmContentRevealThreshold, undefined);
  assert.equal(target.dataset.lmContentRevealProfile, undefined);
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
designHero.getBoundingClientRect = () => ({ bottom: 520, top: 40 });
filterRail.getBoundingClientRect = () => ({ bottom: 360, top: 280 });
projectGridViewport.getBoundingClientRect = () => ({ bottom: 760, top: 420 });
const softNavigationFeature = initContentReveal({
  root,
  windowRef,
  immediateVisible: true
});
assert.equal(softNavigationFeature.refresh(), 18);
assert.equal(bioHeading.dataset.lmContentRevealState, 'shown',
  'Ordinary visible About content must remain immediate during soft navigation.');
assert.equal(designHero.dataset.lmContentRevealState, 'pending',
  'The Design hero must still animate during an SPA route handoff.');
assert.equal(filterRail.dataset.lmContentRevealState, 'pending',
  'The Design filter rail must still animate during an SPA route handoff.');
assert.equal(projectGridViewport.dataset.lmContentRevealState, 'pending',
  'The Design grid must still animate during an SPA route handoff.');
assert.equal(projectGridViewport.dataset.lmContentRevealMotion, 'position-only');
softNavigationFeature.destroy();
assert.equal(mediaListeners.size, 0);
windowRef.innerWidth = 390;
const mobileFeature = initContentReveal({ root, windowRef });
assert.equal(mobileFeature.refresh(), 18);
assert.equal(designHero.properties.get('--lm-content-reveal-distance'), '8px',
  'The Works hero entrance must use a shorter travel distance on narrow viewports.');
assert.equal(filterRail.properties.get('--lm-content-reveal-distance'), '12px',
  'Design movement must be reduced on narrow viewports.');
mobileFeature.destroy();

console.log('Content reveal interaction, soft-navigation choreography, reduced-motion, decoupling, and cleanup contracts validated.');
