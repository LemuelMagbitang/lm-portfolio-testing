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
  const [{ loadCmsJson, parseYouTubeUrl }, { initGallery }, { initHeroBannerV2 }, { initLightbox }, { mountProjects }] = await Promise.all([
    import(new URL('cms-data.js?v=20261001-03', runtimeUrl).href),
    import(new URL('gallery.js?v=20261001-03', runtimeUrl).href),
    import(new URL('hero.js?v=20261001-03', runtimeUrl).href),
    import(new URL('lightbox.js?v=20261001-03', runtimeUrl).href),
    import(new URL('features/projects/index.js?v=20261001-03', runtimeUrl).href)
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
  /* Projects now mount through the feature runtime. The runtime preserves the
     existing fallback contract: failed/empty CMS data leaves the static cards
     untouched. It must finish before filters, hero, gallery, and lightbox
     capture the project grid. */

  const projectsReady = mountProjects({ url: window.PROJECTS_URL });

  const cmsReady = Promise.all([
    projectsReady,
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
    for (let i = 0; i < 5; i++) {
      const s = document.createElement('span');
      s.className = i < filled ? 'star filled' : 'star';
      s.textContent = '★';
      stars.appendChild(s);
    }

    const quote = document.createElement('p');
    quote.className = 'review-quote';
    quote.textContent = r.quote || '';
    const person = document.createElement('div');
    person.className = 'review-person';
    const name = document.createElement('strong');
    name.textContent = r.name || '';
    const role = document.createElement('span');
    role.textContent = r.role || '';
    person.append(name, role);
    card.append(stars, quote, person);
    return card;
  }

  async function loadReviewsFromCMS() {
    if (!window.REVIEWS_URL) return;
    if (!reviewsTrack) return;
    try {
      const raw = await loadCmsJson(window.REVIEWS_URL, null, { resolveUrl: siteAssetUrl });
      const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.reviews) ? raw.reviews : []);
      if (!list.length) return;
      const frag = document.createDocumentFragment();
      list.forEach(r => frag.appendChild(buildReviewCardEl(r)));
      reviewsTrack.innerHTML = '';
      reviewsTrack.appendChild(frag);
    } catch (err) {
      console.warn('Reviews: could not load', window.REVIEWS_URL, err);
    }
  }


  /* =========================================
     0d. CMS OVERRIDE — ABOUT
     ========================================= */
  /* If window.ABOUT_URL points at data/about.json, fetch it and fill the
     about page's existing fields. If it fails, the static HTML is left
     exactly as-is. */

  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el || value === undefined || value === null) return;
    el.textContent = String(value);
  }

  function buildTimelineBlock({ title, dateLine, bullets }) {
    const wrap = document.createElement('div');
    wrap.className = 'timeline-block';
    if (title) {
      const h = document.createElement('h3');
      h.textContent = title;
      wrap.appendChild(h);
    }
    if (dateLine) {
      const d = document.createElement('p');
      d.className = 'timeline-date';
      d.textContent = dateLine;
      wrap.appendChild(d);
    }
    if (Array.isArray(bullets) && bullets.length) {
      const ul = document.createElement('ul');
      bullets.forEach(b => {
        const li = document.createElement('li');
        li.textContent = b;
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
    }
    return wrap;
  }

  async function loadAboutFromCMS() {
    if (!window.ABOUT_URL) return;
    try {
      const raw = await loadCmsJson(window.ABOUT_URL, null, { resolveUrl: siteAssetUrl });
      if (!raw || typeof raw !== 'object') return;
      const a = raw.about && typeof raw.about === 'object' ? raw.about : raw;

      setText('aboutName', a.name);
      setText('aboutRole', a.role);
      setText('aboutBio', a.bio);
      setText('aboutLocation', a.location);
      setText('aboutEmail', a.email);

      if (a.photo?.src) {
        const photoEl = document.getElementById('aboutPhoto');
        if (photoEl) {
          const siteRoot = getSiteRootUrl();
          photoEl.src = new URL(a.photo.src, siteRoot).href;
          if (a.photo.alt) photoEl.alt = a.photo.alt;
          if (a.photo.focus) { photoEl.style.objectPosition = a.photo.focus; photoEl.style.transformOrigin = a.photo.focus; }
          if (a.photo.zoom) photoEl.style.setProperty('--thumb-zoom', a.photo.zoom);
          if (a.photo.rotate) photoEl.style.setProperty('--thumb-rotate', a.photo.rotate + 'deg');
        }
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
        a.awList.forEach(aw => {
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
      if (raw === null || raw === undefined) return;
      const list = Array.isArray(raw)
        ? raw
        : (Array.isArray(raw?.filters) ? raw.filters : null);
      // A valid empty CMS list is still meaningful: it means ALL is the
      // only filter. Do not fall back to the hardcoded HTML filters just
      // because the CMS currently has zero custom filters.
      if (!Array.isArray(list)) return;

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
  ...
