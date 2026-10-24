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
const SUPPORTED_HOLOGRAPHIC_STYLES = new Set(['holographic', 'cosmos', 'brushed', 'beams', 'crosshatch', 'shattered', 'glitter', 'waves', 'cat-eye', 'iridescent', 'aurora']);
const SUPPORTED_ARTWORK_GROUP_LAYOUTS = new Set(['grid','stack','cards']);

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

function localRefEscapesSiteRoot(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  if (!normalized) return false;

  // Browser URL parsing can normalize percent-encoded dot segments and slashes
  // before the request reaches GitHub Pages. Check both the literal path and its
  // single URL-decoded form so encoded traversal cannot bypass this repository check.
  const pathsToInspect = [normalized];
  try {
    pathsToInspect.push(decodeURIComponent(normalized).replace(/\\/g, '/'));
  } catch (_) {
    // Malformed escapes will still be rejected by normal local-file existence checks.
  }
  if (pathsToInspect.some(candidate => candidate.split('/').some(segment => segment === '..'))) {
    return true;
  }

  const target = path.resolve(ROOT, normalized);
  return target !== ROOT && !target.startsWith(ROOT + path.sep);
}

function checkLocalRef(value, where) {
  const local = normalizeLocalRef(value);
  if (!local) return;
  if (localRefEscapesSiteRoot(local)) {
    err(where + ': local file reference must not contain parent-directory segments or escape the site root ("' + local + '").');
    return;
  }
  if (!exists(local)) err(where + ': missing local file "' + local + '".');
}

// Keep a few path-shape cases near the implementation so edits cannot silently
// weaken the CMS/local-asset boundary before the full data checks run.
for (const [value, expected] of [
  ['assets/projects/example.webp', false],
  ['/assets/projects/example.webp', false],
  ['../private/data.json', true],
  ['assets/../../admin/admin.js', true],
  ['assets\\..\\admin\\admin.js', true],
  ['assets/%2e%2e/admin/admin.js', true],
  ['assets%2F%2e%2e%2Fadmin/admin.js', true]
]) {
  if (localRefEscapesSiteRoot(normalizeLocalRef(value)) !== expected) {
    err('Local asset path boundary regression for "' + value + '".');
  }
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
  if (media.holographic !== undefined) {
    if (!media.holographic || typeof media.holographic !== 'object' || Array.isArray(media.holographic)) {
      err(`${where}: holographic settings must be an object.`);
    } else {
      const holographicStyle = String(media.holographic.style || '').trim().toLowerCase();
      if (holographicStyle && !SUPPORTED_HOLOGRAPHIC_STYLES.has(holographicStyle)) {
        err(`${where}: unsupported holographic style '${holographicStyle}'.`);
      }
      const textureMode = String(media.holographic.textureMode || 'fill').trim().toLowerCase();
      if (!['tile', 'fill'].includes(textureMode)) {
        err(`${where}: holographic.textureMode must be "tile" or "fill".`);
      }
      for (const key of ['texture', 'mask']) {
        if (media.holographic[key] === undefined) continue;
        if (typeof media.holographic[key] !== 'string') {
          err(`${where}: holographic.${key} must be a string path.`);
        } else if (media.holographic[key].trim()) {
          checkLocalRef(media.holographic[key], `${where} holographic.${key}`);
        }
      }
    }
  }
}

function validateMediaGroups(project, where) {
  if (project.mediaGroups !== undefined && !Array.isArray(project.mediaGroups)) {
    err(`${where}: mediaGroups must be an array when present.`);
    return;
  }
  const groups = Array.isArray(project.mediaGroups) ? project.mediaGroups : [];
  const ids = new Set();
  groups.forEach((group,index) => {
    const groupWhere = `${where} artwork group ${index+1}`;
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      err(`${groupWhere}: group must be an object.`); return;
    }
    const id = String(group.id || '').trim(), name = String(group.name || '').trim();
    const layout = String(group.layout || 'grid').trim().toLowerCase();
    if (!id) err(`${groupWhere}: missing id.`);
    else if (ids.has(id)) err(`${groupWhere}: duplicate id "${id}".`);
    else ids.add(id);
    if (!name) err(`${groupWhere}: missing name.`);
    if (!SUPPORTED_ARTWORK_GROUP_LAYOUTS.has(layout)) err(`${groupWhere}: unsupported layout "${layout}".`);
  });
  (Array.isArray(project.media) ? project.media : []).forEach((item,index) => {
    if (item?.groupId === undefined || item.groupId === null || item.groupId === '') return;
    if (typeof item.groupId !== 'string' || !ids.has(item.groupId)) {
      err(`${where} media ${index+1}: groupId must reference a project mediaGroups id.`);
    }
  });
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
  const badgeNames = new Set((filters?.badges || []).map(badge => String(badge || '').trim()).filter(Boolean));

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

    if (project.badges !== undefined && !Array.isArray(project.badges)) {
      err(`${where}: badges must be an array when present.`);
    }
    const projectBadges = Array.isArray(project.badges) ? project.badges : [];
    const seenBadges = new Set();
    projectBadges.forEach(badge => {
      const value = String(badge || '').trim();
      if (!value) err(`${where}: badges cannot contain empty values.`);
      else if (seenBadges.has(value)) err(`${where}: duplicate badge "${value}".`);
      else {
        seenBadges.add(value);
        if (!badgeNames.has(value)) err(`${where}: badge "${value}" is not defined in data/filters.json.`);
      }
    });
    if (project.badge !== undefined && project.badge !== null) {
      const legacyBadge = String(project.badge || '').trim();
      if (legacyBadge && !badgeNames.has(legacyBadge)) {
        err(`${where}: badge "${legacyBadge}" is not defined in data/filters.json.`);
      }
      if (legacyBadge && Array.isArray(project.badges) && !seenBadges.has(legacyBadge)) {
        err(`${where}: legacy badge "${legacyBadge}" must also be present in badges while both fields are stored.`);
      }
    }
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
    validateMediaGroups(project, where);
  });
}

