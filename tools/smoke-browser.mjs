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

async function waitForContactViewportAlignment(page, timeoutMs = 5000) {
  try {
    await page.waitForFunction(() => {
      const heading = document.querySelector('#contact-start');
      const group = document.querySelector('#contact-section .contact-grid');
      const nav = document.querySelector('.navbar');
      const scrolling = document.scrollingElement || document.documentElement;
      if (!heading || !group || !nav || !scrolling) return false;

      const headingRect = heading.getBoundingClientRect();
      const groupRect = group.getBoundingClientRect();
      const navbarHeight = nav.getBoundingClientRect().height || 0;
      const viewportHeight = Number(window.innerHeight) || Number(window.visualViewport?.height) || 0;
      const scrollY = Number(window.scrollY) || Number(scrolling.scrollTop) || 0;
      const documentHeight = Math.max(
        Number(document.documentElement?.scrollHeight) || 0,
        Number(document.body?.scrollHeight) || 0
      );
      const maxScrollY = Math.max(0, documentHeight - viewportHeight);
      const usableTop = Math.max(navbarHeight + 24, 24);
      const usableCenter = usableTop + Math.max(1, viewportHeight - usableTop) / 2;
      const groupCenterDocumentY = scrollY + groupRect.top + groupRect.height / 2;
      const desiredScrollY = groupCenterDocumentY - usableCenter;
      const headingSafeScrollY = scrollY + headingRect.top - usableTop;
      const expectedScrollY = Math.max(
        0,
        Math.min(maxScrollY, Math.min(desiredScrollY, headingSafeScrollY))
      );

      // Wait for the browser's smooth-scroll animation to reach its computed
      // destination. A loose positional threshold can pass while the page is
      // still moving and make the immediately following assertion flaky.
      const reachedTarget = Math.abs(scrollY - expectedScrollY) <= 2;
      const headingClear = headingRect.top >= usableTop - 2;
      return reachedTarget && headingClear;
    }, null, { timeout: timeoutMs });
  } catch (error) {
    const snapshot = await page.evaluate(() => {
      const heading = document.querySelector('#contact-start');
      const group = document.querySelector('#contact-section .contact-grid');
      const nav = document.querySelector('.navbar');
      const scrolling = document.scrollingElement || document.documentElement;
      const headingRect = heading?.getBoundingClientRect();
      const groupRect = group?.getBoundingClientRect();
      const navbarHeight = nav?.getBoundingClientRect().height || 0;
      const viewportHeight = Number(window.innerHeight) || Number(window.visualViewport?.height) || 0;
      const scrollY = Number(window.scrollY) || Number(scrolling?.scrollTop) || 0;
      const documentHeight = Math.max(
        Number(document.documentElement?.scrollHeight) || 0,
        Number(document.body?.scrollHeight) || 0
      );
      const maxScrollY = Math.max(0, documentHeight - viewportHeight);
      const usableTop = Math.max(navbarHeight + 24, 24);
      const usableCenter = usableTop + Math.max(1, viewportHeight - usableTop) / 2;
      const groupCenter = groupRect ? groupRect.top + groupRect.height / 2 : null;
      const groupCenterDocumentY = groupRect ? scrollY + groupCenter : null;
      const desiredScrollY = groupCenterDocumentY === null ? null : groupCenterDocumentY - usableCenter;
      const headingSafeScrollY = headingRect ? scrollY + headingRect.top - usableTop : null;
      const expectedScrollY = desiredScrollY === null || headingSafeScrollY === null
        ? null
        : Math.max(0, Math.min(maxScrollY, Math.min(desiredScrollY, headingSafeScrollY)));
      return {
        hash: window.location.hash,
        viewportWidth: Number(window.innerWidth) || 0,
        viewportHeight,
        scrollY,
        maxScrollY,
        expectedScrollY,
        scrollDelta: expectedScrollY === null ? null : Math.abs(scrollY - expectedScrollY),
        headingTop: headingRect?.top ?? null,
        headingClear: headingRect ? headingRect.top >= usableTop - 2 : false,
        groupTop: groupRect?.top ?? null,
        groupHeight: groupRect?.height ?? null,
        centerDelta: groupCenter === null ? null : Math.abs(groupCenter - usableCenter),
        navbarHeight
      };
    });
    throw new Error('Contact viewport did not settle at the computed scroll target: ' +
      JSON.stringify(snapshot) + '; ' + error.message);
  }
}

async function assertLightboxChromeAlignment(page, label, mode) {
  const geometry = await page.evaluate(() => {
    const read = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2
      };
    };
    return {
      viewportWidth: window.innerWidth,
      logo: read('.nav-logo'),
      lastPill: read('.nav-links > li:last-child > a'),
      hamburger: read('.hamburger'),
      close: read('#lightboxClose'),
      previous: read('.lightbox-prev'),
      next: read('.lightbox-next')
    };
  });
  const near = (a, b, tolerance = 1.5) =>
    Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;

  if (!geometry.close || !geometry.previous || !geometry.next || !geometry.logo) {
    throw new Error(label + ' Lightbox/navbar geometry fixture is incomplete: ' + JSON.stringify(geometry));
  }

  if (mode === 'desktop') {
    if (geometry.viewportWidth < 768 || !geometry.lastPill) {
      throw new Error(label + ' desktop alignment ran outside the desktop navigation layout: ' + JSON.stringify(geometry));
    }
    if (
      !near(geometry.close.right, geometry.lastPill.right) ||
      !near(geometry.close.top, geometry.lastPill.top) ||
      !near(geometry.close.height, geometry.lastPill.height) ||
      !near(geometry.close.width, 42) ||
      !near(geometry.close.height, 42) ||
      !near(geometry.next.right, geometry.lastPill.right) ||
      !near(geometry.previous.left, geometry.logo.left) ||
      !near(geometry.previous.width, 42) ||
      !near(geometry.next.width, 42)
    ) {
      throw new Error(label + ' desktop Lightbox controls are not aligned to navbar pill/page edges: ' + JSON.stringify(geometry));
    }
    return;
  }

  if (mode === 'mobile') {
    if (geometry.viewportWidth >= 768 || !geometry.hamburger) {
      throw new Error(label + ' mobile alignment ran outside the hamburger navigation layout: ' + JSON.stringify(geometry));
    }
    if (
      !near(geometry.close.centerX, geometry.hamburger.centerX) ||
      !near(geometry.close.centerY, geometry.hamburger.centerY) ||
      !near(geometry.previous.left, geometry.logo.left) ||
      !near(geometry.next.right, geometry.hamburger.right) ||
      !near(geometry.close.width, 52) ||
      !near(geometry.close.height, 52) ||
      !near(geometry.previous.width, 52) ||
      !near(geometry.next.width, 52) ||
      !near(geometry.previous.height, 52) ||
      !near(geometry.next.height, 52)
    ) {
      throw new Error(label + ' mobile Lightbox controls are not aligned to the hamburger/page edges: ' + JSON.stringify(geometry));
    }
    return;
  }

  throw new Error('Unknown Lightbox alignment mode: ' + mode);
}

async function assertNavigationLabelsCentered(page, label) {
  const states = await page.locator('.nav-links a[href]').evaluateAll(anchors => anchors.map(anchor => {
    const style = getComputedStyle(anchor);
    const pill = anchor.getBoundingClientRect();
    const labelElement = anchor.querySelector('.nav-link-label');
    const labelBox = labelElement?.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(labelElement || anchor);
    const text = range.getBoundingClientRect();
    return {
      label: (anchor.textContent || '').trim(),
      display: style.display,
      alignItems: style.alignItems,
      justifyContent: style.justifyContent,
      textAlign: style.textAlign,
      boxSizing: style.boxSizing,
      labelDisplay: labelElement ? getComputedStyle(labelElement).display : '',
      labelTextBoxTrim: labelElement ? getComputedStyle(labelElement).textBoxTrim : '',
      labelTextBoxEdge: labelElement ? getComputedStyle(labelElement).textBoxEdge : '',
      labelBoxDeltaX: labelBox ? Math.abs((labelBox.left + labelBox.width / 2) - (pill.left + pill.width / 2)) : Infinity,
      labelBoxDeltaY: labelBox ? Math.abs((labelBox.top + labelBox.height / 2) - (pill.top + pill.height / 2)) : Infinity,
      textDeltaX: Math.abs((text.left + text.width / 2) - (pill.left + pill.width / 2)),
      textDeltaY: Math.abs((text.top + text.height / 2) - (pill.top + pill.height / 2))
    };
  }));
  if (states.length !== 3 || states.some(state =>
    state.display !== 'flex' ||
    state.alignItems !== 'center' ||
    state.justifyContent !== 'center' ||
    state.textAlign !== 'center' ||
    state.boxSizing !== 'border-box' ||
    state.labelDisplay !== 'block' ||
    state.labelTextBoxTrim !== 'trim-both' ||
    !state.labelTextBoxEdge.includes('cap') ||
    !state.labelTextBoxEdge.includes('alphabetic') ||
    state.labelBoxDeltaX > 1.5 ||
    state.labelBoxDeltaY > 1.5 ||
    state.textDeltaX > 1.5 ||
    state.textDeltaY > 1.5
  )) {
    throw new Error(label + ' navigation label box or visible text is not centered within its pill: ' + JSON.stringify(states));
  }
}

async function assertHamburgerForeground(page, label, menuState = 'closed') {
  await page.waitForTimeout(40);
  const state = await page.evaluate(() => {
    const logo = document.querySelector('.site-logo');
    const button = document.querySelector('.hamburger');
    const bars = Array.from(button?.querySelectorAll('.hamburger-icon span') || []);
    return {
      menuOpen: document.body.classList.contains('menu-open'),
      logoForeground: logo?.dataset?.logoForeground || '',
      hamburgerForeground: button?.dataset?.foreground || '',
      buttonBackground: button ? getComputedStyle(button).backgroundColor : '',
      buttonBlendMode: button ? getComputedStyle(button).mixBlendMode : '',
      barColors: bars.map(bar => getComputedStyle(bar).backgroundColor),
      barBlendModes: bars.map(bar => getComputedStyle(bar).mixBlendMode)
    };
  });
  const expectedForeground = menuState === 'open' ? 'light' : state.logoForeground;
  const expectedColor = expectedForeground === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
  if (state.menuOpen !== (menuState === 'open') ||
      !['light', 'dark'].includes(state.logoForeground) ||
      state.hamburgerForeground !== expectedForeground ||
      state.buttonBackground !== 'rgba(0, 0, 0, 0)' ||
      state.buttonBlendMode !== 'normal' ||
      state.barColors.length !== 3 ||
      state.barColors.some(color => color !== expectedColor) ||
      state.barBlendModes.some(mode => mode !== 'normal')) {
    throw new Error(label + ' hamburger foreground must match the logo only while closed and remain white on the open black menu: ' + JSON.stringify(state));
  }
}

async function assertNavigationAcrossViewports(page, label) {
  const original = page.viewportSize() || { width: 1280, height: 900 };
  const sizes = [
    { width: 320, height: 740 }, { width: 360, height: 800 },
    { width: 390, height: 844 }, { width: 600, height: 900 },
    { width: 767, height: 900 }, { width: 768, height: 900 },
    { width: 820, height: 1024 }, { width: 1024, height: 768 },
    { width: 1099, height: 900 }, { width: 1100, height: 900 },
    { width: 1280, height: 900 }, { width: 1440, height: 900 },
    { width: 1920, height: 1080 }
  ];
  try {
    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.waitForTimeout(70);
      await assertNavigationLabelsCentered(page, label + ' ' + size.width + 'px');
      await assertHamburgerForeground(page, label + ' ' + size.width + 'px closed menu', 'closed');
    }
  } finally {
    await page.setViewportSize(original);
    await page.waitForTimeout(80);
  }
}

async function assertNoLogoBackingPlate(page, label) {
  const state = await page.evaluate(() => {
    const navLogo = document.querySelector('.nav-logo');
    const transitionLogo = document.querySelector('.page-transition-logo');
    const getPseudo = (element, pseudo) => {
      if (!element) return null;
      const style = getComputedStyle(element, pseudo);
      const alpha = color => {
        const match = String(color || '').match(/rgba?\(([^)]+)\)/i);
        if (!match) return 0;
        const channels = match[1].split(/[\s,\/]+/).filter(Boolean);
        if (channels.length < 3) return 0;
        return channels.length >= 4 ? Number.parseFloat(channels[3]) || 0 : 1;
      };
      return {
        backgroundAlpha: alpha(style.backgroundColor),
        borderWidths: ['Top','Right','Bottom','Left'].map(side => Number.parseFloat(style['border' + side + 'Width']) || 0),
        boxShadow: style.boxShadow,
        backdropFilter: style.backdropFilter || style.webkitBackdropFilter || 'none',
        content: style.content,
        filter: style.filter
      };
    };
    const pseudoStates = [navLogo, transitionLogo].filter(Boolean).flatMap(element =>
      ['::before','::after'].map(pseudo => ({host:element.className || element.id, pseudo, ...getPseudo(element,pseudo)}))
    );
    return {
      navLogoExists: !!navLogo,
      navLogoClasses: navLogo?.className || '',
      pseudoStates,
      footerBrandMarkCount: document.querySelectorAll('footer .nav-logo, footer .site-logo, footer .page-transition-logo').length
    };
  });
  const paintedPseudo = state.pseudoStates.some(pseudo =>
    pseudo.backgroundAlpha > .01 ||
    pseudo.borderWidths.some(width => width > 0) ||
    pseudo.boxShadow !== 'none' ||
    pseudo.backdropFilter !== 'none' ||
    pseudo.filter !== 'none' ||
    (pseudo.content && !['none','normal','""',"''"].includes(pseudo.content) && pseudo.content !== '""')
  );
  if (!state.navLogoExists || paintedPseudo ||
      /logo-contrast-fallback|contact-area-logo/.test(state.navLogoClasses) ||
      state.footerBrandMarkCount !== 0) {
    throw new Error(label + ' logo backing plate detected or duplicate footer brand markup found: ' + JSON.stringify(state));
  }
}

async function assertPublicNavigation(page, { href, label }) {
  const feedbackControlCount = await page.locator('.interaction-feedback-toggle').count();
  if (feedbackControlCount !== 0) {
    throw new Error(label + ' must never render a public interaction-feedback control.');
  }
  const link = page.locator('.nav-links a[href="' + href + '"]').first();
  if (await link.count() !== 1) {
    throw new Error(label + ' direct navigation link is missing: ' + href);
  }

  // Wait for the branded loading gate before inspecting styles or activating
  // the navigation. This avoids racing the transition overlay after reloads.
  const pageTransition = page.locator('#pageTransition').first();
  if (await pageTransition.count() === 1) {
    await page.waitForFunction(() => {
      const transition = document.querySelector('#pageTransition');
      return transition?.dataset.loading === 'ready' &&
        transition.getAttribute('aria-hidden') === 'true';
    }, null, { timeout: 6000 });
  }
  await assertNoLogoBackingPlate(page, label + ' loaded navigation');

  const navContract = await page.evaluate(() => {
    const navbar = document.querySelector('.navbar');
    const logo = document.querySelector('.site-logo');
    const menu = document.querySelector('.nav-links');
    const anchors = Array.from(menu?.querySelectorAll(':scope > li > a') || []);
    const navStyle = navbar ? getComputedStyle(navbar) : null;
    const logoStyle = logo ? getComputedStyle(logo) : null;
    const hamburger = document.querySelector('.hamburger');
    const hamburgerStyle = hamburger ? getComputedStyle(hamburger) : null;
    const hamburgerIconBlendModes = Array.from(hamburger?.querySelectorAll('.hamburger-icon span') || [])
      .map(span => getComputedStyle(span).mixBlendMode);
    const links = anchors.map(anchor => {
      const style = getComputedStyle(anchor);
      const pill = anchor.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(anchor);
      const text = range.getBoundingClientRect();
      return {
        label: (anchor.textContent || '').trim().replace(/\s+/g, ' ').toUpperCase(),
        active: anchor.classList.contains('active-link'),
        background: style.backgroundColor,
        color: style.color,
        display: style.display,
        alignItems: style.alignItems,
        justifyContent: style.justifyContent,
        textAlign: style.textAlign,
        boxSizing: style.boxSizing,
        centerDeltaX: Math.abs((text.left + text.width / 2) - (pill.left + pill.width / 2)),
        centerDeltaY: Math.abs((text.top + text.height / 2) - (pill.top + pill.height / 2)),
        radius: style.borderRadius,
        borderWidth: style.borderWidth,
        href: anchor.getAttribute('href') || ''
      };
    });
    return {
      navbar: {
        exists: !!navbar,
        background: navStyle?.backgroundColor || '',
        backgroundImage: navStyle?.backgroundImage || '',
        backdropFilter: navStyle?.backdropFilter || '',
        borderBottomWidth: navStyle?.borderBottomWidth || ''
      },
      logoBlendMode: logoStyle?.mixBlendMode || '',
      logoForeground: logo?.dataset?.logoForeground || '',
      logoFilter: logoStyle?.filter || '',
      hamburgerBlendMode: hamburgerStyle?.mixBlendMode || '',
      hamburgerBackground: hamburgerStyle?.backgroundColor || '',
      hamburgerBackdropFilter: hamburgerStyle?.backdropFilter || '',
      hamburgerWidth: hamburgerStyle?.width || '',
      hamburgerHeight: hamburgerStyle?.height || '',
      hamburgerIconBlendModes,
      hamburgerForeground: hamburger?.dataset?.foreground || '',
      hamburgerIconColors: Array.from(hamburger?.querySelectorAll('.hamburger-icon span') || [])
        .map(span => getComputedStyle(span).backgroundColor),
      labels: links.map(link => link.label),
      links,
      dropdownCount: menu?.querySelectorAll('.nav-dropdown-menu, .nav-item-dropdown, .nav-dropdown-toggle').length || 0,
      mobileMenuOpen: Boolean(menu?.classList.contains('active') && menu?.classList.contains('is-open')),
      mobileMenuBackground: menu ? getComputedStyle(menu).backgroundColor : '',
      viewportWidth: window.innerWidth
    };
  });
  await assertNavigationLabelsCentered(page, label + ' default navigation state');
  await assertHamburgerForeground(page, label + ' default hamburger state', navContract.mobileMenuOpen ? 'open' : 'closed');
  if (label === 'Desktop Works') {
    await assertNavigationAcrossViewports(page, label + ' responsive geometry');
  }

  const contrastRatio = (foreground, background) => {
    const luminance = color => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const a = luminance(foreground);
    const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const expectedLabels = ['DESIGNS', 'ABOUT ME', 'CONTACTS'];
  const correctPillStates = navContract.links.length === 3 &&
    navContract.links.filter(link => link.active).length === 1 &&
    navContract.links.every(link => {
      const foreground = link.active ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
      const background = link.active ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)';
      return contrastRatio(foreground, background) >= 3;
    }) &&
    navContract.links.every(link =>
      link.radius === '999px' &&
      link.borderWidth === '0px' &&
      (link.active
        ? link.background === 'rgb(255, 255, 255)' && link.color === 'rgb(0, 0, 0)'
        : link.background === 'rgb(0, 0, 0)' && link.color === 'rgb(255, 255, 255)')
    );
  if (
    !navContract.navbar.exists ||
    navContract.navbar.background !== 'rgba(0, 0, 0, 0)' ||
    navContract.navbar.backgroundImage !== 'none' ||
    navContract.navbar.backdropFilter !== 'none' ||
    parseFloat(navContract.navbar.borderBottomWidth) !== 0 ||
    navContract.logoBlendMode !== 'normal' ||
    !['light', 'dark'].includes(navContract.logoForeground) ||
    (navContract.logoForeground === 'dark' && navContract.logoFilter.includes('invert')) ||
    (navContract.logoForeground === 'light' && !navContract.logoFilter.includes('invert')) ||
    navContract.hamburgerBlendMode !== 'normal' ||
    navContract.hamburgerBackground !== 'rgba(0, 0, 0, 0)' ||
    navContract.hamburgerBackdropFilter !== 'none' ||
    navContract.hamburgerWidth !== '38px' ||
    navContract.hamburgerHeight !== '38px' ||
    navContract.hamburgerForeground !== (navContract.mobileMenuOpen ? 'light' : navContract.logoForeground) ||
    navContract.hamburgerIconColors.some(color =>
      color !== ((navContract.mobileMenuOpen ? 'light' : navContract.logoForeground) === 'dark'
        ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)')) ||
    JSON.stringify(navContract.hamburgerIconBlendModes) !== JSON.stringify(['normal', 'normal', 'normal']) ||
    JSON.stringify(navContract.labels) !== JSON.stringify(expectedLabels) ||
    !correctPillStates ||
    navContract.links.some(link =>
      link.display !== 'flex' ||
      link.alignItems !== 'center' ||
      link.justifyContent !== 'center' ||
      link.textAlign !== 'center' ||
      link.boxSizing !== 'border-box' ||
      ((navContract.viewportWidth >= 768 || navContract.mobileMenuOpen) &&
        (link.centerDeltaX > 1.5 || link.centerDeltaY > 1.5))
    ) ||
    navContract.dropdownCount !== 0 ||
    (navContract.viewportWidth >= 768 && navContract.mobileMenuBackground !== 'rgba(0, 0, 0, 0)')
  ) {
    throw new Error(label + ' navigation visual/markup and adaptive logo state contract failed: ' + JSON.stringify(navContract));
  }

  const expectedDestination = await link.evaluate(element => {
    const url = new URL(element.getAttribute('href') || '', window.location.href);
    return { pathname: url.pathname, search: url.search };
  });

  const viewport = page.viewportSize();
  const supportsHover = await page.evaluate(() => window.matchMedia('(hover: hover)').matches);
  if ((viewport?.width || 0) >= 768 && supportsHover) {
    const hoverTarget = page.locator('.nav-links a:not(.active-link)').first();
    await hoverTarget.hover();
    await assertNavigationLabelsCentered(page, label + ' hover state');
    await page.waitForFunction(() => {
      const hovered = document.querySelector('.nav-links a:not(.active-link):hover');
      if (!hovered) return false;
      const style = getComputedStyle(hovered);
      return style.backgroundColor === 'rgb(255, 255, 255)' &&
        style.color === 'rgb(0, 0, 0)' && style.borderWidth === '0px';
    }, null, { timeout: 1500 });
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => {
      const link = document.querySelector('.nav-links a:not(.active-link)');
      if (!link) return false;
      const style = getComputedStyle(link);
      return style.backgroundColor === 'rgb(0, 0, 0)' &&
        style.color === 'rgb(255, 255, 255)';
    }, null, { timeout: 1500 });

    const activeHoverTarget = page.locator('.nav-links a.active-link').first();
    await activeHoverTarget.hover();
    await assertNavigationLabelsCentered(page, label + ' active-hover state');
    await page.waitForFunction(() => {
      const hovered = document.querySelector('.nav-links a.active-link:hover');
      if (!hovered) return false;
      const style = getComputedStyle(hovered);
      return style.backgroundColor === 'rgb(0, 0, 0)' &&
        style.color === 'rgb(255, 255, 255)' && style.borderWidth === '0px';
    }, null, { timeout: 1500 });
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => {
      const active = document.querySelector('.nav-links a.active-link');
      if (!active) return false;
      const style = getComputedStyle(active);
      return style.backgroundColor === 'rgb(255, 255, 255)' &&
        style.color === 'rgb(0, 0, 0)';
    }, null, { timeout: 1500 });
  }

  if ((viewport?.width || 0) >= 768) {
    const focusTarget = page.locator('.nav-links a[href]').nth(1);
    await focusTarget.focus();
    await assertNavigationLabelsCentered(page, label + ' focus state');
    await focusTarget.evaluate(element => element.blur());
  }

  if ((viewport?.width || 0) < 768) {
    const hamburger = page.locator('.hamburger').first();
    const mobileMenu = page.locator('.nav-links').first();
    if (supportsHover) {
      await hamburger.hover();
      await page.waitForFunction(() => {
        const button = document.querySelector('.hamburger');
        const logo = document.querySelector('.site-logo');
        const style = button ? getComputedStyle(button) : null;
        const foreground = logo?.dataset?.logoForeground === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
        const strokes = Array.from(button?.querySelectorAll('.hamburger-icon span') || []);
        return style?.backgroundColor === 'rgba(0, 0, 0, 0)' &&
          style?.mixBlendMode === 'normal' &&
          strokes.length === 3 &&
          strokes.every(stroke => getComputedStyle(stroke).backgroundColor === foreground &&
            getComputedStyle(stroke).mixBlendMode === 'normal');
      }, null, { timeout: 1500 });
      await page.mouse.move(0, 0);
      await page.waitForFunction(() => {
        const button = document.querySelector('.hamburger');
        return getComputedStyle(button).backgroundColor === 'rgba(0, 0, 0, 0)';
      }, null, { timeout: 1500 });
    }
    if (await hamburger.count() !== 1 || await mobileMenu.count() !== 1) {
      throw new Error(label + ' mobile navigation controls are missing.');
    }
    if (!(await mobileMenu.evaluate(el => el.classList.contains('active') && el.classList.contains('is-open')))) {
      await hamburger.click();
    }
    await page.waitForFunction(() => {
      const menu = document.querySelector('.nav-links');
      return menu?.classList.contains('active') && menu.classList.contains('is-open') &&
        document.body.classList.contains('menu-open');
    }, null, { timeout: 2000 });
    await assertNavigationLabelsCentered(page, label + ' mobile open-menu state');
    await assertHamburgerForeground(page, label + ' mobile open-menu state', 'open');
    await assertNoLogoBackingPlate(page, label + ' mobile open-menu state');
    if (supportsHover) await page.mouse.move(0, 0);
    const reducedMotionPreference = await page.evaluate(() =>
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
    if (!reducedMotionPreference) {
      await page.waitForTimeout(280);
    }

    const openMenuContract = await page.evaluate(() => {
      const menu = document.querySelector('.nav-links');
      const style = menu ? getComputedStyle(menu) : null;
      const rect = menu?.getBoundingClientRect();
      const active = menu?.querySelector('a.active-link');
      const inactive = menu?.querySelector('a:not(.active-link)');
      const activeStyle = active ? getComputedStyle(active) : null;
      const inactiveStyle = inactive ? getComputedStyle(inactive) : null;
      const hamburger = document.querySelector('.hamburger');
      const hamburgerStyle = getComputedStyle(hamburger);
      const hamburgerIconElements = Array.from(hamburger?.querySelectorAll('.hamburger-icon span') || []);
      const hamburgerIconBlendModes = hamburgerIconElements.map(span => getComputedStyle(span).mixBlendMode);
      const hamburgerIconBars = hamburgerIconElements.length;
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const backdropStyle = getComputedStyle(document.querySelector('.nav-menu-backdrop'));
      const bodyStyle = getComputedStyle(document.body);
      return {
        position: style?.position || '',
        background: style?.backgroundColor || '',
        pointerEvents: style?.pointerEvents || '',
        rect: rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null,
        viewport: { width: innerWidth, height: innerHeight },
        active: activeStyle ? { background: activeStyle.backgroundColor, color: activeStyle.color, borderWidth: activeStyle.borderWidth, pointerEvents: activeStyle.pointerEvents } : null,
        inactive: inactiveStyle ? { background: inactiveStyle.backgroundColor, color: inactiveStyle.color, borderWidth: inactiveStyle.borderWidth, pointerEvents: inactiveStyle.pointerEvents } : null,
        hamburgerBlendMode: hamburgerStyle.mixBlendMode,
        hamburgerBackground: hamburgerStyle.backgroundColor,
        hamburgerForeground: hamburger?.dataset?.foreground || '',
        hamburgerIconColors: hamburgerIconElements.map(span => getComputedStyle(span).backgroundColor),
        hamburgerBackdropFilter: hamburgerStyle.backdropFilter,
        hamburgerWidth: hamburgerStyle.width,
        hamburgerHeight: hamburgerStyle.height,
        hamburgerIconBlendModes,
        hamburgerIsOpen: hamburger?.classList.contains('is-open') || false,
        hamburgerIconBars,
        menuAnimationName: style?.animationName || '',
        reducedMotion,
        backdropBackground: backdropStyle.backgroundColor,
        bodyBackground: bodyStyle.backgroundColor,
        bodyOverflow: bodyStyle.overflow
      };
    });
    if (
      openMenuContract.position !== 'fixed' ||
      openMenuContract.background !== 'rgb(0, 0, 0)' ||
      openMenuContract.pointerEvents !== 'none' ||
      !openMenuContract.rect ||
      Math.abs(openMenuContract.rect.top) > 1 ||
      Math.abs(openMenuContract.rect.left) > 1 ||
      Math.abs(openMenuContract.rect.width - openMenuContract.viewport.width) > 1 ||
      Math.abs(openMenuContract.rect.height - openMenuContract.viewport.height) > 1 ||
      openMenuContract.active?.background !== 'rgb(255, 255, 255)' ||
      openMenuContract.active?.color !== 'rgb(0, 0, 0)' ||
      openMenuContract.active?.borderWidth !== '0px' ||
      openMenuContract.active?.pointerEvents !== 'auto' ||
      openMenuContract.inactive?.background !== 'rgb(0, 0, 0)' ||
      openMenuContract.inactive?.color !== 'rgb(255, 255, 255)' ||
      openMenuContract.inactive?.borderWidth !== '0px' ||
      openMenuContract.inactive?.pointerEvents !== 'auto' ||
      openMenuContract.hamburgerBlendMode !== 'normal' ||
      openMenuContract.hamburgerBackground !== 'rgba(0, 0, 0, 0)' ||
      openMenuContract.hamburgerForeground !== 'light' ||
      JSON.stringify(openMenuContract.hamburgerIconColors) !== JSON.stringify(['rgb(255, 255, 255)', 'rgb(255, 255, 255)', 'rgb(255, 255, 255)']) ||
      openMenuContract.hamburgerBackdropFilter !== 'none' ||
      openMenuContract.hamburgerWidth !== '38px' ||
      openMenuContract.hamburgerHeight !== '38px' ||
      JSON.stringify(openMenuContract.hamburgerIconBlendModes) !== JSON.stringify(['normal', 'normal', 'normal']) ||
      contrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)') < 3 ||
      !openMenuContract.hamburgerIsOpen ||
      openMenuContract.hamburgerIconBars !== 3 ||
      (!openMenuContract.reducedMotion && !openMenuContract.menuAnimationName.includes('nav-menu-enter')) ||
      openMenuContract.backdropBackground !== 'rgb(0, 0, 0)' ||
      openMenuContract.bodyBackground !== 'rgb(0, 0, 0)' ||
      openMenuContract.bodyOverflow !== 'hidden'
    ) {
      throw new Error(label + ' full-screen mobile navigation visual contract failed: ' + JSON.stringify(openMenuContract));
    }

    // Blank-canvas taps pass through to the backdrop, preserving outside-tap dismissal.
    await page.locator('.nav-menu-backdrop').click({ position: { x: 4, y: Math.max(1, (viewport?.height || 844) - 8) } });
    await page.waitForFunction(() => {
      const menu = document.querySelector('.nav-links');
      return !menu?.classList.contains('active') && !menu?.classList.contains('is-open') &&
        !document.body.classList.contains('menu-open');
    }, null, { timeout: 2000 });
    await assertNavigationLabelsCentered(page, label + ' mobile closed-menu state');
    await assertHamburgerForeground(page, label + ' mobile closed-menu state', 'closed');
    await assertNoLogoBackingPlate(page, label + ' mobile closed-menu state');
    await hamburger.click();
    await page.waitForFunction(() => {
      const menu = document.querySelector('.nav-links');
      return menu?.classList.contains('active') && menu.classList.contains('is-open');
    }, null, { timeout: 2000 });
    await link.waitFor({ state: 'visible', timeout: 2000 });
  }

  const reducedMotionBeforeSelection = await page.evaluate(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  await link.click();
  if ((viewport?.width || 0) < 768 && !reducedMotionBeforeSelection) {
    // The selected-pill phase must finish while the menu is still open. Only
    // after it settles should the parent menu begin its upward exit.
    await page.waitForFunction(() => {
      const menu = document.querySelector('.nav-links');
      const selected = menu?.querySelector('a.is-selected');
      if (!menu?.classList.contains('active') ||
          !menu.classList.contains('is-open') ||
          menu.classList.contains('is-closing') ||
          !selected ||
          !getComputedStyle(selected).animationName.includes('nav-link-select')) return false;
      const style = getComputedStyle(selected);
      return style.backgroundColor === 'rgb(255, 255, 255)' &&
        style.color === 'rgb(0, 0, 0)';
    }, null, { timeout: 1500 });
    await assertNavigationLabelsCentered(page, label + ' mobile selected-link state');

    await page.waitForFunction(() => {
      const menu = document.querySelector('.nav-links');
      const selected = menu?.querySelector('a.is-selected');
      return menu?.classList.contains('is-closing') && selected &&
        getComputedStyle(menu).animationName.includes('nav-menu-exit') &&
        getComputedStyle(selected).animationName.includes('nav-link-select');
    }, null, { timeout: 1500 });
  }
  await page.waitForFunction(destination => {
    return window.location.pathname === destination.pathname &&
      window.location.search === destination.search &&
      window.location.hash === '';
  }, expectedDestination, { timeout: 6000 });

  // A direct Designs link returns to the Works root, rather than choosing a
  // gallery filter. The destination should therefore clear the prior hash and
  // restore the gallery's ALL state, with the mobile menu fully dismissed.
  await page.waitForFunction(() => {
    const transition = document.querySelector('#pageTransition');
    return !transition ||
      (transition.dataset.loading === 'ready' && transition.getAttribute('aria-hidden') === 'true');
  }, null, { timeout: 6000 });
  await page.waitForFunction(() => {
    const all = document.querySelector('.filter-tabs [data-filter="all"]');
    return all?.classList.contains('active') && all.getAttribute('aria-pressed') === 'true';
  }, null, { timeout: 5000 });
  await page.waitForFunction(() =>
    !document.body.classList.contains('menu-open') &&
    !document.querySelector('.nav-links')?.classList.contains('active'), null, { timeout: 3000 });
  await page.waitForFunction(() => Math.abs(window.scrollY) <= 8, null, { timeout: 5000 });
}

