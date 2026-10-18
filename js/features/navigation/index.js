/**
 * Navigation feature.
 * Owns mobile menu state and its DOM event lifecycle.
 *
 * Public pages use the same markup:
 *   .hamburger -> #navLinks
 * The CMS has its own navigation implementation, so this feature stays
 * scoped to the portfolio pages only.
 */

import { foregroundForLuminance, sampleMediaLuminance } from '../../infrastructure/browser/media-contrast.js?v=20261018-08';

export function initNavigation({ root = globalThis.document, getCuratedViewSlug = () => '' } = {}) {
  const menuButton = root?.querySelector('.hamburger, .menu-button');
  const mobileMenu = root?.querySelector('.nav-links, .mobile-menu');
  const mobileMenuLinks = Array.from(
    root?.querySelectorAll('.nav-links a, .mobile-menu a') || []
  );

  if (!menuButton || !mobileMenu) {
    return {
      open() {},
      close() {},
      toggle() {},
      destroy() {}
    };
  }

  let isOpen = false;
  let closeTimer = null;
  let replayingMenuLink = false;
  let selectingMenuLink = false;
  const windowRef = root?.defaultView || globalThis.window;

  // A real DOM backdrop is more reliable than body::after: it remains fixed to
  // the viewport even while the document underneath is being scrolled.
  const menuBackdrop = root.createElement?.('div');
  if (menuBackdrop) {
    menuBackdrop.className = 'nav-menu-backdrop';
    menuBackdrop.setAttribute('aria-hidden', 'true');
    menuBackdrop.hidden = true;
    menuBackdrop.addEventListener('click', () => close());
    root.body?.appendChild(menuBackdrop);
  }

  function syncAria() {
    menuButton.setAttribute('aria-expanded', String(isOpen));
    menuButton.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
    syncHamburgerForeground();
  }

  function waitForMenuLinkSelection(link) {
    const reducedMotion = Boolean(
      windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    );
    if (reducedMotion) {
      // The selected colors should still reach one painted frame, even when
      // motion is reduced. Two RAFs let the instantaneous selected state be
      // painted before the menu closes without an animation delay.
      return new Promise(resolve => {
        if (typeof windowRef?.requestAnimationFrame === 'function') {
          windowRef.requestAnimationFrame(() => windowRef.requestAnimationFrame(resolve));
        } else if (typeof windowRef?.setTimeout === 'function') {
          windowRef.setTimeout(resolve, 0);
        } else {
          resolve();
        }
      });
    }

    // Wait for both the selected-pill transform and its foreground/background
    // transitions. The menu must remain open until this selected state lands.
    if (typeof link?.getAnimations === 'function') {
      const activeAnimations = link.getAnimations()
        .filter(animation => animation.playState !== 'finished');
      if (activeAnimations.length) {
        return Promise.all(activeAnimations.map(animation =>
          Promise.resolve(animation.finished).catch(() => {})
        )).then(() => undefined);
      }
    }

    // Fallback for browsers without the Web Animations API. Keep this bounded
    // to the selected-state keyframe duration; reduced motion already exits above.
    const style = windowRef?.getComputedStyle?.(link);
    const names = String(style?.animationName || '')
      .split(',').map(name => name.trim());
    if (!names.includes('nav-link-select')) return Promise.resolve();

    const toMilliseconds = value => {
      const normalized = String(value || '0s').trim();
      const amount = Number.parseFloat(normalized);
      if (!Number.isFinite(amount)) return 0;
      return normalized.endsWith('ms') ? amount : amount * 1000;
    };
    const duration = String(style?.animationDuration || '0s').split(',')[0];
    const delay = String(style?.animationDelay || '0s').split(',')[0];
    const waitMs = Math.max(0, toMilliseconds(duration) + toMilliseconds(delay)) + 32;
    if (waitMs <= 32 || typeof windowRef?.setTimeout !== 'function') return Promise.resolve();
    return new Promise(resolve => windowRef.setTimeout(resolve, waitMs));
  }

  function finishClose(afterClose) {
    closeTimer = null;
    selectingMenuLink = false;
    mobileMenu.classList.remove('active', 'is-open', 'is-closing', 'has-selection');
    mobileMenuLinks.forEach(link => link.classList.remove('is-selected'));
    root.body?.classList.remove('menu-open');
    if (menuBackdrop) menuBackdrop.hidden = true;
    syncAria();
    if (typeof afterClose === 'function') afterClose();
  }

  function open() {
    if (closeTimer !== null) {
      windowRef?.clearTimeout?.(closeTimer);
      closeTimer = null;
    }
    isOpen = true;
    mobileMenu.classList.add('active', 'is-open');
    mobileMenu.classList.remove('is-closing', 'has-selection');
    mobileMenuLinks.forEach(link => link.classList.remove('is-selected'));
    menuButton.classList.add('is-open');
    root.body?.classList.add('menu-open');
    if (menuBackdrop) menuBackdrop.hidden = false;
    syncAria();
  }

  function close(afterClose, immediate = false) {
    if (!isOpen) {
      if (immediate) {
        if (closeTimer !== null) windowRef?.clearTimeout?.(closeTimer);
        finishClose(afterClose);
      }
      return;
    }

    isOpen = false;
    menuButton.classList.remove('is-open');
    mobileMenu.classList.add('is-closing');
    syncAria();

    const reducedMotion = Boolean(
      windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    );
    const duration = (immediate || reducedMotion) ? 0 : 260;
    if (closeTimer !== null) windowRef?.clearTimeout?.(closeTimer);

    if (duration === 0 || typeof windowRef?.setTimeout !== 'function') {
      finishClose(afterClose);
      return;
    }
    closeTimer = windowRef.setTimeout(() => finishClose(afterClose), duration);
  }

  function handleMobileMenuLinkSelection(event) {
    if (replayingMenuLink) {
      replayingMenuLink = false;
      return;
    }

    if (!isOpen || Number(windowRef?.innerWidth || 0) >= 768) return;
    const link = event.currentTarget;
    if (!link) return;

    event.preventDefault();
    event.stopImmediatePropagation?.();
    if (selectingMenuLink) return;

    selectingMenuLink = true;
    mobileMenu.classList.add('has-selection');
    mobileMenuLinks.forEach(item => item.classList.toggle('is-selected', item === link));

    // Stage 1: make the chosen destination visibly selected while the menu
    // remains open. Stage 2: close the menu; stage 3: replay the native click
    // only after the exit finishes, preserving existing same-page routing.
    waitForMenuLinkSelection(link).then(() => {
      if (!isOpen || !root?.contains?.(link)) {
        selectingMenuLink = false;
        return;
      }

      close(() => {
        if (!root?.contains?.(link)) {
          selectingMenuLink = false;
          return;
        }
        replayingMenuLink = true;
        link.click();
      });
    });
  }

  function toggle(event) {
    event?.preventDefault?.();
    if (selectingMenuLink) return;
    if (isOpen) close();
    else open();
  }

  const cleanup = [];
  const bind = (target, type, handler, options) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler, options);
    cleanup.push(() => target.removeEventListener(type, handler, options));
  };

  // The navbar is its own stacking context, so mix-blend-mode on the nested
  // logo image cannot reliably see artwork behind the fixed navbar. Instead,
  // sample the visible backdrop and switch a normalized black/white logo.
  const logo = root.querySelector('.site-logo');
  const pageTransition = root.getElementById('pageTransition');
  let logoFrame = null;
  let logoBackdropIsDynamic = false;
  let logoBackdropTimer = null;
  let logoMutationObservers = [];

  function parseColor(value) {
    const match = String(value || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/ ]\s*([\d.]+%?))?\s*\)/i);
    if (!match) return null;
    const alphaRaw = match[4];
    const alpha = alphaRaw === undefined ? 1
      : alphaRaw.endsWith('%') ? Number.parseFloat(alphaRaw) / 100
      : Number.parseFloat(alphaRaw);
    return {
      r: Math.max(0, Math.min(255, Number(match[1]))),
      g: Math.max(0, Math.min(255, Number(match[2]))),
      b: Math.max(0, Math.min(255, Number(match[3]))),
      a: Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1))
    };
  }

  function luminanceFromColor(color) {
    if (!color) return null;
    const channel = value => {
      const normalized = value / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  }

  function computedBackdropLuminance(element) {
    for (let current = element; current && current !== root.documentElement; current = current.parentElement) {
      const background = parseColor(windowRef?.getComputedStyle?.(current)?.backgroundColor);
      if (!background || background.a <= 0.02) continue;
      const under = { r: 18, g: 18, b: 18 };
      const composited = {
        r: background.r * background.a + under.r * (1 - background.a),
        g: background.g * background.a + under.g * (1 - background.a),
        b: background.b * background.a + under.b * (1 - background.a)
      };
      return luminanceFromColor(composited);
    }
    return luminanceFromColor({ r: 18, g: 18, b: 18 });
  }

  function containsViewportPoint(element, x, y) {
    const rect = element?.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0 &&
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  }

  function isVisibleMediaAtPoint(candidate, x, y) {
    if (!candidate || candidate === logo) return false;
    if (!candidate.matches?.('video, img, canvas, lottie-player')) return false;
    if (candidate.closest?.('.navbar, #pageTransition, .page-transition, .nav-menu-backdrop')) return false;
    if (!containsViewportPoint(candidate, x, y)) return false;
    for (let current = candidate; current && current !== root.documentElement; current = current.parentElement) {
      if (current.hidden) return false;
      if (current.classList?.contains('slide') && !current.classList.contains('active')) return false;
      const style = windowRef?.getComputedStyle?.(current);
      if (style && (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity) <= 0.01)) return false;
      if (current === root.body) break;
    }
    return true;
  }

  function findMediaAtPoint(target, x, y, stack = []) {
    const mediaSelector = 'video, img, canvas, lottie-player';
    const candidates = new Set();
    const add = candidate => { if (isVisibleMediaAtPoint(candidate, x, y)) candidates.add(candidate); };
    stack.forEach(add);
    for (let current = target; current && !current.closest?.('.navbar'); current = current.parentElement) {
      if (current.matches?.(mediaSelector)) add(current);
    }
    const heroBanner = target?.matches?.('.hero-banner') ? target : target?.closest?.('.hero-banner');
    if (heroBanner) {
      heroBanner.querySelectorAll('.slide.active video, .slide.active img, .slide.active canvas, .slide.active lottie-player').forEach(add);
    }
    // Prefer the hit-test paint stack. Only do a document scan if uncommon
    // transparent wrappers hid every media element from the stack and active-slide lookup.
    if (!candidates.size && root.querySelectorAll) {
      root.querySelectorAll(mediaSelector).forEach(add);
    }
    if (!candidates.size) return null;
    const rank = candidate => {
      const index = stack.indexOf(candidate);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    return Array.from(candidates).sort((x,y) => {
      const rx=rank(x), ry=rank(y);
      if(rx!==ry) return rx-ry;
      const ax=x.getBoundingClientRect(), ay=y.getBoundingClientRect();
      return ax.width*ax.height-ay.width*ay.height;
    })[0] || null;
  }

  function syncHamburgerForeground(preferredForeground = logo?.dataset?.logoForeground || 'light') {
    // Keep the close mark white while the black full-screen menu is open or
    // exiting. Only a fully closed menu follows the logo's sampled foreground.
    const menuIsVisible = mobileMenu.classList.contains('is-open') ||
      root.body?.classList.contains('menu-open');
    const resolvedForeground = menuIsVisible ? 'light' : preferredForeground;
    menuButton.style.setProperty('--hamburger-foreground', resolvedForeground === 'dark' ? '#000' : '#fff');
    menuButton.dataset.foreground = resolvedForeground;
  }

  function setLogoForeground(luminance) {
    if (!logo || !Number.isFinite(luminance)) return;
    // Hysteresis near the crossover prevents flicker over moving artwork.
    const current = logo.dataset.logoForeground;
    let foreground;
    if (current === 'dark' && luminance >= 0.145) foreground = 'dark';
    else if (current === 'light' && luminance <= 0.215) foreground = 'light';
    else foreground = foregroundForLuminance(luminance) === '#000' ? 'dark' : 'light';
    if (current !== foreground) {
      logo.dataset.logoForeground = foreground;
      logo.style.filter = foreground === 'dark' ? 'brightness(0)' : 'brightness(0) invert(1)';
    }
    syncHamburgerForeground(foreground);
  }

  function setLogoFallbackForeground(luminance = 0.02) {
    if (!logo) return;
    setDynamicBackdropState(false);
    setLogoForeground(Number.isFinite(luminance) ? luminance : 0.02);
  }

  function setDynamicBackdropState(isDynamic) {
    logoBackdropIsDynamic = Boolean(isDynamic);
    // Hero stills can move and cross-fade just like video. Poll only while
    // animated artwork is underneath the fixed logo; ordinary page images
    // remain event-driven so this does not become a permanent background timer.
    if (logoBackdropIsDynamic && logoBackdropTimer === null && typeof windowRef?.setInterval === 'function') {
      logoBackdropTimer = windowRef.setInterval(() => {
        if (logoBackdropIsDynamic && root.visibilityState !== 'hidden') scheduleLogoContrast();
      }, 500);
    } else if (!logoBackdropIsDynamic && logoBackdropTimer !== null) {
      windowRef?.clearInterval?.(logoBackdropTimer);
      logoBackdropTimer = null;
    }
  }


  function effectiveAboutHeroLuminance(media, sampledLuminance, point) {
    const banner = media?.closest?.('.hero-banner');
    const aboutHero = banner?.closest?.('.about-hero');
    if (!banner || !aboutHero || !Number.isFinite(sampledLuminance)) return sampledLuminance;

    const slide = media.closest?.('.slide');
    const bannerRect = banner.getBoundingClientRect();
    const bannerStyle = windowRef?.getComputedStyle?.(banner);
    const slideStyle = slide ? windowRef?.getComputedStyle?.(slide) : null;
    const mediaStyle = windowRef?.getComputedStyle?.(media);
    const alphaValue = (value, fallback) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
    };
    const topScrim = alphaValue(bannerStyle?.getPropertyValue('--about-hero-scrim-top-alpha'), 0.32);
    const bottomScrim = alphaValue(bannerStyle?.getPropertyValue('--about-hero-scrim-bottom-alpha'), 0.72);
    const position = bannerRect.height > 0
      ? Math.max(0, Math.min(1, (point.y - bannerRect.top) / bannerRect.height))
      : 0;
    const scrimAlpha = topScrim + ((bottomScrim - topScrim) * position);
    const slideOpacity = alphaValue(slideStyle?.opacity, 1);
    const mediaOpacity = alphaValue(mediaStyle?.opacity, 1);
    const artworkAlpha = Math.max(0, Math.min(1, slideOpacity * mediaOpacity * (1 - scrimAlpha)));
    const darkBase = luminanceFromColor({ r: 18, g: 18, b: 18 }) ?? 0.006;
    // The canvas sampler returns source media luminance. Composite it against
    // the dark base using the active slide opacity and the About hero scrim,
    // so the logo responds to the artwork as it is actually rendered.
    return sampledLuminance * artworkAlpha + darkBase * (1 - artworkAlpha);
  }

  function updateLogoContrast() {
    if (!logo || (!root.elementsFromPoint && !root.elementFromPoint)) return;
    const rect = logo.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const point = { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
    if (pageTransition && pageTransition.dataset.loading !== 'ready' && !pageTransition.classList.contains('is-hidden')) {
      setDynamicBackdropState(false);
        setLogoForeground(luminanceFromColor(parseColor(windowRef?.getComputedStyle?.(pageTransition)?.backgroundColor)) ?? 0.006);
      return;
    }

    const stack = typeof root.elementsFromPoint === 'function'
      ? (root.elementsFromPoint(point.x, point.y) || [])
      : [root.elementFromPoint(point.x, point.y)].filter(Boolean);

    // Contact keeps the established white mark without a backing plate.
    const contactAreaUnderLogo = stack.some(element => element?.closest?.('#contact-section'));
    if (contactAreaUnderLogo) {
      setDynamicBackdropState(false);
      setLogoForeground(0.02);
      return;
    }

    let backdrop = stack.find(element => {
      if (!element || element === logo || element.closest?.('.navbar')) return false;
      if (element.classList?.contains('nav-menu-backdrop')) return true;
      return !element.closest?.('script, style');
    });
    if (!backdrop) {
      setDynamicBackdropState(false);
      setLogoForeground(computedBackdropLuminance(root.body));
      return;
    }
    if (backdrop.classList?.contains('nav-menu-backdrop')) {
      setDynamicBackdropState(false);
        setLogoForeground(0.006);
      return;
    }
    const heroSection = backdrop.closest?.('.hero-section');
    if (heroSection?.classList.contains('hero-section--message')) {
      // The Works message hero keeps its established dark scrim and white mark.
      setDynamicBackdropState(false);
        setLogoForeground(0.02);
      return;
    }
    // A message overlay or slide wrapper can be the elementFromPoint result.
    // Normalize it to the Hero media surface before deciding the logo color.
    const heroBanner = heroSection?.querySelector?.('.hero-banner');
    if (heroBanner) backdrop = heroBanner;

    const style = windowRef?.getComputedStyle?.(backdrop);
    const backdropColor = parseColor(style?.backgroundColor);
    const isHeroMediaContainer = Boolean(backdrop.matches?.('.hero-banner, .slide') || backdrop.closest?.('.hero-banner'));
    let media = isVisibleMediaAtPoint(backdrop, point.x, point.y) ? backdrop : null;
    if (!media && isHeroMediaContainer) {
      const hero = backdrop.matches?.('.hero-banner') ? backdrop : backdrop.closest?.('.hero-banner');
      const active = hero?.querySelectorAll('.slide.active video, .slide.active img, .slide.active canvas, .slide.active lottie-player') || [];
      media = Array.from(active).find(candidate => isVisibleMediaAtPoint(candidate, point.x, point.y)) || null;
    }
    // The opaque fill of a hero container is behind the artwork; other opaque overlays are not.
    if (!media && !isHeroMediaContainer && backdropColor && backdropColor.a >= 0.98) {
      setDynamicBackdropState(false);
      setLogoForeground(computedBackdropLuminance(backdrop));
      return;
    }
    if (!media && backdropColor && backdropColor.a > 0.02 && backdropColor.a < 0.98) {
      setLogoFallbackForeground(computedBackdropLuminance(backdrop));
      return;
    }
    if (!media) media = findMediaAtPoint(backdrop, point.x, point.y, stack);
    if (media) {
      setDynamicBackdropState(Boolean(media.closest?.('.hero-banner')) || ['video', 'canvas', 'lottie-player'].includes(media.localName));
      const sampledLuminance = sampleMediaLuminance(root, media, point);
      const luminance = heroSection?.classList.contains('about-hero')
        ? effectiveAboutHeroLuminance(media, sampledLuminance, point)
        : sampledLuminance;
      if (Number.isFinite(luminance)) {
        setLogoForeground(luminance);
        return;
      }
      setLogoFallbackForeground(computedBackdropLuminance(backdrop));
      return;
    }
    setDynamicBackdropState(false);
    if (style?.backgroundImage && style.backgroundImage !== 'none') {
      setLogoFallbackForeground(computedBackdropLuminance(backdrop));
      return;
    }
    setLogoForeground(computedBackdropLuminance(backdrop));
  }

  function scheduleLogoContrast() {
    if (!logo || logoFrame !== null) return;
    if (typeof windowRef?.requestAnimationFrame !== 'function') {
      updateLogoContrast();
      return;
    }
    logoFrame = windowRef.requestAnimationFrame(() => {
      logoFrame = null;
      updateLogoContrast();
    });
  }

  if (logo) {
    logo.dataset.logoForeground = 'light';
    logo.style.filter = 'brightness(0) invert(1)';
    bind(windowRef, 'scroll', scheduleLogoContrast, { passive: true });
    bind(windowRef, 'resize', scheduleLogoContrast, { passive: true });
    bind(windowRef?.visualViewport, 'resize', scheduleLogoContrast, { passive: true });
    bind(root, 'load', scheduleLogoContrast, true);
    bind(root, 'loadeddata', scheduleLogoContrast, true);
    bind(root, 'playing', scheduleLogoContrast, true);
    bind(root, 'pointerup', scheduleLogoContrast, true);

    const MutationObserverRef = windowRef?.MutationObserver;
    if (typeof MutationObserverRef === 'function') {
      const observe = (target, options) => {
        if (!target) return;
        const observer = new MutationObserverRef(scheduleLogoContrast);
        observer.observe(target, options);
        logoMutationObservers.push(observer);
      };
      observe(root.getElementById('heroBanner'), {
        childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'src', 'style']
      });
      observe(root.getElementById('heroBannerAbout'), {
        childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'src', 'style']
      });
      observe(root.querySelector('.hero-section'), {
        attributes: true, attributeFilter: ['class', 'hidden']
      });
      observe(pageTransition, {
        attributes: true, attributeFilter: ['class', 'hidden', 'data-loading', 'aria-hidden']
      });
      observe(root.body, {
        attributes: true, attributeFilter: ['class', 'aria-busy']
      });
    }

    cleanup.push(() => {
      if (logoFrame !== null) windowRef?.cancelAnimationFrame?.(logoFrame);
      logoFrame = null;
      setDynamicBackdropState(false);
      logoMutationObservers.forEach(observer => observer.disconnect());
      logoMutationObservers = [];
    });
    scheduleLogoContrast();
  }

  bind(menuButton, 'click', toggle);
  mobileMenuLinks.forEach(link => {
    bind(link, 'click', handleMobileMenuLinkSelection, true);
    bind(link, 'click', close);
  });

  function scrollSamePageContact() {
    const target = root.getElementById('contact-grid-anchor')
      || root.querySelector('#contact-section .contact-grid')
      || root.getElementById('contact-start')
      || root.getElementById('contact-section');
    const heading = root.getElementById('contact-start') || target;
    const windowRef = root?.defaultView || globalThis.window;
    if (!target || !windowRef?.scrollTo) return;

    const viewportHeight = Number(windowRef.visualViewport?.height) || Number(windowRef.innerHeight) || 0;
    const currentY = Number(windowRef.scrollY) || 0;
    const rect = target.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const navbarHeight = Number(root.querySelector('.navbar')?.getBoundingClientRect?.().height) || 0;
    const usableTop = Math.max(navbarHeight + 24, 24);
    const usableHeight = Math.max(1, viewportHeight - usableTop);

    // Center the Contact group in the usable viewport rather than positioning
    // only its heading. This gives desktop and mobile the same intentional
    // compositional balance while the safety clamp keeps the heading clear of
    // the fixed navbar.
    const targetCenterY = rect.top + rect.height / 2;
    const desiredY = currentY + targetCenterY - (usableTop + usableHeight / 2);
    const headingSafeY = currentY + headingRect.top - usableTop;
    const documentHeight = Math.max(
      Number(root.documentElement?.scrollHeight) || 0,
      Number(root.body?.scrollHeight) || 0
    );
    const maxScrollY = Math.max(0, documentHeight - viewportHeight);
    const targetY = Math.max(0, Math.min(maxScrollY, Math.min(desiredY, headingSafeY)));

    const reducedMotion = Boolean(windowRef.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    windowRef.scrollTo({ left: 0, top: targetY, behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  function normalizedPagePath(pathname) {
    let pathnameValue = String(pathname || '').replace(/index\.html$/, '');
    if (pathnameValue.length > 1) pathnameValue = pathnameValue.replace(/\/+$/, '');
    return pathnameValue || '/';
  }

  function handleSamePageHomeNavigation(event) {
    const link = event.currentTarget;
    const windowRef = root?.defaultView || globalThis.window;
    if (!link || !windowRef?.location) return;

    let url;
    try { url = new URL(link.getAttribute('href') || '', windowRef.location.href); }
    catch (_) { return; }

    let curatedSlug = '';
    try { curatedSlug = String(getCuratedViewSlug?.() || '').trim().toLowerCase(); } catch (_) {}
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(curatedSlug)) curatedSlug = '';
    // An unlisted view should survive Works <-> About navigation.
    if (curatedSlug && url.origin === windowRef.location.origin && !url.hash) {
      if (normalizedPagePath(url.pathname) === normalizedPagePath(windowRef.location.pathname)) {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        close();
        try { windowRef.history.replaceState(null, '', url.pathname + url.search + '#' + encodeURIComponent(curatedSlug)); } catch (_) {}
        try { windowRef.dispatchEvent(new windowRef.CustomEvent('lm:navigate-home')); } catch (_) {}
        const reducedMotion = Boolean(windowRef.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
        const instantLogoReset = Boolean(link.matches?.('.nav-logo'));
        windowRef.scrollTo({ left: 0, top: 0, behavior: reducedMotion || instantLogoReset ? 'auto' : 'smooth' });
        return;
      }
      link.setAttribute('href', url.pathname + url.search + '#' + encodeURIComponent(curatedSlug));
      return;
    }
    if (
      url.origin !== windowRef.location.origin ||
      url.hash ||
      normalizedPagePath(url.pathname) !== normalizedPagePath(windowRef.location.pathname)
    ) return;

    event.preventDefault();
    event.stopImmediatePropagation?.();
    close();

    // Home/Works navigation from the current Works page is an in-document
    // top reset, not a reload. Clear any Contact/filter hash first so Back
    // navigation and refresh cannot restore the previous Contact stage.
    try {
      windowRef.history.replaceState(null, '', url.pathname + url.search);
    } catch (_) {}

    // Keep navigation and Gallery decoupled: Navigation publishes the semantic
    // home/Works transition, while Gallery decides how its own filter state
    // should reset.
    try {
      windowRef.dispatchEvent(new windowRef.CustomEvent('lm:navigate-home'));
    } catch (_) {}

    // A logo press is a direct Home affordance. Reset immediately; other
    // same-page navigation retains the existing smooth scroll behavior.
    const reducedMotion = Boolean(windowRef.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    const instantLogoReset = Boolean(link.matches?.('.nav-logo'));
    windowRef.scrollTo({ left: 0, top: 0, behavior: reducedMotion || instantLogoReset ? 'auto' : 'smooth' });
  }

  function handleSamePageContactNavigation(event) {
    const boundLink = event.currentTarget;
    const link = boundLink?.matches?.('.nav-links a[href], .mobile-menu a[href]')
      ? boundLink
      : event.target?.closest?.('.nav-links a[href], .mobile-menu a[href]');
    if (!link || !root?.contains?.(link)) return;

    const windowRef = root?.defaultView || globalThis.window;
    let url;
    try {
      url = new URL(link.getAttribute('href') || '', windowRef.location.href);
    } catch (_) {
      return;
    }

    if (
      !url.hash ||
      url.pathname !== windowRef.location.pathname ||
      url.search !== windowRef.location.search
    ) return;

    let targetId = '';
    try {
      targetId = decodeURIComponent(url.hash.slice(1));
    } catch (_) {
      return;
    }
    if (targetId !== 'contact-start' && targetId !== 'contact-section') return;

    event.preventDefault();
    event.stopImmediatePropagation?.();
    close();

    try {
      windowRef.history.pushState(null, '', url.pathname + url.search + url.hash);
    } catch (_) {}

    // Issue one scroll command. Repeated smooth-scroll requests on adjacent
    // animation frames continually restart the motion and can look like a snap.
    if (typeof windowRef.requestAnimationFrame === 'function') {
      windowRef.requestAnimationFrame(scrollSamePageContact);
    } else {
      scrollSamePageContact();
    }
  }

  // Works and the LM logo already target the current Works document on the
  // main page. Keep them in the same document instead of reloading it.
  const samePageHomeLinks = Array.from(new Set([
    root.querySelector('.nav-logo'),
    root.querySelector('.nav-dropdown-toggle'),
    ...mobileMenuLinks
  ].filter(Boolean)));
  samePageHomeLinks.forEach(link => bind(link, 'click', handleSamePageHomeNavigation, true));

  // Bind the same-page Contact contract directly to the concrete links.
  // The menu close listener remains separate; this avoids depending on
  // document-level click delegation or on which nested icon element receives
  // the original event.
  mobileMenuLinks.forEach(link => {
    const href = link.getAttribute('href') || '';
    if (href.includes('#contact-start') || href.includes('#contact-section')) {
      bind(link, 'click', handleSamePageContactNavigation, true);
    }
  });

  // The mobile menu uses a dimmed page layer for visual separation. Keep
  // that layer interactive by closing when the user taps anywhere outside
  // the navbar, while preserving normal interaction inside the menu.
  bind(root, 'click', event => {
    if (!isOpen) return;
    const target = event.target;
    if (target?.closest?.('.navbar')) return;
    close();
  });

  bind(root, 'keydown', event => {
    if (event.key === 'Escape' && isOpen) {
      close();
      menuButton.focus?.();
    }
  });

  syncAria();

  return {
    open,
    close,
    toggle,
    destroy() {
      cleanup.splice(0).forEach(remove => {
        try { remove(); } catch (_) {}
      });
      close(undefined, true);
      menuBackdrop?.remove?.();
    }
  };
}
