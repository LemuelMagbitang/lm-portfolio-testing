import assert from 'node:assert/strict';
import { resolvePortfolioRoute, resolveRouteDataPrefetchEntries } from '../js/app/page-navigation.js?v=20261031-05';

const siteRoot = 'https://example.test/portfolio/';
assert.equal(resolvePortfolioRoute('https://example.test/portfolio/', siteRoot), 'design');
assert.equal(resolvePortfolioRoute('https://example.test/portfolio/index.html', siteRoot), 'design');
assert.equal(resolvePortfolioRoute('https://example.test/portfolio/about/', siteRoot), 'about');
assert.equal(resolvePortfolioRoute('https://example.test/portfolio/about', siteRoot), 'about');
assert.equal(resolvePortfolioRoute('https://example.test/portfolio/about/index.html', siteRoot), 'about');
assert.equal(resolvePortfolioRoute('https://example.test/portfolio/admin/', siteRoot), null);
assert.equal(resolvePortfolioRoute('https://example.test/other/', siteRoot), null);
assert.equal(resolvePortfolioRoute('https://external.test/portfolio/about/', siteRoot), null);
assert.equal(resolvePortfolioRoute('not a valid url', siteRoot), null);

const routeDataUrls = {
  settings: 'data/settings.json',
  projects: 'data/projects.json',
  reviews: 'data/reviews.json',
  about: 'data/about.json',
  heroLoop: 'data/hero-loop.json',
  footerLoop: 'data/footer-loop.json'
};
const aboutWarmup = resolveRouteDataPrefetchEntries(routeDataUrls, 'about');
assert.deepEqual(
  aboutWarmup.map(([key]) => key),
  ['about'],
  'About route prefetch should warm only its route-specific profile payload.'
);
const designWarmup = resolveRouteDataPrefetchEntries(routeDataUrls, 'design');
assert.deepEqual(
  designWarmup.map(([key]) => key),
  ['projects'],
  'Design route prefetch should warm the project feed but not shared or About-only data.'
);
assert.ok(!designWarmup.some(([key]) => ['settings', 'reviews', 'about', 'heroLoop', 'footerLoop'].includes(key)));
assert.deepEqual(resolveRouteDataPrefetchEntries(routeDataUrls, 'unsupported'), []);
assert.deepEqual(
  resolveRouteDataPrefetchEntries({ settings: ' ', projects: '', about: 'data/about.json' }, 'about', {}),
  [['about', 'data/about.json']]
);

console.log('Client-side page route contract passed.');