function validateCuratedViews(views, mainProjects, filters) {
  if (!Array.isArray(views)) {
    err('data/curated-views.json must contain an array.');
    return;
  }

  const mainIds = new Set((Array.isArray(mainProjects) ? mainProjects : []).map(project => String(project?.id || '').trim()).filter(Boolean));
  const filterIds = new Set((filters?.filters || []).map(filter => String(filter?.id || '').trim()).filter(Boolean));
  const viewIds = new Set();
  const viewSlugs = new Set();
  const curatedIds = new Set();

  views.forEach((view, i) => {
    const where = `data/curated-views.json view ${i + 1}`;
    if (!view || typeof view !== 'object') {
      err(`${where}: view must be an object.`);
      return;
    }

    const id = String(view.id || '').trim();
    const name = String(view.name || '').trim();
    const slug = String(view.slug || '').trim();

    if (!id) err(`${where}: missing id.`);
    else if (viewIds.has(id)) err(`${where}: duplicate view id "${id}".`);
    else viewIds.add(id);

    if (!name) err(`${where}: missing name.`);
    if (!slug) err(`${where}: missing slug.`);
    else {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        err(`${where}: slug "${slug}" must use lowercase letters, numbers, and hyphens only.`);
      }
      if (viewSlugs.has(slug)) err(`${where}: duplicate slug "${slug}".`);
      else viewSlugs.add(slug);
      if (id && slug !== id) err(`${where}: id and slug must match to keep the URL identity stable.`);
    }

    if (!Array.isArray(view.projects)) {
      err(`${where}: projects must be an ordered array.`);
      return;
    }

    const seenMainRefs = new Set();
    const seenCuratedIds = new Set();

    view.projects.forEach((entry, j) => {
      const entryWhere = `${where} project entry ${j + 1}`;
      if (!entry || typeof entry !== 'object') {
        err(`${entryWhere}: entry must be an object.`);
        return;
      }

      const source = String(entry.source || '').trim();
      if (source === 'main') {
        const projectId = String(entry.projectId || '').trim();
        if (!projectId) err(`${entryWhere}: main entry is missing projectId.`);
        else {
          if (!mainIds.has(projectId)) err(`${entryWhere}: main project "${projectId}" does not exist in data/projects.json.`);
          if (seenMainRefs.has(projectId)) err(`${entryWhere}: duplicate main project reference "${projectId}".`);
          seenMainRefs.add(projectId);
        }
        return;
      }

      if (source !== 'curated') {
        err(`${entryWhere}: source must be "main" or "curated".`);
        return;
      }

      const project = entry.project;
      if (!project || typeof project !== 'object') {
        err(`${entryWhere}: curated entry must contain a complete project object.`);
        return;
      }

      validateMediaGroups(project, entryWhere);
      const projectId = String(project.id || '').trim();
      if (!projectId) err(`${entryWhere}: curated project is missing id.`);
      else {
        const scopedId = `${id}::${projectId}`;
        if (mainIds.has(projectId)) {
          err(`${entryWhere}: curated project id "${projectId}" collides with a Main Portfolio project id.`);
        }
        if (seenCuratedIds.has(projectId)) err(`${entryWhere}: duplicate curated project id "${projectId}" within this view.`);
        if (curatedIds.has(scopedId)) err(`${entryWhere}: duplicate scoped curated project id "${projectId}".`);
        seenCuratedIds.add(projectId);
        curatedIds.add(scopedId);
      }

      if (!String(project.title || '').trim()) err(`${entryWhere}: curated project needs a title.`);
      if (!String(project.subtitle || '').trim()) err(`${entryWhere}: curated project needs a subtitle.`);

      if (project.filters !== undefined && !Array.isArray(project.filters)) {
        err(`${entryWhere}: curated project filters must be an array when present.`);
      }
      if (Array.isArray(project.filters) && project.filters.length) {
        err(`${entryWhere}: curated-only projects must not use Main Portfolio filters.`);
      }

      if (project.badges !== undefined && !Array.isArray(project.badges)) {
        err(`${entryWhere}: curated project badges must be an array when present.`);
      }

      const thumb = project.thumbnail;
      if (thumb?.src) {
        checkLocalRef(thumb.src, `${entryWhere} thumbnail.src`);
        const thumbExt = extension(thumb.src);
        if (thumb.type === 'model' && !SUPPORTED_MODEL_EXT.has(thumbExt) && !isExternal(thumb.src)) {
          err(`${entryWhere}: thumbnail declared as model but source extension is .${thumbExt || 'none'}.`);
        }
        if (thumb.orientation !== undefined && !ORIENTATIONS.has(String(thumb.orientation))) {
          err(`${entryWhere}: invalid thumbnail orientation "${thumb.orientation}".`);
        }
      }
      checkBackground(thumb?.background, `${entryWhere} thumbnail`);

      const media = Array.isArray(project.media) ? project.media : [];
      if (!media.length) warn(`${entryWhere}: curated project has no media items.`);
      media.forEach((item, k) => validateMedia(item, `${entryWhere} media ${k + 1}`));
    });
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


function validateCanonicalSocialMetadata() {
  const expectedUrls = new Map([
    ['index.html', 'https://lemuelmagbitang.github.io/'],
    ['about/index.html', 'https://lemuelmagbitang.github.io/about/']
  ]);

  for (const [file, expectedUrl] of expectedUrls) {
    if (!exists(file)) continue;
    const html = readText(file);
    const canonicalTag = html.match(/<link\b(?=[^>]*\brel=['"]canonical['"])[^>]*>/i)?.[0] || '';
    const canonicalUrl = canonicalTag.match(/\bhref=['"]([^'"]+)['"]/i)?.[1] || '';
    const socialTag = html.match(/<meta\b(?=[^>]*\bproperty=['"]og:url['"])[^>]*>/i)?.[0] || '';
    const socialUrl = socialTag.match(/\bcontent=['"]([^'"]+)['"]/i)?.[1] || '';

    if (canonicalUrl !== expectedUrl) {
      err(file + ': canonical URL must identify this page (' + expectedUrl + ').');
    }
    if (socialUrl !== expectedUrl) {
      err(file + ': Open Graph URL must identify this page (' + expectedUrl + ').');
    }
  }
}


function validateSharedCssCacheVersion() {
  const entryHtml = exists('index.html') ? readText('index.html') : '';
  const expectedVersion = entryHtml.match(/css\/style\.css\?v=([^'"\s>]+)/i)?.[1] || '';
  if (!expectedVersion) {
    err('index.html: canonical stylesheet cache version is missing.');
    return;
  }

  for (const file of ['about/index.html', '404.html', 'success/index.html']) {
    if (!exists(file)) continue;
    const html = readText(file);
    const version = html.match(/css\/style\.css\?v=([^'"\s>]+)/i)?.[1] || '';
    if (version !== expectedVersion) {
      err(file + ': shared stylesheet cache version must match index.html (v=' + expectedVersion + ').');
    }
  }
}

function validateLightboxFeatureStylesheet() {
  const entryHtml = exists('index.html') ? readText('index.html') : '';
  const links = [...entryHtml.matchAll(/<link\b[^>]*>/gi)].map(match => match[0]);
  const baseIndex = links.findIndex(tag =>
    /\brel=['"]stylesheet['"]/i.test(tag) &&
    /\bhref=['"]css\/style\.css\?v=[^'"]+['"]/i.test(tag)
  );
  const featureIndex = links.findIndex(tag =>
    /\brel=['"]stylesheet['"]/i.test(tag) &&
    /\bhref=['"]css\/features\/lightbox\.css\?v=[^'"]+['"]/i.test(tag)
  );
  if (baseIndex < 0 || featureIndex <= baseIndex) {
    err('CSS ownership: index.html must load css/features/lightbox.css after shared css/style.css.');
  }

  const featureCss = exists('css/features/lightbox.css') ? readText('css/features/lightbox.css') : '';
  const desktopCloseRule = (featureCss.match(/@media\s*\(min-width:\s*768px\)\s*\{[\s\S]*?\.lightbox-close\s*\{([^}]*)\}/) || [])[1] || '';
  const mobileCloseRule = (featureCss.match(/@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?\.lightbox-close\s*\{([^}]*)\}/) || [])[1] || '';
  if (!entryHtml.includes('css/features/lightbox.css?v=20261020-01') ||
      !/width:\s*44px;/.test(desktopCloseRule) ||
      !/height:\s*44px;/.test(desktopCloseRule) ||
      !/width:\s*52px;/.test(mobileCloseRule) ||
      !/height:\s*52px;/.test(mobileCloseRule)) {
    err('Lightbox close target: desktop must match the 44px navbar pill and mobile must retain its 52px target.');
  }
  if (!featureCss.includes('.lightbox-inspect-mode{z-index:10002;isolation:isolate;}') ||
      !featureCss.includes('.lightbox-inspect-footer .lightbox-holographic-hint{') ||
      !featureCss.includes('.lightbox-inspect-mode .lightbox-holographic:focus-visible{') ||
      !featureCss.includes('.lightbox-artwork-group .lightbox-media-item.is-grouped-artwork-interactive.is-inspect-focus-return:focus-visible{') ||
      !featureCss.includes('outline:none!important;') ||
      !featureCss.includes('object-fit:contain;object-position:center;') ||
      !featureCss.includes('overflow:visible;')) {
    err('CSS ownership: grouped artwork fit, Inspect stacking and foil hint rules must remain in css/features/lightbox.css.');
  }
  const sharedCss = exists('css/style.css') ? readText('css/style.css') : '';
  if (/October 11 Lightbox polish: safe artwork margins/.test(sharedCss) ||
      /October 11 grouped Lightbox follow-up/.test(sharedCss)) {
    err('CSS ownership: extracted Lightbox finishing rules must not be duplicated at the end of css/style.css.');
  }
}

function validateUtilityPageIndexing() {
  for (const file of ['admin/index.html', '404.html', 'success/index.html']) {
    if (!exists(file)) continue;
    const html = readText(file);
    const robotsTag = html.match(/<meta\b(?=[^>]*\bname=['"]robots['"])[^>]*>/i)?.[0] || '';
    const content = robotsTag.match(/\bcontent=['"]([^'"]+)['"]/i)?.[1] || '';
    const directives = new Set(content.toLowerCase().split(',').map(value => value.trim()));

    if (!directives.has('noindex') || !directives.has('nofollow')) {
      err(file + ': utility pages must declare robots "noindex, nofollow".');
    }
  }
}

function scanSourceForBadPatterns() {
  // Keep explicit HTML/admin/workflow entrypoints, then include every runtime
  // module and feature stylesheet. The architecture has moved away from the
  // retired root controllers, so a fixed list of old JS filenames would leave
  // newly extracted modules outside the path-regression audit.
  const candidates = new Set([
    'index.html',
    'about/index.html',
    '404.html',
    'success/index.html',
    'admin/index.html',
    'admin/admin.js',
    '.github/workflows/site-validation.yml'
  ]);

  function collectSourceFiles(dir, matches) {
    if (!exists(dir)) return;
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const file = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectSourceFiles(file, matches);
      } else if (matches.test(entry.name)) {
        candidates.add(file);
      }
    }
  }

  collectSourceFiles('js', /\.(?:js|mjs)$/i);
  collectSourceFiles('css', /\.css$/i);

  for (const file of candidates) {
    if (!exists(file)) continue;
    const source = readText(file);
    if (/\/data\/data\//i.test(source)) err(file + ': contains /data/data/ path.');
    if (/\/about\/data\//i.test(source)) err(file + ': contains /about/data/ path.');
    if (/\/about\/js\//i.test(source)) err(file + ': contains /about/js/ path.');
  }
}
function validateCssDeclarations() {
  const css = exists('css/style.css') ? readText('css/style.css') : '';
  const invalidFlex = [...css.matchAll(/flex-direction\s*:\s*([^;]+);/g)]
    .map(match => String(match[1]).trim())
    .filter(value => !['row','row-reverse','column','column-reverse','initial','inherit','unset','revert','revert-layer'].includes(value));
  if (invalidFlex.length) {
    err('CSS: invalid flex-direction value(s) detected: ' + [...new Set(invalidFlex)].join(', ') + '.');
  }
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

function validateDefaultVideoPosterSetting(settings) {
  const poster = typeof settings?.defaultVideoPoster === 'string'
    ? settings.defaultVideoPoster.trim()
    : '';
  // An empty poster is valid: the site can render without a global poster.
  if (!poster) return;

  const imageExtension = /\.(?:apng|avif|gif|jpe?g|png|svg|webp)$/i;
  const isLocalAsset = poster.startsWith('assets/');
  if (isLocalAsset) {
    const localPath = poster.split(/[?#]/, 1)[0];
    const unsafeSegment = localPath.split('/').some(segment =>
      !segment || segment === '.' || segment === '..'
    );
    if (unsafeSegment || !imageExtension.test(localPath) || !fs.existsSync(path.join(ROOT, localPath))) {
      err('Site settings: defaultVideoPoster must reference an existing local image asset, not a page or video URL.');
    }
    return;
  }

  try {
    const url = new URL(poster);
    if (url.protocol !== 'https:' || url.username || url.password || !imageExtension.test(url.pathname)) {
      err('Site settings: defaultVideoPoster must be an HTTPS image URL with a recognized image extension, not a webpage URL.');
    }
  } catch (_) {
    err('Site settings: defaultVideoPoster must be blank or a valid local image asset/HTTPS image URL.');
  }
}

const filters = parseJson('data/filters.json', {});
const projects = parseJson('data/projects.json', []);
const settings = parseJson('data/settings.json', {});
const about = parseJson('data/about.json', {});
const heroLoop = parseJson('data/hero-loop.json', []);
const curatedViews = parseJson('data/curated-views.json', []);
parseJson('data/hero.json', []);
parseJson('data/reviews.json', []);

validateFilters(filters);
validateProjects(projects, filters);
validateCuratedViews(curatedViews, projects, filters);
validateHeroLoop(heroLoop);
validateDefaultVideoPosterSetting(settings);
validateAbout(about);
validateCssDeclarations();

const reviews = parseJson('data/reviews.json', []);
const heroMessages = parseJson('data/hero.json', []);
validateReviews(reviews);
validateHeroMessages(heroMessages);

if (typeof settings?.showHeroMessage !== 'boolean') err('data/settings.json: showHeroMessage must be a boolean.');
if (typeof settings?.showFooterMessage !== 'boolean') err('data/settings.json: showFooterMessage must be a boolean.');
if (settings?.defaultVideoPoster !== undefined && typeof settings.defaultVideoPoster !== 'string') {
  err('data/settings.json: defaultVideoPoster must be a string when present.');
} else if (String(settings?.defaultVideoPoster || '').trim()) {
  const defaultPoster = String(settings.defaultVideoPoster).trim();
  if (/^https:\/\//i.test(defaultPoster)) {
    // External HTTPS image URLs are allowed; runtime normalization rejects other URL schemes.
  } else if (defaultPoster.startsWith('assets/')) {
    const posterPath = defaultPoster.split(/[?#]/, 1)[0];
    if (!/\.(?:apng|avif|gif|jpe?g|png|svg|webp)$/i.test(posterPath)) {
      err('data/settings.json: defaultVideoPoster must reference a supported image file.');
    }
    checkLocalRef(defaultPoster, 'data/settings.json defaultVideoPoster');
  } else {
    err('data/settings.json: defaultVideoPoster must be an image under assets/ or an HTTPS URL.');
  }
}

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
validateCanonicalSocialMetadata();
validateSharedCssCacheVersion();
validateLightboxFeatureStylesheet();
validateUtilityPageIndexing();
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
    ['API path segment encoding uses normalized paths', /function apiPath\(filePath\)[\s\S]*?normalizeCmsPath\(filePath\)/],
    ['GitHub API referrer suppression', /referrerPolicy:\s*init\.referrerPolicy \|\| 'no-referrer'/],
    ['CMS writable-path allowlist', /const CMS_WRITABLE_PATHS = new Set\(/],
    ['CMS write-path enforcement', /assertCmsWritablePath\(file\?\.path\)/],
    ['CMS path traversal defense', /function hasUnsafeCmsPathSegments\(filePath\)/],
    ['CMS path normalization before API encoding', /function apiPath\(filePath\)[\s\S]*?normalizeCmsPath\(filePath\)/],
    ['CMS normalized asset deletion guard', /const safePath = normalizeCmsPath\(path\);[\s\S]*?safePath\.startsWith\('assets\/'\)/],
    ['CMS regular-file-only tree writes', /file\?\.mode !== undefined && file\.mode !== '100644'/],
    ['Media delete restriction', /CMS delete blocked: only media assets can be deleted/],
    ['Media deletion scans references at the captured branch head', /prepareMediaReferenceUpdates\(item\.path,\s*'__MEDIA_PATH_AUDIT__',\s*parentSha,\s*snapshot,\s*false,\s*true\)/],
    ['Referenced media deletion is blocked before commit', /if\s*\(impact\.changedFiles\.length\)\s*\{[\s\S]*?mediaDeletionReferenceMessage\(item\.path,impact\)[\s\S]*?return;/],
    ['Media deletion scan-only mode avoids creating blobs', /const blobShas=scanOnly\?\[\]:await Promise\.all\(matched\.map\(record=>GH\.createBlob/],
    ['Media deletion checks percent-encoded URL paths', /function decodeMediaPathEscapes\(source\)/],
    ['Media deletion scans docs and common source/config files', /md\|mdx\|txt\|ya\?ml\|toml\|ts\|tsx\|jsx\|vue\|svelte/],
    ['Encoded-path checking remains isolated from rename writes', /if\(scanOnly\)\{\s*if\(mediaSourceReferencesPath\(record\.current\.text,oldPath,isFolder\)\)matched\.push\(\{\.\.\.record,next:record\.current\.text\}\);\s*continue;\s*\}\s*const next=replaceMediaPathReferences\(record\.current\.text,oldPath,newPath,isFolder\)/],
    ['Media deletion uses a guarded tree commit', /await ghCommitTreeEntries\(\[\{path:item\.path,mode:source\.mode\|\|'100644',type:'blob',sha:null\}\],[\s\S]*?parentSha\)/],
    ['CMS deployment status uses the documented Checks API permission', /async getCheckRuns\(sha\)/],
    ['CMS deployment status selects Pages checks by exact job name', /latestNamedCheck\(checks, 'build'\)[\s\S]*?latestNamedCheck\(checks, 'deploy'\)[\s\S]*?latestNamedCheck\(checks, 'validate'\)/],
    ['CMS does not treat validation failure as a Pages deployment failure', /Live on site — validation failed/],
    ['CMS tracks the latest branch head when deployments are superseded', /branchHead\s*=\s*await GH\.getBranchHead\(\)/],
  ];

  required.forEach(([label, pattern]) => {
    if (!pattern.test(admin)) err('CMS security: ' + label + ' contract is missing.');
  });
  if (admin.includes('const relevant = pagesRuns.length ? pagesRuns : runs;')) {
    err('CMS security: deployment status must never treat unrelated validation checks as Pages deployment failures.');
  }
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
  if (!/timeout-minutes:\s*[1-9]\d*\b/.test(workflow)) err('CI reliability: validation workflow needs a positive integer timeout.');
  if (!/cancel-in-progress:\s*true\b/.test(workflow)) err('CI reliability: outdated validation runs should be cancelled.');
}

function validateFormAutocomplete() {
  const html = exists('index.html') ? readText('index.html') : '';
  const getForm = id => {
    const start = html.search(new RegExp('<form[^>]*\\bid="' + id + '"', 'i'));
    if (start < 0) return '';
    const end = html.indexOf('</form>', start);
    return end < 0 ? '' : html.slice(start, end + 7);
  };
  const hasAutocomplete = (form, name, token) => {
    const input = form.match(new RegExp('<input\\b(?=[^>]*\\bname="' + name + '")[^>]*>', 'i'))?.[0] || '';
    return new RegExp('\\bautocomplete="' + token + '"', 'i').test(input);
  };
  const checks = [
    ['project inquiry name', getForm('projectForm'), 'name', 'name'],
    ['project inquiry email', getForm('projectForm'), 'email', 'email'],
    ['review name/handle', getForm('reviewForm'), 'name', 'nickname']
  ];
  checks.forEach(([label, form, name, token]) => {
    if (!form || !hasAutocomplete(form, name, token)) {
      err('Forms: ' + label + ' input must expose autocomplete="' + token + '".');
    }
  });
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
  const mediaRenderer = exists('js/features/lightbox/media-renderer.js')
    ? readText('js/features/lightbox/media-renderer.js')
    : '';
  const modelViewer = exists('js/infrastructure/three/model-viewer.js')
    ? readText('js/infrastructure/three/model-viewer.js')
    : '';
  const legacy = exists('js/lightbox.js') ? readText('js/lightbox.js') : '';

  const pauseStart = mediaRenderer.indexOf('function pauseYouTubeFrame(iframe)');
  const pauseEnd = mediaRenderer.indexOf('\n  function pauseOtherPlayback', pauseStart);
  const pauseBody = pauseStart >= 0 && pauseEnd > pauseStart ? mediaRenderer.slice(pauseStart, pauseEnd) : '';
  const primeStart = mediaRenderer.indexOf('function primeYouTubeFrame(iframe)');
  const primeEnd = mediaRenderer.indexOf('\n  function bindYouTubeStateHandoff', primeStart);
  const primeBody = primeStart >= 0 && primeEnd > primeStart ? mediaRenderer.slice(primeStart, primeEnd) : '';
  if (!pauseBody.includes("iframe.dataset.lmYoutubeLoaded !== 'true'") ||
      !primeBody.includes("iframe.dataset.lmYoutubeLoaded !== 'true'") ||
      !/iframe\.dataset\.lmYoutubeLoaded = 'true';\s*primeYouTubeFrame\(iframe\)/.test(mediaRenderer)) {
    err('Lightbox: YouTube postMessage calls must wait for the iframe load event to avoid targeting the portfolio origin during navigation.');
  }

  if (legacy) {
    err('Lightbox: retired root module js/lightbox.js must not remain after feature cutover.');
  }

  if (!/if \(!modelWrap\.isConnected \|\| !lightbox\?\.classList\.contains\('active'\)\) return(?:;| null;)/.test(mediaRenderer)) {
    err('Lightbox: lazy 3D viewer mount is missing its detached-node/closed-lightbox guard.');
  }
  if (!/\.then\(cleanup => \{[\s\S]*!modelWrap\.isConnected[\s\S]*cleanup\?\.\(\)/.test(mediaRenderer)) {
    err('Lightbox: async 3D mounts must dispose themselves when the media node becomes detached or the modal closes while loading.');
  }
  if (!/createLightboxA11y\(lightbox, documentRef, windowRef, lifecycle\)/.test(source) ||
      !/keydownCleanup\?\.\(\)/.test(source) ||
      !/lifecycle\?\.animationFrame/.test(source)) {
    err('Lightbox: accessibility focus/listener work must be owned by the shared feature lifecycle.');
  }
  if (/instanceof HTMLElement/.test(source)) {
    err('Lightbox: opener detection must remain cross-document safe and not rely on the global HTMLElement constructor.');
  }

  if (!/mediaRenderer\.dispose\(modalMediaContainer\)/.test(source) ||
      !/querySelectorAll\('\.model-viewer-shell'\)/.test(mediaRenderer)) {
    err('Lightbox: mounted 3D viewers must be disposed through the media renderer before clearing DOM.');
  }
  if (!/getProjectForCard/.test(source) ||
      /\.project-media-list|\.glass-info|\.project-description/.test(source)) {
    err('Lightbox: project content must come from the normalized Projects contract, not card markup.');
  }

  const failureStart = modelViewer.indexOf('  } catch (err) {');
  const failureEnd = modelViewer.indexOf('\n\n  const resizeViewer = () => {', failureStart);
  const failurePath = failureStart >= 0 && failureEnd > failureStart
    ? modelViewer.slice(failureStart, failureEnd)
    : '';
  const failureCleanupTokens = [
    'const ownsContainer = isCurrentMount();',
    'resizeObserver?.disconnect();',
    'controls?.dispose?.();',
    'focusScrollCleanup?.();',
    'keydownCleanup?.();',
    'containerCleanup.splice(0).reverse()',
    'mixers.forEach(mixer =>',
    'disposeObject(root)',
    'renderer?.dispose?.()',
    'if (!ownsContainer) return null;'
  ];
  if (!failurePath || failureCleanupTokens.some(token => !failurePath.includes(token))) {
    err('3D viewer: partial initialization failures must release the model, renderer, controls, and owned listeners.');
  } else {
    const staleReturn = failurePath.indexOf('if (!ownsContainer) return null;');
    const cleanupEnd = Math.max(...failureCleanupTokens.slice(0, -1).map(token => failurePath.indexOf(token)));
    if (staleReturn < cleanupEnd) {
      err('3D viewer: stale mounts must release their resources before returning without mutating the newer mount.');
    }
  }
}
function validateGalleryContract() {
  const source = exists('js/features/gallery/index.js') ? readText('js/features/gallery/index.js') : '';
  const presentation = exists('js/features/gallery/presentation.js') ? readText('js/features/gallery/presentation.js') : '';
  const legacy = exists('js/gallery.js') ? readText('js/gallery.js') : '';
  const css = exists('css/style.css') ? readText('css/style.css') : '';
  const smoke = exists('tools/smoke-browser.mjs') ? readText('tools/smoke-browser.mjs') : '';

  if (legacy) {
    err('Gallery: retired root module js/gallery.js must not remain after feature cutover.');
  }
  if (/getActiveCards:\s*\(\)\s*=>\s*getActiveCards\(\)/.test(source)) {
    err('Gallery: getActiveCards() recursively calls itself.');
  }
  if (!/getActiveCards:\s*\(\)\s*=>\s*getCardsForProjects\(getFilteredProjects\(\)\)\.slice\(\)/.test(source)) {
    err('Gallery: getActiveCards() contract must expose cards mapped from the current normalized project filter.');
  }
  if (!/getAllCards:\s*\(\)\s*=>\s*getCardSnapshot\(getProjectSnapshot\(\)\)\.slice\(\)/.test(source)) {
    err('Gallery: getAllCards() must resolve from the current Projects/card mapping.');
  }
  if (!/createLifecycle/.test(source) || !/lifecycle\.cleanup\(\)/.test(source)) {
    err('Gallery: persistent runtime resources must use the shared feature lifecycle.');
  }
  if (!/from ['"]\.\/presentation\.js(?:\?[^'"]*)?['"]/.test(source) ||
      !/getResponsiveBaseCount/.test(source) ||
      !/getRowAlignedCount/.test(source) ||
      !/applyGalleryReveal/.test(source)) {
    err('Gallery: state controller must consume the presentation boundary instead of owning layout mechanics.');
  }
  if (!/export function getResponsiveBaseCount\(/.test(presentation) ||
      !/export function getRowAlignedCount\(/.test(presentation) ||
      !/export function applyGalleryReveal\(/.test(presentation) ||
      !/export function resetGalleryPresentation\(/.test(presentation)) {
    err('Gallery: presentation boundary is incomplete.');
  }
  if (/filterViewportObserver|syncFilterViewportInteraction|data-filter-viewport.*pointer-events/.test(source + '\n' + css)) {
    err('Gallery: filter controls must not use a visibility-based pointer lock; visible filter buttons must remain directly interactive.');
  }
  if (!/function\s+isFilterCarousel\s*\(\)/.test(source) ||
      !/function\s+getNearestCenteredFilterIndex\s*\(\)/.test(source)) {
    err('Gallery: centered small-screen filter carousel contract is missing.');
  }
  if (!/filterPageDots\s*=\s*buttons\.map/.test(source)) {
    err('Gallery: filter page controls must be generated one-to-one from actual filter buttons.');
  }
  if (!/(?:filterTabs\?\.addEventListener\('scroll'|bind\(filterTabs,\s*'scroll')/.test(source) ||
      !/settleCenteredFilter/.test(source)) {
    err('Gallery: horizontal scrolling must update and settle on the centered filter.');
  }
  if (!/overflow-x:\s*auto/.test(css) || !/scroll-snap-align:\s*center/.test(css)) {
    err('Gallery: small-screen filter carousel CSS contract is missing.');
  }
  if (!source.includes('const isFollowingFilterScroll = followingScroll && isFilterScroller()') ||
      !source.includes('const indicatorButton = isFollowingFilterScroll') ||
      !source.includes("filterContent.classList.toggle('is-following-filter-scroll', isFollowingFilterScroll)") ||
      !source.includes("'is-centered-preview'") ||
      !source.includes('function getFilterViewportCenterX()') ||
      !source.includes('const centerX = getFilterViewportCenterX() - hostRect.left - hostClientLeft;') ||
      !source.includes("indicator.style.translate = '-50% 0'") ||
      !source.includes("indicator.style.transform = 'translate3d(-50%, 0, 0)'") ||
      !source.includes('indicator.style.left = `${centerX}px`;') ||
      !source.includes('indicator.style.top = `${buttonRect.top - hostRect.top - hostClientTop}px`;') ||
      css.includes('transform 160ms cubic-bezier(.2, 0, 0, 1),') ||
      source.includes('button.style.width = `${Math.ceil(Math.max(inactiveWidth, activeWidth))}px`;') ||
      !css.includes('.filter-nav-content.has-active-indicator.is-following-filter-scroll .tab-btn.is-centered-preview') ||
       !css.includes('mix-blend-mode: exclusion;') ||
       !css.includes('mix-blend-mode: normal !important;') ||
        !css.includes('transition: none !important;')) {
    err('Gallery: the pill must stay centered and use the click/tap width morph during selection and swipe preview.');
  }
  if (!smoke.includes('stationary filter pill must remain centered and visibly resize during direct selection')) {
    err('Gallery: browser smoke must guard against horizontal pill travel on direct filter selection.');
  }
  if (!source.includes('function clearFilterScrollPreview()') ||
      !source.includes("bind(documentRef, 'pointerdown'") ||
      !source.includes("bind(documentRef, 'click', event => {") ||
      !source.includes('}, { capture: true });') ||
      !source.includes('let suppressFilterPreviewUntil = 0;') ||
      !source.includes('let filterScrollPreviewRequested = false;') ||
      !source.includes('filterScrollPreviewRequested = true;') ||
      !source.includes('const suppressPreview = !filterScrollPreviewRequested ||') ||
      !source.includes('Date.now() < suppressFilterPreviewUntil') ||
      !source.includes('syncFilterActiveIndicator(activeBtn);') ||
      source.includes('syncFilterActiveIndicator(activeBtn, { followingScroll: true });') ||
      !source.includes("event.key === 'ArrowRight'") ||
      !source.includes("activateFilterButton(next, { center: true, updateUrl: true });") ||
      !source.includes('signalCenteredFilter(next);') ||
      !source.includes('suppressFilterSettleUntil = Date.now() + 750;') ||
      !source.includes('if (windowRef.innerWidth <= 1023)') ||
      css.includes('Small screens should settle directly; no animated easing/bounce.') ||
      !css.includes('Match click/tap width morphing while previewing labels during a swipe.') ||
      !css.includes('@media (max-width: 1023px)') ||
      !css.includes('.filter-tabs.filter-nav-scroller {\n    scroll-behavior: auto !important;') ||
      !css.includes('scroll-snap-type: none !important;') ||
      !css.includes('overscroll-behavior-x: none !important;') ||
      !css.includes('.filter-active-indicator.is-following-scroll') ||
      !css.includes('animation: none !important;')) {
    err('Gallery: compact filter navigation must settle without bounce, ignore programmatic scroll previews, and clear stale swipe styling.');
  }
  if (!css.includes('.filter-nav-content.has-active-indicator .tab-btn') ||
      !css.includes('mix-blend-mode: exclusion;') ||
      !css.includes('mix-blend-mode: normal !important;') ||
      !css.includes('background-color: #909090 !important;') ||
      !css.includes('z-index: auto;\n  isolation: auto;') ||
      !source.includes("filterContent.classList.toggle('is-following-filter-scroll', isFollowingFilterScroll)") ||
      !source.includes("return filterContent || filterTabs?.closest('.filter-nav-viewport') || filterTabs") ||
      source.includes("item.style.setProperty('color', '#111', 'important')") ||
      !smoke.includes('indicatorInsideContent') ||
      !smoke.includes("previewBlendMode !== 'normal'") ||
      !smoke.includes("settledIndicatorBackground !== 'rgb(255, 255, 255)'") ||
      !smoke.includes('initial-load active filter contrast failed') ||
      !smoke.includes('outside tap must remeasure the committed filter pill')) {
    err('Gallery: labels must use exclusion over the settled white pill and switch to white text on a #909090 pill while interacting.');
  }

  const fontRefreshStart = source.indexOf('function refreshFilterGeometryAfterFontsLoad()');
  const fontRefreshEnd = source.indexOf('\n  function centerFilterButton(', fontRefreshStart);
  const fontRefreshContract = fontRefreshStart >= 0 && fontRefreshEnd > fontRefreshStart
    ? source.slice(fontRefreshStart, fontRefreshEnd)
    : '';
  const outsidePointerStart = source.indexOf("bind(documentRef, 'pointerdown', event => {");
  const outsideClickStart = source.indexOf("bind(documentRef, 'click', event => {", outsidePointerStart + 1);
  const outsideGestureStart = source.indexOf('// Returning to Works/home always means', outsideClickStart);
  const outsidePointerContract = outsidePointerStart >= 0 && outsideClickStart > outsidePointerStart
    ? source.slice(outsidePointerStart, outsideClickStart)
    : '';
  const outsideClickContract = outsideClickStart >= 0 && outsideGestureStart > outsideClickStart
    ? source.slice(outsideClickStart, outsideGestureStart)
    : '';
  if (!fontRefreshContract.includes('syncFilterActiveIndicator(activeButton);') ||
      fontRefreshContract.includes('syncFilterActiveIndicator(activeButton, { followingScroll: true });') ||
      !outsidePointerContract.includes('clearFilterScrollPreview();') ||
      outsidePointerContract.includes('settleCenteredFilter();') ||
      !outsideClickContract.includes('clearFilterScrollPreview();') ||
      outsideClickContract.includes('settleCenteredFilter();') ||
      !smoke.includes('initial-load active filter contrast failed') ||
      !smoke.includes('outside tap must remeasure the committed filter pill')) {
    err('Gallery: startup font/layout work and outside input must restore the committed high-contrast filter without committing an outside selection.');
  }

  if (!/\.filter-page-controls\{\s*display:none;/.test(css)) {
    err('Gallery: filter page controls must be hidden by default on desktop.');
  }
}

function validateCuratedViewPresentationContract() {
  const composition = exists('js/app/page-composition.js') ? readText('js/app/page-composition.js') : '';
  const css = exists('css/style.css') ? readText('css/style.css') : '';
  const curatedCssStart = css.indexOf('/* Public Curated View presentation:');
  const curatedCss = curatedCssStart >= 0 ? css.slice(curatedCssStart) : '';

  if (composition.includes('curated-view-eyebrow') || composition.includes('UNLISTED PORTFOLIO')) {
    err('Curated View presentation: remove the redundant unlisted eyebrow from the heading.');
  }
  if (!composition.includes("exitIcon.className = 'fa-solid fa-arrow-left'") ||
      !composition.includes("exit.append(exitIcon, root.createTextNode('View full portfolio'))")) {
    err('Curated View presentation: full-portfolio exit must include an accessible, decorative back arrow.');
  }
  const exitRule = curatedCss.match(/\.curated-view-exit\s*\{([^}]*)\}/);
  if (!exitRule || !/border:\s*0\s*;/.test(exitRule[1])) {
    err('Curated View presentation: exit link must render without a border.');
  }
  if (!/@media\s*\(max-width:\s*600px\)/.test(curatedCss) ||
      !/\.curated-view-heading\s*\{[^}]*flex-direction:\s*row/s.test(curatedCss) ||
      !/\.curated-view-heading-copy\s*\{[^}]*flex:\s*1\s+1\s+auto/s.test(curatedCss)) {
    err('Curated View presentation: narrow-screen heading and exit must remain side by side.');
  }
  if (!/\.filter-page-controls:not\(\[hidden\]\)\s*\{\s*display:\s*none\s*!important;/s.test(css)) {
    err('Gallery: small-screen filter page controls must remain hidden.');
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


function validateRuntimeCacheGraph() {
  const pages = [
    ['index.html', /js\/script\.js\?v=([^"\s>]+)/, /js\/app\/bootstrap\.js\?v=([^"\s>]+)/, /js\/app\/page-composition\.js\?v=([^"\s>]+)/],
    ['about/index.html', /\.\.\/js\/script\.js\?v=([^"\s>]+)/, /\.\.\/js\/app\/bootstrap\.js\?v=([^"\s>]+)/, /\.\.\/js\/app\/page-composition\.js\?v=([^"\s>]+)/]
  ];

  for (const [file, scriptPattern, bootstrapPattern, compositionPattern] of pages) {
    if (!exists(file)) continue;
    const html = readText(file);
    const scriptVersion = html.match(scriptPattern)?.[1] || '';
    const bootstrapVersion = html.match(bootstrapPattern)?.[1] || '';
    const compositionVersion = html.match(compositionPattern)?.[1] || '';

    if (!scriptVersion || !bootstrapVersion || !compositionVersion) {
      err(file + ': runtime module cache versions are incomplete.');
      continue;
    }
    if (scriptVersion !== bootstrapVersion || scriptVersion !== compositionVersion) {
      err(file + ': script.js, bootstrap.js, and page-composition.js cache versions must match.');
    }
  }

  const entry = exists('js/script.js') ? readText('js/script.js') : '';
  const bootstrap = exists('js/app/bootstrap.js') ? readText('js/app/bootstrap.js') : '';
  const entryVersion = entry.match(/bootstrap\.js\?v=([^'"]+)/)?.[1] || '';
  const bootstrapVersion = bootstrap.match(/cacheVersion\s*=\s*'([^']+)'/)?.[1] || '';

  if (!entryVersion || !bootstrapVersion || entryVersion !== bootstrapVersion) {
    err('Bootstrap cache graph: js/script.js and bootstrap cache versions differ.');
  }
  if (!/page-composition\.js\?v=\$\{cacheVersion\}/.test(bootstrap)) {
    err('Bootstrap cache graph: page-composition must use the same runtime cacheVersion.');
  }

  // The HTML entrypoints are the final cache owners. Matching each other is
  // not enough: they must also match the canonical runtime version declared
  // by script.js/bootstrap.js, otherwise a stale-but-consistent HTML pair can
  // load an older runtime graph and bypass the source-level cache contract.
  if (bootstrapVersion) {
    for (const [file] of pages) {
      if (!exists(file)) continue;
      const html = readText(file);
      const scriptVersion = html.match(
        file === 'index.html'
          ? /js\/script\.js\?v=([^"\s>]+)/
          : /\.\.\/js\/script\.js\?v=([^"\s>]+)/
      )?.[1] || '';
      if (scriptVersion && scriptVersion !== bootstrapVersion) {
        err(file + ': HTML runtime cache version must match the canonical bootstrap cacheVersion.');
      }
    }
  }
}

function validateModelViewerModulePreloadCacheKey() {
  const html = exists('index.html') ? readText('index.html') : '';
  const composition = exists('js/app/page-composition.js')
    ? readText('js/app/page-composition.js')
    : '';
  const preloadTag = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(match => match[0])
    .find(tag =>
      /\brel\s*=\s*["'][^"']*\bmodulepreload\b[^"']*["']/i.test(tag) &&
      /\bhref\s*=\s*["']js\/infrastructure\/three\/model-viewer\.js\?v=/i.test(tag)
    ) || '';
  if (!preloadTag) return;

  // Import maps must be registered before modulepreload starts resolving the
  // dependency graph. The Three.js viewer imports the bare "three" and
  // "three/addons/" specifiers from this map, so order is part of the runtime
  // contract, not just markup style.
  const importMapIndex = html.indexOf('<script type="importmap"');
  const viewerPreloadIndex = html.indexOf(preloadTag);
  if (importMapIndex < 0 || viewerPreloadIndex < 0 || importMapIndex > viewerPreloadIndex) {
    err('3D viewer preload: the import map must appear before the model-viewer modulepreload so bare Three.js imports resolve on first load.');
  }

  const preloadVersion = preloadTag.match(
    /\bhref\s*=\s*["']js\/infrastructure\/three\/model-viewer\.js\?v=([^"']+)["']/i
  )?.[1] || '';
  const importVersion = composition.match(
    /import\(\s*["']\.\.\/infrastructure\/three\/model-viewer\.js\?v=([^"']+)["']\s*\)/
  )?.[1] || '';

  if (!preloadVersion || !importVersion || preloadVersion !== importVersion) {
    err('3D viewer preload: index.html modulepreload cache key must match page-composition.js dynamic import to avoid duplicate module fetches.');
  }
}

function parseCacheVersion(version) {
  const parts = String(version || '').split('-');
  if (parts.length !== 2) return null;

  const [datePart, sequencePart] = parts;
  if (datePart.length !== 8 || !/^[0-9]+$/.test(datePart) || !/^[0-9]+$/.test(sequencePart)) {
    return null;
  }

  return {
    date: Number(datePart),
    sequence: Number(sequencePart)
  };
}

function validateFeatureModuleCacheGraph() {
  const composition = exists('js/app/page-composition.js')
    ? readText('js/app/page-composition.js')
    : '';

  const checks = [
    {
      name: 'Gallery',
      importPattern: /(?:from\s+|import\(\s*)['"]\.\.\/features\/gallery\/index\.js\?v=([^'"]+)['"]/,
      file: 'js/features/gallery/index.js',
      nestedPattern: /from ['"]\.\/presentation\.js\?v=([^'"]+)/g
    },
    {
      name: 'Lightbox',
      importPattern: /(?:from\s+|import\(\s*)['"]\.\.\/features\/lightbox\/index\.js\?v=([^'"]+)['"]/,
      file: 'js/features/lightbox/index.js',
      nestedPattern: /from ['"]\.\/media-renderer\.js\?v=([^'"]+)/g
    }
  ];

  for (const check of checks) {
    const directVersion = composition.match(check.importPattern)?.[1] || '';
    const module = exists(check.file) ? readText(check.file) : '';
    const nestedVersions = [...module.matchAll(check.nestedPattern)].map(match => match[1]);

    if (!directVersion || !nestedVersions.length) continue;

    const direct = parseCacheVersion(directVersion);
    const nested = nestedVersions
      .map(parseCacheVersion)
      .filter(Boolean)
      .sort((a, b) => (a.date - b.date) || (a.sequence - b.sequence));

    if (!direct || !nested.length) continue;

    const newestNested = nested.at(-1);
    if (
      newestNested.date > direct.date ||
      (newestNested.date === direct.date && newestNested.sequence > direct.sequence)
    ) {
      err(`Cache graph: ${check.name} feature import key ${directVersion} is older than its nested module key ${newestNested.date}-${newestNested.sequence}.`);
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

  if (!/await\s+createPortfolioApp\(\{\s*root,\s*runtime,\s*cms,\s*config\s*\}\)/.test(bootstrap)) {
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

  if (!/hero-section, #heroBanner, #heroBannerAbout/.test(composition)) {
    err('Composition: Hero must initialize against the actual public hero section/container.');
  }

  if (!/loopMode:\s*settings\.heroTiming\.loopMode/.test(composition) ||
      !/transitionStyle:\s*settings\.heroTiming\.transitionStyle/.test(composition) ||
      !/crossfadeMs:\s*settings\.heroTiming\.crossfadeMs/.test(composition) ||
      !/messageFadeMs:\s*settings\.heroTiming\.fadeMs/.test(composition) ||
      /messageAutoRotateMs:\s*settings\.heroTiming\.autoRotateMs/.test(composition) ||
      !/showHeroMessage:\s*settings\.showHeroMessage/.test(composition) ||
      !/showFooterMessage:\s*settings\.showFooterMessage/.test(composition) ||
      !/const footerPromise = root\.getElementById\('footerAnimation'\)\s*\?\s*initFooterAnimation\(/.test(composition)) {
    err('Composition: artwork timing and message toggles must be passed through while footer animation remains independent.');
  }

  if (!/hero-section, #heroBanner, #heroBannerAbout/.test(composition)) {
    err('Composition: Hero must initialize against the actual public hero section/container.');
  }

  const lightbox = exists('js/features/lightbox/index.js') ? readText('js/features/lightbox/index.js') : '';
  if (!/createLifecycle/.test(lightbox) || !/lifecycle\.cleanup\(\)/.test(lightbox)) {
    err('Lightbox: public feature lifecycle must use the shared lifecycle primitive.');
  }

  if (!/lightboxFeature\?\.destroy\?\.\(\)/.test(composition) ||
      !/heroFeature\?\.destroy\?\.\(\)/.test(composition) ||
      !/galleryFeature\?\.destroy\?\.\(\)/.test(composition) ||
      !/navigation\.destroy\?\.\(\)/.test(composition)) {
    err('Composition: Hero, Gallery, Lightbox, and Navigation lifecycle cleanup must be wired to app.destroy().');
  }

  const hero = exists('js/features/hero/index.js') ? readText('js/features/hero/index.js') : '';
  if (!/dataset\.component = 'portfolio-hero'/.test(hero)) {
    err('Hero: explicit component marker is missing.');
  }
  if (!/heroMessageCandidate\.hidden = !showHeroMessage/.test(hero) ||
      !/heroSection\.classList\.toggle\('hero-section--message', showHeroMessage\)/.test(hero)) {
    err('Hero: message visibility must also toggle content-driven hero sizing.');
  }
  if (!/footerElement\.classList\.toggle\('footer--message-enabled', showFooterMessage\)/.test(hero)) {
    err('Hero/footer scrim must follow footer-message visibility while artwork continues independently.');
  }
  const heroCss = exists('css/style.css') ? readText('css/style.css') : '';
  const heroQuoteRule = (heroCss.match(/\.hero-quote\s*\{[^}]*\}/) || [])[0] || '';
  const footerAnimationIsHiddenByMessageToggle =
    /footer:not\(\.footer--message-enabled\)\s*>\s*\.footer-animation[\s\S]*?display\s*:\s*none\s*!important/.test(heroCss);
  if (!/\.hero-section:has\(\.hero-quote:not\(\[hidden\]\)\)/.test(heroCss) ||
      !heroQuoteRule ||
      /(?:^|\n)\s*(?:background(?:-color)?|border(?:-[\w-]+)?|border-radius)\s*:/.test(heroQuoteRule) ||
      !/\.hero-quote \{ padding: clamp\(22px, 5\.4vw, 30px\) 24px; \}/.test(heroCss) ||
      !/footerMessageRoot\.classList\.add\('hero-quote'\)/.test(hero) ||
      !/\.footer-content \.footer-hero-message\s*\{[^}]*margin:\s*0 auto clamp\(36px,5vw,64px\)/.test(heroCss) ||
      /\.hero-quote\s*\{[^}]*backdrop-filter\s*:\s*blur/.test(heroCss) ||
      /\.footer-content \.footer-hero-message\s*\{[^}]*backdrop-filter\s*:\s*blur/.test(heroCss) ||
      !/footer\.footer--message-enabled\s*>\s*\.footer-content\s*\{[^}]*background:\s*rgba\(0,\s*0,\s*0,\s*\.42\)/.test(heroCss) ||
      !/\.footer-content > p\s*\{\s*color:inherit;margin:0;\s*\}/.test(heroCss) ||
      !/\.footer-content > p \{ text-align: center; \}/.test(heroCss) ||
      !/\.hero-section:not\(\.about-hero\):not\(\.hero-section--message\) \.hero-banner::after\s*\{\s*background:\s*transparent;\s*\}/.test(heroCss) ||
      !/\.hero-section:not\(\.about-hero\):not\(\.hero-section--message\) \.hero-banner \.slide\.active\s*\{\s*opacity:\s*1;\s*\}/.test(heroCss) ||
      footerAnimationIsHiddenByMessageToggle) {
    err('Hero/footer message: transparent quote, conditional footer-content scrim, independent artwork visibility, and spacing must remain wired.');
  }
  if (/messageAutoRotateMs|messageRotationTimer|fadeToMessageSet/.test(hero)) {
    err('Hero/footer messages must be randomly selected once per page load and must not auto-rotate.');
  }
  if (!/normalizeProjects/.test(hero) || !/getProjects/.test(hero)) {
    err('Hero: artwork selection must consume normalized Projects data through an explicit contract.');
  }
  if (!/createLifecycle/.test(hero) || !/lifecycle\.cleanup\(\)/.test(hero)) {
    err('Hero: long-lived timers and crossfade resources must use the shared lifecycle.');
  }
  if (/\.project-card|\.project-media-list|\.card-thumbnail|\.glass-info/.test(hero)) {
    err('Hero: project artwork selection must not depend on project-card DOM markup.');
  }

  const gallery = exists('js/features/gallery/index.js') ? readText('js/features/gallery/index.js') : '';
  if (!/return \{[\s\S]*destroy\(\)[\s\S]*lifecycle\.cleanup\(\)/.test(gallery)) {
    err('Gallery: public feature lifecycle must expose destroy() through the shared lifecycle primitive.');
  }

  const navigation = exists('js/features/navigation/index.js') ? readText('js/features/navigation/index.js') : '';
  if (!/return \{[\s\S]*destroy\(\)[\s\S]*cleanup\.splice\(0\)/.test(navigation)) {
    err('Navigation: public feature lifecycle must expose destroy() and release persistent listeners.');
  }
  const publicWorks = exists('index.html') ? readText('index.html') : '';
  const publicAbout = exists('about/index.html') ? readText('about/index.html') : '';
  if (!/class="hamburger"/.test(publicWorks) || !/class="nav-links"/.test(publicWorks) ||
      !/class="hamburger"/.test(publicAbout) || !/class="nav-links"/.test(publicAbout)) {
    err('Navigation: public Works/About markup must expose the .hamburger and .nav-links contract.');
  }
  if (!/querySelector\('\.hamburger, \.menu-button'\)/.test(navigation) ||
      !/querySelector\('\.nav-links, \.mobile-menu'\)/.test(navigation) ||
      !/mobileMenu\.classList\.add\('active'(?:, 'is-open')?\)/.test(navigation)) {
    err('Navigation: runtime must bind the public hamburger to the public nav-links menu and toggle its active state.');
  }

  const navigationCss = exists('css/style.css') ? readText('css/style.css') : '';
  const navbarRule = (navigationCss.match(/\.navbar\s*\{[^}]*\}/) || [])[0] || '';
  const logoRule = (navigationCss.match(/\.site-logo\s*\{[^}]*\}/) || [])[0] || '';
  const hamburgerRule = (navigationCss.match(/(?:^|\n)\.hamburger\s*\{[^}]*\}/g) || []).slice(-1)[0] || '';
  const hamburgerButtonRule = (navigationCss.match(/(?:^|\n)button\.hamburger\s*\{[^}]*\}/g) || []).slice(-1)[0] || '';
  const hamburgerIconRule = (navigationCss.match(/(?:^|\n)\.hamburger-icon span\s*\{[^}]*\}/g) || []).slice(-1)[0] || '';
  const hamburgerHoverRule = (navigationCss.match(/\.hamburger:hover\s*\{[^}]*\}/g) || []).slice(-1)[0] || '';
  const hamburgerPressRule = (navigationCss.match(/\.hamburger:active\s*\{[^}]*\}/g) || []).slice(-1)[0] || '';
  const pillRule = (navigationCss.match(/\.nav-links a\s*\{[^}]*\}/) || [])[0] || '';
  const activePillRule = (navigationCss.match(/\.nav-links a\.active-link\s*\{[^}]*\}/) || [])[0] || '';
  const hoverPillRule = (navigationCss.match(/\.nav-links a:hover\s*\{[^}]*\}/) || [])[0] || '';
  const mobileMenuRule = (navigationCss.match(/@media \(max-width: 767px\) \{\s*\.hamburger \{ display: block; \}[\s\S]*?\.nav-links \{[^}]*\}/) || [])[0] || '';
  const mobileOpenMenuRule = (navigationCss.match(/\.nav-links\.active\.is-open\s*\{[^}]*\}/) || [])[0] || '';
  const menuBackdropRule = (navigationCss.match(/\.nav-menu-backdrop\s*\{[^}]*\}/) || [])[0] || '';
  const bodyMenuOpenRule = (navigationCss.match(/body\.menu-open\s*\{[^}]*\}/) || [])[0] || '';
  if (!publicWorks.includes('class="active-link" aria-current="page"><span class="nav-link-label">Designs</span></a>') ||
      !publicAbout.includes('class="active-link" aria-current="page"><span class="nav-link-label">About Me</span></a>') ||
      !publicWorks.includes('<span class="hamburger-icon" aria-hidden="true"><span></span><span></span><span></span></span>') ||
      !publicAbout.includes('<span class="hamburger-icon" aria-hidden="true"><span></span><span></span><span></span></span>') ||
      !publicWorks.includes('<li><a href="#contact-start"><span class="nav-link-label">Contacts</span></a></li>') ||
      !publicAbout.includes('<li><a href="../#contact-start"><span class="nav-link-label">Contacts</span></a></li>') ||
      /class="nav-(?:item-dropdown|dropdown-menu|dropdown-toggle)/.test(publicWorks + publicAbout)) {
    err('Navigation: Works/About must use direct Designs, About Me, and Contacts links without nested dropdown markup.');
  }
  if (/\b(?:background|background-color|backdrop-filter|border-bottom)\s*:/.test(navbarRule) ||
      !/filter:\s*brightness\(0\) invert\(1\)/.test(logoRule) ||
      !/mix-blend-mode\s*:\s*normal/.test(logoRule) ||
      !/background:\s*transparent/.test(hamburgerButtonRule) ||
      !/mix-blend-mode\s*:\s*normal/.test(hamburgerRule) ||
      !/backdrop-filter:\s*none/.test(hamburgerButtonRule) ||
      !/width:\s*38px/.test(hamburgerButtonRule) ||
      !/min-width:\s*38px/.test(hamburgerButtonRule) ||
      !/height:\s*38px/.test(hamburgerButtonRule) ||
      navigationCss.includes('.navbar::before') ||
      !/mix-blend-mode\s*:\s*normal/.test(hamburgerIconRule) ||
      !/background:\s*var\(--hamburger-foreground,\s*#fff\)/.test(hamburgerIconRule) ||
      !/height:\s*2\.5px/.test(hamburgerIconRule) ||
      !/background:\s*transparent/.test(hamburgerHoverRule) ||
      !/background:\s*transparent/.test(hamburgerPressRule) ||
      !/body\.menu-open \.hamburger-icon span\s*\{[^}]*background:\s*#fff/s.test(navigationCss) ||
      !/function syncHamburgerForeground/.test(navigation) ||
      !/menuButton\.dataset\.foreground = resolvedForeground/.test(navigation) ||
      !/menuButton\.style\.setProperty\('--hamburger-foreground'/.test(navigation) ||
      !/border-radius\s*:\s*999px/.test(pillRule) ||
      !/border:\s*0/.test(pillRule) ||
      /border-color\s*:/.test(pillRule + activePillRule + hoverPillRule) ||
      !/background\s*:\s*#000/.test(pillRule) ||
      !/color\s*:\s*#fff/.test(pillRule) ||
      !/background\s*:\s*#fff/.test(activePillRule) ||
      !/color\s*:\s*#000/.test(activePillRule) ||
      !/background\s*:\s*#fff/.test(hoverPillRule) ||
      !/color\s*:\s*#000/.test(hoverPillRule) ||
      !/position\s*:\s*fixed/.test(mobileOpenMenuRule) ||
      !/background\s*:\s*#000/.test(mobileOpenMenuRule) ||
      !/background:\s*#000/.test(menuBackdropRule) ||
      !/background-color:\s*#000/.test(bodyMenuOpenRule) ||
      !/overflow:\s*hidden/.test(bodyMenuOpenRule) ||
      !/background:\s*transparent/.test(mobileMenuRule) ||
      !/border:\s*0/.test(mobileMenuRule) ||
      !/box-shadow:\s*none/.test(mobileMenuRule) ||
      !/nav-menu-enter/.test(navigationCss) ||
      !/nav-menu-exit/.test(navigationCss) ||
      !/nav-link-select/.test(navigationCss) ||
      !/prefers-reduced-motion:\s*reduce/.test(navigationCss) ||
      !/0 0 0 2px #000, 0 0 0 4px #fff/.test(navigationCss) ||
      !/classList\.add\('is-open'\)/.test(navigation) ||
      !/classList\.add\('is-closing'\)/.test(navigation) ||
      !/replayingMenuLink/.test(navigation)) {
    err('Navigation: transparent chrome, state-driven logo foreground, inverted active pill, difference-blended menu icon, and seamless full-screen mobile menu must remain in the CSS contract.');
  }

  const about = exists('js/features/about/index.js') ? readText('js/features/about/index.js') : '';
  if (!/about\.softwareSkills/.test(about) ||
      !/about\.experience/.test(about) ||
      !/about\.education/.test(about) ||
      !/about\.awards/.test(about)) {
    err('About: CMS feature must render software skills, experience, education, and awards data.');
  }

  if (!/skill\.icon \|\| skill\.logo/.test(about)) {
    err('About: CMS software skill icons must support the stored icon field.');
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
    ['js/infrastructure/software-logo/lookup.js', /export function findSoftwareLogoCandidates/],
    ['js/core/lifecycle.js', /export function createLifecycle/],
    ['js/features/gallery/presentation.js', /export function applyGalleryReveal/],
    ['js/features/projects/index.js', /export \{ mountProjects \}/],
    ['js/features/gallery/index.js', /export async function initGallery/],
    ['js/features/hero/index.js', /export \{ initHeroBanner as initHeroBannerV2 \}/],
    ['js/features/lightbox/index.js', /export function initLightbox/],
    ['js/features/lightbox/media-renderer.js', /export function createLightboxMediaRenderer/],
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
validateSoftwareLogoLookup();
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


function validateSoftwareLogoLookup() {
  const resolver = exists('js/infrastructure/software-logo/lookup.js')
    ? readText('js/infrastructure/software-logo/lookup.js')
    : '';
  const about = exists('js/features/about/index.js')
    ? readText('js/features/about/index.js')
    : '';
  const admin = exists('admin/admin.js')
    ? readText('admin/admin.js')
    : '';

  if (resolver.includes('logo.clearbit.com') || admin.includes('logo.clearbit.com')) {
    err('Software logos: retired Clearbit Logo API must not be referenced.');
  }
  if (!resolver.includes('cdn.simpleicons.org/')) {
    err('Software logos: public resolver must use the reference Simple Icons CDN.');
  }
  if (!resolver.includes('api.iconify.design/search')) {
    err('Software logos: public resolver must use the Iconify search API as a discovery fallback.');
  }
  if (!about.includes('findSoftwareLogoCandidates')) {
    err('Software logos: About feature must consume the automatic logo resolver.');
  }
  if (!admin.includes('findAutomaticSoftwareLogoCandidates')) {
    err('Software logos: CMS must use the automatic logo lookup for skills without manual icons.');
  }
}

function validateResponsiveUiContracts() {
  const gallery = exists('js/features/gallery/index.js') ? readText('js/features/gallery/index.js') : '';
  const presentation = exists('js/features/gallery/presentation.js') ? readText('js/features/gallery/presentation.js') : '';
  const style = exists('css/style.css') ? readText('css/style.css') : '';
  const tokens = exists('css/tokens.css') ? readText('css/tokens.css') : '';
  if (!style.startsWith("@import url('./tokens.css');")) {
    err('CSS foundation: style.css must load the shared UI token layer first.');
  }
  if (!/--lm-color-background:/.test(tokens) ||
      !/--lm-container-max:/.test(tokens) ||
      !/--lm-card-radius:/.test(tokens) ||
      !/--lm-motion-standard:/.test(tokens)) {
    err('CSS foundation: shared visual and motion tokens are incomplete.');
  }
  const adminCss = exists('admin/admin.css') ? readText('admin/admin.css') : '';
  const admin = exists('admin/admin.js') ? readText('admin/admin.js') : '';

  if (!/phoneCount/.test(presentation) || !/tabletShortCount/.test(presentation) ||
      !/tabletTallCount/.test(presentation) || !/desktopCount/.test(presentation)) {
    err('Gallery responsive presentation contract: density must be configurable outside the Gallery state controller.');
  }
  if (!/phoneBreakpoint/.test(presentation) || !/tabletBreakpoint/.test(presentation)) {
    err('Gallery responsive presentation contract: breakpoint decisions belong to the presentation boundary.');
  }
  const phoneTwoColumn = style.includes('@media (max-width: 767px)') && style.includes('grid-template-columns:repeat(2,minmax(0,1fr));');
  const tabletThreeColumn = style.includes('@media (min-width: 768px) and (max-width: 1099px)') && style.includes('grid-template-columns:repeat(3,minmax(0,1fr));');
  const desktopThreeColumn = style.includes('@media (min-width: 1100px)') && style.includes('grid-template-columns:repeat(3,minmax(0,1fr));');
  if (!phoneTwoColumn || !tabletThreeColumn || !desktopThreeColumn) {
    err('Gallery responsive layout contract: phone must use two columns, tablet and desktop must use three columns.');
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

function validateCuratedViewRuntimeContract() {
  const composition = exists('js/app/page-composition.js') ? readText('js/app/page-composition.js') : '';
  const resolver = exists('js/features/curated-views/resolver.js') ? readText('js/features/curated-views/resolver.js') : '';
  const navigation = exists('js/features/navigation/index.js') ? readText('js/features/navigation/index.js') : '';
  const bootstrap = exists('js/app/bootstrap.js') ? readText('js/app/bootstrap.js') : '';
  const loader = exists('js/features/projects/project-loader.js') ? readText('js/features/projects/project-loader.js') : '';
  if (!composition.includes('resolveCuratedView({ hash: currentHash, views, mainProjects: mainPayload })') ||
      !composition.includes('projectData: projectPayload') ||
      !composition.includes('mainProjectModels.slice()') ||
      !resolver.includes('export function resolveCuratedView(') ||
      !resolver.includes("entry.source === 'main'") ||
      !resolver.includes("entry.source !== 'curated'") ||
      !navigation.includes('getCuratedViewSlug') ||
      !bootstrap.includes("root.getElementById('curatedViewHeading')") ||
      !loader.includes('projectData !== undefined')) {
    err('Curated View runtime: hash resolution, ordered payloads, navigation context, and shared Projects loading must remain connected.');
  }
}

function validateAboutFirstPaintContract() {
  const composition = exists('js/app/page-composition.js')
    ? readText('js/app/page-composition.js')
    : '';
  const waitStart = composition.search(/await Promise\.all\(\[\s*projectMediaPreloadPromise,/);
  const waitEnd = composition.indexOf('// About-page prefetching and image/logo warm-up', waitStart);
  if (waitStart < 0 || waitEnd <= waitStart) {
    err('About first paint: startup media-warm-up boundary could not be verified.');
    return;
  }
  if (!composition.includes('const projectLottiePlayerPreloadPromise = hasProjectGallery && projectModels.some(')) {
    err('About first paint: project-specific Lottie warm-up must be skipped when no Gallery exists.');
  }
  const criticalWait = composition.slice(waitStart, waitEnd);
  if (criticalWait.includes('aboutAssetPreloadPromise')) {
    err('About first paint: optional profile/software-logo image preloads must not block the initial transition.');
  }
}

function validateResponsiveHeroGalleryAndLogoContract() {
  const css = exists('css/style.css') ? readText('css/style.css') : '';
  const works = exists('index.html') ? readText('index.html') : '';
  const about = exists('about/index.html') ? readText('about/index.html') : '';
  const entry = exists('js/script.js') ? readText('js/script.js') : '';
  const bootstrap = exists('js/app/bootstrap.js') ? readText('js/app/bootstrap.js') : '';
  const composition = exists('js/app/page-composition.js') ? readText('js/app/page-composition.js') : '';
  const settingsFeature = exists('js/features/settings/index.js') ? readText('js/features/settings/index.js') : '';
  const navigation = exists('js/features/navigation/index.js') ? readText('js/features/navigation/index.js') : '';
  const hero = exists('js/features/hero/index.js') ? readText('js/features/hero/index.js') : '';
  const footer = exists('js/features/footer/index.js') ? readText('js/features/footer/index.js') : '';
  const contrast = exists('js/infrastructure/browser/media-contrast.js')
    ? readText('js/infrastructure/browser/media-contrast.js')
    : '';
  const smoke = exists('tools/smoke-browser.mjs') ? readText('tools/smoke-browser.mjs') : '';
  const siteSettings = exists('js/data/site-settings.js') ? readText('js/data/site-settings.js') : '';

  if (!works.includes('<main class="container page-spacing works-main">') ||
      !css.includes('.works-main {\n  padding-inline: 0;\n}') ||
      !css.includes('.hero-section:not(.about-hero):not(.hero-section--message)') ||
      !css.includes('min-height: clamp(440px, 64svh, 780px);') ||
      !css.includes('min-height: clamp(420px, 60svh, 680px);') ||
      !css.includes('min-height: clamp(360px, 62svh, 620px);')) {
    err('Responsive Works presentation: the message-free hero sizing and gallery-specific gutter reset are incomplete.');
  }

  if (/\.hero-section:not\(\.about-hero\) \.hero-banner::before\s*\{[^}]*linear-gradient/s.test(css)) {
    err('Hero presentation: the Works hero artwork must not have a bottom-edge gradient fade.');
  }

  const navigationPillRule = (css.match(/\.nav-links a\s*\{([^}]*)\}/) || [])[1] || '';
  const navigationLabelRule = (css.match(/\.nav-link-label\s*\{([^}]*)\}/) || [])[1] || '';
  if (!/display:\s*flex/.test(navigationPillRule) ||
      !/align-items:\s*center/.test(navigationPillRule) ||
      !/justify-content:\s*center/.test(navigationPillRule) ||
      !/text-align:\s*center/.test(navigationPillRule) ||
      !/box-sizing:\s*border-box/.test(navigationPillRule) ||
      !/display:\s*block/.test(navigationLabelRule) ||
      !/width:\s*max-content/.test(navigationLabelRule) ||
      !/line-height:\s*1/.test(navigationLabelRule) ||
      !/text-box-trim:\s*trim-both/.test(navigationLabelRule) ||
      !/text-box-edge:\s*cap alphabetic/.test(navigationLabelRule)) {
    err('Navigation pills: explicit content-sized label boxes must remain mathematically centered without manual offsets.');
  }

  const filterPillRule = (css.match(/\.filter-tabs\s+\.tab-btn\s*\{([^}]*)\}/) || [])[1] || '';
  const showMorePillRule = (css.match(/(?:^|\n)\.btn-show-more\s*\{([^}]*)\}/) || [])[1] || '';
  const showMoreHitTargetRule = (css.match(/\.show-more-wrapper\s+\.btn-show-more\s*\{([^}]*)\}/) || [])[1] || '';
  const contactPillRule = (css.match(/\.contact-mobile-tab\s*\{([^}]*)\}/) || [])[1] || '';
  // Validate the compact mobile segmented control and its single sliding,
  // drag-follow indicator; the tab labels remain transparent above that pill.
  const contactTabsMobileRuleStart = css.lastIndexOf('.contact-mobile-tabs{');
  const contactTabsMobileMediaStart = contactTabsMobileRuleStart >= 0
    ? css.lastIndexOf('@media', contactTabsMobileRuleStart)
    : -1;
  const contactTabsMobileCss = contactTabsMobileMediaStart >= 0
    ? css.slice(contactTabsMobileMediaStart)
    : '';
  const compactContactPillRule = (contactTabsMobileCss.match(/\.contact-mobile-tab\s*\{([^}]*)\}/) || [])[1] || '';
  const compactContactActivePillRule = (contactTabsMobileCss.match(/\.contact-mobile-tab\.is-active,\s*\.contact-mobile-tab\[aria-selected="true"\]\s*\{([^}]*)\}/) || [])[1] || '';
  const compactContactIndicatorRule = (contactTabsMobileCss.match(/\.contact-mobile-tabs::before\s*\{([^}]*)\}/) || [])[1] || '';
  const compactContactDragIndicatorRule = (contactTabsMobileCss.match(/\.contact-mobile-tabs\.is-dragging::before\s*\{([^}]*)\}/) || [])[1] || '';
  const sharedPillTokenRule = (css.match(/:root\s*\{([^}]*--lm-nav-pill-min-height[^}]*)\}/) || [])[1] || '';
  const compactPillTokenRule = (css.match(/@media\s*\(max-width:\s*767px\)\s*\{\s*:root\s*\{([^}]*)\}/) || [])[1] || '';
  const sharedPillDeclarations = [
    'min-height: var(--lm-nav-pill-min-height);',
    'padding: 0 var(--lm-nav-pill-inline-padding);',
    'font-size: var(--lm-nav-pill-font-size);',
    'font-weight: var(--lm-nav-pill-font-weight);',
    'letter-spacing: var(--lm-nav-pill-letter-spacing);',
    'line-height: var(--lm-nav-pill-line-height);'
  ];
  if (!sharedPillTokenRule.includes('--lm-nav-pill-min-height: 44px;') ||
      !sharedPillTokenRule.includes('--lm-nav-pill-inline-padding: 18px;') ||
      !sharedPillTokenRule.includes('--lm-nav-pill-font-size: 0.78rem;') ||
      !compactPillTokenRule.includes('--lm-nav-pill-min-height: 46px;') ||
      !compactPillTokenRule.includes('--lm-nav-pill-font-size: 0.8rem;') ||
      !sharedPillDeclarations.every(declaration =>
        [navigationPillRule, filterPillRule, showMorePillRule, contactPillRule]
          .every(rule => rule.includes(declaration))) ||
      ![navigationPillRule, filterPillRule, showMorePillRule, contactPillRule]
        .every(rule => rule.includes('text-transform: uppercase;')) ||
      !showMorePillRule.includes('font-family: var(--lm-font-label);') ||
      !showMoreHitTargetRule.includes('pointer-events: auto;') ||
      !contactPillRule.includes('font-family: var(--lm-font-label);') ||
      !compactContactPillRule.includes('min-height: var(--lm-nav-pill-min-height);') ||
      !compactContactPillRule.includes('padding: 0 8px;') ||
      !compactContactActivePillRule.includes('background:transparent;') ||
      !compactContactActivePillRule.includes('color:#000;') ||
      !compactContactIndicatorRule.includes('background:#fff;') ||
      !compactContactIndicatorRule.includes('width:calc((100% - 18px) / 2);') ||
      !compactContactIndicatorRule.includes('transition:transform 300ms cubic-bezier(.22,1,.36,1)') ||
      !compactContactDragIndicatorRule.includes('var(--contact-pill-drag-base-x') ||
      !contactTabsMobileCss.includes('.contact-mobile-tabs[data-active="review"]::before') ||
      !css.includes('.btn-show-more.expanded{') ||
      !css.includes('width:var(--lm-nav-pill-min-height);') ||
      !css.includes('height:var(--lm-nav-pill-min-height);')) {
    err('Navigation, filters, Show More/Show Less, mobile Contact tabs, and desktop Lightbox close must share the pill sizing/type system.');
  }

  const filterWrapperRule = (css.match(/\.filter-nav-wrapper\s*\{([^}]*)\}/) || [])[1] || '';
  const filterScrollerRule = (css.match(/\.filter-tabs\.filter-nav-scroller\s*\{([^}]*)\}/) || [])[1] || '';
  const filterContentRule = (css.match(/\.filter-nav-content\s*\{([^}]*)\}/) || [])[1] || '';
  if (!/width:\s*calc\(100% - 40px\)/.test(filterWrapperRule) ||
      !/max-width:\s*var\(--lm-container-max\)/.test(filterWrapperRule) ||
      !/padding-block:\s*12px/.test(filterWrapperRule) ||
      !/width:\s*100%/.test(filterScrollerRule) ||
      !/overflow-x:\s*auto/.test(filterScrollerRule) ||
      !/justify-content:\s*center/.test(filterContentRule)) {
    err('Filter tabs: the shared wrapper must own balanced gutters while the content stays centered until scrolling is needed.');
  }
  if (!/\.tab-btn\s*\{[^}]*display:\s*inline-flex/s.test(css) ||
      !/\.tab-btn\s*\{[^}]*min-height:\s*44px/s.test(css) ||
      !css.includes('.hero-section:not(.about-hero) + main.works-main.page-spacing {\n  padding-top: 0;') ||
      !/mask-image:\s*linear-gradient\(90deg, transparent 0, #000 20px, #000 calc\(100% - 20px\), transparent 100%\)/.test(css) ||
      !/touch-action:\s*pan-y;/.test(filterScrollerRule) ||
      css.includes('scroll-snap-stop: always')) {
    err('Works filters must retain balanced hero/gallery spacing, 44px targets, overflow-edge fading, and natural vertical touch scrolling.');
  }

  const logoCommentStart = css.lastIndexOf('/* Adaptive logo foreground is driven');
  const logoRuleStart = logoCommentStart >= 0 ? css.indexOf('.site-logo {', logoCommentStart) : -1;
  const logoRuleEnd = logoRuleStart >= 0 ? css.indexOf('}', logoRuleStart) : -1;
  const logoRule = logoRuleStart >= 0 && logoRuleEnd > logoRuleStart
    ? css.slice(logoRuleStart, logoRuleEnd)
    : '';
  if (!logoRule.includes('mix-blend-mode: normal') ||
      !logoRule.includes('filter var(--lm-motion-standard) ease') ||
      !logoRule.includes('transform 0.3s ease') ||
      !/\.site-logo:hover\s*\{\s*transform:\s*translateY\(-1px\) scale\(1\.06\)/s.test(css) ||
      !/\.nav-logo:active \.site-logo\s*\{\s*transform:\s*scale\(\.96\)\s*;?\s*\}/s.test(css) ||
      !/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.site-logo\s*\{\s*transition:\s*none/s.test(css) ||
      !/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.nav-logo:active \.site-logo\s*\{\s*transform:\s*none/s.test(css)) {
    err('Adaptive logo: backdrop-state feedback, subtle pointer/press motion, and reduced-motion behavior must remain wired.');
  }

  if (!contrast.includes('export function sampleMediaLuminance') ||
      !contrast.includes('export function foregroundForLuminance') ||
      !navigation.includes("from '../../infrastructure/browser/media-contrast.js?v=20261018-08'") ||
      !navigation.includes('logo.dataset.logoForeground = foreground') ||
      !navigation.includes('sampleMediaLuminance(root, media, point)') ||
      !navigation.includes('function isVisibleMediaAtPoint(candidate, x, y)') ||
      !navigation.includes("current.classList?.contains('slide') && !current.classList.contains('active')") ||
      !navigation.includes('function setLogoFallbackForeground(') ||
      !navigation.includes("heroSection?.classList.contains('about-hero')") ||
      !navigation.includes("const heroBanner = heroSection?.querySelector?.('.hero-banner')") ||
      !navigation.includes("setDynamicBackdropState(Boolean(media.closest?.('.hero-banner')) || ['video', 'canvas', 'lottie-player'].includes(media.localName))") ||
      !navigation.includes("if (heroSection?.classList.contains('hero-section--message')) {") ||
      !navigation.includes("const contactAreaUnderLogo = stack.some(element => element?.closest?.('#contact-section'))") ||
      
      !navigation.includes("setLogoForeground(0.02)") ||
       navigation.includes('contact-area-logo') ||
       navigation.includes('logo-contrast-fallback') ||
       css.includes('.nav-logo::before') ||
       css.includes('.nav-logo.logo-contrast-fallback::before') ||
       css.includes('.nav-logo.contact-area-logo::before') ||
      !navigation.includes("function effectiveAboutHeroLuminance(media, sampledLuminance, point)") ||
      !navigation.includes("effectiveAboutHeroLuminance(media, sampledLuminance, point)") ||
      !navigation.includes("--about-hero-scrim-top-alpha") ||
      !navigation.includes("--about-hero-scrim-bottom-alpha") ||
      !navigation.includes('instantLogoReset') ||
      
      !navigation.includes('MutationObserver') ||
      !navigation.includes('function setDynamicBackdropState(isDynamic)') ||
      !navigation.includes('logoBackdropIsDynamic') ||
      !navigation.includes("root.visibilityState !== 'hidden'") ||
      !navigation.includes('const backdropColor = parseColor(') ||
      !navigation.includes("bind(windowRef, 'scroll', scheduleLogoContrast") ||
      !navigation.includes("bind(root, 'loadeddata', scheduleLogoContrast")) {
    err('Adaptive logo runtime: active-media sampling, fallback surface, state updates, and DOM-state observation must remain connected.');
  }

  if (!hero.includes('if (!slides.length) return () => {};') ||
      hero.includes('if (slides.length <= 1 || isReducedMotionFn()) return () => {};') ||
      !hero.includes('media.loop = slides.length === 1') ||
      !hero.includes('activateMedia(slides[currentIndex])') ||
      !hero.includes("media.dataset.playbackState = 'blocked'") ||
      !hero.includes("const posterSource = source.poster || config.defaultVideoPoster;") ||
       !hero.includes("const posterUrl = posterSource ? resolveAssetUrl(posterSource) : '';") ||
       !hero.includes("defaultVideoPoster: typeof options.defaultVideoPoster === 'string' ? options.defaultVideoPoster.trim() : ''") ||
       !hero.includes("if (source.type === 'video' && !hasVideoPoster) {") ||
      hero.includes('og-image.jpg') ||
      !hero.includes('if (media.readyState < 2)') ||
      !hero.includes("media.addEventListener('canplay', retryAfterReady, { once: true });") ||
      !hero.includes("bind(interactionSurface, 'pointerdown', retryBlockedVideo") ||
      !hero.includes("bind(documentRef, 'pointerdown', retryBlockedVideo") ||
      !hero.includes("bind(windowRef, 'online', retryBlockedVideo") ||
      !hero.includes('const activeMediaCleanups = [];') ||
      !hero.includes('clearActiveMediaListeners()') ||
      !hero.includes('if (reducedMotion) {')) {
    err('Hero media runtime: a single video/Lottie must activate, loop where appropriate, handle rejected playback, and respect reduced motion.');
  }

  if (!siteSettings.includes('kenBurnsFromScale: 1') ||
      !siteSettings.includes('kenBurnsToScale: 1.15') ||
      !siteSettings.includes('kenBurnsDurationS: 14') ||
      !siteSettings.includes('const numericKenBurnsFrom = Number(hero.kenBurnsFromScale)') ||
      !siteSettings.includes('const numericKenBurnsTo = Number(hero.kenBurnsToScale)') ||
      !siteSettings.includes('const numericKenBurnsDuration = Number(hero.kenBurnsDurationS)')) {
    err('CMS settings sync: normalized hero timing must preserve the stored Ken Burns scale and duration fields.');
  }

  if (!footer.includes("from '../../infrastructure/browser/media-contrast.js?v=20261018-08'") ||
      !footer.includes('chooseForeground(documentRef, source, media)') ||
      !footer.includes('windowRef.setInterval') ||
      !footer.includes('lifecycle.cleanup()')) {
    err('Footer regression contract: the shared contrast helper, video refresh, and lifecycle cleanup must remain connected.');
  }

  if (!smoke.includes('async function assertWorksHeroGalleryResponsive') ||
      !smoke.includes("await assertWorksHeroGalleryResponsive(page, true, 'Hero Message enabled')") ||
      smoke.split('footerSlides.length > 0').length - 1 < 2 ||
      smoke.split('activeFooterSlides.length === 1').length - 1 < 2 ||
      smoke.split('const normalizeOpaqueColor = color => String(color ||').length - 1 < 4 ||
      !smoke.includes('normalizeOpaqueColor(style.backgroundColor)') ||
      !smoke.includes("'Works Hero current CMS setting'") ||
      !smoke.includes('filterHeroGap') || !smoke.includes('filterTabCenterDeltaX') ||
      !smoke.includes('filterTouchAction') || !smoke.includes('async function assertNoLogoBackingPlate') ||
      !smoke.includes('Loading gate') || !smoke.includes('Footer') ||
      !smoke.includes('logo-slide-stack') ||
      !smoke.includes("page.emulateMedia({ reducedMotion: 'reduce' })") ||
      !smoke.includes("await page.waitForFunction(\n        () => document.querySelector('.site-logo')?.dataset?.logoForeground === 'dark'") ||
      !smoke.includes("await page.waitForFunction(\n        () => document.querySelector('.site-logo')?.dataset?.logoForeground === 'light'") ||
      !smoke.includes('hero video did not resume after a real interaction') ||
      !hero.includes("media.preload = reducedMotion ? 'none' : (i === 0 ? 'auto' : 'metadata');") ||
      !hero.includes('if (!reducedMotion) media.src = resolveAssetUrl(source.src);') ||
      !hero.includes("const posterSource = source.poster || config.defaultVideoPoster;") ||
       !hero.includes("const posterUrl = posterSource ? resolveAssetUrl(posterSource) : '';") ||
       !hero.includes("defaultVideoPoster: typeof options.defaultVideoPoster === 'string' ? options.defaultVideoPoster.trim() : ''") ||
       !hero.includes("if (source.type === 'video' && !hasVideoPoster) {") ||
      hero.includes('og-image.jpg') ||
      !hero.includes("sources[0]?.type !== 'video'") ||
      !hero.includes('function scheduleNetworkRetry(slide, media)') ||
      !smoke.includes('Reduced-motion hero must keep the video source detached and avoid reusing the Open Graph image') ||
      !smoke.includes("for (const viewport of viewports)") ||
      /if \(viewport\.name === 'desktop'\) \{\s*const videoContract/.test(smoke) ||
      !smoke.includes("const retryTarget = expectedMessage ? '.hero-overlay' : '#heroBanner';") ||
      !smoke.includes("await page.locator('.hero-overlay').click({ position: { x: 12, y: 12 } })") ||
      !smoke.includes('CMS heroTiming Ken Burns values were not synchronized into the footer renderer') ||
      !smoke.includes("document.body.classList.contains('menu-open')") ||
      !smoke.includes("gate.dataset.loading = 'active'") ||
      about.includes('about-filter-rail') ||
      css.includes('.about-filter-rail') ||
      !smoke.includes('About page must not render Works category filter tabs') ||
      !smoke.includes('About adaptive-logo fixture') ||
      !smoke.includes('Contact-area logo lost its white/filter transition') ||
      !smoke.includes('navigation label box or visible text is not centered') ||
      css.includes('.nav-logo::before') ||
      css.includes('.nav-logo.logo-contrast-fallback::before') ||
      css.includes('.nav-logo.contact-area-logo::before')) {
    err('Responsive browser smoke: both message states, contrast changes, single-video playback, and reduced motion must be exercised.');
  }

  if (!entry.includes("bootstrap.js?v=20261024-02") ||
      !bootstrap.includes("cacheVersion = '20261024-02'") ||
      !composition.includes("navigation/index.js?v=20261019-02") ||
      !composition.includes("about/index.js?v=20261024-01") ||
      !composition.includes("hero/index.js?v=20261024-01") ||
      !composition.includes("footer/index.js?v=20261023-02") ||
      !composition.includes("settings/index.js?v=20261021-02") ||
      !composition.includes("interaction-feedback/index.js?v=20261018-03") ||
      !composition.includes("gallery/index.js?v=20261024-02") ||
      !settingsFeature.includes("site-settings.js?v=20261021-02") ||
      !works.includes('js/app/bootstrap.js?v=20261024-02') ||
      !works.includes('js/app/page-composition.js?v=20261024-02') ||
      !works.includes('css/style.css?v=20261023-03') ||
      !works.includes('js/script.js?v=20261024-02') ||
      !about.includes('style.css?v=20261023-03') ||
      !about.includes('js/app/bootstrap.js?v=20261024-02') ||
      !about.includes('script.js?v=20261024-02') ||
      !about.includes('page-composition.js?v=20261024-02')) {
    err('Runtime asset cache contract: the affected feature modules and both page templates must request the current cache version.');
  }
}

function validateFilterSoundAndFeedbackContract() {
  const gallery = exists('js/features/gallery/index.js') ? readText('js/features/gallery/index.js') : '';
  const feedback = exists('js/features/interaction-feedback/index.js') ? readText('js/features/interaction-feedback/index.js') : '';
  const css = exists('css/style.css') ? readText('css/style.css') : '';
  const smoke = exists('tools/smoke-browser.mjs') ? readText('tools/smoke-browser.mjs') : '';

  const filterStateCss = css.slice(css.indexOf('.tab-btn.active,'), css.indexOf('/* Pointer focus does not keep'));
  if (!css.includes('font-weight: 650;') ||
      !filterStateCss.includes('font-weight: 650;') ||
      /font-weight:\s*(?:580|700);/.test(filterStateCss) ||
      !gallery.includes('suppressFilterSettleUntil = Date.now() + 800;') ||
      !gallery.includes('syncFilterActiveIndicator(undefined, { followingScroll: true });') ||
      !smoke.includes('previewFontWeight') || !smoke.includes('activeFontWeight')) {
    err('Filter carousel stability: active/preview label metrics must stay constant, swipe preview must update with the pointer frame, and scrollend must not trigger a second settlement.');
  }

  if (!gallery.includes("new CustomEventConstructor('lm:filter-centered'") ||
      !gallery.includes('function scheduleCenteredFilter()') ||
       !gallery.includes('settleCenteredFilter();') ||
      !gallery.includes("'(prefers-reduced-motion: reduce)'") ||
      !gallery.includes("event.key === 'ArrowRight'") ||
      !gallery.includes("event.key === 'Home'")) {
    err('Mobile filter behavior: centered changes must settle once, dispatch a cue, support keyboard navigation and respect reduced motion.');
  }
  const filterHoverStart = css.indexOf('.tab-btn:hover:not(.active):not([aria-pressed="true"]):not(:disabled):not([aria-disabled="true"])');
  const filterHoverOpen = css.indexOf('{', filterHoverStart);
  const filterHoverClose = css.indexOf('}', filterHoverOpen);
  const filterHoverRule = filterHoverStart >= 0 && filterHoverOpen >= 0 && filterHoverClose > filterHoverOpen
    ? css.slice(filterHoverOpen + 1, filterHoverClose)
    : '';
  if (!filterHoverRule.includes('background: rgba(255, 255, 255, .12)') ||
      !filterHoverRule.includes('border-color: transparent') ||
      !filterHoverRule.includes('outline: none') ||
      !filterHoverRule.includes('box-shadow: none')) {
    err('Filter tabs: fine-pointer hover must use the neutral gray treatment without an outline, border, or ring.');
  }

  if (!css.includes('.filter-active-indicator') ||
      !gallery.includes('function getFilterViewportCenterX()') ||
      !gallery.includes('const centerX = getFilterViewportCenterX() - hostRect.left - hostClientLeft;') ||
      !gallery.includes("indicator.style.translate = '-50% 0'") ||
      !gallery.includes("indicator.style.transform = 'translate3d(-50%, 0, 0)'") ||
      !gallery.includes('const delta = (buttonRect.left + buttonRect.width / 2) -\n      getFilterViewportCenterX();') ||
      !css.includes('overscroll-behavior-x: none;') ||
      !css.includes('width 420ms cubic-bezier(.34, 1.45, .64, 1)') ||
      css.includes('transform 160ms cubic-bezier(.2, 0, 0, 1)') ||
      !css.includes('.tab-btn:disabled') ||
      css.includes('.tab-btn.active::before') ||
      css.includes('content: "✓"') ||
      !gallery.includes('function syncFilterActiveIndicator') ||
      !gallery.includes('function normalizeFilterButtonWidths') ||
      !gallery.includes('documentRef.fonts?.ready') ||
      !gallery.includes('button.disabled = !availableProjects.some(') ||
      !gallery.includes("filterAnnouncement.setAttribute('role', 'status')") ||
      !smoke.includes('filter-announcement') ||
      !smoke.includes('Desktop uses the same centered carousel') ||
      !smoke.includes('Desktop hover stays in the existing gray palette')) {
    err('Filter interaction: a stationary center-anchored pill must resize to content labels, avoid page overscroll, and retain mobile/desktop swipe plus hover coverage.');
  }

  const works = exists('index.html') ? readText('index.html') : '';
  const navigation = exists('js/features/navigation/index.js') ? readText('js/features/navigation/index.js') : '';
  if (!works.includes('<div class="filter-nav-wrapper" role="group" aria-label="Project categories">') ||
      !works.includes('class="filter-nav-viewport"') ||
      !works.includes('class="filter-tabs filter-nav-scroller"') ||
      !works.includes('class="filter-nav-content"') ||
      !gallery.includes("filterTabs?.querySelector('.filter-nav-content') || filterTabs") ||
      !gallery.includes('function isFilterScroller()') ||
      !gallery.includes("filterContent.replaceChildren(fragment)") ||
      !gallery.includes("filterContent.prepend(leading)") ||
      !gallery.includes("filterContent.append(trailing)") ||
      !css.includes('.filter-tabs[data-overflow="true"]') ||
      css.includes('scroll-snap-stop: always') ||
      !css.includes('scroll-snap-type: none') ||
      !css.includes('-webkit-overflow-scrolling: auto;') ||
      !gallery.includes("centerFilterButton(nearest, 'auto', true)") ||
       gallery.includes('runFilterInertia') ||
       !css.includes('.filter-nav-content.has-active-indicator.is-following-filter-scroll .tab-btn.is-centered-preview') ||
       !css.includes('mix-blend-mode: exclusion;') ||
       !css.includes('mix-blend-mode: normal !important;') ||
       !css.includes('.filter-tabs .tab-btn:active { transform: none;') ||
      !navigation.includes("bind(windowRef, 'pointerup', resetPointerFocus)") ||
      !navigation.includes('logoLink.blur()') ||
      !smoke.includes('filterGalleryGap') ||
      !smoke.includes('layout.filterHeroGap < 12 || layout.filterGalleryGap < 12') ||
      !smoke.includes('filterHasOverflow') ||
      !smoke.includes('layout.filterHasOverflow && !hasFilterEdgeFade') ||
      !css.includes('.nav-logo:focus:not(:focus-visible)') ||
      !css.includes('.nav-logo.is-pointer-focused:focus-visible') ||
      !navigation.includes("bind(logoLink, 'pointerdown'") ||
      !navigation.includes("logoLink.classList.add('is-pointer-focused')") ||
      !smoke.includes('assertFilterNavigationResponsive(page,')) {
    err('Responsive filter navigation and adaptive-logo focus contract: wrapper layers, overflow-aware centering, snap/reduced-motion, and keyboard-versus-pointer focus must remain covered.');
  }
  if (!feedback.includes("root.addEventListener('lm:filter-centered', handleCenteredFilter)") ||
      !feedback.includes("audio.preload = 'auto'") ||
      !feedback.includes("audioByCue.forEach(otherAudio =>") ||
      feedback.includes('localStorage') ||
      feedback.includes('interaction-feedback-toggle')) {
    err('Interaction feedback: centered cues must be gesture-aware, single-channel, CMS-controlled, and free of visitor preference state.');
  }
  if (css.includes('.interaction-feedback-toggle') ||
      !smoke.includes('must never render a public interaction-feedback control') ||
      !smoke.includes('selectionSoundCalls')) {
    err('Public feedback control: the toggle must be absent from CSS and browser smoke must cover centered-filter sound behavior.');
  }
}

function validateCmsRegressionContracts() {
  const admin = exists('admin/admin.js') ? readText('admin/admin.js') : '';
  if (!admin.includes('function validateCmsMediaSource(') ||
      !admin.includes("validateCmsMediaSource(manual.type, manual.src, 'Manual footer media')") ||
      !admin.includes('validateCmsMediaSource(item.type, item.src, `Hero artwork ${index + 1}`)')) {
    err('CMS media validation: Hero Loop and manual Footer sources must be validated before save.');
  }
  const smoke = exists('tools/smoke-browser.mjs') ? readText('tools/smoke-browser.mjs') : '';
  if (!smoke.includes("page.on('requestfailed'") ||
      !smoke.includes('failedSameOriginRequests') ||
      !smoke.includes('Same-origin HTTP 404 URLs')) {
    err('Browser smoke network contract: same-origin HTTP 404s and failed requests must fail validation.');
  }
  if (!/let renderVersion = 0;/.test(admin) ||
      !/const version = \+\+renderVersion;/.test(admin) ||
      !/const section = currentSection;/.test(admin) ||
      !/if\(version !== renderVersion \|\| section !== currentSection\) return;/.test(admin)) {
    err('CMS render: asynchronous section loads must be guarded against stale navigation responses.');
  }
  const mediaReferenceBlock = admin.slice(
    admin.indexOf('const MEDIA_REFERENCE_FILES = ['),
    admin.indexOf('async function renameMediaFolder(', admin.indexOf('const MEDIA_REFERENCE_FILES = ['))
  );
  if (!mediaReferenceBlock.includes("'data/curated-views.json'") ||
      !mediaReferenceBlock.includes("'data/footer-loop.json'")) {
    err('CMS Media Library: folder renames must update Curated View-owned project media and footer animation references.');
  }
  if (!admin.includes('async getTree(ref=conn.branch)') ||
      !admin.includes('async getTextFile(path, ref=conn.branch)') ||
      !admin.includes('const tree=await GH.getTree(parentSha);') ||
      !admin.includes('GH.getTextFile(filePath,parentSha)') ||
      !admin.includes('`,parentSha);')) {
    err('CMS Media Library: folder renames must read the asset tree and references from one immutable commit snapshot before writing.');
  }
  if (!admin.includes('const cacheKey = version || mediaTreeShaByPath?.get(assetPath)') ||
      !admin.includes('await loadMediaTree(true)') ||
      !admin.includes('const existingIndex = uploadTree.findIndex') ||
      !admin.includes('setMediaTreeCache(uploadTree)') ||
      !admin.includes('let needsInitialRefresh=true') ||
      !admin.includes('paintVersion!==pickerPaintVersion')) {
    err('CMS Media Library: fresh replacement uploads, SHA-keyed previews, and guarded picker refreshes are required.');
  }
  if (admin.includes('SOFTWARE_DOMAINS') || admin.includes('logo.clearbit.com')) {
    err('CMS software logos: retired inline SOFTWARE_DOMAINS/Clearbit lookup must not return.');
  }
  if (!/const SOFTWARE_LOGO_LOOKUP = import\(['"]\.\.\/js\/infrastructure\/software-logo\/lookup\.js/.test(admin) ||
      !/async function findAutomaticSoftwareLogoCandidates\(name\)/.test(admin)) {
    err('CMS software logos: About editor must resolve automatic logos through the shared lookup adapter.');
  }

  const gallery = exists('js/features/gallery/index.js') ? readText('js/features/gallery/index.js') : '';
  const presentation = exists('js/features/gallery/presentation.js') ? readText('js/features/gallery/presentation.js') : '';
  const projectCard = exists('js/features/projects/project-card.js') ? readText('js/features/projects/project-card.js') : '';
  const renderer = exists('js/features/lightbox/media-renderer.js') ? readText('js/features/lightbox/media-renderer.js') : '';
  const composition = exists('js/app/page-composition.js') ? readText('js/app/page-composition.js') : '';
  const css = exists('css/style.css') ? readText('css/style.css') : '';

  if (!admin.includes('saveSectionsAtomic([')) err('CMS save: Hero Loop and settings must stay atomic.');
  if (!/async getFile\(path, ref=conn\.branch\)/.test(admin) ||
      !admin.includes("GH.getFile(file.path, parentSha)") ||
      !admin.includes("expectedSha: previous.sha ?? null") ||
      !admin.includes("JSON.stringify(fresh.json) !== JSON.stringify(parsed)")) {
    err('CMS atomic saves: file revisions must be checked against the parent commit and post-save content verified before clearing dirty state.');
  }
  if (!/async\s+(?:function\s+)?updateBranch\(commitSha\)/.test(admin) ||
      !/body:JSON\.stringify\(\{sha:commitSha,force:false\}\)/.test(admin) ||
      !/await GH\.updateBranch\(newCommit\.sha\)/.test(admin)) {
    err('CMS save: atomic Git writes must use a non-forced branch ref update.');
  }
  if (!admin.includes('await onCollect()')) err('CMS save: save collectors must support asynchronous cross-file validation/migrations.');
  if (!admin.includes('filtersWithProjects')) err('CMS filters: filter/project relationship saves must be atomic.');
  if (admin.includes("import('../js/model-viewer.js')") || /['"]js\/model-viewer\.js['"]/.test(admin)) {
    err('CMS 3D preview: retired js/model-viewer.js path must not be referenced.');
  }
  if (!/import\(['"]\.\.\/js\/infrastructure\/three\/model-viewer\.js(?:\?[^'"]*)?['"]\)/.test(admin)) {
    err('CMS 3D preview: the Projects editor must import the infrastructure Three.js adapter.');
  }
  if (!admin.includes('Duplicate filter ID')) err('CMS filters: duplicate filter IDs must be rejected.');
  if (!renderer.includes("function applyHolographicMask(layer, maskUrl, artworkUrl = '', detailMaskUrl = '', detailOptions = {})") ||
      !renderer.includes('layer.style.maskMode = modeList') ||
      !renderer.includes("const asCssUrl = value => 'url(\"' + String(value).split('\"').join('%22') + '\")';") ||
      renderer.includes("encodeURI(String(value).split('\"').join('%22'))") ||
      renderer.includes("encodeURI(String(faceTextureUrl).split('\"').join('%22'))") ||
      !renderer.includes("modes.push('alpha')") ||
      !renderer.includes("sizes.push('contain')") ||
      !renderer.includes("const faceMaskUrl = isFront ? frontMaskUrl : backMaskUrl") ||
      !renderer.includes("if (maskedLayers.has('spectrum')) applyFaceHolographicMask(spectrum)") ||
      !renderer.includes("if (maskedLayers.has('environment')) applyFaceHolographicMask(environment)") ||
      !renderer.includes("if (maskedLayers.has('prism')) applyFaceHolographicMask(prism)") ||
      !renderer.includes("if (maskedLayers.has('ribbons')) applyFaceHolographicMask(ribbons)") ||
      !renderer.includes("if (maskedLayers.has('diffraction')) applyFaceHolographicMask(diffraction)") ||
      !renderer.includes("if (maskedLayers.has('sparkles')) applyFaceHolographicMask(sparkles)") ||
      !renderer.includes("if (maskedLayers.has('sheen')) applyFaceHolographicMask(sheen)") ||
      !renderer.includes("texture.style.backgroundImage =\n          'url(\"' + faceTextureUrl.split('\"').join('%22') + '\"), '") ||
      !renderer.includes('applyFaceHolographicMask(texture, faceTextureUrl, {')) {
    err('Lightbox holographic mask: every foil layer must follow image alpha and its optional custom luminance mask.');
  }

  const foilNormalRenderer = exists('js/features/lightbox/foil-normal-renderer.js') ? readText('js/features/lightbox/foil-normal-renderer.js') : '';
  if (!renderer.includes("import { createFoilNormalRenderer } from './foil-normal-renderer.js?v=20261016-01';") ||
      !renderer.includes('createFoilNormalRenderer(normalCanvas, normalPatternUrls') ||
      !renderer.includes('holographicNormalControllers.get(surface)?.forEach(controller => controller.setLight') ||
      !foilNormalRenderer.includes('vec3 blendFoilNormals') || !foilNormalRenderer.includes('heightAt3(tileUV') || !foilNormalRenderer.includes('destroy()')) {
    err('Lightbox foil normals: source-map slopes must blend into tilt-responsive lighting with a safe CSS fallback.');
  }

  if (!renderer.includes('surface.dataset.holoTextureMode = config.textureMode') ||
      !renderer.includes('function setHolographicTarget(') ||
      !renderer.includes("flip.className = 'lightbox-holographic-flip'") ||
      !css.includes('.lightbox-holographic.is-flipped .lightbox-holographic-flip') ||
      !renderer.includes("surface.style.setProperty('--holo-light-x', '34%')") ||
      !renderer.includes("surface.style.setProperty('--holo-light-y', '26%')") ||
      !renderer.includes('const lightX = clampHolographic(50 + ((50 - clampedX) * 0.68), 16, 84)') ||
      !renderer.includes('const lightY = clampHolographic(50 + ((50 - clampedY) * 0.68), 16, 84)') ||
      !css.includes('.lightbox-holographic-environment{') ||
      !css.includes('background-blend-mode:screen,screen,multiply,soft-light') ||
      !renderer.includes('lightbox-holographic-prism') ||
      !renderer.includes('lightbox-holographic-ribbons') ||
      !css.includes('@keyframes holo-prism-drift') ||
      !css.includes('@keyframes holo-light-ribbons') ||
      !css.includes('data-holo-texture-mode="tile"') ||
      !css.includes('background-size:auto') ||
      !css.includes('.lightbox-holographic-ribbons{\n    animation:none;')) {
    err('Holographic rendering: eased inverse lighting, masked environmental shading, and tile/fill texture mapping must remain available.');
  }

  if (!renderer.includes('const HOLOGRAPHIC_MASK_LAYERS = {') ||
      !renderer.includes("holographic: ['prism', 'ribbons', 'sheen']") ||
      !renderer.includes("glitter: ['sparkles']") ||
      !renderer.includes("...(HOLOGRAPHIC_MASK_LAYERS[config.style] || [])") ||
      !renderer.includes("if (maskedLayers.has('environment')) applyFaceHolographicMask(environment)") ||
      !renderer.includes("if (maskedLayers.has('prism')) applyFaceHolographicMask(prism)") ||
      !css.includes('background-image:url("../assets/holographic/grain.webp")') ||
      !css.includes('mix-blend-mode:hard-light') ||
      !css.includes('@keyframes holo-spectrum-breathe{\n  0%,100%{opacity:') ||
      !css.includes('@keyframes holo-glitter-twinkle{\n  0%,100%{opacity:')) {
    err('Holographic material: use a locally cached generic grain, moving neutral interference and profile-specific masks; continuous spectrum/glitter animation must avoid filter changes.');
  }
  if (!exists('assets/holographic/grain.webp')) {
    err('Holographic material: generic local grain texture asset is missing.');
  }

  if (!renderer.includes('const backFoilEnabled = backHasCustomArtwork && Boolean(config.backFoilEnabled)') ||
      !renderer.includes('if (!isFront && !backFoilEnabled) return;') ||
      !renderer.includes('config.backTextureMode') ||
      !admin.includes('data-holo-back-enabled') ||
      !admin.includes('backFoilEnabled') ||
      !renderer.includes('__lightboxHoloHint') ||
      !renderer.includes('lightbox-holographic-default-reverse') ||
      !admin.includes('value="brushed"') ||
      !admin.includes('value="beams"') ||
      !admin.includes('value="crosshatch"') ||
      !admin.includes('value="shattered"') ||
      !admin.includes('value="glitter"') ||
      !admin.includes('value="waves"') ||
      !admin.includes('value="cat-eye"') ||
      !css.includes('lightbox-holographic-diffraction') ||
      !css.includes('lightbox-holographic-sparkles') ||
      !css.includes(':is(#lightboxMediaContainer,.lightbox-inspect-mode) .lightbox-holographic-diffraction,\n :is(#lightboxMediaContainer,.lightbox-inspect-mode) .lightbox-holographic-sparkles{animation:none!important;}') ||
      !css.includes('background-blend-mode:overlay,color-dodge;') ||
      !css.includes('@keyframes holo-spectrum-breathe') ||
      !css.includes('.lightbox-holographic-sparkles,\n:is(#lightboxMediaContainer,.lightbox-inspect-mode) .lightbox-holographic-sheen{\n  display:none!important;') ||
      !css.includes('.lightbox-holographic-hint') ||
      !css.includes('display:none!important;content:none!important;')) {
    err('Holographic card: reverse toggle, no-back mirroring, eight foil finishes, and the interaction cue must remain available.');
  }

  if (!css.includes('.lightbox-artwork.has-holographic{\n  overflow:visible;') ||
      !css.includes('border:0;\n  box-shadow:none;\n  outline:none;') ||
      !css.includes('outline:none!important;') ||
      !css.includes(':is(#lightboxMediaContainer,.lightbox-inspect-mode) .lightbox-holographic-face{\n  border-radius:0;\n  overflow:hidden;') ||
      !renderer.includes("layer.style.webkitMaskComposite = webkitIntersections || 'source-over'")) {
    err('Holographic card: the artwork slot must not crop tilt; foil must have no added frame and clip to image alpha.');
  }

  if (!gallery.includes('getEffectiveBaseCount') ||
      !gallery.includes('getRowAlignedCount') ||
      !presentation.includes('getRowAlignedCount') ||
      !presentation.includes('applyGalleryReveal')) {
    err('Gallery: row-aware Show More state/presentation contract is missing.');
  }

  if (!gallery.includes('getFilteredProjects') ||
      !gallery.includes('projectMatchesFilter') ||
      !gallery.includes('getCardForProject') ||
      !gallery.includes('getProjects')) {
    err('Gallery filters: filter state must consume normalized Projects and map selections to cards through the Projects API.');
  }

  if (!/className = 'tab-btn filter-btn active'/.test(gallery) ||
      !/className = 'tab-btn filter-btn'/.test(gallery) ||
      !/filterBtns = Array\.from\(document(?:Ref)?\.querySelectorAll\('\.filter-tabs \.filter-btn, \.filter-tabs \.tab-btn'\)\)/.test(gallery)) {
    err('Gallery filters: CMS filter buttons must have an owned click/filter contract.');
  }

  if (!/(?:filterBtns\.forEach\(btn\s*=>\s*btn\.addEventListener|filterBtns\.forEach\(btn\s*=>\s*bind\(btn,\s*'click')/.test(gallery)) {
    err('Gallery filters: filter buttons must be connected through the feature lifecycle.');
  }

  if (!/async function loadFilterButtons\(\)/.test(gallery) || !/options\.filterUrl/.test(gallery)) {
    err('Gallery filters: CMS filter loading must remain inside the Gallery feature boundary.');
  }

  if (!/className = 'tab-btn filter-btn active'/.test(gallery) ||
      !/dataset\.filter = 'all'/.test(gallery)) {
    err('Gallery filters: ALL must remain a permanent structural filter and retain the tab styling contract.');
  }

  if (!composition.includes('mountProjects(') ||
      !composition.includes('initGallery(') ||
      !composition.includes('initLightbox(')) {
    err('Portfolio composition: Projects, Gallery, and Lightbox controllers must remain explicitly wired.');
  }

  if (!composition.includes('getProjects()') || /project-media-list/.test(composition)) {
    err('Composition: runtime media capability checks must use normalized Projects, not hidden card markup.');
  }

  if (!projectCard.includes("card.className = 'project-card'") ||
      /className = \['project-card', \.\.\.filters\]/.test(projectCard) ||
      projectCard.includes('project-media-list') ||
      projectCard.includes('buildMediaItemElement')) {
    err('Project cards: taxonomy must remain data-driven and presentation markup must not act as an inter-feature project-data bus.');
  }

  if (!css.includes('--hero-fade-in-ms') || !css.includes('--hero-fade-out-ms')) {
    err('Hero: per-slide fade timing CSS variables are missing.');
  }
}

function validateReducedMotionThumbnailContract() {
  const thumbnail = exists('js/features/projects/project-thumbnail.js')
    ? readText('js/features/projects/project-thumbnail.js')
    : '';
  const smoke = exists('tools/smoke-browser.mjs')
    ? readText('tools/smoke-browser.mjs')
    : '';

  if (!thumbnail.includes("matchMedia?.('(prefers-reduced-motion: reduce)')") ||
      !thumbnail.includes('media.autoplay = !reducedMotion;') ||
      !thumbnail.includes('media.loop = !reducedMotion;') ||
      !thumbnail.includes("if (!reducedMotion) {") ||
      !thumbnail.includes("media.preload = priority && !reducedMotion ? 'auto' : 'metadata';") ||
      !smoke.includes('Project thumbnail media must respect prefers-reduced-motion') ||
      !smoke.includes('project-thumbnail.js?v=20261019-01')) {
    err('Project thumbnails: video and Lottie must honor prefers-reduced-motion while retaining browser smoke coverage and consistent module caching.');
  }
}

validateCuratedViewRuntimeContract();
validateCuratedViewPresentationContract();
validateAboutFirstPaintContract();
validateResponsiveHeroGalleryAndLogoContract();
validateCmsRegressionContracts();
validateFilterSoundAndFeedbackContract();
validateReducedMotionThumbnailContract();
validateRuntimeCacheGraph();

function validatePageAwareFeatureLoading() {
  const composition = exists('js/app/page-composition.js')
    ? readText('js/app/page-composition.js')
    : '';
  const staticFeatureImport = /(?:^|\n)\s*import\s+[^;]*?\bfrom\s*['"]\.\.\/features\/(?:projects|gallery|lightbox|reviews)\/index\.js/m;
  const staticNormalizerImport = /(?:^|\n)\s*import\s+[^;]*?\bfrom\s*['"]\.\.\/data\/project-normalizer\.js/m;
  if (staticFeatureImport.test(composition) || staticNormalizerImport.test(composition)) {
    err('Route-aware loading: Projects, Gallery, Lightbox, and project normalization must not be static page-composition imports.');
  }
  if (!/const projectsModulePromise = hasProjectGallery\s*\?\s*import\(['"]\.\.\/features\/projects\/index\.js\?v=/.test(composition) ||
      !/const projectNormalizerModulePromise = shouldLoadProjectModels\s*\?\s*import\(['"]\.\.\/data\/project-normalizer\.js\?v=/.test(composition) ||
      !/const mainProjectsPayloadPromise = shouldLoadProjectModels/.test(composition) ||
      !/const projectModelsPromise = shouldLoadProjectModels/.test(composition) ||
      !/Promise\.all\(\[\s*mainProjectsPayloadPromise,\s*curatedViewsPromise,\s*projectsModulePromise,\s*projectModelsPromise\s*\]\)/.test(composition) ||
      !/if \(hasProjectGallery\) \{[\s\S]*?lightboxModulePromise/.test(composition) ||
      !/const aboutDataPromise = isAboutPage && config\.urls\.about/.test(composition) ||
      !/const aboutPromise = isAboutPage\s*\?\s*aboutDataPromise\.then\(data => initAbout/.test(composition) ||
      !/const aboutAssetPreloadPromise = \(isAboutPage\s*\?\s*aboutDataPromise\.then\(data => preloadAboutAssets/.test(composition) ||
      !/const reviewsPromise = settingsPromise\.then\(async settingsFeature/.test(composition) ||
      !/if \(!currentSettings\.showReviews\) \{[\s\S]*?return null;[\s\S]*?import\(['"]\.\.\/features\/reviews\/index\.js['"]\)/.test(composition)) {
    err('Route-aware loading: Projects, Gallery, and Lightbox graphs must load only when the project grid exists.');
  }
}

validateFormAutocomplete();
validateModelViewerModulePreloadCacheKey();
validatePageAwareFeatureLoading();
validateFeatureModuleCacheGraph();
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
