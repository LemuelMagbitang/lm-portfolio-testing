import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const jsRoot = path.join(root, 'js');
const errors = [];

const rules = [
  { dir: 'core', forbidden: ['features/', 'data/', 'infrastructure/', 'app/'] },
  { dir: 'data', forbidden: ['features/', 'infrastructure/', 'app/'] },
  { dir: 'infrastructure', forbidden: ['features/', 'app/'] },
  { dir: 'features', forbidden: ['app/'] }
];

const legacyRootModules = new Set([
  'gallery.js',
  'hero.js',
  'lightbox.js',
  'model-viewer.js',
  'media-background.js'
]);

// Stateful infrastructure modules must resolve to one browser module identity.
// Different query strings create different ES module instances, which can split
// singleton state such as in-flight loaders/caches across otherwise identical
// imports. Keep the canonical cache key here so future imports cannot silently
// reintroduce that class of runtime duplication.
const canonicalModuleQueries = new Map([
  ['infrastructure/browser/script-loader.js', '?v=20261008-01'],
  ['infrastructure/browser/site-paths.js', '?v=20261004-01'],
  ['infrastructure/media-background/loader.js', '?v=20261008-01'],
  ['infrastructure/software-logo/lookup.js', '?v=20261008-01'],
  ['features/projects/index.js', '?v=20261010-04'],
  ['features/projects/browser-runtime.js', '?v=20261010-04'],
  ['features/projects/project-loader.js', '?v=20261010-03'],
  ['features/lightbox/index.js', '?v=20261011-02'],
  ['features/lightbox/media-renderer.js', '?v=20261011-01'],
  ['features/lightbox/foil-normal-renderer.js', '?v=20261010-06'],
  ['data/project-normalizer.js', '?v=20261010-04']
]);

