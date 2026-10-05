#!/usr/bin/env node
/**
 * Browser smoke test for the public static site.
 *
 * This intentionally checks the failure mode static validators cannot see:
 * the browser must execute the ES-module bootstrap and render the page without
 * uncaught runtime errors. The CI workflow runs this against the checked-out
 * commit so static validation cannot mask runtime regressions.
 */

import { spawn } from 'node:child_process';
import process from 'node:process';

import { chromium } from 'playwright';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function startServer() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  server.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  return { server, getStderr: () => stderr };
}

function stopServer(server) {
  if (!server || server.killed) return;
  server.kill('SIGTERM');
}

async function waitForServer(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Local site server did not become ready: ${url}`);
}

async function configureLogoRoutes(page) {
  await page.route('https://cdn.simpleicons.org/**', async route => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1h22v22H1z"/></svg>';
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg });
  });
  await page.route('https://api.iconify.design/search**', async route => {
    const query = new URL(route.request().url()).searchParams.get('query') || '';
    const icon = query.toLowerCase().includes('krita') ? 'simple-icons:krita' : 'simple-icons:blender';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ icons: [icon], total: 1, limit: 12, start: 0 })
    });
  });
}

async function smokePage(browser, path, assertions, viewport = { width: 1280, height: 900 }, prepare = null, beforeReady = null) {
  const page = await browser.newPage({ viewport });
  await configureLogoRoutes(page);

  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });

  if (typeof prepare === 'function') await prepare(page);
  await page.goto(`${BASE_URL}${path}`, {
    waitUntil: 'domcontentloaded',
    timeout: 15000
  });

  if (typeof beforeReady === 'function') await beforeReady(page);
  await page.waitForTimeout(1800);
  await assertions(page);

  if (errors.length) {
    throw new Error(`${path} produced browser errors:\n- ${errors.join('\n- ')}`);
  }

  await page.close();
}

async function assertMobileNavigation(page, label) {
  const button = page.locator('.hamburger').first();
  const menu = page.locator('.nav-links').first();
  if (await button.count() !== 1) throw new Error(label + ' is missing the public hamburger button.');
  if (await menu.count() !== 1) throw new Error(label + ' is missing the public mobile navigation.');

  await button.click();
  const expanded = await button.getAttribute('aria-expanded');
  const active = await menu.evaluate(el => el.classList.contains('active'));
  if (expanded !== 'true' || !active) {
    throw new Error(label + ' hamburger did not open the mobile navigation.');
  }

  await page.locator('.navbar').click({ position: { x: 4, y: 4 } }).catch(() => {});
  const stillOpenAfterInsideClick = await menu.evaluate(el => el.classList.contains('active'));
  if (!stillOpenAfterInsideClick) {
    throw new Error(label + ' mobile navigation closed when clicking inside the navbar.');
  }

  await page.locator('body').click({ position: { x: 5, y: 300 } });
  const closed = await menu.evaluate(el => !el.classList.contains('active'));
  const collapsed = await button.getAttribute('aria-expanded');
  if (!closed || collapsed !== 'false') {
    throw new Error(label + ' mobile navigation did not close from an outside tap.');
  }
}

const { server, getStderr } = startServer();
process.on('exit', () => stopServer(server));

try {
  await waitForServer(`${BASE_URL}/`);

  const browser = await chromium.launch({ headless: true });

  try {
    await smokePage(browser, '/', async page => {
      const moduleScript = await page.locator('script[type="module"][src*="script.js"]').count();
      if (moduleScript !== 1) throw new Error('Works page is missing its module bootstrap script.');
      const runtimeCacheChain = await page.evaluate(() => {
        const script = document.querySelector('script[type="module"][src*="script.js"]');
        const preloads = Array.from(document.querySelectorAll('link[rel="modulepreload"]'))
          .map(link => link.getAttribute('href') || '');
        const readVersion = marker => {
          const src = preloads.find(value => value.includes(marker));
          return src ? new URL(src, location.href).searchParams.get('v') : '';
        };
        return {
          scriptVersion: script ? new URL(script.src, location.href).searchParams.get('v') : '',
          bootstrapVersion: readVersion('app/bootstrap.js'),
          compositionVersion: readVersion('app/page-composition.js')
        };
      });
      if (
        runtimeCacheChain.scriptVersion !== '20261005-14' ||
        runtimeCacheChain.bootstrapVersion !== '20261005-14' ||
        runtimeCacheChain.compositionVersion !== '20261005-14'
      ) {
        throw new Error(`Public runtime cache chain is stale: ${JSON.stringify(runtimeCacheChain)}`);
      }

      const cards = await page.locator('#portfolioGrid .project-card').count();
      if (cards < 1) throw new Error(`Works page rendered no project cards (found ${cards}).`);

      const interactionStyles = await page.evaluate(() => {
        const card = document.querySelector('#portfolioGrid .project-card');
        const filter = document.querySelector('.filter-tabs .filter-btn, .filter-tabs .tab-btn');
        const cardStyle = card ? getComputedStyle(card) : null;
        const filterStyle = filter ? getComputedStyle(filter) : null;
        return {
          cardCursor: cardStyle?.cursor || '',
          cardUserSelect: cardStyle?.userSelect || '',
          filterCursor: filterStyle?.cursor || '',
          filterUserSelect: filterStyle?.userSelect || ''
        };
      });
      if (interactionStyles.cardCursor === 'text' || interactionStyles.cardUserSelect !== 'none') {
        throw new Error('Project cards regressed into text-selection/caret behavior.');
      }
      if (interactionStyles.filterCursor === 'text' || interactionStyles.filterUserSelect !== 'none') {
        throw new Error('Works filter controls regressed into text-selection/caret behavior.');
      }

      const heroSlides = await page.locator('#heroBanner .slide').count();
      if (heroSlides < 1) throw new Error(`Works Hero rendered no artwork slides (found ${heroSlides}).`);

      const firstActiveSlide = await page.locator('#heroBanner .slide.active').first().getAttribute('class').catch(() => '');
      if (!firstActiveSlide) throw new Error('Works Hero has no active artwork slide.');

      const heroText = await page.locator('#heroQuoteText').textContent().catch(() => '');
      if (!heroText?.trim()) throw new Error('Works Hero rendered no message text.');

      if (heroSlides > 1) {
        await page.waitForTimeout(3800);
        const activeSlides = await page.locator('#heroBanner .slide.active').count();
        if (activeSlides !== 1) throw new Error(`Works Hero loop has invalid active-slide state (found ${activeSlides}).`);
      }

      const allFilter = page.locator('.filter-tabs .filter-btn[data-filter="all"], .filter-tabs .tab-btn[data-filter="all"]');
      if (await allFilter.count() !== 1) throw new Error('Works filter UI is missing the ALL filter.');

      const filterButtons = page.locator('.filter-tabs .filter-btn, .filter-tabs .tab-btn');
      const filterCount = await filterButtons.count();
      if (filterCount < 2) throw new Error(`Works filter UI rendered too few filters (found ${filterCount}).`);

      const filterColor = await filterButtons.first().evaluate(el => getComputedStyle(el).color);
      if (!filterColor || filterColor === 'rgba(0, 0, 0, 0)') throw new Error('Works filter button styling did not load.');

      const secondaryFilter = filterButtons.nth(1);
      await secondaryFilter.click();
      await page.waitForTimeout(420);
      const filteredCards = await page.locator('#portfolioGrid .project-card').evaluateAll(
        cards => cards.filter(card => getComputedStyle(card).display !== 'none').length
      );
      if (filteredCards < 1) throw new Error('Works filter interaction hid every project unexpectedly.');
      if (await secondaryFilter.getAttribute('data-filter') === 'all') throw new Error('Works secondary filter fixture is unexpectedly ALL.');

      const activeFilterCount = await page.locator('.filter-tabs .tab-btn.active, .filter-tabs .filter-btn.active').count();
      if (activeFilterCount !== 1) throw new Error(`Works filter interaction produced ${activeFilterCount} active filters.`);

      const allFilterButton = page.locator('.filter-tabs [data-filter="all"]').first();
      await allFilterButton.click();
      await page.waitForTimeout(420);
      const restoredCards = await page.locator('#portfolioGrid .project-card').evaluateAll(
        cards => cards.filter(card => getComputedStyle(card).display !== 'none').length
      );
      if (restoredCards < filteredCards) throw new Error('Works ALL filter did not restore the project set.');

      const firstCard = page.locator('#portfolioGrid .project-card').first();
      await firstCard.click();
      await page.waitForTimeout(200);
      const lightbox = page.locator('#lightbox.active');
      if (await lightbox.count() !== 1) throw new Error('Lightbox did not open from the first project card.');

      const closeBeforeTab = page.locator('#lightboxClose').first();
      await closeBeforeTab.waitFor({ state: 'visible', timeout: 3000 });
      await page.keyboard.press('Tab');
      const firstTabTarget = await page.evaluate(() => document.activeElement?.id || document.activeElement?.className || '');
      if (!firstTabTarget) throw new Error('Lightbox keyboard focus did not move to a visible control.');

      const nextButton = page.locator('.lightbox-next').first();
      if (await nextButton.count() === 1) {
        await nextButton.click();
        await page.waitForTimeout(120);
        await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });
      }

      // Exercise the real DOM swipe path, not only the exported direction helper.
      // Dispatch a touch-style horizontal gesture against the Lightbox shell so a
      // regression that forgets to bind the pointer handlers cannot pass the smoke suite.
      const swipeTitleBefore = await page.locator('#modalTitle').textContent();
      await page.locator('#lightbox').dispatchEvent('pointerdown', {
        pointerType: 'touch',
        isPrimary: true,
        pointerId: 71,
        clientX: 320,
        clientY: 420
      });
      await page.locator('#lightbox').dispatchEvent('pointerup', {
        pointerType: 'touch',
        isPrimary: true,
        pointerId: 71,
        clientX: 170,
        clientY: 420
      });
      await page.waitForTimeout(340);
      const swipeTitleAfter = await page.locator('#modalTitle').textContent();
      if (!swipeTitleBefore || swipeTitleAfter === swipeTitleBefore) {
        throw new Error('Lightbox touch swipe did not navigate between projects.');
      }

      const closeButton = page.locator('#lightboxClose');
      const navigationContrast = await page.locator('.lightbox-next i').evaluate(el => {
        const style = getComputedStyle(el);
        return {
          mixBlendMode: style.mixBlendMode,
          color: style.color,
          textShadow: style.textShadow
        };
      });
      if (navigationContrast.mixBlendMode !== 'normal') {
        throw new Error('Lightbox navigation icon still uses blend compositing: ' + navigationContrast.mixBlendMode);
      }
      if (navigationContrast.color !== 'rgb(255, 255, 255)') {
        throw new Error('Lightbox navigation icon is not brand white: ' + navigationContrast.color);
      }
      if (!navigationContrast.textShadow.includes('18px') && !navigationContrast.textShadow.includes('18, 18, 18')) {
        throw new Error('Lightbox navigation icon lost the brand-dark contrast edge: ' + navigationContrast.textShadow);
      }

      if (await closeButton.count()) {
        await closeButton.click();
        await page.waitForTimeout(120);
      }

      const restoredFocus = await firstCard.evaluate(el => document.activeElement === el);
      if (!restoredFocus) throw new Error('Lightbox close did not restore focus to the project card that opened it.');
      const lightboxA11yClosed = await page.locator('#lightbox').getAttribute('aria-hidden');
      const lightboxAriaModalClosed = await page.locator('#lightbox').getAttribute('aria-modal');
      if (lightboxA11yClosed !== 'true') throw new Error('Closed Lightbox is not aria-hidden.');
      if (lightboxAriaModalClosed !== null) throw new Error('Closed Lightbox still exposes aria-modal.');


      const showMore = page.locator('#showMoreBtn').first();
      if (await showMore.isVisible().catch(() => false)) {
        await showMore.click();
        await page.waitForTimeout(450);
      }

      const modelCard = page.locator('#portfolioGrid .project-card[data-project-id="test-project"]').first();
      if (await modelCard.count() !== 1) throw new Error('3D Lightbox smoke fixture card is missing.');
      if (await modelCard.evaluate(el => getComputedStyle(el).display === 'none')) {
        throw new Error('3D Lightbox smoke fixture card is still hidden.');
      }

      await modelCard.scrollIntoViewIfNeeded();
      await modelCard.click();
      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });

      const modelShell = page.locator('#lightbox .lightbox-model-viewer').first();
      await modelShell.waitFor({ state: 'visible', timeout: 7000 });

      const activationBeforeReady = modelShell.locator('.model-viewer-activate-content').first();
      await activationBeforeReady.waitFor({ state: 'visible', timeout: 3000 });

      await page.locator('#lightbox .lightbox-model-viewer[data-ready="true"]').waitFor({ state: 'visible', timeout: 10000 });

      const lottieCaption = page.locator('#lightboxMediaContainer .lightbox-media-item lottie-player').first()
        .locator('xpath=..').locator('xpath=..').locator('.media-caption').first();
      if (await lottieCaption.count() === 1) {
        const captionBackground = await lottieCaption.evaluate(el => getComputedStyle(el).backgroundColor);
        if (captionBackground !== 'rgba(0, 0, 0, 0)' && captionBackground !== 'transparent') {
          throw new Error(`Lottie caption inherited an artwork background: ${captionBackground}`);
        }
      }

      const modelActivate = modelShell.locator('.model-viewer-activate-content').first();
      if (await modelActivate.count() !== 1 || !(await modelActivate.isVisible().catch(() => false))) {
        throw new Error('3D Lightbox did not expose its Click for 3D View activation affordance.');
      }
      const activationLabel = await modelActivate.textContent();
      if (activationLabel?.trim().toUpperCase() !== 'CLICK FOR 3D VIEW') {
        throw new Error(`Unexpected 3D activation label: ${activationLabel}`);
      }

      const layerOrder = await modelShell.evaluate(el => {
        const read = selector => {
          const node = el.querySelector(selector);
          const style = node ? getComputedStyle(node) : null;
          return style ? {
            zIndex: style.zIndex,
            position: style.position
          } : null;
        };
        return {
          background: read(':scope > .lm-media-background-layer'),
          canvas: read(':scope > canvas'),
          activation: read(':scope > .model-viewer-activate'),
          ui: read(':scope > .model-viewer-ui')
        };
      });
      if (layerOrder.background?.zIndex !== '0' ||
          layerOrder.canvas?.zIndex !== '2' ||
          layerOrder.activation?.zIndex !== '3' ||
          layerOrder.ui?.zIndex !== '4') {
        throw new Error(`Unexpected 3D layer order: ${JSON.stringify(layerOrder)}`);
      }
      if (layerOrder.activation?.position !== 'absolute' || layerOrder.canvas?.position !== 'absolute') {
        throw new Error(`3D overlay/canvas positioning is not explicit: ${JSON.stringify(layerOrder)}`);
      }

      await modelShell.click();
      await page.locator('#lightbox .lightbox-model-viewer.is-interactive').waitFor({ state: 'visible', timeout: 3000 });

      const modelBack = page.locator('#lightbox .model-viewer-back').first();
      if (await modelBack.isVisible().catch(() => false) !== true) {
        throw new Error('3D interactive mode did not expose its Back control.');
      }

      try {
        await page.waitForFunction(() => {
          const el = document.querySelector('#lightbox .lightbox-model-viewer.is-interactive');
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return Math.abs(r.width - innerWidth) <= 2 &&
            Math.abs(r.height - innerHeight) <= 2;
        }, null, { timeout: 1500 });
      } catch (error) {
        const debug = await page.evaluate(() => {
          const el = document.querySelector('#lightbox .lightbox-model-viewer.is-interactive');
          const chain = [];
          let node = el;
          while (node && chain.length < 8) {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            chain.push({
              tag: node.tagName,
              id: node.id || '',
              className: node.className || '',
              position: style.position,
              transform: style.transform,
              filter: style.filter,
              backdropFilter: style.backdropFilter,
              contain: style.contain,
              willChange: style.willChange,
              overflow: style.overflow,
              rect: {
                x: Math.round(rect.x * 100) / 100,
                y: Math.round(rect.y * 100) / 100,
                width: Math.round(rect.width * 100) / 100,
                height: Math.round(rect.height * 100) / 100
              }
            });
            node = node.parentElement;
          }
          const viewport = { width: innerWidth, height: innerHeight };
          return { viewport, chain };
        });
        throw new Error(
          `Focused 3D geometry did not settle to viewport: ${JSON.stringify(debug)}; original=${error.message}`
        );
      }

      const focusedModelGeometry = await modelShell.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const focusedViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      if (
        Math.abs(focusedModelGeometry.width - focusedViewport.width) > 2 ||
        Math.abs(focusedModelGeometry.height - focusedViewport.height) > 2
      ) {
        throw new Error(
          `Focused 3D viewer did not occupy the viewport (${focusedModelGeometry.width}x${focusedModelGeometry.height} vs ${focusedViewport.width}x${focusedViewport.height}).`
        );
      }

      const focusedCloseBackground = await page.locator('#lightboxClose').evaluate(
        el => getComputedStyle(el).backgroundColor
      );
      const focusedCloseContrast = await page.locator('#lightboxClose').evaluate(el => {
        const style = getComputedStyle(el);
        return { mixBlendMode: style.mixBlendMode, background: style.backgroundColor };
      });
      if (focusedCloseContrast.mixBlendMode !== 'normal') {
        throw new Error(`Lightbox Close control still uses blend compositing: ${focusedCloseContrast.mixBlendMode}`);
      }
      if (focusedCloseBackground !== 'rgba(0, 0, 0, 0)' && focusedCloseBackground !== 'transparent') {
        throw new Error('Focused 3D Close control still has a visible background box.');
      }

      const backFocused = await modelBack.evaluate(el => document.activeElement === el);
      if (!backFocused) throw new Error('3D activation did not move keyboard focus to the Back control.');

      // Focused 3D mode must remain viewport-bound when a responsive browser
      // changes dimensions while the viewer is already active. This catches
      // fixed-position/ResizeObserver regressions without altering the grid.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => {
        const el = document.querySelector('#lightbox .lightbox-model-viewer.is-interactive');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return Math.abs(r.width - innerWidth) <= 2 && Math.abs(r.height - innerHeight) <= 2;
      }, null, { timeout: 1500 });
      const focusedMobileGeometry = await modelShell.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height };
      });
      const focusedMobileViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      if (
        Math.abs(focusedMobileGeometry.width - focusedMobileViewport.width) > 2 ||
        Math.abs(focusedMobileGeometry.height - focusedMobileViewport.height) > 2
      ) {
        throw new Error(
          `Focused 3D viewer broke across desktop-to-mobile resize (${focusedMobileGeometry.width}x${focusedMobileGeometry.height} vs ${focusedMobileViewport.width}x${focusedMobileViewport.height}).`
        );
      }

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForFunction(() => {
        const el = document.querySelector('#lightbox .lightbox-model-viewer.is-interactive');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return Math.abs(r.width - innerWidth) <= 2 && Math.abs(r.height - innerHeight) <= 2;
      }, null, { timeout: 1500 });

      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      const interactiveAfterEscape = await modelShell.evaluate(el => el.classList.contains('is-interactive'));
      if (interactiveAfterEscape) throw new Error('Escape did not exit interactive 3D mode.');

      await page.locator('#lightboxClose').click();
      await page.waitForTimeout(100);
    });

    await smokePage(browser, '/', async page => {
      const gridBeforeResize = page.locator('#portfolioGrid').first();
      const galleryViewport = page.locator('#portfolioGridViewport').first();
      const desktopCards = await page.locator('#portfolioGrid .project-card').evaluateAll(
        cards => cards.filter(card => getComputedStyle(card).display !== 'none').length
      );
      if (desktopCards < 9) throw new Error(`Desktop resize fixture rendered too few projects (found ${desktopCards}).`);

      // Every project card is intentionally square. Intrinsic thumbnail
      // dimensions must never change the grid row or card footprint.
      const desktopCardRatios = await page.locator('#portfolioGrid .project-card').evaluateAll(cards =>
        cards
          .filter(card => getComputedStyle(card).display !== 'none')
          .map(card => {
            const rect = card.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 0;
          })
      );
      desktopCardRatios.forEach(ratio => {
        if (!ratio || Math.abs(ratio - 1) > 0.035) {
          throw new Error('Desktop project card is not square: ratio=' + ratio.toFixed(3) + '.');
        }
      });

      const desktopGridGeometry = await page.locator('#portfolioGrid').evaluate(grid => {
        const style = getComputedStyle(grid);
        const cards = Array.from(grid.querySelectorAll('.project-card'))
          .filter(card => getComputedStyle(card).display !== 'none')
          .slice(0, 3)
          .map(card => {
            const rect = card.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width };
          });
        return {
          templateColumns: style.gridTemplateColumns,
          cards,
          width: grid.getBoundingClientRect().width
        };
      });
      const desktopColumns = desktopGridGeometry.templateColumns.trim().split(/\s+/).filter(Boolean).length;
      if (desktopColumns !== 3 || desktopGridGeometry.cards.length < 3) {
        throw new Error(
          `Desktop project grid no longer exposes three equal tracks: ${JSON.stringify(desktopGridGeometry)}`
        );
      }
      const desktopWidths = desktopGridGeometry.cards.map(card => card.width);
      if (Math.max(...desktopWidths) - Math.min(...desktopWidths) > 2) {
        throw new Error(`Desktop project grid columns are not equal width: ${JSON.stringify(desktopGridGeometry)}`);
      }

      // Current portfolio has 11 projects. The new presentation contract
      // intentionally shows 9–15 projects without Show More on desktop.
      const desktopShowMore = page.locator('#showMoreBtn').first();
      if (desktopCards <= 15 && await desktopShowMore.isVisible().catch(() => false)) {
        throw new Error('Desktop Show More appeared even though the project count is within the all-visible threshold.');
      }

      await page.setViewportSize({ width: 1024, height: 768 });
      await page.waitForTimeout(500);
      const tabletGridGeometry = await page.locator('#portfolioGrid').evaluate(grid => {
        const style = getComputedStyle(grid);
        const cards = Array.from(grid.querySelectorAll('.project-card'))
          .filter(card => getComputedStyle(card).display !== 'none')
          .slice(0, 3)
          .map(card => {
            const rect = card.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width };
          });
        return { templateColumns: style.gridTemplateColumns, cards };
      });
      const tabletColumns = tabletGridGeometry.templateColumns.trim().split(/\s+/).filter(Boolean).length;
      if (tabletColumns !== 3 || tabletGridGeometry.cards.length < 3) {
        throw new Error(`Tablet project grid did not preserve three tracks: ${JSON.stringify(tabletGridGeometry)}`);
      }
      const tabletWidths = tabletGridGeometry.cards.map(card => card.width);
      if (Math.max(...tabletWidths) - Math.min(...tabletWidths) > 2) {
        throw new Error(`Tablet project grid columns are not equal width: ${JSON.stringify(tabletGridGeometry)}`);
      }

      const tabletCardRatios = await page.locator('#portfolioGrid .project-card').evaluateAll(cards =>
        cards
          .filter(card => getComputedStyle(card).display !== 'none')
          .map(card => {
            const rect = card.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 0;
          })
      );
      tabletCardRatios.forEach(ratio => {
        if (!ratio || Math.abs(ratio - 1) > 0.035) {
          throw new Error('Tablet project card is not square: ratio=' + ratio.toFixed(3) + '.');
        }
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(500);

      const showMoreAfterResize = page.locator('#showMoreBtn').first();
      const mobileCollapsedState = await galleryViewport.evaluate(el => {
        const style = getComputedStyle(el);
        return { maxHeight: style.maxHeight, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight };
      });
      const mobileCardsInDom = await page.locator('#portfolioGrid .project-card').count();
      if (mobileCardsInDom !== 11) throw new Error(`Mobile smoke fixture unexpectedly changed project count (found ${mobileCardsInDom}).`);

      const mobileCardGeometry = await page.locator('#portfolioGrid .project-card').evaluateAll(cards =>
        cards
          .filter(card => getComputedStyle(card).display !== 'none')
          .map(card => {
            const rect = card.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 0;
          })
      );
      mobileCardGeometry.forEach(ratio => {
        if (!ratio || Math.abs(ratio - 1) > 0.035) {
          throw new Error(`Mobile project card is no longer square after responsive resize: ratio=${ratio.toFixed(3)}.`);
        }
      });

      if (mobileCollapsedState.maxHeight === 'none' || mobileCollapsedState.scrollHeight <= mobileCollapsedState.clientHeight) {
        throw new Error('Desktop-to-mobile resize did not restore the mobile collapsed gallery viewport.');
      }
      if (!(await showMoreAfterResize.isVisible().catch(() => false))) {
        throw new Error('Desktop-to-mobile resize did not restore the mobile Show More control.');
      }

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(500);
      const desktopRestoredCards = await page.locator('#portfolioGrid .project-card').evaluateAll(
        cards => cards.filter(card => getComputedStyle(card).display !== 'none').length
      );
      if (desktopRestoredCards !== 11) {
        throw new Error(`Mobile-to-desktop resize should restore all 11 current projects (found ${desktopRestoredCards}).`);
      }
      if (await page.locator('#showMoreBtn').first().isVisible().catch(() => false)) {
        throw new Error('Mobile-to-desktop resize incorrectly restored a desktop Show More control for 11 projects.');
      }
    }, { width: 1280, height: 900 });

    await smokePage(browser, '/', async page => {
      const card = page.locator('#portfolioGrid .project-card[data-project-id="youtube-multi-smoke"]').first();
      if (await card.count() !== 1) throw new Error('Multi-media YouTube smoke fixture card is missing.');
      await card.click();
      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });

      const container = page.locator('#lightboxMediaContainer').first();
      const density = await container.getAttribute('data-media-density');
      const hasYouTube = await container.getAttribute('data-has-youtube');
      if (density !== 'multi' || hasYouTube !== 'true') {
        throw new Error(`Multi-media YouTube Lightbox contract is wrong: density=${density}, hasYouTube=${hasYouTube}`);
      }

      const mediaItems = page.locator('#lightboxMediaContainer .lightbox-media-item');
      if (await mediaItems.count() !== 3) throw new Error('Multi-media YouTube fixture did not render all three media items.');

      const youtubeArtworks = page.locator('#lightboxMediaContainer .lightbox-artwork.is-youtube-artwork');
      if (await youtubeArtworks.count() !== 2) throw new Error('Multi-media YouTube fixture did not render two YouTube artwork surfaces.');

      const youtubeGeometry = await youtubeArtworks.evaluateAll(nodes => nodes.map(el => {
        const rect = el.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          orientation: el.getAttribute('data-youtube-orientation'),
          ratio: parseFloat(getComputedStyle(el).aspectRatio || '0')
        };
      }));
      if (youtubeGeometry.some(item => item.height > 482 || item.width <= 0 || item.height <= 0)) {
        throw new Error(`Multi-media YouTube artwork was allowed to dominate desktop height: ${JSON.stringify(youtubeGeometry)}`);
      }
      const portrait = youtubeGeometry.find(item => item.orientation === 'portrait');
      const landscape = youtubeGeometry.find(item => item.orientation === 'landscape');
      if (!portrait || !landscape) throw new Error(`YouTube orientation classification is incomplete: ${JSON.stringify(youtubeGeometry)}`);
      if (portrait.width >= landscape.width) {
        throw new Error(`YouTube Shorts did not retain portrait geometry: ${JSON.stringify(youtubeGeometry)}`);
      }

      await page.locator('#lightboxClose').click();
      await page.waitForTimeout(100);
    }, { width: 1280, height: 900 }, async page => {
      const fixture = [{
        id: 'youtube-multi-smoke',
        title: 'YouTube Multi Smoke',
        subtitle: 'Desktop composition fixture',
        badge: '',
        filters: [],
        description: '',
        thumbnail: {
          type: 'image',
          src: 'assets/projects/site/favicon.png',
          focus: '50% 50%',
          zoom: 1
        },
        media: [
          { type: 'youtube', src: 'https://www.youtube.com/shorts/abcdefghijk', caption: 'Short fixture', orientation: '' },
          { type: 'youtube', src: 'https://www.youtube.com/watch?v=lmnopqrstuv', caption: 'Landscape fixture', orientation: 'landscape' },
          { type: 'image', src: 'assets/projects/site/favicon.png', caption: 'Image fixture', orientation: 'square' }
        ]
      }];
      await page.route(`${BASE_URL}/data/projects.json**`, async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(fixture)
        });
      });
      await page.route('https://www.youtube.com/embed/**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><body><div id="player">YouTube smoke player</div></body></html>'
        });
      });
    });

    await smokePage(browser, '/', async page => {
      const transition = page.locator('#pageTransition').first();
      const logo = page.locator('#pageTransition .page-transition-logo').first();
      if (await transition.count() !== 1 || await logo.count() !== 1) {
        throw new Error('Portfolio loading screen is missing its original branded logo surface.');
      }
      if (await page.locator('#pageTransitionStatus').count() !== 0) {
        throw new Error('Portfolio loading screen still exposes status text.');
      }
      if (await page.locator('#pageTransitionProgress').count() !== 0) {
        throw new Error('Portfolio loading screen still exposes a progress bar.');
      }
      const loadingState = await transition.getAttribute('data-loading');
      if (loadingState !== 'ready' || await transition.isVisible().catch(() => true)) {
        throw new Error('Portfolio loading screen did not hand off cleanly after application readiness.');
      }
      const bodyBusy = await page.locator('body').getAttribute('aria-busy');
      if (bodyBusy !== 'false') throw new Error('Portfolio body did not clear aria-busy after startup readiness.');
    }, { width: 1280, height: 900 });

    await smokePage(browser, '/', async page => {
      await assertMobileNavigation(page, 'Works page');
      const filters = page.locator('.filter-tabs .filter-btn, .filter-tabs .tab-btn');
      if (await filters.count() < 2) throw new Error('Mobile/tablet Works filter UI did not render.');

      const allFilter = page.locator('.filter-tabs [data-filter="all"]');
      if (await allFilter.count() !== 1) throw new Error('Mobile/tablet Works filter UI is missing ALL.');

      const heroText = await page.locator('#heroQuoteText').textContent().catch(() => '');
      if (!heroText?.trim()) throw new Error('Mobile/tablet Works Hero message is missing.');

      const galleryBox = await page.locator('#portfolioGrid').boundingBox();
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      if (!galleryBox || Math.abs(galleryBox.x) > 2 || Math.abs(galleryBox.width - viewportWidth) > 2) {
        throw new Error('Mobile Works gallery did not become full-bleed.');
      }

      const firstRowBoxes = await page.locator('#portfolioGrid .project-card').evaluateAll(cards => cards.slice(0, 2).map(card => {
        const r = card.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width };
      }));
      if (
        firstRowBoxes.length < 2 ||
        Math.abs(firstRowBoxes[0].y - firstRowBoxes[1].y) > 2 ||
        Math.abs(firstRowBoxes[0].x - firstRowBoxes[1].x) < 2 ||
        Math.abs(firstRowBoxes[0].width - firstRowBoxes[1].width) > 2
      ) {
        throw new Error('Mobile Works gallery did not render its first row as two equal columns.');
      }

      const mobileCardMotion = await page.locator('#portfolioGrid .project-card').first().evaluate(el => {
        const style = getComputedStyle(el);
        return {
          transition: style.transition,
          filter: style.filter,
          transform: style.transform
        };
      });
      if (!/transform/i.test(mobileCardMotion.transition) || !/filter/i.test(mobileCardMotion.transition)) {
        throw new Error(`Mobile project cards lost the depth/blur filter transition contract: ${mobileCardMotion.transition}`);
      }

      const mobileShowMore = page.locator('#showMoreBtn').first();
      if (await mobileShowMore.isVisible().catch(() => false)) {
        const collapsedGeometry = await page.evaluate(() => {
          const grid = document.querySelector('#portfolioGrid')?.getBoundingClientRect();
          const wrapper = document.querySelector('#showMoreWrapper')?.getBoundingClientRect();
          return grid && wrapper ? { gridTop: grid.top, wrapperTop: wrapper.top } : null;
        });
        if (!collapsedGeometry || collapsedGeometry.wrapperTop < collapsedGeometry.gridTop - 2) {
          throw new Error('Mobile Show More control escaped above the gallery in its collapsed state.');
        }

        await mobileShowMore.click();
        await page.waitForTimeout(350);
        const expanded = await page.locator('#portfolioGridViewport').evaluate(el => getComputedStyle(el).maxHeight === 'none');
        const expandedLabel = await mobileShowMore.locator('.btn-text').textContent().catch(() => '');
        const expandedGeometry = await page.evaluate(() => {
          const grid = document.querySelector('#portfolioGrid')?.getBoundingClientRect();
          const wrapper = document.querySelector('#showMoreWrapper')?.getBoundingClientRect();
          return grid && wrapper ? { gridBottom: grid.bottom, wrapperTop: wrapper.top } : null;
        });
        if (!expanded || expandedLabel?.trim().toUpperCase() !== 'SHOW LESS') {
          throw new Error('Mobile Show More did not expand the full-bleed two-column gallery.');
        }
        if (!expandedGeometry || expandedGeometry.wrapperTop < expandedGeometry.gridBottom - 2) {
          throw new Error('Expanded Show More control is still overlapping the gallery.');
        }

        await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
        await page.waitForTimeout(150);
        const preservedAfterPageShow = await page.locator('#portfolioGridViewport').evaluate(el => ({
          maxHeight: getComputedStyle(el).maxHeight,
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight
        }));
        const preservedLabel = await mobileShowMore.locator('.btn-text').textContent().catch(() => '');
        if (
          preservedAfterPageShow.maxHeight !== 'none' ||
          preservedAfterPageShow.clientHeight < preservedAfterPageShow.scrollHeight ||
          preservedLabel?.trim().toUpperCase() !== 'SHOW LESS'
        ) {
          throw new Error('Mobile Show More collapsed unexpectedly after a pageshow lifecycle event.');
        }

        await page.setViewportSize({ width: 375, height: 844 });
        await page.waitForTimeout(250);
        const preservedAfterResize = await page.locator('#portfolioGridViewport').evaluate(el => getComputedStyle(el).maxHeight);
        const resizeLabel = await mobileShowMore.locator('.btn-text').textContent().catch(() => '');
        if (preservedAfterResize !== 'none' || resizeLabel?.trim().toUpperCase() !== 'SHOW LESS') {
          throw new Error('Mobile Show More collapsed unexpectedly while remaining in an overflowing viewport.');
        }

        await mobileShowMore.click();
        await page.waitForTimeout(350);
        const collapsed = await page.locator('#portfolioGridViewport').evaluate(el => {
          const style = getComputedStyle(el);
          return style.maxHeight !== 'none' && el.scrollHeight > el.clientHeight;
        });
        const collapsedLabel = await mobileShowMore.locator('.btn-text').textContent().catch(() => '');
        if (!collapsed || collapsedLabel?.trim().toUpperCase() !== 'SHOW MORE') {
          throw new Error('Mobile Show Less did not restore the collapsed gallery state.');
        }

        await mobileShowMore.click();
        await page.waitForTimeout(350);
        if ((await mobileShowMore.locator('.btn-text').textContent()).trim().toUpperCase() !== 'SHOW LESS') {
          throw new Error('Show More did not enter the stable expanded state before Lightbox regression test.');
        }

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(250);
        const afterPlainScrollViewport = await page.locator('#portfolioGridViewport').evaluate(el => getComputedStyle(el).maxHeight);
        const afterPlainScrollLabel = (await mobileShowMore.locator('.btn-text').textContent()).trim().toUpperCase();
        if (afterPlainScrollViewport !== 'none' || afterPlainScrollLabel !== 'SHOW LESS') {
          throw new Error('Show Less reverted or re-clipped while scrolling through the expanded gallery.');
        }

        await page.locator('#portfolioGrid .project-card').first().click();
        await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });
        await page.locator('#lightboxClose').click();
        await page.waitForTimeout(150);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(250);

        const afterLightboxClose = await page.locator('#portfolioGridViewport').evaluate(el => ({
          maxHeight: getComputedStyle(el).maxHeight,
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight
        }));
        const afterLightboxLabel = (await mobileShowMore.locator('.btn-text').textContent()).trim().toUpperCase();
        if (afterLightboxClose.maxHeight !== 'none' || afterLightboxLabel !== 'SHOW LESS') {
          throw new Error('Show Less reverted to Show More after closing Lightbox and scrolling.');
        }
      }

      const firstCard = page.locator('#portfolioGrid .project-card').first();
      await firstCard.click();
      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });

      const firstArtwork = page.locator('#lightboxMediaContainer .lightbox-media-item img').first();
      if (await firstArtwork.count() !== 1) throw new Error('Mobile Lightbox did not render the first artwork as an image.');
      if (await firstArtwork.getAttribute('loading') !== 'eager') {
        throw new Error('First Lightbox artwork should load eagerly to avoid a blank opening state.');
      }
      const imageLoadingModes = await page.locator('#lightboxMediaContainer img').evaluateAll(images => images.map(image => image.loading));
      if (imageLoadingModes[0] !== 'eager') {
        throw new Error('First Lightbox artwork must load eagerly to avoid a blank opening state.');
      }
      if (imageLoadingModes.slice(1).some(mode => mode !== 'lazy')) {
        throw new Error('Secondary Lightbox images must remain deferred to preserve progressive loading.');
      }

      const artworkAlt = await firstArtwork.getAttribute('alt');
      if (!artworkAlt?.trim()) throw new Error('Mobile Lightbox image is missing accessible alt text.');

      const artworkRatioVariable = await firstArtwork.evaluate(el => {
        const surface = el.closest('.lightbox-artwork');
        return surface ? getComputedStyle(surface).getPropertyValue('--lightbox-artwork-ratio').trim() : '';
      });
      if (!artworkRatioVariable) {
        throw new Error('Lightbox artwork surface did not receive its intrinsic ratio token.');
      }

      const lightboxControlStyles = await page.evaluate(() =>
        ['#lightboxClose', '.lightbox-prev', '.lightbox-next'].map(selector => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const style = getComputedStyle(el);
          return {
            selector,
            blend: style.mixBlendMode,
            background: style.backgroundColor,
            borderStyle: style.borderStyle
          };
        }).filter(Boolean)
      );
      for (const control of lightboxControlStyles) {
        if (control.blend !== 'normal') throw new Error(control.selector + ' still uses Lightbox blend-mode contrast.');
        if (control.background !== 'rgba(0, 0, 0, 0)' || control.borderStyle !== 'none') {
          throw new Error(control.selector + ' still renders a visible control box over artwork.');
        }
      }

      const lightboxViewportWidth = await page.evaluate(() => window.innerWidth);
      const artworkWidth = await firstArtwork.evaluate(el => Math.round(el.getBoundingClientRect().width));
      if (Math.abs(artworkWidth - lightboxViewportWidth) > 2) {
        throw new Error(`Mobile Lightbox artwork is not full-bleed (artwork ${artworkWidth}px vs viewport ${lightboxViewportWidth}px).`);
      }

      const renderedArtworkWidths = await page.locator('#lightboxMediaContainer .lightbox-media-item img').evaluateAll(
        images => images.map(image => Math.round(image.getBoundingClientRect().width)).filter(width => width > 0)
      );
      if (renderedArtworkWidths.some(width => Math.abs(width - lightboxViewportWidth) > 2)) {
        throw new Error(`Mobile Lightbox contains a non-full-bleed artwork width: ${renderedArtworkWidths.join(', ')} vs viewport ${lightboxViewportWidth}px.`);
      }

      // Close the inspection Lightbox before starting the separate scroll
      // restoration regression check below.
      await page.locator('#lightboxClose').click();
      await page.waitForTimeout(120);

      await page.evaluate(() => {
        const root = document.documentElement;
        root.dataset.smokePreviousScrollBehavior = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        const max = Math.max(0, root.scrollHeight - window.innerHeight);
        window.scrollTo({
          top: Math.max(0, Math.min(max, Math.round(max * 0.55))),
          behavior: 'auto'
        });
      });
      await page.waitForTimeout(80);
      const scrollBeforeLightboxClose = await page.evaluate(() => window.scrollY);
      await page.evaluate(() => {
        const card = document.querySelector('#portfolioGrid .project-card');
        if (!card) throw new Error('No project card available for Lightbox scroll regression.');
        card.focus({ preventScroll: true });
        card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      });
      const scrollImmediatelyAfterOpen = await page.evaluate(() => window.scrollY);
      await page.waitForTimeout(16);
      const scrollAfterOpenFrame = await page.evaluate(() => window.scrollY);
      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });
      const scrollWhileLightboxOpen = await page.evaluate(() => window.scrollY);
      await page.waitForTimeout(104);
      const scrollAfterOpenSettled = await page.evaluate(() => window.scrollY);
      if (Math.abs(scrollAfterOpenSettled - scrollBeforeLightboxClose) > 4) {
        const debug = await page.locator('#lightbox').evaluate(el => ({
          saved: el.dataset.debugSavedPageScroll || '',
          active: el.classList.contains('active')
        }));
        throw new Error(`Opening Lightbox changed document scroll position (${scrollBeforeLightboxClose} -> immediate ${scrollImmediatelyAfterOpen} -> frame ${scrollAfterOpenFrame} -> visible ${scrollWhileLightboxOpen} -> settled ${scrollAfterOpenSettled}); debug saved=${debug.saved} active=${debug.active}.`);
      }
      await page.evaluate(() => {
        const close = document.querySelector('#lightboxClose');
        if (!close) throw new Error('Lightbox close control is missing.');
        close.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      });
      await page.locator('#lightbox.active').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      await page.evaluate(() => {
        const root = document.documentElement;
        root.style.scrollBehavior = root.dataset.smokePreviousScrollBehavior || '';
        delete root.dataset.smokePreviousScrollBehavior;
      });
      const scrollImmediatelyAfterLightboxClose = await page.evaluate(() => window.scrollY);
      await page.waitForTimeout(16);
      const scrollAfterLightboxFrame = await page.evaluate(() => window.scrollY);
      await page.waitForTimeout(104);
      const scrollAfterLightboxClose = await page.evaluate(() => window.scrollY);
      if (Math.abs(scrollAfterLightboxClose - scrollBeforeLightboxClose) > 4) {
        const debug = await page.locator('#lightbox').evaluate(el => ({
          saved: el.dataset.debugSavedPageScroll || '',
          close: el.dataset.debugCloseScroll || ''
        }));
        throw new Error(`Lightbox close changed document scroll position (${scrollBeforeLightboxClose} -> immediate ${scrollImmediatelyAfterLightboxClose} -> frame ${scrollAfterLightboxFrame} -> settled ${scrollAfterLightboxClose}); debug saved=${debug.saved} close=${debug.close}.`);
      }

      // A persisted history snapshot must not resurrect the Lightbox with
      // stale WebGL/YouTube state. Exercise both lifecycle edges explicitly;
      // browser back/forward coverage below also exercises real navigation.
      await page.evaluate(() => {
        const card = document.querySelector('#portfolioGrid .project-card');
        if (!card) throw new Error('No project card available for BFCache Lightbox regression.');
        card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      });
      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });
      await page.evaluate(() => {
        const event = new Event('pagehide');
        Object.defineProperty(event, 'persisted', { value: true });
        window.dispatchEvent(event);
      });
      await page.locator('#lightbox.active').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      if (await page.locator('#lightbox.active').count() !== 0) {
        throw new Error('Persisted pagehide did not close the active Lightbox.');
      }

      await page.evaluate(() => {
        const card = document.querySelector('#portfolioGrid .project-card');
        if (!card) throw new Error('No project card available after BFCache pagehide cleanup.');
        card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      });
      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });
      await page.evaluate(() => {
        const event = new Event('pageshow');
        Object.defineProperty(event, 'persisted', { value: true });
        window.dispatchEvent(event);
      });
      await page.locator('#lightbox.active').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      if (await page.locator('#lightbox.active').count() !== 0) {
        throw new Error('Persisted pageshow did not close a resurrected Lightbox.');
      }

      // Simulate browser back/forward navigation so the gallery gets a
      // pageshow event with potentially restored layout state.
      await page.goto(`${BASE_URL}/about/`);
      await page.goBack();
      await page.locator('#portfolioGrid .project-card').first().waitFor({ state: 'visible', timeout: 3000 });
      const reentryBox = await page.locator('#portfolioGrid').boundingBox();
      const reentryHeight = await page.locator('#portfolioGrid').evaluate(el => {
        const rect = el.getBoundingClientRect();
        return { height: rect.height, maxHeight: getComputedStyle(el).maxHeight };
      });
      if (!reentryBox || reentryHeight.height < 150) {
        throw new Error('Works gallery collapsed on page re-entry.');
      }
    }, { width: 390, height: 844 });

    await smokePage(browser, '/', async page => {
      const playbackCard = page.locator('#portfolioGrid .project-card[data-project-id="haeru"]').first();
      if (await playbackCard.count() !== 1) throw new Error('Haeru playback smoke fixture card is missing.');

      await playbackCard.click();
      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });

      const videos = page.locator('#lightboxMediaContainer video');
      if (await videos.count() >= 2) {
        const handoffWorked = await page.evaluate(() => {
          const nodes = Array.from(document.querySelectorAll('#lightboxMediaContainer video'));
          const originalPause = HTMLMediaElement.prototype.pause;
          const pauseTargets = [];
          HTMLMediaElement.prototype.pause = function(){ pauseTargets.push(this); };
          try {
            nodes[0].dispatchEvent(new Event('play', { bubbles: true }));
            nodes[1].dispatchEvent(new Event('play', { bubbles: true }));
          } finally {
            HTMLMediaElement.prototype.pause = originalPause;
          }
          return pauseTargets.includes(nodes[0]);
        });
        if (!handoffWorked) throw new Error('Starting a second local video did not pause the previous video.');
      }

      const youtubeFrames = page.locator('#lightboxMediaContainer iframe[data-lm-youtube]');
      if (await youtubeFrames.count()) {
        const src = await youtubeFrames.first().getAttribute('src');
        if (!src?.includes('enablejsapi=1')) {
          throw new Error('YouTube Lightbox embeds are missing the JS API needed for playback handoff.');
        }
        const youtubePointerEvents = await youtubeFrames.first().evaluate(el => getComputedStyle(el).pointerEvents);
        if (youtubePointerEvents === 'none') {
          throw new Error('Desktop YouTube Lightbox iframe is not pointer-interactive.');
        }

        const youtubeApiReady = await youtubeFrames.first().getAttribute('data-lm-youtube-api');
        if (youtubeApiReady !== 'ready') {
          throw new Error('YouTube Lightbox did not initialize its playback-state handoff listener.');
        }

        if (await youtubeFrames.count() >= 2) {
          const handoff = await page.evaluate(() => {
            const frames = Array.from(document.querySelectorAll('#lightboxMediaContainer iframe[data-lm-youtube]'));
            const active = frames[1];
            window.dispatchEvent(new MessageEvent('message', {
              origin: 'https://www.youtube.com',
              source: active.contentWindow,
              data: JSON.stringify({ event: 'onStateChange', info: 1 })
            }));
            return {
              activeState: active.dataset.lmYoutubeState || '',
              previousPauseRequested: frames[0].dataset.lmYoutubePauseRequested || ''
            };
          });
          if (handoff.activeState !== 'playing' || !handoff.previousPauseRequested) {
            throw new Error('YouTube playing-state handoff did not pause the previous player after repeated playback.');
          }
        }
      }

      if (youtubeFrames.count && await youtubeFrames.count()) {
        const cachedFrame = youtubeFrames.first();
        await cachedFrame.evaluate(el => { el.dataset.smokeReuseToken = 'youtube-cache-reuse'; });

        await page.locator('#lightboxClose').click();
        await page.locator('#lightbox.active').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
        const preloadTabIndex = await page.locator('.lightbox-youtube-preload-root iframe[data-lm-youtube]').first()
          .getAttribute('tabindex');
        if (preloadTabIndex !== '-1') {
          throw new Error('Hidden cached YouTube iframe remained keyboard-focusable after closing the Lightbox.');
        }
        await playbackCard.click();
        await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });

        const reopenedFrame = page.locator('#lightboxMediaContainer iframe[data-lm-youtube]').first();
        const reuseToken = await reopenedFrame.getAttribute('data-smoke-reuse-token');
        if (reuseToken !== 'youtube-cache-reuse') {
          throw new Error('Closing and reopening the Lightbox did not reuse the successfully loaded YouTube iframe cache entry.');
        }
      }

      if (await videos.count()) {
        const primaryMedia = page.locator('#lightboxMediaContainer .lightbox-media-item').first();
        const primaryImage = primaryMedia.locator('img').first();
        if (await primaryImage.count()) {
          const primaryLoading = await primaryImage.getAttribute('loading');
          const primaryPriority = await primaryImage.getAttribute('fetchpriority');
          if (primaryLoading !== 'eager' || primaryPriority !== 'high') {
            throw new Error('Lightbox primary media is not prioritized for immediate playback/display.');
          }
        }

        const preloadMode = await videos.first().getAttribute('preload');
        if (preloadMode !== 'metadata') {
          throw new Error('Lightbox secondary local video should use metadata preload under progressive loading.');
        }
        const firstVideo = videos.first();
        const intrinsicRatio = await firstVideo.evaluate(video => {
          Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => 720 });
          Object.defineProperty(video, 'videoHeight', { configurable: true, get: () => 1280 });
          video.dispatchEvent(new Event('loadedmetadata'));
          return {
            videoRatio: video.style.aspectRatio,
            artworkRatio: video.closest('.lightbox-media-item')?.querySelector('.lightbox-artwork')?.style.aspectRatio || ''
          };
        });
        if (!intrinsicRatio.videoRatio.includes('720') || !intrinsicRatio.videoRatio.includes('1280')) {
          throw new Error('Local video did not preserve its intrinsic aspect ratio.');
        }
        if (!intrinsicRatio.artworkRatio.includes('720') || !intrinsicRatio.artworkRatio.includes('1280')) {
          throw new Error('Local video artwork surface did not preserve its intrinsic aspect ratio.');
        }
      }

      await page.locator('#lightboxClose').click();
      await page.waitForTimeout(100);
    }, { width: 1280, height: 900 });

    await smokePage(browser, '/', async page => {
      const navigationCard = page.locator('#portfolioGrid .project-card[data-project-id="haeru"]').first();
      if (await navigationCard.count() !== 1) throw new Error('Lightbox rapid-navigation fixture card is missing.');

      await navigationCard.click();
      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });
      const previous = page.locator('.lightbox-prev').first();
      const next = page.locator('.lightbox-next').first();
      const close = page.locator('#lightboxClose').first();

      for (let i = 0; i < 4; i += 1) {
        await next.click();
        await page.waitForTimeout(80);
        await previous.click();
        await page.waitForTimeout(80);
      }

      const mediaItems = await page.locator('#lightboxMediaContainer .lightbox-media-item').count();
      if (mediaItems !== 11) {
        throw new Error(`Rapid Lightbox navigation produced ${mediaItems} media entries instead of the 11-item Haeru project.`);
      }

      const youtubePlayers = await page.locator('#lightboxMediaContainer iframe[data-lm-youtube]').count();
      if (youtubePlayers !== 0) {
        throw new Error('Rapid navigation left YouTube players mounted in a project that contains no YouTube media.');
      }

      const imageCount = await page.locator('#lightboxMediaContainer img').count();
      if (imageCount !== 9) {
        throw new Error(`Rapid navigation left an unexpected image count in Haeru (${imageCount}).`);
      }

      await close.click();
      await page.locator('#lightbox.active').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

      const mediaAfterClose = await page.locator('#lightboxMediaContainer .lightbox-media-item').count();
      if (mediaAfterClose !== 0) throw new Error('Lightbox media container retained stale entries after rapid navigation and close.');

      await navigationCard.click();
      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });
      const reopenedItems = await page.locator('#lightboxMediaContainer .lightbox-media-item').count();
      if (reopenedItems !== 11) {
        throw new Error(`Lightbox reopen after rapid navigation rendered ${reopenedItems} entries instead of 11.`);
      }

      await close.click();
      await page.waitForTimeout(100);
    }, { width: 1280, height: 900 });

    await smokePage(browser, '/', async page => {
      const fixtureCard = page.locator('#portfolioGrid .project-card[data-project-id="test-project"]').first();
      if (await fixtureCard.count() !== 1) throw new Error('Direct-media smoke fixture card is missing.');

      const thumbnail = fixtureCard.locator('.card-thumbnail').first();
      const activationTarget = thumbnail.locator('[data-lottie-thumb], lottie-player').first();
      if (await activationTarget.count() !== 1) throw new Error('Direct-media fixture thumbnail target is missing.');
      await activationTarget.evaluate(element => element.setAttribute('data-model-thumb', ''));
      await activationTarget.click();

      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });

      const mediaItems = page.locator('#lightboxMediaContainer .lightbox-media-item');
      if (await mediaItems.count() < 2) {
        throw new Error('Direct-media Lightbox fixture did not render the expected model media item.');
      }

      const modelItem = mediaItems.nth(1);
      await modelItem.waitFor({ state: 'attached', timeout: 3000 });
      if (await modelItem.count() !== 1) throw new Error('Direct model media target is missing.');

      const scrollState = await page.evaluate(() => ({
        lightboxTop: document.querySelector('#lightbox')?.scrollTop || 0,
        targetTop: document.querySelectorAll('#lightboxMediaContainer .lightbox-media-item')[1]?.getBoundingClientRect().top || 0,
        lightboxTopEdge: document.querySelector('#lightbox')?.getBoundingClientRect().top || 0
      }));
      if (scrollState.lightboxTop <= 0) {
        throw new Error('Opening a project directly on its model media did not move the Lightbox to the requested media item.');
      }

      await page.locator('#lightboxClose').click();
      await page.waitForTimeout(100);
    }, { width: 1280, height: 900 });

    await smokePage(browser, '/', async page => {
      const shortsCard = page.locator('#portfolioGrid .project-card[data-project-id="friends-gacha"]').first();
      if (await shortsCard.count() !== 1) throw new Error('Friends Gacha Shorts desktop smoke fixture card is missing.');

      await shortsCard.click();
      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });

      const shorts = page.locator('#lightboxMediaContainer .lightbox-media-item iframe.yt-portrait').first();
      if (await shorts.count() !== 1) throw new Error('Desktop Lightbox did not render the Friends Gacha Short as portrait media.');

      const shortsGeometry = await shorts.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height, ratio: r.width / Math.max(r.height, 1) };
      });
      if (Math.abs(shortsGeometry.ratio - (9 / 16)) > 0.025) {
        throw new Error('Desktop Shorts surface is not portrait (ratio ' + shortsGeometry.ratio.toFixed(3) + ').');
      }
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      if (shortsGeometry.width >= viewportWidth * 0.8) {
        throw new Error('Desktop Shorts surface is too wide for portrait media (' + Math.round(shortsGeometry.width) + 'px).');
      }
      const shortsArtwork = page.locator('#lightboxMediaContainer .lightbox-artwork.is-youtube-artwork[data-youtube-orientation="portrait"]').first();
      const shortsArtworkGeometry = await shortsArtwork.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height };
      });
      const desktopViewportHeight = await page.evaluate(() => window.innerHeight);
      const desktopYoutubeMaxHeight = desktopViewportHeight * 0.60 + 4;
      if (shortsArtworkGeometry.height > desktopYoutubeMaxHeight) {
        throw new Error('Desktop Shorts artwork surface is exceeding the 60svh presentation cap: ' + Math.round(shortsArtworkGeometry.height) + 'px.');
      }

      const youtubeFraming = await page.locator('#lightboxMediaContainer .lightbox-artwork.is-youtube-artwork').evaluateAll(els =>
        els.map(el => {
          const r = el.getBoundingClientRect();
          return {
            orientation: el.getAttribute('data-youtube-orientation'),
            width: r.width,
            height: r.height
          };
        })
      );
      youtubeFraming.forEach(({ orientation, width, height }) => {
        const ratio = width / Math.max(height, 1);
        const expected = orientation === 'portrait' ? 9 / 16 : orientation === 'square' ? 1 : 16 / 9;
        const maxWidth = orientation === 'landscape' ? 720 : orientation === 'portrait' ? 360 : 540;
        if (Math.abs(ratio - expected) > 0.025) {
          throw new Error('Desktop YouTube ' + orientation + ' framing drifted: ratio=' + ratio.toFixed(3) + ', expected=' + expected.toFixed(3) + '.');
        }
        if (height > desktopYoutubeMaxHeight) {
          throw new Error('Desktop YouTube ' + orientation + ' surface exceeds the 60svh presentation cap: ' + Math.round(height) + 'px.');
        }
        if (width > maxWidth + 2) {
          throw new Error('Desktop YouTube ' + orientation + ' surface exceeds its width ceiling: ' + Math.round(width) + 'px.');
        }
      });

      await page.locator('#lightboxClose').click();
      await page.waitForTimeout(100);
    }, { width: 1280, height: 900 });
    await smokePage(browser, '/', async page => {
      const shortsCard = page.locator('#portfolioGrid .project-card[data-project-id="friends-gacha"]').first();
      if (await shortsCard.count() !== 1) throw new Error('Friends Gacha Shorts smoke fixture card is missing.');

      await shortsCard.click();
      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });

      const shorts = page.locator('#lightboxMediaContainer .lightbox-media-item iframe.yt-portrait').first();
      if (await shorts.count() !== 1) throw new Error('Lightbox did not render the Friends Gacha Short as portrait media.');

      const viewportWidth = await page.evaluate(() => window.innerWidth);
      const shortsBox = await shorts.evaluate(el => {
        const r = el.getBoundingClientRect();
        return {
          width: Math.round(r.width),
          height: Math.round(r.height),
          pointerEvents: getComputedStyle(el).pointerEvents
        };
      });
      if (Math.abs(shortsBox.width - viewportWidth) > 2) {
        throw new Error(`Mobile Shorts media is not full-bleed (media ${shortsBox.width}px vs viewport ${viewportWidth}px).`);
      }
      if (shortsBox.height < 400) {
        throw new Error(`Mobile Shorts iframe did not fill its portrait artwork surface (height ${shortsBox.height}px).`);
      }
      if (shortsBox.pointerEvents === 'none') {
        throw new Error('Mobile Shorts iframe is not pointer-interactive.');
      }
      const shortsLoading = await shorts.getAttribute('loading');
      if (shortsLoading === 'lazy') {
        throw new Error('Mobile Shorts iframe still uses lazy loading, which can delay the first tap.');
      }
      const shortsTouchAction = await shorts.evaluate(el => getComputedStyle(el).touchAction);
      if (shortsTouchAction === 'none') {
        throw new Error('Mobile Shorts iframe touch interaction is disabled.');
      }

      // The iframe itself must own the hit area so a tap reaches YouTube's
      // native play controls instead of landing on an empty wrapper.

      await page.locator('#lightboxClose').click();
      await page.waitForTimeout(100);
    }, { width: 390, height: 844 });

    // A short/wide phone must still keep portrait YouTube artwork width-first.
    // This catches regressions where a viewport-height cap quietly shrinks Shorts.
    await smokePage(browser, '/', async page => {
      const shortsCard = page.locator('#portfolioGrid .project-card[data-project-id="friends-gacha"]').first();
      if (await shortsCard.count() !== 1) throw new Error('Short-phone Shorts fixture card is missing.');

      await shortsCard.click();
      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });

      const shorts = page.locator('#lightboxMediaContainer .lightbox-media-item iframe.yt-portrait').first();
      if (await shorts.count() !== 1) throw new Error('Short-phone Lightbox did not render the Friends Gacha Short.');

      const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      const box = await shorts.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
      });

      if (Math.abs(box.width - viewport.width) > 2) {
        throw new Error(
          `Short-phone Shorts lost width-first full-bleed presentation (${box.width}px vs ${viewport.width}px viewport).`
        );
      }
      if (box.height < viewport.width * 1.6) {
        throw new Error(
          `Short-phone Shorts unexpectedly collapsed vertically (${box.height}px for a ${box.width}px-wide portrait surface).`
        );
      }

      await page.locator('#lightboxClose').click();
      await page.waitForTimeout(100);
    }, { width: 430, height: 700 });

    await smokePage(browser, '/', async page => {
      const filters = page.locator('.filter-tabs .filter-btn, .filter-tabs .tab-btn');
      if (await filters.count() < 2) throw new Error('Tablet Works filter UI did not render.');

      const allFilter = page.locator('.filter-tabs [data-filter="all"]');
      if (await allFilter.count() !== 1) throw new Error('Tablet Works filter UI is missing ALL.');
    }, { width: 834, height: 900 });

    await smokePage(browser, '/', async page => {
      const cards = page.locator('#portfolioGrid .project-card');
      const boxes = await cards.evaluateAll(items => items.slice(0, 3).map(card => {
        const r = card.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width };
      }));
      if (
        boxes.length < 3 ||
        Math.abs(boxes[0].y - boxes[1].y) > 2 ||
        Math.abs(boxes[1].y - boxes[2].y) > 2 ||
        Math.abs(boxes[0].width - boxes[1].width) > 2 ||
        Math.abs(boxes[1].width - boxes[2].width) > 2
      ) {
        throw new Error('768px breakpoint entered a hybrid layout instead of the tablet three-column grid.');
      }
    }, { width: 768, height: 900 });

    await smokePage(browser, '/', async page => {
      const cards = page.locator('#portfolioGrid .project-card');
      const boxes = await cards.evaluateAll(items => items.slice(0, 6).map(card => {
        const r = card.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }));
      if (boxes.length < 3) throw new Error('Desktop Works gallery rendered too few cards for column-geometry validation.');
      const referenceWidth = boxes[0].width;
      const bad = boxes.find(box => Math.abs(box.width - referenceWidth) > 2);
      if (bad) {
        throw new Error('Desktop Works project gallery column widths drifted instead of staying aligned.');
      }
    }, { width: 1280, height: 900 });

    await smokePage(browser, '/about/', async page => {
      await assertMobileNavigation(page, 'About page');
      const moduleScript = await page.locator('script[type="module"][src*="script.js"]').count();
      if (moduleScript !== 1) throw new Error('About page is missing its module bootstrap script.');

      const hero = page.locator('#heroBannerAbout, #heroBanner').first();
      if (await hero.count() !== 1) throw new Error('About page hero container is missing.');

      const experience = await page.locator('#experienceList .timeline-item').count();
      const education = await page.locator('#educationList .timeline-item').count();
      const awards = await page.locator('#awardsList .timeline-item').count();
      const softwareSkills = await page.locator('#softwareSkillsList li').count();
      await page.locator('#softwareSkillsList li.has-logo img.skill-logo').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      const softwareImages = await page.locator('#softwareSkillsList li.has-logo img.skill-logo').count();
      const brokenImages = await page.locator('#softwareSkillsList li.has-logo img.skill-logo').evaluateAll(images => images.filter(img => !img.complete || !img.naturalWidth).length);
      const kritaImage = page.locator('#softwareSkillsList li.has-logo img[alt="Krita"]').first();

      if (experience < 1) throw new Error('About page rendered no work experience entries.');
      if (education < 1) throw new Error('About page rendered no education entries.');
      if (awards < 1) throw new Error('About page rendered no awards entries.');
      if (softwareSkills < 1) throw new Error('About page rendered no software skills.');
      if (softwareImages < 1) throw new Error('About page software-logo mode is enabled but no software logo rendered.');
      if (brokenImages) throw new Error('About page contains a visibly broken software-logo image.');
      if (await kritaImage.count()) {
        const src = await kritaImage.getAttribute('src');
        const usesBundledKrita = src?.includes('/assets/projects/site/logos/krita.svg');
        const usesSimpleIconsKrita = src?.includes('cdn.simpleicons.org/krita');
        if (!src || (!usesBundledKrita && !usesSimpleIconsKrita)) {
          throw new Error('About page Krita logo did not use its bundled local asset or the Simple Icons fallback.');
        }
      }
    }, { width: 390, height: 844 });

    await smokePage(browser, '/admin/', async page => {
      // CMS boot is asynchronous because the connection is validated against
      // GitHub before the application shell is exposed. The shell becomes
      // active slightly before enterApp() calls its initial Hero navigation,
      // so waiting on the active class alone still leaves a small race where
      // this click can be overwritten by goToSection('hero'). Wait for the
      // first real section render too; that proves the boot transition has
      // completed before the smoke test starts driving navigation.
      await page.locator('#app.active').waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('#topbar.active').waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('.nav-item[data-section="hero"].active').waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('#content #heroList, #content #addHero').first().waitFor({ state: 'visible', timeout: 10000 });

      const nav = page.locator('.nav-item[data-section="about"]');
      if (await nav.count() !== 1) throw new Error('CMS About navigation item is missing.');

      const projectsNav = page.locator('.nav-item[data-section="projects"]');
      if (await projectsNav.count() !== 1) throw new Error('CMS Projects navigation item is missing.');
      const mediaNav = page.locator('.nav-item[data-section="media"]');
      if (await mediaNav.count() !== 1) throw new Error('CMS Media Library navigation item is missing.');
      const curatedNav = page.locator('.nav-item[data-section="curatedViews"]');
      if (await curatedNav.count() !== 1) throw new Error('CMS Curated Views navigation item is missing.');

      // Start a real CMS save and leave the section before the mocked GitHub
      // response resolves. The stale save completion must not re-enable or
      // overwrite the Save button state of the newly selected Media Library.
      await page.locator('#content #addHero').click();
      await page.locator('#btnSaveTop').click();
      await page.waitForTimeout(50);
      page.once('dialog', dialog => dialog.accept());
      await mediaNav.click();
      if (!(await page.locator('#btnSaveTop').isDisabled())) {
        throw new Error('CMS Save control remained enabled immediately after navigation to Media Library.');
      }
      await page.locator('#content #mediaGrid').waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForTimeout(350);
      if (!(await page.locator('#btnSaveTop').isDisabled())) {
        throw new Error('Stale CMS save completion re-enabled the Save control on Media Library.');
      }

      await curatedNav.click();
      await page.locator('#content #addCuratedView').waitFor({ state: 'visible', timeout: 5000 });

      // A Curated-only action also depends on Main Portfolio IDs. It must not
      // open a prompt or mutate a stale view after navigation starts while
      // that dependency is still resolving.
      page.once('dialog', dialog => dialog.accept('Smoke Early View'));
      await page.locator('#content #addCuratedView').click();
      await page.locator('#content #curatedViewList .card-item').filter({ hasText: 'Smoke Early View' }).waitFor({ state: 'visible', timeout: 5000 });

      let staleCreateDialog = false;
      const staleDialogHandler = dialog => {
        if(dialog.type() === 'prompt'){
          staleCreateDialog = true;
          dialog.dismiss().catch(() => {});
          return;
        }
        // The Curated View is deliberately dirty here, so leaving it opens
        // the CMS's normal unsaved-changes confirmation. Accept that
        // navigation confirmation while keeping prompt handling observable.
        dialog.accept().catch(() => {});
      };
      page.on('dialog', staleDialogHandler);
      await page.locator('#content [data-create]').click();
      await page.waitForTimeout(50);
      await nav.click();
      await page.locator('#content #tags_software').waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForTimeout(350);
      page.off('dialog', staleDialogHandler);
      if (staleCreateDialog) throw new Error('Curated-only Create Project opened a prompt after its section became stale.');
      if ((await page.locator('#topbarSection').textContent()).trim() !== 'About Page') {
        throw new Error('CMS stale Curated-only action navigation did not remain on About.');
      }

      await curatedNav.click();
      await page.locator('#content #addCuratedView').waitFor({ state: 'visible', timeout: 5000 });

      // Curated Views hydrate Main Portfolio references asynchronously. Leave
      // the section before that secondary request resolves and verify the
      // response cannot paint stale content over the newly selected section.
      await page.waitForTimeout(50);
      await nav.click();
      await page.locator('#content #tags_software').waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForTimeout(350);
      if ((await page.locator('#topbarSection').textContent()).trim() !== 'About Page') {
        throw new Error('CMS async Curated Views hydration overwrote the selected About section.');
      }
      await curatedNav.click();
      await page.locator('#content #addCuratedView').waitFor({ state: 'visible', timeout: 5000 });

      // Media Library loads the Git tree outside loadSection(), so it needs
      // the same navigation guard as the JSON-backed CMS sections.
      await mediaNav.click();
      await page.waitForTimeout(50);
      await nav.click();
      await page.locator('#content #tags_software').waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForTimeout(350);
      if ((await page.locator('#topbarSection').textContent()).trim() !== 'About Page') {
        throw new Error('CMS stale Media Library hydration overwrote the selected About section.');
      }
      await mediaNav.click();
      await page.locator('#content #mediaGrid').waitFor({ state: 'visible', timeout: 5000 });

      // Refresh uses the same asynchronous tree request after the Media
      // Library is already mounted; navigating away during it must not repaint
      // the old Media screen.
      await page.locator('#content #btnRefresh').click();
      await page.waitForTimeout(50);
      await nav.click();
      await page.locator('#content #tags_software').waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForTimeout(350);
      if ((await page.locator('#topbarSection').textContent()).trim() !== 'About Page') {
        throw new Error('CMS Media Library Refresh hydration overwrote the selected About section.');
      }

      // Complete a save while staying on its originating section so deployment
      // tracking starts, then navigate away. The old deployment poll must not
      // continue owning the new section's status bar.
      const heroNav = page.locator('.nav-item[data-section="hero"]');
      await heroNav.click();
      await page.locator('#content #heroList, #content #addHero').first().waitFor({ state: 'visible', timeout: 5000 });
      await page.locator('#content #addHero').click();
      await page.locator('#btnSaveTop').click();
      await page.waitForTimeout(400);
      const savingStatus = (await page.locator('#saveStatusText').textContent()).trim();
      if (savingStatus !== 'Deploying…') {
        throw new Error(`CMS save did not enter deployment tracking state (found "${savingStatus}").`);
      }
      await mediaNav.click();
      if ((await page.locator('#saveStatusText').textContent()).trim() === 'Deploying…') {
        throw new Error('CMS deployment polling continued to own the Save status after navigation.');
      }

      await curatedNav.click();
      await page.locator('#content #addCuratedView').waitFor({ state: 'visible', timeout: 5000 });
      page.once('dialog', dialog => dialog.accept('Smoke Curated View'));
      await page.locator('#content #addCuratedView').click();
      await page.locator('#content #curatedViewList .card-item').filter({ hasText: 'Smoke Curated View' }).waitFor({ state: 'visible', timeout: 5000 });
      const curatedDirty = await page.locator('#dirty-curatedViews').evaluate(el => getComputedStyle(el).display);
      if (curatedDirty === 'none') throw new Error('Creating a Curated View did not mark the Curated Views editor dirty.');

      // Curated Views has its own Main Portfolio picker. Exercise the actual
      // dialog rather than relying on generic Media Library picker coverage:
      // every project option needs a real visual preview plus isolated title /
      // subtitle blocks with no geometry overlap.
      const addProjectButton = page.locator('#content [data-add]').first();
      await addProjectButton.click();
      await page.locator('.curated-project-picker-dialog').waitFor({ state: 'visible', timeout: 5000 });
      const pickerOption = page.locator('.curated-project-option').filter({ hasText: 'Test Project' }).first();
      if (await pickerOption.count() !== 1) throw new Error('Curated Views Add Project picker did not show the Main Portfolio fixture.');
      if (await pickerOption.locator('.curated-project-preview img').count() !== 1) throw new Error('Curated Views Add Project picker is missing the project thumbnail preview.');
      const optionGeometry = await pickerOption.evaluate((el) => {
        const preview = el.querySelector('.curated-project-preview')?.getBoundingClientRect();
        const meta = el.querySelector('.curated-project-meta')?.getBoundingClientRect();
        const title = el.querySelector('.curated-project-title')?.getBoundingClientRect();
        const subtitle = el.querySelector('.curated-project-subtitle')?.getBoundingClientRect();
        if (!preview || !meta || !title || !subtitle) return null;
        return { previewBottom: preview.bottom, metaTop: meta.top, titleBottom: title.bottom, subtitleTop: subtitle.top };
      });
      if (!optionGeometry || optionGeometry.previewBottom > optionGeometry.metaTop + 1 || optionGeometry.titleBottom > optionGeometry.subtitleTop + 1) {
        throw new Error('Curated Views Add Project picker text blocks overlap the preview or each other.');
      }
      await pickerOption.click();
      await page.locator('.curated-project-picker-dialog').waitFor({ state: 'detached', timeout: 5000 });
      if (!(await addProjectButton.evaluate(el => el === document.activeElement))) {
        throw new Error('Closing the Curated Views Add Project picker did not restore focus to the opener.');
      }
      await addProjectButton.click();
      await page.locator('.curated-project-picker-dialog').waitFor({ state: 'visible', timeout: 5000 });
      await page.locator('.curated-project-picker-dialog [data-search]').press('Escape');
      await page.locator('.curated-project-picker-dialog').waitFor({ state: 'detached', timeout: 5000 });
      if (!(await addProjectButton.evaluate(el => el === document.activeElement))) {
        throw new Error('Escape did not close the Curated Views picker and restore focus to its opener.');
      }
      const addedMainRow = page.locator('#content [data-list] .card-item').filter({ hasText: 'Test Project' }).first();
      await addedMainRow.waitFor({ state: 'visible', timeout: 5000 });

      // Create Project must use the shared project editor. This specifically
      // catches regressions where buildProjectBody is accidentally scoped
      // inside the Main Projects renderer and becomes undefined here.
      page.once('dialog', dialog => dialog.accept('Smoke Curated-only Project'));
      await page.locator('#content [data-create]').click();
      const curatedOnlyRow = page.locator('#content [data-list] .card-item').filter({ hasText: 'Smoke Curated-only Project' }).first();
      await curatedOnlyRow.waitFor({ state: 'visible', timeout: 5000 });
      const curatedTitle = curatedOnlyRow.locator('[data-f="title"]').first();
      if (await curatedTitle.count() !== 1 || (await curatedTitle.inputValue()) !== 'Smoke Curated-only Project') {
        throw new Error('Curated Views Create Project did not mount the shared project editor.');
      }

      page.once('dialog', dialog => dialog.accept());
      await projectsNav.click();
      await page.locator('#content #projList .card-item').first().waitFor({ state: 'visible', timeout: 5000 });
      const curatedDirtyAfterLeave = await page.locator('#dirty-curatedViews').evaluate(el => getComputedStyle(el).display);
      if (curatedDirtyAfterLeave !== 'none') throw new Error('Curated Views dirty state leaked across CMS section navigation.');
      await projectsNav.click();
      await page.locator('#content #projList .card-item').first().waitFor({ state: 'visible', timeout: 5000 });

      const testProject = page.locator('#content #projList .card-item').filter({ hasText: 'Test Project' }).first();
      if (await testProject.count() !== 1) throw new Error('CMS Projects editor did not render the test-project fixture.');
      const testBody = testProject.locator('[data-body]').first();
      const bodyStyle = await testBody.getAttribute('style');
      if (!bodyStyle?.includes('display:block')) await testProject.locator('[data-toggle-open]').click();

      const lottieMedia = testProject.locator('[data-medialist] .card-item').first();
      if (await lottieMedia.count() !== 1) throw new Error('CMS test-project Lottie media row is missing.');
      const mediaToggle = lottieMedia.locator('[data-mact="toggle"]');
      if (await mediaToggle.count()) {
        const mediaBody = lottieMedia.locator('[data-mbody]').first();
        const mediaStyle = await mediaBody.getAttribute('style');
        if (!mediaStyle?.includes('display:block')) await mediaToggle.click();
      }

      const bgControl = lottieMedia.locator('[data-bg-control]');
      if (await bgControl.count() !== 1) throw new Error('CMS Lottie media row is missing the background color control.');
      if (!(await bgControl.isVisible())) throw new Error('CMS Lottie background color control should be visible.');

      const bgColorInput = bgControl.locator('[data-bg-color]').first();
      const bgSwatch = bgControl.locator('[data-bg-swatch]').first();
      const bgEnableInput = bgControl.locator('[data-bg-enabled]').first();
      if (await bgColorInput.count() !== 1 || await bgSwatch.count() !== 1 || await bgEnableInput.count() !== 1) {
        throw new Error('CMS Lottie background control is missing its compact color picker surface.');
      }
      if (!(await bgColorInput.isDisabled())) throw new Error('CMS Lottie color picker should start disabled until its background is enabled.');

      await bgEnableInput.check();
      if (await bgColorInput.isDisabled()) throw new Error('CMS Lottie color picker did not enable after turning on its background.');

      await bgColorInput.evaluate((input) => {
        input.value = '#336699';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const bgHex = await bgControl.locator('[data-bg-hex]').textContent().catch(() => '');
      if (bgHex?.trim().toUpperCase() !== '#336699') {
        throw new Error('CMS background color picker did not update its displayed value.');
      }

      page.once('dialog', dialog => dialog.accept());
      await nav.click();
      await page.locator('#content #tags_software').waitFor({ state: 'visible', timeout: 5000 });

      const softwareRows = await page.locator('#tags_software .skill-editor-row').count();
      if (softwareRows < 1) throw new Error('CMS About editor rendered no software skill rows.');

      const kritaRow = page.locator('#tags_software .skill-editor-row').filter({ hasText: 'Krita' }).first();
      if (await kritaRow.count() !== 1) throw new Error('CMS About editor did not render the stubbed Krita skill.');

      const logo = kritaRow.locator('img').first();
      await logo.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      if (await logo.count() !== 1) throw new Error('CMS About editor did not render a Krita logo preview.');
    }, { width: 1280, height: 900 }, async page => {
      const about = {
        headline: 'CMS Smoke Test',
        subhead: 'Software logo lookup',
        bio: 'Browser smoke fixture.',
        photo: { src: '', zoom: 1, focus: '50% 50%', rotate: 0 },
        softwareSkills: [{ name: 'Krita', icon: '' }],
        multimediaSkills: [],
        experience: [{ role: 'Test Role', company: 'Test Company', startDate: '2026', endDate: '', bullets: [] }],
        education: [{ school: 'Test School', degree: 'Test Degree', graduationDate: '2026', title: '', detail: '' }],
        awards: [{ title: 'Test Award', detail: '2026' }]
      };
      const projectsFixture = [{
        id: 'test-project',
        title: 'Test Project',
        subtitle: 'CMS fixture',
        badge: '',
        filters: [],
        description: '',
        thumbnail: { type: 'image', src: 'assets/projects/test/thumb.svg', focus: '50% 50%', zoom: 1 },
        media: [
          { type: 'lottie', src: 'assets/projects/test/Sample.json', caption: 'Lottie fixture', orientation: 'square' },
          { type: 'model', src: 'assets/projects/test/Female base.obj', caption: '3D fixture', orientation: '' }
        ]
      }];
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(about))));
      const encodedProjects = btoa(unescape(encodeURIComponent(JSON.stringify(projectsFixture))));
      await page.addInitScript(({ encodedAbout }) => {
        sessionStorage.setItem('lm_cms_session_v1', JSON.stringify({
          owner: 'Smoke',
          repo: 'TestRepo',
          branch: 'main',
          token: 'github_' + 'pat_smoke_test_token'
        }));
        window.__LM_CMS_SMOKE_ABOUT__ = encodedAbout;
      }, { encodedAbout: encoded });

      await page.route('https://raw.githubusercontent.com/Smoke/TestRepo/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('Sample.json')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ v: '5.7.0', fr: 30, ip: 0, op: 60, w: 100, h: 100, nm: 'Smoke', ddd: 0, assets: [], layers: [] })
          });
          return;
        }
        if (url.pathname.endsWith('.obj')) {
          await route.fulfill({
            status: 200,
            contentType: 'text/plain',
            body: 'o Smoke\nv 0 0 0\nv 0 1 0\nv 1 0 0\nf 1 2 3\n'
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#fff"/></svg>'
        });
      });

      await page.route('https://api.github.com/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/repos/Smoke/TestRepo') {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ full_name: 'Smoke/TestRepo', default_branch: 'main' }) });
          return;
        }
        const aboutPath = '/repos/Smoke/TestRepo/contents/data/about.json';
        if (url.pathname.startsWith('/repos/Smoke/TestRepo/contents/') && route.request().method() === 'PUT') {
          // Delay a normal content save so the browser smoke test can
          // navigate away before its completion callback runs.
          await new Promise(resolve => setTimeout(resolve, 250));
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              content: { sha: 'smoke-saved-content' },
              commit: { sha: 'smoke-save-commit' }
            })
          });
          return;
        }
        if (url.pathname === '/repos/Smoke/TestRepo/commits/smoke-save-commit/check-runs') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              check_runs: [
                { name: 'pages build and deployment', status: 'in_progress', conclusion: null, html_url: 'https://github.com/Smoke/TestRepo/actions' }
              ]
            })
          });
          return;
        }
        if (url.pathname === '/repos/Smoke/TestRepo/git/trees/main') {
          // Make Media Library tree hydration cross a deliberate section
          // navigation boundary in the smoke test.
          await new Promise(resolve => setTimeout(resolve, 250));
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              tree: [
                { type: 'tree', path: 'assets', sha: 'smoke-assets' },
                { type: 'tree', path: 'assets/projects', sha: 'smoke-projects' },
                { type: 'blob', path: 'assets/projects/smoke.jpg', sha: 'smoke-jpg', size: 12 }
              ]
            })
          });
          return;
        }
        const genericDataMatch = url.pathname.match(/^\/repos\/Smoke\/TestRepo\/contents\/data\/([^/]+\.json)$/);
        if (url.pathname === aboutPath) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: encoded, sha: 'smoke-about-sha' }) });
          return;
        }
        if (genericDataMatch) {
          const filename = genericDataMatch[1];
          if (filename === 'projects.json') {
            // Make the Curated Views secondary hydration request slow enough
            // to cross a deliberate navigation boundary in the smoke test.
            await new Promise(resolve => setTimeout(resolve, 250));
          }
          const fixture =
            filename === 'hero.json' ? [] :
            filename === 'projects.json' ? JSON.parse(decodeURIComponent(escape(atob(encodedProjects)))) :
            filename === 'settings.json' ? {} :
            [];
          // Return the already-encoded Projects fixture directly. Re-decoding
          // and re-encoding it inside the route handler can leave the mocked
          // fetch unresolved on a runner, which makes the CMS renderer appear
          // to hang forever on "Loading…".
          const content = filename === 'projects.json'
            ? encodedProjects
            : btoa(unescape(encodeURIComponent(JSON.stringify(fixture))));
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content, sha: `smoke-${filename}-sha` }) });
          return;
        }
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not found' }) });
      });
    });
    console.log('LM. browser smoke test passed — Works and About booted without uncaught browser errors.');
  } finally {
    await browser.close();
  }
} catch (error) {
  const serverErrors = getStderr().trim();
  if (serverErrors) console.error(serverErrors);
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
} finally {
  stopServer(server);
}