async function logRuntimeProfile(page, label, requestedUrls = []) {
  const profile = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource');
    const sameOrigin = entries.filter(entry => {
      try { return new URL(entry.name, location.href).origin === location.origin; }
      catch (_) { return false; }
    });
    const pathnameOf = entry => {
      try { return new URL(entry.name, location.href).pathname.toLowerCase(); }
      catch (_) { return ''; }
    };
    const scripts = sameOrigin.filter(entry => /\.m?js$/.test(pathnameOf(entry)));
    const stylesheets = sameOrigin.filter(entry => /\.css$/.test(pathnameOf(entry)));
    const sum = (items, field) => items.reduce((total, item) => total + (Number(item[field]) || 0), 0);
    const navigation = performance.getEntriesByType('navigation')[0] || null;
    const markTime = name => {
      const mark = performance.getEntriesByName(name, 'mark')[0];
      return mark && Number.isFinite(mark.startTime) ? mark.startTime : null;
    };
    const domContentLoadedMs = navigation && navigation.domContentLoadedEventEnd > 0
      ? Math.round(navigation.domContentLoadedEventEnd)
      : null;
    const loadingActiveMs = markTime('lm-page-loading-active');
    const pageReadyMs = markTime('lm-page-ready');
    return {
      route: location.pathname + location.search + location.hash,
      domContentLoadedMs,
      loadingActiveMs: loadingActiveMs == null ? null : Math.round(loadingActiveMs),
      pageReadyMs: pageReadyMs == null ? null : Math.round(pageReadyMs),
      startupAfterDclMs: pageReadyMs != null && domContentLoadedMs != null
        ? Math.round(pageReadyMs - domContentLoadedMs)
        : null,
      loadingGateMs: pageReadyMs != null && loadingActiveMs != null
        ? Math.round(pageReadyMs - loadingActiveMs)
        : null,
      sameOriginResourceRequests: sameOrigin.length,
      sameOriginTransferBytes: sum(sameOrigin, 'transferSize'),
      sameOriginEncodedBodyBytes: sum(sameOrigin, 'encodedBodySize'),
      sameOriginDecodedBodyBytes: sum(sameOrigin, 'decodedBodySize'),
      javascriptRequests: scripts.length,
      javascriptTransferBytes: sum(scripts, 'transferSize'),
      javascriptEncodedBodyBytes: sum(scripts, 'encodedBodySize'),
      javascriptDecodedBodyBytes: sum(scripts, 'decodedBodySize'),
      javascriptPaths: [...new Set(scripts.map(pathnameOf))].sort(),
      stylesheetRequests: stylesheets.length,
      stylesheetTransferBytes: sum(stylesheets, 'transferSize'),
      documentTransferBytes: navigation ? Number(navigation.transferSize) || 0 : 0
    };
  });

  const sameOrigin = new Set();
  const requestedScripts = new Set();
  const requestedStylesheets = new Set();
  for (const value of requestedUrls) {
    try {
      const url = new URL(value);
      if (url.origin !== new URL(BASE_URL).origin) continue;
      sameOrigin.add(url.pathname);
      if (/\.m?js$/i.test(url.pathname)) requestedScripts.add(url.pathname);
      if (/\.css$/i.test(url.pathname)) requestedStylesheets.add(url.pathname);
    } catch (_) {}
  }

  console.log('[profile] ' + label + ' — local Chromium smoke metrics (not a production/CDN benchmark): ' +
    JSON.stringify({
      ...profile,
      requestedSameOriginPaths: sameOrigin.size,
      requestedJavascriptPaths: requestedScripts.size,
      requestedJavascriptFiles: [...requestedScripts].sort(),
      requestedStylesheetPaths: requestedStylesheets.size
    }));
}

async function assertWorksHeroGalleryResponsive(page, expectedMessage, label) {
  const originalViewport = page.viewportSize() || { width: 1280, height: 900 };
  const viewports = [
    { width: 1440, height: 900, name: 'desktop' },
    { width: 820, height: 1024, name: 'tablet' },
    { width: 390, height: 844, name: 'mobile' }
  ];

  try {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      // Gallery remeasures edge cushions on its 120ms resize debounce; inspect the settled rail.
      await page.waitForTimeout(180);
      const layout = await page.evaluate(() => {
        const hero = document.querySelector('.hero-section:not(.about-hero)');
        const banner = hero?.querySelector('.hero-banner');
        const quote = hero?.querySelector('.hero-quote');
        const main = document.querySelector('main.works-main');
        const grid = document.querySelector('#portfolioGrid');
        const portfolioWrapper = document.querySelector('.portfolio-wrapper');
        const logo = document.querySelector('.site-logo');
        const navLogo = document.querySelector('.nav-logo');
        const navbar = document.querySelector('.navbar');
        const heroRect = hero?.getBoundingClientRect();
        const bannerRect = banner?.getBoundingClientRect();
        const mainStyle = main ? getComputedStyle(main) : null;
        const fadeStyle = banner ? getComputedStyle(banner, '::before') : null;
        const filterRail = document.querySelector('.filter-tabs');
        const filterStyle = filterRail ? getComputedStyle(filterRail) : null;
        const activeFilter = filterRail?.querySelector('.filter-btn.active, .tab-btn.active');
        const activeFilterRect = activeFilter?.getBoundingClientRect();
        const activeFilterRange = document.createRange();
        if (activeFilter) activeFilterRange.selectNodeContents(activeFilter);
        const activeFilterTextRect = activeFilter ? activeFilterRange.getBoundingClientRect() : null;
        const logoStyle = logo ? getComputedStyle(logo) : null;
        const navLogoStyle = navLogo ? getComputedStyle(navLogo) : null;
        const navbarStyle = navbar ? getComputedStyle(navbar) : null;
        return {
          hasHero: !!hero,
          heroHeight: heroRect?.height || 0,
          heroMinHeight: hero ? parseFloat(getComputedStyle(hero).minHeight) || 0 : 0,
          bannerHeight: bannerRect?.height || 0,
          hasMessage: !!quote && !quote.hidden,
          messageSizing: !!hero?.classList.contains('hero-section--message'),
          fadeHeight: fadeStyle ? parseFloat(fadeStyle.height) || 0 : 0,
          fadeImage: fadeStyle?.backgroundImage || 'none',
          fadePointerEvents: fadeStyle?.pointerEvents || '',
          filterLeftInset: (() => { const r = filterRail?.getBoundingClientRect(); const m = main?.getBoundingClientRect(); return r && m ? r.left - m.left : -1; })(),
          filterRightInset: (() => { const r = filterRail?.getBoundingClientRect(); const m = main?.getBoundingClientRect(); return r && m ? m.right - r.right : -1; })(),
          filterCenterDelta: (() => { const r = filterRail?.getBoundingClientRect(); const m = main?.getBoundingClientRect(); return r && m ? Math.abs((r.left + r.width / 2) - (m.left + m.width / 2)) : 9999; })(),
          filterHeroGap: (() => { const r = filterRail?.getBoundingClientRect(); return r && heroRect ? r.top - heroRect.bottom : 9999; })(),
          filterGalleryGap: (() => { const r = filterRail?.getBoundingClientRect(); const g = portfolioWrapper?.getBoundingClientRect(); return r && g ? g.top - r.bottom : 9999; })(),
          filterStripHeight: filterRail?.getBoundingClientRect().height || 0,
          filterTabHeight: activeFilterRect?.height || 0,
          filterTabCenterDeltaX: activeFilterRect && activeFilterTextRect ? Math.abs((activeFilterRect.left + activeFilterRect.width/2)-(activeFilterTextRect.left+activeFilterTextRect.width/2)) : 9999,
          filterTabCenterDeltaY: activeFilterRect && activeFilterTextRect ? Math.abs((activeFilterRect.top + activeFilterRect.height/2)-(activeFilterTextRect.top+activeFilterTextRect.height/2)) : 9999,
          filterHasOverflow: filterRail ? filterRail.scrollWidth > filterRail.clientWidth + 1 : false,
          filterMaskImage: filterStyle?.maskImage || 'none',
          filterWebkitMaskImage: filterStyle?.webkitMaskImage || 'none',
          filterOverflowX: filterStyle?.overflowX || '',
          filterTouchAction: filterStyle?.touchAction || '',
          mainPaddingLeft: parseFloat(mainStyle?.paddingLeft || '0') || 0,
          mainPaddingRight: parseFloat(mainStyle?.paddingRight || '0') || 0,
          gridWidth: grid?.getBoundingClientRect().width || 0,
          mainWidth: main?.getBoundingClientRect().width || 0,
          logoBlendMode: logoStyle?.mixBlendMode || '',
          logoForeground: logo?.dataset?.logoForeground || '',
          logoFilter: logoStyle?.filter || '',
          logoTransitionProperties: (logoStyle?.transitionProperty || '').split(',').map(x => x.trim()),
          logoTransitionDurations: (logoStyle?.transitionDuration || '').split(',').map(x => x.trim()),
          navLogoZ: Number.parseInt(navLogoStyle?.zIndex || '0', 10) || 0,
          navbarZ: Number.parseInt(navbarStyle?.zIndex || '0', 10) || 0,
        };
      });

      if (!layout.hasHero || layout.heroHeight <= 0 ||
          Math.abs(layout.heroHeight - layout.bannerHeight) > 1) {
        throw new Error(label + ' ' + viewport.name + ': hero banner must fill the complete hero surface: ' + JSON.stringify(layout));
      }
      if (layout.hasMessage !== expectedMessage || layout.messageSizing !== expectedMessage) {
        throw new Error(label + ' ' + viewport.name + ': the hero message visibility and sizing state diverged: ' + JSON.stringify(layout));
      }
      if (layout.fadeImage !== 'none') {
        throw new Error(label + ' ' + viewport.name + ': Works hero must render without a bottom-edge gradient fade: ' + JSON.stringify(layout));
      }
      if (layout.mainPaddingLeft !== 0 || layout.mainPaddingRight !== 0 ||
          layout.gridWidth <= 0 || layout.gridWidth > layout.mainWidth + 1) {
        throw new Error(label + ' ' + viewport.name + ': Works gallery is still inset by the generic container gutter: ' + JSON.stringify(layout));
      }
      if (layout.filterLeftInset < 20 || layout.filterRightInset < 20 ||
          Math.abs(layout.filterLeftInset - layout.filterRightInset) > 1.5 ||
          layout.filterCenterDelta > 1.5) {
        throw new Error(label + ' ' + viewport.name + ': filter tabs are not centered within balanced page gutters: ' + JSON.stringify(layout));
      }
      if (layout.filterHeroGap < 14 || layout.filterGalleryGap < 14 ||
          layout.filterStripHeight < 44 || layout.filterStripHeight > 56 || layout.filterTabHeight < 44 ||
          layout.filterTabCenterDeltaX > 1.5 || layout.filterTabCenterDeltaY > 1.5) {
        throw new Error(label + ' ' + viewport.name + ': filters must preserve hero/gallery breathing room and centered 44–48px targets: ' + JSON.stringify(layout));
      }
      const hasFilterEdgeFade = String(layout.filterMaskImage).includes('linear-gradient') ||
        String(layout.filterWebkitMaskImage).includes('linear-gradient');
      if (viewport.name === 'mobile' &&
          ((layout.filterHasOverflow && !hasFilterEdgeFade) ||
           layout.filterOverflowX !== 'auto' || layout.filterTouchAction !== 'pan-y')) {
        throw new Error(label + ' mobile: overflowing filters must preserve the edge fade, horizontal scrolling, and natural vertical gestures: ' + JSON.stringify(layout));
      }
      if (viewport.name === 'mobile' && layout.filterHasOverflow) {
        const preview = await page.evaluate(async () => {
          const rail = document.querySelector('.filter-tabs');
          const indicator = document.querySelector('.filter-active-indicator');
          const content = rail?.querySelector('.filter-nav-content');
          const buttons = Array.from(rail?.querySelectorAll('.tab-btn') || []).filter(button => !button.disabled);
          const active = buttons.find(button => button.classList.contains('active'));
          if (!rail || !indicator || !content || !active || buttons.length < 2) return { available: false };
          const activeId = active.dataset.filter || 'all';
          const centerX = element => {
            const rect = element.getBoundingClientRect();
            return rect.left + rect.width / 2;
          };
          const centerY = element => {
            const rect = element.getBoundingClientRect();
            return rect.top + rect.height / 2;
          };
          const startX = centerX(rail);
          const startY = centerY(rail);
          const pointer = (type, x, y) => new PointerEvent(type, {
            pointerId: 47, pointerType: 'touch', isPrimary: true, button: 0,
            clientX: x, clientY: y, bubbles: true, cancelable: true
          });
          // Use the actual rail pointer contract so category settlement is
          // intentionally suspended while a horizontal swipe is in progress.
          rail.dispatchEvent(pointer('pointerdown', startX, startY));
          rail.dispatchEvent(pointer('pointermove', startX - Math.min(150, rail.clientWidth * 0.44), startY));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const railCenter = centerX(rail);
          const nearest = buttons.reduce((best, item) =>
            Math.abs(centerX(item) - railCenter) < Math.abs(centerX(best) - railCenter) ? item : best
          );
          const indicatorRect = indicator.getBoundingClientRect();
          const nearestRect = nearest.getBoundingClientRect();
          const state = {
            available: true,
            activeId,
            previewId: nearest.dataset.filter || 'all',
            isPreview: nearest.classList.contains('is-centered-preview'),
            indicatorCenterDelta: Math.abs(centerX(indicator) - railCenter),
            indicatorWidthDelta: Math.abs(indicatorRect.width - nearestRect.width),
            previewColor: getComputedStyle(nearest).color,
            previewTransition: getComputedStyle(nearest).transitionProperty,
            snapType: getComputedStyle(rail).scrollSnapType,
            hasForcedWidths: buttons.some(button => Boolean(button.style.width))
          };
          // Reverse the gesture before pointer-up; this preserves the original
          // active category while still testing the pill during a real drag phase.
          rail.dispatchEvent(pointer('pointermove', startX, startY));
          rail.dispatchEvent(pointer('pointerup', startX, startY));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return state;
        });
        if (preview.available &&
            (preview.indicatorCenterDelta > 2 || preview.indicatorWidthDelta > 2 ||
             !preview.isPreview || preview.previewColor !== 'rgb(17, 17, 17)' ||
             preview.previewTransition !== 'none' || preview.snapType !== 'none' ||
             preview.hasForcedWidths)) {
          throw new Error(label + ' mobile: active filter pill must remain centered and follow the natural width of the label passing underneath: ' + JSON.stringify(preview));
        }
      }
      if (layout.logoBlendMode !== 'normal' ||
          !['light', 'dark'].includes(layout.logoForeground) ||
          !layout.logoTransitionProperties.includes('transform') ||
          !layout.logoTransitionProperties.includes('filter') ||
          (layout.logoForeground === 'dark' && layout.logoFilter.includes('invert')) ||
          (layout.logoForeground === 'light' && !layout.logoFilter.includes('invert')) ||
          layout.navLogoZ <= layout.navbarZ) {
        throw new Error(label + ' ' + viewport.name + ': backdrop-driven logo foreground, transitions, or stacking regressed: ' + JSON.stringify(layout));
      }

      // Give the same fixed logo deterministic light and dark backdrops. This
      // verifies the runtime contrast controller, not only its CSS declaration.
      await page.evaluate(() => {
        const logo = document.querySelector('.site-logo');
        const rect = logo?.getBoundingClientRect();
        if (!logo || !rect) return;
        document.getElementById('__smoke-logo-backdrop')?.remove();
        const backdrop = document.createElement('div');
        backdrop.id = '__smoke-logo-backdrop';
        Object.assign(backdrop.style, {
          position: 'fixed',
          left: (rect.left - 3) + 'px',
          top: (rect.top - 3) + 'px',
          width: (rect.width + 6) + 'px',
          height: (rect.height + 6) + 'px',
          zIndex: '999',
          pointerEvents: 'auto',
          background: '#fff'
        });
        document.body.appendChild(backdrop);
        window.dispatchEvent(new Event('resize'));
      });
      await page.waitForFunction(
        () => document.querySelector('.site-logo')?.dataset?.logoForeground === 'dark',
        null,
        { timeout: 2500 }
      );
      await page.evaluate(() => {
        const backdrop = document.getElementById('__smoke-logo-backdrop');
        if (backdrop) backdrop.style.background = '#000';
        window.dispatchEvent(new Event('scroll'));
      });
      await page.waitForFunction(
        () => document.querySelector('.site-logo')?.dataset?.logoForeground === 'light',
        null,
        { timeout: 2500 }
      );
      await page.evaluate(() => {
        document.getElementById('__smoke-logo-backdrop')?.remove();
        window.dispatchEvent(new Event('scroll'));
      });

      if (!expectedMessage) {
        await page.evaluate(async () => {
          const hero = document.querySelector('.hero-section:not(.about-hero):not(.hero-section--message)');
          const banner = hero?.querySelector('.hero-banner');
          const logo = document.querySelector('.site-logo');
          if (!banner || !logo) throw new Error('Full-color Works contrast fixture could not locate the Works media surface.');
          const originals = Array.from(banner.querySelectorAll('.slide'));
          window.__lmSmokeHeroSlideSnapshot = originals.map(element => ({
            element,
            active: element.classList.contains('active')
          }));
          originals.forEach(element => element.classList.remove('active'));

          const slide = document.createElement('div');
          slide.id = '__smoke-hero-logo-contrast-slide';
          slide.className = 'slide active';
          Object.assign(slide.style, {
            position: 'absolute', inset: '0', zIndex: '999',
            opacity: '1', pointerEvents: 'none'
          });
          const image = document.createElement('img');
          image.id = '__smoke-hero-logo-contrast-image';
          image.alt = '';
          Object.assign(image.style, {
            display: 'block', width: '100%', height: '100%',
            objectFit: 'cover', pointerEvents: 'none'
          });
          const svg = color => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="' + color + '"/></svg>'
          );
          image.src = svg('#ffffff');
          slide.appendChild(image);
          banner.appendChild(slide);
          try { await image.decode(); } catch (_) {}
          logo.dataset.logoForeground = 'light';
          logo.style.filter = 'brightness(0) invert(1)';
          window.dispatchEvent(new Event('resize'));
        });
        await page.waitForFunction(
          () => document.querySelector('.site-logo')?.dataset?.logoForeground === 'dark',
          null,
          { timeout: 2500 }
        );
        await page.evaluate(async () => {
          const image = document.getElementById('__smoke-hero-logo-contrast-image');
          if (!image) throw new Error('Full-color Works contrast fixture image disappeared before the dark-media check.');
          image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#000000"/></svg>'
          );
          try { await image.decode(); } catch (_) {}
          // A changed hero frame must be recognized without requiring the visitor
          // to resize or scroll the page.
        });
        await page.waitForFunction(
          () => document.querySelector('.site-logo')?.dataset?.logoForeground === 'light',
          null,
          { timeout: 2500 }
        );
        await page.evaluate(() => {
          document.getElementById('__smoke-hero-logo-contrast-slide')?.remove();
          (window.__lmSmokeHeroSlideSnapshot || []).forEach(({ element, active }) => {
            element.classList.toggle('active', active);
          });
          delete window.__lmSmokeHeroSlideSnapshot;
          window.dispatchEvent(new Event('resize'));
        });
      }

      // Inactive bright slides must not outweigh the dark media of the active slide.
      await page.evaluate(async () => {
        const logo = document.querySelector('.site-logo');
        const rect = logo?.getBoundingClientRect();
        if (!logo || !rect) return;
        document.getElementById('__smoke-logo-slide-stack')?.remove();
        const backdrop = document.createElement('div');
        backdrop.id = '__smoke-logo-slide-stack';
        Object.assign(backdrop.style, {
          position:'fixed', left:(rect.left-3)+'px', top:(rect.top-3)+'px',
          width:(rect.width+6)+'px', height:(rect.height+6)+'px',
          zIndex:'999', pointerEvents:'auto', background:'transparent', overflow:'hidden'
        });
        const svg = color => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="' + color + '"/></svg>'
        );
        const addSlide = (color, active, z) => {
          const slide = document.createElement('div');
          slide.className = active ? 'slide active' : 'slide';
          Object.assign(slide.style,{position:'absolute',inset:'0',opacity:'1',zIndex:String(z),pointerEvents:'auto'});
          const img=document.createElement('img'); img.src=svg(color);
          Object.assign(img.style,{position:'absolute',inset:'0',width:'100%',height:'100%',objectFit:'fill',pointerEvents:'auto'});
          slide.appendChild(img); backdrop.appendChild(slide); return img;
        };
        const inactive=addSlide('#ffffff',false,2), active=addSlide('#000000',true,1);
        document.body.appendChild(backdrop);
        await Promise.all([inactive,active].map(img=>img.decode().catch(()=>{})));
        logo.dataset.logoForeground='dark'; logo.style.filter='brightness(0)';
        window.dispatchEvent(new Event('resize'));
      });
      await page.waitForFunction(() => document.querySelector('.site-logo')?.dataset?.logoForeground === 'light', null, {timeout:2500});

      // Unreadable media must receive a pointer-transparent glass fallback.
      await page.evaluate(() => {
        document.getElementById('__smoke-logo-slide-stack')?.remove();
        const logo=document.querySelector('.site-logo'), rect=logo?.getBoundingClientRect();
        if(!logo||!rect)return;
        const broken=document.createElement('img');
        broken.id='__smoke-unreadable-logo-media'; broken.src='data:image/png;base64,AAAA';
        Object.assign(broken.style,{position:'fixed',left:(rect.left-3)+'px',top:(rect.top-3)+'px',
          width:(rect.width+6)+'px',height:(rect.height+6)+'px',zIndex:'999',objectFit:'cover',
          background:'transparent',pointerEvents:'auto'});
        document.body.appendChild(broken);
        logo.dataset.logoForeground='dark'; logo.style.filter='brightness(0)';
        window.dispatchEvent(new Event('resize'));
      });
      await page.waitForFunction(() => document.querySelector('.site-logo')?.dataset?.logoForeground==='light' &&
        !document.querySelector('.nav-logo')?.classList.contains('logo-contrast-fallback'), null, {timeout:2500});
      const fallbackSurface=await page.evaluate(()=>{
        const link=document.querySelector('.nav-logo'), style=link?getComputedStyle(link,'::before'):null;
        return {
          foreground:document.querySelector('.site-logo')?.dataset?.logoForeground||'',
          hasFallbackClass:Boolean(link?.classList.contains('logo-contrast-fallback')),
          background:style?.backgroundColor||'',
          borderWidth:style?.borderTopWidth||'',
          boxShadow:style?.boxShadow||'none',
          backdropFilter:style?.backdropFilter||'none'
        };
      });
      if(fallbackSurface.foreground!=='light'||fallbackSurface.hasFallbackClass||
          fallbackSurface.background!=='rgba(0, 0, 0, 0)'||fallbackSurface.borderWidth!=='0px'||
          fallbackSurface.boxShadow!=='none'||fallbackSurface.backdropFilter!=='none'){
        throw new Error(label+' '+viewport.name+': unreadable media must keep the mark unplated: '+JSON.stringify(fallbackSurface));
      }
      await assertNoLogoBackingPlate(page,label+' unreadable-media fallback');
      await page.evaluate(()=>{document.getElementById('__smoke-unreadable-logo-media')?.remove();window.dispatchEvent(new Event('scroll'));});

      // Exercise the loading gate and mobile navigation as distinct logo
      // contrast states, not only the static light/dark test fixture.
      await page.evaluate(() => {
        const logo = document.querySelector('.site-logo');
        const rect = logo?.getBoundingClientRect();
        if (logo && rect) {
          const backdrop = document.createElement('div');
          backdrop.id = '__smoke-logo-backdrop';
          Object.assign(backdrop.style, {
            position: 'fixed',
            left: (rect.left - 3) + 'px',
            top: (rect.top - 3) + 'px',
            width: (rect.width + 6) + 'px',
            height: (rect.height + 6) + 'px',
            zIndex: '999',
            pointerEvents: 'auto',
            background: '#fff'
          });
          document.body.appendChild(backdrop);
        }
        window.dispatchEvent(new Event('resize'));
      });
      await page.waitForFunction(
        () => document.querySelector('.site-logo')?.dataset?.logoForeground === 'dark',
        null,
        { timeout: 2500 }
      );
      await page.evaluate(() => {
        const gate = document.getElementById('pageTransition');
        if (gate) {
          gate.classList.remove('is-hidden');
          gate.dataset.loading = 'active';
          gate.setAttribute('aria-hidden', 'false');
        }
        window.dispatchEvent(new Event('resize'));
      });
      await page.waitForFunction(
        () => document.querySelector('.site-logo')?.dataset?.logoForeground === 'light',
        null,
        { timeout: 2500 }
      );
      await page.evaluate(() => {
        const gate = document.getElementById('pageTransition');
        if (gate) {
          gate.dataset.loading = 'ready';
          gate.classList.add('is-hidden');
          gate.setAttribute('aria-hidden', 'true');
        }
        document.getElementById('__smoke-logo-backdrop')?.remove();
        window.dispatchEvent(new Event('scroll'));
      });

      if (viewport.name === 'mobile') {
        await page.evaluate(() => {
          const logo = document.querySelector('.site-logo');
          const rect = logo?.getBoundingClientRect();
          if (!logo || !rect) return;
          const backdrop = document.createElement('div');
          backdrop.id = '__smoke-logo-backdrop';
          Object.assign(backdrop.style, {
            position: 'fixed',
            left: (rect.left - 3) + 'px',
            top: (rect.top - 3) + 'px',
            width: (rect.width + 6) + 'px',
            height: (rect.height + 6) + 'px',
            zIndex: '999',
            pointerEvents: 'auto',
            background: '#fff'
          });
          document.body.appendChild(backdrop);
          window.dispatchEvent(new Event('resize'));
        });
        await page.waitForFunction(
          () => document.querySelector('.site-logo')?.dataset?.logoForeground === 'dark',
          null,
          { timeout: 2500 }
        );
        await page.evaluate(() => document.getElementById('__smoke-logo-backdrop')?.remove());
        await page.locator('.hamburger').click();
        await page.waitForFunction(
          () => document.body.classList.contains('menu-open') &&
            document.querySelector('.site-logo')?.dataset?.logoForeground === 'light',
          null,
          { timeout: 2500 }
        );
        const menuExpanded = await page.locator('.hamburger').getAttribute('aria-expanded');
        if (menuExpanded !== 'true') {
          throw new Error(label + ': mobile menu did not expose its expanded state while the logo followed the menu scrim.');
        }
        await page.keyboard.press('Escape');
        await page.waitForFunction(
          () => !document.body.classList.contains('menu-open') &&
            document.querySelector('.hamburger')?.getAttribute('aria-expanded') === 'false',
          null,
          { timeout: 2500 }
        );
      }

      {
        const videoContract = await page.evaluate(() => {
          const active = document.querySelector('#heroBanner .slide.active');
          const video = active?.querySelector('video');
          return video ? {
            present: true,
            muted: video.muted,
            playsInline: video.playsInline,
            loop: video.loop,
            paused: video.paused,
            currentTime: video.currentTime,
            playbackState: video.dataset.playbackState || '',
            poster: video.poster || '',
            posterAttribute: video.getAttribute('poster') || '',
            readyState: video.readyState,
            error: video.error ? { code: video.error.code, message: video.error.message || '' } : null,
            source: video.currentSrc || video.src
          } : {
            present: false,
            activeType: active?.dataset?.heroType || active?.firstElementChild?.localName || ''
          };
        });
        if (videoContract.present) {
          if (!videoContract.poster || !videoContract.posterAttribute) {
            throw new Error(label + ': hero video needs a poster fallback before its first decodable frame: ' + JSON.stringify(videoContract));
          }
          if (!videoContract.muted || !videoContract.playsInline ||
              (await page.locator('#heroBanner .slide').count()) === 1 && !videoContract.loop) {
            throw new Error(label + ': hero video must be muted, inline, and loop when it is the only manual slide: ' + JSON.stringify(videoContract));
          }
          await page.waitForFunction(() => {
            const video = document.querySelector('#heroBanner .slide.active video');
            return !video || video.error ||
              video.dataset.playbackState === 'blocked' ||
              (!video.paused && video.currentTime > 0.05);
          }, null, { timeout: 5000 });
          let playback = await page.locator('#heroBanner .slide.active video').evaluate(video => ({
            paused: video.paused,
            currentTime: video.currentTime,
            playbackState: video.dataset.playbackState || '',
            error: video.error ? video.error.code : 0
          }));
          if (playback.error) {
            throw new Error(label + ': hero video failed to decode or load (MediaError ' + playback.error + ').');
          }
          if (playback.playbackState === 'blocked' || playback.paused) {
            const retryTarget = expectedMessage ? '.hero-overlay' : '#heroBanner';
            await page.locator(retryTarget).click({ position: { x: 12, y: 12 } });
            await page.waitForFunction(() => {
              const video = document.querySelector('#heroBanner .slide.active video');
              return video && (video.error || (!video.paused && video.currentTime > 0.05));
            }, null, { timeout: 3000 });
            playback = await page.locator('#heroBanner .slide.active video').evaluate(video => ({
              paused: video.paused,
              currentTime: video.currentTime,
              error: video.error ? video.error.code : 0
            }));
            if (playback.error || playback.paused || playback.currentTime <= 0.05) {
              throw new Error(label + ': hero video did not resume after a real interaction: ' + JSON.stringify(playback));
            }
          }
        } else if (videoContract.activeType === 'video') {
          throw new Error(label + ': video hero media was not rendered as a video element.');
        }

        // Force the fallback path once with Hero Message enabled: the real
        // pointer gesture lands on the overlay sibling, not the banner.
        if (videoContract.present && expectedMessage && viewport.name === 'desktop') {
          const priorTime = await page.locator('#heroBanner .slide.active video').evaluate(video => {
            video.pause();
            video.dataset.playbackState = 'blocked';
            return video.currentTime;
          });
          await page.locator('.hero-overlay').click({ position: { x: 12, y: 12 } });
          await page.waitForFunction(baseline => {
            const video = document.querySelector('#heroBanner .slide.active video');
            return video && !video.paused && video.currentTime > baseline + 0.05;
          }, priorTime, { timeout: 3000 });
        }
      }
      if (!expectedMessage && layout.heroHeight + 1 < layout.heroMinHeight) {
        throw new Error(label + ' ' + viewport.name + ': message-free hero does not use its responsive minimum height: ' + JSON.stringify(layout));
      }
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const transitionDuration = await page.locator('.site-logo').first().evaluate(
      logo => getComputedStyle(logo).transitionDuration
    );
    if (transitionDuration.split(',').some(value => Number.parseFloat(value) > 0)) {
      throw new Error(label + ': adaptive logo transitions must respect prefers-reduced-motion, got ' + transitionDuration);
    }
  } finally {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize(originalViewport);
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
  // Instrument readiness without affecting application behavior. This profile
  // runs only in the isolated Chromium smoke harness and is informational.
  await page.addInitScript(() => {
    try { performance.setResourceTimingBufferSize(2000); } catch (_) {}
    let activeMarked = false;
    let readyMarked = false;
    const inspectReadiness = () => {
      const state = document.getElementById('pageTransition')?.dataset?.loading;
      if (state === 'active' && !activeMarked) {
        activeMarked = true;
        try { performance.mark('lm-page-loading-active'); } catch (_) {}
      }
      if (state === 'ready' && !readyMarked) {
        readyMarked = true;
        try { performance.mark('lm-page-ready'); } catch (_) {}
        observer.disconnect();
      }
    };
    const observer = new MutationObserver(inspectReadiness);
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-loading']
    });
    inspectReadiness();
  });
  // Deterministic, silent audio spy: record only audible requests, not muted
  // autoplay-unlock attempts, so the mobile interaction test never makes sound.
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.__lmAudioPlayLog = [];
    window.Audio = function (...args) {
      const audio = new NativeAudio(...args);
      audio.play = function () {
        if (!audio.muted) {
          try { window.__lmAudioPlayLog.push(new URL(audio.src, location.href).pathname); } catch (_) {}
        }
        return Promise.resolve();
      };
      return audio;
    };
    window.Audio.prototype = NativeAudio.prototype;
  });
  const requestedUrls = [];
  page.on('request', request => requestedUrls.push(request.url()));
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
      const http404Resources = [];
      const failedSameOriginRequests = [];
      const appOrigin = new URL(BASE_URL).origin;
      page.on('response', response => {
        if (response.status() === 404) {
          let responseOrigin = '';
          try { responseOrigin = new URL(response.url()).origin; } catch (_) {}
          if (responseOrigin === appOrigin) http404Resources.push(response.url());
        }
      });
      page.on('requestfailed', request => {
        let requestUrl;
        try { requestUrl = new URL(request.url()); } catch (_) { return; }
        if (requestUrl.origin !== appOrigin) return;
        const failure = request.failure()?.errorText || 'unknown network failure';
        // Media and fetches may be intentionally cancelled when a user closes
        // a viewer or navigation replaces stale work. Those are not transport
        // failures; all other same-origin failures should fail the smoke run.
        if (/ERR_ABORTED|NS_BINDING_ABORTED|ERR_CANCELED/i.test(failure)) return;
        failedSameOriginRequests.push(`${requestUrl.href} (${failure})`);
      });
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
        await assertions(page, { requestedUrls });
      } catch (error) {
        if (errors.length) {
          const browserErrors = errors.join('\\n- ');
          error.message = `${error.message}\\n\\nBrowser errors observed before failure:\\n- ${browserErrors}`;
        }
        throw error;
      }

      if (errors.length || http404Resources.length || failedSameOriginRequests.length) {
        const details = [];
        if (errors.length) details.push('Browser errors:\\n- ' + errors.join('\\n- '));
        if (http404Resources.length) {
          details.push('Same-origin HTTP 404 URLs:\\n- ' + [...new Set(http404Resources)].join('\\n- '));
        }
        if (failedSameOriginRequests.length) {
          details.push('Failed same-origin network requests:\\n- ' + [...new Set(failedSameOriginRequests)].join('\\n- '));
        }
        throw new Error(`${path} failed browser smoke checks:\\n${details.join('\\n\\n')}`);
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

async function assertMobileFilterCenteredSound(page, label) {
  const rail = page.locator('.filter-tabs');
  await rail.scrollIntoViewIfNeeded();
  const geometry = await rail.evaluate(el => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth
  }));
  if (geometry.scrollWidth <= geometry.clientWidth + 2) {
    throw new Error(label + ' filter rail is not horizontally scrollable: ' + JSON.stringify(geometry));
  }

  const startingSoundCount = await page.evaluate(() =>
    (window.__lmAudioPlayLog || []).filter(src => src.endsWith('/selection.wav')).length
  );
  const rect = await rail.boundingBox();
  if (!rect) throw new Error(label + ' filter rail has no measurable hit area.');

  const y = rect.y + rect.height / 2;
  // Start in the trailing fade/edge-spacer region to prove a swipe that does
  // not begin on a tab button still unlocks playback for the settled cue.
  await page.mouse.move(rect.x + rect.width * 0.98, y);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.40, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  const dragged = await page.evaluate(() => {
    const rail = document.querySelector('.filter-tabs');
    const buttons = Array.from(rail?.querySelectorAll('.filter-btn, .tab-btn') || []);
    const active = buttons.find(button => button.classList.contains('active'));
    const rect = active?.getBoundingClientRect();
    const railRect = rail?.getBoundingClientRect();
    return {
      activeFilter: active?.getAttribute('data-filter') || '',
      pressedCount: buttons.filter(button => button.getAttribute('aria-pressed') === 'true').length,
      centerDelta: rect && railRect ? Math.abs((rect.left + rect.width / 2) - (railRect.left + railRect.width / 2)) : Infinity,
      selectionSoundCalls: (window.__lmAudioPlayLog || []).filter(src => src.endsWith('/selection.wav')).length
    };
  });
  if (!dragged.activeFilter || dragged.activeFilter === 'all' || dragged.pressedCount !== 1 ||
      dragged.centerDelta > 3 || dragged.selectionSoundCalls !== startingSoundCount + 1) {
    throw new Error(label + ' settled mobile filter must center and play one selection cue: ' +
      JSON.stringify({ geometry, startingSoundCount, dragged }));
  }

  // Arrow keys are an equivalent input method. Check centering under reduced
  // motion and verify exactly one additional cue after the new center settles.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const beforeKeyboard = dragged.selectionSoundCalls;
  const keyboardStart = await rail.evaluate(el => {
    const buttons = Array.from(el.querySelectorAll('.filter-btn, .tab-btn'));
    const activeIndex = buttons.findIndex(button => button.classList.contains('active'));
    return { activeIndex, count: buttons.length };
  });
  const key = keyboardStart.activeIndex < keyboardStart.count - 1 ? 'ArrowRight' : 'ArrowLeft';
  await rail.locator('.active').focus();
  await page.keyboard.press(key);
  await page.waitForTimeout(450);
  const keyboard = await page.evaluate(() => {
    const rail = document.querySelector('.filter-tabs');
    const buttons = Array.from(rail?.querySelectorAll('.filter-btn, .tab-btn') || []);
    const active = buttons.find(button => button.classList.contains('active'));
    const rect = active?.getBoundingClientRect();
    const railRect = rail?.getBoundingClientRect();
    return {
      activeIndex: buttons.indexOf(active),
      focusIndex: buttons.indexOf(document.activeElement),
      pressedCount: buttons.filter(button => button.getAttribute('aria-pressed') === 'true').length,
      centerDelta: rect && railRect ? Math.abs((rect.left + rect.width / 2) - (railRect.left + railRect.width / 2)) : Infinity,
      selectionSoundCalls: (window.__lmAudioPlayLog || []).filter(src => src.endsWith('/selection.wav')).length
    };
  });
  if (keyboard.activeIndex === keyboardStart.activeIndex || keyboard.focusIndex < 0 ||
      keyboard.pressedCount !== 1 || keyboard.centerDelta > 3 ||
      keyboard.selectionSoundCalls !== beforeKeyboard + 1) {
    throw new Error(label + ' keyboard filter navigation must focus, center and sound once with reduced motion: ' +
      JSON.stringify({ keyboardStart, keyboard, beforeKeyboard }));
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}