for (const legacy of legacyRootModules) {
  if (fs.existsSync(path.join(jsRoot, legacy))) {
    errors.push(`Legacy root runtime js/${legacy} must be removed; use the decoupled feature/infrastructure module instead.`);
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function importsFrom(source) {
  const staticMatches = source.matchAll(/(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g);
  const dynamicMatches = source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  return [
    ...[...staticMatches].map(match => match[1]),
    ...[...dynamicMatches].map(match => match[1])
  ];
}

function importQuery(specifier) {
  const marker = specifier.indexOf('?');
  if (marker < 0) return '';
  return specifier.slice(marker).split('#')[0];
}

function normalizeImport(file, specifier) {
  if (!specifier.startsWith('.')) return null;
  const cleanSpecifier = specifier.split(/[?#]/)[0];
  const absolute = path.resolve(path.dirname(file), cleanSpecifier);
  const relative = path.relative(jsRoot, absolute).replaceAll(path.sep, '/');
  return relative.endsWith('.js') ? relative : `${relative}.js`;
}

function featureName(rel) {
  const match = rel.match(/^features\/([^/]+)\//);
  return match ? match[1] : null;
}

// script.js is only the browser entrypoint. Composition and orchestration
// live under js/app so the entrypoint cannot slowly become a new monolith.
const entrypoint = path.join(jsRoot, 'script.js');
if (!fs.existsSync(entrypoint)) {
  errors.push('js/script.js is missing');
} else {
  const lineCount = fs.readFileSync(entrypoint, 'utf8').split(/\r?\n/).length;
  if (lineCount > 40) {
    errors.push(`js/script.js must remain a thin entrypoint; found ${lineCount} lines`);
  }
}

for (const required of ['app/bootstrap.js', 'app/page-composition.js', 'core/config.js']) {
  if (!fs.existsSync(path.join(jsRoot, required))) {
    errors.push(`Missing required architecture module js/${required}`);
  }
}

for (const file of walk(jsRoot)) {
  if (!file.endsWith('.js')) continue;

  const rel = path.relative(jsRoot, file).replaceAll(path.sep, '/');
  const source = fs.readFileSync(file, 'utf8');
  const importSpecifiers = importsFrom(source);
  const imports = importSpecifiers
    .map(specifier => normalizeImport(file, specifier))
    .filter(Boolean);

  for (const specifier of importSpecifiers) {
    const imported = normalizeImport(file, specifier);
    if (!imported) continue;
    if (imported.startsWith('../admin/')) {
      errors.push(`${rel} imports CMS implementation ${imported}; the public runtime must not depend on admin code`);
    }
    const expectedQuery = canonicalModuleQueries.get(imported);
    if (!expectedQuery) continue;
    const actualQuery = importQuery(specifier);
    if (actualQuery !== expectedQuery) {
      errors.push(`${rel} imports ${imported} with cache key ${actualQuery || '(none)'}; expected ${expectedQuery}`);
    }
  }

  for (const rule of rules) {
    if (!rel.startsWith(`${rule.dir}/`)) continue;

    for (const imported of imports) {
      if (rule.forbidden.some(prefix => imported.startsWith(prefix))) {
        errors.push(`${rel} imports forbidden layer ${imported}`);
      }
    }
  }

  if (rel.startsWith('core/') && /\b(fetch|XMLHttpRequest|document\.(querySelector|getElementById|createElement)|window\.)/.test(source)) {
    errors.push(`${rel} contains browser/data access; core must remain environment-agnostic`);
  }

  if (rel.startsWith('data/') && /\b(document\.|window\.|HTMLElement|HTML[A-Z]\w*Element)/.test(source)) {
    errors.push(`${rel} contains DOM/window coupling; data modules must not render UI`);
  }

  if (rel.startsWith('features/') && /\b(?:window\.(THREE|lottie|YT|Web3Forms)|THREE\.|lottie\.|YT\.)/.test(source)) {
    errors.push(`${rel} references vendor globals directly; use an infrastructure adapter`);
  }

  if (rel.startsWith('features/') && imports.some(imported => legacyRootModules.has(imported))) {
    errors.push(`${rel} imports a legacy root controller; migrate through an explicit feature/infrastructure boundary`);
  }

  // Feature internals are private. Consumers outside a feature must use its
  // index.js public API so implementation files can be reorganized freely.
  const consumerFeature = featureName(rel);
  for (const imported of imports) {
    const match = imported.match(/^features\/([^/]+)\/(.+)$/);
    if (!match) continue;
    const importedFeature = match[1];
    const importedInternalPath = match[2];
    if (consumerFeature !== importedFeature && importedInternalPath !== 'index.js') {
      errors.push(`${rel} imports private feature module ${imported}; import features/${importedFeature}/index.js instead`);
    }
  }
}

// The public pages must never load CMS implementation modules. The admin app is
// a separate application that shares repository content, not a public dependency.
const publicHtmlEntrypoints = ['index.html', 'about/index.html', '404.html', 'success/index.html'];
for (const htmlPath of publicHtmlEntrypoints) {
  const fullPath = path.join(root, htmlPath);
  if (!fs.existsSync(fullPath)) continue;
  const html = fs.readFileSync(fullPath, 'utf8');
  for (const tagMatch of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const tagName = tagMatch[1].toLowerCase();
    const attributes = tagMatch[2];
    if (tagName === 'link' && !/\brel\s*=\s*["'][^"']*modulepreload[^"']*["']/i.test(attributes)) continue;
    const attributePattern = tagName === 'script'
      ? /\bsrc\s*=\s*(["'])(.*?)\1/i
      : /\bhref\s*=\s*(["'])(.*?)\1/i;
    const attributeMatch = attributes.match(attributePattern);
    if (!attributeMatch) continue;
    const resourceUrl = attributeMatch[2].trim();
    if (!resourceUrl || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(resourceUrl)) continue;
    const resourcePath = resourceUrl.split(/[?#]/)[0].replace(/\\/g, '/');
    const resolvedPath = path.posix.normalize(path.posix.join(path.posix.dirname(htmlPath.replaceAll(path.sep, '/')), resourcePath));
    if (resolvedPath.startsWith('admin/') && /\.m?js$/i.test(resolvedPath)) {
      errors.push(`${htmlPath} loads CMS implementation script ${resourceUrl}; public pages must not load admin code`);
    }
  }
}

// Every multi-module feature gets one explicit public entry point.
const featureDirs = fs.existsSync(path.join(jsRoot, 'features'))
  ? fs.readdirSync(path.join(jsRoot, 'features'), { withFileTypes: true }).filter(entry => entry.isDirectory())
  : [];

for (const feature of featureDirs) {
  const featurePath = path.join(jsRoot, 'features', feature.name);
  const modules = walk(featurePath).filter(file => file.endsWith('.js'));
  if (modules.length > 1 && !fs.existsSync(path.join(featurePath, 'index.js'))) {
    errors.push(`features/${feature.name} has multiple modules but no public index.js API`);
  }
}

// Contract tests import production modules too. Keep their versioned specifiers
// canonical so integration tests exercise the same module singleton as the app.
for (const file of walk(path.join(root, 'tools')).filter(file => file.endsWith('.mjs'))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const specifier of importsFrom(source)) {
    const imported = normalizeImport(file, specifier);
    if (!imported) continue;
    const expectedQuery = canonicalModuleQueries.get(imported);
    if (!expectedQuery) continue;
    const actualQuery = importQuery(specifier);
    if (actualQuery !== expectedQuery) {
      errors.push(`${path.relative(root, file).replaceAll(path.sep, '/')} imports ${imported} with cache key ${actualQuery || '(none)'}; expected ${expectedQuery}`);
    }
  }
}

for (const facade of ['cms-data.js', 'site-runtime.js']) {
  const file = path.join(jsRoot, facade);
  if (fs.existsSync(file)) {
    errors.push(`Legacy runtime facade js/${facade} must be removed after infrastructure cutover`);
  }
}

if (errors.length) {
  console.error('Architecture validation failed:\n- ' + errors.join('\n- '));
  process.exit(1);
}

console.log('Architecture boundaries validated.');
