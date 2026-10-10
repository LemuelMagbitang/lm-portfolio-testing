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
import { readFileSync } from 'node:fs';
import process from 'node:process';

import { chromium } from 'playwright';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SMOKE_PAGE_TIMEOUT_MS = 30000;
const SMOKE_BOOT_SETTLE_MS = 1000;
let smokePageSequence = 0;

function waitForSmokeTask(task, timeoutMs, label) {
  let timer = null;
  let settled = false;
  const work = Promise.resolve()
    .then(task)
    .then(
      value => {
        settled = true;
        if (timer) clearTimeout(timer);
        return value;
      },
      error => {
        settled = true;
        if (timer) clearTimeout(timer);
        throw error;
      }
    );

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (settled) return;
      reject(new Error(
        'Smoke page timed out after ' + timeoutMs + 'ms: ' + label
      ));
    }, timeoutMs);
  });

  // `work` always has fulfillment/rejection handlers attached above, so a
  // timed-out page cannot later surface an unhandled rejection after the page
  // has been closed by smokePage().
  return Promise.race([work, timeout]);
}

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

async function assertPublicFilterNavigation(page, { href, expectedHash, label }) {
  const link = page.locator(`.nav-links a[href="${href}"]`).first();
  if (await link.count() !== 1) {
    throw new Error(`${label} filter navigation link is missing: ${href}`);
  }

  // Cross-page smoke cases can deliberately reload a public page immediately
  // before exercising its navigation. The branded loading gate intentionally
  // intercepts pointer events until bootstrap has composed and painted the
  // page, so synchronize against that explicit readiness contract instead of
  // racing the transition overlay.
  const pageTransition = page.locator('#pageTransition').first();
  if (await pageTransition.count() === 1) {
    await page.waitForFunction(() => {
      const transition = document.querySelector('#pageTransition');
      return transition?.dataset.loading === 'ready' && transition.getAttribute('aria-hidden') === 'true';
    }, null, { timeout: 6000 });
  }

  // Desktop exposes these links through a CSS-only hover dropdown. Test the
  // anchor's actual activation semantics there without depending on a headless
  // pseudo-hover state. Mobile uses the real visible hamburger menu and a real
  // Playwright click, which separately exercises the touch/navigation lifecycle.
  const viewport = page.viewportSize();
  if ((viewport?.width || 0) >= 768) {
    const dropdown = page.locator('.nav-item-dropdown').first();
    if (await dropdown.count() !== 1) {
      throw new Error(`${label} Works dropdown is missing.`);
    }
    await link.evaluate(element => element.click());
  } else {
    // Mobile public filter links live inside the collapsed hamburger menu.
    // Open it here when the caller has just reloaded a page, while preserving
    // already-open callers such as the dedicated mobile navigation smoke.
    const hamburger = page.locator('.hamburger').first();
    const mobileMenu = page.locator('.nav-links').first();
    if (await hamburger.count() === 1 && await mobileMenu.count() === 1) {
      const menuOpen = await mobileMenu.evaluate(el => el.classList.contains('active'));
      if (!menuOpen) await hamburger.click();
    }
    // The mobile menu opens with a short opacity/max-height transition.
    // Wait for the actual filter anchor to become visible before exercising
    // its navigation semantics instead of racing the presentation animation.
    await link.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {});
    if (!(await link.isVisible())) {
      throw new Error(`${label} filter navigation link is not visible in the mobile menu.`);
    }
    await link.click();
  }
  await page.waitForFunction(hash => window.location.hash === hash, expectedHash, { timeout: 3000 });
  await page.waitForFunction(() => {
    const target = document.querySelector('.portfolio-wrapper');
    const nav = document.querySelector('.navbar');
    if (!target || !nav) return false;
    const targetBox = target.getBoundingClientRect();
    const navBox = nav.getBoundingClientRect();
    return targetBox.y >= navBox.height - 12 && targetBox.y <= navBox.height + 90;
  }, null, { timeout: 4000 });

  // Hash settlement and Gallery activation are separate async stages. The
  // navigation contract is not complete until the Gallery has acknowledged the
  // same filter in its own button state, so wait for that observable state
  // instead of sampling it immediately after the page-transition geometry check.
  const activeFilterLocator = page.locator(`.filter-tabs [data-filter="${expectedHash.slice(1)}"].active`).first();
  await activeFilterLocator.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  const activeFilter = await page.locator(`.filter-tabs [data-filter="${expectedHash.slice(1)}"].active`).count();
  if (activeFilter !== 1) {
    throw new Error(`${label} filter navigation selected the hash but not the matching Gallery filter.`);
  }

  const hamburger = page.locator('.hamburger').first();
  if (await hamburger.isVisible().catch(() => false)) {
    const menuOpen = await page.locator('.nav-links').first().evaluate(el => el.classList.contains('active'));
    if (menuOpen) throw new Error(`${label} filter navigation left the mobile menu open.`);
  }
}
 
async function smokePage(browser, path, assertions, viewport = { width: 1280, height: 900 }, prepare = null, beforeReady = null) {
  // A narrow viewport alone does not emulate a phone. In Chromium the CSS
  // pointer media feature remains `pointer:fine`, which means touch-specific
  // presentation (including the holographic HOLD + MOVE affordance) will not
  // activate. Use a touch/mobile context for narrow smoke cases so the test
  // exercises the same media-query branch as an actual handset.
  const isMobileSmoke = viewport.width < 768;
  const context = await browser.newContext({
    viewport,
    isMobile: isMobileSmoke,
    hasTouch: isMobileSmoke
  });
  const page = await context.newPage();
  const smokeId = ++smokePageSequence;
  const caller = (new Error().stack || '').split('\n')[2]?.trim() || 'unknown-callsite';
  const smokeLabel = `#${smokeId} ${path} ${viewport.width}x${viewport.height}`;
  const startedAt = Date.now();
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(15000);
  console.log(`[smoke] START ${smokeLabel} caller=${caller}`);

  try {
    await waitForSmokeTask(async () => {
      await configureLogoRoutes(page);

      if (isMobileSmoke) {
        const coarse = await page.evaluate(() =>
          window.matchMedia('(pointer: coarse)').matches &&
          window.matchMedia('(hover: none)').matches
        );
        if (!coarse) {
          throw new Error('Mobile smoke context did not emulate a coarse touch pointer.');
        }
      }

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
      await page.waitForTimeout(SMOKE_BOOT_SETTLE_MS);
      try {
        await assertions(page);
      } catch (error) {
        if (errors.length) {
          const browserErrors = errors.join('\\n- ');
          error.message = `${error.message}\\n\\nBrowser errors observed before failure:\\n- ${browserErrors}`;
        }
        throw error;
      }

      if (errors.length) {
        throw new Error(`${path} produced browser errors:\\n- ${errors.join('\\n- ')}`);
      }
    }, SMOKE_PAGE_TIMEOUT_MS, `${smokeLabel} caller=${caller}`);

    const durationMs = Date.now() - startedAt;
    console.log(`[smoke] PASS ${smokeLabel} duration=${durationMs}ms`);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error(`[smoke] FAIL ${smokeLabel} duration=${durationMs}ms: ${error?.message || error}`);
    throw error;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function assertFilterButtonHitTarget(page, label, index = 1) {
  const button = page.locator('.filter-tabs .filter-btn, .filter-tabs .tab-btn').nth(index);
  if (await button.count() !== 1) {
    throw new Error(label + ' is missing the requested filter button.');
  }

  const hit = await button.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const top = document.elementFromPoint(centerX, centerY);
    const style = getComputedStyle(el);
    return {
      filter: el.getAttribute('data-filter') || '',
      topTag: top?.tagName || '',
      topClass: top?.className || '',
      topIsButton: top === el || !!top?.closest?.('.filter-tabs .filter-btn, .filter-tabs .tab-btn'),
      pointerEvents: style.pointerEvents,
      inert: Boolean(el.closest('.filter-tabs')?.inert),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    };
  });

  if (!hit.topIsButton || hit.pointerEvents === 'none' || hit.inert) {
    throw new Error(label + ' filter button is not the topmost interactive hit target: ' + JSON.stringify(hit));
  }

  await button.click();
  await page.waitForTimeout(120);
  const buttonState = await button.evaluate(el => ({
    active: el.classList.contains('active'),
    ariaPressed: el.getAttribute('aria-pressed')
  }));
  if (!buttonState.active) {
    throw new Error(label + ' filter button received input but did not become active.');
  }

  const pressedCount = await page.locator('.filter-tabs .filter-btn[aria-pressed="true"], .filter-tabs .tab-btn[aria-pressed="true"]').count();
  if (pressedCount !== 1 || buttonState.ariaPressed !== 'true') {
    throw new Error(
      label + ' filter accessibility state is inconsistent: ' +
      JSON.stringify({ button: buttonState, pressedCount })
    );
  }
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

  // The menu close interaction is intentionally animated. Pointer events are
  // disabled immediately by the CSS contract, while opacity/max-height settle
  // over a few hundred milliseconds. Wait before inspecting final presentation.
  await page.waitForTimeout(360);

  // Regression guard: a closed mobile Works dropdown must not retain an
  // interactive/visible hit surface over the document. Previously its nested
  // dropdown rules overrode the parent's pointer-events:none and intercepted
  // arbitrary page taps as filter navigation.
  const closedMenuContract = await menu.evaluate(el => {
    const style = getComputedStyle(el);
    const dropdown = el.querySelector('.nav-dropdown-menu');
    const dropdownStyle = dropdown ? getComputedStyle(dropdown) : null;
    return {
      maxHeight: style.maxHeight,
      opacity: style.opacity,
      visibility: style.visibility,
      pointerEvents: style.pointerEvents,
      dropdownVisibility: dropdownStyle?.visibility || '',
      dropdownPointerEvents: dropdownStyle?.pointerEvents || ''
    };
  });
  if (
    closedMenuContract.maxHeight !== '0px' ||
    closedMenuContract.opacity !== '0' ||
    closedMenuContract.visibility !== 'hidden' ||
    closedMenuContract.pointerEvents !== 'none' ||
    closedMenuContract.dropdownPointerEvents !== 'none'
  ) {
    throw new Error(label + ' closed mobile navigation still exposes a stale interactive hit surface: ' + JSON.stringify(closedMenuContract));
  }

  const hero = page.locator('.hero-section').first();
  const heroBox = await hero.boundingBox();
  if (heroBox) {
    const beforeHash = await page.evaluate(() => window.location.hash);
    await page.mouse.click(
      heroBox.x + heroBox.width / 2,
      heroBox.y + heroBox.height / 2
    );
    await page.waitForTimeout(120);
    const afterHash = await page.evaluate(() => window.location.hash);
    if (afterHash !== beforeHash) {
      throw new Error(
        label + ' clicking ordinary hero/background content unexpectedly triggered filter navigation: ' +
        beforeHash + ' -> ' + afterHash
      );
    }
  }

  const assertOrdinarySurface = async (locator, label) => {
    if (await locator.count() !== 1) return;

    await locator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(80);

    const point = await locator.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const candidates = [
        { x: rect.left + rect.width * 0.08, y: rect.top + rect.height * 0.12 },
        { x: rect.left + rect.width * 0.92, y: rect.top + rect.height * 0.12 },
        { x: rect.left + rect.width * 0.08, y: rect.top + rect.height * 0.88 },
        { x: rect.left + rect.width * 0.92, y: rect.top + rect.height * 0.88 },
        { x: rect.left + rect.width * 0.50, y: rect.top + rect.height * 0.50 }
      ];
      const blocked = value => {
        const target = document.elementFromPoint(value.x, value.y);
        return target?.closest?.(
          '.nav-links, .filter-tabs, a, button, input, textarea, select, .project-card'
        );
      };
      return candidates.find(candidate =>
        candidate.x >= rect.left &&
        candidate.x <= rect.right &&
        candidate.y >= rect.top &&
        candidate.y <= rect.bottom &&
        !blocked(candidate)
      ) || null;
    });

    if (!point) return;

    const beforeHash = await page.evaluate(() => window.location.hash);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(120);
    const afterHash = await page.evaluate(() => window.location.hash);
    if (afterHash !== beforeHash) {
      throw new Error(
        label + ' ordinary page surface unexpectedly triggered filter navigation: ' +
        beforeHash + ' -> ' + afterHash
      );
    }
  };

  await assertOrdinarySurface(page.locator('#contact-section').first(), label + ' Contact');
  await assertOrdinarySurface(page.locator('footer').first(), label + ' footer');

  // Re-open/close once after the lower-page taps. This catches stale menu state
  // that only appears after scrolling away from the hero before returning home.
  await page.locator('.hamburger').first().click();
  await page.waitForTimeout(120);
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.waitForTimeout(360);

  const finalClosedContract = await menu.evaluate(el => {
    const style = getComputedStyle(el);
    const dropdown = el.querySelector('.nav-dropdown-menu');
    const dropdownStyle = dropdown ? getComputedStyle(dropdown) : null;
    return {
      maxHeight: style.maxHeight,
      opacity: style.opacity,
      visibility: style.visibility,
      pointerEvents: style.pointerEvents,
      dropdownPointerEvents: dropdownStyle?.pointerEvents || ''
    };
  });
  if (
    finalClosedContract.maxHeight !== '0px' ||
    finalClosedContract.opacity !== '0' ||
    finalClosedContract.visibility !== 'hidden' ||
    finalClosedContract.pointerEvents !== 'none' ||
    finalClosedContract.dropdownPointerEvents !== 'none'
  ) {
    throw new Error(
      label + ' repeated mobile navigation close exposed a stale interactive hit surface: ' +
      JSON.stringify(finalClosedContract)
    );
  }

}

const { server, getStderr } = startServer();
process.on('exit', () => stopServer(server));

