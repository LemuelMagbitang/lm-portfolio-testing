import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const jsRoot = path.join(root, 'js');

const rules = [
  { dir: 'core', forbidden: ['features/', 'data/', 'infrastructure/'] },
  { dir: 'data', forbidden: ['features/', 'infrastructure/'] },
  { dir: 'infrastructure', forbidden: ['features/'] }
];

const legacyFacades = new Set(['cms-data.js', 'site-runtime.js']);
const errors = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function importsFrom(source) {
  const matches = source.matchAll(/(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g);
  return [...matches].map(match => match[1]);
}

function normalizeImport(file, specifier) {
  if (!specifier.startsWith('.')) return null;
  const absolute = path.resolve(path.dirname(file), specifier);
  const relative = path.relative(jsRoot, absolute).replaceAll(path.sep, '/');
  return relative.endsWith('.js') ? relative : `${relative}.js`;
}

for (const file of walk(jsRoot)) {
  if (!file.endsWith('.js')) continue;
  const rel = path.relative(jsRoot, file).replaceAll(path.sep, '/');
  const source = fs.readFileSync(file, 'utf8');
  const imports = importsFrom(source).map(specifier => normalizeImport(file, specifier)).filter(Boolean);

  for (const rule of rules) {
    if (!rel.startsWith(`${rule.dir}/`)) continue;
    for (const imported of imports) {
      if (rule.forbidden.some(prefix => imported.startsWith(prefix))) {
        errors.push(`${rel} imports forbidden layer ${imported}`);
      }
    }
  }

  if (rel.startsWith('core/') && /\b(fetch|document\.querySelector|document\.getElementById)\b/.test(source)) {
    errors.push(`${rel} contains browser/data access; keep core environment-agnostic where possible`);
  }
}

for (const facade of legacyFacades) {
  const file = path.join(jsRoot, facade);
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  const lineCount = source.split(/\r?\n/).length;
  if (lineCount > 80) errors.push(`${facade} is a migration facade but is ${lineCount} lines; keep it temporary and thin`);
}

if (errors.length) {
  console.error('Architecture validation failed:\n- ' + errors.join('\n- '));
  process.exit(1);
}

console.log('Architecture boundaries validated.');
