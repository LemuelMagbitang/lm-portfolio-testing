#!/usr/bin/env node
/**
 * One-time migration of static PNG/JPEG assets to WebP.
 * PNG is encoded losslessly to protect transparent art and foil masks;
 * JPEG uses high-quality WebP encoding. References are verified before
 * original files are removed from the working tree.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const ASSET_ROOT = path.join(ROOT, 'assets');
const REPORT_PATH = path.join(ROOT, 'docs', 'WEBP-ASSET-MIGRATION-REPORT.md');
const ROADMAP_PATH = path.join(ROOT, 'docs', 'DECOUPLING-ROADMAP.md');
const CONVERTIBLE = new Set(['.png', '.jpg', '.jpeg']);
const PRESERVED_SOURCE_JPEG_ASSETS = new Set([
  'assets/projects/aol/figureground.jpg',
  'assets/projects/funko-pop/8.jpg',
  'assets/projects/haeru/app-lowfi-sketch.jpg',
  'assets/projects/2024shell-nsac/full.jpg',
  'assets/projects/graphic-design/bakeries-poster.jpg',
  'assets/projects/ephiphany-3d-illustration/florilegium.jpg',
  'assets/projects/aol/combination.jpg',
  'assets/projects/ephiphany-3d-illustration/temporal-constraints.jpg',
  'assets/projects/graphic-design/watch-poster.jpg',
  'assets/projects/haeru/00app-design.jpg',
  'assets/projects/ephiphany-3d-illustration/the-half-of-us.jpg',
  'assets/projects/2024shell-nsac/sketch.jpg',
  'assets/projects/ephiphany-3d-illustration/the-dead-king-midas.jpg',
  'assets/projects/gog-render-challenge/original-character-design.jpg',
  'assets/projects/haeru/01app-design.jpg',
  'assets/projects/product-packaging/shampoo00.jpg',
  'assets/projects/product-packaging/aureus00.jpg',
  'assets/projects/aol/continuity.jpg',
  'assets/projects/ephiphany-3d-illustration/tender-reverence.jpg',
  'assets/projects/product-packaging/wine-box.jpg',
  'assets/projects/graphic-design/wine-poster.jpg',
  'assets/projects/ephiphany-3d-illustration/melodies-of-innerself.jpg',
  'assets/projects/graphic-design/commercial-renders.jpg',
  'assets/projects/ephiphany-3d-illustration/aqua-vitae.jpg',
  'assets/projects/retail-spatial-layouts/lss03.jpg',
  'assets/projects/haeru/haeru-logo-construct.jpg'
]);
const TEXT_EXTENSIONS = new Set([
  '.css', '.html', '.htm', '.js', '.mjs', '.cjs', '.json', '.md', '.txt',
  '.xml', '.yml', '.yaml', '.webmanifest', '.svg', '.obj', '.mtl', '.gltf',
  '.glsl', '.vert', '.frag'
]);
const EXCLUDED_ROOTS = new Set(['.git', 'node_modules', '_site', '.jekyll-cache', 'vendor']);

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function extension(file) {
  return path.extname(file).toLowerCase();
}

function isCompatibilityRaster(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/').toLowerCase();
  const prefix = 'assets/projects/site/';
  if (rel === prefix + 'favicon.png') return true;
  if (!rel.startsWith(prefix)) return false;
  const name = rel.slice(prefix.length);
  if (['og-image.jpg', 'og-image.jpeg', 'og-image.png'].includes(name)) return true;
  const ext = path.extname(name);
  if (!['.jpg', '.jpeg', '.png'].includes(ext)) return false;
  const stem = name.slice(0, -ext.length);
  return stem === 'og-preview' || /^og-preview-v[0-9]+$/.test(stem);
}

function collectFiles(directory) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (directory === ROOT && EXCLUDED_ROOTS.has(entry.name)) continue;
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '_site') continue;
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function shouldRewrite(file) {
  const rel = relative(file);
  if (rel.startsWith('docs/')) return false; // historical audit notes are not runtime references
  if (rel.startsWith('.github/')) return false;
  return TEXT_EXTENSIONS.has(extension(file));
}

function imageAliases(sourcePath) {
  // Only replace a complete repository-relative path (or its URL-encoded
  // representation). Bare basename replacement can corrupt longer sibling
  // names such as app-lowfi-sketch.webp when converting sketch.webp elsewhere.
  const aliases = new Set([sourcePath, encodeURI(sourcePath)]);
  return [...aliases].sort((a, b) => b.length - a.length);
}

function createUniqueBasenamePattern(basename) {
  const regexSpecials = new Set(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);
  const escaped = basename.split('').map(char => regexSpecials.has(char) ? '\\' + char : char).join('');
  return new RegExp('(?<![A-Za-z0-9_-])' + escaped + '(?![A-Za-z0-9_-])', 'g');
}

function replaceUniqueBasename(value, basename, targetBasename) {
  return value.replace(createUniqueBasenamePattern(basename), targetBasename);
}

function replaceEvery(value, search, replacement) {
  return value.split(search).join(replacement);
}

function prettyBytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2) + ' MiB';
}

async function main() {
  if (!fs.existsSync(ASSET_ROOT)) throw new Error('assets/ directory is missing.');
  const allRasterCandidates = collectFiles(ASSET_ROOT)
    .filter(file => CONVERTIBLE.has(extension(file)))
    .sort((a, b) => a.localeCompare(b));
  const preservedCompatibilityAssets = allRasterCandidates.filter(isCompatibilityRaster);
  const preservedOriginalJpegs = allRasterCandidates.filter(file => PRESERVED_SOURCE_JPEG_ASSETS.has(relative(file)));
  const candidates = allRasterCandidates.filter(file =>
    !isCompatibilityRaster(file) && !PRESERVED_SOURCE_JPEG_ASSETS.has(relative(file))
  );

  if (!candidates.length) {
    console.log('[webp-migration] No PNG/JPEG assets remain; nothing to convert.');
    return;
  }

  const targets = candidates.map(source => {
    const target = source.slice(0, -path.extname(source).length) + '.webp';
    if (fs.existsSync(target)) {
      throw new Error('Refusing to overwrite an existing WebP asset: ' + relative(target));
    }
    return { source, target, sourcePath: relative(source), targetPath: relative(target) };
  });

  const mappings = [];
  const skipped = [];
  let beforeBytes = 0;
  let afterBytes = 0;

  for (const item of targets) {
    const metadata = await sharp(item.source, { failOn: 'error' }).metadata();
    if (Number(metadata.pages || 1) > 1) {
      skipped.push({ path: item.sourcePath, reason: 'multi-page or animated raster' });
      continue;
    }
    const sourceStat = fs.statSync(item.source);
    const isPng = extension(item.source) === '.png';
    const options = isPng
      ? { lossless: true, effort: 6, alphaQuality: 100 }
      : { quality: 92, effort: 6, smartSubsample: true, alphaQuality: 100 };
    const output = await sharp(item.source, { failOn: 'error' })
      .rotate()
      .webp(options)
      .toFile(item.target);
    mappings.push({
      ...item,
      width: Number(output.width || metadata.width || 0),
      height: Number(output.height || metadata.height || 0),
      sourceBytes: sourceStat.size,
      targetBytes: output.size,
      encoder: isPng ? 'lossless WebP' : 'WebP quality 92'
    });
    beforeBytes += sourceStat.size;
    afterBytes += output.size;
  }

  if (!mappings.length) {
    console.log('[webp-migration] No eligible static raster assets found.');
    return;
  }

  const basenameCounts = new Map();
  for (const item of mappings) {
    const basename = path.posix.basename(item.sourcePath);
    basenameCounts.set(basename, (basenameCounts.get(basename) || 0) + 1);
  }

  const textFiles = collectFiles(ROOT).filter(shouldRewrite).sort((a, b) => a.localeCompare(b));
  let rewrittenFiles = 0;
  for (const file of textFiles) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); }
    catch (_) { continue; }
    if (content.includes('\u0000')) continue;
    const original = content;
    for (const item of mappings) {
      const basename = path.posix.basename(item.sourcePath);
      const aliases = imageAliases(item.sourcePath);
      for (const alias of aliases) content = replaceEvery(content, alias, item.targetPath);
      if (basenameCounts.get(basename) === 1) {
        content = replaceUniqueBasename(content, basename, path.posix.basename(item.targetPath));
      }
    }
    if (content !== original) {
      fs.writeFileSync(file, content, 'utf8');
      rewrittenFiles += 1;
    }
  }

  // Verify references before removing any original assets.
  const unresolved = [];
  for (const file of collectFiles(ROOT).filter(shouldRewrite)) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); }
    catch (_) { continue; }
    if (content.includes('\u0000')) continue;
    for (const item of mappings) {
      const basename = path.posix.basename(item.sourcePath);
      const aliases = imageAliases(item.sourcePath);
      const unresolvedAlias = aliases.find(alias => content.includes(alias)) ||
        (basenameCounts.get(basename) === 1 && createUniqueBasenamePattern(basename).test(content) ? basename : null);
      if (unresolvedAlias) {
        unresolved.push(relative(file) + ' still refers to ' + unresolvedAlias);
        if (unresolved.length >= 20) break;
      }
    }
    if (unresolved.length >= 20) break;
  }
  if (unresolved.length) {
    throw new Error('Source paths remain in runtime files; originals were not deleted:\n' + unresolved.join('\n'));
  }

  for (const item of mappings) fs.unlinkSync(item.source);

  const savings = beforeBytes - afterBytes;
  const percent = beforeBytes ? (savings / beforeBytes) * 100 : 0;
  const mappingRows = mappings.map(item =>
    '- ' + item.sourcePath + ' → ' + item.targetPath + ' — ' +
    item.width + '×' + item.height + ' px; ' + prettyBytes(item.sourceBytes) +
    ' → ' + prettyBytes(item.targetBytes) + '; ' + item.encoder
  );
  const report = [
    '# WebP asset migration report',
    '',
    'Generated by tools/convert-assets-to-webp.mjs on October 13, 2026.',
    '',
    '- Converted static PNG/JPEG files: ' + mappings.length,
    '- Text files updated with new paths: ' + rewrittenFiles,
    '- Original raster payload: ' + prettyBytes(beforeBytes),
    '- WebP payload: ' + prettyBytes(afterBytes),
    '- Net reduction: ' + prettyBytes(savings) + ' (' + percent.toFixed(1) + '%)',
    '- Animated/multi-page files skipped: ' + skipped.length,
    '- Compatibility-sensitive PNG/JPEG files preserved: ' + preservedCompatibilityAssets.length,
    '- Original JPEGs retained where smaller than WebP: ' + preservedOriginalJpegs.length,
    '',
    'PNG files were encoded losslessly to protect transparent art and foil/mask layers. JPEG files were encoded as WebP at quality 92. The site favicon and primary/versioned Open Graph social preview images stay PNG/JPEG for compatibility. SVG, GIF, existing WebP, videos, and 3D files were not converted.',
    '',
    '## Converted assets',
    '',
    ...mappingRows,
    ...(preservedOriginalJpegs.length ? ['', '## Original JPEGs retained where smaller than WebP', '', ...preservedOriginalJpegs.map(file => '- ' + relative(file) + ' — original JPEG retained because the reviewed WebP was larger without a meaningful visual benefit.')] : []),
    ...(skipped.length ? ['', '## Skipped assets', '', ...skipped.map(item => '- ' + item.path + ' — ' + item.reason)] : [])
  ].join('\n') + '\n';
  fs.writeFileSync(REPORT_PATH, report, 'utf8');

  if (fs.existsSync(ROADMAP_PATH)) {
    const marker = '## October 13, 2026 — WebP asset migration completed';
    const roadmap = fs.readFileSync(ROADMAP_PATH, 'utf8');
    if (!roadmap.includes(marker)) {
      fs.appendFileSync(ROADMAP_PATH, '\n\n' + marker + '\n\n' +
        '- Converted ' + mappings.length + ' existing static PNG/JPEG assets to WebP and rewrote ' +
        rewrittenFiles + ' runtime/test source files.\n' +
        '- Payload changed from ' + prettyBytes(beforeBytes) + ' to ' + prettyBytes(afterBytes) +
        ' (' + percent.toFixed(1) + '% net reduction).\n' +
        '- The migration report lists dimensions and per-file sizes at docs/WEBP-ASSET-MIGRATION-REPORT.md.\n' +
        '- CMS PNG/JPEG uploads now convert to WebP before GitHub upload; SVG/vector, animated GIF, existing WebP, video and 3D sources remain unchanged.\n', 'utf8');
    }
  }

  console.log('[webp-migration] Converted ' + mappings.length + ' assets.');
  console.log('[webp-migration] Updated references in ' + rewrittenFiles + ' text files.');
  console.log('[webp-migration] Payload: ' + prettyBytes(beforeBytes) + ' -> ' + prettyBytes(afterBytes) +
    ' (' + percent.toFixed(1) + '% reduction).');
  for (const item of skipped) console.log('[webp-migration] Skipped ' + item.path + ': ' + item.reason);
}

main().catch(error => {
  console.error('[webp-migration] ERROR: ' + (error?.stack || error?.message || String(error)));
  process.exitCode = 1;
});
