#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ASSET_ROOT = path.join(ROOT, 'assets');
const DATA_ROOT = path.join(ROOT, 'data');
const MIB = 1024 * 1024;

const RASTER_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.avif'
]);
const VECTOR_EXTENSIONS = new Set(['.svg']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv']);
const PREFERRED_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm']);
const KNOWN_EXTENSIONS = new Set([
  ...RASTER_EXTENSIONS, '.webp', ...VECTOR_EXTENSIONS, ...VIDEO_EXTENSIONS,
  '.json', '.obj', '.mtl', '.gltf', '.glb', '.fbx', '.bin',
  '.ktx2', '.basis', '.woff', '.woff2', '.ttf', '.otf'
]);

const findings = {
  legacyRaster: [],
  largeImages: [],
  largeAssets: [],
  nonPreferredVideo: [],
  unknownFiles: [],
  avifVideoReferences: []
};

function extensionOf(value) {
  return path.extname(String(value || '').split(/[?#]/)[0]).toLowerCase();
}

function bytesLabel(bytes) {
  return (bytes / MIB).toFixed(2) + ' MiB';
}

function collectFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      } else {
        findings.unknownFiles.push({
          path: path.relative(ROOT, fullPath).split(path.sep).join('/'),
          size: 0,
          reason: 'Not a regular file (for example, a symbolic link)'
        });
      }
    }
  }

  visit(dir);
  return files;
}

function auditAssets() {
  const files = collectFiles(ASSET_ROOT);
  const extensionSummary = new Map();
  let totalBytes = 0;

  for (const file of files) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    if (path.basename(file) === '.gitkeep') continue;

    const ext = extensionOf(file);
    const size = fs.statSync(file).size;
    totalBytes += size;

    const bucket = extensionSummary.get(ext || '(no extension)') || { count: 0, bytes: 0 };
    bucket.count += 1;
    bucket.bytes += size;
    extensionSummary.set(ext || '(no extension)', bucket);

    if (RASTER_EXTENSIONS.has(ext)) {
      findings.legacyRaster.push({ path: relative, size, ext });
      if (size >= 1 * MIB) findings.largeImages.push({ path: relative, size, ext });
    }

    if (VIDEO_EXTENSIONS.has(ext) && !PREFERRED_VIDEO_EXTENSIONS.has(ext)) {
      findings.nonPreferredVideo.push({ path: relative, size, ext });
    }

    if (!KNOWN_EXTENSIONS.has(ext)) {
      findings.unknownFiles.push({
        path: relative,
        size,
        reason: 'Unrecognized asset extension ' + (ext || '(none)')
      });
    }

    if (size >= 5 * MIB) findings.largeAssets.push({ path: relative, size, ext });
  }

  console.log('[media-audit] Asset inventory');
  console.log('  Files: ' + files.length);
  console.log('  Total payload: ' + bytesLabel(totalBytes));
  for (const [ext, stats] of [...extensionSummary.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log('  ' + ext + ': ' + stats.count + ' file(s), ' + bytesLabel(stats.bytes));
  }
}

function inspectVideoReferences(value, context = 'data') {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectVideoReferences(item, context + '[' + index + ']'));
    return;
  }

  const isVideoRecord = String(value.type || '').toLowerCase() === 'video';
  if (isVideoRecord && typeof value.src === 'string' && extensionOf(value.src) === '.avif') {
    findings.avifVideoReferences.push(context + '.src -> ' + value.src);
  }

  if (value.video && typeof value.video === 'object' &&
      typeof value.video.src === 'string' && extensionOf(value.video.src) === '.avif') {
    findings.avifVideoReferences.push(context + '.video.src -> ' + value.video.src);
  }

  for (const [key, child] of Object.entries(value)) {
    inspectVideoReferences(child, context + '.' + key);
  }
}

function auditDataReferences() {
  if (!fs.existsSync(DATA_ROOT)) return;
  for (const file of collectFiles(DATA_ROOT)) {
    if (extensionOf(file) !== '.json') continue;
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    try {
      inspectVideoReferences(JSON.parse(fs.readFileSync(file, 'utf8')), relative);
    } catch (error) {
      // The main site validator owns JSON syntax reporting; don't duplicate it here.
    }
  }
}

function reportItems(title, items, formatter) {
  if (!items.length) return;
  console.log('\n[media-audit] ' + title + ' (' + items.length + ')');
  for (const item of [...items].sort((a, b) => b.size - a.size || a.path.localeCompare(b.path))) {
    console.log('  - ' + formatter(item));
  }
}

if (!fs.existsSync(ASSET_ROOT)) {
  console.error('[media-audit] ERROR: assets/ directory is missing.');
  process.exit(1);
}

auditAssets();
auditDataReferences();

reportItems(
  'Raster files to review for WebP conversion (non-blocking backlog)',
  findings.legacyRaster,
  item => item.path + ' — ' + bytesLabel(item.size)
);
reportItems(
  'Raster images at or above 1 MiB',
  findings.largeImages,
  item => item.path + ' — ' + bytesLabel(item.size)
);
reportItems(
  'Assets at or above 5 MiB',
  findings.largeAssets,
  item => item.path + ' — ' + bytesLabel(item.size)
);
reportItems(
  'Video files using less-preferred delivery containers',
  findings.nonPreferredVideo,
  item => item.path + ' — ' + bytesLabel(item.size)
);
reportItems(
  'Unknown asset files/extensions to review',
  findings.unknownFiles,
  item => item.path + ' — ' + bytesLabel(item.size) + ' — ' + item.reason
);

if (findings.legacyRaster.length) {
  console.log('\n[media-audit] Existing raster formats are reported only; convert safely and update references together.');
}
console.log('[media-audit] Note: AVIF is an image format, not a standard video container. Use a compatible .mp4/.webm container for video; AV1 is a video codec.');

if (findings.avifVideoReferences.length) {
  console.error('\n[media-audit] ERROR: AVIF appears in a video media reference. These sources will not behave as ordinary HTML video.');
  findings.avifVideoReferences.forEach(reference => console.error('  - ' + reference));
  process.exitCode = 1;
}
