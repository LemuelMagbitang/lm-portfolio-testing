#!/usr/bin/env node
/**
 * Restore the exact pre-migration favicon and Open Graph source image, update
 * their references, and teach the WebP migration utility to preserve them.
 * Requires the full Git history so SOURCE_COMMIT is available.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const SOURCE_COMMIT = '9db228e38fa7acd0eb18df7503ff011bbe40e5ef';
const COMPATIBILITY = [
  { source: 'assets/projects/site/favicon.png', migrated: 'assets/projects/site/favicon.webp' },
  { source: 'assets/projects/site/og-image.jpg', migrated: 'assets/projects/site/og-image.webp' }
];
const TEXT_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml',
  '.webmanifest', '.xml', '.txt', '.md'
]);
const SKIP_ROOTS = new Set(['.git', 'node_modules', '_site', '.jekyll-cache', 'vendor']);

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function extension(file) {
  return path.extname(file).toLowerCase();
}

function collectFiles(directory) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (directory === ROOT && SKIP_ROOTS.has(entry.name)) continue;
      if (['.git', 'node_modules', '_site', '.jekyll-cache'].includes(entry.name)) continue;
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function createBoundedPattern(value) {
  const special = new Set(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);
  const escaped = value.split('').map(char => special.has(char) ? '\\' + char : char).join('');
  return new RegExp('(?<![A-Za-z0-9_-])' + escaped + '(?![A-Za-z0-9_-])', 'g');
}

function replaceBounded(content, from, to) {
  return content.replace(createBoundedPattern(from), to);
}

function readFileFromGit(pathInRepo) {
  return execFileSync('git', ['show', SOURCE_COMMIT + ':' + pathInRepo], {
    cwd: ROOT,
    maxBuffer: 20 * 1024 * 1024
  });
}

function updateMigrationUtility(file) {
  let source = fs.readFileSync(file, 'utf8');
  if (!source.includes('function isCompatibilityRaster(file)')) {
    const extStart = source.indexOf('function extension(file) {');
    const insertAt = source.indexOf('\nfunction collectFiles(', extStart);
    if (extStart < 0 || insertAt < 0) throw new Error('Could not locate extension helper in WebP migration utility.');
    const helper = "\nfunction isCompatibilityRaster(file) {\n" +
      "  const rel = path.relative(ROOT, file).split(path.sep).join('/').toLowerCase();\n" +
      "  if (rel === 'assets/projects/site/favicon.png') return true;\n" +
      "  return /^assets\\\\/projects\\\\/site\\\\/(?:og-image|og-preview(?:-v[0-9]+)?)\\\\.(?:png|jpe?g)$/.test(rel);\n" +
      "}\n";
    source = source.slice(0, insertAt) + helper + source.slice(insertAt);
  }
  const oldCandidates = [
    '  const candidates = collectFiles(ASSET_ROOT)',
    '    .filter(file => CONVERTIBLE.has(extension(file)))',
    '    .sort((a, b) => a.localeCompare(b));'
  ].join('\n');
  const newCandidates = [
    '  const allRasterCandidates = collectFiles(ASSET_ROOT)',
    '    .filter(file => CONVERTIBLE.has(extension(file)))',
    '    .sort((a, b) => a.localeCompare(b));',
    '  const preservedCompatibilityAssets = allRasterCandidates.filter(isCompatibilityRaster);',
    '  const candidates = allRasterCandidates.filter(file => !isCompatibilityRaster(file));'
  ].join('\n');
  if (source.includes(oldCandidates)) source = source.replace(oldCandidates, newCandidates);
  else if (!source.includes('const candidates = allRasterCandidates.filter(file => !isCompatibilityRaster(file));')) {
    throw new Error('Could not locate candidate selection in WebP migration utility.');
  }
  const reportSkipLine = "    '- Animated/multi-page files skipped: ' + skipped.length,";
  const reportSkipLineWithPreserved = reportSkipLine + "\n    '- Compatibility-sensitive PNG/JPEG files preserved: ' + preservedCompatibilityAssets.length,";
  if (source.includes(reportSkipLine)) source = source.replace(reportSkipLine, reportSkipLineWithPreserved);
  source = source.replace(
    'JPEG files were encoded as WebP at quality 92. SVG, GIF, existing WebP, videos, and 3D files were not converted.',
    'JPEG files were encoded as WebP at quality 92. The site favicon and primary/versioned Open Graph social preview images stay PNG/JPEG for compatibility. SVG, GIF, existing WebP, videos, and 3D files were not converted.'
  );
  fs.writeFileSync(file, source, 'utf8');
}

function updateReport(file) {
  let report = fs.readFileSync(file, 'utf8');
  report = report
    .replace('- Converted static PNG/JPEG files: 88', '- Converted static PNG/JPEG files: 86')
    .replace('- Original raster payload: 34.93 MiB', '- Original eligible raster payload: 34.85 MiB')
    .replace('- WebP payload: 22.99 MiB', '- WebP payload: 22.94 MiB')
    .replace('- Net reduction: 11.94 MiB (34.2%)', '- Net reduction: 11.92 MiB (34.2%)')
    .replace(/^- assets\/projects\/site\/favicon\.png → assets\/projects\/site\/favicon\.webp — .*$(?:\r?\n)?/m, '')
    .replace(/^- assets\/projects\/site\/og-image\.jpg → assets\/projects\/site\/og-image\.webp — .*$(?:\r?\n)?/m, '');
  if (!report.includes('## Preserved compatibility-sensitive assets')) {
    report += '\n## Preserved compatibility-sensitive assets\n\n' +
      '- assets/projects/site/favicon.png — restored from the pre-migration Git commit; retained as PNG.\n' +
      '- assets/projects/site/og-image.jpg — restored from the pre-migration Git commit; retained as JPEG for social-sharing crawlers.\n';
  }
  fs.writeFileSync(file, report, 'utf8');
}

function updateRoadmap(file) {
  let roadmap = fs.readFileSync(file, 'utf8');
  const marker = '## October 13, 2026 — WebP asset migration completed';
  const idx = roadmap.indexOf(marker);
  if (idx < 0) throw new Error('Migration summary section is missing from the roadmap.');
  const next = roadmap.indexOf('\n## ', idx + marker.length);
  const end = next >= 0 ? next : roadmap.length;
  const updatedSection = [
    marker,
    '',
    '- Converted 86 existing static PNG/JPEG assets to WebP and rewrote runtime/test source paths.',
    '- Kept the site favicon in PNG and the primary Open Graph social-sharing image in JPEG for compatibility.',
    '- Eligible raster payload changed from 34.85 MiB to 22.94 MiB (11.92 MiB / 34.2% reduction).',
    '- The migration report lists dimensions and per-file sizes at docs/WEBP-ASSET-MIGRATION-REPORT.md.',
    '- CMS PNG/JPEG uploads convert to WebP before GitHub upload. SVG/vector, animated GIF, existing WebP, videos, 3D sources, favicon and primary/versioned Open Graph images remain in their original formats.'
  ].join('\n');
  roadmap = roadmap.slice(0, idx) + updatedSection + roadmap.slice(end);
  fs.writeFileSync(file, roadmap, 'utf8');
}

async function main() {
  for (const item of COMPATIBILITY) {
    const bytes = readFileFromGit(item.source);
    const sourcePath = path.join(ROOT, item.source);
    const migratedPath = path.join(ROOT, item.migrated);
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, bytes);
    if (fs.existsSync(migratedPath)) fs.unlinkSync(migratedPath);
    console.log('[webp-compat] Restored ' + item.source + ' (' + bytes.length + ' bytes).');
  }

  let rewrittenFiles = 0;
  for (const file of collectFiles(ROOT)) {
    const rel = relative(file);
    if (rel.startsWith('docs/') || rel.startsWith('.github/') ||
        rel === 'tools/restore-webp-compat-assets.mjs' || rel.startsWith('assets/')) continue;
    if (!TEXT_EXTENSIONS.has(extension(file))) continue;
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    if (content.includes('\u0000')) continue;
    const original = content;
    for (const item of COMPATIBILITY) {
      content = replaceBounded(content, item.migrated, item.source);
      content = replaceBounded(content, path.posix.basename(item.migrated), path.posix.basename(item.source));
    }
    if (content !== original) {
      fs.writeFileSync(file, content, 'utf8');
      rewrittenFiles++;
    }
  }

  const unresolved = [];
  for (const file of collectFiles(ROOT)) {
    const rel = relative(file);
    if (rel.startsWith('docs/') || rel.startsWith('.github/') ||
        rel === 'tools/restore-webp-compat-assets.mjs' || rel.startsWith('assets/')) continue;
    if (!TEXT_EXTENSIONS.has(extension(file))) continue;
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    for (const item of COMPATIBILITY) {
      const oldBase = path.posix.basename(item.migrated);
      if (content.includes(item.migrated) || createBoundedPattern(oldBase).test(content)) {
        unresolved.push(rel + ' still mentions ' + item.migrated);
      }
    }
    if (unresolved.length >= 20) break;
  }
  if (unresolved.length) throw new Error('Compatibility path rewrite incomplete:\n' + unresolved.join('\n'));

  updateMigrationUtility(path.join(ROOT, 'tools', 'convert-assets-to-webp.mjs'));
  updateReport(path.join(ROOT, 'docs', 'WEBP-ASSET-MIGRATION-REPORT.md'));
  updateRoadmap(path.join(ROOT, 'docs', 'DECOUPLING-ROADMAP.md'));

  console.log('[webp-compat] Updated ' + rewrittenFiles + ' runtime/source files.');
  console.log('[webp-compat] Preserved site favicon PNG and Open Graph JPEG; all other migrated artwork remains WebP.');
}

main().catch(error => {
  console.error('[webp-compat] ERROR: ' + (error?.stack || error?.message || String(error)));
  process.exitCode = 1;
});
