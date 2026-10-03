/**
 * Reduced-motion browser capability.
 * Kept outside features so animation preferences are replaceable/testable.
 */
const mediaQuery = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

export const prefersReducedMotion = () => Boolean(mediaQuery?.matches);
