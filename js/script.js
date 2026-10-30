/**
 * LM Portfolio entrypoint.
 * Owns one long-lived client-side router and one active page app instance.
 */

import { bootstrapPortfolioApp } from './app/bootstrap.js?v=20261031-01';
import { initPageNavigation } from './app/page-navigation.js?v=20261031-01';

let activeApp = null;

const pageNavigation = initPageNavigation({
  root: document,
  getApp: () => activeApp,
  setApp: app => { activeApp = app; },
  mountPage: options => bootstrapPortfolioApp({ root: document, ...options })
});

async function start() {
  activeApp = await bootstrapPortfolioApp({ root: document });
  return activeApp;
}

function handleStartupFailure(error) {
  console.error('Portfolio bootstrap failed', error);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void start().catch(handleStartupFailure);
  }, { once: true });
} else {
  void start().catch(handleStartupFailure);
}

window.addEventListener('pagehide', () => pageNavigation.destroy(), { once: true });
