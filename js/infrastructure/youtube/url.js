/**
 * YouTube URL adapter.
 *
 * Features receive a small normalized identifier instead of depending on
 * YouTube's URL shapes or parsing rules.
 */

export function parseYouTubeUrl(url) {
  const value = String(url || '');
  let id = null;
  let isShort = false;

  if (value.includes('/shorts/')) {
    id = value.split('/shorts/')[1].split(/[?&]/)[0];
    isShort = true;
  } else if (value.includes('youtu.be/')) {
    id = value.split('youtu.be/')[1].split(/[?&]/)[0];
  } else if (value.includes('watch?v=')) {
    id = value.split('watch?v=')[1].split('&')[0];
  } else if (value.includes('/embed/')) {
    id = value.split('/embed/')[1].split(/[?&]/)[0];
  }

  return { id, isShort };
}
