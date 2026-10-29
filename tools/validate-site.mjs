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
const SUPPORTED_MEDIA = new Set(['image', 'video', 'mux', 'youtube', 'lottie', 'model']);
const SUPPORTED_MODEL_EXT = new Set(['obj', 'gltf', 'glb', 'fbx']);
const ORIENTATIONS = new Set(['', 'auto', 'landscape', 'portrait', 'square']);
const SUPPORTED_HOLOGRAPHIC_STYLES = new Set(['holographic', 'cosmos', 'brushed', 'beams', 'crosshatch', 'shattered', 'glitter', 'waves', 'cat-eye', 'iridescent', 'aurora']);
const SUPPORTED_ARTWORK_GROUP_LAYOUTS = new Set(['grid','stack','cards','sticker']);

function readText(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function hasVersionedReference(source, assetPath) {
  const escapedPath = String(assetPath).replaceAll('.', '\\.');
  return new RegExp(escapedPath + "\\?v=[^'\"\\s>]+").test(String(source || ''));
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
  } else if (type === 'mux') {
    if (!String(media.playbackId || '').trim()) err(`${where}: Mux media needs a public playbackId from the Video Library selector.`);
    const poster = String(media.poster || media.src || '').trim();
    try {
      if (!poster || new URL(poster).protocol !== 'https:') err(`${where}: Mux media must include an HTTPS poster URL.`);
    } catch (_) {
      err(`${where}: Mux media poster must be a valid HTTPS URL.`);
    }
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
  if (!hasVersionedReference(entryHtml, 'css/features/lightbox.css') ||
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
if (Array.isArray(projects) && projects.some(project => project?.id === 'test-project')) {
  err('Public project data must not include the test-project QA fixture; smoke-browser injects it only during tests.');
}
if (Array.isArray(curatedViews) && curatedViews.some(view =>
  view?.id === 'test-portfolio' || view?.slug === 'test-portfolio' ||
  (Array.isArray(view?.projects) && view.projects.some(entry =>
    entry?.project?.id === 'test-project-on-curated-view'
  ))
)) {
  err('Public Curated Views data must not include the test-portfolio QA fixture.');
}
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

  const projectForm = getForm('projectForm');
  const reviewForm = getForm('reviewForm');
  const hasAriaLabel = (form, tag, name, label) => {
    const control = form.match(new RegExp('<' + tag + '\\b(?=[^>]*\\bname="' + name + '")[^>]*>', 'i'))?.[0] || '';
    return control.includes('aria-label="' + label + '"');
  };
  const namedControls = [
    ['project inquiry name', projectForm, 'input', 'name', 'Your name'],
    ['project inquiry email', projectForm, 'input', 'email', 'Your email'],
    ['project details', projectForm, 'textarea', 'message', 'Project details'],
    ['review name/handle', reviewForm, 'input', 'name', 'Your name or handle'],
    ['review text', reviewForm, 'textarea', 'review', 'Your review']
  ];
  namedControls.forEach(([label, form, tag, name, accessibleName]) => {
    if (!form || !hasAriaLabel(form, tag, name, accessibleName)) {
      err('Forms: ' + label + ' control must expose the explicit accessible name "' + accessibleName + '".');
    }
  });

  const ratingGroup = reviewForm.match(/<div\b(?=[^>]*\bclass="star-rating")[^>]*>/i)?.[0] || '';
  if (!/\brole="radiogroup"/.test(ratingGroup) || !/\baria-label="Portfolio rating"/.test(ratingGroup)) {
    err('Forms: the star rating must expose a named radiogroup.');
  }
  const starInputs = [...reviewForm.matchAll(/<input\b[^>]*\bname="rating"[^>]*>/gi)].map(match => match[0]);
  if (starInputs.length !== 5 || starInputs.some(input => {
    const value = input.match(/\bvalue="([1-5])"/)?.[1] || '';
    const expectedName = value === '1' ? '1 star' : value + ' stars';
    return !input.includes('aria-label="' + expectedName + '"');
  })) {
    err('Forms: each of the five rating controls must expose its star count as an accessible name.');
  }
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

  if (!source.includes('export function isLightboxSwipeControlEvent') ||
      !source.includes('capturePointer: !muxPlayer') ||
      !source.includes('if (start.capturePointer)') ||
      !source.includes("bind(lightbox, 'pointermove', handleSwipePointerMove") ||
      !source.includes('isLightboxSwipeControlEvent(event)') ||
      !source.includes("event.target?.closest?.('mux-player, video')")) {
    err('Lightbox: Mux timeline/control gestures and focused-player keyboard controls must bypass project-navigation arbitration.');
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

function validateLazyModelViewerLoading() {
  const html = exists('index.html') ? readText('index.html') : '';
  const composition = exists('js/app/page-composition.js')
    ? readText('js/app/page-composition.js')
    : '';

  // A global modulepreload would fetch Three.js + OrbitControls on every Works
  // visit, even when the published project set contains no 3D model media.
  // The composition root dynamically imports and warms the viewer only when
  // model content exists, while an individual model preview can load it on demand.
  const eagerViewerPreload = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(match => match[0])
    .find(tag =>
      /\brel\s*=\s*["'][^"']*\bmodulepreload\b[^"']*["']/i.test(tag) &&
      /\bhref\s*=\s*["'](?:\.\.\/)?js\/infrastructure\/three\/model-viewer\.js(?:\?[^"']*)?["']/i.test(tag)
    );
  if (eagerViewerPreload) {
    err('3D viewer loading: model-viewer.js must not be globally modulepreloaded; load the Three.js graph only when model media is present or requested.');
  }

  if (!/const loadModelViewerModule = async \(\) => \(\s*import\(\s*["']\.\.\/infrastructure\/three\/model-viewer\.js\?v=/.test(composition) ||
      !/const hasModelMedia = projectModels\.some\(project => project\?\.capabilities\?\.hasModel\)/.test(composition) ||
      !/const preloadModelModule = hasModelMedia\s*\?\s*async \(\) => \{[\s\S]*?await module\.preloadModelViewerModules\?\.\(formats\);[\s\S]*?\}\s*:\s*null;/.test(composition)) {
    err('3D viewer loading: retain the dynamic model-viewer import and model-media-gated module warm-up.');
  }
}

function validatePageAwareFeatureLoading() {
  const composition = exists('js/app/page-composition.js')
    ? readText('js/app/page-composition.js')
    : '';
  const staticFeatureImport = /(?:^|\n)\s*import\s+[^;]*?\bfrom\s*['"]\.\.\/features\/(?:projects|gallery|lightbox|reviews)\/index\.js/m;
  const staticNormalizerImport = /(?:^|\n)\s*import\s+[^;]*?\bfrom\s*['"]\.\.\/data\/project-normalizer\.js/m;
  if (staticFeatureImport.test(composition) || staticNormalizerImport.test(composition)) {
    err('Route-aware loading: Projects, Gallery, Lightbox, and project normalization must not be static page-composition imports.');
  }
  const footer = exists('js/features/footer/index.js') ? readText('js/features/footer/index.js') : '';
  if (!/const projectsModulePromise = hasProjectGallery\s*\?\s*import\(['"]\.\.\/features\/projects\/index\.js\?v=/.test(composition) ||
      !/const projectModelsRequiredPromise = hasProjectGallery\s*\?\s*Promise\.resolve\(true\)[\s\S]*?settingsPromise\.then\(settingsFeature => settingsFeature\.getState\(\)\?\.heroTiming\?\.loopMode !== 'manual'/.test(composition) ||
      !/const projectNormalizerModulePromise = projectModelsRequiredPromise\.then\(shouldLoadProjectModels =>\s*shouldLoadProjectModels\s*\?\s*import\(['"]\.\.\/data\/project-normalizer\.js\?v=/.test(composition) ||
      !/const mainProjectsPayloadPromise = projectModelsRequiredPromise\.then\(shouldLoadProjectModels =>/.test(composition) ||
      !/const projectModelsPromise = projectModelsRequiredPromise\.then\(async shouldLoadProjectModels =>/.test(composition) ||
      !/Promise\.all\(\[\s*mainProjectsPayloadPromise,\s*curatedViewsPromise,\s*projectsModulePromise,\s*projectModelsPromise\s*\]\)/.test(composition) ||
      !/if \(hasProjectGallery\) \{[\s\S]*?lightboxModulePromise/.test(composition) ||
      !/const aboutDataPromise = isAboutPage && config\.urls\.about/.test(composition) ||
      !/const aboutPromise = isAboutPage\s*\?\s*aboutDataPromise\.then\(data => initAbout/.test(composition) ||
      !/const aboutAssetPreloadPromise = \(isAboutPage\s*\?\s*aboutDataPromise\.then\(data => preloadAboutAssets/.test(composition) ||
      !/const reviewsPromise = settingsPromise\.then\(async settingsFeature/.test(composition) ||
      !/if \(!currentSettings\.showReviews\) \{[\s\S]*?return null;[\s\S]*?import\(['"]\.\.\/features\/reviews\/index\.js['"]\)/.test(composition) ||
      !/if \(loopMode === 'manual'\) return manual\.slice\(0, 5\);\s*let latest = \[\];/.test(footer)) {
    err('Route-aware loading: Projects, Gallery, and Lightbox graphs must load only when the project grid exists.');
  }
}

validateFormAutocomplete();
validateLazyModelViewerLoading();
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
