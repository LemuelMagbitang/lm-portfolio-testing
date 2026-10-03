#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const errors = [];
const warnings = [];

const LOCAL_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg',
  '.mp4', '.webm', '.mov', '.m4v', '.json',
  '.obj', '.mtl', '.gltf', '.glb', '.fbx'
]);
const SUPPORTED_MEDIA = new Set(['image', 'video', 'youtube', 'lottie', 'model']);
const SUPPORTED_MODEL_EXT = new Set(['obj', 'gltf', 'glb', 'fbx']);
const ORIENTATIONS = new Set(['', 'auto', 'landscape', 'portrait', 'square']);

function readText(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function exists(file) {
  return fs.existsSync(path.join(ROOT, file));
}

function err(message) {
  errors.push(message);
}
function warn(message) {
  warnings.push(message);
}

function parseJson(file, fallback = null) {
  if (!exists(file)) {
    err(`${file} is missing.`);
    return fallback;
  }
  try {
    return JSON.parse(readText(file));
  } catch (e) {
    err(`${file} is not valid JSON: ${e.message}`);
    return fallback;
  }
}

function isExternal(value) {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(String(value || '')) || /^(?:data|blob):/i.test(String(value || ''));
}

function normalizeLocalRef(value) {
  const raw = String(value || '').trim();
  if (!raw || isExternal(raw) || raw.startsWith('#')) return null;
  return raw.replace(/^\.\//, '').replace(/^\/+/, '').split(/[?#]/)[0];
}

function checkLocalRef(value, where) {
  const local = normalizeLocalRef(value);
  if (!local) return;
  if (!exists(local)) err(`${where}: missing local file "${local}".`);
}

function extension(value) {
  return path.extname(String(value || '').split(/[?#]/)[0]).slice(1).toLowerCase();
}

function checkBackground(background, where) {
  if (!background || typeof background !== 'object') return;
  if (background.image?.src) checkLocalRef(background.image.src, `${where} background.image.src`);
  if (background.video?.src) checkLocalRef(background.video.src, `${where} background.video.src`);
  if (background.type && !new Set(['solid', 'gradient', 'pattern', 'image', 'video', 'shader']).has(background.type)) {
    err(`${where}: unsupported background type "${background.type}".`);
  }
}

function validateMedia(media, where) {
  if (!media || typeof media !== 'object') {
    err(`${where}: media item must be an object.`);
    return;
  }
  const type = media.type;
  if (!SUPPORTED_MEDIA.has(type)) err(`${where}: unsupported media type "${type}".`);
  if (!media.src || typeof media.src !== 'string') {
    err(`${where}: media source is empty.`);
  } else if (type === 'lottie') {
    const ext = extension(media.src);
    if (!isExternal(media.src) && ext !== 'json') err(`${where}: Lottie source should be a .json file, got .${ext || 'none'}.`);
    checkLocalRef(media.src, `${where} src`);
  } else if (type === 'model') {
    const ext = extension(media.src);
    if (!isExternal(media.src) && !SUPPORTED_MODEL_EXT.has(ext)) err(`${where}: unsupported 3D extension .${ext || 'none'}.`);
    checkLocalRef(media.src, `${where} src`);
  } else if (type === 'video') {
    checkLocalRef(media.src, `${where} src`);
  } else if (type === 'image') {
    checkLocalRef(media.src, `${where} src`);
  }
  if (media.orientation !== undefined && !ORIENTATIONS.has(String(media.orientation))) {
    err(`${where}: invalid orientation "${media.orientation}".`);
  }
  checkBackground(media.background, where);
}

function validateFilters(filters) {
  if (!filters || typeof filters !== 'object' || !Array.isArray(filters.filters)) return;
  const ids = new Set();
  filters.filters.forEach((filter, i) => {
    const where = `data/filters.json filter ${i + 1}`;
    if (!filter || typeof filter !== 'object') {
      err(`${where}: filter must be an object.`);
      return;
    }
    const id = String(filter.id || '').trim();
    const label = String(filter.label || '').trim();
    if (!id) err(`${where}: missing id.`);
    else {
      if (ids.has(id)) err(`${where}: duplicate filter id "${id}".`);
      ids.add(id);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
        err(`${where}: id "${id}" must use lowercase letters, numbers, and hyphens only.`);
      }
    }
    if (!label) err(`${where}: missing label.`);
  });

  const badges = Array.isArray(filters.badges) ? filters.badges : [];
  const badgeNames = new Set();
  badges.forEach((badge, i) => {
    const value = String(badge || '').trim();
    if (!value) err(`data/filters.json badge ${i + 1}: badge cannot be empty.`);
    else if (badgeNames.has(value)) err(`data/filters.json: duplicate badge "${value}".`);
    else badgeNames.add(value);
  });
}

function validateReviews(reviews) {
  if (!Array.isArray(reviews)) return;
  reviews.forEach((review, i) => {
    const where = `data/reviews.json review ${i + 1}`;
    if (!review || typeof review !== 'object') return err(`${where}: review must be an object.`);
    const stars = Number(review.stars);
    if (!Number.isFinite(stars) || stars < 0 || stars > 5) err(`${where}: stars must be between 0 and 5.`);
    if (!String(review.quote || '').trim()) err(`${where}: quote is required.`);
    if (!String(review.author || '').trim()) warn(`${where}: author is empty.`);
  });
}

function validateHeroMessages(heroMessages) {
  if (!Array.isArray(heroMessages)) return;
  heroMessages.forEach((message, i) => {
    const where = `data/hero.json message ${i + 1}`;
    if (!message || typeof message !== 'object') return err(`${where}: message must be an object.`);
    if (!String(message.text || '').trim()) err(`${where}: text is required.`);
    const weight = Number(message.weight);
    if (!Number.isFinite(weight) || weight < 0) err(`${where}: weight must be non-negative.`);
    if (String(message.text || '').length > 180) warn(`${where}: text exceeds the 180-character public display cap and will be trimmed.`);
  });
}

function validateProjects(projects, filters) {
  if (!Array.isArray(projects)) return;
  const ids = new Set();
  const filterIds = new Set((filters?.filters || []).map(f => f?.id).filter(Boolean));

  projects.forEach((project, i) => {
    const where = `data/projects.json project ${i + 1}`;
    if (!project || typeof project !== 'object') return err(`${where}: project must be an object.`);
    if (!project.id) err(`${where}: missing id.`);
    else if (ids.has(project.id)) err(`${where}: duplicate project id "${project.id}".`);
    else ids.add(project.id);

    const projectFilters = Array.isArray(project.filters) ? project.filters : [];
    projectFilters.forEach(filter => {
      if (!filterIds.has(filter)) err(`${where}: filter "${filter}" is not defined in data/filters.json.`);
    });

    const thumb = project.thumbnail;
    if (thumb?.src) {
      checkLocalRef(thumb.src, `${where} thumbnail.src`);
      const thumbExt = extension(thumb.src);
      if (thumb.type === 'model' && !SUPPORTED_MODEL_EXT.has(thumbExt) && !isExternal(thumb.src)) {
        err(`${where}: thumbnail declared as model but source extension is .${thumbExt || 'none'}.`);
      }
      if (thumb.orientation !== undefined && !ORIENTATIONS.has(String(thumb.orientation))) {
        err(`${where}: invalid thumbnail orientation "${thumb.orientation}".`);
      }
    }
    checkBackground(thumb?.background, `${where} thumbnail`);

    const media = Array.isArray(project.media) ? project.media : [];
    if (!media.length) warn(`${where}: project has no media items.`);
    media.forEach((item, j) => validateMedia(item, `${where} media ${j + 1}`));
  });
}

function validateHeroLoop(heroLoop) {
  if (!Array.isArray(heroLoop)) return;
  heroLoop.forEach((item, i) => {
    const where = `data/hero-loop.json item ${i + 1}`;
    validateMedia(item, where);
    if (item?.fadeInMs !== undefined && (!Number.isFinite(Number(item.fadeInMs)) || Number(item.fadeInMs) < 0)) err(`${where}: fadeInMs must be non-negative.`);
    if (item?.fadeOutMs !== undefined && (!Number.isFinite(Number(item.fadeOutMs)) || Number(item.fadeOutMs) < 0)) err(`${where}: fadeOutMs must be non-negative.`);
  });
}

function validateAbout(about) {
  if (!about || typeof about !== 'object') return;
  const photo = typeof about.photo === 'string' ? about.photo : about.photo?.src;
  if (photo) checkLocalRef(photo, 'data/about.json photo');
  (about.softwareSkills || []).forEach((skill, i) => {
    if (skill && typeof skill === 'object' && skill.icon) checkLocalRef(skill.icon, `data/about.json softwareSkills ${i + 1} icon`);
  });
}

function validateHtml(file, expectedRoot = '') {
  if (!exists(file)) return;
  const html = readText(file);
  const badPatterns = [
    /\/data\/data\//i,
    /\/about\/data\//i,
    /\/about\/js\//i
  ];
  badPatterns.forEach(pattern => {
    if (pattern.test(html)) err(`${file}: contains a known bad site-path pattern ${pattern}.`);
  });

  const refs = [];
  const attrRe = /(?:src|href)=['"]([^'"]+)['"]/gi;
  let match;
  while ((match = attrRe.exec(html))) refs.push(match[1]);
  refs.forEach(ref => {
    if (!ref || ref.startsWith('#') || isExternal(ref) || /^mailto:|^tel:|^javascript:/i.test(ref)) return;
    const clean = ref.split(/[?#]/)[0];
    if (!clean || clean.startsWith('data:')) return;
    const baseDir = path.dirname(file);
    const resolved = path.normalize(path.join(baseDir, clean));
    if (resolved.startsWith('..')) return;
    const local = resolved.replaceAll(path.sep, '/');
    if (LOCAL_EXTENSIONS.has(path.extname(local).toLowerCase()) || /\/$/.test(clean) === false) {
      // Only fail paths that look like files; folder/page URLs are handled by GitHub Pages.
      if (path.extname(local) && !exists(local)) err(`${file}: missing local reference "${ref}".`);
    }
  });
}

function scanSourceForBadPatterns() {
  const candidates = ['index.html', 'about/index.html', 'js/script.js', 'js/model-viewer.js', 'js/media-background.js', 'css/style.css', 'admin/index.html', 'admin/admin.js', '.github/workflows/site-validation.yml'];

  candidates.filter(exists).forEach(file => {
    const text = readText(file);
    if (/\/data\/data\//i.test(text)) err(`${file}: contains /data/data/ path.`);
    if (/\/about\/data\//i.test(text)) err(`${file}: contains /about/data/ path.`);
    if (/\/about\/js\//i.test(text)) err(`${file}: contains /about/js/ path.`);
  });
}

function checkLargeAssets() {
  const assetRoot = path.join(ROOT, 'assets');
  if (!fs.existsSync(assetRoot)) return;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const size = fs.statSync(full).size;
        if (size > 4 * 1024 * 1024) warn(`Large asset (>4 MB): ${path.relative(ROOT, full)} (${(size / 1024 / 1024).toFixed(2)} MB). Consider a preview/derivative asset.`);
      }
    }
  }
  walk(assetRoot);
}

const filters = parseJson('data/filters.json', {});
const projects = parseJson('data/projects.json', []);
const settings = parseJson('data/settings.json', {});
const about = parseJson('data/about.json', {});
const heroLoop = parseJson('data/hero-loop.json', []);
parseJson('data/hero.json', []);
parseJson('data/reviews.json', []);

validateFilters(filters);
validateProjects(projects, filters);
validateHeroLoop(heroLoop);
validateAbout(about);

const reviews = parseJson('data/reviews.json', []);
const heroMessages = parseJson('data/hero.json', []);
validateReviews(reviews);
validateHeroMessages(heroMessages);

if (settings?.heroTiming) {
  const timing = settings.heroTiming;
  if (!['latest', 'manual', 'mixed'].includes(timing.loopMode)) err(`data/settings.json: invalid heroTiming.loopMode "${timing.loopMode}".`);
  if (!['kenburns', 'fade', 'none'].includes(timing.transitionStyle)) err(`data/settings.json: invalid heroTiming.transitionStyle "${timing.transitionStyle}".`);
  if (!Number.isFinite(Number(timing.crossfadeMs)) || Number(timing.crossfadeMs) < 500) err(`data/settings.json: heroTiming.crossfadeMs must be >= 500.`);
  ['fadeMs','autoRotateMs'].forEach(key => {
    if (timing[key] !== undefined && (!Number.isFinite(Number(timing[key])) || Number(timing[key]) < 0)) {
      err(`data/settings.json: heroTiming.${key} must be non-negative.`);
    }
  });
  ['kenBurnsFromScale','kenBurnsToScale','kenBurnsDurationS'].forEach(key => {
    if (timing[key] !== undefined && (!Number.isFinite(Number(timing[key])) || Number(timing[key]) <= 0)) {
      err(`data/settings.json: heroTiming.${key} must be greater than 0.`);
    }
  });
}

validateHtml('index.html');
validateHtml('about/index.html');
validateHtml('404.html');
validateHtml('success/index.html');
function validateSecuritySecrets() {
  const files = [];
  function walk(dir) {
    if (!exists(dir)) return;
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name).replaceAll(path.sep, '/');
      if (entry.isDirectory()) {
        if (entry.name !== '.git' && !rel.startsWith('.git/')) walk(rel);
        continue;
      }
      if (rel === '.git' || rel.startsWith('.git/')) continue;
      const ext = path.extname(rel).toLowerCase();
      if (['.html','.js','.mjs','.json','.yml','.yaml','.md','.css','.txt'].includes(ext)) files.push(rel);
    }
  }
  walk('');

  const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/;
  const knownGithubToken = /(?:github_pat_|ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]+/;
  for (const file of files) {
    const text = readText(file);
    if (knownGithubToken.test(text)) err(file + ': possible GitHub access token found in repository source. Keep GitHub credentials out of tracked files.');
    if (privateKey.test(text)) err(file + ': private key material found in tracked source.');
  }
}

function validateAdminStorageSecurity() {
  const admin = exists('admin/admin.js') ? readText('admin/admin.js') : '';
  const html = exists('admin/index.html') ? readText('admin/index.html') : '';

  if (!admin.includes('SESSION_STORAGE_KEY')) err('CMS security: session-only connection storage contract is missing.');
  if (!admin.includes('window.sessionStorage.setItem(SESSION_STORAGE_KEY')) err('CMS security: successful connections must be held in session storage.');
  if (!admin.includes('if(remember) window.localStorage.setItem(STORAGE_KEY')) err('CMS security: persistent storage must require an explicit Remember checkbox.');
  if (!admin.includes('window.localStorage.removeItem(STORAGE_KEY)')) err('CMS security: persistent storage must be cleared when Remember is disabled.');
  if (!admin.includes('window.sessionStorage.removeItem(SESSION_STORAGE_KEY)')) err('CMS security: disconnect must clear the session credential.');
  if (!html.includes('autocomplete="new-password"')) err('CMS security: GitHub token input should use a non-persistent password autocomplete mode.');
  if (!html.includes('Fine-grained token')) err('CMS security: admin must recommend fine-grained GitHub tokens.');
  if (!html.includes('Never paste a token into project files')) err('CMS security: admin must warn against committing GitHub credentials.');
}

function validateAdminConnectionSecurity() {
  const admin = exists('admin/admin.js') ? readText('admin/admin.js') : '';
  if (!admin) return;

  const required = [
    ['safe repository-name validation', /function isSafeRepoName\(/],
    ['safe branch-name validation', /function isSafeBranchName\(/],
    ['validated stored connections', /return isValidConnection\(parsed\) \? parsed : null;/],
    ['API path segment encoding', /function apiPath\(path\)/],
    ['GitHub API referrer suppression', /referrerPolicy:\s*init\.referrerPolicy \|\| 'no-referrer'/],
    ['CMS writable-path allowlist', /const CMS_WRITABLE_PATHS = new Set\(/],
    ['CMS write-path enforcement', /assertCmsWritablePath\(file\?\.path\)/],
    ['Media delete restriction', /CMS delete blocked: only media assets can be deleted/],
  ];

  required.forEach(([label, pattern]) => {
    if (!pattern.test(admin)) err('CMS security: ' + label + ' contract is missing.');
  });
}

function validateExternalDependencyPins() {
  const htmlFiles = ['index.html', 'about/index.html', 'admin/index.html', '404.html', 'success/index.html'].filter(exists);
  for (const file of htmlFiles) {
    const html = readText(file);
    if (/cdn\.jsdelivr\.net\/.*@latest|cdn\.jsdelivr\.net\/.*\/latest\//i.test(html)) {
      err(file + ': floating jsDelivr dependency detected; pin third-party runtime versions.');
    }
  }

  const runtime = exists('js/site-runtime.js') ? readText('js/site-runtime.js') : '';
  if (runtime && /@lottiefiles\/lottie-player@[^\d]/.test(runtime)) {
    err('js/site-runtime.js: Lottie dependency must use a pinned version.');
  }
  if (runtime && /lottiefiles\/lottie-player@latest/i.test(runtime)) {
    err('js/site-runtime.js: floating Lottie dependency is not allowed.');
  }

  const index = exists('index.html') ? readText('index.html') : '';
  if (index && !/three@\d+\.\d+\.\d+\/build\/three\.module\.js/.test(index)) {
    err('index.html: Three.js import map must pin an exact version.');
  }
}

function validateWorkflowActionPins() {
  const workflow = exists('.github/workflows/site-validation.yml')
    ? readText('.github/workflows/site-validation.yml')
    : '';
  if (!workflow) return;

  const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)]
    .map(match => match[1]);

  const mutable = uses.filter(ref => /@(?:v?\d+(?:\.\d+){0,2}|main|master|latest)$/i.test(ref));
  if (mutable.length) {
    err('CI security: GitHub Actions must be pinned to immutable commit SHAs. Unpinned actions: ' + mutable.join(', ') + '.');
  }

  if (!workflow.includes('actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09')) {
    err('CI security: actions/checkout must stay pinned to its reviewed v5 commit SHA.');
  }
  if (!workflow.includes('actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444')) {
    err('CI security: actions/setup-node must stay pinned to its reviewed v5 commit SHA.');
  }
  if (!/persist-credentials:\s*false\b/.test(workflow)) err('CI security: checkout credentials must not persist after the repository is fetched.');
}

function validateWorkflowHardening() {
  const workflow = exists('.github/workflows/site-validation.yml')
    ? readText('.github/workflows/site-validation.yml')
    : '';
  if (!workflow) return;
  if (!/node-version:\s*24\b/.test(workflow)) err('CI security: validation workflow must use supported Node.js 24 LTS.');
  if (!/permissions:\s*\n\s+contents:\s*read\b/.test(workflow)) err('CI security: validation workflow should explicitly grant only contents: read.');
  if (!/timeout-minutes:\s*10\b/.test(workflow)) err('CI reliability: validation workflow needs a finite timeout.');
  if (!/cancel-in-progress:\s*true\b/.test(workflow)) err('CI reliability: outdated validation runs should be cancelled.');
}

function validateTargetBlankRel(file) {
  if (!exists(file)) return;
  const html = readText(file);
  const linkRe = /<a\b[^>]*target=['"]_blank['"][^>]*>/gi;
  let match;
  while ((match = linkRe.exec(html))) {
    const tag = match[0];
    const rel = (tag.match(/\brel=['"]([^'"]*)['"]/i)?.[1] || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!rel.includes('noopener') || !rel.includes('noreferrer')) {
      err(file + ': target="_blank" link is missing rel="noopener noreferrer".');
    }
  }
}

function validateLightboxLifecycle() {
  const source = exists('js/features/lightbox/index.js') ? readText('js/features/lightbox/index.js') : '';
  const legacy = exists('js/lightbox.js') ? readText('js/lightbox.js') : '';

  if (legacy) {
    err('Lightbox: retired root module js/lightbox.js must not remain after feature cutover.');
  }

  if (!/if \(!modelWrap\.isConnected \|\| !lightbox\.classList\.contains\('active'\)\) return;/.test(source)) {
    err('Lightbox: lazy 3D viewer mount is missing its detached-node/closed-lightbox guard.');
  }

  if (!/modalMediaContainer\.querySelectorAll\('\.model-viewer-shell'\)\.forEach\(shell => \{\s*try \{ shell\.__modelViewerCleanup\?\.\(\); \} catch \(_\) \{\}/s.test(source)) {
    err('Lightbox: closing the modal must dispose mounted 3D viewers before clearing their DOM.');
  }
}

function validateGalleryContract() {
  const source = exists('js/features/gallery/index.js') ? readText('js/features/gallery/index.js') : '';
  const legacy = exists('js/gallery.js') ? readText('js/gallery.js') : '';
  const css = exists('css/style.css') ? readText('css/style.css') : '';

  if (legacy) {
    err('Gallery: retired root module js/gallery.js must not remain after feature cutover.');
  }
  if (/getActiveCards:\s*\(\)\s*=>\s*getActiveCards\(\)/.test(source)) {
    err('Gallery: getActiveCards() recursively calls itself.');
  }
  if (!/getActiveCards:\s*\(\)\s*=>\s*allCards\.filter\(/.test(source)) {
    err('Gallery: getActiveCards() contract is missing its active-card filter.');
  }
  if (!/function\s+getBaseCount\s*\(\)/.test(source)) {
    err('Gallery: responsive base-count contract is missing.');
  }
  if (!/function\s+isFilterCarousel\s*\(\)/.test(source) ||
      !/function\s+getNearestCenteredFilterIndex\s*\(\)/.test(source)) {
    err('Gallery: centered small-screen filter carousel contract is missing.');
  }
  if (!/filterPageDots\s*=\s*buttons\.map/.test(source)) {
    err('Gallery: filter page controls must be generated one-to-one from actual filter buttons.');
  }
  if (!/filterTabs\?\.addEventListener\('scroll'/.test(source) ||
      !/settleCenteredFilter/.test(source)) {
    err('Gallery: horizontal scrolling must update and settle on the centered filter.');
  }
  if (!/overflow-x:\s*auto/.test(css) || !/scroll-snap-align:\s*center/.test(css)) {
    err('Gallery: small-screen filter carousel CSS contract is missing.');
  }
  if (!/\.filter-page-controls\{\s*display:none;/.test(css)) {
    err('Gallery: filter page controls must be hidden by default on desktop.');
  }
}

function validateModuleScriptContract() {
  const pages = [
    ['index.html', 'js/script.js'],
    ['about/index.html', '../js/script.js']
  ];

  for (const [file, src] of pages) {
    if (!exists(file)) continue;
    const html = readText(file);
    const scriptPattern = '<script type="module" src="' + src;
    if (!html.includes(scriptPattern)) {
      err(file + ': js/script.js must be loaded with type="module".');
    }
  }
}

function validateBootstrapHardening() {
  const entry = exists('js/script.js') ? readText('js/script.js') : '';
  const bootstrap = exists('js/app/bootstrap.js') ? readText('js/app/bootstrap.js') : '';
  const composition = exists('js/app/page-composition.js') ? readText('js/app/page-composition.js') : '';

  if (!/import \{ bootstrapPortfolioApp \} from ['"]\.\/app\/bootstrap\.js/.test(entry)) {
    err('Bootstrap: js/script.js must delegate to app/bootstrap.js.');
  }

  const transitionPos = bootstrap.indexOf("const pageTransition = root?.getElementById('pageTransition');");
  const importPos = bootstrap.indexOf('const { createPortfolioApp } = await import(');
  const transitionCallPos = bootstrap.indexOf('showInitialPageTransition();');
  if (transitionPos < 0 || transitionCallPos < 0 || importPos < 0 || transitionCallPos > importPos) {
    err('Bootstrap: page transition must initialize before application module loading.');
  }

  if (!/initialTransitionTimer\s*=\s*root\.defaultView\.setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?\},\s*900\)/.test(bootstrap)) {
    err('Bootstrap: initial page transition is missing its fail-safe timeout.');
  }

  if (!/await createPortfolioApp\(\{ root, runtime, cms, config \}\)/.test(bootstrap)) {
    err('Bootstrap: composition root must receive normalized app configuration.');
  }

  if (!/catch \(error\) \{\s*console\.error\('Portfolio runtime failed to initialize'/.test(bootstrap)) {
    err('Bootstrap: top-level initialization error boundary is missing.');
  }

  if (/function\s+(loadProjectsFromCMS|openLightbox|initHeroBanner|initGallery)\s*\(/.test(entry)) {
    err('Bootstrap: implementation logic has leaked back into js/script.js.');
  }

  if (!/export async function createPortfolioApp\(/.test(composition)) {
    err('Composition: createPortfolioApp() public entry point is missing.');
  }

  if (!/loopMode:\s*settings\.heroTiming\.loopMode/.test(composition) ||
      !/transitionStyle:\s*settings\.heroTiming\.transitionStyle/.test(composition)) {
    err('Composition: Hero timing must use the Hero feature option names loopMode and transitionStyle.');
  }

  const lightbox = exists('js/features/lightbox/index.js') ? readText('js/features/lightbox/index.js') : '';
  if (!/return \{[\s\S]*destroy\(\)[\s\S]*listenerCleanups\.splice\(0\)/.test(lightbox)) {
    err('Lightbox: public feature lifecycle must expose destroy() and release persistent listeners.');
  }

  if (!/lightboxFeature\?\.destroy\?\.\(\)/.test(composition) ||
      !/heroFeature\?\.destroy\?\.\(\)/.test(composition) ||
      !/galleryFeature\?\.destroy\?\.\(\)/.test(composition)) {
    err('Composition: Hero, Gallery, and Lightbox lifecycle cleanup must be wired to app.destroy().');
  }

  const gallery = exists('js/features/gallery/index.js') ? readText('js/features/gallery/index.js') : '';
  if (!/return \{[\s\S]*destroy\(\)[\s\S]*listenerCleanups\.splice\(0\)/.test(gallery)) {
    err('Gallery: public feature lifecycle must expose destroy() and release persistent listeners.');
  }
}
function validateArchitecture() {
  const entry = exists('js/script.js') ? readText('js/script.js') : '';
  const bootstrap = exists('js/app/bootstrap.js') ? readText('js/app/bootstrap.js') : '';
  const composition = exists('js/app/page-composition.js') ? readText('js/app/page-composition.js') : '';

  const required = [
    ['js/infrastructure/cms/loader.js', /export async function loadCmsJson/],
    ['js/infrastructure/browser/site-paths.js', /export function getSiteRootUrl/],
    ['js/infrastructure/youtube/url.js', /export function parseYouTubeUrl/],
    ['js/infrastructure/three/model-viewer.js', /export (?:async )?function mountModelViewer/],
    ['js/features/projects/index.js', /export \{ mountProjects \}/],
    ['js/features/gallery/index.js', /export async function initGallery/],
    ['js/features/hero/index.js', /export \{ initHeroBanner as initHeroBannerV2 \}/],
    ['js/features/lightbox/index.js', /export function initLightbox/],
    ['js/features/settings/index.js', /export async function initSiteSettings/]
  ];

  required.forEach(([file, pattern]) => {
    if (!exists(file) || !pattern.test(readText(file))) {
      err('Architecture V2: expected module contract missing from ' + file + '.');
    }
  });

  ['js/cms-data.js', 'js/site-runtime.js'].forEach(file => {
    if (exists(file)) err('Architecture V2: legacy runtime facade must be removed: ' + file);
  });

  if (entry.split(/\r?\n/).length > 40) {
    err('Architecture V2: js/script.js must remain a thin browser entrypoint.');
  }

  if (/function\s+(initGallery|initHeroBanner|openLightbox|buildProjectCardEl|loadProjectsFromCMS)\s*\(/.test(entry)) {
    err('Architecture V2: feature implementation remains in js/script.js.');
  }

  if (/\bfetch\s*\(/.test(entry) || /(?:SETTINGS|PROJECTS|REVIEWS|ABOUT|FILTERS)_URL/.test(entry)) {
    err('Architecture V2: CMS/page configuration access remains in js/script.js.');
  }

  if (!/initNavigation\(/.test(composition) ||
      !/initReviews\(/.test(composition) ||
      !/initAbout\(/.test(composition) ||
      !/initForms\(/.test(composition) ||
      !/initSiteSettings\(/.test(composition) ||
      !/initGallery\(/.test(composition) ||
      !/initLightbox\(/.test(composition)) {
    err('Architecture V2: page-shell features are not composed through explicit feature APIs.');
  }

  if (!/runtime\s*,\s*cms/.test(composition)) {
    err('Architecture V2: runtime and CMS services must enter through the composition boundary.');
  }

  if (/from ['"]\.\/site-runtime\.js/.test(composition) ||
      /from ['"]\.\/cms-data\.js/.test(composition)) {
    err('Architecture V2: composition must not import legacy runtime/data facades.');
  }
}
validateResponsiveUiContracts();
scanSourceForBadPatterns();
validateSecuritySecrets();
validateAdminStorageSecurity();
validateWorkflowHardening();
validateWorkflowActionPins();
validateExternalDependencyPins();
validateAdminConnectionSecurity();
validateTargetBlankRel('index.html');
validateTargetBlankRel('about/index.html');
validateTargetBlankRel('admin/index.html');
validateArchitecture();
validateBootstrapHardening();
validateModuleScriptContract();

function validateResponsiveUiContracts() {
  const gallery = exists('js/features/gallery/index.js') ? readText('js/features/gallery/index.js') : '';
  const style = exists('css/style.css') ? readText('css/style.css') : '';
  const adminCss = exists('admin/admin.css') ? readText('admin/admin.css') : '';
  const admin = exists('admin/admin.js') ? readText('admin/admin.js') : '';

  if (!/if \(width < 768\) return Math\.min\(2, allCards\.length\);/.test(gallery)) {
    err('Gallery responsive count contract: phones should collapse to two visible cards.');
  }
  if (!/if \(width < 1100\) return Math\.min\(height < 820 \? 4 : 6, allCards\.length\);/.test(gallery)) {
    err('Gallery responsive count contract: tablets should choose two or three rows from viewport height.');
  }
  if (!/return Math\.min\(9, allCards\.length\);/.test(gallery)) {
    err('Gallery responsive count contract: desktop should keep nine visible cards.');
  }
  if (!/grid-template-columns:1fr;/.test(style) ||
      !/grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/.test(style) ||
      !/grid-template-columns:repeat\(3,minmax\(0,1fr\)\);/.test(style)) {
    err('Gallery responsive layout contract: phone/tablet/desktop column rules are incomplete.');
  }
  if (!/Responsive lightbox sizing/.test(style)) err('Lightbox responsive sizing contract is missing.');

  if (!/media-bg-control/.test(adminCss) || !/media-bg-row/.test(adminCss)) {
    err('CMS visual contract: transparent-media background controls are missing.');
  }
  if (!/function mediaSupportsBackground\(type\)/.test(admin) ||
      !/wireBackgroundControl\(/.test(admin)) {
    err('CMS visual contract: background controls must be available for Lottie and 3D.');
  }
  if (!/tokenInput\?\.closest\('\.field'\)\?\.remove\(\)|tokenInput\.disabled = true/.test(admin)) {
    err('CMS credential UI contract: the password-like token field should be removed from active browser interaction after connection.');
  }
}

function validateCmsRegressionContracts() {
  const admin = exists('admin/admin.js') ? readText('admin/admin.js') : '';
  const gallery = exists('js/features/gallery/index.js') ? readText('js/features/gallery/index.js') : '';
  const projectCard = exists('js/features/projects/project-card.js') ? readText('js/features/projects/project-card.js') : '';
  const composition = exists('js/app/page-composition.js') ? readText('js/app/page-composition.js') : '';
  const css = exists('css/style.css') ? readText('css/style.css') : '';

  if (!admin.includes('saveSectionsAtomic([')) err('CMS save: Hero Loop and settings must stay atomic.');
  if (!admin.includes('await onCollect()')) err('CMS save: save collectors must support asynchronous cross-file validation/migrations.');
  if (!admin.includes('filtersWithProjects')) err('CMS filters: filter/project relationship saves must be atomic.');
  if (!admin.includes('Duplicate filter ID')) err('CMS filters: duplicate filter IDs must be rejected.');

  if (!gallery.includes('getEffectiveBaseCount') || !gallery.includes('rowAlignedCount')) {
    err('Gallery: row-aware Show More contract is missing.');
  }

  if (!projectCard.includes('card.dataset.filterIds')) {
    err('Gallery filters: exact CMS filter IDs must be preserved on project cards.');
  }

  if (!/className = 'filter-btn'/.test(gallery) || !/filterBtns = Array.from\(document\.querySelectorAll\('\.filter-tabs \.filter-btn, \.filter-tabs \.tab-btn'\)\)/.test(gallery)) {
    err('Gallery filters: CMS filter buttons must have an owned click/filter contract.');
  }

  if (!/async function loadFilterButtons\(\)/.test(gallery) || !/options\.filterUrl/.test(gallery)) {
    err('Gallery filters: CMS filter loading must remain inside the Gallery feature boundary.');
  }

  if (!composition.includes('mountProjects(') ||
      !composition.includes('initGallery(') ||
      !composition.includes('initLightbox(')) {
    err('Portfolio composition: Projects, Gallery, and Lightbox controllers must remain explicitly wired.');
  }

  if (!css.includes('--hero-fade-in-ms') || !css.includes('--hero-fade-out-ms')) {
    err('Hero: per-slide fade timing CSS variables are missing.');
  }
}

validateCmsRegressionContracts();validateCmsRegressionContracts();
validateLightboxLifecycle();
validateGalleryContract();
checkLargeAssets();

for (const js of ['js/script.js', 'admin/admin.js']) {
  if (!exists(js)) continue;
  try {
    execFileSync(process.execPath, ['--check', js], { stdio: 'pipe' });
  } catch (e) {
    err(`${js}: JavaScript syntax check failed.\n${e.stderr?.toString() || e.message}`);
  }
}

console.log(`LM. site validation — ${new Date().toISOString()}`);
console.log(`Checked projects: ${Array.isArray(projects) ? projects.length : 0}`);
console.log(`Errors: ${errors.length}`);
console.log(`Warnings: ${warnings.length}`);

warnings.forEach(message => console.warn(`⚠ ${message}`));
errors.forEach(message => console.error(`✗ ${message}`));

if (errors.length) process.exit(1);
console.log('✓ Validation passed.');
