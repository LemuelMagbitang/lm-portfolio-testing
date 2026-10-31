/**
 * Design route entrypoint.
 *
 * The document shell and shared browser services stay alive while this
 * page module owns the Design route's feature composition lifecycle.
 */
import { createPortfolioApp } from '../page-composition.js?v=20261031-08';

export const pageId = 'design';

export function mount(context = {}) {
  return createPortfolioApp({ ...context, pageId });
}
