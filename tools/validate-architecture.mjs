#!/usr/bin/env node

/**
 * Architecture boundary validator.
 *
 * This intentionally starts as a low-risk guardrail: the existing portfolio
 * can continue running while new modules are introduced incrementally.
 * Once a subsystem moves into one of the architectural directories, this
 * validator prevents it from reaching outward into unrelated layers.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const JS_ROOT = path.join(ROOT, 'js');
const errors = [];
const warnings = [];

const ARCH_DIRS = new Set(['core', 'data', 'features', 'infrastructure', 'app']);

const ALLOWED_IMPORTS = {
  core: new Set(['core']),
  data: new Set(['core', 'data', 'infrastructure']),
  features: new Set(['core', 'data', 'features', 'infrastructure']),
  infrastructure: new Set(['core', 'infrastructure']),
  app: new Set(['core', 'data', 'features', 'infrastructure', 'app'])
};

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(full));
    else if (entry.isFile() && full.endsWith('.js')) output.push(full);
  }
  return output;
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}

function architectureLayer(file) {
  const rel = relative(file);
  const match = rel.match(/^js\/([^/]+)\//);
  return match && ARCH_DIRS.has(match[1]) ? match[1] : null;
}

function importsFrom(source) {
  const text = fs.readFileSync(source, 'utf8');
  const imports = [];
  const patterns = [
    /\bimport\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) imports.push(match[1]);
  }
  return imports;
}

function importedLayer(source, specifier) {
  if (!specifier.startsWith('.')) return null;
  const target = path.normalize(path.join(path.dirname(source), specifier));
  const rel = relative(target).replace(/\.js$/, '');
  const match = rel.match(/^js\/([^/]+)(?:\/|$)/);
  return match && ARCH_DIRS.has(match[1]) ? match[1] : null;
}

for (const file of walk(JS_ROOT)) {
  const layer = architectureLayer(file);
  if (!layer) continue;

  for (const specifier of importsFrom(file)) {
    const targetLayer = importedLayer(file, specifier);
    if (!targetLayer || targetLayer === layer) continue;
    if (!ALLOWED_IMPORTS[layer]?.has(targetLayer)) {
      errors.push(`${relative(file)} imports ${targetLayer}; ${layer} may not depend on ${targetLayer}.`);
    }
  }

  const source = fs.readFileSync(file, 'utf8');
  if (layer === 'core' && /\b(fetch|localStorage|sessionStorage|indexedDB)\s*\(/.test(source)) {
    errors.push(`${relative(file)}: core must not perform external I/O or storage access directly.`);
  }

  if (layer === 'features' && /\bwindow\.(github|THREE|lottie|Web3Forms)\b/i.test(source)) {
    errors.push(`${relative(file)}: feature code must use infrastructure adapters instead of vendor globals.`);
  }
}

// The legacy root-level controllers are deliberately reported as warnings
// during the migration. This keeps the branch buildable while making the
// remaining coupling visible until each controller is moved behind a feature
// boundary.
for (const legacy of ['js/script.js', 'js/cms-data.js', 'js/gallery.js', 'js/hero.js', 'js/lightbox.js', 'js/model-viewer.js', 'js/media-background.js']) {
  if (fs.existsSync(path.join(ROOT, legacy))) warnings.push(`${legacy}: legacy root-level module; migrate behind an explicit architecture boundary when refactoring this subsystem.`);
}

if (warnings.length) {
  console.log('Architecture warnings:');
  for (const warning of warnings) console.log(`  - ${warning}`);
}

if (errors.length) {
  console.error('\nArchitecture errors:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('Architecture boundary validation passed.');
