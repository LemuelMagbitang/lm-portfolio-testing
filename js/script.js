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
  const runtimeUrl = runtimeScript ? new URL('site-runtime.js', runtimeScript.src).href : new URL('js/site-runtime.js', document.baseURI).href;
  const { getSiteRootUrl, siteAssetUrl, ensureLottiePlayer, ensureMediaBackgroundHelper } = await import(runtimeUrl);
  const [{ loadCmsJson, parseYouTubeUrl }, { initGallery }, { initHeroBannerV2 }, { initLightbox }] = await Promise.all([
    import(new URL('cms-data.js', runtimeUrl).href),
    import(new URL('gallery.js', runtimeUrl).href),
    import(new URL('hero.js', runtimeUrl).href),
    import(new URL('lightbox.js', runtimeUrl).href)
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
      const media = buildThumbnailMedia({type:t.type||heroMediaTypeFromSrc(t.src),src:t.src,background:thumbBackground}, p.title || 'Project artwork');
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
    card.className = 'review-card';

    const stars = document.createElement('div');
    stars.className = 'review-stars';
    const filled = Math.max(0, Math.min(5, Math.round(Number(r.stars) || 0)));
    stars.textContent = '★'.repeat(filled) + '☆'.repeat(5 - filled);

    const quote = document.createElement('p');
    quote.className = 'review-quote';
    quote.textContent = '"' + (r.quote || '') + '"';

    const author = document.createElement('span');
    author.className = 'review-author';
    author.textContent = '— ' + (r.author || '');

    card.appendChild(stars);
    card.appendChild(quote);
    card.appendChild(author);
    return card;
  }

  async function loadReviewsFromCMS() {
    if (!window.REVIEWS_URL) return;
    const track = document.getElementById('reviewsTrack');
    if (!track) return;

    try {
      const list = await loadCmsJson(window.REVIEWS_URL, null, { resolveUrl: siteAssetUrl });
      if (!list) return;
      if (!Array.isArray(list) || !list.length) return;

      const frag = document.createDocumentFragment();
      list.forEach(r => frag.appendChild(buildReviewCardEl(r)));
      track.innerHTML = '';
      track.appendChild(frag);
    } catch (err) {
      console.warn('Reviews: could not load', window.REVIEWS_URL, err);
      // Leave the existing static cards in place.
    }
  }
/* =========================================
     0d. CMS OVERRIDE — ABOUT PAGE
     ========================================= */
  /* This one only ever does anything on about/index.html — it bails
     immediately on every other page since #aboutHeadline doesn't
     exist there. Nothing else in this file reads the about content,
     so unlike projects/reviews there's no "must finish before X"
     requirement here; it's awaited anyway just to keep every CMS
     loader following the same shape. */

  function buildTimelineBlock({ title, dateLine, bullets }) {
    const item = document.createElement('div');
    item.className = 'timeline-item clean-timeline';

    const h4 = document.createElement('h4');
    h4.textContent = title || '';
    item.appendChild(h4);

    if (dateLine) {
      const span = document.createElement('span');
      span.className = 'timeline-date';
      span.textContent = dateLine;
      item.appendChild(span);
    }

    const validBullets = (bullets || []).map(b => (b || '').trim()).filter(Boolean);
    validBullets.forEach((b, i) => {
      const p = document.createElement('p');
      p.textContent = b;
      item.appendChild(p);
      if (i < validBullets.length - 1) item.appendChild(document.createElement('br'));
    });

    return item;
  }

  // The fallback when no logo of any kind can be found and one is
  // still wanted: initials, not the full name, so a skill that
  // couldn't be matched to a logo still reads like a compact mark
  // rather than suddenly breaking the row's rhythm with a full word.
  // Multi-word names take one letter per word — except a short,
  // already-compact word (a model number like "4D" or "3D") is kept
  // whole rather than reduced to a single digit. A single-word name
  // ("Blender", "Figma") has nothing to abbreviate, so it's shown
  // exactly as typed instead of cut down to one cryptic letter.
  function skillInitials(name) {
    const words = (name || '').trim().split(/\s+/).filter(Boolean);
    if (words.length <= 1) return name || '';
    return words.map(w => (w.length <= 2 || /\d/.test(w)) ? w.toUpperCase() : w[0].toUpperCase()).join('');
  }

  function fillSkillList(id, list) {
    const ul = document.getElementById(id);
    if (!ul || !Array.isArray(list) || !list.length) return;
    ul.innerHTML = '';
    // Multimedia skills are always plain strings, and never show a
    // logo — a category like "3D Modeling" has no brand mark to show
    // in the first place. Software skills can be a plain string
    // (older data) or {name, icon}; whether they show as a logo at
    // all is the one global SHOW_SOFTWARE_LOGOS switch, not a
    // per-skill choice — see the switches at the top of this file.
    const siteRoot = getSiteRootUrl();
    list.forEach(s => {
      const li = document.createElement('li');
      const name = typeof s === 'string' ? s : (s && s.name) || '';
      const manualIcon = (s && typeof s === 'object') ? s.icon : '';
      const useLogo = (s && typeof s === 'object') && SHOW_SOFTWARE_LOGOS;

      if (useLogo) {
        li.classList.add('has-logo');
        // Give every logo its own quiet, rectangular "plate" so transparent
        // PNGs (such as an After Effects mark) do not visually disappear into
        // the dark About background. The plate is not a pill and never depends
        // on the logo artwork's alpha; it is part of the site's own UI surface.
        const logoFrame = document.createElement('span');
        logoFrame.className = 'skill-logo-frame';
        logoFrame.title = name;

        const img = document.createElement('img');
        img.className = 'skill-logo';
        img.alt = name; // read by screen readers even though the text itself isn't shown
        img.title = name; // shows the name on hover, same info a text chip would give at a glance
        img.loading = 'lazy';
        logoFrame.appendChild(img);
        li.appendChild(logoFrame);

        const domain = SOFTWARE_DOMAINS[name.toLowerCase()];
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        // Tried in order — each source's failure is what triggers the
        // next: a hand-picked file, then Simple Icons (a curated
        // software/brand icon set — tried first since it's built
        // specifically for this and its results are already
        // monochrome-friendly), then Clearbit (a general company-logo
        // lookup by domain — wider coverage, but a plain color
        // wordmark rather than a purpose-made icon). Nothing found
        // anywhere falls back to initials instead of a broken image.
        const attempts = [];
        if (manualIcon) attempts.push(new URL(manualIcon, siteRoot).href);
        if (slug) attempts.push(`https://cdn.simpleicons.org/${slug}`);
        if (domain) attempts.push(`https://logo.clearbit.com/${domain}?size=64`);

        let step = 0;
        img.onerror = () => {
          step += 1;
          if (step < attempts.length) img.src = attempts[step];
          else {
            logoFrame.classList.add('is-fallback');
            img.remove();
            logoFrame.textContent = skillInitials(name);
          }
        };
        if (attempts.length) img.src = attempts[0];
        else {
          logoFrame.classList.add('is-fallback');
          img.remove();
          logoFrame.textContent = skillInitials(name);
        }
      } else {
        li.textContent = name;
      }
      ul.appendChild(li);
    });
  }

  // Re-renders the software skills list against whatever
  // SHOW_SOFTWARE_LOGOS currently is. Called once About's own data
  // finishes loading, and again from applySettings if the setting
  // arrives after that — see the comment on SHOW_REVIEWS's own
  // equivalent function for why both call sites matter here.
  // (cachedSoftwareSkills itself is declared at the very top of this
  // file, in section 0, for that same reason.)
  function applySoftwareLogosVisibility() {
    if (cachedSoftwareSkills) fillSkillList('softwareSkillsList', cachedSoftwareSkills);
  }

  async function loadAboutFromCMS() {
    if (!window.ABOUT_URL) return;
    const headlineEl = document.getElementById('aboutHeadline');
    if (!headlineEl) return; // not the about page — nothing to do

    try {
      const a = await loadCmsJson(window.ABOUT_URL, null, { resolveUrl: siteAssetUrl });
      if (!a) return;
      if (!a || typeof a !== 'object') return;

      if (a.headline) headlineEl.textContent = a.headline;

      const subheadEl = document.getElementById('aboutSubhead');
      if (subheadEl && a.subhead) subheadEl.textContent = a.subhead;

      const bioEl = document.getElementById('aboutBio');
      if (bioEl && a.bio) bioEl.textContent = a.bio;

      const photoEl = document.getElementById('aboutPhoto');
      // a.photo can be a plain path string (the original shape) or an
      // object with zoom/focus/rotate alongside it, the same
      // src-plus-adjustments shape a project's thumbnail already uses.
      // Normalizing here means this works with data saved before the
      // photo editor supported those fields, and with data saved after.
      const photo = typeof a.photo === 'string' ? { src: a.photo } : (a.photo || {});
      if (photoEl && photo.src) {
        // a.photo.src is stored root-relative in data/about.json (e.g.
        // "assets/projects/site/profile.jpg"), the same way every path
        // in every data/*.json file is. That resolves fine wherever the
        // homepage reads it (the homepage *is* the site root), but this
        // loader also runs on /about/ — one folder below root — where
        // setting it directly would resolve to /about/assets/... and
        // 404. Resolving it against the site root instead fixes that;
        // an already-absolute URL (https://...) passes through new URL()
        // completely unchanged, so pasting a full image URL still works.
        const siteRoot = getSiteRootUrl();
        photoEl.src = new URL(photo.src, siteRoot).href;
        // Same three adjustments a project thumbnail supports (see
        // applyThumbnailAdjustments below), applied directly here
        // since the profile photo isn't a .project-card thumbnail for
        // that function to find on its own. transformOrigin has to
        // match objectPosition here too, for the same reason it does
        // on a project thumbnail — see the comment there.
        if (photo.focus) { photoEl.style.objectPosition = photo.focus; photoEl.style.transformOrigin = photo.focus; }
        if (photo.zoom) photoEl.style.setProperty('--thumb-zoom', photo.zoom);
        if (photo.rotate) photoEl.style.setProperty('--thumb-rotate', photo.rotate + 'deg');
      }

      cachedSoftwareSkills = a.softwareSkills;
      fillSkillList('softwareSkillsList', a.softwareSkills);
      fillSkillList('multimediaSkillsList', a.multimediaSkills);

      const expList = document.getElementById('experienceList');
      if (expList && Array.isArray(a.experience) && a.experience.length) {
        expList.innerHTML = '';
        a.experience.forEach(exp => {
          expList.appendChild(buildTimelineBlock({ title: exp.role, dateLine: [exp.company, exp.startDate || exp.endDate ? `${exp.startDate || ''}${exp.startDate || exp.endDate ? ' – ' : ''}${exp.endDate || ''}` : ''].filter(Boolean).join(' · '), bullets: exp.bullets }));
        });
      }

      const eduList = document.getElementById('educationList');
      if (eduList && Array.isArray(a.education) && a.education.length) {
        eduList.innerHTML = '';
        a.education.forEach(e => {
          eduList.appendChild(buildTimelineBlock({ title: e.school || e.title, dateLine: [e.degree, e.graduationDate].filter(Boolean).join(' · ') || e.detail, bullets: [] }));
        });
      }

      const awList = document.getElementById('awardsList');
      if (awList && Array.isArray(a.awards) && a.awards.length) {
        awList.innerHTML = '';
        a.awards.forEach(aw => {
          awList.appendChild(buildTimelineBlock({ title: aw.title, dateLine: aw.detail, bullets: [] }));
        });
      }
    } catch (err) {
      console.warn('About: could not load', window.ABOUT_URL, err);
      // Leave the existing static content in place.
    }
  }
/* =========================================
     0e. CMS OVERRIDE — FILTERS & BADGES
     ========================================= */
  /* Rebuilds the filter-tab buttons (homepage only) and the nav-bar
     "Works" dropdown (every page that has one) from data/filters.json.
     The ALL tab is never part of this data — it's structural, kept
     exactly as already written in the HTML — matching the CMS plan's
     own rule that ALL always exists automatically.

     Same "must finish before it's read" requirement as projects and
     reviews: filterBtns is captured once, in section 5 below, so this
     needs to run first. */

  async function loadFiltersFromCMS() {
    if (!window.FILTERS_URL) return;

    try {
      const raw = await loadCmsJson(window.FILTERS_URL, null, { resolveUrl: siteAssetUrl });
      if (!raw) return;
      const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.filters) ? raw.filters : []);
      if (!list.length) return;

      // Filter tabs — only exist on the homepage; harmless no-op elsewhere.
      const tabs = document.querySelector('.filter-tabs');
      if (tabs) {
        const allBtn = tabs.querySelector('.tab-btn[data-filter="all"]');
        tabs.innerHTML = '';
        tabs.appendChild(allBtn || Object.assign(document.createElement('button'), {
          className: 'tab-btn active', textContent: 'ALL'
        }));
        if (!allBtn) tabs.lastChild.setAttribute('data-filter', 'all');

        list.forEach(f => {
          if (!f || !f.id) return;
          const btn = document.createElement('button');
          btn.className = 'tab-btn';
          btn.setAttribute('data-filter', f.id);
          btn.textContent = f.label || f.id;
          tabs.appendChild(btn);
        });
      }

      // Nav-bar "Works" dropdown — appears on every page. Each page
      // already links to itself with a different prefix (the
      // homepage uses "/#id", the about page uses "../#id"), so the
      // prefix is read off whatever link is already there rather than
      // hardcoded, and reused for every rebuilt item.
      document.querySelectorAll('.nav-dropdown-menu').forEach(menu => {
        const firstLink = menu.querySelector('a');
        const prefix = firstLink ? firstLink.getAttribute('href').split('#')[0] + '#' : '#';
        menu.innerHTML = '';
        list.forEach(f => {
          if (!f || !f.id) return;
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = prefix + f.id;
          a.textContent = f.label || f.id;
          li.appendChild(a);
          menu.appendChild(li);
        });
      });
    } catch (err) {
      console.warn('Filters: could not load', window.FILTERS_URL, err);
      // Leave the existing static tabs/dropdown in place.
    }
  }