try {
  await waitForServer(`${BASE_URL}/`);

  const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--enable-unsafe-swiftshader'] });

  try {
    await smokePage(
      browser,
      '/?holographic-smoke=1',
      async page => {
        // The bootstrap exposes an explicit readiness contract. Synchronize
        // against it instead of racing Projects thumbnail hydration.
        await page.waitForFunction(() => {
          const transition = document.querySelector('#pageTransition');
          return transition?.dataset.loading === 'ready' &&
            transition.getAttribute('aria-hidden') === 'true';
        }, null, { timeout: 6000 });

        const fixtureCard = page.locator('#portfolioGrid .project-card[data-project-id="holographic-smoke"]').first();
        await fixtureCard.waitFor({ state: 'visible', timeout: 3000 });
        await fixtureCard.click();
        await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });
        const holographic = page.locator('#lightboxMediaContainer .lightbox-holographic').first();
        await holographic.waitFor({ state: 'visible', timeout: 3000 });
        const fixedLight = await holographic.evaluate(el => ({
          x: el.style.getPropertyValue('--holo-light-x'),
          y: el.style.getPropertyValue('--holo-light-y')
        }));
        if (fixedLight.x !== '34%' || fixedLight.y !== '26%') {
          throw new Error('Mobile holographic light sources must begin at fixed, off-axis positions.');
        }
        const box = await holographic.boundingBox();
        if (!box) throw new Error('Mobile holographic fixture has no geometry.');

        const affordance = await holographic.evaluate(el => {
          const base = getComputedStyle(el);
          const hint = el.closest('.lightbox-media-item')?.querySelector('.lightbox-holographic-hint');
          const artwork = el.closest('.lightbox-artwork.has-holographic');
          const face = el.querySelector('.lightbox-holographic-front');
          const sheen = el.querySelector('.lightbox-holographic-front .lightbox-holographic-sheen');
          return {
            animationName: base.animationName,
            contain: base.contain,
            borderRadius: base.borderRadius,
            borderWidth: base.borderWidth,
            borderStyle: base.borderStyle,
            boxShadow: base.boxShadow,
            outlineStyle: base.outlineStyle,
            artworkOverflow: artwork ? getComputedStyle(artwork).overflow : '',
            environmentBlend: getComputedStyle(el.querySelector('.lightbox-holographic-environment')).mixBlendMode,
            environmentOpacity: Number.parseFloat(getComputedStyle(el.querySelector('.lightbox-holographic-environment')).opacity),
            grainImage: getComputedStyle(face?.querySelector('.lightbox-holographic-grain-layer')).backgroundImage,
            faceRadius: face ? getComputedStyle(face).borderRadius : '',
            faceOverflow: face ? getComputedStyle(face).overflow : '',
            hintFace: hint?.querySelector('[data-holo-face-label]')?.textContent || '',
            hintAction: getComputedStyle(hint?.querySelector('.lightbox-holographic-touch-action')).display === 'none' ? 'desktop' : 'touch',
            backTextureMode: el.querySelector('.lightbox-holographic-back .lightbox-holographic-texture')?.dataset.holoTextureMode || '',
            backTextureRepeat: el.querySelector('.lightbox-holographic-back .lightbox-holographic-texture')
              ? getComputedStyle(el.querySelector('.lightbox-holographic-back .lightbox-holographic-texture')).backgroundRepeat : '',
            sheenAnimation: sheen ? getComputedStyle(sheen).animationName : '',
            prismAnimation: getComputedStyle(el.querySelector('.lightbox-holographic-prism')).animationName,
            ribbonsAnimation: getComputedStyle(el.querySelector('.lightbox-holographic-ribbons')).animationName,
            flipTransition: getComputedStyle(el.querySelector('.lightbox-holographic-flip')).transitionDuration
          };
        });
        if (!affordance.animationName.includes('holo-idle-float') ||
            affordance.contain.includes('paint') ||
            affordance.borderRadius !== '0px' ||
            affordance.borderWidth !== '0px' || affordance.borderStyle !== 'none' ||
            affordance.boxShadow !== 'none' || affordance.outlineStyle !== 'none' ||
            affordance.artworkOverflow !== 'visible' ||
            affordance.environmentBlend !== 'soft-light' ||
            !(affordance.environmentOpacity > 0) ||
            !affordance.grainImage.includes('grain.webp') ||
            affordance.faceRadius !== '0px' ||
            affordance.faceOverflow !== 'hidden' ||
            affordance.hintFace !== 'FRONT' ||
            affordance.hintAction !== 'touch' ||
            affordance.backTextureMode !== 'tile' ||
            !affordance.backTextureRepeat.includes('repeat') ||
            !affordance.sheenAnimation.includes('holo-idle-sheen') ||
            !affordance.prismAnimation.includes('holo-prism-drift') ||
            !affordance.ribbonsAnimation.includes('holo-light-ribbons') ||
            Number.parseFloat(affordance.flipTransition) <= 0) {
          throw new Error('Mobile holographic surface is missing its intended affordance/geometry: ' + JSON.stringify(affordance));
        }
        const maskState = await holographic.evaluate(el => {
          const front = el.querySelector('.lightbox-holographic-front');
          const back = el.querySelector('.lightbox-holographic-back');
          const selectors = ['.lightbox-holographic-spectrum', '.lightbox-holographic-cosmos-bottom', '.lightbox-holographic-cosmos-middle', '.lightbox-holographic-cosmos-top', '.lightbox-holographic-grain-layer', '.lightbox-holographic-glitter-layer', '.lightbox-holographic-environment', '.lightbox-holographic-glare', '.lightbox-holographic-prism', '.lightbox-holographic-ribbons', '.lightbox-holographic-diffraction', '.lightbox-holographic-sparkles', '.lightbox-holographic-sheen', '.lightbox-holographic-texture'];
          const visibleMasks = face => selectors.flatMap(selector => {
            const layer = face?.querySelector(selector);
            if (!layer || getComputedStyle(layer).display === 'none') return [];
            return [{ selector, mask: layer.style.maskImage || '' }];
          });
          return { frontLayers: visibleMasks(front), backLayers: visibleMasks(back) };
        });
        if (maskState.frontLayers.some(value => !value.mask.includes('front-mask.svg')) ||
            maskState.backLayers.some(value => !value.mask.includes('back-mask.svg'))) {
          throw new Error(`Configured holographic faces must use their own mask: ${JSON.stringify(maskState)}`);
        }
        const textureState = await holographic.evaluate(el => {
          const texture = el.querySelector('.lightbox-holographic-front .lightbox-holographic-texture');
          const style = texture ? getComputedStyle(texture) : null;
          return { mode: el.dataset.holoTextureMode, repeat: style?.backgroundRepeat || '', tag: texture?.tagName || '' };
        });
        if (textureState.mode !== 'fill' ||
            textureState.repeat === 'repeat' || textureState.repeat === 'repeat repeat' ||
            textureState.tag !== 'SPAN') {
          throw new Error('Full-card foil textures must fill the whole face as a texture overlay, not a mask.');
        }
        const customNormalCanvas = holographic.locator('.lightbox-holographic-front .lightbox-holographic-normal-map').first();
        await customNormalCanvas.waitFor({ state: 'attached', timeout: 3000 });
        await page.waitForFunction(() => {
          const canvas = document.querySelector('#lightboxMediaContainer .lightbox-holographic-front .lightbox-holographic-normal-map');
          return !!canvas && !!canvas.dataset.normalMapStatus && canvas.dataset.normalMapStatus !== 'loading';
        }, null, { timeout: 6000 });
        const customNormalState = await customNormalCanvas.evaluate(canvas => ({
          status: canvas.dataset.normalMapStatus,
          patterns: Number(canvas.dataset.normalMapPatternCount),
          loaded: Number(canvas.dataset.normalMapLoadedCount),
          width: canvas.width,
          height: canvas.height
        }));
        if (customNormalState.status !== 'ready' || customNormalState.patterns !== 1 ||
            customNormalState.loaded !== 1 || customNormalState.width < 1 || customNormalState.height < 1) {
          throw new Error('Custom foil height map did not reach the WebGL normal renderer: ' + JSON.stringify(customNormalState));
        }

        // Quick movement must remain a normal Lightbox gesture: no foil
        // engagement before the hold threshold.
        await holographic.dispatchEvent('pointerdown', {
          pointerType: 'touch', isPrimary: true, pointerId: 81,
          clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, button: 0
        });
        await page.waitForTimeout(70);
        await holographic.dispatchEvent('pointermove', {
          pointerType: 'touch', isPrimary: true, pointerId: 81,
          clientX: box.x + box.width * .74, clientY: box.y + box.height * .24
        });
        const quickState = await holographic.evaluate(el => ({
          engaged: el.classList.contains('is-holo-touch-engaged'),
          x: el.style.getPropertyValue('--holo-x'),
          y: el.style.getPropertyValue('--holo-y')
        }));
        await holographic.dispatchEvent('pointerup', {
          pointerType: 'touch', isPrimary: true, pointerId: 81,
          clientX: box.x + box.width * .74, clientY: box.y + box.height * .24
        });
        if (quickState.engaged || quickState.x !== '50%' || quickState.y !== '50%') {
          throw new Error('Mobile holographic touch engaged before the hold threshold.');
        }

        // A deliberate hold engages the holographic surface; subsequent movement
        // is then allowed to prevent scrolling and drive the inverse foil.
        await holographic.dispatchEvent('pointerdown', {
          pointerType: 'touch', isPrimary: true, pointerId: 82,
          clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, button: 0
        });
        await page.waitForTimeout(260);
        const heldState = await holographic.evaluate(el => ({
          engaged: el.classList.contains('is-holo-touch-engaged'),
          x: el.style.getPropertyValue('--holo-x'),
          y: el.style.getPropertyValue('--holo-y')
        }));
        if (!heldState.engaged) {
          throw new Error('Mobile holographic touch did not engage after the hold threshold.');
        }

        await holographic.dispatchEvent('pointermove', {
          pointerType: 'touch', isPrimary: true, pointerId: 82,
          clientX: box.x + box.width * .74, clientY: box.y + box.height * .24
        });

        const touchMovePrevented = await holographic.evaluate(el => {
          const event = new Event('touchmove', { bubbles: true, cancelable: true });
          const rect = el.getBoundingClientRect();
          const touch = {
            clientX: rect.left + rect.width * .74,
            clientY: rect.top + rect.height * .24
          };
          Object.defineProperty(event, 'touches', { value: [touch] });
          Object.defineProperty(event, 'changedTouches', { value: [touch] });
          el.dispatchEvent(event);
          return event.defaultPrevented;
        });
        if (!touchMovePrevented) {
          throw new Error('Held mobile holographic touch did not cancel the native touch-scroll path.');
        }

        await page.waitForTimeout(40);
        const tiltState = await holographic.evaluate(el => ({
          x: Number.parseFloat(el.style.getPropertyValue('--holo-x')),
          y: Number.parseFloat(el.style.getPropertyValue('--holo-y')),
          fx: Number.parseFloat(el.style.getPropertyValue('--holo-foil-x')),
          fy: Number.parseFloat(el.style.getPropertyValue('--holo-foil-y')),
          lightX: el.style.getPropertyValue('--holo-light-x'),
          lightY: el.style.getPropertyValue('--holo-light-y'),
          engaged: el.classList.contains('is-holo-touch-engaged')
        }));
        await holographic.dispatchEvent('pointerup', {
          pointerType: 'touch', isPrimary: true, pointerId: 82,
          clientX: box.x + box.width * .74, clientY: box.y + box.height * .24
        });
        if (!tiltState.engaged ||
            !Number.isFinite(tiltState.x) || !Number.isFinite(tiltState.y) ||
            Math.abs((tiltState.x + tiltState.fx) - 100) > 1.5 ||
            Math.abs((tiltState.y + tiltState.fy) - 100) > 1.5) {
          throw new Error('Held mobile holographic gesture lost its inverse foil mapping.');
        }
        const heldLightX = Number.parseFloat(tiltState.lightX);
        const heldLightY = Number.parseFloat(tiltState.lightY);
        const expectedHeldLightX = Math.max(16, Math.min(84, 50 + ((50 - tiltState.x) * 0.68)));
        const expectedHeldLightY = Math.max(16, Math.min(84, 50 + ((50 - tiltState.y) * 0.68)));
        if (!Number.isFinite(heldLightX) || !Number.isFinite(heldLightY) ||
            Math.abs(heldLightX - expectedHeldLightX) > 1.5 ||
            Math.abs(heldLightY - expectedHeldLightY) > 1.5) {
          throw new Error('Held mobile gesture did not move the virtual studio light opposite the hand: ' +
            JSON.stringify({lightX: heldLightX, lightY: heldLightY, expectedX: expectedHeldLightX, expectedY: expectedHeldLightY}));
        }

        // Exercise real Chromium touch input (not just synthetic DOM events).
        // A quick vertical swipe on the card must scroll the Lightbox normally;
        // after an intentional hold, the same movement should drive foil instead
        // of changing the Lightbox scroll position.
        const nativeTouchScrollHost = page.locator('#lightbox').first();
        await page.evaluate(() => {
          const media = document.getElementById('lightboxMediaContainer');
          if (!media || media.querySelector('[data-holo-touch-scroll-fixture]')) return;
          const spacer = document.createElement('div');
          spacer.dataset.holoTouchScrollFixture = 'true';
          spacer.setAttribute('aria-hidden', 'true');
          spacer.style.cssText = 'height:480px;min-height:480px;flex:0 0 480px;pointer-events:none;';
          media.appendChild(spacer);
          const lightbox = document.getElementById('lightbox');
          if (lightbox) lightbox.scrollTop = 0;
        });
        const nativeScrollCapacity = await nativeTouchScrollHost.evaluate(el => ({
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight
        }));
        if (nativeScrollCapacity.scrollHeight <= nativeScrollCapacity.clientHeight + 80) {
          throw new Error('Mobile holographic native-touch fixture did not create a scrollable Lightbox.');
        }
        const touchSession = await page.context().newCDPSession(page);
        const dispatchTouch = (type, id, x, y) => touchSession.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: type === 'touchEnd' ? [] : [{
            id, x, y, radiusX: 2, radiusY: 2, force: 1
          }]
        });

        const nativeQuickBox = await holographic.boundingBox();
        if (!nativeQuickBox) throw new Error('Native-touch holographic fixture lost its geometry.');
        const quickStartX = nativeQuickBox.x + nativeQuickBox.width * 0.5;
        const quickStartY = nativeQuickBox.y + nativeQuickBox.height * 0.5;
        const quickScrollBefore = await nativeTouchScrollHost.evaluate(el => el.scrollTop);
        await dispatchTouch('touchStart', 91, quickStartX, quickStartY);
        await page.waitForTimeout(55);
        await dispatchTouch('touchMove', 91, quickStartX + 2, quickStartY - 42);
        await page.waitForTimeout(90);
        await dispatchTouch('touchEnd', 91, quickStartX + 2, quickStartY - 42);
        await page.waitForTimeout(100);
        const quickNativeState = await Promise.all([
          nativeTouchScrollHost.evaluate(el => el.scrollTop),
          holographic.evaluate(el => ({
            engaged: el.classList.contains('is-holo-touch-engaged'),
            x: el.style.getPropertyValue('--holo-x'),
            y: el.style.getPropertyValue('--holo-y')
          }))
        ]);
        const quickFoilX = Number.parseFloat(quickNativeState[1].x);
        const quickFoilY = Number.parseFloat(quickNativeState[1].y);
        if (quickNativeState[0] < quickScrollBefore + 4 ||
            quickNativeState[1].engaged ||
            !Number.isFinite(quickFoilX) || !Number.isFinite(quickFoilY) ||
            Math.abs(quickFoilX - 50) > 1 ||
            Math.abs(quickFoilY - 50) > 1) {
          throw new Error('A quick native mobile swipe was not preserved as normal Lightbox scrolling: ' +
            JSON.stringify({ scrollBefore: quickScrollBefore, scrollAfter: quickNativeState[0], foil: quickNativeState[1] }));
        }

        const heldNativeBox = await holographic.boundingBox();
        if (!heldNativeBox) throw new Error('Held native-touch holographic fixture lost its geometry.');
        await nativeTouchScrollHost.evaluate(el => { el.scrollTop = 0; });
        await page.waitForTimeout(60);
        const heldStartX = heldNativeBox.x + heldNativeBox.width * 0.5;
        const heldStartY = heldNativeBox.y + heldNativeBox.height * 0.5;
        const heldScrollBefore = await nativeTouchScrollHost.evaluate(el => el.scrollTop);
        const heldFoilBefore = await holographic.evaluate(el => el.style.getPropertyValue('--holo-x'));
        await dispatchTouch('touchStart', 92, heldStartX, heldStartY);
        await page.waitForTimeout(260);
        const nativeHoldEngaged = await holographic.evaluate(el => el.classList.contains('is-holo-touch-engaged'));
        if (!nativeHoldEngaged) {
          await dispatchTouch('touchEnd', 92, heldStartX, heldStartY);
          throw new Error('A native mobile hold did not engage holographic interaction.');
        }
        await dispatchTouch('touchMove', 92, heldStartX + 30, heldStartY - 38);
        await page.waitForTimeout(100);
        const heldNativeState = await Promise.all([
          nativeTouchScrollHost.evaluate(el => el.scrollTop),
          holographic.evaluate(el => ({
            engaged: el.classList.contains('is-holo-touch-engaged'),
            x: el.style.getPropertyValue('--holo-x'),
            y: el.style.getPropertyValue('--holo-y')
          }))
        ]);
        await dispatchTouch('touchEnd', 92, heldStartX + 30, heldStartY - 38);
        await touchSession.detach();
        if (!heldNativeState[1].engaged ||
            Math.abs(heldNativeState[0] - heldScrollBefore) > 1 ||
            heldNativeState[1].x === heldFoilBefore) {
          throw new Error('A held native mobile holographic gesture scrolled the Lightbox instead of driving foil: ' +
            JSON.stringify({ scrollBefore: heldScrollBefore, scrollAfter: heldNativeState[0], foilBefore: heldFoilBefore, foilAfter: heldNativeState[1] }));
        }
        await nativeTouchScrollHost.evaluate(el => { el.scrollTop = 0; });
        await page.waitForTimeout(60);

        await page.locator('#lightboxClose').first().click();
        await page.waitForTimeout(100);

        // Exercise Cosmos through the renderer config path, not only by swapping
        // data-holo-style during the CSS preset audit.
        const cosmosCard = page.locator('#portfolioGrid .project-card[data-project-id="holographic-cosmos-smoke"]').first();
        await cosmosCard.waitFor({ state: 'visible', timeout: 3000 });
        await cosmosCard.click();
        await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });
        const cosmosHolographic = page.locator('#lightboxMediaContainer .lightbox-holographic').first();
        await cosmosHolographic.waitFor({ state: 'visible', timeout: 3000 });
        const cosmosMaterial = await cosmosHolographic.evaluate(el => {
          const face = el.querySelector('.lightbox-holographic-front');
          const layerNames = Array.from(face.querySelectorAll('[data-holo-layer]'))
            .map(layer => layer.dataset.holoLayer);
          const bottom = face.querySelector('.lightbox-holographic-cosmos-bottom');
          const middle = face.querySelector('.lightbox-holographic-cosmos-middle');
          const top = face.querySelector('.lightbox-holographic-cosmos-top');
          const readFoilLayer = layer => ({
            background: getComputedStyle(layer).backgroundImage,
            mask: layer.style.maskImage || layer.style.webkitMaskImage,
            maskMode: layer.style.maskMode || layer.style.webkitMaskSourceType
          });
          return {
            style: el.dataset.holoStyle,
            bottom: readFoilLayer(bottom),
            middle: readFoilLayer(middle),
            top: readFoilLayer(top),
            grain: getComputedStyle(face.querySelector('.lightbox-holographic-grain-layer')).backgroundImage,
            layerNames
          };
        });
        if (cosmosMaterial.style !== 'cosmos' ||
            !cosmosMaterial.bottom.background.includes('conic-gradient') ||
            !cosmosMaterial.bottom.mask.includes('cosmos-bottom.png') ||
            !cosmosMaterial.bottom.maskMode.includes('luminance') ||
            !cosmosMaterial.middle.background.includes('conic-gradient') ||
            !cosmosMaterial.middle.mask.includes('cosmos-middle-trans.png') ||
            !cosmosMaterial.middle.maskMode.includes('luminance') ||
            !cosmosMaterial.top.background.includes('conic-gradient') ||
            !cosmosMaterial.top.mask.includes('cosmos-top-trans.png') ||
            !cosmosMaterial.top.maskMode.includes('luminance') ||
            !cosmosMaterial.grain.includes('grain.webp') ||
            cosmosMaterial.layerNames.indexOf('cosmos-bottom') < 0 ||
            cosmosMaterial.layerNames.indexOf('cosmos-middle') <= cosmosMaterial.layerNames.indexOf('cosmos-bottom') ||
            cosmosMaterial.layerNames.indexOf('cosmos-top') <= cosmosMaterial.layerNames.indexOf('cosmos-middle')) {
          throw new Error('Cosmos renderer profile must apply each grayscale texture as its own luminance mask over an ordered spectral layer: ' + JSON.stringify(cosmosMaterial));
        }
        for (const asset of ['cosmos-bottom.png', 'cosmos-middle-trans.png', 'cosmos-top-trans.png']) {
          const response = await page.request.get(`${BASE_URL}/assets/holographic/${asset}`);
          if (!response.ok()) throw new Error('Cosmos texture asset is not reachable: ' + asset + ' (' + response.status() + ')');
        }
        const cosmosNormalCanvas = cosmosHolographic.locator('.lightbox-holographic-front .lightbox-holographic-normal-map').first();
        await cosmosNormalCanvas.waitFor({ state: 'attached', timeout: 3000 });
        await page.waitForFunction(() => {
          const canvas = document.querySelector('#lightboxMediaContainer .lightbox-holographic-front .lightbox-holographic-normal-map');
          return canvas?.dataset.normalMapStatus === 'ready';
        }, null, { timeout: 8000 });
        const cosmosNormalState = await cosmosNormalCanvas.evaluate(canvas => ({
          status: canvas.dataset.normalMapStatus,
          patterns: Number(canvas.dataset.normalMapPatternCount),
          loaded: Number(canvas.dataset.normalMapLoadedCount),
          width: canvas.width,
          height: canvas.height
        }));
        if (cosmosNormalState.status !== 'ready' || cosmosNormalState.patterns !== 3 ||
            cosmosNormalState.loaded !== 3 || cosmosNormalState.width < 1 || cosmosNormalState.height < 1) {
          throw new Error('All three Cosmos patterns must be blended by the WebGL normal renderer: ' + JSON.stringify(cosmosNormalState));
        }
        await page.locator('#lightboxClose').first().click();
        await page.waitForTimeout(100);
      },
      { width: 390, height: 844 },
      async page => {
        const fixture = [{
          id: 'holographic-smoke',
          title: 'Holographic Smoke',
          subtitle: 'Interactive image fixture',
          badge: '',
          filters: [],
          description: '',
          thumbnail: { type: 'image', src: 'assets/projects/holographic-smoke/front.svg', focus: '50% 50%', zoom: 1 },
          media: [{
            type: 'image',
            src: 'assets/projects/holographic-smoke/front.svg',
            caption: 'Holographic front',
            orientation: 'square',
            holographic: {
              style: 'iridescent',
              intensity: 0.8,
              textureMode: 'fill',
              texture: 'assets/projects/holographic-smoke/foil.svg',
              back: 'assets/projects/holographic-smoke/back.svg',
              mask: 'assets/projects/holographic-smoke/front-mask.svg',
              backTexture: 'assets/projects/holographic-smoke/foil.svg',
              backTextureMode: 'tile',
              backMask: 'assets/projects/holographic-smoke/back-mask.svg'
            }
          }]
        }, {
          id: 'holographic-cosmos-smoke',
          title: 'Cosmos Holographic Smoke',
          subtitle: 'Cosmos texture fixture',
          badge: '',
          filters: [],
          description: '',
          thumbnail: { type: 'image', src: 'assets/projects/holographic-smoke/front.svg', focus: '50% 50%', zoom: 1 },
          media: [{
            type: 'image',
            src: 'assets/projects/holographic-smoke/front.svg',
            caption: 'Cosmos foil front',
            orientation: 'square',
            holographic: { style: 'cosmos', intensity: 0.75, textureMode: 'fill' }
          }]
        }];
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#ccc"/></svg>';
        const maskSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#000"/><path d="M0 0H48V100H0Z" fill="#fff"/></svg>';
        await page.route('**/data/projects.json*', async route => {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
        });
        await page.route('**/assets/projects/holographic-smoke/**', async route => {
          const body = route.request().url().includes('-mask.svg') ? maskSvg : svg;
          await route.fulfill({ status: 200, contentType: 'image/svg+xml', body });
        });
      }
    );

    await smokePage(browser, '/', async page => {
      const funkoCard = page.locator('#portfolioGrid .project-card[data-project-id="funko-pop-test"]').first();
      await funkoCard.waitFor({ state: 'visible', timeout: 4000 });
      await funkoCard.click();
      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });
      const funkoHolo = page.locator('#lightboxMediaContainer .lightbox-holographic').first();
      await funkoHolo.waitFor({ state: 'visible', timeout: 3000 });
      await page.waitForFunction(() => {
        const image = document.querySelector('#lightboxMediaContainer .lightbox-holographic-front img');
        return image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
      }, null, { timeout: 4000 });
      const uploadedArtContract = await funkoHolo.evaluate(el => {
        const image = el.querySelector('.lightbox-holographic-front img');
        const backImage = el.querySelector('.lightbox-holographic-back img');
        const artSlot = el.closest('.lightbox-artwork');
        const diffraction = el.querySelector('.lightbox-holographic-diffraction');
        const sparkles = el.querySelector('.lightbox-holographic-sparkles');
        const spectrum = el.querySelector('.lightbox-holographic-spectrum');
        const hint = el.closest('.lightbox-media-item')?.querySelector('.lightbox-holographic-hint');
        const desktopAction = hint?.querySelector('.lightbox-holographic-desktop-action');
        const sheen = el.querySelector('.lightbox-holographic-front .lightbox-holographic-sheen');
        const caption = el.closest('.lightbox-media-item')?.querySelector('.media-caption');
        return {
          src: image?.getAttribute('src') || '',
          naturalWidth: image?.naturalWidth || 0,
          naturalHeight: image?.naturalHeight || 0,
          naturalRatio: image?.naturalWidth && image?.naturalHeight ? image.naturalWidth / image.naturalHeight : 0,
          slotRatio: Number.parseFloat(artSlot?.style.getPropertyValue('--lightbox-artwork-ratio') || '0'),
          // Assert artwork-alpha coverage on the always-active spectrum layer.
          // Optional preset overlays are intentionally left unmasked when hidden.
          alphaMode: spectrum?.style.maskMode || '',
          alphaMask: spectrum?.style.maskImage || '',
          hasDiffraction: !!diffraction,
          hasSparkles: !!sparkles,
          defaultBackMirrored: backImage?.classList.contains('lightbox-holographic-default-reverse') || false,
          backSrc: backImage?.getAttribute('src') || '',
          centeredHint: hint ? getComputedStyle(hint).justifyContent === 'center' : false,
          desktopActionText: desktopAction?.textContent?.trim() || '',
          desktopActionDisplay: desktopAction ? getComputedStyle(desktopAction).display : 'missing',
          surfaceIdleAnimation: getComputedStyle(el).animationName,
          sheenDisplay: sheen ? getComputedStyle(sheen).display : 'missing',
          sheenAnimation: sheen ? getComputedStyle(sheen).animationName : 'missing',
          hintAfterArtwork: !!(hint && artSlot && (artSlot.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING)),
          hintBeforeCaption: !caption || !!(hint && (hint.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING))
        };
      });
      if (!uploadedArtContract.src.includes('funko-pop/Asset') ||
          uploadedArtContract.naturalWidth < 100 ||
          uploadedArtContract.naturalHeight < 100 ||
          Math.abs(uploadedArtContract.naturalRatio - uploadedArtContract.slotRatio) > .015 ||
          uploadedArtContract.alphaMode !== 'alpha' ||
          !uploadedArtContract.alphaMask.includes('funko-pop/Asset') ||
          uploadedArtContract.alphaMask.includes('%2520') ||
          !uploadedArtContract.hasDiffraction || !uploadedArtContract.hasSparkles ||
          !uploadedArtContract.defaultBackMirrored ||
          !uploadedArtContract.backSrc.includes('funko-pop/Asset') ||
          !uploadedArtContract.centeredHint || !uploadedArtContract.hintAfterArtwork || !uploadedArtContract.hintBeforeCaption ||
          !uploadedArtContract.desktopActionText.includes('CLICK / MOVE') ||
          uploadedArtContract.desktopActionDisplay === 'none' ||
          uploadedArtContract.surfaceIdleAnimation !== 'holo-idle-float' ||
          uploadedArtContract.sheenDisplay === 'none' ||
          !uploadedArtContract.sheenAnimation.includes('holo-idle-sheen')) {
        throw new Error('Uploaded transparent artwork did not receive the full holographic sizing/flip/discoverability contract: ' + JSON.stringify(uploadedArtContract));
      }

      // Desktop must react to real pointer movement, with the foil reflection
      // travelling opposite the pointer rather than remaining a static overlay.
      const desktopHoloBox = await funkoHolo.boundingBox();
      if (!desktopHoloBox) throw new Error('Desktop holographic artwork lost its interaction geometry.');
      await page.mouse.move(
        desktopHoloBox.x + desktopHoloBox.width * 0.74,
        desktopHoloBox.y + desktopHoloBox.height * 0.28
      );
      await page.waitForTimeout(120);
      const desktopTiltState = await funkoHolo.evaluate(el => {
        const read = name => Number.parseFloat(el.style.getPropertyValue(name));
        return {
          x: read('--holo-x'),
          y: read('--holo-y'),
          foilX: read('--holo-foil-x'),
          foilY: read('--holo-foil-y')
        };
      });
      if (
        !Number.isFinite(desktopTiltState.x) ||
        !Number.isFinite(desktopTiltState.y) ||
        !Number.isFinite(desktopTiltState.foilX) ||
        !Number.isFinite(desktopTiltState.foilY) ||
        Math.abs(desktopTiltState.x - 50) < 5 ||
        Math.abs(desktopTiltState.y - 50) < 5 ||
        Math.abs((desktopTiltState.x + desktopTiltState.foilX) - 100) > 1.5 ||
        Math.abs((desktopTiltState.y + desktopTiltState.foilY) - 100) > 1.5
      ) {
        throw new Error('Desktop holographic pointer movement did not drive the inverse foil reflection: ' + JSON.stringify(desktopTiltState));
      }

      // A tap on grouped artwork opens the full-screen Inspector without
      // consuming the same tap as a foil flip. The following real pointer click
      // inside Inspect must still flip the foil to its mirrored reverse.
      await funkoHolo.click({ force: true });
      const inspectMode = page.locator('.lightbox-inspect-mode');
      await inspectMode.waitFor({ state: 'visible', timeout: 2000 });
      const inspectedHolo = inspectMode.locator('.lightbox-holographic').first();
      await inspectedHolo.waitFor({ state: 'visible', timeout: 2000 });
      await page.waitForTimeout(500); // let the card-to-viewport transition settle
      const inspectorFoilLayers = await inspectedHolo.evaluate(el => {
        const positionOf = selector => {
          const node = el.querySelector(selector);
          return node ? getComputedStyle(node).position : 'missing';
        };
        return {
          surface: getComputedStyle(el).position,
          inner: positionOf('.lightbox-holographic-inner'),
          flip: positionOf('.lightbox-holographic-flip'),
          frontFace: positionOf('.lightbox-holographic-front'),
          pointerEvents: getComputedStyle(el).pointerEvents
        };
      });
      if (
        inspectorFoilLayers.surface !== 'relative' ||
        inspectorFoilLayers.inner !== 'absolute' ||
        inspectorFoilLayers.flip !== 'absolute' ||
        inspectorFoilLayers.frontFace !== 'absolute' ||
        inspectorFoilLayers.pointerEvents === 'none'
      ) {
        throw new Error('Portaled Inspector lost the holographic positioned-layer/interaction styles: ' + JSON.stringify(inspectorFoilLayers));
      }
      const inspectorPresentation = await inspectMode.evaluate(overlay => {
        const stage = overlay.querySelector('.lightbox-inspect-stage');
        const artwork = overlay.querySelector('.lightbox-artwork');
        const stageRect = stage?.getBoundingClientRect();
        const artworkRect = artwork?.getBoundingClientRect();
        const back = overlay.querySelector('.lightbox-inspect-back');
        const title = overlay.querySelector('.lightbox-inspect-title')?.textContent?.trim() || '';
        const description = overlay.querySelector('.lightbox-inspect-description')?.textContent?.trim() || '';
        const instructions = overlay.querySelector('.lightbox-inspect-instructions')?.textContent?.trim() || '';
        const artworkFitsStage = Boolean(stageRect && artworkRect &&
          artworkRect.width > 0 && artworkRect.height > 0 &&
          artworkRect.left >= stageRect.left - 1 &&
          artworkRect.top >= stageRect.top - 1 &&
          artworkRect.right <= stageRect.right + 1 &&
          artworkRect.bottom <= stageRect.bottom + 1);
        return {
          overlayZ: Number.parseInt(getComputedStyle(overlay).zIndex, 10),
          artworkFitsStage,
          descriptionMatchesArtworkCaption: !description || description === title,
          instructionLength: instructions.length,
          backText: back?.textContent?.trim() || '',
          backLabel: back?.getAttribute('aria-label') || ''
        };
      });
      if (inspectorPresentation.overlayZ < 10000 ||
          !inspectorPresentation.artworkFitsStage ||
          !inspectorPresentation.descriptionMatchesArtworkCaption ||
          inspectorPresentation.instructionLength > 70 ||
          inspectorPresentation.backText !== '←' ||
          !inspectorPresentation.backLabel) {
        throw new Error('Inspector safe-fit/layer/back-button contract failed: ' + JSON.stringify(inspectorPresentation));
      }
      if (await inspectedHolo.evaluate(el => el.classList.contains('is-flipped'))) {
        throw new Error('Opening grouped Inspect should not also flip the foil on the same click.');
      }
      await inspectedHolo.click({ force: true });
      if (!(await inspectedHolo.evaluate(el => el.classList.contains('is-flipped')))) {
        throw new Error('Inspected artwork did not flip to its default mirrored reverse inside Inspect.');
      }
      // The Inspector is portaled above the Lightbox. Close it through its own
      // Back control before interacting with the Lightbox close button beneath it.
      await inspectMode.locator('.lightbox-inspect-back').click();
      await inspectMode.waitFor({ state: 'detached', timeout: 2000 });
      await page.locator('#lightboxClose').first().click();
      await page.locator('#lightbox.active').waitFor({ state: 'detached', timeout: 2000 });
    }, { width: 1280, height: 900 });

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
      const cacheVersions = [
        runtimeCacheChain.scriptVersion,
        runtimeCacheChain.bootstrapVersion,
        runtimeCacheChain.compositionVersion
      ];
      if (!cacheVersions[0] || cacheVersions.some(version => version !== cacheVersions[0])) {
        throw new Error(`Public runtime cache chain is stale or split: ${JSON.stringify(runtimeCacheChain)}`);
      }

      const cards = await page.locator('#portfolioGrid .project-card').count();
      if (cards < 1) throw new Error(`Works page rendered no project cards (found ${cards}).`);

      const socialLabels = await page.locator('.social-icons a').evaluateAll(links =>
        links.map(link => link.getAttribute('aria-label') || '').filter(Boolean)
      );
      for (const requiredLabel of ['Instagram', 'TikTok', 'YouTube', 'Email']) {
        if (!socialLabels.includes(requiredLabel)) {
          throw new Error(`Works page is missing the rendered ${requiredLabel} contact link: ${JSON.stringify(socialLabels)}`);
        }
      }
      if (new Set(socialLabels).size !== socialLabels.length) {
        throw new Error(`Works page rendered duplicate contact/social labels: ${JSON.stringify(socialLabels)}`);
      }

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

      await page.waitForFunction(
        () => document.querySelectorAll('#heroBanner .slide').length > 0,
        { timeout: 5000 }
      ).catch(() => {});

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

      await assertPublicFilterNavigation(page, {
        href: '#3d-motion',
        expectedHash: '#3d-motion',
        label: 'Desktop Works'
      });
      await allFilter.click();
      await page.waitForTimeout(420);

      const filterButtons = page.locator('.filter-tabs .filter-btn, .filter-tabs .tab-btn');
      const filterCount = await filterButtons.count();
      if (filterCount < 2) throw new Error(`Works filter UI rendered too few filters (found ${filterCount}).`);

      const filterColor = await filterButtons.first().evaluate(el => getComputedStyle(el).color);
      if (!filterColor || filterColor === 'rgba(0, 0, 0, 0)') throw new Error('Works filter button styling did not load.');

      const secondaryFilter = filterButtons.nth(1);
      await assertFilterButtonHitTarget(page, 'Desktop Works');
      await allFilter.click();
      await page.waitForTimeout(120);
      const preFilterGeometry = await page.evaluate(() => {
        const grid = document.querySelector('#portfolioGrid')?.getBoundingClientRect();
        const wrapper = document.querySelector('.portfolio-wrapper')?.getBoundingClientRect();
        const card = document.querySelector('#portfolioGrid .project-card');
        return {
          grid: grid ? { x: grid.x, y: grid.y, width: grid.width } : null,
          wrapper: wrapper ? { x: wrapper.x, y: wrapper.y, width: wrapper.width } : null,
          cardWidth: card?.getBoundingClientRect?.().width || 0
        };
      });
      await secondaryFilter.click();
      await page.waitForTimeout(90);

      const midFilterGeometry = await page.evaluate(() => {
        const grid = document.querySelector('#portfolioGrid')?.getBoundingClientRect();
        const wrapper = document.querySelector('.portfolio-wrapper')?.getBoundingClientRect();
        const cards = Array.from(document.querySelectorAll('#portfolioGrid .project-card'))
          .filter(card => getComputedStyle(card).display !== 'none');
        return {
          grid: grid ? { x: grid.x, y: grid.y, width: grid.width } : null,
          wrapper: wrapper ? { x: wrapper.x, y: wrapper.y, width: wrapper.width } : null,
          cardWidths: cards.slice(0, 6).map(card => card.getBoundingClientRect().width)
        };
      });
      if (!preFilterGeometry.grid || !midFilterGeometry.grid ||
          Math.abs(preFilterGeometry.grid.x - midFilterGeometry.grid.x) > 2 ||
          Math.abs(preFilterGeometry.grid.y - midFilterGeometry.grid.y) > 2 ||
          Math.abs(preFilterGeometry.grid.width - midFilterGeometry.grid.width) > 2) {
        throw new Error(`Works filter transition changed the gallery layout footprint mid-animation: before=${JSON.stringify(preFilterGeometry.grid)} after=${JSON.stringify(midFilterGeometry.grid)}`);
      }
      if (preFilterGeometry.cardWidth > 0 && midFilterGeometry.cardWidths.some(width => Math.abs(width - preFilterGeometry.cardWidth) > 2)) {
        throw new Error(`Works filter transition changed project-card track width mid-animation: before=${preFilterGeometry.cardWidth} after=${JSON.stringify(midFilterGeometry.cardWidths)}`);
      }

      const midFilterMotion = await page.locator('#portfolioGrid .project-card').evaluateAll(cards =>
        cards
          .filter(card => getComputedStyle(card).display !== 'none')
          .slice(0, 6)
          .map(card => {
            const style = getComputedStyle(card);
            return {
              delay: style.transitionDelay,
              duration: style.transitionDuration,
              inlineTransform: card.style.transform
            };
          })
      );
      if (!midFilterMotion.length) throw new Error('Works filter transition produced no visible project cards.');
      if (midFilterMotion.some(item => item.inlineTransform?.includes('scale('))) {
        throw new Error('Works filter transition regressed into per-card scale motion.');
      }
      if (midFilterMotion.some(item => item.delay.split(',').some(value => parseFloat(value) !== 0))) {
        throw new Error('Works filter transition reintroduced staggered card delays.');
      }
      if (midFilterMotion.some(item => item.duration.split(',').some(value => Math.abs(parseFloat(value) - 0.36) > 0.02))) {
        throw new Error('Works filter transition lost its unified 360ms motion duration.');
      }

      await page.waitForTimeout(330);
      const filteredCards = await page.locator('#portfolioGrid .project-card').evaluateAll(
        cards => cards.filter(card => getComputedStyle(card).display !== 'none').length
      );
      if (filteredCards < 1) throw new Error('Works filter interaction hid every project unexpectedly.');
      if (await secondaryFilter.getAttribute('data-filter') === 'all') throw new Error('Works secondary filter fixture is unexpectedly ALL.');

      const visibleFilteredCards = await page.locator('#portfolioGrid .project-card').evaluateAll(cards =>
        cards
          .filter(card => getComputedStyle(card).display !== 'none')
          .map(card => ({
            id: card.getAttribute('data-project-id') || '',
            title: card.querySelector('.glass-info h3')?.textContent?.trim() || ''
          }))
      );

      // The Lightbox is initialized before Gallery completes startup so its
      // media warm-up can begin early. Once Gallery is ready, navigation must
      // still use Gallery's filtered-card contract rather than every DOM card.
      const totalProjectCards = await page.locator('#portfolioGrid .project-card').count();
      if (filteredCards > 0 && filteredCards < totalProjectCards) {
        const filteredIds = new Set(visibleFilteredCards.map(item => item.id).filter(Boolean));
        const filteredFirst = page.locator('#portfolioGrid .project-card:visible').first();
        await filteredFirst.click();
        await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });
        if (filteredCards > 1) {
          await page.locator('.lightbox-next').first().click();
          await page.waitForTimeout(340);
          const navigatedTitle = (await page.locator('#modalTitle').textContent() || '').trim();
          const navigatedId = await page.locator('#portfolioGrid .project-card').evaluateAll(cards => {
            const title = document.querySelector('#modalTitle')?.textContent?.trim() || '';
            const match = cards.find(card =>
              getComputedStyle(card).display !== 'none' &&
              card.querySelector('.glass-info h3')?.textContent?.trim() === title
            );
            return match?.getAttribute('data-project-id') || '';
          });
          if (!navigatedId || !filteredIds.has(navigatedId)) {
            throw new Error(
              'Filtered Lightbox navigation escaped Gallery active set: title=' +
              JSON.stringify(navigatedTitle) + ', id=' + JSON.stringify(navigatedId)
            );
          }
        }
        await page.locator('#lightboxClose').click();
        await page.waitForTimeout(120);
      }

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
        const visibleProjectCount = await page.locator('#portfolioGrid .project-card').evaluateAll(
          cards => cards.filter(card => getComputedStyle(card).display !== 'none').length
        );
        await nextButton.click();
        await page.waitForTimeout(120);
        await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });

        if (visibleProjectCount > 1) {
          const lightboxTransitionState = await page.evaluate(() => {
            const unit = document.querySelector('.lightbox-modal .modal-interior');
              const controls = document.querySelector('.lightbox-controls');
              const lightboxModal = document.querySelector('.lightbox-modal');
              const controlsAreSiblingLayer = !!controls && !!lightboxModal &&
                controls.parentElement === lightboxModal.parentElement &&
                controls !== lightboxModal &&
                !controls.closest('.modal-interior');
            const children = Array.from(document.querySelectorAll(
              '#lightboxMediaContainer .lightbox-media-item, .lightbox-modal .modal-header, .lightbox-modal .modal-full-desc'
            ));
            const read = el => {
              const style = el ? getComputedStyle(el) : null;
              return {
                exists: !!el,
                opacity: style?.opacity || '',
                transform: style?.transform || '',
                filter: style?.filter || '',
                transitionDuration: style?.transitionDuration || '',
                transitionProperty: style?.transitionProperty || ''
              };
            };
            return { controlsAreSiblingLayer, unit: read(unit), children: children.map(read) };
          });

          const unit = lightboxTransitionState.unit;
          if (
            !unit.exists ||
            parseFloat(unit.opacity || '1') >= 0.95 ||
            unit.transform === 'none' ||
            !unit.filter.includes('blur') ||
            !unit.transitionProperty.includes('opacity') ||
            !unit.transitionProperty.includes('transform') ||
            !unit.transitionProperty.includes('filter') ||
            unit.transitionDuration.split(',').some(value => Math.abs(parseFloat(value) - 0.28) > 0.02)
          ) {
            throw new Error(
              'Lightbox project transition lost unified modal-interior translate/fade/blur motion: ' +
              JSON.stringify(lightboxTransitionState)
            );
          }
          if (!lightboxTransitionState.controlsAreSiblingLayer) {
            throw new Error('Lightbox navigation controls are nested inside the project transition container.');
          }
          if (lightboxTransitionState.children.some(item =>
            item.transform !== 'none' ||
            item.transitionProperty.includes('transform') ||
            item.transitionProperty.includes('opacity')
          )) {
            throw new Error(
              'Lightbox child elements retained independent transition motion instead of moving with modal-interior: ' +
              JSON.stringify(lightboxTransitionState)
            );
          }
        }
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
      const navigationControls = await page.evaluate(() => {
        const layer=document.querySelector('.lightbox-controls');
        const buttons=Array.from(document.querySelectorAll('#lightboxClose, .lightbox-prev, .lightbox-next'));
        return {
          blend:layer ? getComputedStyle(layer).mixBlendMode : '',
          buttons:buttons.map(button=>{
            const style=getComputedStyle(button);
            const pseudo=getComputedStyle(button,'::before');
            return {
              color:style.color,
              border:style.borderStyle,
              pseudoBackground:pseudo.backgroundColor,
              pseudoBorderRadius:pseudo.borderRadius
            };
          })
        };
      });
      if(navigationControls.blend!=='normal') {
        throw new Error('Lightbox controls are not using normal compositing: '+navigationControls.blend);
      }
      navigationControls.buttons.forEach(button=>{
        if(button.color!=='rgb(255, 255, 255)' || button.border!=='none'){
          throw new Error('Lightbox controls are not stable white/borderless: '+JSON.stringify(button));
        }
        if(
          !button.pseudoBackground ||
          button.pseudoBackground === 'rgba(0, 0, 0, 0)' ||
          !(
            button.pseudoBackground.startsWith('rgba(0, 0, 0,') ||
            button.pseudoBackground.startsWith('rgb(0, 0, 0')
          )
        ){
          throw new Error('Lightbox control backing layer is missing its transparent dark boundary: '+JSON.stringify(button));
        }
      });

      const projectDescriptionTypography = await page.locator('#modalFullDesc').evaluate(el => {
        const style = getComputedStyle(el);
        return {
          textAlign: style.textAlign,
          textAlignLast: style.textAlignLast,
          textJustify: style.textJustify,
          hyphens: style.hyphens,
          overflowWrap: style.overflowWrap
        };
      });
      if (projectDescriptionTypography.textAlign !== 'justify') {
        throw new Error('Lightbox project description is not justified: ' + JSON.stringify(projectDescriptionTypography));
      }
      if (projectDescriptionTypography.textAlignLast !== 'left') {
        throw new Error('Lightbox project description last line is not left-aligned: ' + JSON.stringify(projectDescriptionTypography));
      }
      if (projectDescriptionTypography.hyphens !== 'auto') {
        throw new Error('Lightbox project description is missing automatic hyphenation: ' + JSON.stringify(projectDescriptionTypography));
      }
      if (projectDescriptionTypography.overflowWrap !== 'break-word') {
        throw new Error('Lightbox project description does not use controlled word wrapping: ' + JSON.stringify(projectDescriptionTypography));
      }

      const lightboxControlGeometry = await page.locator('.lightbox-next').evaluate(el => {
        const buttonStyle = getComputedStyle(el);
        const icon = el.querySelector('i');
        const iconStyle = icon ? getComputedStyle(icon) : null;
        const buttonFont = parseFloat(buttonStyle.fontSize || '0');
        const iconFont = parseFloat(iconStyle?.fontSize || '0');
        return {
          buttonFont,
          iconFont,
          ratio: buttonFont > 0 ? iconFont / buttonFont : 0,
          border: buttonStyle.border,
          background: buttonStyle.backgroundColor,
          strokeWidth: iconStyle?.webkitTextStrokeWidth || '',
          strokeColor: iconStyle?.webkitTextStrokeColor || ''
        };
      });
      if (lightboxControlGeometry.ratio < 1.14 || lightboxControlGeometry.ratio > 1.16) {
        throw new Error(
          'Lightbox control icon size is not the required +15% relative scale: ' +
          JSON.stringify(lightboxControlGeometry)
        );
      }
      if (lightboxControlGeometry.strokeWidth !== '1px') {
        throw new Error('Lightbox control icon lost its 1px glyph outline: ' + lightboxControlGeometry.strokeWidth);
      }
      if (lightboxControlGeometry.border !== '0px none rgb(0, 0, 0)' && !lightboxControlGeometry.border.startsWith('0px')) {
        throw new Error('Lightbox control reintroduced a rectangular border: ' + lightboxControlGeometry.border);
      }
      if (lightboxControlGeometry.background !== 'rgba(0, 0, 0, 0)') {
        throw new Error('Lightbox control reintroduced a visible background box: ' + lightboxControlGeometry.background);
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

      const lottiePlayer = page.locator('#lightboxMediaContainer .lightbox-media-item lottie-player').first();
      try {
        await page.waitForFunction(() => {
          const player = document.querySelector('#lightboxMediaContainer .lightbox-media-item lottie-player');
          const artwork = player?.parentElement;
          if (!artwork) return false;
          const rect = artwork.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && Math.abs((rect.width / rect.height) - (440 / 478)) < 0.01;
        }, null, { timeout: 5000 });
      } catch (error) {
        const debug = await page.evaluate(() => {
          const player = document.querySelector('#lightboxMediaContainer .lightbox-media-item lottie-player');
          const artwork = player?.parentElement;
          if (!player || !artwork) return { player: !!player, artwork: !!artwork };
          const style = getComputedStyle(artwork);
          return {
            playerConnected: player.isConnected,
            artworkConnected: artwork.isConnected,
            inlineStyle: artwork.getAttribute('style') || '',
            cssRatio: style.aspectRatio || '',
            cssVariable: style.getPropertyValue('--lightbox-artwork-ratio') || '',
            renderedRatio: artwork.getBoundingClientRect().height
              ? artwork.getBoundingClientRect().width / artwork.getBoundingClientRect().height
              : 0,
            width: artwork.getBoundingClientRect().width,
            height: artwork.getBoundingClientRect().height,
            preserveAspectRatio: player.getAttribute('preserveAspectRatio') || '',
            dataset: { density: document.querySelector('#lightboxMediaContainer')?.dataset.mediaDensity || '' }
          };
        });
        throw new Error('Lightbox Lottie intrinsic-ratio assertion timed out: ' + JSON.stringify(debug));
      }
      const lottieGeometry = await lottiePlayer.evaluate(el => {
        const artwork = el.parentElement;
        return {
          ratio: artwork?.getBoundingClientRect?.().height
            ? artwork.getBoundingClientRect().width / artwork.getBoundingClientRect().height
            : 0,
          width: artwork?.getBoundingClientRect?.().width || 0,
          height: artwork?.getBoundingClientRect?.().height || 0,
          classHook: !!artwork?.classList?.contains('is-lottie-artwork'),
          styleRatio: artwork?.style.aspectRatio || '',
          preserveAspectRatio: el.getAttribute('preserveAspectRatio') || '',
          backgroundLayer: !!artwork?.querySelector(':scope > .lm-media-background-layer'),
          captionIsOutsideArtwork: !!artwork?.nextElementSibling?.classList?.contains('media-caption')
        };
      });
      const expectedLottieRatio = 440 / 478;
      if (Math.abs(lottieGeometry.ratio - expectedLottieRatio) > 0.01) {
        throw new Error(`Lightbox Lottie artwork did not retain its intrinsic ratio: ${JSON.stringify(lottieGeometry)}`);
      }
      if (!lottieGeometry.classHook) {
        throw new Error('Lightbox Lottie artwork is missing its dedicated responsive sizing hook.');
      }
      const desktopViewportHeight = await page.evaluate(() => window.innerHeight);
      const desktopLottieMaxHeight = desktopViewportHeight * 0.72 + 3;
      if (lottieGeometry.height > desktopLottieMaxHeight) {
        throw new Error(
          `Desktop Lightbox Lottie remains too tall (${Math.round(lottieGeometry.height)}px > ${Math.round(desktopLottieMaxHeight)}px): ${JSON.stringify(lottieGeometry)}`
        );
      }
      if (lottieGeometry.preserveAspectRatio !== 'xMidYMid meet') {
        throw new Error(`Lightbox Lottie rendering still permits cropping: ${lottieGeometry.preserveAspectRatio}`);
      }
      if (!lottieGeometry.backgroundLayer || !lottieGeometry.captionIsOutsideArtwork) {
        throw new Error(`Lottie background/caption ownership is not isolated to the artwork surface: ${JSON.stringify(lottieGeometry)}`);
      }

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
      if ((layerOrder.background && layerOrder.background.zIndex !== '0') ||
          layerOrder.canvas?.zIndex !== '2' ||
          layerOrder.activation?.zIndex !== '3' ||
          layerOrder.ui?.zIndex !== '4') {
        throw new Error(`Unexpected 3D layer order: ${JSON.stringify(layerOrder)}`);
      }
      if (layerOrder.activation?.position !== 'absolute' || layerOrder.canvas?.position !== 'absolute') {
        throw new Error(`3D overlay/canvas positioning is not explicit: ${JSON.stringify(layerOrder)}`);
      }

      const normal3DDescriptionState = await page.evaluate(() => {
        const modalDescription = document.querySelector('#modalDesc');
        const fullDescription = document.querySelector('#modalFullDesc');
        const caption = document.querySelector('#lightbox .is-3d-media-item .media-caption');
        const read = el => {
          const style = el ? getComputedStyle(el) : null;
          return {
            exists: !!el,
            text: el?.textContent?.trim() || '',
            display: style?.display || '',
            visibility: style?.visibility || '',
            opacity: style?.opacity || ''
          };
        };
        return {
          modalDescription: read(modalDescription),
          fullDescription: read(fullDescription),
          caption: read(caption)
        };
      });
      const anyNormal3DDescription =
        normal3DDescriptionState.modalDescription.text ||
        normal3DDescriptionState.fullDescription.text ||
        normal3DDescriptionState.caption.text;
      if (!anyNormal3DDescription) {
        throw new Error('3D project Lightbox opened without any project/media description content.');
      }
      if (
        normal3DDescriptionState.modalDescription.exists &&
        (normal3DDescriptionState.modalDescription.visibility === 'hidden' ||
         normal3DDescriptionState.modalDescription.display === 'none' ||
         normal3DDescriptionState.modalDescription.opacity === '0')
      ) {
        throw new Error('3D project description is hidden before entering focused 3D inspection.');
      }
      if (
        normal3DDescriptionState.caption.exists &&
        (normal3DDescriptionState.caption.visibility === 'hidden' ||
         normal3DDescriptionState.caption.display === 'none' ||
         normal3DDescriptionState.caption.opacity === '0')
      ) {
        throw new Error('3D artwork caption is hidden before entering focused 3D inspection.');
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

      const focused3DEntryOrigin = await page.locator('#lightbox.is-3d-focused').evaluate(el => el.scrollTop);
      if (focused3DEntryOrigin !== 0) {
        throw new Error('Focused 3D environment did not reset its internal Lightbox scroll position to zero: ' + focused3DEntryOrigin);
      }

      const focused3DTouchContract = await page.evaluate(() => {
        const modal = document.querySelector('#lightbox.is-3d-focused');
        const canvas = document.querySelector('#lightbox .lightbox-model-viewer.is-interactive canvas');
        if (!modal || !canvas) return null;
        const event = new Event('touchmove', { bubbles: true, cancelable: true });
        canvas.dispatchEvent(event);
        return {
          touchDefaultPrevented: event.defaultPrevented,
          modalOverflowY: getComputedStyle(modal).overflowY,
          canvasPointerEvents: getComputedStyle(canvas).pointerEvents,
          canvasTouchAction: getComputedStyle(canvas).touchAction
        };
      });
      if (!focused3DTouchContract ||
          focused3DTouchContract.touchDefaultPrevented ||
          focused3DTouchContract.canvasPointerEvents !== 'auto' ||
          focused3DTouchContract.canvasTouchAction !== 'none') {
        throw new Error(
          'Focused 3D touch input is being blocked before it reaches OrbitControls: ' +
          JSON.stringify(focused3DTouchContract)
        );
      }

      const focused3DScrollContract = await page.evaluate(() => {
        const modal = document.querySelector('#lightbox.is-3d-focused');
        if (!modal) return null;
        const style = getComputedStyle(modal);
        const scrollHeightBeforeWheel = modal.scrollHeight;
        const clientHeightBeforeWheel = modal.clientHeight;
        modal.scrollTop = 96;
        const scrollTopBeforeWheel = modal.scrollTop;
        const event = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: 260
        });
        modal.dispatchEvent(event);
        const scrollTopAfterWheel = modal.scrollTop;
        return {
          position: style.position,
          overflowY: style.overflowY,
          overflowX: style.overflowX,
          touchAction: style.touchAction,
          overscrollBehavior: style.overscrollBehavior,
          scrollHeightBeforeWheel,
          clientHeightBeforeWheel,
          scrollTopBeforeWheel,
          scrollTopAfterWheel,
          wheelDefaultPrevented: event.defaultPrevented
        };
      });
      if (!focused3DScrollContract ||
          focused3DScrollContract.position !== 'fixed' ||
          focused3DScrollContract.overflowY !== 'hidden' ||
          focused3DScrollContract.overflowX !== 'hidden' ||
          focused3DScrollContract.touchAction !== 'none' ||
          focused3DScrollContract.overscrollBehavior !== 'none' ||
          focused3DScrollContract.scrollTopBeforeWheel !== 0 ||
          focused3DScrollContract.scrollTopAfterWheel !== 0 ||
          !focused3DScrollContract.wheelDefaultPrevented) {
        throw new Error('Focused 3D environment is not scroll-locked: ' + JSON.stringify(focused3DScrollContract));
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

      const focusedControlStack = await page.evaluate(() => {
        const modal = document.querySelector('#lightbox.is-3d-focused');
        const controls = document.querySelector('#lightboxControls');
        if (!modal || !controls) return null;
        const modalStyle = getComputedStyle(modal);
        const controlsStyle = getComputedStyle(controls);
        return {
          modalZIndex: Number.parseInt(modalStyle.zIndex, 10) || 0,
          controlsZIndex: Number.parseInt(controlsStyle.zIndex, 10) || 0,
          controlsPointerEvents: controlsStyle.pointerEvents,
          controlsVisibility: controlsStyle.visibility
        };
      });
      if (!focusedControlStack ||
          !(focusedControlStack.controlsZIndex < focusedControlStack.modalZIndex) ||
          focusedControlStack.controlsPointerEvents !== 'none' ||
          focusedControlStack.controlsVisibility !== 'visible') {
        throw new Error('Focused 3D did not place the global Lightbox chrome underneath the modal layer: ' + JSON.stringify(focusedControlStack));
      }

      const focusedDescriptionState = await page.evaluate(() => {
        const modalDescription = document.querySelector('#modalDesc');
        const fullDescription = document.querySelector('#modalFullDesc');
        const caption = document.querySelector('#lightbox .is-3d-focus-target .media-caption');
        const read = el => {
          const style = el ? getComputedStyle(el) : null;
          return {
            exists: !!el,
            display: style?.display || '',
            visibility: style?.visibility || '',
            opacity: style?.opacity || ''
          };
        };
        return {
          modalDescription: read(modalDescription),
          fullDescription: read(fullDescription),
          caption: read(caption)
        };
      });
      for (const [name,state] of Object.entries(focusedDescriptionState)) {
        if (state.exists && (
          state.display !== 'none' &&
          state.visibility !== 'hidden' &&
          state.opacity !== '0'
        )) {
          throw new Error('Focused 3D inspection layer still exposes '+name+': '+JSON.stringify(state));
        }
      }

      const focusedCloseBackground = await page.locator('#lightboxClose').evaluate(
        el => getComputedStyle(el).backgroundColor
      );
      const focusedCloseContrast = await page.evaluate(() => {
        const controls=document.querySelector('.lightbox-controls');
        return controls ? getComputedStyle(controls).mixBlendMode : '';
      });
      if (focusedCloseContrast !== 'normal') {
        throw new Error('Focused 3D global Lightbox controls did not remain on normal compositing: '+focusedCloseContrast);
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
        return Math.abs(r.width - innerWidth) <= 2 &&
          Math.abs(r.height - innerHeight) <= 2 &&
          el.dataset.renderProfile === 'mobile-balanced' &&
          Number(el.dataset.renderPixelRatio) <= 1.01 &&
          Number(el.dataset.renderFrameCap) === 30;
      }, null, { timeout: 3000 });
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

      const mobileRenderProfile = await modelShell.evaluate(el => ({
        profile: el.dataset.renderProfile,
        pixelRatio: Number(el.dataset.renderPixelRatio),
        frameCap: Number(el.dataset.renderFrameCap)
      }));
      if (mobileRenderProfile.profile !== 'mobile-balanced' ||
          mobileRenderProfile.pixelRatio > 1.01 ||
          mobileRenderProfile.frameCap !== 30) {
        throw new Error('Mobile 3D viewer did not apply its balanced render profile: ' + JSON.stringify(mobileRenderProfile));
      }

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForFunction(() => {
        const el = document.querySelector('#lightbox .lightbox-model-viewer.is-interactive');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return Math.abs(r.width - innerWidth) <= 2 &&
          Math.abs(r.height - innerHeight) <= 2 &&
          el.dataset.renderProfile === 'desktop-quality' &&
          Number(el.dataset.renderPixelRatio) <= 1.51 &&
          Number(el.dataset.renderFrameCap) === 60;
      }, null, { timeout: 3000 });
      const desktopRenderProfile = await modelShell.evaluate(el => ({
        profile: el.dataset.renderProfile,
        pixelRatio: Number(el.dataset.renderPixelRatio),
        frameCap: Number(el.dataset.renderFrameCap)
      }));
      if (desktopRenderProfile.profile !== 'desktop-quality' ||
          desktopRenderProfile.pixelRatio > 1.51 ||
          desktopRenderProfile.frameCap !== 60) {
        throw new Error('Desktop 3D viewer did not restore its quality render profile: ' + JSON.stringify(desktopRenderProfile));
      }

      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      const interactiveAfterEscape = await modelShell.evaluate(el => el.classList.contains('is-interactive'));
      if (interactiveAfterEscape) throw new Error('Escape did not exit interactive 3D mode.');

      await page.locator('#lightboxClose').click();
      await page.waitForTimeout(100);
      const pointerFocusReturn = await modelCard.evaluate(el => ({
        active: document.activeElement === el,
        marked: el.classList.contains('is-pointer-focus-return'),
        focusVisible: el.matches(':focus-visible'),
        boxShadow: getComputedStyle(el).boxShadow
      }));
      if (!pointerFocusReturn.active || !pointerFocusReturn.marked ||
          (pointerFocusReturn.focusVisible && pointerFocusReturn.boxShadow !== 'none')) {
        throw new Error('Pointer-opened 3D Lightbox left an unwanted gallery focus frame: ' + JSON.stringify(pointerFocusReturn));
      }
    });

    await smokePage(
      browser,
      '/?holographic-smoke=1',
      async page => {
        const firstCard = page.locator('#portfolioGrid .project-card').first();
        await firstCard.waitFor({ state: 'visible', timeout: 4000 });
        await firstCard.click();
        await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });

        const holographic = page.locator('.lightbox-holographic').first();
        if (await holographic.count() !== 1) {
          throw new Error('Holographic image fixture did not render its interactive Lightbox surface.');
        }
        if (await holographic.getAttribute('data-holo-style') !== 'iridescent') {
          throw new Error('Holographic Lightbox fixture lost its configured visual style.');
        }

        const affordance = await holographic.evaluate(el => {
          const sheen = el.querySelector('.lightbox-holographic-front .lightbox-holographic-sheen');
          const style = getComputedStyle(el);
          const artwork = el.closest('.lightbox-artwork.has-holographic');
          const face = el.querySelector('.lightbox-holographic-front');
          return {
            animationName: style.animationName,
            contain: style.contain,
            borderRadius: style.borderRadius,
            borderWidth: style.borderWidth,
            borderStyle: style.borderStyle,
            boxShadow: style.boxShadow,
            outlineStyle: style.outlineStyle,
            artworkOverflow: artwork ? getComputedStyle(artwork).overflow : '',
            environmentBlend: getComputedStyle(el.querySelector('.lightbox-holographic-environment')).mixBlendMode,
            environmentOpacity: Number.parseFloat(getComputedStyle(el.querySelector('.lightbox-holographic-environment')).opacity),
            grainImage: getComputedStyle(face?.querySelector('.lightbox-holographic-grain-layer')).backgroundImage,
            faceRadius: face ? getComputedStyle(face).borderRadius : '',
            faceOverflow: face ? getComputedStyle(face).overflow : '',
            backEffectCount: el.querySelector('.lightbox-holographic-back')?.querySelectorAll('.lightbox-holographic-spectrum,.lightbox-holographic-environment,.lightbox-holographic-glare,.lightbox-holographic-prism,.lightbox-holographic-ribbons,.lightbox-holographic-sheen,.lightbox-holographic-texture').length || 0,
            hintFace: el.closest('.lightbox-media-item')?.querySelector('[data-holo-face-label]')?.textContent || '',
            hintAction: getComputedStyle(el.closest('.lightbox-media-item')?.querySelector('.lightbox-holographic-desktop-action')).display === 'none' ? 'touch' : 'desktop',
            sheenAnimation: sheen ? getComputedStyle(sheen).animationName : '',
            prismAnimation: getComputedStyle(el.querySelector('.lightbox-holographic-prism')).animationName,
            ribbonsAnimation: getComputedStyle(el.querySelector('.lightbox-holographic-ribbons')).animationName,
            flipTransition: getComputedStyle(el.querySelector('.lightbox-holographic-flip')).transitionDuration
          };
        });
        if (!affordance.animationName.includes('holo-idle-float') ||
            affordance.contain.includes('paint') ||
            affordance.borderRadius !== '0px' ||
            affordance.borderWidth !== '0px' || affordance.borderStyle !== 'none' ||
            affordance.boxShadow !== 'none' || affordance.outlineStyle !== 'none' ||
            affordance.artworkOverflow !== 'visible' ||
            affordance.environmentBlend !== 'soft-light' ||
            !(affordance.environmentOpacity > 0) ||
            !affordance.grainImage.includes('grain.webp') ||
            affordance.faceRadius !== '0px' ||
            affordance.faceOverflow !== 'hidden' ||
            affordance.backEffectCount !== 0 ||
            affordance.hintFace !== 'FRONT' ||
            affordance.hintAction !== 'desktop' ||
            !affordance.sheenAnimation.includes('holo-idle-sheen') ||
            !affordance.prismAnimation.includes('holo-prism-drift') ||
            !affordance.ribbonsAnimation.includes('holo-light-ribbons') ||
            Number.parseFloat(affordance.flipTransition) <= 0) {
          throw new Error('Desktop holographic surface is missing its intended affordance/geometry: ' + JSON.stringify(affordance));
        }
        const maskState = await holographic.evaluate(el => {
          const front = el.querySelector('.lightbox-holographic-front');
          const back = el.querySelector('.lightbox-holographic-back');
          const selectors = ['.lightbox-holographic-spectrum', '.lightbox-holographic-cosmos-bottom', '.lightbox-holographic-cosmos-middle', '.lightbox-holographic-cosmos-top', '.lightbox-holographic-grain-layer', '.lightbox-holographic-glitter-layer', '.lightbox-holographic-environment', '.lightbox-holographic-glare', '.lightbox-holographic-prism', '.lightbox-holographic-ribbons', '.lightbox-holographic-diffraction', '.lightbox-holographic-sparkles', '.lightbox-holographic-sheen', '.lightbox-holographic-texture'];
          const visibleMasks = face => selectors.flatMap(selector => {
            const layer = face?.querySelector(selector);
            if (!layer || getComputedStyle(layer).display === 'none') return [];
            return [{ selector, mask: layer.style.maskImage || '' }];
          });
          return { frontLayers: visibleMasks(front), backLayers: visibleMasks(back) };
        });
        if (maskState.frontLayers.some(value => !value.mask.includes('mask.svg')) ||
            maskState.backLayers.some(value => Boolean(value.mask))) {
          throw new Error(`A plain reverse face must not inherit the front foil mask: ${JSON.stringify(maskState)}`);
        }

        const presetAudit = await holographic.evaluate(el => {
          const presets = [
            { style: 'holographic', layers: ['prism', 'ribbons', 'sheen'] },
            { style: 'cosmos', layers: ['sheen'] },
            { style: 'brushed', layers: ['prism', 'sheen'] },
            { style: 'beams', layers: ['prism', 'sheen'] },
            { style: 'crosshatch', layers: ['diffraction'] },
            { style: 'shattered', layers: ['prism', 'diffraction'] },
            { style: 'glitter', layers: ['sparkles'] },
            { style: 'waves', layers: ['diffraction'] },
            { style: 'cat-eye', layers: ['prism', 'sheen'] },
            { style: 'iridescent', layers: ['prism', 'ribbons', 'sheen'] },
            { style: 'aurora', layers: ['prism', 'ribbons', 'sheen'] }
          ];
          const layerSelectors = {
            prism: '.lightbox-holographic-prism',
            ribbons: '.lightbox-holographic-ribbons',
            diffraction: '.lightbox-holographic-diffraction',
            sparkles: '.lightbox-holographic-sparkles',
            sheen: '.lightbox-holographic-sheen'
          };
          const spectrum = el.querySelector('.lightbox-holographic-spectrum');
          const originalStyle = el.dataset.holoStyle;
          const originalIntensity = el.style.getPropertyValue('--holo-intensity');
          const results = presets.map(preset => {
            el.dataset.holoStyle = preset.style;
            return {
              style: preset.style,
              layers: preset.layers,
              backgroundImage: getComputedStyle(spectrum).backgroundImage,
              classicInterferenceImage: getComputedStyle(spectrum, '::after').backgroundImage,
              layerDisplay: Object.fromEntries(Object.entries(layerSelectors).map(([name, selector]) => [
                name,
                getComputedStyle(el.querySelector('.lightbox-holographic-front ' + selector)).display
              ]))
            };
          });
          el.dataset.holoStyle = originalStyle;
          // Disable the spectrum's opacity transition while measuring both values;
          // otherwise same-task reads can observe the same in-flight transition.
          const originalSpectrumTransition = spectrum.style.transition;
          spectrum.style.transition = 'none';
          el.style.setProperty('--holo-intensity', '0.15');
          const lowIntensityVariable = getComputedStyle(el).getPropertyValue('--holo-intensity').trim();
          const lowIntensityOpacity = Number.parseFloat(getComputedStyle(spectrum).opacity);
          el.style.setProperty('--holo-intensity', '0.9');
          const highIntensityVariable = getComputedStyle(el).getPropertyValue('--holo-intensity').trim();
          const highIntensityOpacity = Number.parseFloat(getComputedStyle(spectrum).opacity);
          el.style.setProperty('--holo-intensity', originalIntensity || '0.8');
          spectrum.style.transition = originalSpectrumTransition;
          return {
            results, lowIntensityOpacity, highIntensityOpacity,
            lowIntensityVariable, highIntensityVariable
          };
        });
        const distinctPresetBackgrounds = new Set(presetAudit.results.map(preset => preset.backgroundImage));
        const classicInterference = presetAudit.results.find(preset => preset.style === 'holographic')?.classicInterferenceImage || '';
        if (!classicInterference.includes('repeating-linear-gradient')) {
          throw new Error('The classic holographic preset must include its neutral interference band.');
        }
        if (presetAudit.results.length !== 11 || distinctPresetBackgrounds.size !== 11) {
          throw new Error('Holographic finish options must produce eleven distinct spectrum materials; found ' +
            distinctPresetBackgrounds.size + ' distinct backgrounds.');
        }
        const missingPresetLayers = presetAudit.results.flatMap(preset =>
          preset.layers.filter(layer => preset.layerDisplay[layer] === 'none')
            .map(layer => preset.style + ':' + layer)
        );
        if (missingPresetLayers.length) {
          throw new Error('Holographic finish options are missing their signature overlay layers: ' +
            missingPresetLayers.join(', '));
        }
        if (!(presetAudit.highIntensityOpacity > presetAudit.lowIntensityOpacity)) {
          throw new Error('Holographic intensity must visibly increase the foil response: ' +
            JSON.stringify({
              lowOpacity: presetAudit.lowIntensityOpacity,
              highOpacity: presetAudit.highIntensityOpacity,
              lowVariable: presetAudit.lowIntensityVariable,
              highVariable: presetAudit.highIntensityVariable
            }));
        }

        const holoBox = await holographic.boundingBox();
        if (!holoBox || holoBox.width < 20 || holoBox.height < 20) {
          throw new Error('Holographic Lightbox surface has no usable geometry.');
        }
        await page.mouse.move(
          holoBox.x + holoBox.width * 0.82,
          holoBox.y + holoBox.height * 0.22
        );
        await page.waitForFunction(() => {
          const el = document.querySelector('#lightboxMediaContainer .lightbox-holographic');
          const x = Number.parseFloat(el?.style.getPropertyValue('--holo-x'));
          return Number.isFinite(x) && x > 50;
        }, null, { timeout: 1200 });

        const holoStateBeforeFlip = await holographic.evaluate(el => ({
          x: el.style.getPropertyValue('--holo-x'),
          y: el.style.getPropertyValue('--holo-y'),
          foilX: el.style.getPropertyValue('--holo-foil-x'),
          foilY: el.style.getPropertyValue('--holo-foil-y'),
          lightX: el.style.getPropertyValue('--holo-light-x'),
          lightY: el.style.getPropertyValue('--holo-light-y'),
          textureMode: el.dataset.holoTextureMode,
          textureRepeat: getComputedStyle(el.querySelector('.lightbox-holographic-front .lightbox-holographic-texture')).backgroundRepeat,
          rx: el.style.getPropertyValue('--holo-rx'),
          ry: el.style.getPropertyValue('--holo-ry'),
          back: el.querySelector('.lightbox-holographic-back img')?.getAttribute('src') || ''
        }));
        const pointerX = Number.parseFloat(holoStateBeforeFlip.x);
        const pointerY = Number.parseFloat(holoStateBeforeFlip.y);
        const foilX = Number.parseFloat(holoStateBeforeFlip.foilX);
        const foilY = Number.parseFloat(holoStateBeforeFlip.foilY);
        if (holoStateBeforeFlip.x === '50%' || holoStateBeforeFlip.y === '50%' ||
            !holoStateBeforeFlip.rx || !holoStateBeforeFlip.ry ||
            !Number.isFinite(foilX) || !Number.isFinite(foilY) ||
            Math.abs((pointerX + foilX) - 100) > 1.5 ||
            Math.abs((pointerY + foilY) - 100) > 1.5) {
          throw new Error('Holographic Lightbox pointer/foil mapping did not preserve the inverse refraction contract.');
        }
        const lightX = Number.parseFloat(holoStateBeforeFlip.lightX);
        const lightY = Number.parseFloat(holoStateBeforeFlip.lightY);
        const expectedLightX = Math.max(16, Math.min(84, 50 + ((50 - pointerX) * 0.68)));
        const expectedLightY = Math.max(16, Math.min(84, 50 + ((50 - pointerY) * 0.68)));
        if (!Number.isFinite(lightX) || !Number.isFinite(lightY) ||
            Math.abs(lightX - expectedLightX) > 1.5 ||
            Math.abs(lightY - expectedLightY) > 1.5 ||
            (Math.abs(pointerX - lightX) < 8 && Math.abs(pointerY - lightY) < 8)) {
          throw new Error('Holographic key light must move opposite the pointer within the virtual studio: ' +
            JSON.stringify({pointerX, pointerY, lightX, lightY, expectedLightX, expectedLightY}));
        }
        if (holoStateBeforeFlip.textureMode !== 'tile' ||
            !holoStateBeforeFlip.textureRepeat.includes('repeat')) {
          throw new Error('Small foil pattern images must repeat across the whole card face.');
        }
        if (!holoStateBeforeFlip.back.includes('holographic-smoke/front.svg')) {
          throw new Error('Holographic Lightbox did not reuse the front artwork when no custom back image is configured.');
        }

        await holographic.click();
        if (await holographic.getAttribute('aria-pressed') !== 'true' ||
            !(await holographic.evaluate(el => el.classList.contains('is-flipped')))) {
          throw new Error('Holographic Lightbox tap/click did not flip the artwork.');
        }
        const reverseHint = await holographic.evaluate(el => el.closest('.lightbox-media-item')?.querySelector('[data-holo-face-label]')?.textContent || '');
        if (reverseHint !== 'BACK') {
          throw new Error('Holographic guidance did not update from FRONT to BACK after flipping.');
        }
        await page.locator('#lightboxClose').first().click();
        await page.waitForTimeout(100);
      },
      { width: 1280, height: 900 },
      async page => {
        const fixture = [{
          id: 'holographic-smoke',
          title: 'Holographic Smoke',
          subtitle: 'Interactive image fixture',
          badge: '',
          filters: [],
          description: '',
          thumbnail: { type: 'image', src: 'assets/projects/holographic-smoke/front.svg', focus: '50% 50%', zoom: 1 },
          media: [{
            type: 'image',
            src: 'assets/projects/holographic-smoke/front.svg',
            caption: 'Holographic front',
            orientation: 'square',
            holographic: {
              style: 'iridescent',
              intensity: 0.8,
              textureMode: 'tile',
              texture: 'assets/projects/holographic-smoke/foil.svg',

              mask: 'assets/projects/holographic-smoke/mask.svg'
            }
          }]
        }];
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#ccc"/></svg>';
        const maskSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#000"/><path d="M0 0H48V100H0Z" fill="#fff"/></svg>';
        await page.route('**/data/projects.json*', async route => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(fixture)
          });
        });
        await page.route('**/assets/projects/holographic-smoke/**', async route => {
          const body = route.request().url().includes('-mask.svg') ? maskSvg : svg;
          await route.fulfill({ status: 200, contentType: 'image/svg+xml', body });
        });
      }
    );

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

      // Project count comes from CMS; the presentation contract
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
      if (mobileCardsInDom !== desktopCards) throw new Error(`Mobile resize changed project count from ${desktopCards} to ${mobileCardsInDom}.`);

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

      const mobileGalleryMeta = await page.locator('#portfolioGrid .project-card').evaluateAll(cards =>
        cards
          .filter(card => getComputedStyle(card).display !== 'none')
          .map(card => {
            const info = card.querySelector('.glass-info');
            const style = info ? getComputedStyle(info) : null;
            return { exists: !!info, display: style?.display || '' };
          })
      );
      mobileGalleryMeta.forEach(item => {
        if (item.exists && item.display !== 'none') {
          throw new Error('Mobile project gallery still renders title/subtitle metadata: '+JSON.stringify(item));
        }
      });

      if (mobileCollapsedState.maxHeight === 'none' || mobileCollapsedState.scrollHeight <= mobileCollapsedState.clientHeight) {
        throw new Error('Desktop-to-mobile resize did not restore the mobile collapsed gallery viewport.');
      }
      if (!(await showMoreAfterResize.isVisible().catch(() => false))) {
        throw new Error('Desktop-to-mobile resize did not restore the mobile Show More control.');
      }

      const collapsedShowMoreMaterial = await showMoreAfterResize.evaluate(el => {
        const style = getComputedStyle(el);
        return {
          background: style.backgroundColor,
          border: style.borderStyle,
          borderWidth: style.borderWidth,
          color: style.color,
          backdropFilter: style.backdropFilter
        };
      });
      if (
        collapsedShowMoreMaterial.color !== 'rgb(255, 255, 255)' ||
        collapsedShowMoreMaterial.borderWidth !== '0px' ||
        collapsedShowMoreMaterial.backdropFilter === 'none' ||
        collapsedShowMoreMaterial.background === 'rgb(0, 0, 0)'
      ) {
        throw new Error('Mobile Show More did not retain the requested glass material: ' + JSON.stringify(collapsedShowMoreMaterial));
      }

      await showMoreAfterResize.click();
      await page.waitForTimeout(300);
      const expandedShowLessMaterial = await showMoreAfterResize.evaluate(el => {
        const style = getComputedStyle(el);
        return {
          expanded: el.classList.contains('expanded'),
          background: style.backgroundColor,
          color: style.color,
          backdropFilter: style.backdropFilter
        };
      });
      if (
        !expandedShowLessMaterial.expanded ||
        expandedShowLessMaterial.background !== 'rgb(255, 255, 255)' ||
        expandedShowLessMaterial.color !== 'rgb(0, 0, 0)' ||
        expandedShowLessMaterial.backdropFilter !== 'none'
      ) {
        throw new Error('Mobile Show Less did not retain the requested white/black solid material: ' + JSON.stringify(expandedShowLessMaterial));
      }

      // Critical regression path: once the gallery is expanded, opening and
      // closing a Lightbox must not collapse the Gallery or move the visitor to
      // an unrelated position. The Lightbox close event is allowed to rebuild
      // presentation, but it must preserve Gallery-owned expansion state and
      // restore the exact page scroll position.
      await page.locator('#portfolioGrid .project-card').filter({ visible: true }).first().scrollIntoViewIfNeeded().catch(() => {});
      await page.mouse.wheel(0, 260);
      await page.waitForTimeout(120);
      const expandedBeforeLightbox = await page.evaluate(() => ({
        scrollY: Math.round(window.scrollY),
        expanded: document.querySelector('#showMoreBtn')?.classList.contains('expanded'),
        wrapperExpanded: document.querySelector('#showMoreWrapper')?.getAttribute('data-expanded'),
        maxHeight: getComputedStyle(document.querySelector('#portfolioGridViewport')).maxHeight,
        visibleCards: Array.from(document.querySelectorAll('#portfolioGrid .project-card'))
          .filter(card => getComputedStyle(card).display !== 'none').length
      }));
      if (
        !expandedBeforeLightbox.expanded ||
        expandedBeforeLightbox.wrapperExpanded !== 'true' ||
        expandedBeforeLightbox.maxHeight !== 'none' ||
        expandedBeforeLightbox.visibleCards !== desktopCards
      ) {
        throw new Error('Expanded Gallery state was not settled before Lightbox close regression test: ' + JSON.stringify(expandedBeforeLightbox));
      }

      const lightboxPoint = await page.locator('#portfolioGrid .project-card').evaluateAll(cards => {
        const rects = cards
          .filter(card => getComputedStyle(card).display !== 'none')
          .map(card => card.getBoundingClientRect())
          .filter(rect =>
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top >= 0 &&
            rect.bottom <= innerHeight
          );
        const rect = rects[0];
        return rect ? {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        } : null;
      });
      if (!lightboxPoint) {
        throw new Error('Expanded Gallery regression test could not find a fully visible project card without scrolling it into view.');
      }
      // Use a direct screen-coordinate click instead of Locator.click(). The
      // latter may scroll the target into view before dispatching the click,
      // which would make this test capture a different pre-Lightbox scroll
      // position than the one we just measured.
      await page.mouse.click(lightboxPoint.x, lightboxPoint.y);
      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });
      await page.locator('#lightboxClose').click();
      await page.waitForTimeout(120);

      const expandedAfterLightbox = await page.evaluate(() => ({
        scrollY: Math.round(window.scrollY),
        expanded: document.querySelector('#showMoreBtn')?.classList.contains('expanded'),
        wrapperExpanded: document.querySelector('#showMoreWrapper')?.getAttribute('data-expanded'),
        maxHeight: getComputedStyle(document.querySelector('#portfolioGridViewport')).maxHeight,
        visibleCards: Array.from(document.querySelectorAll('#portfolioGrid .project-card'))
          .filter(card => getComputedStyle(card).display !== 'none').length
      }));
      if (
        expandedAfterLightbox.scrollY !== expandedBeforeLightbox.scrollY ||
        !expandedAfterLightbox.expanded ||
        expandedAfterLightbox.wrapperExpanded !== 'true' ||
        expandedAfterLightbox.maxHeight !== 'none' ||
        expandedAfterLightbox.visibleCards !== desktopCards
      ) {
        throw new Error('Closing Lightbox regressed the expanded Gallery state: ' + JSON.stringify({
          before: expandedBeforeLightbox,
          after: expandedAfterLightbox
        }));
      }

      // Return to the collapsed state so the remaining resize assertions keep
      // the original mobile fixture geometry.
      await showMoreAfterResize.click();
      await page.waitForTimeout(300);

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(500);
      const desktopRestoredCards = await page.locator('#portfolioGrid .project-card').evaluateAll(
        cards => cards.filter(card => getComputedStyle(card).display !== 'none').length
      );
      if (desktopRestoredCards !== desktopCards) {
        throw new Error(`Mobile-to-desktop resize should restore all ${desktopCards} loaded projects (found ${desktopRestoredCards}).`);
      }
      if (await page.locator('#showMoreBtn').first().isVisible().catch(() => false)) {
        throw new Error(`Mobile-to-desktop resize incorrectly restored a desktop Show More control for ${desktopCards} projects.`);
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

      const youtubeLoadingModes = await youtubeArtworks.locator('iframe[data-lm-youtube]').evaluateAll(frames => frames.map(frame => frame.getAttribute('loading') || ''));
      if (youtubeLoadingModes.some(mode => mode === 'lazy')) {
        throw new Error(`Lightbox YouTube media still uses lazy loading after explicit viewer entry: ${JSON.stringify(youtubeLoadingModes)}`);
      }

      const youtubeGeometry = await youtubeArtworks.evaluateAll(nodes => nodes.map(el => {
        const rect = el.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          orientation: el.getAttribute('data-youtube-orientation'),
          ratio: parseFloat(getComputedStyle(el).aspectRatio || '0')
        };
      }));
      if (youtubeGeometry.some(item => item.height > 525 || item.width <= 0 || item.height <= 0)) {
        throw new Error(`Multi-media YouTube artwork exceeded its responsive desktop height ceiling: ${JSON.stringify(youtubeGeometry)}`);
      }
      const portrait = youtubeGeometry.find(item => item.orientation === 'portrait');
      const landscape = youtubeGeometry.find(item => item.orientation === 'landscape');
      if (!portrait || !landscape) throw new Error(`YouTube orientation classification is incomplete: ${JSON.stringify(youtubeGeometry)}`);
      if (portrait.width >= landscape.width) {
        throw new Error(`YouTube Shorts did not retain portrait geometry: ${JSON.stringify(youtubeGeometry)}`);
      }

      await page.locator('#lightboxClose').click();
      await page.waitForTimeout(100);

      // Reopen the same project so the first YouTube frame comes back through
      // the hidden cache path. Cached reuse must preserve eager Lightbox load
      // behavior rather than reverting to lazy loading.
      await card.click();
      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });
      const reusedYoutubeLoadingModes = await page.locator(
        '#lightboxMediaContainer iframe[data-lm-youtube]'
      ).evaluateAll(frames => frames.map(frame => frame.getAttribute('loading') || ''));
      if (reusedYoutubeLoadingModes.some(mode => mode === 'lazy')) {
        throw new Error(
          'Reused YouTube Lightbox frames regressed to lazy loading: ' +
          JSON.stringify(reusedYoutubeLoadingModes)
        );
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

      await page.locator('.hamburger').first().click();
      await assertPublicFilterNavigation(page, {
        href: '#3d-motion',
        expectedHash: '#3d-motion',
        label: 'Mobile Works'
      });

      // Restore the ALL state so the remainder of this mobile smoke page keeps
      // its original fixture assumptions (including the first project card).
      await page.locator('.filter-tabs [data-filter="all"]').first().click();
      await page.waitForTimeout(420);

      const filters = page.locator('.filter-tabs .filter-btn, .filter-tabs .tab-btn');
      if (await filters.count() < 2) throw new Error('Mobile/tablet Works filter UI did not render.');

      const allFilter = page.locator('.filter-tabs [data-filter="all"]');
      if (await allFilter.count() !== 1) throw new Error('Mobile/tablet Works filter UI is missing ALL.');
      await assertFilterButtonHitTarget(page, 'Mobile Works');
      await allFilter.click();
      await page.waitForTimeout(120);

      const heroText = await page.locator('#heroQuoteText').textContent().catch(() => '');
      if (!heroText?.trim()) throw new Error('Mobile/tablet Works Hero message is missing.');

      const footerSocialCenter = await page.evaluate(() => {
        const footer = document.querySelector('footer')?.getBoundingClientRect();
        const row = document.querySelector('footer .social-icons')?.getBoundingClientRect();
        return {
          delta: footer && row ? Math.abs((row.left + row.width / 2) - (footer.left + footer.width / 2)) : 9999
        };
      });
      if (footerSocialCenter.delta > 2) {
        throw new Error('Mobile Works footer social icon row is not centered: ' + JSON.stringify(footerSocialCenter));
      }

      const viewportTier = await page.evaluate(() => window.innerWidth < 768 ? 6 : 9);
      const thumbnailReadiness = await page.locator('#portfolioGrid .project-card').evaluateAll((cards, limit) =>
        cards.slice(0, limit).map(card => {
          const media = card.querySelector('.card-thumbnail img, .card-thumbnail video');
          if (!media) return true;
          if (media.tagName === 'IMG') return media.complete && media.naturalWidth > 0;
          if (media.tagName === 'VIDEO') return media.readyState >= 2;
          return true;
        }), viewportTier
      );
      if (thumbnailReadiness.some(ready => !ready)) {
        throw new Error('Initial gallery thumbnail tier still had loading media after the startup gate.');
      }

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

        await page.evaluate(() => {
          document.querySelector('#showMoreWrapper')?.scrollIntoView({ block: 'center', behavior: 'auto' });
        });
        await page.waitForTimeout(100);

        await page.evaluate(() => {
          document.querySelector('#showMoreWrapper')?.scrollIntoView({ block: 'center', behavior: 'auto' });
        });
        await page.waitForTimeout(100);

        const showLessTiming = await page.evaluate(() => {
          const button = document.querySelector('#showMoreBtn');
          const scroller = document.scrollingElement || document.documentElement;
          const startY = Number(window.scrollY) || Number(scroller.scrollTop) || 0;
          const start = performance.now();
          return new Promise(resolve => {
            let firstMovementMs = null;
            let settled = false;

            const onScroll = () => {
              const currentY = Number(window.scrollY) || Number(scroller.scrollTop) || 0;
              if (firstMovementMs === null && Math.abs(currentY - startY) > 1) {
                firstMovementMs = performance.now() - start;
              }
            };

            const finish = () => {
              if (settled) return;
              settled = true;
              window.removeEventListener('scroll', onScroll);
              resolve({
                firstMovementMs: firstMovementMs === null ? Infinity : firstMovementMs,
                elapsedMs: performance.now() - start
              });
            };

            window.addEventListener('scroll', onScroll, { passive: true });
            button?.click();

            const poll = () => {
              onScroll();
              if (Math.abs((Number(window.scrollY) || Number(scroller.scrollTop) || 0) - startY) > 1 && firstMovementMs !== null) {
                finish();
                return;
              }
              if (performance.now() - start >= 850) {
                finish();
                return;
              }
              requestAnimationFrame(poll);
            };

            requestAnimationFrame(poll);
          });
        });

        if (!Number.isFinite(showLessTiming.firstMovementMs) || showLessTiming.firstMovementMs > 120) {
          throw new Error('Show Less return scroll did not begin immediately: ' + JSON.stringify(showLessTiming));
        }
        if (showLessTiming.elapsedMs > 850) {
          throw new Error('Show Less return scroll exceeded the sub-second budget: ' + JSON.stringify(showLessTiming));
        }

        await page.waitForTimeout(430);
        const galleryAfterShowLess = await page.locator('.portfolio-wrapper').boundingBox();
        const collapsed = await page.locator('#portfolioGridViewport').evaluate(el => {
          const style = getComputedStyle(el);
          return style.maxHeight !== 'none' && el.scrollHeight > el.clientHeight;
        });
        const collapsedLabel = await mobileShowMore.locator('.btn-text').textContent().catch(() => '');
        const galleryScrollMargin = await page.locator('.portfolio-wrapper').evaluate(el =>
          Number.parseFloat(getComputedStyle(el).scrollMarginTop || '') || 0
        );
        if (!collapsed || collapsedLabel?.trim().toUpperCase() !== 'SHOW MORE') {
          throw new Error('Mobile Show Less did not restore the collapsed gallery state.');
        }
        if (!galleryAfterShowLess || Math.abs(galleryAfterShowLess.y - galleryScrollMargin) > 18) {
          throw new Error(
            `Mobile Show Less did not return to the top of the project gallery: y=${galleryAfterShowLess?.y}, expected=${galleryScrollMargin}`
          );
        }

        // Regression: a pending Show Less follow-scroll must be cancelled when
        // a filter change starts a new Gallery render. Without this guard the
        // old timer can scroll into the newly filtered layout several hundred
        // milliseconds later.
        await mobileShowMore.click();
        const filterScrollBaseline = await page.evaluate(() => window.scrollY);
        await page.locator('.filter-tabs .filter-btn, .filter-tabs .tab-btn').nth(1).click();
        const filterScrollImmediately = await page.evaluate(() => window.scrollY);
        // Filter changes have their own presentation/layout settling pass and
        // may legitimately move the document while the new result set is
        // measured. The regression is about a stale Show Less timer continuing
        // to move the page after that filter transition has settled.
        await page.waitForTimeout(500);
        const filterScrollSettled = await page.evaluate(() => window.scrollY);
        await page.waitForTimeout(220);
        const filterScrollAfterSettle = await page.evaluate(() => window.scrollY);
        if (Math.abs(filterScrollAfterSettle - filterScrollSettled) > 12) {
          throw new Error(
            `Show Less follow-scroll remained active after filter render settled: baseline=${filterScrollBaseline}, immediate=${filterScrollImmediately}, settled=${filterScrollSettled}, later=${filterScrollAfterSettle}`
          );
        }
        await page.locator('.filter-tabs [data-filter="all"]').first().click();
        await page.waitForTimeout(250);

        await mobileShowMore.click();
        await page.waitForTimeout(350);
        if ((await mobileShowMore.locator('.btn-text').textContent()).trim().toUpperCase() !== 'SHOW LESS') {
          throw new Error('Show More did not enter the stable expanded state before Lightbox regression test.');
        }

        await page.evaluate(() => {
        const scrolling = document.scrollingElement || document.documentElement;
        scrolling.scrollTop = scrolling.scrollHeight;
      });
        await page.waitForTimeout(250);
        const afterPlainScrollViewport = await page.locator('#portfolioGridViewport').evaluate(el => getComputedStyle(el).maxHeight);
        const afterPlainScrollLabel = (await mobileShowMore.locator('.btn-text').textContent()).trim().toUpperCase();
        if (afterPlainScrollViewport !== 'none' || afterPlainScrollLabel !== 'SHOW LESS') {
          throw new Error('Show Less reverted or re-clipped while scrolling through the expanded gallery.');
        }

        const visibleCardsBeforeLightboxClose = await page.locator('#portfolioGrid .project-card').evaluateAll(
          cards => cards.filter(card => getComputedStyle(card).display !== 'none').length
        );
        await page.locator('#portfolioGrid .project-card').first().click();
        await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });
        await page.locator('#lightboxClose').click();
        await page.waitForTimeout(150);
        await page.evaluate(() => {
        const scrolling = document.scrollingElement || document.documentElement;
        scrolling.scrollTop = scrolling.scrollHeight;
      });
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

        const cardsAfterLightboxClose = await page.locator('#portfolioGrid .project-card').evaluateAll(
          cards => cards.filter(card => getComputedStyle(card).display !== 'none').length
        );
        if (cardsAfterLightboxClose !== visibleCardsBeforeLightboxClose) {
          throw new Error(
            'Closing Lightbox caused Gallery artwork/cards to disappear or remain hidden: ' +
            cardsAfterLightboxClose + ' visible of ' + visibleCardsBeforeLightboxClose + '.'
          );
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

      const lightboxControlStyles = await page.evaluate(() => {
        const layer=document.querySelector('.lightbox-controls');
        const ls=layer ? getComputedStyle(layer) : null;
        return {
          blend:ls?.mixBlendMode || '',
          controls:['#lightboxClose','.lightbox-prev','.lightbox-next'].map(selector=>{
            const el=document.querySelector(selector);
            if(!el) return null;
            const s=getComputedStyle(el);
            const r=el.getBoundingClientRect();
            return {
              selector,
              color:s.color,
              background:s.backgroundColor,
              border:s.borderStyle,
              radius:s.borderRadius,
              backingBackground:getComputedStyle(el,'::before').backgroundColor,
              backingBorderRadius:getComputedStyle(el,'::before').borderRadius,
              backingBorder:getComputedStyle(el,'::before').borderStyle,
              position:s.position,
              top:s.top,
              bottom:s.bottom,
              left:r.left,
              right:r.right
            };
          }).filter(Boolean)
        };
      });
      if(lightboxControlStyles.blend!=='normal'){
        throw new Error('Mobile Lightbox controls are not using normal compositing: '+lightboxControlStyles.blend);
      }
      const close=lightboxControlStyles.controls.find(item=>item.selector==='#lightboxClose');
      const navs=lightboxControlStyles.controls.filter(item=>item.selector!=='#lightboxClose');
      const lightboxIs3dFocused=await page.locator('#lightbox.is-3d-focused').count()>0;

      // While focused 3D is active the global Lightbox chrome is deliberately
      // covered by the modal. Only assert its geometry/material in the normal
      // mobile artwork state where the controls are actually visible.
      if(!lightboxIs3dFocused){
        if(!close || close.color!=='rgb(255, 255, 255)' ||
           close.background !== 'rgba(0, 0, 0, 0)' ||
           close.border!=='none' || close.radius!=='50%' || close.position!=='fixed' ||
           close.backingBorder!=='none' ||
           !(close.backingBackground.startsWith('rgba(0, 0, 0,') || close.backingBackground.startsWith('rgb(0, 0, 0'))){
          throw new Error('Mobile Lightbox Close control does not match the protected dark-circle contract: '+JSON.stringify(close));
        }
        navs.forEach(control=>{
          const bottom=Number.parseFloat(control.bottom);
          if(control.color!=='rgb(255, 255, 255)' ||
             control.background !== 'rgba(0, 0, 0, 0)' ||
             control.border!=='none' || control.position!=='fixed' ||
             control.radius==='50%' || !Number.isFinite(bottom) || bottom<20 ||
             control.backingBorder!=='none' ||
             !(
               control.backingBackground.startsWith('rgba(0, 0, 0,') ||
               control.backingBackground.startsWith('rgb(0, 0, 0')
             )){
            throw new Error('Mobile Lightbox chevron control does not match the protected dark-squircle contract: '+JSON.stringify(control));
          }
        });
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

        // Project navigation must also stop the currently playing YouTube
        // player before the old media subtree is replaced. Mark one frame so
        // its pause command can be observed after the navigation moves it to
        // the hidden cache root.
        if (await youtubeFrames.count() >= 1) {
          await youtubeFrames.first().evaluate(el => {
            el.dataset.smokeCrossProject = 'true';
          });
          await page.evaluate(() => {
            const active = document.querySelector('#lightboxMediaContainer iframe[data-lm-youtube][data-smoke-cross-project="true"]');
            if (!active) return;
            window.dispatchEvent(new MessageEvent('message', {
              origin: 'https://www.youtube.com',
              source: active.contentWindow,
              data: JSON.stringify({ event: 'onStateChange', info: 1 })
            }));
          });
          await page.locator('.lightbox-next').first().click();
          await page.waitForTimeout(360);

          const crossProjectPause = await page.locator(
            'iframe[data-lm-youtube][data-smoke-cross-project="true"]'
          ).first().getAttribute('data-lm-youtube-pause-requested');
          if (!crossProjectPause) {
            throw new Error('Project-to-project Lightbox navigation did not pause the previous YouTube player.');
          }
        }

        await page.locator('#lightboxClose').click();
        await page.waitForTimeout(100);
        await playbackCard.click();
        await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });
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

        // Regression: a cached YouTube frame must not retain playback state
        // across a Lightbox close/reopen cycle. Clear the prior teardown marker,
        // simulate stale cached playback, reopen the project, and require the
        // runtime to issue a fresh pause command before handing the frame back.
        await page.locator('#lightboxClose').click();
        await page.locator('#lightbox.active').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
        const cachedPlaybackReset = await page.locator(
          '.lightbox-youtube-preload-root iframe[data-lm-youtube]'
        ).first().evaluate(el => {
          delete el.dataset.lmYoutubePauseRequested;
          el.dataset.smokeCachedPlayback = 'true';
          return {
            connected: el.isConnected,
            tabIndex: el.tabIndex
          };
        });
        if (!cachedPlaybackReset.connected || cachedPlaybackReset.tabIndex !== -1) {
          throw new Error('Cached YouTube frame did not return to its hidden non-focusable preload state.');
        }

        await playbackCard.click();
        await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });
        const cachedPauseOnReopen = await page.locator(
          '#lightboxMediaContainer iframe[data-lm-youtube][data-smokeCachedPlayback="true"]'
        ).first().getAttribute('data-lm-youtube-pause-requested');
        if (!cachedPauseOnReopen) {
          throw new Error('Reopening the Lightbox did not pause the previously cached YouTube player before reuse.');
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
        const localVideoGeometry = await firstVideo.locator('xpath=..').evaluate(el => {
          const r = el.getBoundingClientRect();
          return { height: r.height, viewportHeight: innerHeight };
        });
        if (localVideoGeometry.height > localVideoGeometry.viewportHeight * 0.73) {
          throw new Error(
            'Desktop local video is still oversized and can force unnecessary Lightbox scrolling: ' +
            JSON.stringify(localVideoGeometry)
          );
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

      await page.waitForFunction(() => {
        const lightbox = document.querySelector('#lightbox');
        const target = document.querySelectorAll('#lightboxMediaContainer .lightbox-media-item')[1];
        if (!lightbox || !target) return false;

        const targetRect = target.getBoundingClientRect();
        const hasTargetGeometry = targetRect.width > 0 && targetRect.height > 0;
        if (!hasTargetGeometry || lightbox.scrollHeight <= lightbox.clientHeight) return false;

        return lightbox.scrollTop > 0;
      }, null, { timeout: 3000 });

      const scrollState = await page.evaluate(() => ({
        lightboxTop: document.querySelector('#lightbox')?.scrollTop || 0,
        targetTop: document.querySelectorAll('#lightboxMediaContainer .lightbox-media-item')[1]?.getBoundingClientRect().top || 0,
        lightboxTopEdge: document.querySelector('#lightbox')?.getBoundingClientRect().top || 0,
        scrollHeight: document.querySelector('#lightbox')?.scrollHeight || 0,
        clientHeight: document.querySelector('#lightbox')?.clientHeight || 0
      }));
      if (scrollState.lightboxTop <= 0) {
        throw new Error('Opening a project directly on its model media did not move the Lightbox to the requested media item: ' + JSON.stringify(scrollState));
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

      const contactLayout = await page.evaluate(() => {
        const grid = document.querySelector('#web3-forms-container');
        const blocks = Array.from(grid?.querySelectorAll(':scope > .contact-block') || [])
          .map(block => {
            const rect = block.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          });
        const mobileTabs = document.querySelector('.contact-mobile-tabs');
        return {
          columns: blocks.filter(block => block.width > 0).length,
          sameRow: blocks.length >= 2 && Math.abs(blocks[0].y - blocks[1].y) <= 2,
          widthGap: blocks.length >= 2 ? Math.abs((blocks[0].x + blocks[0].width) - blocks[1].x) : 0,
          widthDelta: blocks.length >= 2 ? Math.abs(blocks[0].width - blocks[1].width) : Infinity,
          mobileTabsVisible: !!mobileTabs && getComputedStyle(mobileTabs).display !== 'none'
        };
      });
      if (
        contactLayout.columns < 2 ||
        !contactLayout.sameRow ||
        contactLayout.widthDelta > 2 ||
        contactLayout.mobileTabsVisible
      ) {
        throw new Error('Tablet Contact layout did not preserve the desktop side-by-side presentation: ' + JSON.stringify(contactLayout));
      }
    }, { width: 768, height: 900 });

    await smokePage(browser, '/', async page => {
      const contactLayout = await page.evaluate(() => {
        const blocks = Array.from(document.querySelectorAll('#web3-forms-container > .contact-block'))
          .map(block => block.getBoundingClientRect());
        return {
          count: blocks.length,
          sameRow: blocks.length >= 2 && Math.abs(blocks[0].y - blocks[1].y) <= 2,
          widthDelta: blocks.length >= 2 ? Math.abs(blocks[0].width - blocks[1].width) : Infinity
        };
      });
      if (contactLayout.count < 2 || !contactLayout.sameRow || contactLayout.widthDelta > 2) {
        throw new Error('1024px iPad/tablet Contact blocks drifted away from equal side-by-side sizing: ' + JSON.stringify(contactLayout));
      }
    }, { width: 1024, height: 900 });

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

    await smokePage(browser, '/', async page => {
      const filterButtons = page.locator('.filter-tabs .filter-btn, .filter-tabs .tab-btn');
      const allButton = page.locator('.filter-tabs [data-filter="all"]').first();
      const count = await filterButtons.count();
      if (count !== 1 || await allButton.count() !== 1) {
        throw new Error('Explicit empty filter CMS state did not collapse the Gallery controls to ALL only.');
      }
      if (!(await allButton.evaluate(el => el.classList.contains('active')))) {
        throw new Error('Explicit empty filter CMS state did not activate the ALL filter.');
      }
      const a11y = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('.filter-tabs .filter-btn, .filter-tabs .tab-btn'));
        return {
          activeCount: buttons.filter(button => button.classList.contains('active')).length,
          pressedCount: buttons.filter(button => button.getAttribute('aria-pressed') === 'true').length,
          allPressed: document.querySelector('.filter-tabs [data-filter="all"]')?.getAttribute('aria-pressed') || null
        };
      });
      if (a11y.activeCount !== 1 || a11y.pressedCount !== 1 || a11y.allPressed !== 'true') {
        throw new Error('Empty filter CMS state left Gallery ARIA state inconsistent: ' + JSON.stringify(a11y));
      }
    }, { width: 1280, height: 900 }, async page => {
      await page.route(`${BASE_URL}/data/filters.json**`, async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ filters: [] })
        });
      });
    });

    await smokePage(browser, '/', async page => {
      let unloads = 0;
      await page.evaluate(() => {
        window.__lmSmokeUnloadCount = 0;
        window.addEventListener('beforeunload', () => {
          window.__lmSmokeUnloadCount += 1;
        });
      });

      // Start from the exact user-reported state: Contact is active and its
      // hash is still present. Works and the LM logo must reset the document
      // to the top and remove that hash without reloading. Same-document
      // history.replaceState is expected and must not be mistaken for a
      // browser navigation.
      await page.locator('.nav-links a[href="#contact-start"]').first().click();
      await page.waitForTimeout(100);
      if (await page.evaluate(() => window.location.hash !== '#contact-start')) {
        throw new Error('Navigation smoke fixture failed to enter the Contact hash state.');
      }

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.locator('.nav-links .nav-dropdown-toggle').first().click();
      await page.waitForTimeout(80);
      const worksReset = await page.evaluate(() => ({
        scrollY: window.scrollY,
        hash: window.location.hash,
        path: window.location.pathname
      }));
      if (Math.abs(worksReset.scrollY) > 8) {
        throw new Error('Main-page Works navigation did not return to the top without reloading.');
      }
      if (worksReset.hash !== '') {
        throw new Error('Main-page Works navigation did not clear the Contact/filter hash: ' + worksReset.hash);
      }
      const worksFilterA11y = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('.filter-tabs .filter-btn, .filter-tabs .tab-btn'));
        return {
          activeCount: buttons.filter(button => button.classList.contains('active')).length,
          pressedCount: buttons.filter(button => button.getAttribute('aria-pressed') === 'true').length,
          allPressed: document.querySelector('.filter-tabs [data-filter="all"]')?.getAttribute('aria-pressed') || null
        };
      });
      if (
        worksFilterA11y.activeCount !== 1 ||
        worksFilterA11y.pressedCount !== 1 ||
        worksFilterA11y.allPressed !== 'true'
      ) {
        throw new Error('Main-page Works navigation restored ALL visually but left filter ARIA state inconsistent: ' + JSON.stringify(worksFilterA11y));
      }
      unloads = await page.evaluate(() => window.__lmSmokeUnloadCount);
      if (unloads !== 0) throw new Error('Main-page Works navigation triggered a document unload/reload.');

      // Recreate Contact state before checking the logo independently.
      await page.evaluate(() => {
        history.pushState(null, '', location.pathname + '#contact-start');
        window.scrollTo(0, document.body.scrollHeight);
      });
      await page.locator('.nav-logo').first().click();
      await page.waitForTimeout(60);
      const logoReset = await page.evaluate(() => ({
        scrollY: window.scrollY,
        hash: window.location.hash,
        path: window.location.pathname
      }));
      if (Math.abs(logoReset.scrollY) > 8) {
        throw new Error('Main-page LM logo navigation did not return to the top without reloading.');
      }
      if (logoReset.hash !== '') {
        throw new Error('Main-page LM logo navigation did not clear the Contact/filter hash: ' + logoReset.hash);
      }
      const logoFilterA11y = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('.filter-tabs .filter-btn, .filter-tabs .tab-btn'));
        return {
          activeCount: buttons.filter(button => button.classList.contains('active')).length,
          pressedCount: buttons.filter(button => button.getAttribute('aria-pressed') === 'true').length,
          allPressed: document.querySelector('.filter-tabs [data-filter="all"]')?.getAttribute('aria-pressed') || null
        };
      });
      if (
        logoFilterA11y.activeCount !== 1 ||
        logoFilterA11y.pressedCount !== 1 ||
        logoFilterA11y.allPressed !== 'true'
      ) {
        throw new Error('Main-page LM logo navigation left filter ARIA state inconsistent after Home reset: ' + JSON.stringify(logoFilterA11y));
      }
      unloads = await page.evaluate(() => window.__lmSmokeUnloadCount);
      if (unloads !== 0) throw new Error('Main-page LM logo navigation triggered a document unload/reload.');
    }, { width: 1280, height: 900 });

    await smokePage(browser, '/#3d-motion', async page => {
      const selected = page.locator('.filter-tabs [data-filter="3d-motion"]').first();
      const allButton = page.locator('.filter-tabs [data-filter="all"]').first();
      if (await selected.count() !== 1 || await allButton.count() !== 1) {
        throw new Error('Hash-restored Gallery filter smoke fixture is missing the expected filter controls.');
      }
      const state = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('.filter-tabs .filter-btn, .filter-tabs .tab-btn'));
        return {
          hash: window.location.hash,
          active: buttons.filter(button => button.classList.contains('active')).map(button => button.getAttribute('data-filter')),
          pressed: buttons.filter(button => button.getAttribute('aria-pressed') === 'true').map(button => button.getAttribute('data-filter'))
        };
      });
      if (state.hash !== '#3d-motion' ||
          state.active.length !== 1 ||
          state.active[0] !== '3d-motion' ||
          state.pressed.length !== 1 ||
          state.pressed[0] !== '3d-motion') {
        throw new Error('Direct filter-hash restoration left visual and ARIA state inconsistent: ' + JSON.stringify(state));
      }
    }, { width: 1280, height: 900 });

    await smokePage(browser, '/', async page => {
      const nonAllFilter = page.locator('.filter-tabs .filter-btn:not([data-filter="all"])').first();
      if (await nonAllFilter.count() !== 1) throw new Error('Desktop Gallery reset smoke fixture has no non-ALL filter.');
      await nonAllFilter.click();
      await page.waitForTimeout(120);
      if (await page.locator('.filter-tabs .filter-btn[data-filter="all"].active').count() !== 0) {
        throw new Error('Desktop Gallery smoke could not enter a selected non-ALL filter.');
      }

      await page.locator('.nav-links .nav-dropdown-toggle').first().click();
      await page.waitForTimeout(80);
      const reset = await page.evaluate(() => ({
        active: document.querySelector('.filter-tabs .filter-btn.active')?.getAttribute('data-filter') || '',
        hash: window.location.hash,
        visibleCards: Array.from(document.querySelectorAll('#portfolioGrid .project-card'))
          .filter(card => getComputedStyle(card).display !== 'none').length
      }));
      if (reset.active !== 'all' || reset.hash !== '') {
        throw new Error('Desktop Works navigation did not restore Gallery to ALL: ' + JSON.stringify(reset));
      }
      if (reset.visibleCards < 9) {
        throw new Error('Desktop Works navigation did not restore the full Gallery result set: ' + JSON.stringify(reset));
      }
    }, { width: 1280, height: 900 });

    await smokePage(browser, '/', async page => {
      const nonAllFilter = page.locator('.filter-tabs .filter-btn:not([data-filter="all"])').first();
      if (await nonAllFilter.count() !== 1) throw new Error('Mobile Gallery reset smoke fixture has no non-ALL filter.');
      await nonAllFilter.click();
      await page.waitForTimeout(100);

      await page.locator('.hamburger').click();
      await page.waitForTimeout(60);
      const worksLink = page.locator('.nav-links .nav-dropdown-toggle').first();
      if (await worksLink.count() !== 1) throw new Error('Mobile hamburger Works navigation link is missing.');
      await worksLink.click();
      await page.waitForTimeout(120);
      const reset = await page.evaluate(() => ({
        active: document.querySelector('.filter-tabs .filter-btn.active')?.getAttribute('data-filter') || '',
        hash: window.location.hash,
        menuOpen: document.body.classList.contains('menu-open'),
        visibleCards: Array.from(document.querySelectorAll('#portfolioGrid .project-card'))
          .filter(card => getComputedStyle(card).display !== 'none').length
      }));
      if (reset.active !== 'all' || reset.hash !== '') {
        throw new Error('Mobile hamburger Works navigation did not restore Gallery to ALL: ' + JSON.stringify(reset));
      }
      if (reset.menuOpen) throw new Error('Mobile hamburger Works navigation did not close the menu.');
      if (reset.visibleCards < 6) {
        throw new Error('Mobile hamburger Works navigation did not restore the full Gallery result set: ' + JSON.stringify(reset));
      }
    }, { width: 390, height: 844 });

    await smokePage(browser, '/', async page => {
      const contact = page.locator('.nav-links a[href="#contact-start"]').first();
      if (await contact.count() !== 1) throw new Error('Works page Contact navigation link is missing.');
      await contact.click();
      await page.waitForTimeout(120);
      const box = await page.locator('#contact-start').first().boundingBox();
      const contactPosition = await page.evaluate(() => {
        const heading = document.querySelector('#contact-start');
        const scrolling = document.scrollingElement || document.documentElement;
        const navbar = document.querySelector('.navbar')?.getBoundingClientRect?.().height || 0;
        const rect = heading?.getBoundingClientRect?.();
        const viewportHeight = Number(window.innerHeight) || 0;
        const maxScrollY = Math.max(0, (Number(scrolling?.scrollHeight) || 0) - viewportHeight);
        return {
          headingY: Number(rect?.y) || 0,
          navbarHeight: Number(navbar) || 0,
          viewportHeight: Number(window.innerHeight) || 0,
          scrollY: Number(window.scrollY) || Number(scrolling?.scrollTop) || 0,
          maxScrollY
        };
      });
      if (!box) throw new Error('Same-page Contact navigation did not reach the Start a Project heading.');
      const contactGroup = await page.locator('#contact-section .contact-grid').boundingBox();
      const usableTop = Math.max(contactPosition.navbarHeight + 24, 24);
      const usableCenter = usableTop + (Number(contactPosition.viewportHeight || 900) - usableTop) / 2;
      const groupCenter = contactGroup ? contactGroup.y + contactGroup.height / 2 : 0;
      const clampedAtDocumentBottom = Math.abs(contactPosition.scrollY - contactPosition.maxScrollY) <= 2;
      if (!contactGroup || (!clampedAtDocumentBottom && Math.abs(groupCenter - usableCenter) > 130) ||
          contactPosition.headingY < usableTop - 2) {
        throw new Error('Same-page Contact navigation did not center the Contact group cleanly: ' + JSON.stringify({
          contactPosition, contactGroup, usableTop, usableCenter, groupCenter, clampedAtDocumentBottom
        }));
      }
      if (!(await page.evaluate(() => window.location.hash === '#contact-start'))) {
        throw new Error('Same-page Contact navigation did not preserve the exact contact-start hash.');
      }
    }, { width: 1280, height: 900 });

    await smokePage(browser, '/', async page => {
      const contact = page.locator('.nav-links a[href="#contact-start"]').first();
      if (await contact.count() !== 1) {
        throw new Error('Works page Contact navigation does not target the exact Start a Project anchor.');
      }
      await contact.click();
      await page.waitForTimeout(120);
      const box = await page.locator('#contact-start').first().boundingBox();
      const contactPosition = await page.evaluate(() => {
        const heading = document.querySelector('#contact-start');
        const scrolling = document.scrollingElement || document.documentElement;
        const navbar = document.querySelector('.navbar')?.getBoundingClientRect?.().height || 0;
        const rect = heading?.getBoundingClientRect?.();
        const viewportHeight = Number(window.innerHeight) || 0;
        const maxScrollY = Math.max(0, (Number(scrolling?.scrollHeight) || 0) - viewportHeight);
        return {
          headingY: Number(rect?.y) || 0,
          navbarHeight: Number(navbar) || 0,
          scrollY: Number(window.scrollY) || Number(scrolling?.scrollTop) || 0,
          maxScrollY
        };
      });
      if (!box) throw new Error('Same-page Contact navigation did not reach the Start a Project heading.');
      const contactGroup = await page.locator('#contact-section .contact-grid').boundingBox();
      const usableTop = Math.max(contactPosition.navbarHeight + 24, 24);
      const usableCenter = usableTop + (Number(contactPosition.viewportHeight || 900) - usableTop) / 2;
      const groupCenter = contactGroup ? contactGroup.y + contactGroup.height / 2 : 0;
      const clampedAtDocumentBottom = Math.abs(contactPosition.scrollY - contactPosition.maxScrollY) <= 2;
      if (!contactGroup || (!clampedAtDocumentBottom && Math.abs(groupCenter - usableCenter) > 130) ||
          contactPosition.headingY < usableTop - 2) {
        throw new Error('Same-page Contact navigation did not center the Contact group cleanly: ' + JSON.stringify({
          contactPosition, contactGroup, usableTop, usableCenter, groupCenter, clampedAtDocumentBottom
        }));
      }
      if (!(await page.evaluate(() => window.location.hash === '#contact-start'))) {
        throw new Error('Same-page Contact navigation did not preserve the exact contact-start hash.');
      }
    }, { width: 1280, height: 900 });

    await smokePage(browser, '/', async page => {
      const hamburger = page.locator('.hamburger').first();
      await hamburger.click();
      await page.waitForTimeout(60);

      const overlay = await page.evaluate(() => {
        const backdrop = document.querySelector('.nav-menu-backdrop');
        const rect = backdrop?.getBoundingClientRect();
        return {
          exists: !!backdrop,
          hidden: backdrop?.hidden ?? true,
          position: backdrop ? getComputedStyle(backdrop).position : '',
          zIndex: backdrop ? getComputedStyle(backdrop).zIndex : '',
          top: rect?.top ?? -999,
          left: rect?.left ?? -999,
          width: rect?.width ?? 0,
          height: rect?.height ?? 0,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          menuOpen: document.body.classList.contains('menu-open')
        };
      });
      if (!overlay.exists || overlay.hidden || overlay.position !== 'fixed' ||
          Number(overlay.zIndex) !== 999 ||
          overlay.top !== 0 || overlay.left !== 0 ||
          Math.abs(overlay.width - overlay.viewportWidth) > 2 ||
          Math.abs(overlay.height - overlay.viewportHeight) > 2 ||
          !overlay.menuOpen) {
        throw new Error('Mobile hamburger backdrop is not a full viewport-fixed layer: ' + JSON.stringify(overlay));
      }

      await page.evaluate(() => window.scrollTo(0, Math.min(180, Math.max(0, document.body.scrollHeight - innerHeight))));
      await page.waitForTimeout(60);
      const scrolledOverlay = await page.evaluate(() => {
        const backdrop = document.querySelector('.nav-menu-backdrop');
        const r = backdrop?.getBoundingClientRect();
        return { top: r?.top ?? -999, left: r?.left ?? -999, width: r?.width ?? 0, height: r?.height ?? 0 };
      });
      if (scrolledOverlay.top !== 0 || scrolledOverlay.left !== 0 ||
          Math.abs(scrolledOverlay.width - 390) > 2 || Math.abs(scrolledOverlay.height - 844) > 2) {
        throw new Error('Mobile hamburger backdrop was clipped/displaced while scrolling: ' + JSON.stringify(scrolledOverlay));
      }

      await page.mouse.click(8, 760);
      await page.waitForTimeout(50);
      if (await page.evaluate(() => document.body.classList.contains('menu-open'))) {
        throw new Error('Outside tap no longer closes the mobile hamburger menu.');
      }
    }, { width: 390, height: 844 });

    await smokePage(browser, '/', async page => {
      const contact = page.locator('.nav-links a[href="#contact-start"]').first();
      await contact.click();
      await page.waitForTimeout(120);

      const desktopContact = await page.evaluate(() => {
        const group = document.querySelector('#contact-section .contact-grid');
        const heading = document.querySelector('#contact-start');
        const nav = document.querySelector('.navbar');
        const r = group?.getBoundingClientRect();
        const h = heading?.getBoundingClientRect();
        const n = nav?.getBoundingClientRect();
        const usableTop = Math.max((n?.height || 0) + 24, 24);
        const usableCenter = usableTop + (innerHeight - usableTop) / 2;
        const groupCenter = r ? r.top + r.height / 2 : 0;
        return {
          centerDelta: Math.abs(groupCenter - usableCenter),
          headingClear: (h?.top || 0) >= usableTop - 2,
          scrollY: scrollY
        };
      });
      if (desktopContact.centerDelta > 110 || !desktopContact.headingClear) {
        throw new Error('Desktop Contact auto-scroll did not center the full Contact group cleanly: ' + JSON.stringify(desktopContact));
      }

      const contactAlignment = await page.evaluate(() => {
        const rect = el => el?.getBoundingClientRect?.();
        const project = document.querySelector('#projectForm');
        const review = document.querySelector('#reviewForm');
        const pair = (a,b) => {
          const x=rect(a), y=rect(b);
          return x && y ? {
            topDelta:Math.abs(x.top-y.top),
            heightDelta:Math.abs(x.height-y.height),
            widthA:x.width,
            widthB:y.width
          } : null;
        };
        const stars = review?.querySelector('.star-rating');
        const starsStyle = stars ? getComputedStyle(stars) : null;
        return {
          name: pair(project?.querySelector('input[name="name"]'),review?.querySelector('input[name="name"]')),
          second: pair(project?.querySelector('input[name="email"]'),stars),
          message: pair(project?.querySelector('textarea[name="message"]'),review?.querySelector('textarea[name="review"]')),
          action: pair(project?.querySelector('button[type="submit"]'),review?.querySelector('button[type="submit"]')),
          starsBackground: starsStyle?.backgroundColor || '',
          projectFormWidth: project?.getBoundingClientRect?.().width || 0,
          reviewFormWidth: review?.getBoundingClientRect?.().width || 0
        };
      });
      for (const [key,value] of Object.entries(contactAlignment)) {
        if (['projectFormWidth','reviewFormWidth','starsBackground'].includes(key)) continue;
        if (!value || value.topDelta > 2 || value.heightDelta > 2) {
          throw new Error('Desktop Contact row mismatch: ' + key + ' => ' + JSON.stringify(value));
        }
      }
      if (!contactAlignment.starsBackground || contactAlignment.starsBackground === 'rgba(0, 0, 0, 0)') {
        throw new Error('Desktop Contact Stars field is missing its aligned field surface.');
      }

      const web3FormAuthFields = await page.locator('form.simple-form').evaluateAll(forms =>
        forms.map(form => ({
          id: form.id || '',
          accessKeyCount: form.querySelectorAll('input[name="access_key"]').length,
          legacyApiKeyCount: form.querySelectorAll('input[name="apikey"]').length
        }))
      );
      web3FormAuthFields.forEach(form => {
        if (form.accessKeyCount !== 1 || form.legacyApiKeyCount !== 0) {
          throw new Error(
            'Web3Forms credential field contract regressed: ' + JSON.stringify(form)
          );
        }
      });
    }, { width: 1280, height: 900 });

    await smokePage(browser, '/', async page => {
      const contact = page.locator('.nav-links a[href="#contact-start"]').first();
      // This test is about the final Contact geometry, not pointer hit-testing
      // against the animated hero. Dispatch the real click event so the
      // production navigation listener runs deterministically.
      await contact.dispatchEvent('click');
      await page.waitForTimeout(120);

      const mobileContact = await page.evaluate(() => {
        const group = document.querySelector('#contact-section .contact-grid');
        const heading = document.querySelector('#contact-start');
        const nav = document.querySelector('.navbar');
        const r = group?.getBoundingClientRect();
        const h = heading?.getBoundingClientRect();
        const n = nav?.getBoundingClientRect();
        const usableTop = Math.max((n?.height || 0) + 24, 24);
        const usableCenter = usableTop + (innerHeight - usableTop) / 2;
        const groupCenter = r ? r.top + r.height / 2 : 0;
        const maxY = Math.max(0, document.documentElement.scrollHeight - innerHeight);
        return {
          centerDelta: Math.abs(groupCenter - usableCenter),
          headingClear: (h?.top || 0) >= usableTop - 2,
          atBottom: Math.abs(scrollY - maxY) <= 3
        };
      });
      if ((!mobileContact.atBottom && mobileContact.centerDelta > 130) || !mobileContact.headingClear) {
        throw new Error('Mobile Contact auto-scroll did not produce a balanced group position: ' + JSON.stringify(mobileContact));
      }

      const mobileContactSizing = await page.evaluate(() => {
        const activePanel = document.querySelector('[data-contact-panel].is-contact-active');
        const fields = [
          activePanel?.querySelector('input[name="name"]'),
          activePanel?.querySelector('input[name="email"]'),
          activePanel?.querySelector('textarea'),
          activePanel?.querySelector('button[type="submit"]')
        ].filter(Boolean);
        return fields.map(el => ({
          width: el.getBoundingClientRect().width,
          viewport: innerWidth,
          panel: activePanel?.id || ''
        }));
      });
      mobileContactSizing.forEach(item => {
        if (item.width <= 0 || item.width > item.viewport - 32) {
          throw new Error('Mobile Contact control does not fit its viewport: ' + JSON.stringify(item));
        }
      });

      const mobileContactTabs = await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll('.contact-mobile-tab'));
        const panels = Array.from(document.querySelectorAll('[data-contact-panel]'));
        const activeTabs = tabs.filter(tab => tab.getAttribute('aria-selected') === 'true').length;
        const visiblePanels = panels.filter(panel => getComputedStyle(panel).display !== 'none').length;
        const tabRow = document.querySelector('.contact-mobile-tabs');
        const tabStyle = tabRow ? getComputedStyle(tabRow) : null;
        return {
          tabCount: tabs.length,
          activeTabs,
          visiblePanels,
          display: tabStyle?.display || '',
          active: tabRow?.getAttribute('data-active') || '',
          indicatorBackground: tabRow ? getComputedStyle(tabRow, '::before').backgroundColor : '',
          indicatorTransition: tabRow ? getComputedStyle(tabRow, '::before').transitionProperty : '',
          panelIds: panels.map(panel => ({ id: panel.id, display: getComputedStyle(panel).display }))
        };
      });
      if (mobileContactTabs.tabCount !== 2 || mobileContactTabs.activeTabs !== 1 ||
          mobileContactTabs.visiblePanels !== 1 || mobileContactTabs.display !== 'grid') {
        throw new Error('Mobile Contact did not collapse into a single active tab panel: '+JSON.stringify(mobileContactTabs));
      }

      await page.locator('#contactTabReview').click();
      await page.waitForTimeout(40);
      const reviewTabState = await page.evaluate(() => {
        const rail = document.querySelector('.contact-mobile-tabs');
        const indicator = rail ? getComputedStyle(rail, '::before') : null;
        return {
          projectTab: document.querySelector('#contactTabProject')?.getAttribute('aria-selected'),
          reviewTab: document.querySelector('#contactTabReview')?.getAttribute('aria-selected'),
          projectDisplay: getComputedStyle(document.querySelector('#contactProjectPanel')).display,
          reviewDisplay: getComputedStyle(document.querySelector('#contactReviewPanel')).display,
          active: rail?.getAttribute('data-active') || '',
          indicatorBackground: indicator?.backgroundColor || '',
          indicatorTransition: indicator?.transitionProperty || '',
          indicatorTransform: indicator?.transform || ''
        };
      });
      if (reviewTabState.projectTab !== 'false' || reviewTabState.reviewTab !== 'true' ||
          reviewTabState.projectDisplay !== 'none' || reviewTabState.reviewDisplay === 'none' ||
          reviewTabState.active !== 'review' ||
          reviewTabState.indicatorBackground !== 'rgb(255, 255, 255)' ||
          !reviewTabState.indicatorTransition.includes('transform')) {
        throw new Error('Mobile Contact tab switching did not activate the sliding review state: '+JSON.stringify(reviewTabState));
      }
      const contactTabStyles=await page.locator('.contact-mobile-tab').evaluateAll(tabs=>tabs.map(tab=>{
        const s=getComputedStyle(tab);
        return {border:s.borderStyle,width:s.borderWidth};
      }));
      contactTabStyles.forEach(style=>{
        if(style.border!=='none' || style.width!=='0px'){
          throw new Error('Mobile Contact tab retained an individual outline: '+JSON.stringify(style));
        }
      });

      const mobileGalleryMetadata = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('#portfolioGrid .project-card')).slice(0, 4);
        return cards.map(card => getComputedStyle(card.querySelector('.glass-info')).display);
      });
      if (mobileGalleryMetadata.some(display => display !== 'none')) {
        throw new Error('Mobile project title/subtitle metadata was re-enabled by a later CSS cascade: '+JSON.stringify(mobileGalleryMetadata));
      }
      await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
      await page.waitForTimeout(60);
      const filterOffscreen=await page.evaluate(()=>{
        const rail=document.querySelector('.filter-tabs');
        return {
          offscreen:!!rail && rail.getBoundingClientRect().bottom<=0,
          inert:!!rail?.inert,
          pointerEvents:rail?getComputedStyle(rail).pointerEvents:''
        };
      });
      // The filter rail must not use viewport visibility as an interaction lock.
      // Being off-screen is a presentation/scroll state, not an inert state.
      if(filterOffscreen.offscreen && (filterOffscreen.inert || filterOffscreen.pointerEvents==='none')){
        throw new Error('Off-screen mobile filter rail retained a disabled interaction state: '+JSON.stringify(filterOffscreen));
      }

      const filterRail=page.locator('.filter-tabs').first();
      await filterRail.scrollIntoViewIfNeeded();
      await page.waitForTimeout(60);
      await assertFilterButtonHitTarget(page,'Mobile Works after lower-page scroll');

      // Breakpoint-transition regression guard: filter interaction state must
      // survive mobile -> desktop -> mobile without leaving the rail inert,
      // pointer-disabled, or bound to the wrong layout mode.
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(120);
      const desktopFilterMode = await filterRail.evaluate(el => {
        const style = getComputedStyle(el);
        return {
          flexWrap: style.flexWrap,
          overflowX: style.overflowX,
          inert: el.inert,
          pointerEvents: style.pointerEvents
        };
      });
      if (
        desktopFilterMode.flexWrap !== 'wrap' ||
        desktopFilterMode.overflowX === 'auto' ||
        desktopFilterMode.inert ||
        desktopFilterMode.pointerEvents === 'none'
      ) {
        throw new Error(
          'Filter rail retained stale mobile interaction/layout state after switching to desktop: ' +
          JSON.stringify(desktopFilterMode)
        );
      }
      await assertFilterButtonHitTarget(page,'Desktop Works after mobile breakpoint');

      await page.locator('.filter-tabs [data-filter="all"]').first().click();
      await page.waitForTimeout(120);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(120);
      await filterRail.scrollIntoViewIfNeeded();
      await page.waitForTimeout(60);
      const restoredMobileFilterMode = await filterRail.evaluate(el => {
        const style = getComputedStyle(el);
        return {
          flexWrap: style.flexWrap,
          overflowX: style.overflowX,
          inert: el.inert,
          pointerEvents: style.pointerEvents
        };
      });
      if (
        restoredMobileFilterMode.flexWrap !== 'nowrap' ||
        restoredMobileFilterMode.overflowX !== 'auto' ||
        restoredMobileFilterMode.inert ||
        restoredMobileFilterMode.pointerEvents === 'none'
      ) {
        throw new Error(
          'Filter rail did not restore a directly interactive mobile carousel after a breakpoint round-trip: ' +
          JSON.stringify(restoredMobileFilterMode)
        );
      }
      await assertFilterButtonHitTarget(page,'Mobile Works after breakpoint round-trip');
    }, { width: 390, height: 844 });

    await smokePage(browser, '/', async page => {
      const typography = await page.evaluate(() => {
        const pick = selector => {
          const el = document.querySelector(selector);
          return el ? getComputedStyle(el).fontFamily : '';
        };
        return {
          body: pick('body'),
          display: pick('.hero-quote-text, .modal-header h2, .hello-heading'),
          label: pick('.section-title, .nav-links a, .filter-tabs .tab-btn'),
          accent: pick('.hero-quote-text')
        };
      });
      if (typography.body.toLowerCase().includes('monospace') ||
          typography.display.toLowerCase().includes('monospace') ||
          typography.label.toLowerCase().includes('monospace') ||
          typography.accent.toLowerCase().includes('monospace')) {
        throw new Error('Public typography still resolves a monospace family: ' + JSON.stringify(typography));
      }
      if (!/Inter/i.test(typography.body)) {
        throw new Error('Public body typography no longer resolves Inter as the primary family: ' + JSON.stringify(typography));
      }
      if (!/Satoshi/i.test(typography.display) && !/Inter/i.test(typography.display)) {
        throw new Error('Public display typography does not resolve the new sans hierarchy: ' + JSON.stringify(typography));
      }

      const rounded = await page.evaluate(() => {
        const selectors = ['.contact-primary','.review-card','.btn-show-more','input','textarea','select','.model-viewer-shell'];
        const supportsSquircle = CSS.supports?.('corner-shape', 'squircle') === true;
        const items = selectors.map(selector => {
          const el=document.querySelector(selector);
          if(!el) return {selector,missing:true};
          const style=getComputedStyle(el);
          return {selector,radius:style.borderRadius,cornerShape:style.cornerShape||'',border:style.borderStyle};
        });
        const card=document.querySelector('.project-card');
        const info=card?.querySelector('.glass-info');
        const cardRadius=parseFloat(card ? getComputedStyle(card).borderTopLeftRadius : '0');
        const infoRadius=parseFloat(info ? getComputedStyle(info).borderTopLeftRadius : '0');
        return {supportsSquircle,items,cardRadius,infoRadius};
      });
      if (rounded.cardRadius > 0 && rounded.infoRadius > 0 && rounded.infoRadius >= rounded.cardRadius) {
        throw new Error('Concentric inner artwork/info radius is not smaller than its parent radius: '+JSON.stringify(rounded));
      }
      if (rounded.supportsSquircle) {
        rounded.items.filter(item=>!item.missing).forEach(item=>{
          if(!item.cornerShape || item.cornerShape==='round') {
            throw new Error('Rounded UI did not resolve the squircle corner shape: '+JSON.stringify(item));
          }
        });
      }
      if (rounded.cardRadius !== 0 || rounded.infoRadius !== 0) {
        throw new Error('Gallery card/info should remain square: '+JSON.stringify(rounded));
      }
      rounded.items.filter(item=>!item.missing).forEach(item=>{
        if(item.radius==='0px') throw new Error('Rounded UI lost its radius: '+JSON.stringify(item));
        if(item.selector==='.btn-show-more' && item.border!=='none') throw new Error('Show More/Show Less retained a visible outline border: '+JSON.stringify(item));
      });

      const circleChecks = await page.evaluate(() => {
        const selectors = ['.filter-page-dot'];
        return selectors.map(selector => {
          const el = document.querySelector(selector);
          if (!el) return { selector,missing:true,rendered:false };
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const radius = parseFloat(style.borderRadius) || 0;
          const diameter = Math.min(rect.width, rect.height);
          return {
            selector,
            radius,
            diameter,
            width: rect.width,
            height: rect.height,
            rendered: rect.width > 0 && rect.height > 0,
            circular: Math.abs(rect.width - rect.height) <= 1 && radius >= (diameter / 2) - 1
          };
        }).filter(item=>item.rendered);
      });
      circleChecks.forEach(check => {
        if (!check.circular) {
          throw new Error('Circular control lost its circular geometry: ' + JSON.stringify(check));
        }
      });

      const socialChecks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.social-icons a')).map(el => {
          const style = getComputedStyle(el);
          return {
            radius: style.borderRadius,
            background: style.backgroundColor,
            borderStyle: style.borderStyle,
            borderWidth: style.borderWidth,
            width: el.getBoundingClientRect().width,
            height: el.getBoundingClientRect().height,
            color: style.color
          };
        });
      });
      socialChecks.forEach(check => {
        if (
          check.radius !== '0px' ||
          check.borderStyle !== 'none' ||
          check.borderWidth !== '0px' ||
          !/rgba\(0, 0, 0, 0\)|transparent/i.test(check.background)
        ) {
          throw new Error('Social icon retained a visible container: ' + JSON.stringify(check));
        }
      });

      const footerAnimation = await page.evaluate(() => ({
        exists: !!document.querySelector('#footerAnimation'),
        slides: document.querySelectorAll('#footerAnimation .footer-animation-slide').length,
        hidden: !!document.querySelector('#footerAnimation')?.hidden,
        radius: document.querySelector('#footerAnimation') ? getComputedStyle(document.querySelector('#footerAnimation')).borderRadius : ''
      }));
      const footerLayout = await page.evaluate(() => {
        const footer = document.querySelector('footer');
        const media = document.querySelector('#footerAnimation');
        const content = document.querySelector('.footer-content');
        if (!footer || !media || !content) return null;
        const footerStyle = getComputedStyle(footer);
        const mediaStyle = getComputedStyle(media);
        const contentStyle = getComputedStyle(content);
        const fade = document.querySelector('.footer-fade');
        const fadeStyle = fade ? getComputedStyle(fade) : null;
        return {
          footerHeight: footer.getBoundingClientRect().height,
          mediaHeight: media.getBoundingClientRect().height,
          mediaRadius: mediaStyle.borderRadius,
          mediaPosition: mediaStyle.position,
          contentPosition: contentStyle.position,
          contentZ: contentStyle.zIndex,
          foreground: footerStyle.getPropertyValue('--footer-foreground').trim(),
          fadeExists: !!fade,
          fadePosition: fadeStyle?.position || '',
          fadeZ: fadeStyle?.zIndex || '',
          footerColor: footerStyle.color,
          socialColors: Array.from(document.querySelectorAll('footer .social-icons a')).map(a => getComputedStyle(a).color)
        };
      });
      if (!footerLayout) throw new Error('Public footer layout surface is missing.');
      if (footerLayout.mediaRadius!=='0px' || footerLayout.mediaPosition!=='absolute') {
        throw new Error('Footer media is not a square, full-stage background layer: '+JSON.stringify(footerLayout));
      }
      if (!footerLayout.fadeExists || footerLayout.fadePosition!=='absolute' || footerLayout.fadeZ!=='1') {
        throw new Error('Footer readability fade is not the dedicated middle layer: '+JSON.stringify(footerLayout));
      }
      if (footerLayout.contentPosition!=='relative' || footerLayout.contentZ!=='6') {
        throw new Error('Footer content is not layered above the artwork/fade: '+JSON.stringify(footerLayout));
      }
      if (footerLayout.mediaHeight < footerLayout.footerHeight - 1 || footerLayout.footerHeight < 420) {
        throw new Error('Footer stage is not large enough or artwork does not fill it: '+JSON.stringify(footerLayout));
      }
      if (footerLayout.footerColor !== 'rgb(255, 255, 255)') {
        throw new Error('Footer content foreground is not locked to white: '+JSON.stringify(footerLayout));
      }
      if (footerLayout.socialColors.some(color => color !== 'rgb(255, 255, 255)')) {
        throw new Error('Footer social icons are not white: '+JSON.stringify(footerLayout));
      }

      const footerSocialGeometry = await page.evaluate(() => {
        const row = document.querySelector('footer .social-icons');
        const links = Array.from(row?.querySelectorAll(':scope > a') || []);
        const rowStyle = row ? getComputedStyle(row) : null;
        const first = links[0]?.getBoundingClientRect();
        const overflowY = Number(row?.scrollHeight || 0) > Number(row?.clientHeight || 0) + 1;
        return {
          linkCount: links.length,
          width: first?.width || 0,
          height: first?.height || 0,
          flexWrap: rowStyle?.flexWrap || '',
          overflowX: rowStyle?.overflowX || '',
          overflowY
        };
      });
      if (footerSocialGeometry.width < 47 || footerSocialGeometry.height < 47) {
        throw new Error('Footer social icons are not using the new 48px shared footprint: '+JSON.stringify(footerSocialGeometry));
      }
      if (footerSocialGeometry.flexWrap !== 'nowrap' || footerSocialGeometry.overflowX === 'visible' || footerSocialGeometry.overflowY) {
        throw new Error('Footer social row can wrap vertically or has incorrect overflow behavior: '+JSON.stringify(footerSocialGeometry));
      }
      const footerSocialCenter=await page.evaluate(()=>{
        const footer=document.querySelector('footer')?.getBoundingClientRect();
        const row=document.querySelector('footer .social-icons')?.getBoundingClientRect();
        return {delta:footer&&row?Math.abs((row.left+row.width/2)-(footer.left+footer.width/2)):9999};
      });
      if(footerSocialCenter.delta>2){
        throw new Error('Footer social icon row is not centered: '+JSON.stringify(footerSocialCenter));
      }

      const showMoreGeometry = await page.evaluate(() => {
        const button = document.querySelector('#showMoreBtn');
        const style = button ? getComputedStyle(button) : null;
        return {
          borderRadius: style?.borderRadius || '',
          background: style?.backgroundColor || '',
          backdropFilter: style?.backdropFilter || '',
          width: button?.getBoundingClientRect?.().width || 0
        };
      });
      if (parseFloat(showMoreGeometry.borderRadius || '0') < 100) {
        throw new Error('Show More / Show Less control is not pill-shaped: '+JSON.stringify(showMoreGeometry));
      }
      if (
        showMoreGeometry.background !== 'rgba(255, 255, 255, 0.08)' ||
        showMoreGeometry.backdropFilter === 'none'
      ) {
        throw new Error('Collapsed Show More control did not retain the requested glass material: ' + JSON.stringify(showMoreGeometry));
      }
      if (!['#fff','#000','rgb(255, 255, 255)','rgb(0, 0, 0)'].includes(footerLayout.foreground)) {
        throw new Error('Footer foreground contrast token is not resolved: '+JSON.stringify(footerLayout));
      }

      const backToTop = await page.locator('footer a[href="#"]').count();
      const backToTopLabel = await page.getByText(/back\s*to\s*top/i).count();
      if (backToTop || backToTopLabel) {
        throw new Error('Back to Top control is still present on the public page.');
      }

    }, { width: 1280, height: 900 });

    await smokePage(browser, '/about/', async page => {
      await assertMobileNavigation(page, 'About page');
      const moduleScript = await page.locator('script[type="module"][src*="script.js"]').count();
      if (moduleScript !== 1) throw new Error('About page is missing its module bootstrap script.');

      const hero = page.locator('#heroBannerAbout, #heroBanner').first();
      const aboutHeadlineType = await page.evaluate(() => {
        const el=document.querySelector('.about-hero-overlay .hello-heading');
        if(!el) return null;
        const style=getComputedStyle(el);
        return {family:style.fontFamily,weight:style.fontWeight};
      });
      if(aboutHeadlineType && (aboutHeadlineType.weight!=='900' || !/Satoshi/i.test(aboutHeadlineType.family))){
        throw new Error('About headline is not using Satoshi Black (900): '+JSON.stringify(aboutHeadlineType));
      }

      if (await hero.count() !== 1) throw new Error('About page hero container is missing.');

      const aboutSocialGeometry = await page.evaluate(() => {
        const row = document.querySelector('.about-social-icons');
        const links = Array.from(row?.querySelectorAll(':scope > a') || []);
        const style = row ? getComputedStyle(row) : null;
        const first = links[0]?.getBoundingClientRect();
        return {
          width: first?.width || 0,
          height: first?.height || 0,
          flexWrap: style?.flexWrap || '',
          overflowX: style?.overflowX || '',
          justifyContent: style?.justifyContent || '',
          overflowY: Number(row?.scrollHeight || 0) > Number(row?.clientHeight || 0) + 1
        };
      });
      if (aboutSocialGeometry.width < 47 || aboutSocialGeometry.height < 47 ||
          aboutSocialGeometry.flexWrap !== 'nowrap' ||
          aboutSocialGeometry.justifyContent !== 'flex-start' ||
          aboutSocialGeometry.overflowY) {
        throw new Error('About hero social icon row is not left-aligned with the hero text column: '+JSON.stringify(aboutSocialGeometry));
      }

      const experience = await page.locator('#experienceList .timeline-item').count();
      const education = await page.locator('#educationList .timeline-item').count();
      const awards = await page.locator('#awardsList .timeline-item').count();
      const softwareSkills = await page.locator('#softwareSkillsList li').count();
      await page.locator('#softwareSkillsList li.has-logo img.skill-logo').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      const softwareImages = await page.locator('#softwareSkillsList li.has-logo img.skill-logo').count();
      const brokenImages = await page.locator('#softwareSkillsList li.has-logo img.skill-logo').evaluateAll(images => images.filter(img => !img.complete || !img.naturalWidth).length);
      const kritaImage = page.locator('#softwareSkillsList li.has-logo img[alt="Krita"]').first();
      const afterEffectsImage = page.locator('#softwareSkillsList li.has-logo img[alt="After Effects"], #softwareSkillsList li.has-logo img[alt="Adobe After Effects"]').first();
      const adobeAssetChecks = await page.locator('#softwareSkillsList li.has-logo img.skill-logo').evaluateAll(images =>
        images.map(img => ({
          alt: img.getAttribute('alt') || '',
          src: img.getAttribute('src') || '',
          naturalWidth: img.naturalWidth || 0,
          broken: !img.complete || !img.naturalWidth
        }))
      );

      if (experience < 1) throw new Error('About page rendered no work experience entries.');
      if (education < 1) throw new Error('About page rendered no education entries.');
      if (awards < 1) throw new Error('About page rendered no awards entries.');
      if (softwareSkills < 1) throw new Error('About page rendered no software skills.');
      if (softwareImages < 1) throw new Error('About page software-logo mode is enabled but no software logo rendered.');
      const publicSoftwareLogoFilters=await page.locator('#softwareSkillsList li.has-logo img.skill-logo').evaluateAll(images=>images.map(img=>getComputedStyle(img).filter));
      publicSoftwareLogoFilters.forEach(filter=>{
        if(filter!=='none') throw new Error('About software logo retained a color filter: '+filter);
      });
      if (brokenImages) throw new Error('About page contains a visibly broken software-logo image.');
      if (await kritaImage.count()) {
        const src = await kritaImage.getAttribute('src');
        const usesBundledKrita = /\/assets\/projects\/site\/logos\/krita\.(?:png|svg|webp)(?:[?#]|$)/i.test(src || '');
        const usesSimpleIconsKrita = src?.includes('cdn.simpleicons.org/krita');
        if (!src || (!usesBundledKrita && !usesSimpleIconsKrita)) {
          throw new Error('About page Krita logo did not use its bundled local asset or the Simple Icons fallback.');
        }
      }

      if (await afterEffectsImage.count()) {
        const src = await afterEffectsImage.getAttribute('src');
        if (!src?.includes('/assets/projects/site/logos/adobe-after-effects-cc.png')) {
          throw new Error('About page After Effects logo left its bundled Adobe asset path.');
        }
      }

      const aboutFooter = await page.evaluate(() => {
        const footer = document.querySelector('footer');
        const media = document.querySelector('#footerAnimation');
        const fade = document.querySelector('.footer-fade');
        const content = document.querySelector('.footer-content');
        return {
          exists: !!footer && !!media && !!fade && !!content,
          mediaHidden: !!media?.hidden,
          slides: media?.querySelectorAll('.footer-animation-slide').length || 0,
          footerHeight: footer?.getBoundingClientRect().height || 0,
          fadePosition: fade ? getComputedStyle(fade).position : '',
          fadeZ: fade ? getComputedStyle(fade).zIndex : '',
          contentZ: content ? getComputedStyle(content).zIndex : '',
          contentColor: content ? getComputedStyle(content).color : '',
          socialColors: Array.from(document.querySelectorAll('footer .social-icons a')).map(a => getComputedStyle(a).color)
        };
      });
      if (!aboutFooter.exists || aboutFooter.mediaHidden || aboutFooter.slides < 1) {
        throw new Error('About page footer artwork is missing or hidden: '+JSON.stringify(aboutFooter));
      }
      if (aboutFooter.footerHeight < 420 || aboutFooter.fadePosition !== 'absolute' || aboutFooter.fadeZ !== '1' || aboutFooter.contentZ !== '6') {
        throw new Error('About page footer layer geometry is incorrect: '+JSON.stringify(aboutFooter));
      }
      if (aboutFooter.contentColor !== 'rgb(255, 255, 255)' ||
          aboutFooter.socialColors.some(color => color !== 'rgb(255, 255, 255)')) {
        throw new Error('About page footer content is not white: '+JSON.stringify(aboutFooter));
      }

      const aboutFooterSocialCenter = await page.evaluate(() => {
        const footer = document.querySelector('footer')?.getBoundingClientRect();
        const row = document.querySelector('footer .social-icons')?.getBoundingClientRect();
        return {
          delta: footer && row ? Math.abs((row.left + row.width / 2) - (footer.left + footer.width / 2)) : 9999
        };
      });
      if (aboutFooterSocialCenter.delta > 2) {
        throw new Error('About footer social icon row is not centered: ' + JSON.stringify(aboutFooterSocialCenter));
      }

      const expectedBundledAdobe = [
        'After Effects',
        'Illustrator',
        'Photoshop',
        'Premier Pro',
        'Figma'
      ];
      for (const name of expectedBundledAdobe) {
        const entry = adobeAssetChecks.find(item => item.alt === name);
        if (!entry) throw new Error('About page missing expected software logo entry: ' + name);
        if (entry.broken || entry.naturalWidth <= 0) {
          throw new Error('About page expected software logo is broken: ' + JSON.stringify(entry));
        }
      }

      const aboutContact = page.locator('.nav-links a[href="../#contact-start"]').first();
      if (await aboutContact.count() !== 1) {
        throw new Error('About page Contact navigation does not target the exact Start a Project anchor.');
      }
      await page.locator('.hamburger').first().click();
      await aboutContact.click();
      // Cross-page bootstrap must finish its branded loading gate and exact
      // hash settlement before we evaluate the final viewport position.
      await page.locator('#pageTransition[data-loading="ready"]').waitFor({
        state: 'attached',
        timeout: 6000
      });
      await page.waitForTimeout(120);
      const contactPosition = await page.evaluate(() => {
        const group=document.querySelector('#contact-section .contact-grid');
        const heading=document.querySelector('#contact-start');
        const nav=document.querySelector('.navbar');
        const r=group?.getBoundingClientRect();
        const h=heading?.getBoundingClientRect();
        const n=nav?.getBoundingClientRect();
        const usableTop=Math.max((n?.height||0)+24,24);
        const usableCenter=usableTop+(innerHeight-usableTop)/2;
        const groupCenter=r?r.top+r.height/2:0;
        return {
          centerDelta:Math.abs(groupCenter-usableCenter),
          headingClear:(h?.top||0)>=usableTop-2,
          hasHeading:!!h
        };
      });
      if (!contactPosition.hasHeading || contactPosition.centerDelta > 130 || !contactPosition.headingClear) {
        throw new Error('Cross-page Contact navigation did not center the Contact group cleanly: '+JSON.stringify(contactPosition));
      }
      if (!(await page.evaluate(() => window.location.hash === '#contact-start'))) {
        throw new Error('Cross-page Contact navigation did not preserve the exact contact-start hash.');
      }

      // The Contact check intentionally comes first because it keeps this
      // About-page assertion on the About document. The filter check then
      // verifies the independent cross-page About -> Works gallery target.
      await page.goto(`${BASE_URL}/about/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(120);
      await assertPublicFilterNavigation(page, {
        href: '../#3d-motion',
        expectedHash: '#3d-motion',
        label: 'About-to-Works'
      });
    }, { width: 390, height: 844 }, null, async page => {
      await page.waitForTimeout(700);
      const transition = page.locator('#pageTransition').first();
      const headline = page.locator('#aboutHeadline').first();
      const transitionLoading = await transition.getAttribute('data-loading');
      const transitionVisible = await transition.isVisible().catch(() => false);
      if (transitionLoading === 'active' && transitionVisible) {
        throw new Error('About first paint is still blocked by CMS hydration after 700ms.');
      }
      if (!(await headline.isVisible().catch(() => false))) {
        throw new Error('About static hero text is not available during the fast first paint.');
      }
    });

    await smokePage(browser, '/', async page => {
      await page.locator('.hamburger').first().click();
      const contact = page.locator('.nav-links a[href="#contact-start"]').first();
      if (await contact.count() !== 1) throw new Error('Mobile Works Contact navigation link is missing.');
      await contact.click();
      await page.waitForTimeout(160);
      if (await page.locator('.nav-links.active, .nav-links.is-open').count() > 0) {
        throw new Error('Mobile Contact navigation left the hamburger menu open.');
      }
      const mobileContact = await page.evaluate(() => {
        const group=document.querySelector('#contact-section .contact-grid');
        const heading=document.querySelector('#contact-start');
        const nav=document.querySelector('.navbar');
        const r=group?.getBoundingClientRect();
        const h=heading?.getBoundingClientRect();
        const n=nav?.getBoundingClientRect();
        const usableTop=Math.max((n?.height||0)+24,24);
        const usableCenter=usableTop+(innerHeight-usableTop)/2;
        const groupCenter=r?r.top+r.height/2:0;
        return {
          centerDelta:Math.abs(groupCenter-usableCenter),
          headingClear:(h?.top||0)>=usableTop-2
        };
      });
      if (mobileContact.centerDelta > 130 || !mobileContact.headingClear) {
        throw new Error('Mobile same-page Contact auto-scroll did not balance the Contact group: '+JSON.stringify(mobileContact));
      }
      if (!(await page.evaluate(() => window.location.hash === '#contact-start'))) {
        throw new Error('Mobile same-page Contact navigation did not preserve the exact contact-start hash.');
      }
    }, { width: 390, height: 844 });

    let cmsSmokeMediaSha = 'smoke-jpg';
    let cmsSmokeUploadPayload = null;
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

      // Cancelling an unsaved-change navigation happens while the intentionally
      // delayed save is still in flight. The originating section must remain
      // active, and the in-flight save must not be mistaken for deployment
      // tracking yet.
      let cancelledNavigationDialogSeen = false;
      page.once('dialog', dialog => {
        cancelledNavigationDialogSeen = true;
        dialog.dismiss();
      });
      await mediaNav.click();
      if (!cancelledNavigationDialogSeen) throw new Error('CMS did not ask before leaving a dirty section.');
      if ((await page.locator('#topbarSection').textContent()).trim() !== 'Hero Messages') {
        throw new Error('Cancelling dirty CMS navigation unexpectedly changed sections.');
      }
      const statusWhileSaveIsInFlight = (await page.locator('#saveStatusText').textContent()).trim();
      if (!statusWhileSaveIsInFlight) {
        throw new Error('Cancelling dirty CMS navigation cleared the originating Save status while the save was still in flight.');
      }

      // The delayed save should then complete on the still-current section and
      // transition into deployment tracking. This verifies the cancellation
      // did not invalidate the tracker that belongs to the approved save.
      await page.waitForFunction(
        () => document.querySelector('#saveStatusText')?.textContent?.trim() === 'Deploying…',
        null,
        { timeout: 2000 }
      );

      // The delayed save has completed and cleared the originating dirty
      // state before this approved navigation. Do not leave a dialog handler
      // armed here: the next section intentionally uses a prompt, and a stale
      // one-shot listener would consume that prompt and double-handle it.
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

      // Upload over an existing filename: the API must receive the current
      // Contents SHA, then the tile should use the returned SHA as its cache key.
      await page.locator('#content #uploadPath').fill('assets/projects');
      await page.locator('#content #fileInput').setInputFiles({
        name: 'smoke.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('replacement image bytes')
      });
      await page.waitForFunction(() => {
        const image = Array.from(document.querySelectorAll('#content #mediaGrid .media-tile img'))
          .find(node => node.closest('.media-tile')?.textContent?.includes('smoke.jpg'));
        return image && new URL(image.src).searchParams.get('v') === 'smoke-replac';
      }, null, { timeout: 8000 });
      if (!cmsSmokeUploadPayload || cmsSmokeUploadPayload.sha !== 'smoke-jpg') {
        throw new Error('CMS same-name media upload did not send the current existing-file SHA.');
      }

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
      try {
        await page.locator('#content #projList .card-item').first().waitFor({ state: 'visible', timeout: 5000 });
      } catch (error) {
        const sectionError = await page.locator('#content [data-error-message]').textContent().catch(() => '');
        const contentText = await page.locator('#content').innerText().catch(() => '');
        throw new Error(
          `CMS Projects section failed to render: ${sectionError?.trim() || contentText?.trim() || error.message}`
        );
      }
      const curatedDirtyAfterLeave = await page.locator('#dirty-curatedViews').evaluate(el => getComputedStyle(el).display);
      if (curatedDirtyAfterLeave !== 'none') throw new Error('Curated Views dirty state leaked across CMS section navigation.');
      await projectsNav.click();
      await page.locator('#content #projList .card-item').first().waitFor({ state: 'visible', timeout: 5000 });

      const testProject = page.locator('#content #projList .card-item').filter({ hasText: 'Test Project' }).first();
      if (await testProject.count() !== 1) throw new Error('CMS Projects editor did not render the test-project fixture.');

      const projectRowsInitial = await page.locator('#content #projList .project-list-item').evaluateAll(rows =>
        rows.map(row => ({
          open: row.classList.contains('is-open'),
          bodyDisplay: getComputedStyle(row.querySelector('[data-body]')).display,
          title: row.querySelector('.item-title')?.textContent?.trim() || '',
          subtitle: row.querySelector('.project-preview-text')?.textContent?.trim() || '',
          hasPreview: !!row.querySelector('.project-collapsed-preview'),
          hasActions: !!row.querySelector('.project-card-actions')
        }))
      );
      if (!projectRowsInitial.length || projectRowsInitial.some(row => row.open || row.bodyDisplay !== 'none')) {
        throw new Error('CMS Projects tab opened a project automatically instead of showing the list closed.');
      }
      const closedProjectGeometry = await testProject.evaluate(row => {
        const head=row.querySelector('.project-card-head')?.getBoundingClientRect();
        const preview=row.querySelector('.project-collapsed-preview')?.getBoundingClientRect();
        const label=row.querySelector('.project-item-label')?.getBoundingClientRect();
        const actions=row.querySelector('.project-card-actions')?.getBoundingClientRect();
        const headStyle=row.querySelector('.project-card-head') ? getComputedStyle(row.querySelector('.project-card-head')) : null;
        const style=getComputedStyle(row);
        return {
          display:headStyle?.display || '',
          columns:headStyle?.gridTemplateColumns || '',
          row: head ? {left:head.left,right:head.right,top:head.top,bottom:head.bottom} : null,
          preview: preview ? {left:preview.left,right:preview.right,top:preview.top,bottom:preview.bottom,width:preview.width,height:preview.height} : null,
          label: label ? {left:label.left,right:label.right,top:label.top,bottom:label.bottom} : null,
          actions: actions ? {left:actions.left,right:actions.right,top:actions.top,bottom:actions.bottom} : null,
          radius: style.borderRadius
        };
      });
      if (closedProjectGeometry.display !== 'grid') {
        throw new Error('CMS collapsed Project header lost its grid presentation: '+JSON.stringify(closedProjectGeometry));
      }
      if (!closedProjectGeometry.preview || !closedProjectGeometry.label || !closedProjectGeometry.actions) {
        throw new Error('Closed CMS Project shell is missing its thumbnail, title/subtitle block, or action layer: '+JSON.stringify(closedProjectGeometry));
      }
      if (closedProjectGeometry.preview.right < closedProjectGeometry.label.right ||
          closedProjectGeometry.preview.right > closedProjectGeometry.actions.left + 6) {
        throw new Error('CMS closed Project thumbnail is not positioned to the right of the title/subtitle and immediately before the action layer: '+JSON.stringify(closedProjectGeometry));
      }
      if (closedProjectGeometry.preview.height < 50 || closedProjectGeometry.preview.width < 60) {
        throw new Error('CMS closed Project thumbnail is undersized: '+JSON.stringify(closedProjectGeometry));
      }
      if (closedProjectGeometry.radius === '0px') {
        throw new Error('CMS closed Project shell lost its rounded corner geometry.');
      }
      const sampleRow = projectRowsInitial[0];
      if (!sampleRow.title || !sampleRow.hasPreview || !sampleRow.hasActions) {
        throw new Error('CMS closed Project row is missing its title, thumbnail preview, or action layer: ' + JSON.stringify(sampleRow));
      }
      // Keep the existing image-thumb fixture for the Curated Views picker,
      // and use a separate project to exercise a Lottie thumbnail row.
      const lottieThumbProject = page.locator('#content #projList .project-list-item').filter({ hasText: 'Lottie Thumbnail Fixture' }).first();
      if (await lottieThumbProject.count() !== 1) throw new Error('CMS Lottie-thumbnail project fixture is missing.');
      const rowLottiePreview = lottieThumbProject.locator('.project-collapsed-preview [data-preview-type="lottie"]').first();
      if (await rowLottiePreview.count() !== 1) {
        throw new Error('CMS project row did not render its configured Lottie thumbnail. Check thumbnail type/source handling independently from the media editor.');
      }
      try {
        await page.waitForFunction(() => {
          const row = Array.from(document.querySelectorAll('#projList .project-list-item'))
            .find(candidate => candidate.querySelector('.item-title')?.textContent.includes('Lottie Thumbnail Fixture'));
          const preview = row?.querySelector('.project-collapsed-preview');
          const player = preview?.querySelector('[data-preview-type="lottie"]');
          const rect = preview?.getBoundingClientRect();
          return !!player && !!rect && rect.width > 0 && rect.height > 0 &&
            player.dataset.previewState === 'ready' && player.hasAttribute('src') &&
            !!window.customElements?.get?.('lottie-player') &&
            !!player.shadowRoot?.querySelector('svg') && !!player.getLottie?.();
        }, null, { timeout: 16000 });
      } catch (error) {
        const diagnostic = await page.evaluate(() => {
          const row = Array.from(document.querySelectorAll('#projList .project-list-item'))
            .find(candidate => candidate.querySelector('.item-title')?.textContent.includes('Lottie Thumbnail Fixture'));
          const preview = row?.querySelector('.project-collapsed-preview');
          const player = preview?.querySelector('[data-preview-type="lottie"]');
          return {
            state: player?.dataset.previewState || null,
            active: player?.dataset.previewActive || null,
            src: player?.getAttribute('src') || null,
            customElementRegistered: !!window.customElements?.get?.('lottie-player'),
            shadowRoot: !!player?.shadowRoot,
            svgCount: player?.shadowRoot?.querySelectorAll('svg').length ?? 0,
            hasGetLottie: typeof player?.getLottie === 'function',
            lottieInstance: !!player?.getLottie?.(),
            errorText: preview?.querySelector('.project-collapsed-preview-error')?.textContent || null,
            html: player?.outerHTML?.slice(0, 500) || null
          };
        });
        throw new Error('CMS Lottie thumbnail did not render: ' + JSON.stringify(diagnostic) + '; ' + error.message);
      }
      await lottieThumbProject.locator('[data-toggle-open]').click();
      await page.waitForFunction(() => {
        const row = Array.from(document.querySelectorAll('#projList .project-list-item.is-open'))
          .find(candidate => candidate.querySelector('.item-title')?.textContent.includes('Lottie Thumbnail Fixture'));
        const preview = row?.querySelector('.project-collapsed-preview');
        const player = preview?.querySelector('[data-preview-type="lottie"]');
        const rect = preview?.getBoundingClientRect();
        return !!player && !!rect && rect.width >= 60 && rect.height >= 50 &&
          getComputedStyle(preview).display !== 'none' &&
          player.dataset.previewState === 'ready' && player.hasAttribute('src');
      }, null, { timeout: 8000 });
      await lottieThumbProject.locator('[data-toggle-open]').click();

      const testBody = testProject.locator('[data-body]').first();
      const bodyStyle = await testBody.getAttribute('style');
      if (!bodyStyle?.includes('display:block')) await testProject.locator('[data-toggle-open]').click();

      // Target the named Lottie fixture rather than assuming media order.
      // The fixture intentionally contains image → Lottie → 3D media so the
      // editor cannot accidentally depend on a particular ordering.
      const lottieMedia = testProject.locator('[data-medialist] .card-item').filter({ hasText: 'Lottie fixture' }).first();
      if (await lottieMedia.count() !== 1) throw new Error('CMS test-project Lottie media row is missing.');
      const lottieType = lottieMedia.locator('select[data-mf="type"]').first();
      if (await lottieType.count() !== 1 || (await lottieType.inputValue()) !== 'lottie') {
        throw new Error('CMS smoke fixture located the wrong media row for the Lottie background-control test.');
      }
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

      const cmsLottiePreview = lottieMedia.locator('[data-mediapreview] .media-preview').first();
      await page.waitForFunction(() => {
        // Scope the geometry assertion to the named Lottie fixture. A Project
        // contains multiple media rows, so a global first-preview selector can
        // accidentally measure the preceding image row.
        const row = Array.from(document.querySelectorAll('#projList .project-list-item .card-item'))
          .find(card => (card.textContent || '').includes('Lottie fixture'));
        const box = row?.querySelector('[data-mediapreview] .media-preview');
        if (!box) return false;
        const rect = box.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && Math.abs((rect.width / rect.height) - (440 / 478)) < 0.01;
      }, null, { timeout: 5000 });
      const cmsLottieRatio = await cmsLottiePreview.evaluate(el => ({
        ratio: el.getBoundingClientRect().height
          ? el.getBoundingClientRect().width / el.getBoundingClientRect().height
          : 0,
        styleRatio: el.style.aspectRatio || ''
      }));
      if (Math.abs(cmsLottieRatio.ratio - (440 / 478)) > 0.01) {
        throw new Error(`CMS Lottie preview did not adopt intrinsic JSON geometry: ${JSON.stringify(cmsLottieRatio)}`);
      }


      page.once('dialog', dialog => dialog.accept());
      await nav.click();
      await page.locator('#content #tags_software').waitFor({ state: 'visible', timeout: 5000 });

      const cmsLogoFilters=await page.locator('#tags_software .skill-pill-icon img.skill-logo').evaluateAll(images=>images.map(img=>getComputedStyle(img).filter)).catch(()=>[]);
      cmsLogoFilters.forEach(filter=>{if(filter!=='none') throw new Error('CMS software logo preview retained a color filter: '+filter);});
      const softwareRows = await page.locator('#tags_software .skill-editor-row').count();
      if (softwareRows < 1) throw new Error('CMS About editor rendered no software skill rows.');

      const kritaRow = page.locator('#tags_software .skill-editor-row').filter({ hasText: 'Krita' }).first();
      if (await kritaRow.count() !== 1) throw new Error('CMS About editor did not render the stubbed Krita skill.');

      const logo = kritaRow.locator('img').first();
      await logo.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      if (await logo.count() !== 1) throw new Error('CMS About editor did not render a Krita logo preview.');

      const footerNav = page.locator('.nav-item[data-section="footerLoop"]');
      if (await footerNav.count() !== 1) throw new Error('CMS Footer Animation navigation item is missing.');
      await footerNav.click();
      await page.locator('#content #fl_mode').waitFor({ state:'visible', timeout:5000 });
      if (await page.locator('#fl_mode').inputValue() !== 'hero') {
        throw new Error('CMS Footer Animation did not default to Hero settings.');
      }
      const footerMediaTypes = await page.locator('#fl_type option').evaluateAll(options => options.map(option => option.value));
      for (const requiredType of ['image','video','lottie']) {
        if (!footerMediaTypes.includes(requiredType)) {
          throw new Error('CMS Footer Animation is missing its manual '+requiredType+' source type: '+JSON.stringify(footerMediaTypes));
        }
      }
      await page.locator('#fl_mode').selectOption('manual');
      await page.waitForTimeout(50);
      if (!(await page.locator('#fl_manual_panel').isVisible())) {
        throw new Error('CMS Footer Animation manual controls did not appear after switching modes.');
      }
      await page.locator('#fl_mode').selectOption('hero');
      if (!(await page.locator('#fl_manual_panel').isHidden())) {
        throw new Error('CMS Footer Animation manual controls did not hide when returning to Hero mode.');
      }
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
          {
            type: 'image',
            src: 'assets/projects/test/front.svg',
            caption: 'Holographic image fixture',
            orientation: 'square',
            holographic: {
              style: 'iridescent',
              intensity: 0.8,
              texture: 'assets/projects/test/foil.svg',
              back: 'assets/projects/test/back.svg'
            }
          },
          { type: 'lottie', src: 'assets/projects/test/Sample.json', caption: 'Lottie fixture', orientation: 'square' },
          { type: 'model', src: 'assets/projects/test/Female base.obj', caption: '3D fixture', orientation: '' }
        ]
      }, {
        id: 'lottie-thumbnail-fixture',
        title: 'Lottie Thumbnail Fixture',
        subtitle: 'Deferred CMS preview fixture',
        badge: '',
        filters: [],
        description: '',
        thumbnail: { type: 'lottie', src: 'assets/projects/test/Sample.json', focus: '50% 50%', zoom: 1 },
        media: []
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
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: readFileSync(new URL('../assets/projects/test/Sample.json', import.meta.url), 'utf8')
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

      // Keep the real Lottie JSON on a narrowly matched route, while the
      // general raw-content route below continues to stub the project's SVG/OBJ
      // preview assets. Playwright applies the most recently added route first.
      await page.route('**/Sample.json*', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: readFileSync(new URL('../assets/projects/test/Sample.json', import.meta.url), 'utf8')
        });
      });

      await page.route('https://api.github.com/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/repos/Smoke/TestRepo') {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ full_name: 'Smoke/TestRepo', default_branch: 'main' }) });
          return;
        }
        const aboutPath = '/repos/Smoke/TestRepo/contents/data/about.json';
        if (url.pathname === '/repos/Smoke/TestRepo/contents/assets/projects/smoke.jpg' &&
            route.request().method() === 'PUT') {
          cmsSmokeUploadPayload = route.request().postDataJSON();
          cmsSmokeMediaSha = 'smoke-replaced-jpg';
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              content: { sha: cmsSmokeMediaSha },
              commit: { sha: 'smoke-media-upload-commit' }
            })
          });
          return;
        }
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
                { type: 'blob', path: 'assets/projects/smoke.jpg', sha: cmsSmokeMediaSha, size: 12 }
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