async function assertFilterNavigationResponsive(page, label) {
  await page.waitForFunction(() =>
    document.querySelectorAll('.filter-nav-scroller .filter-btn, .filter-nav-scroller .tab-btn').length >= 2
  );

  const viewports = [
    { width: 320, height: 568 }, { width: 360, height: 740 }, { width: 390, height: 844 },
    { width: 600, height: 900 }, { width: 767, height: 900 }, { width: 768, height: 900 },
    { width: 820, height: 900 }, { width: 1024, height: 900 }, { width: 1099, height: 900 },
    { width: 1100, height: 900 }, { width: 1280, height: 900 }, { width: 1440, height: 900 },
    { width: 1920, height: 1080 }
  ];
  let testedCenteredSelection = false;
  let testedMouseDrag = false;

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(160);
    // Viewport re-centering intentionally disables the indicator transition
    // while it tracks the moving rail. Let the resize debounce and settlement
    // finish before asserting the resting-state transition contract.
    await page.waitForFunction(() => {
      const indicator = document.querySelector('.filter-nav-viewport .filter-active-indicator');
      const content = document.querySelector('.filter-nav-scroller .filter-nav-content');
      return !indicator?.classList.contains('is-following-scroll') &&
        !content?.classList.contains('is-following-filter-scroll') &&
        !content?.querySelector('.is-centered-preview');
    }, null, { timeout: 1800 });
    const state = await page.evaluate(() => {
      const wrapper = document.querySelector('.filter-nav-wrapper');
      const viewport = wrapper?.querySelector('.filter-nav-viewport');
      const scroller = wrapper?.querySelector('.filter-nav-scroller');
      const content = scroller?.querySelector('.filter-nav-content');
      const buttons = Array.from(content?.querySelectorAll('.filter-btn, .tab-btn') || []);
      const gap = Number.parseFloat(content ? getComputedStyle(content).columnGap : '0') || 0;
      const naturalWidth = buttons.reduce((total, button) => total + button.getBoundingClientRect().width, 0) +
        gap * Math.max(0, buttons.length - 1);
      const naturalOverflow = naturalWidth > (scroller?.clientWidth || 0) + 1;
      const scrollerRect = scroller?.getBoundingClientRect();
      const firstRect = buttons[0]?.getBoundingClientRect();
      const lastRect = buttons[buttons.length - 1]?.getBoundingClientRect();
      const active = buttons.find(button => button.classList.contains('active'));
      const activeRect = active?.getBoundingClientRect();
      const activeStyle = active ? getComputedStyle(active) : null;
      const indicator = viewport?.querySelector('.filter-active-indicator');
      const indicatorRect = indicator?.getBoundingClientRect();
      const indicatorStyle = indicator ? getComputedStyle(indicator) : null;
      const scrollerStyle = scroller ? getComputedStyle(scroller) : null;
      const wrapperStyle = wrapper ? getComputedStyle(wrapper) : null;
      return {
        wrapperExists: !!wrapper, role: wrapper?.getAttribute('role') || '',
        label: wrapper?.getAttribute('aria-label') || '', viewportExists: !!viewport,
        scrollerExists: !!scroller, contentExists: !!content, count: buttons.length,
        clientWidth: scroller?.clientWidth || 0, scrollWidth: scroller?.scrollWidth || 0,
        dataOverflow: scroller?.dataset.overflow === 'true',
        actualOverflow: (scroller?.scrollWidth || 0) > (scroller?.clientWidth || 0) + 1,
        naturalOverflow,
        // Edge cushions turn every multi-category rail into a true centered
        // carousel, even where the unpadded labels would fit.
        expectedOverflow: buttons.length > 1,
        snapType: scrollerStyle?.scrollSnapType || '', touchAction: scrollerStyle?.touchAction || '',
        verticalOverflow: scroller ? scroller.scrollHeight > scroller.clientHeight + 1 : true,
        paddingTop: Number.parseFloat(wrapperStyle?.paddingTop || '0') || 0,
        paddingBottom: Number.parseFloat(wrapperStyle?.paddingBottom || '0') || 0,
        minButtonHeight: buttons.length ? Math.min(...buttons.map(button => button.getBoundingClientRect().height)) : 0,
        labelsStayOneLine: buttons.every(button => getComputedStyle(button).whiteSpace === 'nowrap'),
        groupCenterDelta: scrollerRect && firstRect && lastRect
          ? Math.abs((firstRect.left + lastRect.right) / 2 - (scrollerRect.left + scroller.clientWidth / 2))
          : Infinity,
        activeCenterDelta: scrollerRect && activeRect
          ? Math.abs(activeRect.left + activeRect.width / 2 - (scrollerRect.left + scroller.clientWidth / 2))
          : Infinity,
        activeFilter: active?.getAttribute('data-filter') || '',
        activePressed: active?.getAttribute('aria-pressed') || '',
        ariaPressedCount: buttons.filter(button => button.getAttribute('aria-pressed') === 'true').length,
        activeRadius: Number.parseFloat(activeStyle?.borderTopLeftRadius || '0') || 0,
        activeBackground: activeStyle?.backgroundColor || '',
        indicatorExists: !!indicator,
        indicatorReady: indicator?.classList.contains('is-ready') || false,
        indicatorBackground: indicatorStyle?.backgroundColor || '',
        indicatorRadius: Number.parseFloat(indicatorStyle?.borderTopLeftRadius || '0') || 0,
        indicatorWidthDelta: activeRect && indicatorRect ? Math.abs(activeRect.width - indicatorRect.width) : Infinity,
        indicatorCenterDelta: activeRect && indicatorRect ? Math.abs(
          (activeRect.left + activeRect.width / 2) - (indicatorRect.left + indicatorRect.width / 2)
        ) : Infinity,
        indicatorCenterDeltaY: activeRect && indicatorRect ? Math.abs(
          (activeRect.top + activeRect.height / 2) - (indicatorRect.top + indicatorRect.height / 2)
        ) : Infinity,
        indicatorTransition: indicatorStyle?.transitionProperty || '',
        indicatorFollowingScroll: indicator?.classList.contains('is-following-scroll') || false,
        contentFollowingFilterScroll: content?.classList.contains('is-following-filter-scroll') || false,
        prefersReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth
      };
    });

    if (!state.wrapperExists || state.role !== 'group' || state.label !== 'Project categories' ||
        !state.viewportExists || !state.scrollerExists || !state.contentExists || state.count < 2) {
      throw new Error(label + ' filter navigation structure is incomplete at ' + viewport.width + 'px: ' + JSON.stringify(state));
    }
    if (state.dataOverflow !== state.expectedOverflow || state.actualOverflow !== state.expectedOverflow) {
      throw new Error(label + ' centered-carousel overflow state is inconsistent at ' + viewport.width + 'px: ' + JSON.stringify(state));
    }
    if (state.activeCenterDelta > 2) {
      throw new Error(label + ' active filter must remain centered at ' + viewport.width + 'px: ' + JSON.stringify(state));
    }
    if (state.minButtonHeight < 44 || !state.labelsStayOneLine || state.verticalOverflow ||
        state.paddingTop < 14 || state.paddingBottom < 14) {
      throw new Error(label + ' filter spacing, wrapping, or 44px target contract failed at ' + viewport.width + 'px: ' + JSON.stringify(state));
    }
    if (state.ariaPressedCount !== 1 || !state.indicatorExists || !state.indicatorReady ||
        state.indicatorBackground !== 'rgb(242, 242, 242)' || state.indicatorRadius < 20 ||
        state.indicatorWidthDelta > 1 || state.indicatorCenterDelta > 1 || state.indicatorCenterDeltaY > 1 ||
        state.indicatorFollowingScroll || state.contentFollowingFilterScroll ||
        (viewport.width > 1023 && !state.prefersReducedMotion && !state.indicatorTransition.includes('transform')) ||
        (viewport.width <= 1023 && state.indicatorTransition !== 'none') ||
        state.activeBackground !== 'rgba(0, 0, 0, 0)' &&
        state.activeBackground !== 'transparent') {
      throw new Error(label + ' accessible sliding-pill state or marker-free button contract failed at ' + viewport.width + 'px: ' + JSON.stringify(state));
    }
    if (state.documentWidth > state.viewportWidth + 1) {
      throw new Error(label + ' filter navigation introduced document-level horizontal overflow at ' + viewport.width + 'px: ' + JSON.stringify(state));
    }
    if (!state.dataOverflow && state.groupCenterDelta > 2) {
      throw new Error(label + ' fitting filter categories are not centered as a group at ' + viewport.width + 'px: ' + JSON.stringify(state));
    }
    if (state.dataOverflow && state.snapType !== 'none') {
      throw new Error(label + ' overflowing filter navigation must not use native snap momentum at ' + viewport.width + 'px: ' + JSON.stringify(state));
    }
    if (state.touchAction !== 'pan-y') {
      throw new Error(label + ' filter rail must delegate vertical gestures to the page (touch-action: pan-y) at ' + viewport.width + 'px: ' + JSON.stringify(state));
    }

    // Test active-pill centering once at the narrowest phone width.
    if (viewport.width === 320 && state.dataOverflow) {
      const nonAll = page.locator('.filter-nav-scroller [data-filter]:not([data-filter="all"])').first();
      await nonAll.click();
      await page.waitForFunction(() => {
        const scroller = document.querySelector('.filter-nav-scroller');
        const active = scroller?.querySelector('.filter-btn.active, .tab-btn.active');
        const scrollerRect = scroller?.getBoundingClientRect();
        const activeRect = active?.getBoundingClientRect();
        return !!scrollerRect && !!activeRect && (
          Math.abs(activeRect.left + activeRect.width / 2 - (scrollerRect.left + scroller.clientWidth / 2)) <= 2 ||
          (activeRect.left >= scrollerRect.left + 8 && activeRect.right <= scrollerRect.right - 8)
          );
      }, null, { timeout: 2500 });
      const selected = await page.evaluate(() => {
        const active = document.querySelector('.filter-nav-scroller .filter-btn.active, .filter-nav-scroller .tab-btn.active');
        return { filter: active?.getAttribute('data-filter') || '', pressed: active?.getAttribute('aria-pressed') || '' };
      });
      if (!selected.filter || selected.pressed !== 'true') {
        throw new Error(label + ' centered filter selection lost active/ARIA state: ' + JSON.stringify(selected));
      }
      testedCenteredSelection = true;

      // Primary-button mouse drag uses the same settle-to-nearest contract as touch scrolling.
      const rail = page.locator('.filter-nav-scroller');
      const rect = await rail.boundingBox();
      if (rect) {
        await page.mouse.move(rect.x + rect.width * .78, rect.y + rect.height / 2);
        await page.mouse.down();
        await page.mouse.move(rect.x + rect.width * .22, rect.y + rect.height / 2, { steps: 6 });
        await page.mouse.up();
        await page.waitForFunction(() => {
          const scroller = document.querySelector('.filter-nav-scroller');
          const active = scroller?.querySelector('.filter-btn.active, .tab-btn.active');
          const scrollerRect = scroller?.getBoundingClientRect();
          const activeRect = active?.getBoundingClientRect();
          return !!scrollerRect && !!activeRect &&
            !scroller?.classList.contains('is-gesture-active') &&
            Math.abs(activeRect.left + activeRect.width / 2 - (scrollerRect.left + scroller.clientWidth / 2)) <= 2;
        }, null, { timeout: 2500 });
        testedMouseDrag = true;
      }

      // A predominantly vertical touch begun over the rail must not become
      // a horizontal drag or trigger filter settlement.
      const verticalGesture = await rail.evaluate(async el => {
        const rect = el.getBoundingClientRect();
        const before = el.scrollLeft;
        const x = rect.left + rect.width * 0.55;
        const y = rect.top + rect.height / 2;
        const dispatch = (type, clientX, clientY) => el.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 71, pointerType: 'touch',
          isPrimary: true, button: 0, clientX, clientY
        }));
        dispatch('pointerdown', x, y);
        dispatch('pointermove', x + 1, y + 42);
        dispatch('pointerup', x + 1, y + 42);
        await new Promise(resolve => setTimeout(resolve, 40));
        return {
          before, after: el.scrollLeft,
          dragging: el.classList.contains('is-dragging'),
          gestureActive: el.classList.contains('is-gesture-active')
        };
      });
      if (Math.abs(verticalGesture.after - verticalGesture.before) > 1 ||
          verticalGesture.dragging || verticalGesture.gestureActive) {
        throw new Error(label + ' vertical touch gesture was captured by the filter rail: ' + JSON.stringify(verticalGesture));
      }

      // A short, slow horizontal gesture should settle nearby rather than
      // coasting across multiple filters.
      const slowGesture = await rail.evaluate(async el => {
        const rect = el.getBoundingClientRect();
        const before = el.scrollLeft;
        const x = rect.left + rect.width * 0.68;
        const y = rect.top + rect.height / 2;
        const dispatch = (type, clientX, clientY) => el.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 72, pointerType: 'touch',
          isPrimary: true, button: 0, clientX, clientY
        }));
        dispatch('pointerdown', x, y);
        await new Promise(resolve => setTimeout(resolve, 120));
        dispatch('pointermove', x - 14, y + 1);
        await new Promise(resolve => setTimeout(resolve, 100));
        dispatch('pointerup', x - 14, y + 1);
        return { before, requestedDistance: 14 };
      });
      await page.waitForFunction(() => {
        const scroller = document.querySelector('.filter-nav-scroller');
        const active = scroller?.querySelector('.filter-btn.active, .tab-btn.active');
        const scrollerRect = scroller?.getBoundingClientRect();
        const activeRect = active?.getBoundingClientRect();
        return !!scrollerRect && !!activeRect &&
          !scroller.classList.contains('is-gesture-active') &&
          Math.abs(activeRect.left + activeRect.width / 2 - (scrollerRect.left + scroller.clientWidth / 2)) <= 2;
      }, null, { timeout: 2500 });
      const slowAfter = await rail.evaluate(el => el.scrollLeft);
      if (Math.abs(slowAfter - slowGesture.before) > 55) {
        throw new Error(label + ' short slow swipe travelled too far instead of settling nearby: ' +
          JSON.stringify({ ...slowGesture, after: slowAfter }));
      }

      // A fast swipe must stop tracking the pointer immediately on release.
      // Gallery settles the closest label without inertia or native snapping.
      const fastGesture = await rail.evaluate(async el => {
        const rect = el.getBoundingClientRect();
        const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
        const before = el.scrollLeft;
        const towardRight = maxScroll - before >= before ? 1 : -1;
        const available = towardRight > 0 ? maxScroll - before : before;
        const distance = Math.min(120, available * 0.75);
        const fingerDelta = towardRight > 0 ? -distance : distance;
        const x = rect.left + rect.width * 0.5;
        const y = rect.top + rect.height / 2;
        const dispatch = (type, clientX, clientY) => el.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 73, pointerType: 'touch',
          isPrimary: true, button: 0, clientX, clientY
        }));
        dispatch('pointerdown', x, y);
        await new Promise(resolve => setTimeout(resolve, 16));
        dispatch('pointermove', x + fingerDelta * 0.52, y + 1);
        await new Promise(resolve => setTimeout(resolve, 16));
        dispatch('pointermove', x + fingerDelta, y + 1);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const direct = el.scrollLeft;
        const preview = el.querySelector('.tab-btn.is-centered-preview');
        const indicator = el.closest('.filter-nav-viewport')?.querySelector('.filter-active-indicator');
        const previewColor = preview ? getComputedStyle(preview).color : '';
        const previewTransition = preview ? getComputedStyle(preview).transitionProperty : '';
        const indicatorTransition = indicator ? getComputedStyle(indicator).transitionProperty : '';
        dispatch('pointerup', x + fingerDelta, y + 1);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          before, direct, afterRelease: el.scrollLeft,
          requestedDistance: distance, snapType: getComputedStyle(el).scrollSnapType,
          previewColor, previewTransition, indicatorTransition
        };
      });
      if (fastGesture.snapType !== 'none' || Math.abs(fastGesture.afterRelease - fastGesture.direct) > 1) {
        throw new Error(label + ' fast swipe continued moving after release instead of stopping cleanly: ' +
          JSON.stringify(fastGesture));
      }
      if (fastGesture.previewColor !== 'rgb(17, 17, 17)' ||
          fastGesture.previewTransition !== 'none' ||
          fastGesture.indicatorTransition !== 'none') {
        throw new Error(label + ' swipe preview must stay dark and motion-free while the pill is moving: ' +
          JSON.stringify(fastGesture));
      }
      await page.waitForFunction(() => {
        const scroller = document.querySelector('.filter-nav-scroller');
        const active = scroller?.querySelector('.filter-btn.active, .tab-btn.active');
        const scrollerRect = scroller?.getBoundingClientRect();
        const activeRect = active?.getBoundingClientRect();
        return !!scrollerRect && !!activeRect &&
          !scroller.classList.contains('is-gesture-active') &&
          Math.abs(activeRect.left + activeRect.width / 2 - (scrollerRect.left + scroller.clientWidth / 2)) <= 2;
      }, null, { timeout: 3000 });

      await page.locator('.filter-nav-scroller [data-filter="all"]').click();
      await page.waitForFunction(() => {
        const scroller = document.querySelector('.filter-nav-scroller');
        const active = scroller?.querySelector('.filter-btn.active, .tab-btn.active');
        const scrollerRect = scroller?.getBoundingClientRect();
        const activeRect = active?.getBoundingClientRect();
        return !!scrollerRect && !!activeRect && (
          Math.abs(activeRect.left + activeRect.width / 2 - (scrollerRect.left + scroller.clientWidth / 2)) <= 2 ||
          (activeRect.left >= scrollerRect.left + 8 && activeRect.right <= scrollerRect.right - 8)
          );
      }, null, { timeout: 2500 });

      // A delayed scrollend from the preceding fast swipe must not override
      // an explicit click selection once programmatic centering has settled.
      await page.waitForTimeout(850);
      const stableSelection = await page.locator('.filter-nav-scroller [data-filter="all"]').evaluate(button => ({
        active: button.classList.contains('active'),
        pressed: button.getAttribute('aria-pressed')
      }));
      if (!stableSelection.active || stableSelection.pressed !== 'true') {
        throw new Error(label + ' a delayed scroll settlement overrode the explicit All filter selection: ' +
          JSON.stringify(stableSelection));
      }
    }
  }

  if (!testedCenteredSelection || !testedMouseDrag) {
    throw new Error(label + ' missed centered selection or mouse-drag interaction checks.');
  }

  // Desktop uses the same centered carousel: primary-button dragging must move
  // the rail, settle on the nearest label, and keep the preview text dark on gray.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(160);
  const desktopRail = page.locator('.filter-nav-scroller');
  const desktopRect = await desktopRail.boundingBox();
  if (desktopRect) {
    await page.mouse.move(desktopRect.x + desktopRect.width * 0.78, desktopRect.y + desktopRect.height / 2);
    await page.mouse.down();
    await page.mouse.move(desktopRect.x + desktopRect.width * 0.22, desktopRect.y + desktopRect.height / 2, { steps: 6 });
    const previewText = await page.evaluate(() => {
      const preview = document.querySelector('.filter-nav-scroller .tab-btn.is-centered-preview');
      if (!preview) return null;
      const style = getComputedStyle(preview);
      return {
         label: preview.textContent.trim(),
         color: style.color,
         background: style.backgroundColor,
         transitionProperty: style.transitionProperty
       };
    });
    if (previewText && (
         previewText.color !== 'rgb(17, 17, 17)' ||
         previewText.transitionProperty !== 'none'
     )) {
      await page.mouse.up();
      throw new Error(label + ' desktop centered pill preview text must remain dark during hover: ' + JSON.stringify(previewText));
    }
    await page.mouse.up();
    await page.waitForFunction(() => {
      const scroller = document.querySelector('.filter-nav-scroller');
      const active = scroller?.querySelector('.filter-btn.active, .tab-btn.active');
      const railRect = scroller?.getBoundingClientRect();
      const activeRect = active?.getBoundingClientRect();
      return !!railRect && !!activeRect && !scroller.classList.contains('is-gesture-active') &&
        Math.abs(activeRect.left + activeRect.width / 2 - (railRect.left + scroller.clientWidth / 2)) <= 2;
    }, null, { timeout: 3000 });
  }
  const filterOptions = page.locator('.filter-nav-scroller [data-filter]');
  const filterOptionCount = await filterOptions.count();
  for (let i = 0; i < filterOptionCount; i += 1) {
    const option = filterOptions.nth(i);
    await option.click();
    await page.waitForFunction(expectedFilter => {
      const scroller = document.querySelector('.filter-nav-scroller');
      const content = scroller?.querySelector('.filter-nav-content');
      const active = content?.querySelector('.filter-btn.active, .tab-btn.active');
      const indicator = scroller?.closest('.filter-nav-viewport')?.querySelector('.filter-active-indicator');
      if (!active || !indicator || active.dataset.filter !== expectedFilter ||
          active.getAttribute('aria-pressed') !== 'true' || !indicator.classList.contains('is-ready')) return false;
      const a = active.getBoundingClientRect();
      const b = indicator.getBoundingClientRect();
      return Math.abs((a.left + a.width / 2) - (b.left + b.width / 2)) <= 1 &&
        Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) <= 1 &&
        Math.abs(a.width - b.width) <= 1;
    }, await option.getAttribute('data-filter'), { timeout: 1800 });

    const selectedColor = await option.evaluate(button => getComputedStyle(button).color);
    if (selectedColor !== 'rgb(17, 17, 17)') {
      throw new Error(label + ' selected filter text must turn dark immediately on tap/click: ' +
        JSON.stringify({ filter: await option.getAttribute('data-filter'), selectedColor }));
    }
    const hoverTargetId = await page.evaluate(() => {
      const rail = document.querySelector('.filter-nav-scroller');
      if (!rail) return '';
      const bounds = rail.getBoundingClientRect();
      const candidate = Array.from(rail.querySelectorAll('[data-filter]:not(.active):not(:disabled)')).find(button => {
        const rect = button.getBoundingClientRect();
        return rect.left >= bounds.left && rect.right <= bounds.right && rect.width > 0 && rect.height > 0;
      });
      return candidate?.getAttribute('data-filter') || '';
    });
    if (hoverTargetId) {
      const targetBox = await page.locator('.filter-nav-scroller [data-filter]').evaluateAll((buttons, id) => {
        const button = buttons.find(item => item.getAttribute('data-filter') === id);
        if (!button) return null;
        const rect = button.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }, hoverTargetId);
      if (targetBox) {
        await page.mouse.move(targetBox.x, targetBox.y);
        const hoverColor = await page.evaluate(id => {
          const button = Array.from(document.querySelectorAll('.filter-nav-scroller [data-filter]'))
            .find(item => item.getAttribute('data-filter') === id);
          return button ? getComputedStyle(button).color : '';
        }, hoverTargetId);
        if (hoverColor !== 'rgba(255, 255, 255, 0.68)') {
          throw new Error(label + ' hovering over another filter must not turn its text white: ' +
            JSON.stringify({ filter: hoverTargetId, hoverColor }));
        }
      }
    }
    const stalePreviewProbe = await page.evaluate(() => {
      const rail = document.querySelector('.filter-nav-scroller');
      const content = rail?.querySelector('.filter-nav-content');
      const indicator = rail?.closest('.filter-nav-viewport')?.querySelector('.filter-active-indicator');
      const active = content?.querySelector('.filter-btn.active, .tab-btn.active');
      const preview = Array.from(content?.querySelectorAll('.filter-btn, .tab-btn') || [])
        .find(button => button !== active && !button.disabled);
      if (!content || !indicator || !active || !preview) return { available: false };
      content.classList.add('is-following-filter-scroll');
      indicator.classList.add('is-following-scroll');
      preview.classList.add('is-centered-preview');
      // Prove capture-phase cleanup survives a page element stopping bubbling.
      document.documentElement.addEventListener('pointerdown', event => event.stopPropagation(), { once: true });
      return { available: true };
    });
    if (!stalePreviewProbe.available) {
      throw new Error(label + ' could not prepare an outside-click filter-preview regression state.');
    }
    const viewportSize = page.viewportSize();
    await page.mouse.click(Math.max(1, (viewportSize?.width || 1280) - 2), 2);
    const selectedAfterOtherSpaceClick = await option.evaluate(button => {
      const rail = button.closest('.filter-nav-scroller');
      const content = rail?.querySelector('.filter-nav-content');
      const indicator = rail?.closest('.filter-nav-viewport')?.querySelector('.filter-active-indicator');
      return {
        active: button.classList.contains('active'),
        color: getComputedStyle(button).color,
        contentFollowing: content?.classList.contains('is-following-filter-scroll') || false,
        indicatorFollowing: indicator?.classList.contains('is-following-scroll') || false,
        previewCount: content?.querySelectorAll('.is-centered-preview').length || 0
      };
    });
    if (!selectedAfterOtherSpaceClick.active ||
        selectedAfterOtherSpaceClick.color !== 'rgb(17, 17, 17)' ||
        selectedAfterOtherSpaceClick.contentFollowing ||
        selectedAfterOtherSpaceClick.indicatorFollowing ||
        selectedAfterOtherSpaceClick.previewCount !== 0) {
      throw new Error(label + ' clicking elsewhere must clear swipe preview state and keep the selected label dark: ' +
        JSON.stringify(selectedAfterOtherSpaceClick));
    }

    const announcementState = await page.evaluate(() => {
      const active = document.querySelector('.filter-nav-scroller [data-filter].active');
      const status = document.querySelector('.filter-announcement');
      return {
        filter: active?.getAttribute('data-filter') || '',
        label: active?.textContent?.trim() || '',
        role: status?.getAttribute('role') || '',
        live: status?.getAttribute('aria-live') || '',
        text: status?.textContent?.trim() || ''
      };
    });
    const announcementValid = announcementState.role === 'status' &&
      announcementState.live === 'polite' &&
      (announcementState.filter === 'all'
        ? /^Showing all \d+ projects?\.$/.test(announcementState.text)
        : announcementState.text.includes(announcementState.label) &&
          /^Showing \d+ projects? in /.test(announcementState.text));
    if (!announcementValid) {
      throw new Error(label + ' filter changes must announce the resulting project count politely: ' +
        JSON.stringify(announcementState));
    }
  }

  // Disabled filter controls must not respond to activation or mimic an active pill.
  const disabledProbe = page.locator('.filter-nav-scroller [data-filter]:not(.active)').first();
  const selectedBeforeDisabledClick = await page.locator('.filter-nav-scroller [data-filter].active').getAttribute('data-filter');
  await disabledProbe.evaluate(button => { button.disabled = true; });
  // Disabled state fades through the shared 220ms button transition. Wait for
  // that transition to settle before asserting its final computed opacity.
  await page.waitForFunction(() => {
    const button = document.querySelector('.filter-nav-scroller [data-filter][disabled]:not(.active)');
    return !!button && Number(getComputedStyle(button).opacity) < 0.99;
  }, null, { timeout: 700 });
  const disabledStyle = await disabledProbe.evaluate(button => ({
    disabled: button.disabled,
    cursor: getComputedStyle(button).cursor,
    background: getComputedStyle(button).backgroundColor,
    opacity: Number(getComputedStyle(button).opacity)
  }));
  await disabledProbe.evaluate(button => button.click());
  await page.waitForTimeout(80);
  const selectedAfterDisabledClick = await page.locator('.filter-nav-scroller [data-filter].active').getAttribute('data-filter');
  if (!disabledStyle.disabled || disabledStyle.cursor !== 'not-allowed' ||
      disabledStyle.opacity >= 1 || selectedAfterDisabledClick !== selectedBeforeDisabledClick) {
    throw new Error(label + ' disabled filter state must remain visually distinct and non-interactive: ' +
      JSON.stringify({ disabledStyle, selectedBeforeDisabledClick, selectedAfterDisabledClick }));
  }
  await disabledProbe.evaluate(button => { button.disabled = false; });

  // Desktop hover stays in the existing gray palette; no hover border/ring.
  const hoverTarget = page.locator('.filter-nav-scroller [data-filter]:not(.active)').first();
  await hoverTarget.hover();
  const hasFineHover = await hoverTarget.evaluate(
    () => matchMedia('(hover: hover) and (pointer: fine)').matches
  );
  if (hasFineHover) {
    // Wait for the intended 220ms CSS transition rather than sampling the
    // transparent starting frame immediately after Playwright moves the mouse.
    await page.waitForFunction(() => {
      const target = document.querySelector('.filter-nav-scroller [data-filter]:not(.active)');
      return !!target && target.matches('.tab-btn:hover:not(.active):not([aria-pressed="true"])') &&
        getComputedStyle(target).backgroundColor === 'rgba(255, 255, 255, 0.12)';
    }, null, { timeout: 700 });
  }
  const hoverStyle = await hoverTarget.evaluate(el => ({
    background: getComputedStyle(el).backgroundColor,
    borderColor: getComputedStyle(el).borderTopColor,
    outline: getComputedStyle(el).outlineStyle,
    shadow: getComputedStyle(el).boxShadow,
    hoverCapable: matchMedia('(hover: hover) and (pointer: fine)').matches,
    isHovered: el.matches(':hover'),
    className: el.className,
    pressed: el.getAttribute('aria-pressed'),
    inlineBackground: el.style.backgroundColor,
    hoverSelectorMatches: el.matches('.tab-btn:hover:not(.active):not([aria-pressed="true"])')
  }));
  const hoverBackgroundValid = hoverStyle.hoverCapable
    ? /^rgba\(255, 255, 255, 0\.12\)$/.test(hoverStyle.background)
    : hoverStyle.background === 'rgba(0, 0, 0, 0)' || hoverStyle.background === 'transparent';
  if (hoverStyle.outline !== 'none' || hoverStyle.shadow !== 'none' ||
      hoverStyle.borderColor !== 'rgba(0, 0, 0, 0)' || !hoverBackgroundValid) {
    throw new Error(label + ' filter hover outline/palette contract failed for ' +
      (hoverStyle.hoverCapable ? 'fine-pointer desktop' : 'coarse-pointer touch') + ': ' + JSON.stringify(hoverStyle));
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(180);
  const reduced = await page.evaluate(() => ({
    reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
    snap: getComputedStyle(document.querySelector('.filter-nav-scroller')).scrollSnapType
  }));
  if (!reduced.reduce || reduced.snap !== 'none') {
    throw new Error(label + ' reduced-motion preference did not disable snap animation: ' + JSON.stringify(reduced));
  }
  await page.locator('.filter-nav-scroller [data-filter]:not([data-filter="all"])').first().click();
  await page.waitForFunction(() => {
    const scroller = document.querySelector('.filter-nav-scroller');
    const active = scroller?.querySelector('.filter-btn.active, .tab-btn.active');
    const scrollerRect = scroller?.getBoundingClientRect();
    const activeRect = active?.getBoundingClientRect();
    return !!scrollerRect && !!activeRect && (
      Math.abs(activeRect.left + activeRect.width / 2 - (scrollerRect.left + scroller.clientWidth / 2)) <= 2 ||
      (activeRect.left >= scrollerRect.left + 8 && activeRect.right <= scrollerRect.right - 8)
      );
  }, null, { timeout: 1500 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Arrow-key navigation must move through the button group with a visible
  // keyboard focus ring while retaining a single aria-pressed active filter.
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(160);
  await page.locator('.filter-nav-scroller [data-filter]').first().focus();
  await page.keyboard.press('ArrowRight');
  const filterKeyboardFocus = await page.evaluate(() => {
    const focused = document.activeElement;
    return {
      isFilter: !!focused?.matches?.('.filter-nav-scroller [data-filter]'),
      focusVisible: !!focused?.matches?.(':focus-visible'),
      focusRing: focused ? getComputedStyle(focused).boxShadow : 'none',
      pressedCount: document.querySelectorAll('.filter-nav-scroller [aria-pressed="true"]').length
    };
  });
  if (!filterKeyboardFocus.isFilter || !filterKeyboardFocus.focusVisible ||
      filterKeyboardFocus.focusRing === 'none' || filterKeyboardFocus.pressedCount !== 1) {
    throw new Error(label + ' filter buttons lost keyboard focus visibility or pressed state: ' +
      JSON.stringify(filterKeyboardFocus));
  }

  // Keyboard focus must be visible; pointer activation must not leave a ghost plate.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(180);
  // Start on the immediately following navigation link, then traverse backward
  // with the keyboard. This tests real keyboard-origin :focus-visible without
  // depending on Chromium's previous sequential-focus starting point after blur.
  const firstNavLink = page.locator('.nav-links a[href]').first();
  await firstNavLink.focus();
  await page.keyboard.press('Shift+Tab');
  const logoFocusedByKeyboard = await page.locator('.nav-logo')
    .evaluate(el => el === document.activeElement);
  const keyboardLogo = await page.locator('.nav-logo').evaluate(el => ({
    focused: el === document.activeElement,
    focusVisible: el.matches(':focus-visible'),
    boxShadow: getComputedStyle(el).boxShadow
  }));
  if (!logoFocusedByKeyboard || !keyboardLogo.focusVisible || keyboardLogo.boxShadow === 'none') {
    throw new Error(label + ' keyboard navigation lost the logo focus indicator: ' + JSON.stringify(keyboardLogo));
  }
  await page.locator('.nav-logo').click();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(360);
  const pointerLogo = await page.locator('.nav-logo').evaluate(el => ({
    pointerFocused: el.classList.contains('is-pointer-focused'),
    focused: el === document.activeElement,
    boxShadow: getComputedStyle(el).boxShadow,
    outlineStyle: getComputedStyle(el).outlineStyle
  }));
  if (pointerLogo.pointerFocused || pointerLogo.focused || pointerLogo.boxShadow !== 'none' || pointerLogo.outlineStyle !== 'none') {
    throw new Error(label + ' pointer activation left the logo ghost focus plate visible: ' + JSON.stringify(pointerLogo));
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
  await page.waitForFunction(() => {
    const button = document.querySelector('.hamburger');
    const menu = document.querySelector('.nav-links');
    return button?.classList.contains('is-open') &&
      button.querySelectorAll('.hamburger-icon span').length === 3 &&
      menu?.classList.contains('active') && menu.classList.contains('is-open');
  }, null, { timeout: 1500 });
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
  const closing = await menu.evaluate(el => el.classList.contains('is-closing'));
  const collapsed = await button.getAttribute('aria-expanded');
  const reducedMotion = await page.evaluate(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  if ((!reducedMotion && !closing) || collapsed !== 'false' ||
      await button.evaluate(el => el.classList.contains('is-open'))) {
    throw new Error(label + ' mobile navigation did not begin closing from an outside tap.');
  }
  await page.waitForFunction(() => {
    const menu = document.querySelector('.nav-links');
    return !menu?.classList.contains('active') && !menu?.classList.contains('is-open') &&
      !document.body.classList.contains('menu-open');
  }, null, { timeout: 1500 });

  // Regression guard: a closed mobile Works dropdown must not retain an
  // interactive/visible hit surface over the document. Previously its nested
  // dropdown rules overrode the parent's pointer-events:none and intercepted
  // arbitrary page taps as navigation.
  const closedMenuContract = await menu.evaluate(el => {
    const style = getComputedStyle(el);
    return {
      maxHeight: style.maxHeight,
      opacity: style.opacity,
      visibility: style.visibility,
      pointerEvents: style.pointerEvents,
      dropdownCount: el.querySelectorAll('.nav-dropdown-menu, .nav-item-dropdown, .nav-dropdown-toggle').length
    };
  });
  if (
    closedMenuContract.maxHeight !== '0px' ||
    closedMenuContract.opacity !== '0' ||
    closedMenuContract.visibility !== 'hidden' ||
    closedMenuContract.pointerEvents !== 'none' ||
    closedMenuContract.dropdownCount !== 0
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
        label + ' clicking ordinary hero/background content unexpectedly triggered navigation: ' +
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
        label + ' ordinary page surface unexpectedly triggered navigation: ' +
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
    return {
      maxHeight: style.maxHeight,
      opacity: style.opacity,
      visibility: style.visibility,
      pointerEvents: style.pointerEvents,
      dropdownCount: el.querySelectorAll('.nav-dropdown-menu, .nav-item-dropdown, .nav-dropdown-toggle').length
    };
  });
  if (
    finalClosedContract.maxHeight !== '0px' ||
    finalClosedContract.opacity !== '0' ||
    finalClosedContract.visibility !== 'hidden' ||
    finalClosedContract.pointerEvents !== 'none' ||
    finalClosedContract.dropdownCount !== 0
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
        // Prior synthetic pointer tests can leave the foil easing toward center.
        // Start the native-scroll probe from a settled baseline so an unrelated
        // recovery animation cannot make the gesture assertion fail.
        await holographic.dispatchEvent('pointerleave');
        await page.waitForFunction(() => {
          const el = document.querySelector('#lightboxMediaContainer .lightbox-holographic');
          if (!el) return false;
          const x = Number.parseFloat(el.style.getPropertyValue('--holo-x'));
          const y = Number.parseFloat(el.style.getPropertyValue('--holo-y'));
          return Number.isFinite(x) && Number.isFinite(y) &&
            Math.abs(x - 50) < 0.25 && Math.abs(y - 50) < 0.25;
        }, null, { timeout: 1500 });
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
            Math.abs(quickFoilX - 50) > 1.5 ||
            Math.abs(quickFoilY - 50) > 1.5) {
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
            !cosmosMaterial.bottom.mask.includes('cosmos-bottom.webp') ||
            !cosmosMaterial.bottom.maskMode.includes('luminance') ||
            !cosmosMaterial.middle.background.includes('conic-gradient') ||
            !cosmosMaterial.middle.mask.includes('cosmos-middle-trans.webp') ||
            !cosmosMaterial.middle.maskMode.includes('luminance') ||
            !cosmosMaterial.top.background.includes('conic-gradient') ||
            !cosmosMaterial.top.mask.includes('cosmos-top-trans.webp') ||
            !cosmosMaterial.top.maskMode.includes('luminance') ||
            !cosmosMaterial.grain.includes('grain.webp') ||
            cosmosMaterial.layerNames.indexOf('cosmos-bottom') < 0 ||
            cosmosMaterial.layerNames.indexOf('cosmos-middle') <= cosmosMaterial.layerNames.indexOf('cosmos-bottom') ||
            cosmosMaterial.layerNames.indexOf('cosmos-top') <= cosmosMaterial.layerNames.indexOf('cosmos-middle')) {
          throw new Error('Cosmos renderer profile must apply each grayscale texture as its own luminance mask over an ordered spectral layer: ' + JSON.stringify(cosmosMaterial));
        }
        for (const asset of ['cosmos-bottom.webp', 'cosmos-middle-trans.webp', 'cosmos-top-trans.webp']) {
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
      const foilFinishContract = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#lightboxMediaContainer .lightbox-holographic')).map(surface => ({
          caption: surface.closest('.lightbox-media-item')?.querySelector('.media-caption')?.textContent?.trim() || '',
          style: surface.dataset.holoStyle || '',
          spectrum: getComputedStyle(surface.querySelector('.lightbox-holographic-front .lightbox-holographic-spectrum')).backgroundImage
        }))
      );
      const expectedFoilFinishes = [
        ['Smooth Prism Foil', 'holographic'],
        ['Fine Brush Foil', 'brushed'],
        ['Vertical Light Beams', 'beams'],
        ['Crosshatch Foil', 'crosshatch'],
        ['Shattered Ice', 'shattered'],
        ['Cosmos Galaxy Foil', 'cosmos'],
        ['Water Waves', 'waves'],
        ['Cat-Eye Lens', 'cat-eye'],
        ['Pearlescent Foil', 'iridescent'],
        ['Aurora Gradient', 'aurora']
      ];
      const missingFoilFinishes = expectedFoilFinishes.filter(([caption, style]) =>
        !foilFinishContract.some(record => record.caption === caption && record.style === style)
      );
      const profileByStyle = new Map();
      const conflictingStyleProfiles = new Set();
      for (const record of foilFinishContract) {
        if (!record.style || !record.spectrum) continue;
        if (profileByStyle.has(record.style) && profileByStyle.get(record.style) !== record.spectrum) {
          conflictingStyleProfiles.add(record.style);
        } else {
          profileByStyle.set(record.style, record.spectrum);
        }
      }
      const expectedFoilProfiles = new Set(expectedFoilFinishes.map(([caption, style]) =>
        foilFinishContract.find(record => record.caption === caption && record.style === style)?.spectrum || ''
      ).filter(Boolean));
      if (missingFoilFinishes.length > 0 ||
          expectedFoilProfiles.size !== expectedFoilFinishes.length ||
          conflictingStyleProfiles.size > 0) {
        throw new Error('Each named holographic finish must retain its expected style and distinct CSS profile: ' +
          JSON.stringify({
            records: foilFinishContract,
            missing: missingFoilFinishes,
            distinctProfiles: expectedFoilProfiles.size,
            conflictingStyles: [...conflictingStyleProfiles]
          }));
      }

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
      const usesFrontAsBack = uploadedArtContract.backSrc === uploadedArtContract.src;
      if (!uploadedArtContract.src.includes('funko-pop-sticker/') ||
          uploadedArtContract.naturalWidth < 100 ||
          uploadedArtContract.naturalHeight < 100 ||
          Math.abs(uploadedArtContract.naturalRatio - uploadedArtContract.slotRatio) > .015 ||
          uploadedArtContract.alphaMode !== 'alpha' ||
          !uploadedArtContract.alphaMask.includes('funko-pop-sticker/') ||
          uploadedArtContract.alphaMask.includes('%2520') ||
          !uploadedArtContract.hasDiffraction || !uploadedArtContract.hasSparkles ||
          uploadedArtContract.defaultBackMirrored !== usesFrontAsBack ||
          !uploadedArtContract.backSrc.includes('funko-pop-sticker/') ||
          !uploadedArtContract.centeredHint || !uploadedArtContract.hintAfterArtwork || !uploadedArtContract.hintBeforeCaption ||
          !uploadedArtContract.desktopActionText.includes('CLICK / MOVE') ||
          uploadedArtContract.desktopActionDisplay === 'none' ||
          uploadedArtContract.surfaceIdleAnimation !== 'holo-idle-float' ||
          uploadedArtContract.sheenDisplay === 'none' ||
          !uploadedArtContract.sheenAnimation.includes('holo-idle-sheen')) {
        throw new Error('Holographic artwork must preserve transparent sizing, use its configured back-face behavior, and retain all interaction hints: ' + JSON.stringify(uploadedArtContract));
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

      // Inspect must be layered over the existing Lightbox scroll position,
      // not trigger anchor reconciliation when the foil card is moved to body.
      const lightboxScrollHost = page.locator('#lightbox').first();
      const artworkGroupItems = page.locator('#lightboxMediaContainer .lightbox-artwork-group-items').first();
      await funkoHolo.scrollIntoViewIfNeeded();
      await funkoHolo.hover();
      await page.waitForTimeout(650); // let staggered card and hover transforms settle
      const readArtworkGroupLayout = () => artworkGroupItems.evaluate(items => ({
        layout: items.closest('.lightbox-artwork-group')?.dataset.artworkEffectiveLayout || '',
        width: items.clientWidth,
        children: Array.from(items.children).map((el, index) => {
          const rect = el.getBoundingClientRect();
          return {
            index,
            placeholder: el.classList.contains('lightbox-inspect-placeholder'),
            caption: el.querySelector('.media-caption')?.textContent?.trim() || '',
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
          };
        })
      }));
      const groupBeforeInspect = await readArtworkGroupLayout();
      const targetGroupIndex = groupBeforeInspect.children.findIndex(child => child.caption === 'Smooth Prism Foil');
      if (targetGroupIndex < 0 || groupBeforeInspect.children.length < 2) {
        throw new Error('Holographic Inspector regression fixture must have multiple grouped artwork items: ' +
          JSON.stringify(groupBeforeInspect));
      }
      const lightboxScrollBeforeInspect = await lightboxScrollHost.evaluate(el => el.scrollTop);
      // A tap on grouped artwork opens the full-screen Inspector without
      // consuming the same tap as a foil flip. The following real pointer click
      // inside Inspect must still flip the foil to its mirrored reverse.
      await funkoHolo.click({ force: true });
      const inspectMode = page.locator('.lightbox-inspect-mode');
      await inspectMode.waitFor({ state: 'visible', timeout: 2000 });
      const inspectedHolo = inspectMode.locator('.lightbox-holographic').first();
      await inspectedHolo.waitFor({ state: 'visible', timeout: 2000 });
      await page.waitForTimeout(500); // let the card-to-viewport transition settle
      const groupDuringInspect = await readArtworkGroupLayout();
      if (groupDuringInspect.layout !== groupBeforeInspect.layout ||
          groupDuringInspect.width !== groupBeforeInspect.width ||
          groupDuringInspect.children.length !== groupBeforeInspect.children.length) {
        throw new Error('Opening Inspect changed the artwork group layout or child count: ' +
          JSON.stringify({ before: groupBeforeInspect, during: groupDuringInspect }));
      }
      for (let i = 0; i < groupBeforeInspect.children.length; i += 1) {
        const before = groupBeforeInspect.children[i];
        const during = groupDuringInspect.children[i];
        const target = i === targetGroupIndex;
        if (target ? !during.placeholder : (during.placeholder || during.caption !== before.caption)) {
          throw new Error('Inspect did not preserve the original grouped artwork order: ' +
            JSON.stringify({ index: i, before, during }));
        }
        for (const coordinate of ['left', 'top', 'width', 'height']) {
          if (Math.abs(before[coordinate] - during[coordinate]) > 2) {
            throw new Error('Opening Inspect reflowed grouped artwork (' + coordinate + ' changed): ' +
              JSON.stringify({ index: i, before, during, groupLayout: groupBeforeInspect.layout }));
          }
        }
      }
      const lightboxScrollAfterInspect = await lightboxScrollHost.evaluate(el => el.scrollTop);
      if (Math.abs(lightboxScrollAfterInspect - lightboxScrollBeforeInspect) > 1) {
        throw new Error('Opening foil Inspect changed the Lightbox scroll position: ' +
          JSON.stringify({ before: lightboxScrollBeforeInspect, after: lightboxScrollAfterInspect }));
      }
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
        const modal = document.querySelector('#lightbox');
        const controls = document.querySelector('.lightbox-controls');
        const stage = overlay.querySelector('.lightbox-inspect-stage');
        const artwork = overlay.querySelector('.lightbox-artwork');
        const stageRect = stage?.getBoundingClientRect();
        const artworkRect = artwork?.getBoundingClientRect();
        const back = overlay.querySelector('.lightbox-inspect-back');
        const description = overlay.querySelector('.lightbox-inspect-description');
        const hint = overlay.querySelector('.lightbox-holographic-hint');
        const face = hint?.querySelector('[data-holo-face-label]')?.textContent?.trim() || '';
        const action = hint?.querySelector('.lightbox-holographic-desktop-action')?.textContent?.trim() || '';
        const backStyle = back ? getComputedStyle(back) : null;
        const artworkFitsStage = Boolean(stageRect && artworkRect &&
          artworkRect.width > 0 && artworkRect.height > 0 &&
          artworkRect.left >= stageRect.left - 1 &&
          artworkRect.top >= stageRect.top - 1 &&
          artworkRect.right <= stageRect.right + 1 &&
          artworkRect.bottom <= stageRect.bottom + 1);
        return {
          modalZ: Number.parseInt(getComputedStyle(modal).zIndex, 10),
          controlsZ: Number.parseInt(getComputedStyle(controls).zIndex, 10),
          overlayZ: Number.parseInt(getComputedStyle(overlay).zIndex, 10),
          stageOverflow: getComputedStyle(stage).overflow,
          artworkFitsStage,
          description: description?.textContent?.trim() || '',
          projectDescriptionLeaked: (description?.textContent || '').includes('this is a funko pop in 2d'),
          hasDuplicateTitle: Boolean(overlay.querySelector('.lightbox-inspect-title')),
          hintDisplay: hint ? getComputedStyle(hint).display : 'missing',
          hintInFooter: Boolean(hint && hint.parentElement?.classList.contains('lightbox-inspect-footer')),
          hintBeforeDescription: Boolean(hint && description && hint.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING),
          face,
          action,
          backIcon: Boolean(back?.querySelector('i.fa-arrow-left')),
          backLabel: back?.getAttribute('aria-label') || '',
          backWidth: Number.parseFloat(backStyle?.width || '0'),
          backHeight: Number.parseFloat(backStyle?.height || '0'),
          backRadius: backStyle?.borderRadius || ''
        };
      });
      if (!(inspectorPresentation.modalZ < inspectorPresentation.controlsZ &&
            inspectorPresentation.controlsZ < inspectorPresentation.overlayZ) ||
          inspectorPresentation.stageOverflow === 'hidden' ||
          !inspectorPresentation.artworkFitsStage ||
          inspectorPresentation.description !== 'Smooth Prism Foil' ||
          inspectorPresentation.projectDescriptionLeaked ||
          inspectorPresentation.hasDuplicateTitle ||
          inspectorPresentation.hintDisplay === 'missing' ||
          inspectorPresentation.hintDisplay === 'none' ||
          !inspectorPresentation.hintInFooter ||
          !inspectorPresentation.hintBeforeDescription ||
          inspectorPresentation.face !== 'FRONT' ||
          inspectorPresentation.action !== 'CLICK / MOVE' ||
          !inspectorPresentation.backIcon ||
          !inspectorPresentation.backLabel ||
          inspectorPresentation.backWidth < 44 ||
          inspectorPresentation.backHeight < 44 ||
          inspectorPresentation.backRadius !== '50%') {
        throw new Error('Inspector safe-fit/layer/caption/hint/back-button contract failed: ' + JSON.stringify(inspectorPresentation));
      }
      if (await inspectedHolo.evaluate(el => el.classList.contains('is-flipped'))) {
        throw new Error('Opening grouped Inspect should not also flip the foil on the same click.');
      }
      await inspectedHolo.click({ force: true });
      if (!(await inspectedHolo.evaluate(el => el.classList.contains('is-flipped')))) {
        throw new Error('Inspected artwork did not flip to its default mirrored reverse inside Inspect.');
      }
      const inspectedFace = await inspectMode.locator('.lightbox-holographic-hint [data-holo-face-label]').textContent();
      if ((inspectedFace || '').trim() !== 'BACK') {
        throw new Error('The native foil hint did not switch from FRONT to BACK after flipping inside Inspect.');
      }
      // Keep handles to the actual foil surface and sibling face label across
      // Inspector teardown. These are the stateful nodes whose reset matters.
      const flippedSurfaceHandle = await inspectedHolo.elementHandle();
      const flippedFaceLabelHandle = await inspectMode
        .locator('.lightbox-holographic-hint [data-holo-face-label]')
        .elementHandle();

      // Escape must exit Inspect and reset the artwork instead of leaving it on BACK.
      await page.keyboard.press('Escape');
      await inspectMode.waitFor({ state: 'detached', timeout: 2000 });
      await page.waitForTimeout(50);
      const escapeExitState = await flippedSurfaceHandle.evaluate(el => ({
        flipped: el.classList.contains('is-flipped'),
        pressed: el.getAttribute('aria-pressed')
      }));
      escapeExitState.face = await flippedFaceLabelHandle.evaluate(el => el.textContent?.trim() || '');
      if (escapeExitState.flipped || escapeExitState.pressed !== 'false' || escapeExitState.face !== 'FRONT') {
        throw new Error('Escape did not reset Inspect artwork to FRONT: ' + JSON.stringify(escapeExitState));
      }
      const escapeFocusState = await page.evaluate(() => {
        const target = document.activeElement;
        const style = target ? getComputedStyle(target) : null;
        return {
          returnsToGroupItem: Boolean(target?.classList.contains('is-grouped-artwork-interactive')),
          suppressClass: Boolean(target?.classList.contains('is-inspect-focus-return')),
          outlineStyle: style?.outlineStyle || '',
          boxShadow: style?.boxShadow || ''
        };
      });
      if (!escapeFocusState.returnsToGroupItem || !escapeFocusState.suppressClass ||
          escapeFocusState.outlineStyle !== 'none' || escapeFocusState.boxShadow !== 'none') {
        throw new Error('Escape left an unexpected artwork focus outline: ' + JSON.stringify(escapeFocusState));
      }
      const lightboxScrollAfterEscape = await lightboxScrollHost.evaluate(el => el.scrollTop);
      if (Math.abs(lightboxScrollAfterEscape - lightboxScrollBeforeInspect) > 1) {
        throw new Error('Escape from foil Inspect changed Lightbox scroll: ' +
          JSON.stringify({ before: lightboxScrollBeforeInspect, after: lightboxScrollAfterEscape }));
      }

      // Reopen from the group, flip again, then activate Inspect Back with
      // the keyboard. Both keyboard exit paths must reset to FRONT.
      await funkoHolo.click({ force: true });
      await inspectMode.waitFor({ state: 'visible', timeout: 2000 });
      await inspectedHolo.waitFor({ state: 'visible', timeout: 2000 });
      await page.waitForTimeout(500);
      const reopenedFace = await inspectMode.locator('.lightbox-holographic-hint [data-holo-face-label]').textContent();
      if ((reopenedFace || '').trim() !== 'FRONT' ||
          await inspectedHolo.evaluate(el => el.classList.contains('is-flipped'))) {
        throw new Error('Reopened Inspect did not start on FRONT.');
      }
      await inspectedHolo.click({ force: true });
      const secondFlipState = await inspectedHolo.evaluate(el => ({
        flipped: el.classList.contains('is-flipped'),
        pressed: el.getAttribute('aria-pressed')
      }));
      const secondFlipFace = await inspectMode.locator('.lightbox-holographic-hint [data-holo-face-label]').textContent();
      if (!secondFlipState.flipped || secondFlipState.pressed !== 'true' || (secondFlipFace || '').trim() !== 'BACK') {
        throw new Error('Foil could not flip to BACK before the keyboard Back test.');
      }
      await page.keyboard.press('Tab');
      const inspectorBackFocused = await page.evaluate(() => document.activeElement?.matches('.lightbox-inspect-back') || false);
      if (!inspectorBackFocused) throw new Error('Keyboard focus did not reach the Inspector Back control.');
      await page.keyboard.press('Enter');
      await inspectMode.waitFor({ state: 'detached', timeout: 2000 });
      await page.waitForTimeout(50);
      const backExitState = await flippedSurfaceHandle.evaluate(el => ({
        flipped: el.classList.contains('is-flipped'),
        pressed: el.getAttribute('aria-pressed')
      }));
      backExitState.face = await flippedFaceLabelHandle.evaluate(el => el.textContent?.trim() || '');
      if (backExitState.flipped || backExitState.pressed !== 'false' || backExitState.face !== 'FRONT') {
        throw new Error('Keyboard activation of Inspector Back did not reset artwork to FRONT: ' + JSON.stringify(backExitState));
      }
      const backFocusState = await page.evaluate(() => {
        const target = document.activeElement;
        const style = target ? getComputedStyle(target) : null;
        return {
          returnsToGroupItem: Boolean(target?.classList.contains('is-grouped-artwork-interactive')),
          suppressClass: Boolean(target?.classList.contains('is-inspect-focus-return')),
          outlineStyle: style?.outlineStyle || '',
          boxShadow: style?.boxShadow || ''
        };
      });
      if (!backFocusState.returnsToGroupItem || !backFocusState.suppressClass ||
          backFocusState.outlineStyle !== 'none' || backFocusState.boxShadow !== 'none') {
        throw new Error('Keyboard Back left an unexpected artwork focus outline: ' + JSON.stringify(backFocusState));
      }
      const lightboxScrollAfterBack = await lightboxScrollHost.evaluate(el => el.scrollTop);
      if (Math.abs(lightboxScrollAfterBack - lightboxScrollBeforeInspect) > 1) {
        throw new Error('Keyboard Back changed Lightbox scroll: ' +
          JSON.stringify({ before: lightboxScrollBeforeInspect, after: lightboxScrollAfterBack }));
      }

      // The Lightbox must remain closable after either keyboard Inspector exit.
      await page.locator('#lightboxClose').first().click();
      await page.locator('#lightbox.active').waitFor({ state: 'detached', timeout: 2000 });
      const disposedFoilState = await flippedSurfaceHandle.evaluate(el => ({
        flipped: el.classList.contains('is-flipped'),
        pressed: el.getAttribute('aria-pressed')
      }));
      disposedFoilState.face = await flippedFaceLabelHandle.evaluate(el => el.textContent?.trim() || '');
      if (disposedFoilState.flipped || disposedFoilState.pressed !== 'false' || disposedFoilState.face !== 'FRONT') {
        throw new Error('Closing the Lightbox did not reset the foil state to FRONT: ' + JSON.stringify(disposedFoilState));
      }
    }, { width: 1280, height: 900 });

    await smokePage(browser, '/', async page => {
      await page.waitForFunction(() => {
        const hero = document.querySelector('#heroQuote');
        const heroText = document.querySelector('#heroQuoteText')?.textContent?.trim();
        const footerText = document.querySelector('footer .footer-hero-message .hero-quote-text')?.textContent?.trim();
        return hero?.classList.contains('is-ready') && heroText && footerText;
      }, null, { timeout: 12000 });

      const readQuoteState = () => page.evaluate(() => {
        const alpha = color => {
          const match = String(color || '').match(/rgba?\([^)]*,\s*([\d.]+)\s*\)$/);
          return match ? Number(match[1]) : 0;
        };
        const hero = document.querySelector('#heroQuote');
        const footerQuote = document.querySelector('footer .footer-hero-message');
        const content = document.querySelector('footer .footer-content');
        return {
          heroText: document.querySelector('#heroQuoteText')?.textContent?.trim() || '',
          footerText: footerQuote?.querySelector('.hero-quote-text')?.textContent?.trim() || '',
          heroIndex: localStorage.getItem('lm:lastHeroMessage'),
          footerIndex: localStorage.getItem('lm:lastFooterMessage'),
          heroBackgroundAlpha: alpha(getComputedStyle(hero).backgroundColor),
          heroBorderTopWidth: parseFloat(getComputedStyle(hero).borderTopWidth) || 0,
          footerQuoteBackgroundAlpha: alpha(getComputedStyle(footerQuote).backgroundColor),
          footerQuoteBorderTopWidth: parseFloat(getComputedStyle(footerQuote).borderTopWidth) || 0,
          footerContentAlpha: alpha(getComputedStyle(content).backgroundColor),
          footerSlideCount: document.querySelectorAll('footer .footer-animation-slide').length,
          footerActiveSlideCount: document.querySelectorAll('footer .footer-animation-slide.active').length
        };
      });

      const first = await readQuoteState();
      if (!first.heroText || !first.footerText || first.heroIndex === null || first.footerIndex === null) {
        throw new Error('Hero/footer messages did not render and persist their random selections: ' + JSON.stringify(first));
      }
      if (first.heroBackgroundAlpha > 0.01 || first.heroBorderTopWidth > 0 ||
          first.footerQuoteBackgroundAlpha > 0.01 || first.footerQuoteBorderTopWidth > 0) {
        throw new Error('Hero and footer quote wrappers must stay transparent and borderless: ' + JSON.stringify(first));
      }
      if (first.footerContentAlpha < 0.1) {
        throw new Error('Footer content scrim was not enabled with the footer quote: ' + JSON.stringify(first));
      }
      if (first.footerSlideCount < 1 || first.footerActiveSlideCount !== 1) {
        throw new Error('Footer loop did not render one active artwork slide while its quote was enabled: ' + JSON.stringify(first));
      }

      // The overridden short auto-rotate value ensures text stays fixed even
      // after several cycles would previously have elapsed.
      await page.waitForTimeout(1800);
      const held = await readQuoteState();
      if (held.heroText !== first.heroText || held.footerText !== first.footerText ||
          held.heroIndex !== first.heroIndex || held.footerIndex !== first.footerIndex) {
        throw new Error('Hero/footer quote changed without a page refresh: ' + JSON.stringify({ first, held }));
      }

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForFunction(() => {
        const hero = document.querySelector('#heroQuote');
        const heroText = document.querySelector('#heroQuoteText')?.textContent?.trim();
        const footerText = document.querySelector('footer .footer-hero-message .hero-quote-text')?.textContent?.trim();
        return hero?.classList.contains('is-ready') && heroText && footerText;
      }, null, { timeout: 12000 });
      const refreshed = await readQuoteState();
      if (refreshed.heroIndex === first.heroIndex || refreshed.footerIndex === first.footerIndex) {
        throw new Error('Hero/footer messages did not choose new random entries after refresh: ' + JSON.stringify({ first, refreshed }));
      }
      await assertWorksHeroGalleryResponsive(page, true, 'Hero Message enabled');
      await page.waitForFunction(() => {
        const stage = document.getElementById('footerAnimation');
        return stage &&
          stage.style.getPropertyValue('--footer-kenburns-from') &&
          stage.style.getPropertyValue('--footer-kenburns-to') &&
          stage.style.getPropertyValue('--footer-kenburns-duration');
      }, null, { timeout: 5000 });
      const footerTiming = await page.locator('#footerAnimation').evaluate(stage => ({
        from: Number(stage.style.getPropertyValue('--footer-kenburns-from')),
        to: Number(stage.style.getPropertyValue('--footer-kenburns-to')),
        duration: stage.style.getPropertyValue('--footer-kenburns-duration')
      }));
      if (Math.abs(footerTiming.from - 1.23) > 0.001 ||
          Math.abs(footerTiming.to - 1.34) > 0.001 ||
          footerTiming.duration !== '8s') {
        throw new Error('CMS heroTiming Ken Burns values were not synchronized into the footer renderer: ' + JSON.stringify(footerTiming));
      }
    }, { width: 1280, height: 900 }, async page => {
      await page.route('**/data/settings.json*', async route => {
        const response = await route.fetch();
        const settings = await response.json();
        settings.showHeroMessage = true;
        settings.showFooterMessage = true;
        settings.heroTiming = { ...(settings.heroTiming || {}), autoRotateMs: 650, kenBurnsFromScale: 1.23, kenBurnsToScale: 1.34, kenBurnsDurationS: 8 };
        await route.fulfill({ response, body: JSON.stringify(settings) });
      });
    });

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

      const heroTransformContract = await page.locator('#heroBanner .slide').first().evaluate(slide => {
        const media = slide.querySelector('img, video, lottie-player');
        return {
          zoom: media?.style.getPropertyValue('--thumb-zoom').trim() || '',
          rotate: media?.style.getPropertyValue('--thumb-rotate').trim() || ''
        };
      });
      if (!heroTransformContract.zoom || !heroTransformContract.rotate) {
        throw new Error('Hero media is missing the CSS zoom/rotation variables consumed by the live hero styles.');
      }

      const heroKenBurnsContract = await page.evaluate(() => {
        for (const sheet of Array.from(document.styleSheets)) {
          try {
            for (const rule of Array.from(sheet.cssRules || [])) {
              if (rule.type !== (window.CSSRule?.KEYFRAMES_RULE ?? 7) || rule.name !== 'hero-kenburns') continue;
              const transforms = Array.from(rule.cssRules || []).map(frame => frame.style?.getPropertyValue('transform') || '');
              return transforms.length > 0 && transforms.every(value => value.includes('var(--thumb-zoom') && value.includes('var(--thumb-rotate'));
            }
          } catch (_) {}
        }
        return false;
      });
      if (!heroKenBurnsContract) {
        throw new Error('Hero Ken Burns keyframes override the CMS-configured zoom/rotation values.');
      }

      const messageSettings = await page.evaluate(async () => {
        try {
          const response = await fetch('/data/settings.json');
          return response.ok ? await response.json() : {};
        } catch (_) { return {}; }
      });
      const heroText = await page.locator('#heroQuoteText').textContent().catch(() => '');
      const heroMessageHidden = await page.locator('#heroQuote').isHidden().catch(() => false);
      if (messageSettings.showHeroMessage !== false && !heroText?.trim()) {
        throw new Error('Works Hero rendered no message text while showHeroMessage is enabled.');
      }
      if (messageSettings.showHeroMessage === false && !heroMessageHidden) {
        throw new Error('Works Hero message should be hidden while showHeroMessage is disabled.');
      }
      const heroMessageLayout = await page.locator('#heroQuote').evaluate(el => {
        const style = getComputedStyle(el);
        const match = style.backgroundColor.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)$/);
        const heroSection = el.closest('.hero-section');
        const banner = heroSection?.querySelector('.hero-banner');
        const overlay = banner ? getComputedStyle(banner, '::after') : null;
        const activeSlide = banner?.querySelector('.slide.active');
        return {
          backgroundAlpha: match ? Number(match[1]) : 0,
          borderTopWidth: parseFloat(style.borderTopWidth) || 0,
          paddingTop: parseFloat(style.paddingTop) || 0,
          dynamicSizing: Boolean(heroSection?.classList.contains('hero-section--message')),
          overlayImage: overlay?.backgroundImage || 'none',
          activeArtworkOpacity: activeSlide ? Number.parseFloat(getComputedStyle(activeSlide).opacity) : 0,
          backdropFilter: style.backdropFilter || 'none'
        };
      }).catch(() => ({ backgroundAlpha: 0, paddingTop: 0, dynamicSizing: false }));
      if (heroMessageLayout.backgroundAlpha > 0.01 || heroMessageLayout.borderTopWidth > 0) throw new Error('Works Hero quote must have no background or border.');
      if (heroMessageLayout.paddingTop < 18) throw new Error('Works Hero message group has insufficient vertical padding.');
      if (heroMessageLayout.backdropFilter !== 'none') throw new Error('Works Hero quote panel must not blur the artwork behind it.');
      if (messageSettings.showHeroMessage === false && heroMessageLayout.dynamicSizing) {
        throw new Error('Works Hero should not retain message-driven sizing while its message is disabled.');
      }
      if (messageSettings.showHeroMessage !== false && !heroMessageLayout.dynamicSizing) {
        throw new Error('Works Hero did not enable message-driven sizing with its message.');
      }
      if (messageSettings.showHeroMessage === false &&
          (heroMessageLayout.overlayImage !== 'none' || heroMessageLayout.activeArtworkOpacity < 0.99)) {
        throw new Error('Works Hero artwork should be full-color with no dark overlay while its message is disabled: ' + JSON.stringify(heroMessageLayout));
      }
      if (messageSettings.showHeroMessage !== false &&
          (!heroMessageLayout.overlayImage.includes('linear-gradient') || heroMessageLayout.activeArtworkOpacity > 0.6)) {
        throw new Error('Works Hero must keep its readability overlay when the message is enabled: ' + JSON.stringify(heroMessageLayout));
      }
      await assertWorksHeroGalleryResponsive(
        page,
        messageSettings.showHeroMessage !== false,
        'Works Hero current CMS setting'
      );
      if (messageSettings.showFooterMessage === true) {
        const footerMessage = await page.locator('footer .footer-hero-message .hero-quote-text').textContent().catch(() => '');
        if (!footerMessage?.trim()) throw new Error('Works footer message is missing while showFooterMessage is enabled.');
        const footerPanelAlpha = await page.locator('footer .footer-hero-message').evaluate(el => {
          const match = getComputedStyle(el).backgroundColor.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)$/);
          return match ? Number(match[1]) : 0;
        }).catch(() => 0);
        if (footerPanelAlpha > 0.01) throw new Error('Works footer quote must not paint its own background.');
        const footerMessageLayout = await page.locator('footer .footer-hero-message').evaluate(el => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          const social = el.closest('footer')?.querySelector('.social-icons')?.getBoundingClientRect();
          const footer = el.closest('footer');
          const quoteText = el.querySelector('.hero-quote-text');
          const quoteTextStyle = quoteText ? getComputedStyle(quoteText) : null;
          const footerContent = footer?.querySelector('.footer-content');
          const footerContentStyle = footerContent ? getComputedStyle(footerContent) : null;
          const footerContentAlphaMatch = footerContentStyle?.backgroundColor.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)$/);
          return {
            textAlign: style.textAlign,
            quoteTextAlign: quoteTextStyle?.textAlign || '',
            quoteTextMarginBottom: parseFloat(quoteTextStyle?.marginBottom || '0') || 0,
            backdropFilter: style.backdropFilter || 'none',
            borderTopWidth: parseFloat(style.borderTopWidth) || 0,
            contentBackgroundAlpha: footerContentAlphaMatch ? Number(footerContentAlphaMatch[1]) : 0,
            animationSlideCount: footer?.querySelectorAll('.footer-animation-slide').length || 0,
            activeAnimationSlideCount: footer?.querySelectorAll('.footer-animation-slide.active').length || 0,
            messageClass: el.classList.contains('hero-quote'),
            marginBottom: parseFloat(style.marginBottom) || 0,
            socialGap: social ? social.top - rect.bottom : 0,
            backdropClass: Boolean(footer?.classList.contains('footer--message-enabled')),
            animationDisplay: footer ? getComputedStyle(footer.querySelector('.footer-animation')).display : 'none',
            fadeDisplay: footer ? getComputedStyle(footer.querySelector('.footer-fade')).display : 'none'
          };
        });
        if (footerMessageLayout.textAlign !== 'left' || footerMessageLayout.quoteTextAlign !== 'left' || footerMessageLayout.quoteTextMarginBottom < 18) {
          throw new Error('Footer quote and its inner text must preserve the hero panel alignment and typography spacing: ' + JSON.stringify(footerMessageLayout));
        }
        if (footerMessageLayout.backdropFilter !== 'none' || !footerMessageLayout.messageClass || footerMessageLayout.borderTopWidth > 0) throw new Error('Footer quote must reuse transparent hero typography without a panel.');
        if (footerMessageLayout.marginBottom < 32 || footerMessageLayout.socialGap < 32) throw new Error('Footer quote needs clear space before the social icon row: ' + JSON.stringify(footerMessageLayout));
        if (footerMessageLayout.contentBackgroundAlpha < 0.1) throw new Error('Footer content must add a translucent black scrim while its message is enabled.');
        if (!footerMessageLayout.backdropClass || footerMessageLayout.animationDisplay === 'none' || footerMessageLayout.fadeDisplay === 'none' || footerMessageLayout.animationSlideCount < 1 || footerMessageLayout.activeAnimationSlideCount !== 1) throw new Error('Footer message should overlay a live looping artwork backdrop.');
      } else {
        const footerBackdrop = await page.locator('footer').evaluate(el => {
          const content = el.querySelector('.footer-content');
          const contentStyle = content ? getComputedStyle(content) : null;
          const alphaMatch = contentStyle?.backgroundColor.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)$/);
          return {
            enabled: el.classList.contains('footer--message-enabled'),
            animationDisplay: getComputedStyle(el.querySelector('.footer-animation')).display,
            fadeDisplay: getComputedStyle(el.querySelector('.footer-fade')).display,
            slideCount: el.querySelectorAll('.footer-animation-slide').length,
            activeSlideCount: el.querySelectorAll('.footer-animation-slide.active').length,
            contentBackgroundAlpha: alphaMatch ? Number(alphaMatch[1]) : 0
          };
        });
        if (footerBackdrop.enabled || footerBackdrop.animationDisplay === 'none' || footerBackdrop.fadeDisplay === 'none' ||
            footerBackdrop.slideCount < 1 || footerBackdrop.activeSlideCount !== 1 || footerBackdrop.contentBackgroundAlpha > 0.01) {
          throw new Error('Footer artwork must keep looping with no quote scrim when the footer message is off: ' + JSON.stringify(footerBackdrop));
        }
      }

      if (heroSlides > 1) {
        await page.waitForTimeout(3800);
        const activeSlides = await page.locator('#heroBanner .slide.active').count();
        if (activeSlides !== 1) throw new Error(`Works Hero loop has invalid active-slide state (found ${activeSlides}).`);
      }

      const allFilter = page.locator('.filter-tabs .filter-btn[data-filter="all"], .filter-tabs .tab-btn[data-filter="all"]');
      if (await allFilter.count() !== 1) throw new Error('Works filter UI is missing the ALL filter.');

      await assertPublicNavigation(page, {
        href: './',
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
      // Carousel centering uses a 280ms glide; wait for ALL to reach the center
      // before taking the baseline so the next visible pill can be clicked like
      // a real visitor would, without Playwright auto-scrolling the document.
      await page.waitForFunction(() => {
        const rail = document.querySelector('.filter-nav-scroller');
        const active = rail?.querySelector('.filter-btn.active, .tab-btn.active');
        const railRect = rail?.getBoundingClientRect();
        const activeRect = active?.getBoundingClientRect();
        return active?.dataset.filter === 'all' && !!railRect && !!activeRect &&
          Math.abs(activeRect.left + activeRect.width / 2 - (railRect.left + rail.clientWidth / 2)) <= 2;
      }, null, { timeout: 1800 });
      // The assertions above concern horizontal carousel motion. Also let any
      // document-level scroll caused by preceding real pointer clicks finish;
      // otherwise the gallery's viewport Y is sampled mid-scroll and falsely
      // reported as a filter-transition layout shift.
      await page.waitForFunction(async () => {
        let previous = window.scrollY;
        let stableSamples = 0;
        for (let sample = 0; sample < 12; sample += 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
          const current = window.scrollY;
          stableSamples = Math.abs(current - previous) <= 0.5 ? stableSamples + 1 : 0;
          if (stableSamples >= 3) return true;
          previous = current;
        }
        return false;
      }, null, { timeout: 2200 });
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
      // This is a geometry-only probe. Move focus with preventScroll before
      // dispatching activation: otherwise the previously focused ALL pill may
      // stay focused while the rail moves it away from center, prompting the
      // browser to scroll the document to keep that old focus target visible.
      // Real desktop pointer and drag behavior is exercised in the responsive
      // filter-navigation smoke test.
      await secondaryFilter.evaluate(button => {
        button.focus({ preventScroll: true });
        button.click();
      });
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

      const modelShell = page.locator('.lightbox-model-viewer').first();
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

      await modelShell.scrollIntoViewIfNeeded();
      const lightboxScrollBefore3DInspect = await page.locator('#lightbox').evaluate(el => el.scrollTop);
      await modelShell.click();
      await page.locator('.lightbox-3d-focus-overlay .lightbox-model-viewer.is-interactive').waitFor({ state: 'visible', timeout: 3000 });

      const modelBack = page.locator('.lightbox-3d-focus-overlay .model-viewer-back').first();
      if (await modelBack.isVisible().catch(() => false) !== true) {
        throw new Error('3D interactive mode did not expose its Back control.');
      }

      try {
        await page.waitForFunction(() => {
          const el = document.querySelector('.lightbox-3d-focus-overlay .lightbox-model-viewer.is-interactive');
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return Math.abs(r.width - innerWidth) <= 2 &&
            Math.abs(r.height - innerHeight) <= 2;
        }, null, { timeout: 1500 });
      } catch (error) {
        const debug = await page.evaluate(() => {
          const el = document.querySelector('.lightbox-3d-focus-overlay .lightbox-model-viewer.is-interactive');
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
      if (Math.abs(focused3DEntryOrigin - lightboxScrollBefore3DInspect) > 1) {
        throw new Error('Entering focused 3D changed the Lightbox scroll position: ' +
          JSON.stringify({ before: lightboxScrollBefore3DInspect, after: focused3DEntryOrigin }));
      }

      const focused3DTouchContract = await page.evaluate(() => {
        const modal = document.querySelector('#lightbox.is-3d-focused');
        const canvas = document.querySelector('.lightbox-3d-focus-overlay .lightbox-model-viewer.is-interactive canvas');
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
        const scrollTopAtFocus = modal.scrollTop;
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
          scrollTopAtFocus,
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
          focused3DScrollContract.overflowY !== 'auto' ||
          focused3DScrollContract.overflowX !== 'hidden' ||
          focused3DScrollContract.touchAction !== 'none' ||
          focused3DScrollContract.overscrollBehavior !== 'none' ||
          Math.abs(focused3DScrollContract.scrollTopAtFocus - lightboxScrollBefore3DInspect) > 1 ||
          Math.abs(focused3DScrollContract.scrollTopBeforeWheel - focused3DScrollContract.scrollTopAtFocus) > 1 ||
          Math.abs(focused3DScrollContract.scrollTopAfterWheel - focused3DScrollContract.scrollTopAtFocus) > 1 ||
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
        const caption = document.querySelector('.lightbox-3d-focus-overlay .is-3d-focus-target .media-caption');
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

      // The viewer focuses its Back control in requestAnimationFrame after
      // activating the interactive mode. Wait for that scheduled accessibility
      // transition instead of sampling document.activeElement before the frame.
      try {
        await page.waitForFunction(() => {
          const back = document.querySelector('.lightbox-3d-focus-overlay .model-viewer-back');
          return !!back && document.activeElement === back;
        }, null, { timeout: 1200 });
      } catch (_) {
        const focusState = await page.evaluate(() => {
          const back = document.querySelector('.lightbox-3d-focus-overlay .model-viewer-back');
          const active = document.activeElement;
          return {
            backExists: !!back,
            backHidden: !!back?.hidden,
            backConnected: !!back?.isConnected,
            activeTag: active?.tagName || '',
            activeId: active?.id || '',
            activeClass: typeof active?.className === 'string' ? active.className : '',
            activeIsBack: !!back && active === back
          };
        });
        throw new Error('3D activation did not move keyboard focus to the Back control after the scheduled focus frame: ' +
          JSON.stringify(focusState));
      }

      // Focused 3D mode must remain viewport-bound when a responsive browser
      // changes dimensions while the viewer is already active. This catches
      // fixed-position/ResizeObserver regressions without altering the grid.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => {
        const el = document.querySelector('.lightbox-3d-focus-overlay .lightbox-model-viewer.is-interactive');
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
        const el = document.querySelector('.lightbox-3d-focus-overlay .lightbox-model-viewer.is-interactive');
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
      const lightboxScrollAfter3DExit = await page.locator('#lightbox').evaluate(el => el.scrollTop);
      if (Math.abs(lightboxScrollAfter3DExit - lightboxScrollBefore3DInspect) > 1) {
        throw new Error('Exiting focused 3D changed the Lightbox scroll position: ' +
          JSON.stringify({ before: lightboxScrollBefore3DInspect, after: lightboxScrollAfter3DExit }));
      }

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
      await page.waitForFunction(() => {
        const el = document.querySelector('#showMoreBtn');
        if (!el || !el.classList.contains('expanded')) return false;
        const style = getComputedStyle(el);
        return (
          style.backgroundColor === 'rgb(255, 255, 255)' &&
          style.color === 'rgb(0, 0, 0)' &&
          style.backdropFilter === 'none'
        );
      }, null, { timeout: 2000 });
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
      // Hero media may take a moment to become decodable; the branded gate
      // intentionally remains visible until that bounded readiness check settles.
      await page.waitForFunction(() => document.querySelector('#pageTransition')?.dataset?.loading === 'ready', null, { timeout: 10000 });
      await transition.waitFor({ state: 'hidden', timeout: 10000 });
      const loadingState = await transition.getAttribute('data-loading');
      if (loadingState !== 'ready' || await transition.isVisible().catch(() => true)) {
        throw new Error('Portfolio loading screen did not hand off cleanly after application readiness.');
      }
      const bodyBusy = await page.locator('body').getAttribute('aria-busy');
      if (bodyBusy !== 'false') throw new Error('Portfolio body did not clear aria-busy after startup readiness.');
      await assertNoLogoBackingPlate(page, 'Loading gate');
      const unlocked = await page.evaluate(() => {
        const overlay = document.querySelector('#pageTransition');
        const background = Array.from(document.body.children).find(el => el !== overlay);
        return {
          inert: background?.inert === true,
          rootOverflow: document.documentElement.style.overflow,
          bodyOverflow: document.body.style.overflow,
          bodyOverscroll: document.body.style.overscrollBehavior,
          bodyTouchAction: document.body.style.touchAction
        };
      });
      if (unlocked.inert || unlocked.rootOverflow || unlocked.bodyOverflow ||
          unlocked.bodyOverscroll || unlocked.bodyTouchAction) {
        throw new Error('Loading gate did not restore page interaction state after handoff: ' + JSON.stringify(unlocked));
      }
    }, { width: 1280, height: 900 }, null, async page => {
      // Check the active loading gate before the normal smoke-page settle.
      const locked = await page.evaluate(() => {
        const overlay = document.querySelector('#pageTransition');
        const background = Array.from(document.body.children).find(el => el !== overlay);
        const touch = new Event('touchmove', { bubbles: true, cancelable: true });
        const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
        const key = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'PageDown' });
        document.dispatchEvent(touch);
        document.dispatchEvent(wheel);
        document.dispatchEvent(key);
        return {
          loading: overlay?.dataset.loading,
          busy: document.body.getAttribute('aria-busy'),
          inert: background?.inert === true,
          touchBlocked: touch.defaultPrevented,
          wheelBlocked: wheel.defaultPrevented,
          keyBlocked: key.defaultPrevented,
          rootOverflow: getComputedStyle(document.documentElement).overflow,
          bodyOverflow: getComputedStyle(document.body).overflow
        };
      });
      if (locked.loading !== 'active' || locked.busy !== 'true' || !locked.inert ||
          !locked.touchBlocked || !locked.wheelBlocked || !locked.keyBlocked ||
          locked.rootOverflow !== 'hidden' || locked.bodyOverflow !== 'hidden') {
        throw new Error('Loading screen did not lock page interactions and scrolling: ' + JSON.stringify(locked));
      }
      await assertNoLogoBackingPlate(page, 'Active loading gate');
    });

    await smokePage(browser, '/', async page => {
      await assertMobileNavigation(page, 'Works page');

      await page.locator('.hamburger').first().click();
      await assertPublicNavigation(page, {
        href: './',
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
      await assertMobileFilterCenteredSound(page, 'Mobile Works');
      await allFilter.click();
      await page.waitForTimeout(450);

      const messageSettings = await page.evaluate(async () => {
        try {
          const response = await fetch('/data/settings.json');
          return response.ok ? await response.json() : {};
        } catch (_) { return {}; }
      });
      const heroText = await page.locator('#heroQuoteText').textContent().catch(() => '');
      const heroMessageHidden = await page.locator('#heroQuote').isHidden().catch(() => false);
      if (messageSettings.showHeroMessage !== false && !heroText?.trim()) {
        throw new Error('Mobile/tablet Works Hero message is missing while showHeroMessage is enabled.');
      }
      if (messageSettings.showHeroMessage === false && !heroMessageHidden) {
        throw new Error('Mobile/tablet Works Hero message should be hidden while showHeroMessage is disabled.');
      }
      const heroMessageLayout = await page.locator('#heroQuote').evaluate(el => {
        const style = getComputedStyle(el);
        const match = style.backgroundColor.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)$/);
        const heroSection = el.closest('.hero-section');
        const banner = heroSection?.querySelector('.hero-banner');
        const overlay = banner ? getComputedStyle(banner, '::after') : null;
        const activeSlide = banner?.querySelector('.slide.active');
        return {
          backgroundAlpha: match ? Number(match[1]) : 0,
          borderTopWidth: parseFloat(style.borderTopWidth) || 0,
          paddingTop: parseFloat(style.paddingTop) || 0,
          dynamicSizing: Boolean(heroSection?.classList.contains('hero-section--message')),
          overlayImage: overlay?.backgroundImage || 'none',
          activeArtworkOpacity: activeSlide ? Number.parseFloat(getComputedStyle(activeSlide).opacity) : 0,
          backdropFilter: style.backdropFilter || 'none'
        };
      }).catch(() => ({ backgroundAlpha: 0, paddingTop: 0, dynamicSizing: false }));
      if (heroMessageLayout.backgroundAlpha > 0.01 || heroMessageLayout.borderTopWidth > 0) throw new Error('Mobile/tablet Hero quote must have no background or border.');
      if (heroMessageLayout.paddingTop < 18) throw new Error('Mobile/tablet Hero message group has insufficient vertical padding.');
      if (heroMessageLayout.backdropFilter !== 'none') throw new Error('Mobile/tablet Hero quote panel must not blur the artwork behind it.');
      if (messageSettings.showHeroMessage === false && heroMessageLayout.dynamicSizing) {
        throw new Error('Mobile/tablet Hero should not retain message-driven sizing while its message is disabled.');
      }
      if (messageSettings.showHeroMessage !== false && !heroMessageLayout.dynamicSizing) {
        throw new Error('Mobile/tablet Hero did not enable message-driven sizing with its message.');
      }
      if (messageSettings.showHeroMessage === false &&
          (heroMessageLayout.overlayImage !== 'none' || heroMessageLayout.activeArtworkOpacity < 0.99)) {
        throw new Error('Mobile/tablet Hero artwork should be full-color with no dark overlay while its message is disabled: ' + JSON.stringify(heroMessageLayout));
      }
      if (messageSettings.showHeroMessage !== false &&
          (!heroMessageLayout.overlayImage.includes('linear-gradient') || heroMessageLayout.activeArtworkOpacity > 0.6)) {
        throw new Error('Mobile/tablet Hero must keep its readability overlay when the message is enabled: ' + JSON.stringify(heroMessageLayout));
      }
      if (messageSettings.showFooterMessage === true) {
        const footerMessage = await page.locator('footer .footer-hero-message .hero-quote-text').textContent().catch(() => '');
        if (!footerMessage?.trim()) throw new Error('Mobile/tablet footer message is missing while showFooterMessage is enabled.');
        const footerPanelAlpha = await page.locator('footer .footer-hero-message').evaluate(el => {
          const match = getComputedStyle(el).backgroundColor.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)$/);
          return match ? Number(match[1]) : 0;
        }).catch(() => 0);
        if (footerPanelAlpha > 0.01) throw new Error('Mobile/tablet footer quote must not paint its own background.');
        const footerMessageLayout = await page.locator('footer .footer-hero-message').evaluate(el => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          const social = el.closest('footer')?.querySelector('.social-icons')?.getBoundingClientRect();
          const footer = el.closest('footer');
          const quoteText = el.querySelector('.hero-quote-text');
          const quoteTextStyle = quoteText ? getComputedStyle(quoteText) : null;
          const footerContent = footer?.querySelector('.footer-content');
          const footerContentStyle = footerContent ? getComputedStyle(footerContent) : null;
          const footerContentAlphaMatch = footerContentStyle?.backgroundColor.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)$/);
          return {
            textAlign: style.textAlign,
            quoteTextAlign: quoteTextStyle?.textAlign || '',
            quoteTextMarginBottom: parseFloat(quoteTextStyle?.marginBottom || '0') || 0,
            backdropFilter: style.backdropFilter || 'none',
            borderTopWidth: parseFloat(style.borderTopWidth) || 0,
            contentBackgroundAlpha: footerContentAlphaMatch ? Number(footerContentAlphaMatch[1]) : 0,
            animationSlideCount: footer?.querySelectorAll('.footer-animation-slide').length || 0,
            activeAnimationSlideCount: footer?.querySelectorAll('.footer-animation-slide.active').length || 0,
            messageClass: el.classList.contains('hero-quote'),
            marginBottom: parseFloat(style.marginBottom) || 0,
            socialGap: social ? social.top - rect.bottom : 0,
            backdropClass: Boolean(footer?.classList.contains('footer--message-enabled')),
            animationDisplay: footer ? getComputedStyle(footer.querySelector('.footer-animation')).display : 'none',
            fadeDisplay: footer ? getComputedStyle(footer.querySelector('.footer-fade')).display : 'none'
          };
        });
        if (footerMessageLayout.textAlign !== 'left' || footerMessageLayout.quoteTextAlign !== 'left' || footerMessageLayout.quoteTextMarginBottom < 18) {
          throw new Error('Mobile/tablet footer quote and inner text must preserve hero panel alignment and spacing: ' + JSON.stringify(footerMessageLayout));
        }
        if (footerMessageLayout.backdropFilter !== 'none' || !footerMessageLayout.messageClass || footerMessageLayout.borderTopWidth > 0) throw new Error('Mobile/tablet footer quote must reuse transparent hero typography without a panel.');
        if (footerMessageLayout.marginBottom < 32 || footerMessageLayout.socialGap < 32) throw new Error('Mobile/tablet footer quote needs clear space before the social icon row: ' + JSON.stringify(footerMessageLayout));
        if (footerMessageLayout.contentBackgroundAlpha < 0.1) throw new Error('Mobile/tablet footer content must add a translucent black scrim while its message is enabled.');
        if (!footerMessageLayout.backdropClass || footerMessageLayout.animationDisplay === 'none' || footerMessageLayout.fadeDisplay === 'none' || footerMessageLayout.animationSlideCount < 1 || footerMessageLayout.activeAnimationSlideCount !== 1) throw new Error('Mobile/tablet footer message should overlay a live looping artwork backdrop.');
      } else {
        const footerBackdrop = await page.locator('footer').evaluate(el => {
          const content = el.querySelector('.footer-content');
          const contentStyle = content ? getComputedStyle(content) : null;
          const alphaMatch = contentStyle?.backgroundColor.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)$/);
          return {
            enabled: el.classList.contains('footer--message-enabled'),
            animationDisplay: getComputedStyle(el.querySelector('.footer-animation')).display,
            fadeDisplay: getComputedStyle(el.querySelector('.footer-fade')).display,
            slideCount: el.querySelectorAll('.footer-animation-slide').length,
            activeSlideCount: el.querySelectorAll('.footer-animation-slide.active').length,
            contentBackgroundAlpha: alphaMatch ? Number(alphaMatch[1]) : 0
          };
        });
        if (footerBackdrop.enabled || footerBackdrop.animationDisplay === 'none' || footerBackdrop.fadeDisplay === 'none' ||
            footerBackdrop.slideCount < 1 || footerBackdrop.activeSlideCount !== 1 || footerBackdrop.contentBackgroundAlpha > 0.01) {
          throw new Error('Mobile/tablet footer artwork must keep looping with no quote scrim when the footer message is off: ' + JSON.stringify(footerBackdrop));
        }
      }

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

      // Check layout geometry rather than transformed visual bounds: cards can
      // still be mid-transition after filter interaction, and getBoundingClientRect()
      // includes transform/scale effects that do not change CSS grid track sizing.
      const firstRowLayout = await page.locator('#portfolioGrid').evaluate(grid => {
        const cards = Array.from(grid.querySelectorAll('.project-card')).filter(card => {
          const style = getComputedStyle(card);
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            card.offsetWidth > 0 && card.offsetHeight > 0;
        });
        const columns = getComputedStyle(grid).gridTemplateColumns
          .trim()
          .split(/\s+/)
          .map(value => Number.parseFloat(value));
        const firstVisibleTop = cards[0]?.offsetTop;
        const firstRowCards = cards
          .filter(card => Math.abs(card.offsetTop - firstVisibleTop) <= 2)
          .sort((a, b) => a.offsetLeft - b.offsetLeft)
          .slice(0, 2);
        return {
          columns,
          visibleCardCount: cards.length,
          firstRow: firstRowCards.map(card => ({
            left: card.offsetLeft,
            top: card.offsetTop,
            width: card.offsetWidth
          }))
        };
      });
      if (
        firstRowLayout.columns.length !== 2 ||
        Math.abs(firstRowLayout.columns[0] - firstRowLayout.columns[1]) > 2 ||
        firstRowLayout.firstRow.length < 2 ||
        Math.abs(firstRowLayout.firstRow[0].top - firstRowLayout.firstRow[1].top) > 2 ||
        Math.abs(firstRowLayout.firstRow[0].left - firstRowLayout.firstRow[1].left) < 2 ||
        Math.abs(firstRowLayout.firstRow[0].width - firstRowLayout.firstRow[1].width) > 2
      ) {
        throw new Error('Mobile Works gallery did not render its first row as two equal columns: ' + JSON.stringify(firstRowLayout));
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
        const preservedAfterResize = await page.locator('#portfolioGridViewport').evaluate(el => ({
          maxHeight: getComputedStyle(el).maxHeight,
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          expanded: el.dataset.expanded || '',
          ariaExpanded: document.querySelector('#showMoreBtn')?.getAttribute('aria-expanded') || '',
          activeFilters: Array.from(document.querySelectorAll('.filter-tabs [aria-pressed="true"]'))
            .map(button => button.getAttribute('data-filter') || 'all')
        }));
        const resizeLabel = await mobileShowMore.locator('.btn-text').textContent().catch(() => '');
        if (preservedAfterResize.maxHeight !== 'none' || resizeLabel?.trim().toUpperCase() !== 'SHOW LESS') {
          throw new Error('Mobile Show More collapsed unexpectedly while remaining in an overflowing viewport: ' +
            JSON.stringify({ ...preservedAfterResize, label: resizeLabel?.trim() || '' }));
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

        const youtubeFrameLoaded = await youtubeFrames.first().getAttribute('data-lm-youtube-loaded');
        if (youtubeFrameLoaded !== 'true') {
          throw new Error('YouTube Lightbox marked its player ready before the iframe load completed.');
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

      const expectedMediaCounts = await page.evaluate(async () => {
        const response = await fetch('/data/projects.json');
        if (!response.ok) throw new Error('Could not read project data for the Lightbox smoke contract.');
        const projects = await response.json();
        const project = projects.find(item => item.id === 'haeru');
        if (!project || !Array.isArray(project.media)) return null;
        return {
          media: project.media.length,
          images: project.media.filter(item => item?.type === 'image').length
        };
      });
      if (!expectedMediaCounts || expectedMediaCounts.media < 1) {
        throw new Error('Haeru media-count smoke contract could not resolve the saved project data.');
      }

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
      if (mediaItems !== expectedMediaCounts.media) {
        throw new Error(`Rapid Lightbox navigation produced ${mediaItems} media entries; saved Haeru data contains ${expectedMediaCounts.media}.`);
      }

      const youtubePlayers = await page.locator('#lightboxMediaContainer iframe[data-lm-youtube]').count();
      if (youtubePlayers !== 0) {
        throw new Error('Rapid navigation left YouTube players mounted in a project that contains no YouTube media.');
      }

      const imageCount = await page.locator('#lightboxMediaContainer img').count();
      if (imageCount !== expectedMediaCounts.images) {
        throw new Error(`Rapid navigation left ${imageCount} images in Haeru; saved project data contains ${expectedMediaCounts.images} image media entries.`);
      }

      await close.click();
      await page.locator('#lightbox.active').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

      const mediaAfterClose = await page.locator('#lightboxMediaContainer .lightbox-media-item').count();
      if (mediaAfterClose !== 0) throw new Error('Lightbox media container retained stale entries after rapid navigation and close.');

      await navigationCard.click();
      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 3000 });
      const reopenedItems = await page.locator('#lightboxMediaContainer .lightbox-media-item').count();
      if (reopenedItems !== expectedMediaCounts.media) {
        throw new Error(`Lightbox reopen after rapid navigation rendered ${reopenedItems} entries; saved Haeru data contains ${expectedMediaCounts.media}.`);
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
      await page.evaluate(() => {
        const contact = document.querySelector('#contact-section');
        if (!contact) throw new Error('Contact logo smoke fixture could not find #contact-section.');
        window.scrollTo(0, contact.getBoundingClientRect().top + window.scrollY + 80);
      });
      await page.waitForFunction(() => {
        const logo = document.querySelector('.site-logo');
        const link = logo?.closest('.nav-logo');
        const contact = document.querySelector('#contact-section')?.getBoundingClientRect();
        const logoRect = link?.getBoundingClientRect();
        const y = logoRect ? logoRect.top + logoRect.height / 2 : -1;
        return !!contact && !!logo && logo.dataset.logoForeground === 'light' &&
          y >= contact.top && y <= contact.bottom;
      }, null, { timeout: 4000 });
      const contactLogoState = await page.evaluate(() => {
        const logo = document.querySelector('.site-logo');
        return { foreground: logo?.dataset?.logoForeground,
          logoTransition: getComputedStyle(logo).transitionProperty };
      });
      if (contactLogoState.foreground !== 'light' ||
          !contactLogoState.logoTransition.includes('filter')) {
        throw new Error('Contact-area logo lost its white/filter transition: ' + JSON.stringify(contactLogoState));
      }
      await assertNoLogoBackingPlate(page, 'Contact section');

      await page.locator('.nav-links a[href="#contact-start"]').first().click();
      await page.waitForTimeout(100);
      if (await page.evaluate(() => window.location.hash !== '#contact-start')) {
        throw new Error('Navigation smoke fixture failed to enter the Contact hash state.');
      }

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await assertNoLogoBackingPlate(page, 'Footer');
      await page.locator('.nav-links a[href="./"]').first().click();
      await page.waitForFunction(() => Math.abs(window.scrollY) <= 8, null, { timeout: 5000 });
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
        // Position the fixture at the bottom instantly. Without this guard,
        // the page's global smooth-scroll setting can leave a synthetic scroll
        // in flight when the logo click tries to reset Home.
        const html = document.documentElement;
        const previousBehavior = html.style.scrollBehavior;
        html.style.scrollBehavior = 'auto';
        const maximum = Math.max(
          0,
          Math.max(html.scrollHeight, document.body.scrollHeight) - window.innerHeight
        );
        window.scrollTo({ left: 0, top: maximum, behavior: 'auto' });
        html.style.scrollBehavior = previousBehavior;
      });
      await page.waitForFunction(() => {
        const maximum = Math.max(
          0,
          Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight
        );
        return Math.abs(window.scrollY - maximum) <= 2;
      }, null, { timeout: 3000 });
      await page.locator('.nav-logo').first().click();
      // Wait for the runtime's two-frame layout correction, then verify the
      // resting position rather than a transient instant-scroll frame.
      await page.waitForFunction(async () => {
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => requestAnimationFrame(resolve));
        return Math.abs(window.scrollY) <= 8;
      }, null, { timeout: 5000 });
      const logoReset = await page.evaluate(() => ({
        scrollY: window.scrollY,
        hash: window.location.hash,
        path: window.location.pathname,
        unloads: window.__lmSmokeUnloadCount
      }));
      if (Math.abs(logoReset.scrollY) > 8) {
        throw new Error('Main-page LM logo navigation did not return to the top without reloading: ' + JSON.stringify(logoReset));
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


    await smokePage(browser, '/#test-portfolio', async page => {
      await page.waitForFunction(() => document.body.classList.contains('is-curated-view') &&
        document.body.dataset.curatedViewSlug === 'test-portfolio');
      await page.waitForFunction(() => document.querySelectorAll('#portfolioGrid .project-card').length === 3);
      const state = await page.evaluate(() => ({
        slug: document.body.dataset.curatedViewSlug || '',
        heading: document.querySelector('#curatedViewHeading h1')?.textContent?.trim() || '',
        filters: getComputedStyle(document.querySelector('.filter-tabs')).display,
        ids: Array.from(document.querySelectorAll('#portfolioGrid .project-card')).map(card => card.dataset.projectId || ''),
        eyebrowCount: document.querySelectorAll('.curated-view-eyebrow').length,
        exitBorder: getComputedStyle(document.querySelector('.curated-view-exit')).borderTopWidth,
        exitIcon: document.querySelector('.curated-view-exit i')?.className || ''
      }));
      const expected = ['funko-pop-test', 'test-project', 'test-project-on-curated-view'];
      if (state.slug !== 'test-portfolio' || state.heading !== 'test portfolio' ||
          state.filters !== 'none' || JSON.stringify(state.ids) !== JSON.stringify(expected)) {
        throw new Error('Direct Curated View route did not render the saved ordered project set: ' + JSON.stringify(state));
      }
      if (state.eyebrowCount !== 0 || state.exitBorder !== '0px' || !state.exitIcon.includes('fa-arrow-left')) {
        throw new Error('Curated View heading/exit presentation regression: ' + JSON.stringify(state));
      }
      await page.locator('#portfolioGrid [data-project-id="test-project-on-curated-view"]').click();
      await page.locator('#lightbox.active').waitFor({ state: 'visible', timeout: 5000 });
      const title = await page.locator('#modalTitle').textContent();
      if (title?.trim() !== 'Test project on curated view') {
        throw new Error('Curated-only card did not resolve to its own Lightbox project model: ' + title);
      }
      await page.locator('#lightboxClose').click();
      await page.locator('.curated-view-exit').click();
      await page.waitForFunction(() => !document.body.classList.contains('is-curated-view') &&
        !window.location.hash && document.querySelectorAll('#portfolioGrid .project-card').length > 3);
      if (await page.locator('#portfolioGrid [data-project-id="test-project-on-curated-view"]').count() !== 0) {
        throw new Error('A Curated-only project leaked into Main Portfolio after leaving the view.');
      }
      if (await page.locator('.filter-tabs').evaluate(el => getComputedStyle(el).display) === 'none') {
        throw new Error('Leaving a Curated View did not restore normal Gallery filters.');
      }
    }, { width: 1280, height: 900 });

    await smokePage(browser, '/#test-portfolio', async page => {
      await page.waitForFunction(() => document.body.dataset.curatedViewSlug === 'test-portfolio');
      const state = await page.evaluate(() => {
        const heading = document.querySelector('.curated-view-heading');
        const copy = document.querySelector('.curated-view-heading-copy');
        const controls = document.querySelector('.filter-page-controls');
        if (controls) controls.hidden = false;
        const headingStyle = heading ? getComputedStyle(heading) : null;
        const copyRect = copy?.getBoundingClientRect();
        const exitRect = document.querySelector('.curated-view-exit')?.getBoundingClientRect();
        return {
          direction: headingStyle?.flexDirection || '',
          copyRight: copyRect?.right ?? null,
          exitLeft: exitRect?.left ?? null,
          controlsDisplay: controls ? getComputedStyle(controls).display : 'missing',
          eyebrowCount: document.querySelectorAll('.curated-view-eyebrow').length
        };
      });
      if (state.direction !== 'row' || state.copyRight === null || state.exitLeft === null ||
          state.exitLeft < state.copyRight - 1 || state.controlsDisplay !== 'none' || state.eyebrowCount !== 0) {
        throw new Error('Mobile Curated View presentation regression: ' + JSON.stringify(state));
      }
    }, { width: 390, height: 844 });

    await smokePage(browser, '/#test-portfolio', async page => {
      await page.waitForFunction(() => document.body.dataset.curatedViewSlug === 'test-portfolio');
      const state = await page.evaluate(() => {
        const heading = document.querySelector('.curated-view-heading');
        const copy = document.querySelector('.curated-view-heading-copy');
        const exit = document.querySelector('.curated-view-exit');
        const controls = document.querySelector('.filter-page-controls');
        if (controls) controls.hidden = false;
        const copyRect = copy?.getBoundingClientRect();
        const exitRect = exit?.getBoundingClientRect();
        const headingRect = heading?.getBoundingClientRect();
        return {
          direction: heading ? getComputedStyle(heading).flexDirection : '',
          copyRight: copyRect?.right ?? null,
          exitLeft: exitRect?.left ?? null,
          controlsDisplay: controls ? getComputedStyle(controls).display : 'missing',
          headingBottom: headingRect?.bottom ?? null,
          exitBottom: exitRect?.bottom ?? null
        };
      });
      if (state.direction !== 'row' || state.copyRight === null || state.exitLeft === null ||
          state.exitLeft < state.copyRight - 1 || state.controlsDisplay !== 'none' ||
          state.headingBottom === null || state.exitBottom === null || state.exitBottom > state.headingBottom + 1) {
        throw new Error('Narrow mobile Curated View layout regression at 320px: ' + JSON.stringify(state));
      }
    }, { width: 320, height: 568 });
    await smokePage(browser, '/', async page => {
      const nonAllFilter = page.locator('.filter-tabs .filter-btn:not([data-filter="all"])').first();
      if (await nonAllFilter.count() !== 1) throw new Error('Desktop Gallery reset smoke fixture has no non-ALL filter.');
      await nonAllFilter.click();
      await page.waitForTimeout(120);
      if (await page.locator('.filter-tabs .filter-btn[data-filter="all"].active').count() !== 0) {
        throw new Error('Desktop Gallery smoke could not enter a selected non-ALL filter.');
      }

      await page.locator('.nav-links a[href="./"]').first().click();
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
      const worksLink = page.locator('.nav-links a[href="./"]').first();
      if (await worksLink.count() !== 1) throw new Error('Mobile hamburger Works navigation link is missing.');
      await worksLink.click();
      // The interaction now deliberately stages selected feedback before the
      // 260ms menu exit. Wait on the resulting navigation contract rather than
      // sampling at a fixed 340ms while the exit may still be running.
      await page.waitForFunction(() => {
        const active = document.querySelector('.filter-tabs .filter-btn.active')?.getAttribute('data-filter') || '';
        return active === 'all' &&
          window.location.hash === '' &&
          !document.body.classList.contains('menu-open');
      }, null, { timeout: 2500 });
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
      await waitForContactViewportAlignment(page);
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
      await waitForContactViewportAlignment(page);
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
      await page.waitForFunction(() => {
        const menu = document.querySelector('.nav-links');
        return menu?.classList.contains('is-closing') &&
          !document.querySelector('.hamburger')?.classList.contains('is-open');
      }, null, { timeout: 1000 });
      await page.waitForFunction(() => !document.body.classList.contains('menu-open'), null, { timeout: 1500 });
      if (await page.evaluate(() => document.body.classList.contains('menu-open'))) {
        throw new Error('Outside tap did not finish closing the animated mobile hamburger menu.');
      }
    }, { width: 390, height: 844 });

    await smokePage(browser, '/', async page => {
      const contact = page.locator('.nav-links a[href="#contact-start"]').first();
      await contact.click();
      await waitForContactViewportAlignment(page);

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
      await waitForContactViewportAlignment(page);

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
          touchAction: tabStyle?.touchAction || '',
          panelIds: panels.map(panel => ({
            id: panel.id,
            display: getComputedStyle(panel).display,
            ariaHidden: panel.getAttribute('aria-hidden'),
            role: panel.getAttribute('role'),
            labelledBy: panel.getAttribute('aria-labelledby')
          }))
        };
      });
      if (mobileContactTabs.tabCount !== 2 || mobileContactTabs.activeTabs !== 1 ||
          mobileContactTabs.visiblePanels !== 1 || mobileContactTabs.display !== 'grid' ||
          mobileContactTabs.panelIds.find(panel => panel.id === 'contactProjectPanel')?.ariaHidden !== 'false' ||
          mobileContactTabs.panelIds.find(panel => panel.id === 'contactReviewPanel')?.ariaHidden !== 'true' ||
          mobileContactTabs.panelIds.find(panel => panel.id === 'contactProjectPanel')?.role !== 'tabpanel' ||
          mobileContactTabs.panelIds.find(panel => panel.id === 'contactProjectPanel')?.labelledBy !== 'contactTabProject' ||
          mobileContactTabs.panelIds.find(panel => panel.id === 'contactReviewPanel')?.role !== 'tabpanel' ||
          mobileContactTabs.panelIds.find(panel => panel.id === 'contactReviewPanel')?.labelledBy !== 'contactTabReview') {
        throw new Error('Mobile Contact did not collapse into a single active tab panel: '+JSON.stringify(mobileContactTabs));
      }
      if (mobileContactTabs.touchAction !== 'pan-y') {
        throw new Error('Mobile Contact tab rail must preserve vertical scrolling while accepting horizontal swipes: ' +
          JSON.stringify({ touchAction: mobileContactTabs.touchAction }));
      }

      // Dispatch a press-and-drag sequence: pointerdown must originate on a
      // tab, then pointermove crosses the rail while that pointer stays down.
      const contactTabRail = page.locator('.contact-mobile-tabs');
      const projectTab = page.locator('#contactTabProject');
      const reviewTab = page.locator('#contactTabReview');
      const contactRailBox = await contactTabRail.boundingBox();
      const projectTabBox = await projectTab.boundingBox();
      const reviewTabBox = await reviewTab.boundingBox();
      if (!contactRailBox || !projectTabBox || !reviewTabBox) {
        throw new Error('Mobile Contact tab rail or tab hit areas are not measurable.');
      }
      const contactRailY = contactRailBox.y + contactRailBox.height / 2;
      const projectTabX = projectTabBox.x + projectTabBox.width / 2;
      const reviewTabX = reviewTabBox.x + reviewTabBox.width / 2;
      const dragContactRail = async (pointerId, startSelector, startX, endX) => {
        await page.locator(startSelector).dispatchEvent('pointerdown', {
          pointerType: 'touch', isPrimary: true, pointerId, button: 0, buttons: 1,
          clientX: startX, clientY: contactRailY
        });
        await contactTabRail.dispatchEvent('pointermove', {
          pointerType: 'touch', isPrimary: true, pointerId, button: 0, buttons: 1,
          clientX: endX, clientY: contactRailY
        });
        await contactTabRail.dispatchEvent('pointerup', {
          pointerType: 'touch', isPrimary: true, pointerId, button: 0, buttons: 0,
          clientX: endX, clientY: contactRailY
        });
      };
      await dragContactRail(731, '#contactTabProject', projectTabX, reviewTabX);
      await page.waitForTimeout(20);
      const contactSwipeLeft = await page.evaluate(() => ({
        active: document.querySelector('.contact-mobile-tabs')?.getAttribute('data-active') || '',
        projectSelected: document.querySelector('#contactTabProject')?.getAttribute('aria-selected'),
        reviewSelected: document.querySelector('#contactTabReview')?.getAttribute('aria-selected'),
        projectHidden: document.querySelector('#contactProjectPanel')?.getAttribute('aria-hidden'),
        reviewHidden: document.querySelector('#contactReviewPanel')?.getAttribute('aria-hidden')
      }));
      if (contactSwipeLeft.active !== 'review' || contactSwipeLeft.projectSelected !== 'false' ||
          contactSwipeLeft.reviewSelected !== 'true' || contactSwipeLeft.projectHidden !== 'true' ||
          contactSwipeLeft.reviewHidden !== 'false') {
        throw new Error('Dragging from Start a Project to Leave a Review did not activate the review tab: ' +
          JSON.stringify(contactSwipeLeft));
      }

      await dragContactRail(732, '#contactTabReview', reviewTabX, projectTabX);
      await page.waitForTimeout(20);
      const contactSwipeRight = await page.evaluate(() => ({
        active: document.querySelector('.contact-mobile-tabs')?.getAttribute('data-active') || '',
        projectSelected: document.querySelector('#contactTabProject')?.getAttribute('aria-selected'),
        reviewSelected: document.querySelector('#contactTabReview')?.getAttribute('aria-selected')
      }));
      if (contactSwipeRight.active !== 'project' || contactSwipeRight.projectSelected !== 'true' ||
          contactSwipeRight.reviewSelected !== 'false') {
        throw new Error('Dragging from Leave a Review to Start a Project did not activate the project tab: ' +
          JSON.stringify(contactSwipeRight));
      }

      await page.locator('#contactTabProject').focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(40);
      const arrowContactState = await page.evaluate(() => ({
        projectTab: document.querySelector('#contactTabProject')?.getAttribute('aria-selected'),
        reviewTab: document.querySelector('#contactTabReview')?.getAttribute('aria-selected'),
        focusedTab: document.activeElement?.id || '',
        projectAriaHidden: document.querySelector('#contactProjectPanel')?.getAttribute('aria-hidden'),
        reviewAriaHidden: document.querySelector('#contactReviewPanel')?.getAttribute('aria-hidden'),
        projectRole: document.querySelector('#contactProjectPanel')?.getAttribute('role'),
        reviewRole: document.querySelector('#contactReviewPanel')?.getAttribute('role'),
        projectLabelledBy: document.querySelector('#contactProjectPanel')?.getAttribute('aria-labelledby'),
        reviewLabelledBy: document.querySelector('#contactReviewPanel')?.getAttribute('aria-labelledby')
      }));
      if (arrowContactState.projectTab !== 'false' || arrowContactState.reviewTab !== 'true' ||
          arrowContactState.focusedTab !== 'contactTabReview' ||
          arrowContactState.projectAriaHidden !== 'true' || arrowContactState.reviewAriaHidden !== 'false' ||
          arrowContactState.projectRole !== 'tabpanel' || arrowContactState.reviewRole !== 'tabpanel' ||
          arrowContactState.projectLabelledBy !== 'contactTabProject' ||
          arrowContactState.reviewLabelledBy !== 'contactTabReview') {
        throw new Error('Mobile Contact arrow-key navigation did not activate and focus the review tab: '+JSON.stringify(arrowContactState));
      }
      await page.keyboard.press('Home');
      await page.waitForTimeout(40);
      const homeContactState = await page.evaluate(() => ({
        projectTab: document.querySelector('#contactTabProject')?.getAttribute('aria-selected'),
        reviewTab: document.querySelector('#contactTabReview')?.getAttribute('aria-selected'),
        focusedTab: document.activeElement?.id || ''
      }));
      if (homeContactState.projectTab !== 'true' || homeContactState.reviewTab !== 'false' ||
          homeContactState.focusedTab !== 'contactTabProject') {
        throw new Error('Mobile Contact Home key did not return focus to the first tab: '+JSON.stringify(homeContactState));
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
          projectAriaHidden: document.querySelector('#contactProjectPanel')?.getAttribute('aria-hidden'),
          reviewAriaHidden: document.querySelector('#contactReviewPanel')?.getAttribute('aria-hidden'),
          active: rail?.getAttribute('data-active') || '',
          indicatorBackground: indicator?.backgroundColor || '',
          indicatorTransition: indicator?.transitionProperty || '',
          indicatorTransform: indicator?.transform || ''
        };
      });
      if (reviewTabState.projectTab !== 'false' || reviewTabState.reviewTab !== 'true' ||
          reviewTabState.projectDisplay !== 'none' || reviewTabState.reviewDisplay === 'none' ||
          reviewTabState.projectAriaHidden !== 'true' || reviewTabState.reviewAriaHidden !== 'false' ||
          reviewTabState.active !== 'review' ||
          reviewTabState.indicatorBackground !== 'rgb(255, 255, 255)' ||
          !reviewTabState.indicatorTransition.includes('transform')) {
        throw new Error('Mobile Contact tab switching did not activate the sliding review state: '+JSON.stringify(reviewTabState));
      }
      const contactViewportBeforeDesktopCheck = page.viewportSize() || await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      await page.setViewportSize({ width: 1280, height: contactViewportBeforeDesktopCheck.height });
      await page.waitForTimeout(40);
      const desktopContactA11y = await page.evaluate(() => ({
        projectDisplay: getComputedStyle(document.querySelector('#contactProjectPanel')).display,
        reviewDisplay: getComputedStyle(document.querySelector('#contactReviewPanel')).display,
        projectAriaHidden: document.querySelector('#contactProjectPanel')?.getAttribute('aria-hidden'),
        reviewAriaHidden: document.querySelector('#contactReviewPanel')?.getAttribute('aria-hidden'),
        projectRole: document.querySelector('#contactProjectPanel')?.getAttribute('role'),
        reviewRole: document.querySelector('#contactReviewPanel')?.getAttribute('role'),
        projectLabelledBy: document.querySelector('#contactProjectPanel')?.getAttribute('aria-labelledby'),
        reviewLabelledBy: document.querySelector('#contactReviewPanel')?.getAttribute('aria-labelledby')
      }));
      if (desktopContactA11y.projectDisplay === 'none' || desktopContactA11y.reviewDisplay === 'none' ||
          desktopContactA11y.projectAriaHidden !== 'false' || desktopContactA11y.reviewAriaHidden !== 'false' ||
          desktopContactA11y.projectRole !== null || desktopContactA11y.reviewRole !== null ||
          desktopContactA11y.projectLabelledBy !== null || desktopContactA11y.reviewLabelledBy !== null) {
        throw new Error('Desktop Contact rendered both panels but hid one from assistive technology: '+JSON.stringify(desktopContactA11y));
      }
      await page.setViewportSize(contactViewportBeforeDesktopCheck);
      await page.waitForTimeout(40);

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
      await page.waitForTimeout(180);
      const desktopFilterMode = await filterRail.evaluate(el => {
        const style = getComputedStyle(el);
        return {
          flexWrap: style.flexWrap,
          overflowX: style.overflowX,
          inert: el.inert,
          pointerEvents: style.pointerEvents,
          dataOverflow: el.dataset.overflow === 'true',
          contentWidth: el.scrollWidth,
          viewportWidth: el.clientWidth
        };
      });
      // The updated design uses one shared adaptive scroller at every breakpoint.
      // On desktop the labels stay on one row; overflow-x:auto is harmless when
      // they fit, and is required if the category labels become wider in the future.
      if (
        desktopFilterMode.flexWrap !== 'nowrap' ||
        desktopFilterMode.overflowX !== 'auto' ||
        desktopFilterMode.inert ||
        desktopFilterMode.pointerEvents === 'none' ||
        (desktopFilterMode.dataOverflow && desktopFilterMode.contentWidth <= desktopFilterMode.viewportWidth + 1)
      ) {
        throw new Error(
          'Desktop filter rail lost its one-row responsive scroller contract after a mobile breakpoint: ' +
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
        const contentStyle = getComputedStyle(el.querySelector('.filter-nav-content'));
        return {
          contentDisplay: contentStyle.display,
          contentFlexWrap: contentStyle.flexWrap,
          overflowX: style.overflowX,
          inert: el.inert,
          pointerEvents: style.pointerEvents,
          dataOverflow: el.dataset.overflow === 'true',
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth
        };
      });
      if (
        restoredMobileFilterMode.contentDisplay !== 'flex' ||
        restoredMobileFilterMode.contentFlexWrap !== 'nowrap' ||
        restoredMobileFilterMode.overflowX !== 'auto' ||
        restoredMobileFilterMode.inert ||
        restoredMobileFilterMode.pointerEvents === 'none' ||
        (restoredMobileFilterMode.dataOverflow && restoredMobileFilterMode.scrollWidth <= restoredMobileFilterMode.clientWidth + 1)
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

      const footerAnimation = await page.evaluate(async () => {
        let showFooterMessage = false;
        try {
          const response = await fetch('/data/settings.json');
          const settings = response.ok ? await response.json() : {};
          showFooterMessage = settings.showFooterMessage === true;
        } catch (_) {}
        const media = document.querySelector('#footerAnimation');
        return {
          showFooterMessage,
          exists: !!media,
          slides: document.querySelectorAll('#footerAnimation .footer-animation-slide').length,
          hidden: !!media?.hidden,
          display: media ? getComputedStyle(media).display : 'none',
          radius: media ? getComputedStyle(media).borderRadius : ''
        };
      });
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
          mediaDisplay: mediaStyle.display,
          contentBackgroundAlpha: (() => {
            const match = contentStyle.backgroundColor.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)$/);
            return match ? Number(match[1]) : 0;
          })(),
          contentPosition: contentStyle.position,
          contentZ: contentStyle.zIndex,
          foreground: footerStyle.getPropertyValue('--footer-foreground').trim(),
          fadeExists: !!fade,
          fadePosition: fadeStyle?.position || '',
          fadeZ: fadeStyle?.zIndex || '',
          fadeDisplay: fadeStyle?.display || 'none',
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
      if (footerAnimation.slides < 1 || footerAnimation.hidden ||
          footerLayout.mediaDisplay === 'none' || footerLayout.mediaHeight < footerLayout.footerHeight - 1 ||
          footerLayout.footerHeight < 420 || footerLayout.fadeDisplay === 'none') {
        throw new Error('Footer artwork and readability fade must keep looping regardless of quote visibility: ' +
          JSON.stringify({ ...footerAnimation, ...footerLayout }));
      }
      if (footerAnimation.showFooterMessage && footerLayout.contentBackgroundAlpha < 0.1) {
        throw new Error('Footer content must gain a translucent black scrim while its quote is enabled: ' +
          JSON.stringify({ ...footerAnimation, ...footerLayout }));
      }
      if (!footerAnimation.showFooterMessage && footerLayout.contentBackgroundAlpha > 0.01) {
        throw new Error('Footer content scrim must be transparent while its quote is disabled: ' +
          JSON.stringify({ ...footerAnimation, ...footerLayout }));
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
      if (footerAnimation.showFooterMessage &&
          !['#fff','#000','rgb(255, 255, 255)','rgb(0, 0, 0)'].includes(footerLayout.foreground)) {
        throw new Error('Footer foreground contrast token is not resolved while its artwork backdrop is enabled: '+
          JSON.stringify(footerLayout));
      }

      const backToTop = await page.locator('footer a[href="#"]').count();
      const backToTopLabel = await page.getByText(/back\s*to\s*top/i).count();
      if (backToTop || backToTopLabel) {
        throw new Error('Back to Top control is still present on the public page.');
      }

    }, { width: 1280, height: 900 });

    // Exercise the enabled footer-message mode independently of the site's CMS toggle.
    // The real content file remains unchanged; this test response exists only in this page context.
    await smokePage(browser, '/', async page => {
      await page.waitForFunction(() => {
        const footer = document.querySelector('footer');
        const panel = footer?.querySelector('.footer-hero-message');
        const media = document.querySelector('#footerAnimation');
        const text = panel?.querySelector('.hero-quote-text')?.textContent?.trim();
        const slides = media?.querySelectorAll('.footer-animation-slide').length || 0;
        return footer?.classList.contains('footer--message-enabled') &&
          panel?.classList.contains('hero-quote') && !!text && slides > 0 &&
          getComputedStyle(media).display !== 'none';
      }, null, { timeout: 15000 });

      const composition = await page.evaluate(() => {
        const heroQuote = document.querySelector('#heroQuote');
        const heroBanner = document.querySelector('#heroBanner');
        const heroSlide = heroBanner?.querySelector('.slide.active');
        const footer = document.querySelector('footer');
        const panel = footer?.querySelector('.footer-hero-message');
        const social = footer?.querySelector('.social-icons');
        const rect = panel?.getBoundingClientRect();
        const socialRect = social?.getBoundingClientRect();
        const panelStyle = panel ? getComputedStyle(panel) : null;
        const panelAlpha = panelStyle?.backgroundColor.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)$/);
        return {
          heroMessageHidden: heroQuote?.hidden === true,
          heroOverlay: heroBanner ? getComputedStyle(heroBanner, '::after').backgroundImage : '',
          heroArtworkOpacity: heroSlide ? Number.parseFloat(getComputedStyle(heroSlide).opacity) : 0,
          footerBackdropClass: footer?.classList.contains('footer--message-enabled') === true,
          footerPanelUsesHeroStyle: panel?.classList.contains('hero-quote') === true,
          footerPanelBlur: panelStyle?.backdropFilter || 'none',
          footerPanelBackgroundAlpha: panelAlpha ? Number(panelAlpha[1]) : 0,
          footerPanelBorderTopWidth: parseFloat(panelStyle?.borderTopWidth || '0') || 0,
          footerContentBackgroundAlpha: (() => {
            const content = footer?.querySelector('.footer-content');
            const style = content ? getComputedStyle(content) : null;
            const match = style?.backgroundColor.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)$/);
            return match ? Number(match[1]) : 0;
          })(),
          footerPanelTextAlign: panelStyle?.textAlign || '',
          footerQuoteTextAlign: panel?.querySelector('.hero-quote-text')
            ? getComputedStyle(panel.querySelector('.hero-quote-text')).textAlign
            : '',
          footerQuoteTextMarginBottom: panel?.querySelector('.hero-quote-text')
            ? parseFloat(getComputedStyle(panel.querySelector('.hero-quote-text')).marginBottom) || 0
            : 0,
          messageToSocialGap: rect && socialRect ? socialRect.top - rect.bottom : 0,
          footerHeight: footer?.getBoundingClientRect().height || 0,
          mediaHeight: document.querySelector('#footerAnimation')?.getBoundingClientRect().height || 0
        };
      });
      if (!composition.heroMessageHidden ||
          composition.heroOverlay !== 'none' ||
          composition.heroArtworkOpacity < 0.99) {
        throw new Error('Footer-on fixture should retain a fully clear Works hero with its quote toggled off: '+
          JSON.stringify(composition));
      }
      if (!composition.footerBackdropClass || !composition.footerPanelUsesHeroStyle ||
          composition.footerPanelBlur !== 'none' || composition.footerPanelBackgroundAlpha > 0.01 ||
          composition.footerPanelBorderTopWidth > 0 || composition.footerContentBackgroundAlpha < 0.1 ||
          composition.footerPanelTextAlign !== 'left' || composition.footerQuoteTextAlign !== 'left' ||
          composition.footerQuoteTextMarginBottom < 18) {
        throw new Error('Footer quote must stay transparent over a black-scrimmed content layer: '+
          JSON.stringify(composition));
      }
      if (composition.messageToSocialGap < 32) {
        throw new Error('Footer quote needs a clear gap before the separate social/copyright group: '+
          JSON.stringify(composition));
      }
      if (composition.footerHeight < 420 || composition.mediaHeight < composition.footerHeight - 1) {
        throw new Error('Footer artwork must fully cover the footer stage: '+JSON.stringify(composition));
      }
    }, { width: 1280, height: 900 }, async page => {
      await page.route('**/data/settings.json', async route => {
        const response = await route.fetch();
        const settings = await response.json();
        await route.fulfill({
          status: response.status(),
          contentType: 'application/json',
          body: JSON.stringify({ ...settings, showHeroMessage: false, showFooterMessage: true })
        });
      });
    });

    await smokePage(browser, '/about/', async (page, { requestedUrls }) => {
      const loadedPaths = requestedUrls.map(value => {
        try { return new URL(value).pathname; } catch (_) { return ''; }
      });
      // The shared normalizer remains legitimately used by the About Hero/Footer.
      // This assertion targets page-specific project card/Gallery/Lightbox code.
      const unexpectedFeatureModules = loadedPaths.filter(path =>
        path === '/js/features/projects/index.js' ||
        path === '/js/features/projects/browser-runtime.js' ||
        path === '/js/features/projects/project-loader.js' ||
        path === '/js/features/projects/project-card.js' ||
        path === '/js/features/projects/card-presentation.js' ||
        path === '/js/features/projects/project-media.js' ||
        path === '/js/features/projects/project-thumbnail.js' ||
        path === '/js/features/gallery/index.js' ||
        path === '/js/features/gallery/presentation.js' ||
        path === '/js/features/lightbox/index.js' ||
        path === '/js/features/lightbox/media-renderer.js' ||
        path === '/js/features/lightbox/foil-normal-renderer.js'
      );
      if (unexpectedFeatureModules.length) {
        throw new Error('About page should not request Gallery/Lightbox module graphs: ' +
          JSON.stringify(unexpectedFeatureModules));
      }
      const projectDataRequestCount = loadedPaths.filter(path => path === '/data/projects.json').length;
      if (projectDataRequestCount > 1) {
        throw new Error('About Hero/Footer should share one projects.json request; observed ' +
          projectDataRequestCount + ' requests.');
      }
      const aboutDataRequestCount = loadedPaths.filter(path => path === '/data/about.json').length;
      if (aboutDataRequestCount > 1) {
        throw new Error('About rendering and asset preloading should share one about.json request; observed ' +
          aboutDataRequestCount + ' requests.');
      }
      const showReviews = await page.evaluate(async () => {
        try {
          const response = await fetch('/data/settings.json');
          const settings = response.ok ? await response.json() : {};
          return settings.showReviews === true;
        } catch (_) {
          return false;
        }
      });
      const reviewsModuleLoaded = loadedPaths.includes('/js/features/reviews/index.js');
      const reviewsDataLoaded = loadedPaths.includes('/data/reviews.json');
      if (!showReviews && (reviewsModuleLoaded || reviewsDataLoaded)) {
        throw new Error('Reviews is disabled in settings but its module/data was requested on About.');
      }
      if (showReviews && !reviewsModuleLoaded) {
        throw new Error('Reviews is enabled in settings but the feature module was not requested on About.');
      }
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
      await page.waitForFunction(() =>
        Boolean(document.querySelector('.about-hero .hero-banner')) &&
        ['light', 'dark'].includes(document.querySelector('.site-logo')?.dataset?.logoForeground),
        null,
        { timeout: 2500 }
      );



      const aboutFilterRailCount = await page.locator('.about-filter-rail, .about-filter-link').count();
      if (aboutFilterRailCount !== 0) {
        throw new Error('About page must not render Works category filter tabs; found ' + aboutFilterRailCount + ' rail elements.');
      }

      // The About hero keeps a dark scrim for text readability. Ensure the logo
      // uses composited visible luminance, not raw source pixels, so a bright
      // still selects a dark mark and a dark still restores the white mark.
      await page.evaluate(async () => {
        const banner = document.querySelector('.about-hero .hero-banner');
        const logo = document.querySelector('.site-logo');
        if (!banner || !logo) throw new Error('About adaptive-logo fixture could not find the hero banner and site logo.');
        const originals = Array.from(banner.querySelectorAll('.slide'));
        window.__lmAboutLogoSlideSnapshot = originals.map(slide => ({
          slide,
          className: slide.className,
          style: slide.getAttribute('style')
        }));
        originals.forEach(slide => slide.classList.remove('active'));
        const slide = document.createElement('div');
        slide.id = '__lm-about-logo-contrast-slide';
        slide.className = 'slide active';
        Object.assign(slide.style, { position: 'absolute', inset: '0', zIndex: '1', pointerEvents: 'none' });
        const image = document.createElement('img');
        image.id = '__lm-about-logo-contrast-image';
        image.alt = '';
        Object.assign(image.style, { display: 'block', width: '100%', height: '100%', objectFit: 'cover' });
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#ffffff"/></svg>'
        );
        slide.appendChild(image);
        banner.appendChild(slide);
        await image.decode();
        logo.dataset.logoForeground = 'light';
        logo.style.filter = 'brightness(0) invert(1)';
        window.dispatchEvent(new Event('resize'));
      });
      await page.waitForFunction(
        () => document.querySelector('.site-logo')?.dataset?.logoForeground === 'dark',
        null,
        { timeout: 2500 }
      );
      await page.evaluate(async () => {
        const image = document.getElementById('__lm-about-logo-contrast-image');
        const logo = document.querySelector('.site-logo');
        if (!image || !logo) throw new Error('About adaptive-logo fixture disappeared before its dark-media check.');
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#000000"/></svg>'
        );
        await image.decode();
        logo.dataset.logoForeground = 'dark';
        logo.style.filter = 'brightness(0)';
        window.dispatchEvent(new Event('resize'));
      });
      await page.waitForFunction(
        () => document.querySelector('.site-logo')?.dataset?.logoForeground === 'light',
        null,
        { timeout: 2500 }
      );
      await page.evaluate(() => {
        document.getElementById('__lm-about-logo-contrast-slide')?.remove();
        (window.__lmAboutLogoSlideSnapshot || []).forEach(({ slide, className, style }) => {
          slide.className = className;
          if (style === null) slide.removeAttribute('style');
          else slide.setAttribute('style', style);
        });
        delete window.__lmAboutLogoSlideSnapshot;
        window.dispatchEvent(new Event('scroll'));
      });

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
        if (!src?.includes('/assets/projects/site/logos/adobe-after-effects-cc.webp')) {
          throw new Error('About page After Effects logo left its bundled Adobe asset path.');
        }
      }

      const aboutFooter = await page.evaluate(async () => {
        let showFooterMessage = false;
        try {
          const response = await fetch('/data/settings.json');
          const settings = response.ok ? await response.json() : {};
          showFooterMessage = settings.showFooterMessage === true;
        } catch (_) {}
        const footer = document.querySelector('footer');
        const media = document.querySelector('#footerAnimation');
        const fade = document.querySelector('.footer-fade');
        const content = document.querySelector('.footer-content');
        const mediaStyle = media ? getComputedStyle(media) : null;
        const fadeStyle = fade ? getComputedStyle(fade) : null;
        return {
          showFooterMessage,
          exists: !!footer && !!media && !!fade && !!content,
          mediaHidden: !!media?.hidden,
          mediaDisplay: mediaStyle?.display || 'none',
          mediaHeight: media?.getBoundingClientRect().height || 0,
          slides: media?.querySelectorAll('.footer-animation-slide').length || 0,
          activeSlides: media?.querySelectorAll('.footer-animation-slide.active').length || 0,
          contentBackgroundAlpha: (() => {
            const style = content ? getComputedStyle(content) : null;
            const match = style?.backgroundColor.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)$/);
            return match ? Number(match[1]) : 0;
          })(),
          hasMessage: !!content?.querySelector('.footer-hero-message'),
          footerHeight: footer?.getBoundingClientRect().height || 0,
          fadePosition: fadeStyle?.position || '',
          fadeZ: fadeStyle?.zIndex || '',
          fadeDisplay: fadeStyle?.display || 'none',
          contentZ: content ? getComputedStyle(content).zIndex : '',
          contentColor: content ? getComputedStyle(content).color : '',
          socialColors: Array.from(document.querySelectorAll('footer .social-icons a')).map(a => getComputedStyle(a).color)
        };
      });
      if (!aboutFooter.exists) throw new Error('About page footer surface is missing.');
      if (aboutFooter.mediaHidden || aboutFooter.mediaDisplay === 'none' ||
          aboutFooter.slides < 1 || aboutFooter.activeSlides !== 1 ||
          aboutFooter.mediaHeight < aboutFooter.footerHeight - 1) {
        throw new Error('About footer artwork must fill the footer and keep one active loop slide regardless of quote visibility: '+
          JSON.stringify(aboutFooter));
      }
      if (aboutFooter.showFooterMessage) {
        if (!aboutFooter.hasMessage || aboutFooter.contentBackgroundAlpha < 0.1) {
          throw new Error('About footer quote must appear over the footer-content scrim when enabled: '+JSON.stringify(aboutFooter));
        }
      } else if (aboutFooter.hasMessage || aboutFooter.contentBackgroundAlpha > 0.01) {
        throw new Error('About footer quote and scrim must be absent when the quote toggle is disabled: '+JSON.stringify(aboutFooter));
      }
      if (aboutFooter.footerHeight < 420 || aboutFooter.fadePosition !== 'absolute' ||
          aboutFooter.fadeZ !== '1' || aboutFooter.contentZ !== '6') {
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

      await logRuntimeProfile(page, 'About 390x844', requestedUrls);

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
      await waitForContactViewportAlignment(page);
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
      await assertPublicNavigation(page, {
        href: '../',
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

    await smokePage(browser, '/', async (page, { requestedUrls }) => {
      await page.locator('.hamburger').first().click();
      const contact = page.locator('.nav-links a[href="#contact-start"]').first();
      if (await contact.count() !== 1) throw new Error('Mobile Works Contact navigation link is missing.');
      await contact.click();
      await waitForContactViewportAlignment(page);
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
      await logRuntimeProfile(page, 'Works 390x844', requestedUrls);
    }, { width: 390, height: 844 });

    await smokePage(browser, '/', async page => {
      await page.waitForFunction(() => {
        const transition = document.querySelector('#pageTransition');
        return transition?.dataset.loading === 'ready' &&
          transition.getAttribute('aria-hidden') === 'true';
      }, null, { timeout: 6000 });

      let selectionSnapshot = null;
      await page.exposeFunction('__lmCaptureNavSelectionState', snapshot => {
        selectionSnapshot = snapshot;
      });

      await page.locator('.hamburger').first().click();
      const menu = page.locator('.nav-links.active.is-open');
      await menu.waitFor({ state: 'visible', timeout: 2000 });
      const aboutLink = page.locator('.nav-links a[href="about/"]').first();
      if (await aboutLink.count() !== 1) {
        throw new Error('Mobile selection animation test cannot find the About Me link.');
      }

      await aboutLink.evaluate(link => {
        link.addEventListener('animationend', event => {
          if (event.animationName !== 'nav-link-select') return;
          const menu = document.querySelector('.nav-links');
          const oldActive = menu?.querySelector('a.active-link:not(.is-selected)');
          const oldActiveStyle = oldActive ? getComputedStyle(oldActive) : null;
          void window.__lmCaptureNavSelectionState({
            pathname: window.location.pathname,
            bodyMenuOpen: document.body.classList.contains('menu-open'),
            menuOpen: Boolean(menu?.classList.contains('active') && menu?.classList.contains('is-open')),
            selectionMode: Boolean(menu?.classList.contains('has-selection')),
            selectedCount: menu?.querySelectorAll('a.is-selected').length || 0,
            selected: link.classList.contains('is-selected'),
            background: getComputedStyle(link).backgroundColor,
            color: getComputedStyle(link).color,
            oldActiveBackground: oldActiveStyle?.backgroundColor || '',
            oldActiveColor: oldActiveStyle?.color || ''
          });
        });
      });

      const aboutNavigation = page.waitForURL(
        url => url.pathname === '/about' || url.pathname === '/about/',
        { timeout: 8000, waitUntil: 'domcontentloaded' }
      );
      await aboutLink.click();
      await aboutNavigation;

      if (!selectionSnapshot) {
        throw new Error('Mobile navigation changed pages without completing the selected-link animation.');
      }
      if (
        selectionSnapshot.pathname !== '/' ||
        !selectionSnapshot.bodyMenuOpen ||
        !selectionSnapshot.menuOpen ||
        !selectionSnapshot.selectionMode ||
        selectionSnapshot.selectedCount !== 1 ||
        !selectionSnapshot.selected ||
        selectionSnapshot.background !== 'rgb(255, 255, 255)' ||
        selectionSnapshot.color !== 'rgb(0, 0, 0)' ||
        selectionSnapshot.oldActiveBackground !== 'rgb(0, 0, 0)' ||
        selectionSnapshot.oldActiveColor !== 'rgb(255, 255, 255)'
      ) {
        throw new Error('Mobile navigation did not show the selected pill before closing/navigating: ' +
          JSON.stringify(selectionSnapshot));
      }
      await page.locator('#aboutHeadline').waitFor({ state: 'visible', timeout: 5000 });
    }, { width: 390, height: 844 });

    let cmsSmokePngMediaSha = 'smoke-png-existing';
    let cmsSmokePngUploadPayload = null;
    let cmsSmokeJpegWebPMediaSha = 'smoke-jpeg-webp';
    let cmsSmokeJpegOriginalMediaSha = 'smoke-jpeg-original';
    let cmsSmokeJpegUploadPayload = null;
    let cmsSmokeJpegUploadPath = '';
    let cmsSmokeProjectsUploadPayload = null;
    // Model the Git Data API used by batch uploads with one immutable parent
    // tree, blob storage, and a guarded branch-ref update.
    let cmsSmokeBranchHead = 'smoke-main-head';
    let cmsSmokeCurrentTreeSha = 'smoke-main-tree';
    let cmsSmokeTreeSequence = 0;
    let cmsSmokeCommitSequence = 0;
    let cmsSmokeBlobSequence = 0;
    const cmsSmokeGitBlobs = new Map();
    const cmsSmokePendingTrees = new Map();
    const cmsSmokeCommitParents = new Map([['smoke-main-head', null]]);
    const cmsSmokeCommitTreeBySha = new Map([['smoke-main-head', 'smoke-main-tree']]);
    let cmsSmokeGitTree = [
      { type: 'tree', path: 'assets', sha: 'smoke-assets' },
      { type: 'tree', path: 'assets/projects', sha: 'smoke-projects' },
      { type: 'blob', path: 'assets/projects/smoke.png', sha: 'smoke-png-existing', size: 12, mode: '100644' },
      { type: 'blob', path: 'assets/projects/smoke-jpeg.webp', sha: 'smoke-jpeg-webp', size: 12, mode: '100644' },
      { type: 'blob', path: 'assets/projects/smoke-jpeg.jpg', sha: 'smoke-jpeg-original', size: 12, mode: '100644' },
      { type: 'blob', path: 'assets/projects/Sample.json', sha: 'smoke-lottie', size: 12, mode: '100644' },
      { type: 'blob', path: 'assets/projects/Female base.obj', sha: 'smoke-model', size: 12, mode: '100644' },
      { type: 'blob', path: 'assets/projects/idle.mp4', sha: 'smoke-video', size: 12, mode: '100644' },
      { type: 'blob', path: 'assets/projects/rename-folder/rename-target.obj', sha: 'smoke-rename-folder', size: 12, mode: '100644' }
    ];
    await smokePage(
      browser,
      '/',
      async page => {
        // Control placement is CSS-owned. Do not make geometry validation
        // depend on the Gallery/media preload finishing or a project opening.
        await page.locator('#lightboxClose').waitFor({ state: 'attached', timeout: 5000 });
        await page.locator('.lightbox-prev').first().waitFor({ state: 'attached', timeout: 5000 });
        await page.locator('.lightbox-next').first().waitFor({ state: 'attached', timeout: 5000 });
        await assertLightboxChromeAlignment(page, 'Desktop Works', 'desktop');
      },
      { width: 1280, height: 900 }
    );

    await smokePage(
      browser,
      '/',
      async page => {
        // Exercise the capped-container branch of --lm-lightbox-control-edge,
        // which is not reached at 1280px (where the edge equals the page gutter).
        await page.locator('#lightboxClose').waitFor({ state: 'attached', timeout: 5000 });
        await page.locator('.lightbox-prev').first().waitFor({ state: 'attached', timeout: 5000 });
        await page.locator('.lightbox-next').first().waitFor({ state: 'attached', timeout: 5000 });
        await assertLightboxChromeAlignment(page, 'Wide Desktop Works', 'desktop');
      },
      { width: 1600, height: 900 }
    );

    await smokePage(
      browser,
      '/',
      async page => {
        // The hidden controls still have their fixed-position geometry;
        // keeping the Lightbox closed isolates alignment from media loading.
        await page.locator('#lightboxClose').waitFor({ state: 'attached', timeout: 5000 });
        await page.locator('.lightbox-prev').first().waitFor({ state: 'attached', timeout: 5000 });
        await page.locator('.lightbox-next').first().waitFor({ state: 'attached', timeout: 5000 });
        await assertLightboxChromeAlignment(page, 'Mobile Works', 'mobile');
      },
      { width: 390, height: 844 }
    );

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

      const cmsMediaValidation = await page.evaluate(() => {
        const check = (type, src) => {
          try {
            window.validateCmsMediaSource(type, src, 'Smoke media');
            return true;
          } catch (_) {
            return false;
          }
        };
        return {
          available: typeof window.validateCmsMediaSource === 'function',
          validImage: check('image', 'assets/projects/site/portfolio-logo.webp'),
          validVideoWithQuery: check('video', 'assets/projects/site/banner/hero-reel.mp4?v=smoke'),
          validExternalDynamicUrl: check('video', 'https://media.example.test/stream?id=smoke'),
          rejectsImageAsVideo: !check('video', 'assets/projects/site/portfolio-logo.webp'),
          rejectsVideoAsImage: !check('image', 'assets/projects/site/banner/hero-reel.mp4'),
          rejectsImageAsLottie: !check('lottie', 'assets/projects/site/portfolio-logo.webp'),
          rejectsDataUrl: !check('image', 'data:image/png;base64,AAAA'),
          rejectsBlobUrl: !check('video', 'blob:https://example.test/temporary-id'),
          rejectsNonAssetLocalPath: !check('image', 'data/hero-loop.json')
        };
      });
      if (Object.values(cmsMediaValidation).some(value => value !== true)) {
        throw new Error('CMS media source validation failed its valid/invalid source contract: ' + JSON.stringify(cmsMediaValidation));
      }

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
        () => ['Deploying…', 'Checking Pages deployment…'].includes(document.querySelector('#saveStatusText')?.textContent?.trim()),
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

      // PNG artwork and masks must survive CMS upload byte-for-byte.
      // This protects transparency and grayscale foil maps from lossy canvas
      // conversion while preserving the existing-file SHA/cache-key contract.
      await page.locator('#content #uploadPath').fill('assets/projects');
      const smokePngBytes = readFileSync(new URL('../assets/projects/site/favicon.png', import.meta.url));
      if (smokePngBytes.length < 24 ||
          smokePngBytes.toString('ascii', 1, 4) !== 'PNG') {
        throw new Error('CMS PNG preservation fixture is not a readable PNG.');
      }
      const expectedImageDimensions = {
        width: smokePngBytes.readUInt32BE(16),
        height: smokePngBytes.readUInt32BE(20)
      };
      await page.locator('#content #fileInput').setInputFiles({
        name: 'smoke.png',
        mimeType: 'image/png',
        buffer: smokePngBytes
      });
      await page.waitForFunction(() => {
        const image = Array.from(document.querySelectorAll('#content #mediaGrid .media-tile img'))
          .find(node => {
            const tile=node.closest('.media-tile');
            return tile?.textContent?.includes('smoke.png') && tile.querySelector('[data-copy]') && tile.querySelector('[data-del]');
          });
        return image && new URL(image.src).searchParams.get('v') === 'smoke-png-re';
      }, null, { timeout: 8000 });
      if (!cmsSmokePngUploadPayload || cmsSmokePngUploadPayload.sha !== 'smoke-png-existing') {
        throw new Error('CMS PNG replacement did not overwrite the file present in the captured parent tree.');
      }
      const uploadedPngBytes = Buffer.from(cmsSmokePngUploadPayload.content || '', 'base64');
      if (!uploadedPngBytes.equals(smokePngBytes)) {
        throw new Error('CMS altered PNG bytes; source artwork and foil masks must remain unchanged.');
      }
      const uploadedPngDimensions = {
        width: uploadedPngBytes.readUInt32BE(16),
        height: uploadedPngBytes.readUInt32BE(20)
      };
      if (uploadedPngDimensions.width !== expectedImageDimensions.width ||
          uploadedPngDimensions.height !== expectedImageDimensions.height) {
        throw new Error('CMS PNG preservation changed source dimensions: ' +
          JSON.stringify({ expected: expectedImageDimensions, actual: uploadedPngDimensions }));
      }

      // JPEGs may convert to WebP only when the encoded result is smaller.
      // The smoke test accepts either the optimized WebP path or the exact
      // original JPEG fallback and verifies both payload and existing SHA.
      const smokeJpegBytes = readFileSync(new URL('../assets/projects/site/og-image.jpg', import.meta.url));
      const smokeJpegBase64 = smokeJpegBytes.toString('base64');
      const expectedJpegDimensions = await page.evaluate(async base64 => {
        const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
        try {
          const image = new Image();
          image.src = objectUrl;
          await image.decode();
          return { width: image.naturalWidth, height: image.naturalHeight };
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }, smokeJpegBase64);
      await page.locator('#content #fileInput').setInputFiles({
        name: 'smoke-jpeg.jpg',
        mimeType: 'image/jpeg',
        buffer: smokeJpegBytes
      });
      await page.waitForFunction(() => {
        const tiles = Array.from(document.querySelectorAll('#content #mediaGrid .media-tile img'));
        return tiles.some(image => {
          const tile=image.closest('.media-tile');
          const name=tile?.textContent||'';
          const version=new URL(image.src).searchParams.get('v');
          if(!tile?.querySelector('[data-copy]')||!tile.querySelector('[data-del]'))return false;
          return (name.includes('smoke-jpeg.webp')&&version==='smoke-jpeg-r') ||
            (name.includes('smoke-jpeg.jpg')&&version==='smoke-jpg-re');
        });
      }, null, { timeout: 8000 });
      if (!cmsSmokeJpegUploadPayload || !cmsSmokeJpegUploadPath) {
        throw new Error('CMS JPEG upload did not reach the mocked existing-file endpoint.');
      }
      const jpegConvertedToWebP = cmsSmokeJpegUploadPath.endsWith('.webp');
      const expectedJpegSha = jpegConvertedToWebP ? 'smoke-jpeg-webp' : 'smoke-jpeg-original';
      const expectedJpegName = jpegConvertedToWebP ? 'smoke-jpeg.webp' : 'smoke-jpeg.jpg';
      if (cmsSmokeJpegUploadPayload.sha !== expectedJpegSha) {
        throw new Error('CMS JPEG replacement did not overwrite the captured existing blob for ' + expectedJpegName + '.');
      }
      const uploadedJpegBytes = Buffer.from(cmsSmokeJpegUploadPayload.content || '', 'base64');
      let uploadedJpegMime;
      if (jpegConvertedToWebP) {
        if (uploadedJpegBytes.toString('ascii', 0, 4) !== 'RIFF' ||
            uploadedJpegBytes.toString('ascii', 8, 12) !== 'WEBP') {
          throw new Error('CMS JPEG conversion did not produce a valid WebP payload.');
        }
        if (uploadedJpegBytes.length >= smokeJpegBytes.length) {
          throw new Error('CMS kept a WebP conversion that was not smaller than the original JPEG.');
        }
        uploadedJpegMime = 'image/webp';
      } else {
        if (!cmsSmokeJpegUploadPath.endsWith('.jpg') || !uploadedJpegBytes.equals(smokeJpegBytes)) {
          throw new Error('CMS JPEG fallback did not preserve the original filename and bytes.');
        }
        uploadedJpegMime = 'image/jpeg';
      }
      const uploadedJpegDimensions = await page.evaluate(async ({ base64, mime }) => {
        const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
        try {
          const image = new Image();
          image.src = objectUrl;
          await image.decode();
          return { width: image.naturalWidth, height: image.naturalHeight };
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }, { base64: cmsSmokeJpegUploadPayload.content, mime: uploadedJpegMime });
      if (uploadedJpegDimensions.width !== expectedJpegDimensions.width ||
          uploadedJpegDimensions.height !== expectedJpegDimensions.height) {
        throw new Error('CMS JPEG upload changed pixel dimensions: ' +
          JSON.stringify({ expected: expectedJpegDimensions, actual: uploadedJpegDimensions }));
      }

      // Each CMS media tile opens a full-size type-aware preview. Exercise image,
      // Lottie, video, and 3D model previews before navigating away.
      const fullPreview = page.locator('.media-full-preview-overlay');
      const closeFullPreview = async () => {
        await fullPreview.locator('[aria-label="Close full preview"]').click();
        await fullPreview.waitFor({ state: 'detached', timeout: 3000 });
      };

      const expectedJpegPreviewVersion=jpegConvertedToWebP?'smoke-jpeg-r':'smoke-jpg-re';
      const uploadedJpegTile=page.locator('#content .media-tile:has([data-copy]):has(img[src*="v='+expectedJpegPreviewVersion+'"])').filter({hasText:expectedJpegName});
      await uploadedJpegTile.locator('.thumb').click();
      await fullPreview.waitFor({ state: 'visible', timeout: 3000 });
      await fullPreview.locator('.media-full-preview-stage > img').waitFor({ state: 'visible', timeout: 5000 });
      const fullFileSize = (await fullPreview.locator('.media-full-preview-size').textContent()).trim();
      const expectedFullFileSizeBytes=Buffer.from(cmsSmokeJpegUploadPayload.content||'','base64').length;
      if (!fullFileSize.includes(expectedFullFileSizeBytes.toLocaleString('en-US')+' bytes')) {
        throw new Error('CMS full asset preview must display the exact GitHub repository file size. Expected '+expectedFullFileSizeBytes+' bytes, received '+fullFileSize+'.');
      }
      const fullImageFit = await fullPreview.locator('.media-full-preview-stage > img').evaluate(el => getComputedStyle(el).objectFit);
      if (fullImageFit !== 'contain') throw new Error('CMS full image preview does not preserve the whole artwork in view.');
      await page.keyboard.press('Escape');
      await fullPreview.waitFor({ state: 'detached', timeout: 3000 });

      await page.locator('#content .media-tile').filter({ hasText: 'Sample.json' }).locator('.thumb').click();
      await fullPreview.waitFor({ state: 'visible', timeout: 3000 });
      await fullPreview.locator('.media-full-preview-stage > lottie-player').waitFor({ state: 'attached', timeout: 10000 });
      await closeFullPreview();

      await page.locator('#content .media-tile').filter({ hasText: 'idle.mp4' }).locator('.thumb').click();
      await fullPreview.waitFor({ state: 'visible', timeout: 3000 });
      const fullVideo = fullPreview.locator('.media-full-preview-stage > video');
      await fullVideo.waitFor({ state: 'attached', timeout: 3000 });
      if (!(await fullVideo.evaluate(el => el.controls && el.playsInline))) {
        throw new Error('CMS full video preview is missing native controls or inline playback.');
      }
      await closeFullPreview();

      await page.locator('#content .media-tile').filter({ hasText: 'Female base.obj' }).locator('.thumb').click();
      await fullPreview.waitFor({ state: 'visible', timeout: 3000 });
      await fullPreview.locator('.media-full-preview-model canvas').waitFor({ state: 'attached', timeout: 12000 });
      await page.waitForFunction(() => document.querySelector('.media-full-preview-model')?.dataset.ready === 'true', null, { timeout: 12000 });
      await closeFullPreview();

      // Exercise the actual Media Library Rename controls, not only the
      // extracted function contract. Folder rename must retain its contents,
      // and file rename must remove the old path and expose the new one.
      const renamePromptAnswers=['renamed-folder','smoke-renamed.png'];
      const renameDialogHandler=async dialog=>{
        if(dialog.type()==='prompt'){
          const answer=renamePromptAnswers.shift();
          if(answer===undefined){await dialog.dismiss();return;}
          await dialog.accept(answer);
        }else if(dialog.type()==='confirm'){
          await dialog.accept();
        }else{
          await dialog.dismiss();
        }
      };
      page.on('dialog',renameDialogHandler);
      try{
        const folderRenameButton=page.locator('#content .folder-tile')
          .filter({hasText:'rename-folder'})
          .locator('[data-folder-rename]');
        await folderRenameButton.waitFor({state:'visible',timeout:5000});
        if ((await folderRenameButton.getAttribute('aria-label')) !== 'Rename folder' ||
            (await folderRenameButton.textContent()).trim() !== '') {
          throw new Error('Media Library folder action must be icon-only with an accessible Rename folder name.');
        }
        await folderRenameButton.click();
        try{
          await page.waitForFunction(
            () => document.querySelector('#crumbs button:last-child')?.textContent?.trim()==='renamed-folder',
            null,
            {timeout:10000}
          );
        }catch(error){
          const currentCrumb=(await page.locator('#crumbs button').last().textContent().catch(()=>'' )).trim();
          const operationStatus=(await page.locator('#mediaOperationStatus').textContent().catch(()=>'' )).trim();
          throw new Error('CMS folder Rename did not navigate into the renamed folder. Current crumb: '+currentCrumb+'. Operation status: '+(operationStatus||'(no status message)')+'. '+error.message);
        }
        const renamedFolderCrumb=(await page.locator('#crumbs button').last().textContent()).trim();
        if(renamedFolderCrumb!=='renamed-folder'){
          throw new Error('CMS folder Rename did not navigate into the renamed folder: '+renamedFolderCrumb);
        }
        await page.locator('#content .media-tile:has([data-rename])')
          .filter({hasText:'rename-target.obj'})
          .waitFor({state:'visible',timeout:8000});
        await page.locator('#crumbs button').nth(1).click();
        const fileRenameButton=page.locator('#content .media-tile:has([data-rename])')
          .filter({hasText:'smoke.png'})
          .locator('[data-rename]');
        await fileRenameButton.waitFor({state:'visible',timeout:8000});
        const renameAccessibleName=await fileRenameButton.getAttribute('aria-label');
        const renameVisibleLabel=(await fileRenameButton.textContent()).trim();
        const copyPathButton=page.locator('#content .media-tile:has([data-rename])')
          .filter({hasText:'smoke.png'}).locator('[data-copy]');
        const deleteButton=page.locator('#content .media-tile:has([data-rename])')
          .filter({hasText:'smoke.png'}).locator('[data-del]');
        if(renameAccessibleName!=='Rename file'||renameVisibleLabel!==''||
           await copyPathButton.getAttribute('aria-label')!=='Copy file path'||
           (await copyPathButton.textContent()).trim()!==''||
           await deleteButton.getAttribute('aria-label')!=='Delete file'||
           (await deleteButton.textContent()).trim()!==''){
          throw new Error('Media Library file actions must be icon-only and retain accessible names for Rename, Copy path, and Delete.');
        }
        await fileRenameButton.click();
        await page.locator('#content .media-tile:has([data-rename])')
          .filter({hasText:'smoke-renamed.png'})
          .waitFor({state:'visible',timeout:8000});
        const oldPathTileCount=await page.locator('#content .media-tile:has([data-rename])')
          .filter({hasText:'smoke.png'}).count();
        if(oldPathTileCount!==0){
          throw new Error('CMS file Rename left the previous smoke.png tile visible after commit.');
        }
      }finally{
        page.off('dialog',renameDialogHandler);
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
      if (!['Deploying…', 'Checking Pages deployment…'].includes(savingStatus)) {
        throw new Error(`CMS save did not enter deployment tracking state (found "${savingStatus}").`);
      }
      await mediaNav.click();
      if (['Deploying…', 'Checking Pages deployment…'].includes((await page.locator('#saveStatusText').textContent()).trim())) {
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

      // The selected foil preset must survive repeated changes, the actual CMS
      // save payload, and a fresh editor reload—not only remain selected in DOM.
      const holographicMedia = testProject.locator('[data-medialist] .card-item')
        .filter({ hasText: 'Holographic image fixture' }).first();
      if (await holographicMedia.count() !== 1) {
        throw new Error('CMS foil style persistence fixture is missing its image media row.');
      }
      const holographicBody = holographicMedia.locator('[data-mbody]').first();
      const holographicBodyStyle = await holographicBody.getAttribute('style');
      if (!holographicBodyStyle?.includes('display:block')) {
        await holographicMedia.locator('[data-mact="toggle"]').click();
      }
      const holoStyleSelect = holographicMedia.locator('[data-holo-style]').first();
      if (await holoStyleSelect.count() !== 1 || !(await holoStyleSelect.isVisible())) {
        throw new Error('CMS foil style selector is not visible in the image editor.');
      }
      const holoEnabledInput = holographicMedia.locator('[data-holo-enabled]').first();
      if (!(await holoEnabledInput.isChecked())) {
        throw new Error('CMS foil fixture loaded with its holographic effect disabled.');
      }
      if (await holoStyleSelect.inputValue() !== 'iridescent') {
        throw new Error('CMS foil fixture did not start with its saved iridescent style.');
      }
      await holoStyleSelect.selectOption('cosmos');
      await holoStyleSelect.selectOption('aurora');
      if (await holoStyleSelect.inputValue() !== 'aurora') {
        throw new Error('CMS foil selector did not retain the latest style selection before saving.');
      }
      const dirtyDisplayAfterStyleChange = await page.locator('#dirty-projects').evaluate(el => getComputedStyle(el).display);
      if (dirtyDisplayAfterStyleChange === 'none') {
        throw new Error('Changing the foil preset did not mark the Projects section dirty.');
      }
      const projectsWritePromise = page.waitForRequest(request =>
        request.method() === 'PUT' &&
        new URL(request.url()).pathname === '/repos/Smoke/TestRepo/contents/data/projects.json',
        { timeout: 8000 }
      );
      await page.locator('#btnSaveTop').click();
      try {
        await projectsWritePromise;
      } catch (error) {
        const saveDiagnostics = await page.evaluate(() => ({
          status: document.querySelector('#saveStatusText')?.textContent?.trim() || '',
          dirtyDisplay: getComputedStyle(document.querySelector('#dirty-projects')).display,
          buttonText: document.querySelector('#btnSaveTop')?.textContent?.trim() || '',
          buttonDisabled: !!document.querySelector('#btnSaveTop')?.disabled,
          toast: Array.from(document.querySelectorAll('.toast,.toast-message,[role="alert"]'))
            .map(node => node.textContent?.trim() || '').filter(Boolean).slice(-3)
        }));
        throw new Error('Foil style change failed to write data/projects.json: ' +
          JSON.stringify(saveDiagnostics) + '; ' + error.message);
      }
      await page.waitForFunction(() => {
        const button = document.getElementById('btnSaveTop');
        return !!button && !button.disabled && !/Saving/.test(button.textContent || '');
      }, null, { timeout: 12000 });
      if (!cmsSmokeProjectsUploadPayload?.content) {
        throw new Error('The Projects save request was observed but its payload was not captured by the mock API.');
      }
      const savedProjectRows = JSON.parse(Buffer.from(
        String(cmsSmokeProjectsUploadPayload.content).replace(/\\s/g, ''), 'base64'
      ).toString('utf8'));
      const savedTestProject = savedProjectRows.find(project => project.id === 'test-project');
      const savedFoilStyle = savedTestProject?.media?.find(media =>
        media.caption === 'Holographic image fixture'
      )?.holographic?.style;
      if (savedFoilStyle !== 'aurora') {
        throw new Error('CMS save payload did not preserve the final foil style selection: ' +
          JSON.stringify({ savedFoilStyle }));
      }

      await page.reload();
      await page.locator('#app.active').waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('#topbar.active').waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('.nav-item[data-section="hero"].active').waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('#content #heroList, #content #addHero').first().waitFor({ state: 'visible', timeout: 10000 });
      await projectsNav.click();
      await page.locator('#content #projList .card-item').first().waitFor({ state: 'visible', timeout: 10000 });
      const reloadedProject = page.locator('#content #projList .card-item')
        .filter({ hasText: 'Test Project' }).first();
      await reloadedProject.locator('[data-toggle-open]').click();
      const reloadedHolographicMedia = reloadedProject.locator('[data-medialist] .card-item')
        .filter({ hasText: 'Holographic image fixture' }).first();
      const reloadedHolographicBody = reloadedHolographicMedia.locator('[data-mbody]').first();
      const reloadedBodyStyle = await reloadedHolographicBody.getAttribute('style');
      if (!reloadedBodyStyle?.includes('display:block')) {
        await reloadedHolographicMedia.locator('[data-mact="toggle"]').click();
      }
      const reloadedHoloStyle = reloadedHolographicMedia.locator('[data-holo-style]').first();
      await reloadedHoloStyle.waitFor({ state: 'visible', timeout: 5000 });
      if (await reloadedHoloStyle.inputValue() !== 'aurora') {
        throw new Error('CMS foil style did not survive a fresh reload: ' +
          JSON.stringify({ saved: savedFoilStyle, reloaded: await reloadedHoloStyle.inputValue() }));
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
        filters: ['3d-motion'],
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
        filters: ['3d-motion'],
        description: '',
        thumbnail: { type: 'lottie', src: 'assets/projects/test/Sample.json', focus: '50% 50%', zoom: 1 },
        media: []
      }];
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(about))));
      let encodedProjects = btoa(unescape(encodeURIComponent(JSON.stringify(projectsFixture))));
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
        if (url.pathname.endsWith('.mp4')) {
          await route.fulfill({
            status: 200,
            contentType: 'video/mp4',
            body: readFileSync(new URL('../assets/projects/haeru/bts-idle-animation.mp4', import.meta.url))
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
        if (url.pathname === '/repos/Smoke/TestRepo/git/ref/heads/main' &&
            route.request().method() === 'GET') {
          await route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ref: 'refs/heads/main', object: { sha: cmsSmokeBranchHead } })
          });
          return;
        }
        if (url.pathname.startsWith('/repos/Smoke/TestRepo/git/commits/') &&
            route.request().method() === 'GET') {
          const commitSha = url.pathname.split('/').pop();
          await route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
              sha: commitSha,
              tree: { sha: cmsSmokeCommitTreeBySha.get(commitSha) || cmsSmokeCurrentTreeSha }
            })
          });
          return;
        }
        if (url.pathname === '/repos/Smoke/TestRepo/git/blobs' &&
            route.request().method() === 'POST') {
          const payload = route.request().postDataJSON();
          const bytes = Buffer.from(payload.content || '', payload.encoding === 'base64' ? 'base64' : 'utf8');
          let blobSha;
          if (bytes.length > 4 && bytes.toString('ascii', 1, 4) === 'PNG') blobSha = 'smoke-png-re';
          else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') blobSha = 'smoke-jpeg-r';
          else if (bytes[0] === 0xff && bytes[1] === 0xd8) blobSha = 'smoke-jpg-re';
          else blobSha = 'smoke-upload-blob-' + (++cmsSmokeBlobSequence);
          cmsSmokeGitBlobs.set(blobSha, { content: payload.content || '', encoding: payload.encoding || 'utf-8', size: bytes.length, bytes });
          await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ sha: blobSha, size: bytes.length }) });
          return;
        }
        if (url.pathname === '/repos/Smoke/TestRepo/git/trees' &&
            route.request().method() === 'POST') {
          const payload = route.request().postDataJSON();
          const treeSha = 'smoke-tree-' + (++cmsSmokeTreeSequence);
          cmsSmokePendingTrees.set(treeSha, { baseTree: payload.base_tree, entries: payload.tree || [] });
          await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ sha: treeSha, tree: [] }) });
          return;
        }
        if (url.pathname === '/repos/Smoke/TestRepo/git/commits' &&
            route.request().method() === 'POST') {
          const payload = route.request().postDataJSON();
          const commitSha = 'smoke-commit-' + (++cmsSmokeCommitSequence);
          cmsSmokeCommitParents.set(commitSha, (payload.parents || [])[0] || null);
          cmsSmokeCommitTreeBySha.set(commitSha, payload.tree);
          await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ sha: commitSha, tree: { sha: payload.tree }, parents: payload.parents || [] }) });
          return;
        }
        if (url.pathname === '/repos/Smoke/TestRepo/git/refs/heads/main' &&
            route.request().method() === 'PATCH') {
          const payload = route.request().postDataJSON();
          const commitSha = payload.sha;
          const parent = cmsSmokeCommitParents.get(commitSha);
          const nextTreeSha = cmsSmokeCommitTreeBySha.get(commitSha);
          const pending = cmsSmokePendingTrees.get(nextTreeSha);
          if (parent !== cmsSmokeBranchHead || !pending || pending.baseTree !== cmsSmokeCommitTreeBySha.get(parent)) {
            await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: 'Reference update conflict in smoke fixture.' }) });
            return;
          }
          const byPath = new Map(cmsSmokeGitTree.map(item => [item.path, { ...item }]));
          for (const entry of pending.entries) {
            if (entry.sha === null) {
              byPath.delete(entry.path);
              continue;
            }
            const previous = byPath.get(entry.path);
            const blob = cmsSmokeGitBlobs.get(entry.sha);
            if (entry.path === 'assets/projects/smoke.png' && blob) {
              cmsSmokePngUploadPayload = { sha: previous?.sha || '', content: blob.content };
              cmsSmokePngMediaSha = entry.sha;
            }
            if (entry.path.startsWith('assets/projects/smoke-jpeg.') &&
                (entry.path.endsWith('.webp') || entry.path.endsWith('.jpg')) && blob) {
              cmsSmokeJpegUploadPayload = { sha: previous?.sha || '', content: blob.content };
              cmsSmokeJpegUploadPath = entry.path;
              if (entry.path.endsWith('.webp')) cmsSmokeJpegWebPMediaSha = entry.sha;
              else cmsSmokeJpegOriginalMediaSha = entry.sha;
            }
            byPath.set(entry.path, {
              type: entry.type || 'blob',
              path: entry.path,
              sha: entry.sha,
              mode: entry.mode || previous?.mode || '100644',
              size: blob?.size ?? previous?.size ?? 12
            });
          }
          cmsSmokeGitTree = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
          cmsSmokeBranchHead = commitSha;
          cmsSmokeCurrentTreeSha = nextTreeSha;
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ref: 'refs/heads/main', object: { sha: commitSha } }) });
          return;
        }
        if (url.pathname.startsWith('/repos/Smoke/TestRepo/contents/') && route.request().method() === 'PUT') {
          if (url.pathname === '/repos/Smoke/TestRepo/contents/data/projects.json') {
            cmsSmokeProjectsUploadPayload = route.request().postDataJSON();
            if (typeof cmsSmokeProjectsUploadPayload?.content === 'string') {
              // Keep the save as the fixture source of truth so a real page
              // reload exercises the exact persisted JSON bytes.
              encodedProjects = cmsSmokeProjectsUploadPayload.content.replace(/\\s/g, '');
            }
          }
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
        if (url.pathname.startsWith('/repos/Smoke/TestRepo/commits/') &&
            url.pathname.endsWith('/check-runs') &&
            route.request().method() === 'GET') {
          // The CMS follows the current branch head while a save is in flight,
          // so the checked SHA may change from smoke-save-commit to the modeled
          // branch head. Serve the explicit Pages checks for every fixture SHA
          // instead of returning a browser-visible 404 for those valid lookups.
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              check_runs: [
                { name: 'build', status: 'in_progress', conclusion: null, details_url: 'https://github.com/Smoke/TestRepo/actions' },
                { name: 'deploy', status: 'in_progress', conclusion: null, details_url: 'https://github.com/Smoke/TestRepo/actions' },
                { name: 'report-build-status', status: 'in_progress', conclusion: null, details_url: 'https://github.com/Smoke/TestRepo/actions' },
                { name: 'validate', status: 'in_progress', conclusion: null, details_url: 'https://github.com/Smoke/TestRepo/actions' }
              ]
            })
          });
          return;
        }
        if (url.pathname.startsWith('/repos/Smoke/TestRepo/git/trees/') &&
            route.request().method() === 'GET') {
          // Preserve the deliberate navigation race for the initial branch
          // tree load; commit-pinned reads return the same tree snapshot.
          if (url.pathname.endsWith('/git/trees/main')) {
            await new Promise(resolve => setTimeout(resolve, 250));
          }
          await route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ sha: cmsSmokeCurrentTreeSha, tree: cmsSmokeGitTree })
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
        // The Media Library reference scanner reads tracked text candidates
        // beyond the explicit fixtures above. Return empty tracked text files
        // for unmodeled Contents GETs so expected scan coverage does not flood
        // the browser console with fixture-only 404 responses. Public-site
        // local assets and all explicit CMS data fixtures remain separately checked.
        if(url.pathname.startsWith('/repos/Smoke/TestRepo/contents/') && route.request().method()==='GET'){
          const relativePath=decodeURIComponent(url.pathname.split('/contents/')[1]||'');
          await route.fulfill({
            status:200,
            contentType:'application/json',
            body:JSON.stringify({
              type:'file',
              name:relativePath.split('/').pop()||'fixture.txt',
              path:relativePath,
              sha:'smoke-empty-reference-'+relativePath.replace(/[^A-Za-z0-9]+/g,'-'),
              encoding:'base64',
              content:''
            })
          });
          return;
        }
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not found' }) });
      });
    });
    await smokePage(browser, '/', async page => {
      await assertFilterNavigationResponsive(page, 'Responsive filter navigation');
    }, { width: 1280, height: 900 });


    await smokePage(browser, '/?reduced-motion-thumbnail=1', async page => {
      await page.locator('#heroBanner .slide.active video').waitFor({ state: 'attached', timeout: 6000 });
      const reducedHeroState = await page.evaluate(() => {
        const video = document.querySelector('#heroBanner .slide.active video');
        const transition = document.querySelector('#pageTransition');
        return {
          preference: matchMedia('(prefers-reduced-motion: reduce)').matches,
          preload: video?.preload || '',
          poster: video?.poster || '',
          sourceAttribute: video?.getAttribute('src') || '',
          currentSrc: video?.currentSrc || '',
          paused: video?.paused ?? false,
          loading: transition?.dataset.loading || ''
        };
      });
      if (!reducedHeroState.preference || reducedHeroState.preload !== 'none' ||
          reducedHeroState.sourceAttribute || reducedHeroState.currentSrc ||
          !reducedHeroState.poster.endsWith('/assets/projects/site/og-image.jpg') ||
          !reducedHeroState.paused || reducedHeroState.loading !== 'ready') {
        throw new Error(
          'Reduced-motion hero must show a static poster without attaching/loading the video source or delaying startup: ' +
          JSON.stringify(reducedHeroState)
        );
      }

      const reduced = await page.evaluate(async () => {
        const { buildProjectThumbnailMedia } = await import('/js/features/projects/project-thumbnail.js?v=20261019-01');
        const options = { resolveAssetUrl: value => value, priority: true };
        const lottie = buildProjectThumbnailMedia(
          { type: 'lottie', src: 'data:application/json,%7B%7D' },
          'Lottie motion fixture',
          options
        );
        const video = buildProjectThumbnailMedia(
          { type: 'video', src: 'data:video/mp4;base64,AAAA' },
          'Video motion fixture',
          options
        );
        const image = buildProjectThumbnailMedia(
          { type: 'image', src: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E' },
          'Still image fixture',
          options
        );
        return {
          preference: matchMedia('(prefers-reduced-motion: reduce)').matches,
          lottieAutoplay: lottie.hasAttribute('autoplay'),
          lottieLoop: lottie.hasAttribute('loop'),
          videoAutoplay: video.autoplay,
          videoLoop: video.loop,
          videoPreload: video.preload,
          videoFetchPriority: video.fetchPriority,
          imageLoading: image.loading,
          imageFetchPriority: image.fetchPriority
        };
      });
      if (!reduced.preference || reduced.lottieAutoplay || reduced.lottieLoop ||
          reduced.videoAutoplay || reduced.videoLoop || reduced.videoPreload !== 'metadata' ||
          reduced.videoFetchPriority === 'high' || reduced.imageLoading !== 'eager' ||
          reduced.imageFetchPriority !== 'high') {
        throw new Error(
          'Project thumbnail media must respect prefers-reduced-motion while keeping still-image priority hints: ' +
          JSON.stringify(reduced)
        );
      }

      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const standard = await page.evaluate(async () => {
        const { buildProjectThumbnailMedia } = await import('/js/features/projects/project-thumbnail.js?v=20261019-01');
        const options = { resolveAssetUrl: value => value, priority: true };
        const lottie = buildProjectThumbnailMedia(
          { type: 'lottie', src: 'data:application/json,%7B%7D' },
          'Lottie motion fixture',
          options
        );
        const video = buildProjectThumbnailMedia(
          { type: 'video', src: 'data:video/mp4;base64,AAAA' },
          'Video motion fixture',
          options
        );
        return {
          preference: matchMedia('(prefers-reduced-motion: reduce)').matches,
          lottieAutoplay: lottie.hasAttribute('autoplay'),
          lottieLoop: lottie.hasAttribute('loop'),
          videoAutoplay: video.autoplay,
          videoLoop: video.loop,
          videoPreload: video.preload,
          videoFetchPriority: video.fetchPriority
        };
      });
      if (standard.preference || !standard.lottieAutoplay || !standard.lottieLoop ||
          !standard.videoAutoplay || !standard.videoLoop || standard.videoPreload !== 'auto' ||
          standard.videoFetchPriority !== 'high') {
        throw new Error(
          'Project thumbnail autoplay and looping must remain available when reduced motion is not requested: ' +
          JSON.stringify(standard)
        );
      }
    }, { width: 1280, height: 900 }, async page => {
      // Emulate the visitor's OS/browser preference before the app and feature modules load.
      await page.emulateMedia({ reducedMotion: 'reduce' });
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