/* =========================================
     0f. HOMEPAGE HERO — MESSAGES (fallback only)
     ========================================= */
  /* Hero messages now live in data/hero.json and are edited through
     admin/ — see /README-CMS-SETUP.md. This single entry is a
     fallback only, used if that fetch ever fails; it's not where you
     add real messages anymore. */
  const HERO_MESSAGES = [
    { text: 'Open for freelance work.' }
  ];

  /* Live source: data/hero.json, fetched via window.HERO_MESSAGES_URL
     (set in index.html). getHeroMessages() below prefers that; the
     fallback array above is only used if the fetch hasn't resolved
     yet or fails outright. */

  /* HOW LONG A MESSAGE CAN BE.

     The hero now sizes itself to whatever text is in it — a short
     line gives a short hero, a long one gives a taller hero. This is
     the ceiling that stops it from ever growing into a wall of type
     you have to scroll past before reaching the work.

     180 characters is roughly six lines at the largest desktop size,
     which lands just under the old fixed hero height. That old height
     is now the maximum rather than the fixed size, exactly as asked.

     If you go over: the message is trimmed at the last whole word and
     given an ellipsis, and a warning naming the entry is printed to
     the browser console (F12 → Console) so you know it happened
     rather than quietly shipping a cut-off sentence. Raise the number
     if you want longer messages — just check the hero on a phone
     afterwards, since that's where a long one bites first. */
  const HERO_MAX_CHARS = 180;

  // Timed crossfade is OFF by default: you asked for the text to
  // change on refresh only, so each visit / new tab is one message,
  // held. Set this to a number of milliseconds (e.g. 7000) if you
  // ever want it to cycle on a timer again instead.
  const HERO_AUTO_ROTATE_MS = 0;

  const HERO_FADE_MS = 600; // must match the CSS transition on .hero-quote-text

  function getHeroMessages() {
    const fromCms = window.HERO_MESSAGES;
    if (Array.isArray(fromCms) && fromCms.length) return fromCms;
    return HERO_MESSAGES;
  }

  // Enforces HERO_MAX_CHARS. Applies to whatever list is in use, so a
  // future CMS gets the same protection without any extra work.
  function capHeroText(raw, i) {
    const text = String(raw || '');
    if (text.length <= HERO_MAX_CHARS) return text;

    const cut = text.slice(0, HERO_MAX_CHARS);
    const lastSpace = cut.lastIndexOf(' ');
    const trimmed = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.\u2014-]+$/, '');

    console.warn(
      'Hero message #' + i + ' is ' + text.length + ' characters, over the ' +
      HERO_MAX_CHARS + '-character limit, so it was shortened. ' +
      'Edit HERO_MESSAGES in script.js, or raise HERO_MAX_CHARS.'
    );
    return trimmed + '\u2026';
  }

  /* Picks a random entry, weighted by each message's optional `weight`
     field (set from the CMS). 1 = normal odds; higher = shows more
     often; lower (e.g. 0.2) = a rare easter egg. Missing/invalid
     weights default to 1, so old data without the field behaves
     exactly as before. Also deliberately avoids repeating the one
     shown last time where another non-zero-weight option exists. The
     last index is remembered in localStorage, which is shared across
     tabs of the same site — so opening a second tab reliably gives
     you a different message instead of rolling the same number twice
     in a row. */
  function pickHeroIndex(messages, exclude) {
    const total = messages.length;
    if (total <= 1) return 0;

    const weights = messages.map(m => {
      const w = m && typeof m.weight === 'number' && isFinite(m.weight) && m.weight >= 0 ? m.weight : 1;
      return w;
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    function weightedPick() {
      if (totalWeight <= 0) return Math.floor(Math.random() * total);
      let r = Math.random() * totalWeight;
      for (let idx = 0; idx < total; idx++) {
        r -= weights[idx];
        if (r <= 0) return idx;
      }
      return total - 1;
    }

    let i = weightedPick();
    const hasAlternative = weights.some((w, idx) => idx !== exclude && w > 0);
    if (i === exclude && hasAlternative) {
      let tries = 0;
      while (i === exclude && tries < 10) { i = weightedPick(); tries++; }
    }
    return i;
  }

  function readLastHeroIndex() {
    try {
      const raw = window.localStorage.getItem('lm:lastHeroMessage');
      return raw === null ? -1 : parseInt(raw, 10);
    } catch (err) {
      return -1; // private mode / storage blocked — just go fully random
    }
  }

  function rememberHeroIndex(i) {
    try { window.localStorage.setItem('lm:lastHeroMessage', String(i)); } catch (err) { /* ignore */ }
  }

  function initHeroMessage() {
    const root = document.getElementById('heroQuote') || document.querySelector('.hero-quote');
    if (!root) return; // this page has no hero message block

    // The three lines are created here if they aren't already in the
    // HTML, so index.html only needs the empty <div class="hero-quote">
    // wrapper and nothing can fall out of sync between the two files.
    function ensure(id, cls, tag) {
      let el = document.getElementById(id) || root.querySelector('.' + cls);
      if (!el) {
        el = document.createElement(tag);
        el.id = id;
        el.className = cls;
        root.appendChild(el);
      }
      return el;
    }

    const labelEl = ensure('heroQuoteLabel', 'hero-quote-label', 'span');
    const textEl = ensure('heroQuoteText', 'hero-quote-text', 'p');
    const authorEl = ensure('heroQuoteAuthor', 'hero-quote-author', 'span');

    // Keeps the DOM order right even if the wrapper already had some
    // of these in a different order.
    root.appendChild(labelEl);
    root.appendChild(textEl);
    root.appendChild(authorEl);

    let messages = getHeroMessages();
    let current = -1;

    function render(i) {
      const item = messages[i] || {};
      current = i;

      // textContent everywhere, never innerHTML — the author line is
      // plain text now (no book link), and this also means a future
      // CMS can't accidentally inject markup into the page.
      labelEl.textContent = item.label || '';
      labelEl.style.display = item.label ? '' : 'none';

      textEl.textContent = capHeroText(item.text, i);

      const credit = [item.author, item.source].filter(Boolean).join(', ');
      authorEl.textContent = credit ? '— ' + credit : '';
      authorEl.style.display = credit ? '' : 'none';

      root.classList.add('is-ready');
    }

    function fadeTo(i) {
      root.style.opacity = '0';
      setTimeout(() => {
        render(i);
        rememberHeroIndex(i);
        root.style.opacity = '1';
      }, HERO_FADE_MS);
    }

    // One random pick per page load — this is the "different every
    // time you refresh / open a new tab" behaviour.
    const first = pickHeroIndex(messages, readLastHeroIndex());
    render(first);
    rememberHeroIndex(first);

    if (HERO_AUTO_ROTATE_MS > 0) {
      setInterval(() => fadeTo(pickHeroIndex(messages, current)), HERO_AUTO_ROTATE_MS + HERO_FADE_MS);
    }

    // If the CMS points at a JSON file, load it and re-pick from the
    // fresh list once it lands.
    if (window.HERO_MESSAGES_URL) {
      loadCmsJson(window.HERO_MESSAGES_URL, null, { resolveUrl: siteAssetUrl })
        .then(list => {
          if (!Array.isArray(list) || !list.length) return;
          messages = list;
          fadeTo(pickHeroIndex(messages, -1));
        })
        .catch(err => console.warn('Hero messages: could not load', window.HERO_MESSAGES_URL, err));
    }
  }
  initHeroMessage();


  /* =========================================
     1. PROJECT CARD SETUP (badges + fallback thumbnails)
     ========================================= */
  // Hides every badge pill if you've switched them off above.
  applyCardBadgesVisibility();

  // If a project card's <div class="card-thumbnail"> was left empty
  // (no <img> inside, or an <img> with no src) this fills it in using
  // the card's own first media-list item. Lottie keeps its transparent
  // animation while inheriting the exact CMS background. A model uses a
  // lightweight preview tile rather than creating a WebGL renderer for
  // every card, but it also inherits the model's CMS background.
  function buildThumbnailMedia(source, altText){
    if (!source || !source.src) return null;
    let media;
    if (source.type === 'video') {
      media=document.createElement('video'); media.src=siteAssetUrl(source.src); media.muted=true; media.loop=true; media.autoplay=true; media.playsInline=true; media.preload='metadata';
    } else if (source.type === 'lottie') {
      media=document.createElement('lottie-player'); media.setAttribute('src',siteAssetUrl(source.src)); media.setAttribute('autoplay',''); media.setAttribute('loop',''); media.setAttribute('background','transparent'); media.setAttribute('preserveAspectRatio','xMidYMid slice');
    } else if (source.type === 'model') {
      media=document.createElement('div');
      media.className='project-thumb-model';
      media.setAttribute('role','img');
      media.setAttribute('aria-label',(altText||'Project artwork')+' — interactive 3D view available');
      media.innerHTML='<div class="project-thumb-model-content"><i class="fa-solid fa-cube" aria-hidden="true"></i><span>INTERACTIVE 3D</span><small>Open artwork to explore</small></div>';
    } else {
      media=document.createElement('img'); media.src=siteAssetUrl(source.src); media.alt=altText||'Project artwork'; media.loading='lazy'; media.decoding='async';
    }
    media.classList.add('project-thumb-media');
    if (source.type === 'model') {
      media.setAttribute('data-model-thumb', source.src);
    }
    if (source.background && typeof source.background === 'object') media.setAttribute('data-background', JSON.stringify(source.background));
    return media;
  }

  function projectFallbackSource(card){
    const mediaItems = card.querySelectorAll('.project-media-list .media-item');
    for (const item of mediaItems) {
      let background=null;
      const rawBg=item.getAttribute('data-background');
      if(rawBg){try{background=JSON.parse(rawBg);}catch(e){background=null;}}
      const image = item.getAttribute('data-image');
      if (image) return {type:'image',src:image,background};
      const video = item.getAttribute('data-video');
      if (video) return {type:'video',src:video,background};
      const lottie = item.getAttribute('data-lottie');
      if (lottie) return {type:'lottie',src:lottie,background};
      const model = item.getAttribute('data-model');
      if (model) return {type:'model',src:model,background,orientation:item.getAttribute('data-orientation') || ''};
      // YouTube stays a last-resort fallback because it requires a
      // thumbnail request rather than being a locally playable asset.
    }
    const yt=card.querySelector('.project-media-list .media-item[data-youtube]');
    if(yt){ const {id}=parseYouTubeUrl(yt.getAttribute('data-youtube')); if(id)return {type:'image',src:`https://img.youtube.com/vi/${id}/hqdefault.jpg`}; }
    return null;
  }

  function fillMissingThumbnails() {
    document.querySelectorAll('.project-card').forEach(card => {
      const wrap=card.querySelector('.card-thumbnail'); if(!wrap) return;
      if(wrap.querySelector('.project-thumb-media')) return;
      const existing=wrap.querySelector('img');
      if(existing && existing.getAttribute('src')) { existing.classList.add('project-thumb-media'); return; }
      const source=projectFallbackSource(card); if(!source) return;
      const titleEl=card.querySelector('.glass-info h3');
      const media=buildThumbnailMedia(source,titleEl?titleEl.textContent:'Project artwork');
      if(media) {
        wrap.appendChild(media);
        if(source.background && typeof source.background === 'object') wrap.setAttribute('data-background', JSON.stringify(source.background));
        if(source.type==='video') media.setAttribute('data-video-thumb','');
        if(source.type==='lottie') media.setAttribute('data-lottie-thumb','');
        if(source.type==='model') media.setAttribute('data-model-thumb','');
      }
      const has3DMedia = !!card.querySelector('.project-media-list .media-item[data-model]');
      if (has3DMedia) {
        wrap.classList.add('has-3d-view');
        if (!wrap.querySelector('.card-3d-indicator')) {
          const indicator = document.createElement('div');
          indicator.className = 'card-3d-indicator';
          indicator.innerHTML = '<i class="fa-solid fa-cube" aria-hidden="true"></i><span>3D VIEW AVAILABLE</span>';
          wrap.appendChild(indicator);
        }
      }
    });
  }
  // The background helper is defined later in this file, but function
  // declarations are hoisted. Loading it before thumbnail adjustments is
  // important: CMS Lottie / 3D thumbnails need their custom background
  // rendered at the same time as the media, not only when the hero loads.
  if (document.querySelector('[data-background]')) await ensureMediaBackgroundHelper();
  fillMissingThumbnails();

  // Lets you manually fine-tune where a thumbnail crops/zooms — for
  // artwork where the automatic center-crop cuts off the wrong part,
  // or where the source image has its own padding/background baked in
  // (common with staged 3D renders — cropping in with data-zoom is
  // usually the fix, since CSS can't remove pixels that are part of
  // the image file itself).
  //
  // Add any of these to the thumbnail <img> itself:
  //   data-focus="30% 10%"   -> which part of the image stays visible
  //                              (same idea as the hero banner's data-focus)
  //   data-zoom="1.3"        -> zooms in (1 = normal, 1.3 = 30% closer)
  //   data-rotate="2"        -> rotates in degrees, rarely needed
  //
  // Relying on the automatic fallback thumbnail instead of writing an
  // <img> by hand? Put these same three attributes on the
  // <div class="card-thumbnail"> wrapper itself — same effect, since
  // there's no <img> yet for you to add them to directly.
  function applyThumbnailAdjustments() {
    document.querySelectorAll('.project-card .card-thumbnail').forEach(wrap => {
      const media=wrap.querySelector('.project-thumb-media, img'); if(!media) return;
      const focus=media.getAttribute('data-focus')||wrap.getAttribute('data-focus');
      const zoom=media.getAttribute('data-zoom')||wrap.getAttribute('data-zoom');
      const rotate=media.getAttribute('data-rotate')||wrap.getAttribute('data-rotate');
      if(focus){media.style.objectPosition=focus;media.style.transformOrigin=focus;}
      if(zoom)media.style.setProperty('--thumb-zoom',zoom);
      if(rotate)media.style.setProperty('--thumb-rotate',rotate+'deg');
      if(window.LMMediaBackground){
        let bg=null; try{ const raw=media.getAttribute('data-background')||wrap.getAttribute('data-background'); bg=raw?JSON.parse(raw):null; }catch(e){}
        if(bg) window.LMMediaBackground.apply(wrap,bg,siteAssetUrl);
      }
    });
  }
  applyThumbnailAdjustments();


  /* =========================================
     2. HAMBURGER MENU
     ========================================= */
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('active');
      document.body.classList.toggle('menu-open', isOpen);
      hamburger.setAttribute('aria-expanded', String(isOpen));
    });

    // Tapping anywhere outside the open menu (the dimmed backdrop, a
    // nav link, anywhere) closes it — standard mobile menu behavior.
    document.addEventListener('click', (e) => {
      if (!document.body.classList.contains('menu-open')) return;
      if (navLinks.contains(e.target) || hamburger.contains(e.target)) return;
      navLinks.classList.remove('active');
      document.body.classList.remove('menu-open');
      hamburger.setAttribute('aria-expanded', 'false');
    });

    // Clicking any link inside the menu also closes it — matters most
    // for the Works > 3D & Motion / Illustration / UI-UX links, since
    // those change the page via a hash and don't force a full reload.
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('active');
        document.body.classList.remove('menu-open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }


  /* =========================================
     3. CONTACT FORMS <-> EMAIL ME TOGGLE
     ========================================= */
  function applyFormToggle(formEl, emailBtnEl, isEnabled) {
    if (!formEl || !emailBtnEl) return;
    formEl.style.display = isEnabled ? '' : 'none';
    emailBtnEl.style.display = isEnabled ? 'none' : 'flex';
  }

  applyFormToggle(
    document.getElementById('projectForm'),
    document.getElementById('projectEmailBtn'),
    FORMS_ENABLED.project
  );

  applyFormToggle(
    document.getElementById('reviewForm'),
    document.getElementById('reviewEmailBtn'),
    FORMS_ENABLED.review
  );




  /* =========================================
     4/5. PUBLIC FEATURE MODULES — ARCHITECTURE V2
     ========================================= */
  await Promise.all([settingsReady, cmsReady]);
  try {
    await initHeroBannerV2({
      loopMode: HERO_LOOP_MODE,
      transitionStyle: HERO_TRANSITION,
      crossfadeMs: HERO_CROSSFADE_MS
    });
  } catch (err) {
    console.error('Hero: could not initialize hero banner.', err);
  }

  const galleryController = initGallery();
  initLightbox({
    getActiveCards: () => galleryController?.getActiveCards?.() || [],
    protectionEnabled: () => PROTECTION_ENABLED
  });

  /* =========================================
     6. CLIENT REVIEWS — TWO-ROW BRICK LOOP
     ========================================= */
  // Splits whatever review cards are in the HTML into two rows (top row
  // = 1st, 3rd, 5th... review; bottom row = 2nd, 4th, 6th...). Each row
  // repeats its own cards as many times as needed to comfortably outrun
  // a wide monitor — so a short review list still reads as a full,
  // populated wall on a big screen instead of visibly running out and
  // leaving blank space — then loops infinitely. You only ever need to
  // write each review once in the HTML; this handles the rest, and
  // re-measures whenever the window is resized.
  // reviewsMarquee / reviewsTrack / reviewsSection now declared at the
  // very top of the file (section 0) — see the comment there for why.
  // Visibility (and the initial marquee build, if on) is handled by
  // applyReviewsVisibility() below, once buildReviewsMarquee exists.

  function buildReviewsMarquee() {
    if (!SHOW_REVIEWS) return;
    if (!reviewsTrack || !reviewsMarquee) return;

    // The very first run: read the real cards out of the HTML once and
    // keep a clean, never-duplicated copy of each row's set. Every
    // rebuild after that (e.g. on resize) starts fresh from this copy
    // instead of duplicating what's already been duplicated.
    if (!pristineTopCards) {
      const cards = Array.from(reviewsTrack.children);
      if (cards.length === 0) return;
      pristineTopCards = cards.filter((_, i) => i % 2 === 0);
      pristineBottomCards = cards.filter((_, i) => i % 2 !== 0);
    }

    reviewsTrack.innerHTML = '';
    const containerWidth = reviewsMarquee.clientWidth || window.innerWidth;

    [pristineTopCards, pristineBottomCards].forEach((pristineCards, i) => {
      if (pristineCards.length === 0) return;

      const row = document.createElement('div');
      row.className = i === 0 ? 'reviews-row reviews-row-a' : 'reviews-row reviews-row-b';
      pristineCards.forEach(card => row.appendChild(card.cloneNode(true)));
      reviewsTrack.appendChild(row);

      // Measure one full, un-duplicated set of this row's cards.
      const setWidth = row.scrollWidth;
      if (setWidth === 0) return;

      // Repeat enough copies that two full sets' worth of width is
      // always on screen — the actual guarantee an infinite marquee
      // needs so it never visibly runs dry, on any monitor size.
      const copiesNeeded = Math.max(1, Math.ceil((containerWidth * 2) / setWidth));
      for (let c = 1; c < copiesNeeded; c++) {
        pristineCards.forEach(card => row.appendChild(card.cloneNode(true)));
      }

      // The CSS animation reads this to know exactly how far to slide
      // before looping — one set-width, however many copies follow it.
      row.style.setProperty('--set-width', `${setWidth}px`);
    });
  }

  function applyReviewsVisibility() {
    if (reviewsSection) reviewsSection.style.display = SHOW_REVIEWS ? '' : 'none';
    if (SHOW_REVIEWS) buildReviewsMarquee();
  }
  applyReviewsVisibility();

  let reviewsResizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(reviewsResizeTimeout);
    reviewsResizeTimeout = setTimeout(buildReviewsMarquee, 200);
  });



  /* =========================================
     8. PAGE TRANSITION
     ========================================= */
  // A brief logo flourish, scoped tightly on purpose so it reads as a
  // nice touch rather than a delay you feel on every click:
  //  - Plays once on every fresh page load (Works, About, whichever).
  //  - Also plays when leaving via a link that goes to a genuinely
  //    different page (e.g. Works -> About).
  //  - Never fires for filter tabs, the Works dropdown's same-page hash
  //    links while already on that page, the lightbox, "Back to Top",
  //    mailto/external links, or anything opening in a new tab.
  if (pageTransition) {
    // Compares two pages by their real resolved path, treating
    // "/about/", "/about/index.html" and "/about" as the same page.
    // (The site now uses clean folder URLs — e.g. about/ instead of
    // about.html — so comparing raw filenames like it used to doesn't
    // work anymore: a directory URL's pathname ends in "/", and the
    // old `.split('/').pop()` trick reads that as an empty string.)
    function normalizedPagePath(pathname) {
      let p = pathname.replace(/index\.html$/, '');
      if (p.length > 1) p = p.replace(/\/+$/, '');
      return p || '/';
    }

    function isRealPageNavigation(link) {
      const href = link.getAttribute('href');
      if (!href) return false;
      if (href.startsWith('#')) return false;
      if (href.startsWith('mailto:') || href.startsWith('tel:')) return false;
      if (link.target === '_blank') return false;
      if (/^https?:\/\//i.test(href)) return false; // external links

      const linkUrl = new URL(href, window.location.href);
      if (linkUrl.origin !== window.location.origin) return false;

      return normalizedPagePath(linkUrl.pathname) !== normalizedPagePath(window.location.pathname);
    }

    document.querySelectorAll('a[href]').forEach(link => {
      if (!isRealPageNavigation(link)) return;

      link.addEventListener('click', (e) => {
        e.preventDefault();
        const destination = link.getAttribute('href');
        pageTransition.classList.remove('is-hidden');
        pageTransition.classList.add('is-entering');
        setTimeout(() => { window.location.href = destination; }, 320);
      });
    });
  }

  /* THE "CONTACT LANDS IN THE MIDDLE OF THE PAGE" FIX.

     Clicking Contact from the About page is a real navigation to
     index.html#contact-section. The browser's own native behavior is
     to scroll to that element as soon as it exists in the DOM while
     parsing — which, on this page, is well before the hero banner's
     artwork images and the project thumbnails have finished
     downloading. Both of those load in fully async, after the page
     has already parsed, and both push everything below them further
     down the page as they arrive. The native scroll already happened
     against the page's shorter, not-yet-settled height — so by the
     time everything finishes loading, the section itself has moved
     down past wherever the page was left, which reads as "landed
     somewhere in the middle" rather than at the section.

     window's 'load' event fires only once every last resource —
     images included — has actually finished, so re-scrolling to the
     hash at that point uses the page's true, final layout. If 'load'
     already fired by the time this runs (rare, but possible on a
     fast cached reload), readyState is already 'complete' and this
     runs immediately instead of waiting for an event that already
     happened. */
  function correctAnchorScrollOnceLoaded() {
    if (!window.location.hash) return;
    let target;
    try { target = document.querySelector(window.location.hash); } catch (err) { return; }
    if (target) target.scrollIntoView({ block: 'start' });
  }
  if (document.readyState === 'complete') {
    correctAnchorScrollOnceLoaded();
  } else {
    window.addEventListener('load', correctAnchorScrollOnceLoaded, { once: true });
  }

  } catch (err) {
    console.error('LM bootstrap: public frontend failed to initialize.', err);
  } finally {
    if (initialTransitionTimer !== null) window.clearTimeout(initialTransitionTimer);
    hideInitialPageTransition();
  }

});