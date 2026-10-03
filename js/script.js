document.addEventListener('DOMContentLoaded', async () => {

  /* Boot UI must start before any dynamic import or CMS request. A failed
     feature module must never leave the visitor behind a full-screen dark
     overlay with no logo or way out. */
  const pageTransition = document.getElementById('pageTransition');
  let initialTransitionTimer = null;

  function showInitialPageTransition() {
    if (!pageTransition) return;
    pageTransition.classList.remove('is-hidden');
    requestAnimationFrame(() => pageTransition.classList.add('is-entering'));
    initialTransitionTimer = window.setTimeout(() => {
      pageTransition.classList.add('is-hidden');
    }, 900);
  }

  function hideInitialPageTransition() {
    if (!pageTransition) return;
    pageTransition.classList.add('is-hidden');
  }

  showInitialPageTransition();

  try {

  /* Shared runtime foundation. Heavy feature code stays in its own modules;
     this import supplies site-root/path resolution, conditional library
     loading, and reduced-motion state without changing the existing CMS data
     format. */
  const runtimeScript = Array.from(document.scripts || []).find(el => /(?:^|\/)js\/script\.js(?:[?#].*)?$/i.test(el.src || el.getAttribute('src') || ''));
  const runtimeUrl = runtimeScript ? new URL('site-runtime.js?v=20261001-03', runtimeScript.src).href : new URL('js/site-runtime.js', document.baseURI).href;
  const { getSiteRootUrl, siteAssetUrl, ensureLottiePlayer, ensureMediaBackgroundHelper } = await import(runtimeUrl);
  const [{ loadCmsJson, parseYouTubeUrl }, { initGallery }, { initHeroBannerV2 }, { initLightbox }] = await Promise.all([
    import(new URL('cms-data.js?v=20261001-03', runtimeUrl).href),
    import(new URL('gallery.js?v=20261001-03', runtimeUrl).href),
    import(new URL('hero.js?v=20261001-03', runtimeUrl).href),
    import(new URL('lightbox.js?v=20261001-03', runtimeUrl).href)
  ]);

  /* =========================================
     0. YOUR SWITCHES — edit these two, nothing else
     ========================================= */

  // Right-click / "Save Image As" protection on lightbox artworks.
  // true  = right-click and drag-to-save are disabled on artworks.
  // false = artworks behave like normal images.
  let PROTECTION_ENABLED = true;

  // Web3Forms has a monthly response limit on the free plan. Flip
  // either of these to false when you're close to it (or just want
  // people to email you directly instead) and the form on the page
  // is automatically swapped for an "Email Me" button — no HTML
  // editing needed either way.
  const FORMS_ENABLED = {
    project: true, // "START A PROJECT WITH LM." form
    review: true   // "LEAVE A REVIEW" form
  };

  // Shows/hides the little "2D" / "3D" / "Motion" pill(s) in the
  // top-left corner of every project card. Doesn't affect filtering —
  // that still works off the card's classes either way.
  let SHOW_CARD_BADGES = true;

  // Shows/hides the whole client reviews section (the scrolling wall of
  // review cards above the footer). Set to false if you don't have
  // enough reviews yet, or just want it off the page for a while.
  let SHOW_REVIEWS = false;

  // Shows every Software Skill as its logo instead of its name —
  // one switch for the whole list, not a per-skill choice. A skill
  // still shows its plain name whenever no logo is available at all
  // (nothing hand-picked, and no automatic match), regardless of this.
  let SHOW_SOFTWARE_LOGOS = false;

  // Which artwork the homepage/about hero banner loops, and how it
  // transitions between them. Both live in data/settings.json's
  // heroTiming object, set from the "Hero Loop Animation" screen in
  // the CMS. Declared here, at the very top, for the same reason
  // every other switch on this list is: initHeroBanner (much further
  // down) reads these, and it can run before this script has finished
  // executing top to bottom if it's ever called from an early event.
  //   'latest' — auto-pulls from the site's actual projects (today's
  //     behavior), capped at 5.
  //   'manual' — uses exactly what's in data/hero-loop.json, however
  //     many entries that is: 1 in, 1 loops; 3 in, 3 loop.
  //   'mixed' — uses manual entries first, then newest projects until the
  //     hero reaches five slides. This gives 3 manual + 2 latest, 1 manual +
  //     4 latest, etc.
  let HERO_LOOP_MODE = 'latest';
  //   'kenburns' — the slow continuous zoom this site has always had.
  //   'fade' — a plain crossfade, no zoom.
  //   'none' — an instant cut, no fade either.
  let HERO_TRANSITION = 'kenburns';
  let HERO_CROSSFADE_MS = 3500;

  // Holds About's software-skills list once it loads, purely so
  // applySettings (right below) can re-render that list if
  // showSoftwareLogos arrives from data/settings.json AFTER
  // data/about.json has already loaded and rendered once. Declared
  // here, at the very top, for the same reason reviewsSection/
  // reviewsTrack/reviewsMarquee are: applySettings can run the moment
  // its own fetch resolves, which can happen before the rest of this
  // script has finished running — so anything it touches has to
  // already exist by then, not just be defined somewhere further down.
  let cachedSoftwareSkills = null;

  // A short list of well-known creative/dev software whose company
  // isn't reliably found by Simple Icons alone (below) — used as a
  // second lookup source, keyed by the product's *domain* instead of
  // a brand slug. Only needs entries for products actually worth
  // covering; anything missing here just falls through to the next
  // step instead of erroring.
  const SOFTWARE_DOMAINS = {
    krita: 'krita.org', blender: 'blender.org', figma: 'figma.com',
    'davinci resolve': 'blackmagicdesign.com', 'cinema 4d': 'maxon.net',
    zbrush: 'maxon.net', maya: 'autodesk.com', '3ds max': 'autodesk.com',
    'autodesk maya': 'autodesk.com', unity: 'unity.com',
    'unreal engine': 'unrealengine.com', procreate: 'procreate.com',
    sketch: 'sketch.com', sketchup: 'sketchup.com',
    'substance painter': 'substance3d.com', 'substance designer': 'substance3d.com',
    'affinity photo': 'affinity.serif.com', 'affinity designer': 'affinity.serif.com',
    'houdini': 'sidefx.com', 'clip studio paint': 'clipstudio.net'
  };



  /* Looked up here, right at the top, instead of down in section 6
     where the reviews marquee is actually built.

     BUG THIS FIXES: applySettings() (right below) can call
     applyReviewsVisibility(), which reads reviewsSection, the moment
     data/settings.json finishes loading. That fetch resolves whenever
     the network returns it — which can easily happen before the
     script has finished running section 6, further down this same
     file, is where reviewsSection used to be declared with `const`.

     A `const` doesn't exist at all until its own line actually runs
     (this is "the temporal dead zone") — so if the settings fetch won
     the race, applyReviewsVisibility would reach for a variable that
     technically wasn't there yet and throw
     "Cannot access 'reviewsSection' before initialization", which is
     exactly the error this was throwing in the console. Declaring
     these three here, before anything async gets a chance to run,
     means they're always ready no matter which fetch finishes first. */
  const reviewsMarquee = document.querySelector('.reviews-marquee');
  const reviewsTrack = document.getElementById('reviewsTrack');
  const reviewsSection = document.querySelector('.reviews-section');
  let pristineTopCards = null;
  let pristineBottomCards = null;


  /* =========================================
     0a. CMS OVERRIDE — SETTINGS
     ========================================= */
  /* If window.SETTINGS_URL points at data/settings.json, fetch it and
     apply whatever it contains on top of the hardcoded defaults above.
     Same pattern as the hero messages: the page renders instantly
     using the defaults, then quietly updates the moment the fetch
     resolves — so a slow or failed fetch never blocks or breaks
     anything, it just leaves the defaults in place. */
  const socialLabels = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' };

  function setHiddenField(formId, fieldName, value) {
    if (value === undefined || value === null || value === '') return;
    const form = document.getElementById(formId);
    if (!form) return;
    const input = form.querySelector('input[name="' + fieldName + '"]');
    if (input) input.value = value;
  }

  function setSocialHref(key, url) {
    if (!url) return;
    const label = socialLabels[key];
    document.querySelectorAll('a[aria-label="' + label + '"]').forEach(a => { a.href = url; });
  }

  function applyOgMeta(remote){
    if (!remote || !remote.ogImage) return;
    try {
      const root = getSiteRootUrl();
      const imageUrl = new URL(remote.ogImage + (remote.ogImageVersion ? `?v=${encodeURIComponent(remote.ogImageVersion)}` : ''), root).href;
      document.querySelectorAll('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"]').forEach(meta => { meta.setAttribute('content', imageUrl); });
      if (remote.ogImageAlt) document.querySelectorAll('meta[property="og:image:alt"]').forEach(meta => meta.setAttribute('content', remote.ogImageAlt));
    } catch (e) { /* keep the static HTML fallback */ }
  }

  function applyCardBadgesVisibility() {
    document.querySelectorAll('.card-badges').forEach(el => {
      el.style.display = SHOW_CARD_BADGES ? '' : 'none';
    });
  }

  function applySettings(remote) {
    if (!remote || typeof remote !== 'object') return;

    if (typeof remote.protectionEnabled === 'boolean') PROTECTION_ENABLED = remote.protectionEnabled;
    if (remote.formsEnabled) {
      if (typeof remote.formsEnabled.project === 'boolean') FORMS_ENABLED.project = remote.formsEnabled.project;
      if (typeof remote.formsEnabled.review === 'boolean') FORMS_ENABLED.review = remote.formsEnabled.review;
    }
    if (typeof remote.showCardBadges === 'boolean') SHOW_CARD_BADGES = remote.showCardBadges;
    if (typeof remote.showReviews === 'boolean') SHOW_REVIEWS = remote.showReviews;
    if (typeof remote.showSoftwareLogos === 'boolean') SHOW_SOFTWARE_LOGOS = remote.showSoftwareLogos;
    if (remote.heroTiming) {
      if (['latest','manual','mixed'].includes(remote.heroTiming.loopMode)) HERO_LOOP_MODE = remote.heroTiming.loopMode;
      if (['kenburns','fade','none'].includes(remote.heroTiming.transitionStyle)) HERO_TRANSITION = remote.heroTiming.transitionStyle;
      if (Number.isFinite(Number(remote.heroTiming.crossfadeMs)) && Number(remote.heroTiming.crossfadeMs) >= 500) HERO_CROSSFADE_MS = Number(remote.heroTiming.crossfadeMs);
    }

    // Re-apply every toggle-dependent bit of DOM now that the values
    // may have changed. PROTECTION_ENABLED needs no re-apply here — it's
    // read live wherever lightbox media gets built, further down.
    applyCardBadgesVisibility();
    applyFormToggle(document.getElementById('projectForm'), document.getElementById('projectEmailBtn'), FORMS_ENABLED.project);
    applyFormToggle(document.getElementById('reviewForm'), document.getElementById('reviewEmailBtn'), FORMS_ENABLED.review);
    applyReviewsVisibility();
    applySoftwareLogosVisibility();

    if (remote.web3forms) {
      setHiddenField('projectForm', 'apikey', remote.web3forms.projectKey);
      setHiddenField('reviewForm', 'apikey', remote.web3forms.reviewKey);
    }
    if (remote.redirectUrl) {
      setHiddenField('projectForm', 'redirect', remote.redirectUrl);
      setHiddenField('reviewForm', 'redirect', remote.redirectUrl);
    }

    if (remote.contactEmail) {
      document.querySelectorAll('a[href^="mailto:"]').forEach(a => {
        const query = a.getAttribute('href').split('?')[1];
        a.href = 'mailto:' + remote.contactEmail + (query ? '?' + query : '');
      });
    }

    if (remote.socials) {
      setSocialHref('instagram', remote.socials.instagram);
      setSocialHref('tiktok', remote.socials.tiktok);
      setSocialHref('youtube', remote.socials.youtube);
    }

    if (remote.siteTitle) document.title = remote.siteTitle;
    applyOgMeta(remote);
  }

  const settingsReady = window.SETTINGS_URL
    ? loadCmsJson(window.SETTINGS_URL, null, { resolveUrl: siteAssetUrl }).then(applySettings)
    : Promise.resolve();


  /* =========================================
     0b. CMS OVERRIDE — PROJECTS
     ========================================= */
  /* If window.PROJECTS_URL points at data/projects.json, fetch it and,
     when it returns a non-empty array, rebuild #portfolioGrid entirely
     from that data. This has to happen — and finish — before anything
     further down reads the grid: filtering, the hero banner's "5
     latest artworks", and the lightbox click handlers each capture
     the grid's cards once, early, into a fixed list. That's why this
     is awaited before section 1 below, instead of firing in the
     background the way hero text and settings do.

     If the fetch fails, is empty, or window.PROJECTS_URL isn't set,
     the static cards already written in this file are left exactly
     as they are — that's the fallback, not an error state. */

  function buildMediaItemEl(m) {
    const el = document.createElement('div');
    el.className = 'media-item';
    if (m.type === 'video') el.setAttribute('data-video', m.src || '');
    else if (m.type === 'youtube') el.setAttribute('data-youtube', m.src || '');
    else if (m.type === 'lottie') el.setAttribute('data-lottie', m.src || '');
    else if (m.type === 'model') el.setAttribute('data-model', m.src || '');
    else el.setAttribute('data-image', m.src || '');
    if (m.caption) el.setAttribute('data-description', m.caption);
    if (m.orientation) el.setAttribute('data-orientation', m.orientation);
    if (m.background && typeof m.background === 'object') el.setAttribute('data-background', JSON.stringify(m.background));
    return el;
  }

  function findMediaBackgroundFromProject(p, src) {
    if (!p || !src || !Array.isArray(p.media)) return null;
    const match = p.media.find(m => m && m.src === src && m.background && typeof m.background === 'object');
    return match ? match.background : null;
  }

  function projectHas3D(p) {
    return !!(p && Array.isArray(p.media) && p.media.some(m => m && m.type === 'model' && m.src));
  }

  // 3D media presentation shape comes from the same Orientation field used
  // by every other artwork. Auto is handled by the model viewer itself.
  function add3DAvailabilityIndicator(thumb, p) {
    if (!thumb || !projectHas3D(p) || thumb.querySelector('.card-3d-indicator')) return;
    thumb.classList.add('has-3d-view');
    const indicator = document.createElement('div');
    indicator.className = 'card-3d-indicator';
    indicator.innerHTML = '<i class="fa-solid fa-cube" aria-hidden="true"></i><span>3D VIEW AVAILABLE</span>';
    thumb.appendChild(indicator);
  }

  function buildProjectCardEl(p) {
    const card = document.createElement('div');
    const filters = Array.isArray(p.filters) ? p.filters.filter(Boolean) : [];
    card.className = ['project-card', ...filters].join(' ');
    card.dataset.filterIds = JSON.stringify(filters);

    if (p.badge) {
      const badges = document.createElement('div');
      badges.className = 'card-badges';
      const span = document.createElement('span');
      span.className = 'badge glass';
      span.textContent = p.badge;
      badges.appendChild(span);
      card.appendChild(badges);
    }

    const thumb = document.createElement('div');
    thumb.className = 'card-thumbnail';
    const t = p.thumbnail || {};
    const inheritedThumbBackground = t.src ? findMediaBackgroundFromProject(p, t.src) : null;
    const thumbBackground = (t.background && typeof t.background === 'object') ? t.background : inheritedThumbBackground;
    if (t.type) thumb.setAttribute('data-thumbnail-type', t.type);
    if (t.src) {
      const media = buildThumbnailMedia({type:t.type||mediaTypeFromSrc(t.src),src:t.src,background:thumbBackground}, p.title || 'Project artwork');
      if (media) {
        if (t.focus) media.setAttribute('data-focus', t.focus);
        if (t.zoom && Number(t.zoom)!==1) media.setAttribute('data-zoom', t.zoom);
        if (t.rotate) media.setAttribute('data-rotate', t.rotate);
        if (thumbBackground && typeof thumbBackground === 'object') thumb.setAttribute('data-background', JSON.stringify(thumbBackground));
        thumb.appendChild(media);
      }
    } else {
      if (t.focus) thumb.setAttribute('data-focus', t.focus);
      if (t.zoom && Number(t.zoom)!==1) thumb.setAttribute('data-zoom', t.zoom);
      if (t.rotate) thumb.setAttribute('data-rotate', t.rotate);
    }
    add3DAvailabilityIndicator(thumb, p);
    card.appendChild(thumb);

    const info = document.createElement('div');
    info.className = 'glass-info';
    const h3 = document.createElement('h3');
    h3.textContent = p.title || '';
    const subtitleP = document.createElement('p');
    subtitleP.textContent = p.subtitle || '';
    info.appendChild(h3);
    info.appendChild(subtitleP);
    card.appendChild(info);

    if (p.description) {
      const descWrap = document.createElement('div');
      descWrap.className = 'project-description';
      descWrap.style.display = 'none';
      const descP = document.createElement('p');
      descP.textContent = p.description;
      descWrap.appendChild(descP);
      card.appendChild(descWrap);
    }

    const mediaList = document.createElement('div');
    mediaList.className = 'project-media-list';
    mediaList.style.display = 'none';
    (Array.isArray(p.media) ? p.media : []).forEach(m => {
      if (!m || !m.src) return;
      mediaList.appendChild(buildMediaItemEl(m));
    });
    card.appendChild(mediaList);

    return card;
  }

  async function loadProjectsFromCMS() {
    if (!window.PROJECTS_URL) return;
    const grid = document.getElementById('portfolioGrid');
    if (!grid) return;

    try {
      const raw = await loadCmsJson(window.PROJECTS_URL, null, { resolveUrl: siteAssetUrl });
      if (!raw) return;
      const list = Array.isArray(raw) ? raw : (Array.isArray(raw.filters) ? raw.filters : []);
      if (!list.length) return;

      const frag = document.createDocumentFragment();
      list.forEach(p => frag.appendChild(buildProjectCardEl(p)));
      grid.innerHTML = '';
      grid.appendChild(frag);
    } catch (err) {
      console.warn('Projects: could not load', window.PROJECTS_URL, err);
      // Leave the existing static cards in place.
    }
  }
  const cmsReady = Promise.all([
    loadProjectsFromCMS(),
    loadReviewsFromCMS(),
    loadAboutFromCMS(),
    loadFiltersFromCMS()
  ]);
  await cmsReady;
  if (document.querySelector('.project-media-list .media-item[data-lottie], .project-thumb-media[lottie-player]')) await ensureLottiePlayer();


  /* =========================================
     0c. CMS OVERRIDE — REVIEWS
     ========================================= */
  /* Same reasoning as projects: buildReviewsMarquee() (section 6,
     further down) captures whatever's inside #reviewsTrack the first
     time it runs and treats that as the permanent "pristine" set it
     duplicates to build the scrolling loop. If the CMS cards weren't
     in the DOM before that first run, they'd never make it into the
     loop — so, same as projects, this is awaited up front rather than
     fired in the background. */

  function buildReviewCardEl(r) {
    const card = document.createElement('div');
    card.className = 'review-card glass';
    const quote = document.createElement('p');
    quote.className = 'review-quote';
    quote.textContent = r.quote || r.review || '';
    const name = document.createElement('h4');
    name.className = 'review-name';
    name.textContent = r.name || '';
    const role = document.createElement('div');
    role.className = 'review-role';
    role.textContent = r.role || '';
    card.append(quote, name, role);
    return card;
  }

  async function loadReviewsFromCMS() {
    if (!window.REVIEWS_URL) return;
    const track = document.getElementById('reviewsTrack');
    if (!track) return;
    try {
      const raw = await loadCmsJson(window.REVIEWS_URL, null, { resolveUrl: siteAssetUrl });
      if (!raw) return;
      const list = Array.isArray(raw) ? raw : (Array.isArray(raw.reviews) ? raw.reviews : []);
      if (!list.length) return;
      const frag = document.createDocumentFragment();
      list.forEach(r => frag.appendChild(buildReviewCardEl(r)));
      track.innerHTML = '';
      track.appendChild(frag);
    } catch (err) {
      console.warn('Reviews: could not load', window.REVIEWS_URL, err);
    }
  }

  /* =========================================
     0d. CMS OVERRIDE — ABOUT
     ========================================= */
  async function loadAboutFromCMS() {
    if (!window.ABOUT_URL) return;
    const about = document.querySelector('.about-section');
    if (!about) return;
    try {
      const raw = await loadCmsJson(window.ABOUT_URL, null, { resolveUrl: siteAssetUrl });
      if (!raw || typeof raw !== 'object') return;
      const title = about.querySelector('.about-title');
      const body = about.querySelector('.about-body');
      if (title && raw.title) title.textContent = raw.title;
      if (body && raw.body) body.textContent = raw.body;
      if (Array.isArray(raw.skills)) {
        cachedSoftwareSkills = raw.skills;
        renderSoftwareSkills(raw.skills);
      }
    } catch (err) {
      console.warn('About: could not load', window.ABOUT_URL, err);
    }
  }

  /* =========================================
     0e. CMS OVERRIDE — FILTERS
     ========================================= */
  async function loadFiltersFromCMS() {
    if (!window.FILTERS_URL) return;
    const container = document.querySelector('.filter-buttons');
    if (!container) return;
    try {
      const raw = await loadCmsJson(window.FILTERS_URL, null, { resolveUrl: siteAssetUrl });
      if (!raw) return;
      const list = Array.isArray(raw) ? raw : (Array.isArray(raw.filters) ? raw.filters : []);
      if (!list.length) return;
      const frag = document.createDocumentFragment();
      list.forEach(filter => {
        if (!filter || !filter.id) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'filter-btn';
        button.dataset.filter = filter.id;
        button.textContent = filter.label || filter.name || filter.id;
        frag.appendChild(button);
      });
      container.innerHTML = '';
      container.appendChild(frag);
    } catch (err) {
      console.warn('Filters: could not load', window.FILTERS_URL, err);
    }
  }

  /* =========================================
     1. NAV / MENU
     ========================================= */
  const menuButton = document.querySelector('.menu-button');
  const mobileMenu = document.querySelector('.mobile-menu');
  const mobileMenuClose = document.querySelector('.mobile-menu-close');
  const mobileMenuLinks = document.querySelectorAll('.mobile-menu a');

  function openMobileMenu() {
    if (!mobileMenu) return;
    mobileMenu.classList.add('is-open');
    document.body.classList.add('menu-open');
  }

  function closeMobileMenu() {
    if (!mobileMenu) return;
    mobileMenu.classList.remove('is-open');
    document.body.classList.remove('menu-open');
  }

  menuButton?.addEventListener('click', openMobileMenu);
  mobileMenuClose?.addEventListener('click', closeMobileMenu);
  mobileMenuLinks.forEach(link => link.addEventListener('click', closeMobileMenu));

  /* =========================================
     2. PROJECT FILTERS
     ========================================= */
  const filterButtons = document.querySelectorAll('.filter-btn');
  const projectGrid = document.getElementById('portfolioGrid');

  function applyFilter(filter) {
    document.querySelectorAll('.project-card').forEach(card => {
      const ids = JSON.parse(card.dataset.filterIds || '[]');
      const show = filter === 'all' || ids.includes(filter);
      card.style.display = show ? '' : 'none';
    });
  }

  filterButtons.forEach(button => {
    button.addEventListener('click', () => {
      filterButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      applyFilter(button.dataset.filter || 'all');
    });
  });

  /* =========================================
     3. HERO / BANNER
     ========================================= */
  const heroSection = document.querySelector('.hero');
  if (heroSection) {
    try {
      await initHeroBannerV2(heroSection, {
        mode: HERO_LOOP_MODE,
        transition: HERO_TRANSITION,
        crossfadeMs: HERO_CROSSFADE_MS,
        loadJson: loadCmsJson,
        resolveAssetUrl: siteAssetUrl
      });
    } catch (err) {
      console.warn('Hero: initialization failed', err);
    }
  }

  /* =========================================
     4. LIGHTBOX / MEDIA
     ========================================= */
  try {
    await initLightbox({
      root: document,
      protectionEnabled: () => PROTECTION_ENABLED,
      ensureMediaBackgroundHelper,
      parseYouTubeUrl
    });
  } catch (err) {
    console.warn('Lightbox: initialization failed', err);
  }

  /* =========================================
     5. GALLERY
     ========================================= */
  try {
    await initGallery({
      root: document,
      projectGrid,
      resolveAssetUrl: siteAssetUrl,
      ensureLottiePlayer,
      ensureMediaBackgroundHelper
    });
  } catch (err) {
    console.warn('Gallery: initialization failed', err);
  }

  /* =========================================
     6. REVIEWS
     ========================================= */
  function applyReviewsVisibility() {
    if (!reviewsSection) return;
    reviewsSection.style.display = SHOW_REVIEWS ? '' : 'none';
  }

  function buildReviewsMarquee() {
    if (!reviewsTrack || !reviewsMarquee) return;
    if (!pristineTopCards) pristineTopCards = Array.from(reviewsTrack.children).map(el => el.cloneNode(true));
    if (!pristineTopCards.length) return;
    reviewsTrack.innerHTML = '';
    const fragment = document.createDocumentFragment();
    pristineTopCards.forEach(card => fragment.appendChild(card.cloneNode(true)));
    pristineTopCards.forEach(card => fragment.appendChild(card.cloneNode(true)));
    reviewsTrack.appendChild(fragment);
  }

  applyReviewsVisibility();
  buildReviewsMarquee();

  /* =========================================
     7. SOFTWARE SKILLS
     ========================================= */
  function applySoftwareLogosVisibility() {
    document.querySelectorAll('.software-skill').forEach(skill => {
      const logo = skill.querySelector('.software-logo');
      const name = skill.querySelector('.software-name');
      if (logo) logo.style.display = SHOW_SOFTWARE_LOGOS ? '' : 'none';
      if (name) name.style.display = SHOW_SOFTWARE_LOGOS ? 'none' : '';
    });
  }

  function renderSoftwareSkills(skills) {
    const list = document.querySelector('.software-skills');
    if (!list || !Array.isArray(skills)) return;
    list.innerHTML = '';
    skills.forEach(skill => {
      if (!skill) return;
      const item = document.createElement('div');
      item.className = 'software-skill';
      const logo = document.createElement('img');
      logo.className = 'software-logo';
      if (skill.logo) logo.src = siteAssetUrl(skill.logo);
      logo.alt = skill.name || '';
      const name = document.createElement('span');
      name.className = 'software-name';
      name.textContent = skill.name || '';
      item.append(logo, name);
      list.appendChild(item);
    });
    applySoftwareLogosVisibility();
  }

  applySoftwareLogosVisibility();

  /* =========================================
     8. FORMS
     ========================================= */
  function applyFormToggle(form, emailButton, enabled) {
    if (!form || !emailButton) return;
    form.style.display = enabled ? '' : 'none';
    emailButton.style.display = enabled ? 'none' : '';
  }

  const projectForm = document.getElementById('projectForm');
  const projectEmailBtn = document.getElementById('projectEmailBtn');
  const reviewForm = document.getElementById('reviewForm');
  const reviewEmailBtn = document.getElementById('reviewEmailBtn');

  applyFormToggle(projectForm, projectEmailBtn, FORMS_ENABLED.project);
  applyFormToggle(reviewForm, reviewEmailBtn, FORMS_ENABLED.review);

  projectEmailBtn?.addEventListener('click', () => {
    const email = document.querySelector('a[href^="mailto:"]')?.getAttribute('href');
    if (email) window.location.href = email;
  });

  reviewEmailBtn?.addEventListener('click', () => {
    const email = document.querySelector('a[href^="mailto:"]')?.getAttribute('href');
    if (email) window.location.href = email;
  });

  /* =========================================
     9. CMS SETTINGS FINALIZATION
     ========================================= */
  await Promise.all([settingsReady, cmsReady]);
  applyCardBadgesVisibility();
  applyReviewsVisibility();
  applySoftwareLogosVisibility();

  hideInitialPageTransition();
  if (initialTransitionTimer) window.clearTimeout(initialTransitionTimer);

  } catch (err) {
    console.error('Portfolio runtime failed to initialize', err);
    hideInitialPageTransition();
    if (initialTransitionTimer) window.clearTimeout(initialTransitionTimer);
  }
});
