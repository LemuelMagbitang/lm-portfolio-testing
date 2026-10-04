/**
 * LM Portfolio entrypoint.
 * DOMContentLoaded is the only responsibility of this file.
 */

import { bootstrapPortfolioApp } from './app/bootstrap.js?v=20261004-21';

function start() {
  return bootstrapPortfolioApp().catch(error => {
    console.error('Portfolio bootstrap failed', error);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
