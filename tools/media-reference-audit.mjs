import path from 'node:path';

/**
 * Turn source files into a reliable reference-search surface.
 * HTML placeholders and comments are documentation, not live asset usage.
 */
export function searchableReferenceContent(sourcePath, content) {
  const raw = String(content || '');
  if (path.extname(String(sourcePath || '')).toLowerCase() !== '.html') return raw;

  return raw
    .replace(/<!--[\\s\\S]*?-->/g, ' ')
    .replace(/\\bplaceholder\\s*=\\s*(["'])[\\s\\S]*?\\1/gi, ' ');
}

/**
 * Return source paths that contain a real-looking asset reference.
 * Keep this intentionally conservative: it reports references for human
 * review and never deletes or changes an asset.
 */
export function findAssetReferences(assetPath, sources = []) {
  const relative = String(assetPath || '').replaceAll('\\\\', '/');
  if (!relative) return [];

  const basename = path.posix.basename(relative);
  return sources
    .filter(source => {
      const content = searchableReferenceContent(source?.path, source?.content);
      return content.includes(relative) || (basename && content.includes(basename));
    })
    .map(source => String(source.path || ''));
}
