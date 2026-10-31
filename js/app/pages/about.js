/**
 * About Me route entrypoint.
 *
 * This page has its own route lifecycle while reusing the persistent site
 * shell and common composition services.
 */
import { createPortfolioApp } from '../page-composition.js?v=20261031-05';

export const pageId = 'about';

export function mount(context = {}) {
  return createPortfolioApp({ ...context, pageId });
}
