import assert from 'node:assert/strict';
import {
  getSiteRootUrl,
  siteAssetUrl
} from '../js/infrastructure/browser/site-paths.js?v=20261027-01';

function makeScript(documentUrl, src) {
  return {
    getAttribute(name) {
      return name === 'src' ? src : null;
    },
    src: new URL(src, documentUrl).href
  };
}

function harness({ pageUrl, scriptSrc, siteRootUrl = '' }) {
  const documentRef = {
    baseURI: pageUrl,
    scripts: scriptSrc ? [makeScript(pageUrl, scriptSrc)] : []
  };
  const windowRef = {
    SITE_ROOT_URL: siteRootUrl,
    location: { href: pageUrl }
  };
  return { documentRef, windowRef };
}

const deployments = [
  {
    name: 'production user site at domain root',
    root: 'https://lemuelmagbitang.github.io/',
    page: 'https://lemuelmagbitang.github.io/about/',
    script: '../js/script.js?v=production',
  },
  {
    name: 'project Pages site with an existing repo prefix',
    root: 'https://example.github.io/lm-portfolio-testing/',
    page: 'https://example.github.io/lm-portfolio-testing/about/',
    script: '../js/script.js?v=preview',
  },
  {
    name: 'project Pages site after repository rename',
    root: 'https://example.github.io/new-portfolio-repo/',
    page: 'https://example.github.io/new-portfolio-repo/about/',
    script: '../js/script.js?v=preview',
  },
  {
    name: 'project Pages home route',
    root: 'https://example.github.io/renamed-project/',
    page: 'https://example.github.io/renamed-project/',
    script: 'js/script.js?v=preview',
  }
];

for (const deployment of deployments) {
  const options = harness({
    pageUrl: deployment.page,
    scriptSrc: deployment.script
  });
  assert.equal(
    getSiteRootUrl(options),
    deployment.root,
    deployment.name + ': site root must be discovered from the entry script rather than a hard-coded repository name'
  );
  assert.equal(
    siteAssetUrl('assets/projects/site/portfolio-logo.webp', options),
    new URL('assets/projects/site/portfolio-logo.webp', deployment.root).href,
    deployment.name + ': relative media assets must resolve against the discovered site root'
  );
  assert.equal(
    siteAssetUrl('/assets/projects/site/portfolio-logo.webp', options),
    new URL('assets/projects/site/portfolio-logo.webp', deployment.root).href,
    deployment.name + ': leading-slash CMS paths must stay inside a project-site prefix'
  );
}

const fallbackRoutes = [
  {
    name: 'about route without an entry script',
    pageUrl: 'https://example.github.io/renamed-project/about/',
    expected: 'https://example.github.io/renamed-project/'
  },
  {
    name: 'admin route without an entry script',
    pageUrl: 'https://example.github.io/renamed-project/admin/videos.html',
    expected: 'https://example.github.io/renamed-project/'
  },
  {
    name: 'success route without an entry script',
    pageUrl: 'https://example.github.io/renamed-project/success/',
    expected: 'https://example.github.io/renamed-project/'
  },
  {
    name: 'root user-site fallback',
    pageUrl: 'https://lemuelmagbitang.github.io/about/',
    expected: 'https://lemuelmagbitang.github.io/'
  }
];

for (const route of fallbackRoutes) {
  const options = harness({ pageUrl: route.pageUrl, scriptSrc: '' });
  assert.equal(getSiteRootUrl(options), route.expected, route.name);
}

const configured = harness({
  pageUrl: 'https://example.github.io/renamed-project/admin/',
  scriptSrc: '',
  siteRootUrl: '../'
});
assert.equal(
  getSiteRootUrl(configured),
  'https://example.github.io/renamed-project/',
  'explicit root overrides must resolve relative to the current page and normalize a trailing slash'
);
assert.equal(
  siteAssetUrl('https://cdn.example.org/media.jpg', configured),
  'https://cdn.example.org/media.jpg',
  'approved absolute media URLs must remain unchanged'
);
assert.equal(
  siteAssetUrl('javascript:alert(1)', configured),
  '',
  'executable URI schemes must remain rejected'
);
const unsafeLocalPaths = [
  '../assets/projects/site/portfolio-logo.webp',
  'assets/../data/projects.json',
  '/assets/../../admin/admin.js',
  'assets/%2e%2e/data/projects.json',
  'assets%2F%2e%2e%2Fdata/projects.json',
  'assets/%252e%252e/data/projects.json',
  'assets/%2e%2e%5cdata/projects.json',
  'assets/%00/hidden.webp'
];
for (const value of unsafeLocalPaths) {
  assert.equal(
    siteAssetUrl(value, configured),
    '',
    'asset paths that could escape the current site root must be rejected: ' + value
  );
}
assert.equal(
  siteAssetUrl('assets/cover.webp?variant=../preview', configured),
  'https://example.github.io/renamed-project/assets/cover.webp?variant=../preview',
  'query strings must not be mistaken for path traversal'
);

console.log('Site path portability: PASS');
console.log(' - Production root and GitHub Pages repository-prefix deployments');
console.log(' - Repository rename and relative media URL resolution');
console.log(' - About/admin/success fallback route resolution');
console.log(' - Explicit root override and unsafe scheme handling');
