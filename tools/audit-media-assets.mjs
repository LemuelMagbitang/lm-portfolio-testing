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
// These deliberate compatibility exceptions are documented separately rather
// than being reported as pending WebP conversions on every CI run.
const PRESERVED_RASTER_ASSETS = new Map([
  ['assets/projects/site/favicon.png', 'Kept as PNG for favicon compatibility.'],
  ['assets/projects/site/og-image.jpg', 'Kept as JPEG for social-sharing crawler compatibility.'],
  ['assets/projects/aol/figureground.jpg', 'Kept as original JPEG because visual review found the quality-92 WebP was larger without a meaningful visible benefit.'],
  ['assets/projects/funko-pop/8.jpg', 'Kept as original JPEG because visual review found the quality-92 WebP was larger without a meaningful visible benefit.'],
  ['assets/projects/haeru/app-lowfi-sketch.jpg', 'Kept as original JPEG because visual review found the quality-92 WebP was larger without a meaningful visible benefit.'],
  ['assets/projects/2024shell-nsac/full.jpg', 'Kept as original JPEG because visual review found the quality-92 WebP was larger without a meaningful visible benefit.'],
  ['assets/projects/graphic-design/bakeries-poster.jpg', 'Kept as original JPEG because visual review found the quality-92 WebP was larger without a meaningful visible benefit.'],
  ['assets/projects/ephiphany-3d-illustration/florilegium.jpg', 'Kept as original JPEG because visual review found the quality-92 WebP was larger without a meaningful visible benefit.'],
  ['assets/projects/aol/combination.jpg', 'Kept as original JPEG because visual review found the quality-92 WebP was larger without a meaningful visible benefit.'],
  ['assets/projects/ephiphany-3d-illustration/temporal-constraints.jpg', 'Kept as original JPEG because visual review found the quality-92 WebP was larger without a meaningful visible benefit.'],
  ['assets/projects/graphic-design/watch-poster.jpg', 'Kept as original JPEG because visual review found the quality-92 WebP was larger without a meaningful visible benefit.'],
  ['assets/projects/haeru/00app-design.jpg', 'Kept as original JPEG because visual review found the quality-92 WebP was larger without a meaningful visible benefit.'],
  ['assets/projects/ephiphany-3d-illustration/the-half-of-us.jpg', 'Kept as original JPEG because visual review found the quality-92 WebP was larger without a meaningful visible benefit.'],
  ['assets/projects/2024shell-nsac/sketch.jpg', 'Kept as original JPEG because visual review found the quality-92 WebP was larger without a meaningful visible benefit.'],
  ['assets/projects/ephiphany-3d-illustration/the-dead-king-midas.jpg', 'Kept as original JPEG because visual review found the quality-92 WebP was larger without a meaningful visible benefit.'],
  ['assets/projects/gog-render-challenge/original-character-design.jpg', 'Kept as original JPEG because visual review found the quality-92 WebP was larger without a meaningful visible benefit.'],
  ['assets/projects/haeru/01app-design.jpg', 'Kept as original JPEG because visual review found the quality-92 WebP was larger without a meaningful visible benefit.']
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
  preservedRaster: [],
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

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
]);

// Read only a bounded header to help distinguish images that need resizing
// from files that mainly need a more efficient delivery format. This is an
// audit-only hint: source images are never rewritten or removed here.
function readRasterDimensions(file, ext) {
  if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') return null;

  let descriptor = null;
  try {
    descriptor = fs.openSync(file, 'r');
    const header = Buffer.alloc(256 * 1024);
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);

    if (ext === '.png' && bytes.length >= 24 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
        bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
        bytes[6] === 0x1a && bytes[7] === 0x0a) {
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      return width > 0 && height > 0 ? { width, height } : null;
    }

    if ((ext === '.jpg' || ext === '.jpeg') &&
        bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let offset = 2;
      while (offset + 3 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }

        while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
        if (offset >= bytes.length) break;
        const marker = bytes[offset++];

        // Standalone markers have no length field.
        if (marker === 0x00 || marker === 0x01 || marker === 0xd8 ||
            marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (offset + 2 > bytes.length) break;

        const segmentLength = bytes.readUInt16BE(offset);
        if (segmentLength < 2 || offset + segmentLength > bytes.length) break;

        if (JPEG_START_OF_FRAME_MARKERS.has(marker) && segmentLength >= 7) {
          const height = bytes.readUInt16BE(offset + 3);
          const width = bytes.readUInt16BE(offset + 5);
          return width > 0 && height > 0 ? { width, height } : null;
        }

        offset += segmentLength;
      }
    }
  } catch (_) {
    // A failed metadata read should not turn a non-blocking asset audit into
    // a site validation failure. File readability is handled elsewhere.
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch (_) {}
    }
  }

  return null;
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
      const preservationReason = PRESERVED_RASTER_ASSETS.get(relative);
      if (preservationReason) {
        findings.preservedRaster.push({ path: relative, size, ext, reason: preservationReason });
      } else {
        findings.legacyRaster.push({ path: relative, size, ext });
      }
      if (size >= 1 * MIB) findings.largeImages.push({ path: relative, size, ext, dimensions: readRasterDimensions(file, ext) });
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
  'Compatibility-preserved raster assets (excluded from WebP conversion backlog)',
  findings.preservedRaster,
  item => item.path + ' — ' + bytesLabel(item.size) + ' — ' + item.reason
);
reportItems(
  'Raster images at or above 1 MiB',
  findings.largeImages,
  item => item.path + ' — ' + bytesLabel(item.size) + (item.dimensions
    ? ' — ' + item.dimensions.width + '×' + item.dimensions.height + ' px (' + ((item.dimensions.width * item.dimensions.height) / 1_000_000).toFixed(1) + ' MP)'
    : ' — dimensions unavailable for this format/header')
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
  console.log('\n[media-audit] Remaining raster backlog is informational; convert only after verifying visual quality and updating references together.');
}
if (findings.preservedRaster.length) {
  console.log('[media-audit] Compatibility-preserved raster files are intentional exceptions, not conversion backlog.');
}
console.log('[media-audit] Note: AVIF is an image format, not a standard video container. Use a compatible .mp4/.webm container for video; AV1 is a video codec.');

if (findings.avifVideoReferences.length) {
  console.error('\n[media-audit] ERROR: AVIF appears in a video media reference. These sources will not behave as ordinary HTML video.');
  findings.avifVideoReferences.forEach(reference => console.error('  - ' + reference));
  process.exitCode = 1;
}
