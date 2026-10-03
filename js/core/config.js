/**
 * Application configuration normalizer.
 * Accepts raw page configuration and returns stable URLs for feature wiring.
 * No browser globals, DOM, or network access.
 */

const DEFAULT_URLS = Object.freeze({
  settings: 'data/settings.json',
  projects: 'data/projects.json',
  reviews: 'data/reviews.json',
  about: 'data/about.json',
  filters: 'data/filters.json',
  heroLoop: 'data/hero-loop.json',
  heroMessages: 'data/hero.json'
});

function cleanUrl(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function normalizeAppConfig(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const urls = source.urls && typeof source.urls === 'object' ? source.urls : {};

  return {
    urls: {
      settings: cleanUrl(urls.settings, DEFAULT_URLS.settings),
      projects: cleanUrl(urls.projects, DEFAULT_URLS.projects),
      reviews: cleanUrl(urls.reviews, DEFAULT_URLS.reviews),
      about: cleanUrl(urls.about, DEFAULT_URLS.about),
      filters: cleanUrl(urls.filters, DEFAULT_URLS.filters),
      heroLoop: cleanUrl(urls.heroLoop, DEFAULT_URLS.heroLoop),
      heroMessages: cleanUrl(urls.heroMessages, DEFAULT_URLS.heroMessages)
    }
  };
}

export const DEFAULT_APP_CONFIG = Object.freeze({
  urls: DEFAULT_URLS
});
