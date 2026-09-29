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
  const candidates = ['index.html', 'about/index.html', 'js/script.js', 'js/model-viewer.js', 'js/media-background.js', 'css/style.css'];
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

validateProjects(projects, filters);
validateHeroLoop(heroLoop);
validateAbout(about);

if (settings?.heroTiming) {
  const timing = settings.heroTiming;
  if (!['latest', 'manual', 'mixed'].includes(timing.loopMode)) err(`data/settings.json: invalid heroTiming.loopMode "${timing.loopMode}".`);
  if (!['kenburns', 'fade', 'none'].includes(timing.transitionStyle)) err(`data/settings.json: invalid heroTiming.transitionStyle "${timing.transitionStyle}".`);
  if (!Number.isFinite(Number(timing.crossfadeMs)) || Number(timing.crossfadeMs) < 500) err(`data/settings.json: heroTiming.crossfadeMs must be >= 500.`);
}

validateHtml('index.html');
validateHtml('about/index.html');
validateHtml('404.html');
validateHtml('success/index.html');
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
  const source = exists('js/lightbox.js') ? readText('js/lightbox.js') : '';

  if (!/if \(!modelWrap\.isConnected \|\| !lightbox\.classList\.contains\('active'\)\) return;/.test(source)) {
    err('Lightbox: lazy 3D viewer mount is missing its detached-node/closed-lightbox guard.');
  }

  if (!/modalMediaContainer\.querySelectorAll\('\.model-viewer-shell'\)\.forEach\(shell => \{\s*try \{ shell\.__modelViewerCleanup\?\.\(\); \} catch \(_\) \{\}/s.test(source)) {
    err('Lightbox: closing the modal must dispose mounted 3D viewers before clearing their DOM.');
  }
}

function validateGalleryContract() {
  const source = exists('js/gallery.js') ? readText('js/gallery.js') : '';
  if (/getActiveCards:\s*\(\)\s*=>\s*getActiveCards\(\)/.test(source)) {
    err('Gallery: getActiveCards() recursively calls itself.');
  }
  if (!/getActiveCards:\s*\(\)\s*=>\s*allCards\.filter\(/.test(source)) {
    err('Gallery: getActiveCards() contract is missing its active-card filter.');
  }
}

function validateBootstrapHardening() {
  const source = exists('js/script.js') ? readText('js/script.js') : '';

  const transitionPos = source.indexOf("const pageTransition = document.getElementById('pageTransition');");
  const importPos = source.indexOf("await import(runtimeUrl)");
  if (transitionPos < 0 || importPos < 0 || transitionPos > importPos) {
    err('Bootstrap: page transition must initialize before dynamic module imports.');
  }

  if (!/initialTransitionTimer\s*=\s*window\.setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?\},\s*900\)/.test(source)) {
    err('Bootstrap: initial page transition is missing its fail-safe timeout.');
  }

  if (!/try\s*\{\s*await initHeroBannerV2\(/.test(source)) {
    err('Bootstrap: hero initialization must be isolated so a hero failure cannot abort the rest of the public UI.');
  }

  if (!/catch \(err\) \{\s*console\.error\('LM bootstrap: public frontend failed to initialize\.'/.test(source)) {
    err('Bootstrap: top-level initialization error boundary is missing.');
  }
}

function validateArchitecture() {
  const source = exists('js/script.js') ? readText('js/script.js') : '';
  const required = [
    ['js/cms-data.js', /export (?:async )?function loadCmsJson/],
    ['js/gallery.js', /export function initGallery/],
    ['js/hero.js', /export \{ initHeroBanner as initHeroBannerV2 \}/],
    ['js/lightbox.js', /export function initLightbox/]
  ];
  required.forEach(([file, pattern]) => {
    if (!exists(file) || !pattern.test(readText(file))) {
      err('Architecture V2: expected module contract missing from ' + file + '.');
    }
  });
  if (/function\s+initGallery\s*\(/.test(source)) err('Architecture V2: gallery implementation remains in script.js.');
  if (/function\s+initHeroBanner\s*\(/.test(source)) err('Architecture V2: hero implementation remains in script.js.');
  if (/function\s+openLightbox\s*\(/.test(source)) err('Architecture V2: lightbox implementation remains in script.js.');
  if (/fetch\(siteAssetUrl\(window\.(SETTINGS|PROJECTS|REVIEWS|ABOUT|FILTERS|HERO_MESSAGES)_URL/.test(source)) err('Architecture V2: direct CMS fetch remains in script.js.');
}

scanSourceForBadPatterns();
validateTargetBlankRel('index.html');
validateTargetBlankRel('about/index.html');
validateTargetBlankRel('admin/index.html');
validateArchitecture();
validateBootstrapHardening();

function validateCmsRegressionContracts() {
  const admin = exists('admin/admin.js') ? readText('admin/admin.js') : '';
  const gallery = exists('js/gallery.js') ? readText('js/gallery.js') : '';
  const script = exists('js/script.js') ? readText('js/script.js') : '';
  const css = exists('css/style.css') ? readText('css/style.css') : '';
  if (!admin.includes('saveSectionsAtomic([')) err('CMS save: Hero Loop and settings must stay atomic.');
  if (!gallery.includes('getEffectiveBaseCount') || !gallery.includes('rowAlignedCount')) err('Gallery: row-aware Show More contract is missing.');
  if (!script.includes('card.dataset.filterIds')) err('Gallery filters: exact CMS filter IDs must be preserved.');
  if (!css.includes('--hero-fade-in-ms') || !css.includes('--hero-fade-out-ms')) err('Hero: per-slide fade timing CSS variables are missing.');
}
validateCmsRegressionContracts();
validateLightboxLifecycle();
validateGalleryContract();
checkLargeAssets();

for (const js of ['js/script.js', 'js/cms-data.js', 'js/gallery.js', 'js/hero.js', 'js/lightbox.js', 'js/model-viewer.js', 'js/media-background.js', 'js/site-runtime.js']) {
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
