/**
 * YouTube URL adapter.
 *
 * Features receive a small normalized identifier instead of depending on
 * YouTube's URL shapes or parsing rules.
 */

export function parseYouTubeUrl(url) {
  const value = String(url || '').trim();
  if (!value) return { id: null, isShort: false };

  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    return { id: null, isShort: false };
  }

  const hostname = parsed.hostname.toLowerCase();
  const hostAllowed = hostname === 'youtube.com'
    || hostname.endsWith('.youtube.com')
    || hostname === 'youtu.be';
  if (!hostAllowed) return { id: null, isShort: false };

  const segments = parsed.pathname.split('/').filter(Boolean);
  let id = null;
  let isShort = false;

  if (hostname === 'youtu.be') {
    [id] = segments;
  } else if (segments[0] === 'shorts') {
    id = segments[1] || null;
    isShort = true;
  } else if (segments[0] === 'embed') {
    id = segments[1] || null;
  } else if (segments[0] === 'watch') {
    id = parsed.searchParams.get('v');
  }

  const cleanId = typeof id === 'string' && /^[A-Za-z0-9_-]{6,}$/.test(id)
    ? id
    : null;

  return { id: cleanId, isShort: Boolean(cleanId && isShort) };
}
