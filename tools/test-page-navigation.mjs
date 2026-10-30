import assert from 'node:assert/strict';
import { resolvePortfolioRoute } from '../js/app/page-navigation.js?v=20261031-01';

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

console.log('Client-side page route contract passed.');
