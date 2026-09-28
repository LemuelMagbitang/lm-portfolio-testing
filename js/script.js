document.addEventListener('DOMContentLoaded', async () => {

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
      if (remote.heroTiming.loopMode === 'latest' || remote.heroTiming.loopMode === 'manual') HERO_LOOP_MODE = remote.heroTiming.loopMode;
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
  }

  const settingsReady = window.SETTINGS_URL
    ? fetch(window.SETTINGS_URL).then(r => r.json()).then(applySettings).catch(err => console.warn('Settings: could not load', window.SETTINGS_URL, err))
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
    else el.setAttribute('data-image', m.src || '');
    if (m.caption) el.setAttribute('data-description', m.caption);
    if (m.orientation) el.setAttribute('data-orientation', m.orientation);
    return el;
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
    if (t.type) thumb.setAttribute('data-thumbnail-type', t.type);
    if (t.src) {
      const media = buildThumbnailMedia({type:t.type||heroMediaTypeFromSrc(t.src),src:t.src}, p.title || 'Project artwork');
      if (media) {
        if (t.focus) media.setAttribute('data-focus', t.focus);
        if (t.zoom && Number(t.zoom)!==1) media.setAttribute('data-zoom', t.zoom);
        if (t.rotate) media.setAttribute('data-rotate', t.rotate);
        thumb.appendChild(media);
      }
    } else {
      if (t.focus) thumb.setAttribute('data-focus', t.focus);
      if (t.zoom && Number(t.zoom)!==1) thumb.setAttribute('data-zoom', t.zoom);
    }
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
      const res = await fetch(window.PROJECTS_URL);
      if (!res.ok) return;
      const raw = await res.json();
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
  await loadProjectsFromCMS();


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
      const res = await fetch(window.REVIEWS_URL);
      if (!res.ok) return;
      const list = await res.json();
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
  await loadReviewsFromCMS();


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
    const siteRoot = new URL('../', window.location.href);
    list.forEach(s => {
      const li = document.createElement('li');
      const name = typeof s === 'string' ? s : (s && s.name) || '';
      const manualIcon = (s && typeof s === 'object') ? s.icon : '';
      const useLogo = (s && typeof s === 'object') && SHOW_SOFTWARE_LOGOS;

      if (useLogo) {
        li.classList.add('has-logo');
        const img = document.createElement('img');
        img.className = 'skill-logo';
        img.alt = name; // read by screen readers even though the text itself isn't shown
        img.title = name; // shows the name on hover, same info a text chip would give at a glance
        img.loading = 'lazy';
        li.appendChild(img);

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
          else { img.remove(); li.classList.remove('has-logo'); li.textContent = skillInitials(name); }
        };
        if (attempts.length) img.src = attempts[0];
        else { img.remove(); li.classList.remove('has-logo'); li.textContent = skillInitials(name); }
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
      const res = await fetch(window.ABOUT_URL);
      if (!res.ok) return;
      const a = await res.json();
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
        const siteRoot = new URL('../', window.location.href);
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
  await loadAboutFromCMS();


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
      const res = await fetch(window.FILTERS_URL);
      if (!res.ok) return;
      const list = await res.json();
      if (!Array.isArray(list) || !list.length) return;

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
  await loadFiltersFromCMS();


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
      fetch(window.HERO_MESSAGES_URL)
        .then(r => r.json())
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
  // the card's own first media-list item instead — an image if the
  // first item is data-image, or a YouTube thumbnail if it's
  // data-youtube. Runs once, before anything else reads the grid.
  function buildThumbnailMedia(source, altText){
    if (!source || !source.src) return null;
    let media;
    if (source.type === 'video') {
      media=document.createElement('video'); media.src=source.src; media.muted=true; media.loop=true; media.autoplay=true; media.playsInline=true; media.preload='metadata';
    } else if (source.type === 'lottie') {
      media=document.createElement('lottie-player'); media.setAttribute('src',source.src); media.setAttribute('autoplay',''); media.setAttribute('loop',''); media.setAttribute('background','transparent');
    } else {
      media=document.createElement('img'); media.src=source.src; media.alt=altText||'Project artwork';
    }
    media.classList.add('project-thumb-media');
    return media;
  }

  function projectFallbackSource(card){
    const image=card.querySelector('.project-media-list .media-item[data-image]');
    if(image) return {type:'image',src:image.getAttribute('data-image')};
    const video=card.querySelector('.project-media-list .media-item[data-video]');
    if(video) return {type:'video',src:video.getAttribute('data-video')};
    const lottie=card.querySelector('.project-media-list .media-item[data-lottie]');
    if(lottie) return {type:'lottie',src:lottie.getAttribute('data-lottie')};
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
      if(media) wrap.appendChild(media);
      if(source.type==='video') media.setAttribute('data-video-thumb','');
      if(source.type==='lottie') media.setAttribute('data-lottie-thumb','');
    });
  }
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
    });

    // Tapping anywhere outside the open menu (the dimmed backdrop, a
    // nav link, anywhere) closes it — standard mobile menu behavior.
    document.addEventListener('click', (e) => {
      if (!document.body.classList.contains('menu-open')) return;
      if (navLinks.contains(e.target) || hamburger.contains(e.target)) return;
      navLinks.classList.remove('active');
      document.body.classList.remove('menu-open');
    });

    // Clicking any link inside the menu also closes it — matters most
    // for the Works > 3D & Motion / Illustration / UI-UX links, since
    // those change the page via a hash and don't force a full reload.
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('active');
        document.body.classList.remove('menu-open');
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
     4. HERO BANNER — AUTO-FILLED WITH THE
        5 LATEST ARTWORKS + FACE-AWARE FOCUS
     ========================================= */
  // "Latest" = whichever 5 project cards are FIRST in index.html's grid.
  // To change what shows in the hero, reorder your project cards there.
  //
  // On the Works page, we read the cards straight from this same page.
  // On any other page (like About), there's no grid to read from, so we
  // fetch index.html in the background and pull the same 5 thumbnails
  // from it — meaning both pages always stay in sync automatically.
  //
  // NOTE: the fetch only works when the site is actually being served
  // (e.g. on GitHub Pages, or a local dev server). If you open about.html
  // by double-clicking the file, browsers block this for local files,
  // and the About hero will just stay empty until viewed on a real server.
  //
  // FOCUS POINT — how each slide decides where to "look":
  //   1. Manual override always wins. Add data-focus="50% 10%" to a
  //      project's thumbnail <img> in index.html and the hero (and About
  //      hero) will crop/zoom around that exact point for that artwork.
  //   2. Otherwise, if the visitor's browser supports native face
  //      detection, we quietly detect the face and center the crop and
  //      zoom on it — no library, no download, just a browser API.
  //   3. Otherwise, it falls back to the top-biased crop already set in
  //      style.css (object-position: center 18%), which is a safe default
  //      for character art and portraits.

  async function applyFocalPoint(slideImg, manualFocus) {
    if (manualFocus) {
      slideImg.style.objectPosition = manualFocus;
      slideImg.style.transformOrigin = manualFocus;
      return;
    }

    // Progressive enhancement only — most browsers don't support this
    // yet, so this silently does nothing and the CSS default (top-biased
    // crop) is what visitors see. Nothing breaks either way.
    if (!('FaceDetector' in window)) return;

    try {
      const detector = new window.FaceDetector({ maxDetectedFaces: 1, fastMode: true });
      const faces = await detector.detect(slideImg);
      if (!faces.length) return;

      const box = faces[0].boundingBox;
      const naturalW = slideImg.naturalWidth || slideImg.width;
      const naturalH = slideImg.naturalHeight || slideImg.height;
      if (!naturalW || !naturalH) return;

      const focusX = ((box.x + box.width / 2) / naturalW) * 100;
      const focusY = ((box.y + box.height / 2) / naturalH) * 100;
      const focusPoint = `${focusX.toFixed(1)}% ${focusY.toFixed(1)}%`;

      // Smoothly re-center onto the detected face rather than snapping.
      slideImg.style.transition = 'object-position 1.2s ease, transform-origin 1.2s ease, opacity 1.5s ease-in-out';
      slideImg.style.objectPosition = focusPoint;
      slideImg.style.transformOrigin = focusPoint;
    } catch (err) {
      // Detection unsupported/failed on this device — keep the default crop.
    }
  }

  // Reads the first 5 project cards out of a document and returns a plain
  // list of {src, alt, focus} for the hero to use.
  //
  // Why it reads data-image and not <img src>: in index.html most
  // .card-thumbnail divs are left EMPTY on purpose, and script.js fills
  // them in at runtime from each card's own first media-item. That works
  // fine on the Works page (the script has already run by then), but a
  // document pulled in with fetch() is raw HTML that never executed any
  // JavaScript — so its thumbnails are still empty divs and looking for
  // an <img> inside them finds nothing. Reading the same data-image
  // attribute the runtime filler reads makes both paths agree.
  //
  // baseUrl matters for the same reason: paths in index.html like
  // "assets/projects/..." are relative to the site root, so when the
  // About page (at /about/) reuses them they must be resolved against
  // the root rather than against /about/, or every slide 404s.
  function collectHeroSources(doc, baseUrl) {
    const cards = doc.querySelectorAll('.project-card');
    return Array.from(cards).map(card => {
      const thumbWrap = card.querySelector('.card-thumbnail');
      const thumbImg = thumbWrap ? thumbWrap.querySelector('img') : null;

      // Same order of preference as fillMissingThumbnails(): a real
      // <img src> if one was written by hand, else the card's first
      // data-image, else its first YouTube thumbnail.
      let rawSrc = thumbImg ? thumbImg.getAttribute('src') : null;
      let explicitType = thumbWrap ? thumbWrap.getAttribute('data-thumbnail-type') : null;
      const thumbMedia = thumbWrap ? thumbWrap.querySelector('.project-thumb-media') : null;
      if (!rawSrc && thumbMedia) {
        rawSrc = thumbMedia.getAttribute('src');
        explicitType = explicitType || (thumbMedia.tagName === 'VIDEO' ? 'video' : thumbMedia.tagName === 'LOTTIE-PLAYER' ? 'lottie' : 'image');
      }
      if (!rawSrc) {
        const firstImageItem = card.querySelector('.project-media-list .media-item[data-image]');
        const firstVideoItem = card.querySelector('.project-media-list .media-item[data-video]');
        const firstLottieItem = card.querySelector('.project-media-list .media-item[data-lottie]');
        if (firstImageItem) rawSrc = firstImageItem.getAttribute('data-image');
        else if (firstVideoItem) rawSrc = firstVideoItem.getAttribute('data-video');
        else if (firstLottieItem) rawSrc = firstLottieItem.getAttribute('data-lottie');
        else {
          const firstYouTubeItem = card.querySelector('.project-media-list .media-item[data-youtube]');
          if (firstYouTubeItem) { const { id } = parseYouTubeUrl(firstYouTubeItem.getAttribute('data-youtube')); if (id) rawSrc = `https://img.youtube.com/vi/${id}/hqdefault.jpg`; }
        }
      }

      if (!rawSrc) return null; // this card has no usable artwork

      let src = rawSrc;
      if (baseUrl) {
        try { src = new URL(rawSrc, baseUrl).href; } catch (e) { /* keep raw */ }
      }

      const titleEl = card.querySelector('.glass-info h3');

      return {
        type: explicitType || heroMediaTypeFromSrc(rawSrc),
        src,
        alt: (thumbImg && thumbImg.getAttribute('alt')) || (titleEl ? titleEl.textContent : 'Featured artwork'),
        focus: (thumbImg && thumbImg.getAttribute('data-focus')) || (thumbWrap && thumbWrap.getAttribute('data-focus')) || null,
        zoom: (thumbImg && thumbImg.getAttribute('data-zoom')) || null,
        rotate: (thumbImg && thumbImg.getAttribute('data-rotate')) || null
      };
    }).filter(Boolean);
  }

  // Guesses a hero slide's media type from its file extension — used
  // wherever the source doesn't already carry an explicit type field
  // (the DOM-scraping path above has no such attribute to read).
  // data/hero-loop.json and data/projects.json entries carry their own
  // real `type`, read directly instead of guessed, in the two
  // functions below.
  function heroMediaTypeFromSrc(src) {
    const clean = (src || '').split('?')[0].split('#')[0].toLowerCase();
    if (/\.(mp4|webm|mov|m4v)$/.test(clean)) return 'video';
    if (/\.json$/.test(clean)) return 'lottie';
    return 'image';
  }

  // The data/projects.json equivalent of collectHeroSources's per-card
  // mapping above — same order of preference (explicit thumbnail, then
  // first media item, then first YouTube item's thumbnail), just
  // reading JSON fields instead of DOM attributes since there's no
  // rendered markup to read them from here.
  function heroSourceFromProjectData(p, baseUrl) {
    if (!p) return null;
    const thumb = p.thumbnail || {};
    let rawSrc = thumb.src || null;
    let type = rawSrc ? (thumb.type || heroMediaTypeFromSrc(rawSrc)) : null;

    if (!rawSrc && Array.isArray(p.media)) {
      const firstUsable = p.media.find(m => m && m.src && (m.type === 'image' || m.type === 'video' || m.type === 'lottie'));
      if (firstUsable) {
        rawSrc = firstUsable.src;
        type = firstUsable.type;
      } else {
        const firstYouTube = p.media.find(m => m && m.type === 'youtube' && m.src);
        if (firstYouTube) {
          const { id } = parseYouTubeUrl(firstYouTube.src);
          if (id) { rawSrc = `https://img.youtube.com/vi/${id}/hqdefault.jpg`; type = 'image'; }
        }
      }
    }

    if (!rawSrc) return null;

    let src = rawSrc;
    if (baseUrl) {
      try { src = new URL(rawSrc, baseUrl).href; } catch (e) { /* keep raw */ }
    }

    return { type: type || 'image', src, alt: p.title || 'Featured artwork', focus: thumb.focus || null, zoom: thumb.zoom || null, rotate: thumb.rotate || null };
  }

  // Same shape again, this time for a hand-curated entry in
  // data/hero-loop.json — used only in 'manual' loop mode. Every field
  // already exists on the entry itself; this just resolves its path
  // against the site root, same as every other data-driven path here.
  function heroSourceFromManualEntry(item, baseUrl) {
    if (!item || !item.src) return null;
    let src = item.src;
    try { src = new URL(item.src, baseUrl).href; } catch (e) { /* keep raw */ }
    return {
      type: item.type || heroMediaTypeFromSrc(item.src),
      src,
      alt: item.alt || 'Featured artwork',
      focus: item.focus || null,
      zoom: item.zoom || null,
      rotate: item.rotate || null
    };
  }

  async function initHeroBanner() {
    const heroContainer = document.getElementById('heroBanner') || document.getElementById('heroBannerAbout');
    if (!heroContainer) return; // this page has no hero banner at all

    const siteRootUrl = new URL('/', window.location.href).href;
    let sources = [];

    if (HERO_LOOP_MODE === 'manual') {
      // Hand-curated list from the "Hero Loop Animation" screen in the
      // CMS — used exactly as given, however many entries that is (1
      // in, 1 loops; 3 in, 3 loop), never padded or trimmed to 5.
      try {
        const url = new URL('data/hero-loop.json', siteRootUrl).href;
        const res = await fetch(url);
        const list = await res.json();
        sources = (Array.isArray(list) ? list : [])
          .map(item => heroSourceFromManualEntry(item, siteRootUrl))
          .filter(Boolean);
      } catch (err) {
        console.warn('Hero banner: could not load data/hero-loop.json.', err);
      }
    } else {
      // 'latest' — auto-pulls from the site's own projects, same as
      // this always worked: read straight off the page's own rendered
      // cards where they already exist (the homepage), else go to
      // data/projects.json directly (the About page, which has no
      // project cards of its own to read from).
      sources = collectHeroSources(document, null);
      if (sources.length === 0) {
        try {
          const projectsUrl = new URL('data/projects.json', siteRootUrl).href;
          const response = await fetch(projectsUrl);
          const list = await response.json();
          sources = (Array.isArray(list) ? list : [])
            .map(p => heroSourceFromProjectData(p, siteRootUrl))
            .filter(Boolean);
        } catch (err) {
          console.warn('Hero banner: could not load artwork from data/projects.json.', err);
          return;
        }
      }
      sources = sources.slice(0, 5); // 'latest' mode's own cap, unrelated to manual mode's dynamic count
    }

    if (sources.length === 0) return;

    heroContainer.classList.remove('transition-kenburns', 'transition-fade', 'transition-none');
    heroContainer.classList.add('transition-' + HERO_TRANSITION);

    sources.forEach((source, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'slide' + (i === 0 ? ' active' : '');

      let media;
      if (source.type === 'video') {
        media = document.createElement('video');
        media.src = source.src;
        media.autoplay = true; media.muted = true; media.loop = true; media.playsInline = true;
      } else if (source.type === 'lottie') {
        // <lottie-player> is a custom element from the lottie-player
        // library (loaded in this page's <head>) — it takes a JSON
        // animation file the same way an <img> takes a picture file.
        media = document.createElement('lottie-player');
        media.setAttribute('src', source.src);
        media.setAttribute('autoplay', '');
        media.setAttribute('loop', '');
        media.setAttribute('background', 'transparent');
      } else {
        media = document.createElement('img');
        media.src = source.src;
        media.alt = source.alt;
      }
      wrap.appendChild(media);
      heroContainer.appendChild(wrap);

      if (source.focus) { media.style.objectPosition = source.focus; media.style.transformOrigin = source.focus; }
      media.style.setProperty('--hero-zoom', source.zoom || 1);
      media.style.setProperty('--hero-rotate', (source.rotate || 0) + 'deg');

      // Auto face-detection fallback only ever made sense for still
      // images with no focus point already set by hand — video and
      // Lottie slides skip it entirely, and an image with an explicit
      // focus already has what it needs.
      if (source.type === 'image' && !source.focus) {
        if (media.complete) applyFocalPoint(media, null);
        else media.addEventListener('load', () => applyFocalPoint(media, null), { once: true });
      }
    });

    startHeroCrossfade(heroContainer);
  }

  function startHeroCrossfade(heroContainer) {
    const slides = heroContainer.querySelectorAll('.slide');
    if (slides.length <= 1) return;

    let currentSlide = 0;
    setInterval(() => {
      slides[currentSlide].classList.remove('active');
      currentSlide = (currentSlide + 1) % slides.length;
      slides[currentSlide].classList.add('active');
    }, HERO_CROSSFADE_MS); // configured in Hero Loop Animation
  }

  await settingsReady;
  initHeroBanner();


  /* =========================================
     5. FILTERING & SHOW MORE/LESS (with the
        blurred "peek" effect)
     ========================================= */
  const filterBtns = document.querySelectorAll('.tab-btn');
  const allCards = Array.from(document.querySelectorAll('.project-card'));
  const showMoreBtn = document.getElementById('showMoreBtn');
  const showMoreWrapper = document.getElementById('showMoreWrapper');
  const portfolioGrid = document.getElementById('portfolioGrid');
  const gridFadeOverlay = document.getElementById('gridFadeOverlay');

  let currentFilter = 'all';
  let isExpanded = false;

  // How many cards to reveal before "Show More" kicks in.
  // 5 on mobile, 9 on desktop/wide screens — change these two numbers
  // if you ever want different amounts.
  function getBaseCount() {
    return window.innerWidth < 768 ? 5 : 9;
  }
  let baseCount = getBaseCount();

  // Measures exactly how tall the grid needs to be to show `limit` cards
  // in full, plus a small "peek" of the next row so people can tell
  // there's more underneath the fade.
  function computeCollapsedHeight(filteredCards, limit) {
    if (filteredCards.length <= limit) return null; // everything already fits

    const gridRect = portfolioGrid.getBoundingClientRect();
    const lastVisibleCard = filteredCards[limit - 1];
    const cardRect = lastVisibleCard.getBoundingClientRect();
    const peekAmount = window.innerWidth < 768 ? 40 : 70;

    return Math.round((cardRect.bottom - gridRect.top) + peekAmount);
  }

  function renderGallery() {
    if (allCards.length === 0) return;

    const filteredCards = allCards.filter(card =>
      currentFilter === 'all' || card.classList.contains(currentFilter)
    );
    const nonMatchingCards = allCards.filter(card => !filteredCards.includes(card));

    // Cards leaving the filter fade out first, then actually leave the
    // grid once that fade finishes — a soft cut instead of an instant
    // snap. (Opacity only, never a transform: that keeps every card's
    // real layout box exact while it's mid-fade, which the "peek"
    // height math just below depends on.)
    nonMatchingCards.forEach(card => { card.style.opacity = '0'; });
    setTimeout(() => {
      nonMatchingCards.forEach(card => {
        // Guards against rapid tab-clicking: only actually hide it if
        // it's still meant to be hidden by now.
        const stillHidden = currentFilter !== 'all' && !card.classList.contains(currentFilter);
        if (stillHidden) card.style.display = 'none';
      });
    }, 300);

    // Cards entering the filter need to actually be laid out before
    // their opacity can transition (an element can't fade in from
    // display:none — there's nothing to animate from), so lay them out
    // this frame and fade them in on the next.
    filteredCards.forEach(card => { card.style.display = 'block'; });
    requestAnimationFrame(() => {
      filteredCards.forEach(card => { card.style.opacity = '1'; });
    });

    const needsCollapsing = !isExpanded && filteredCards.length > baseCount;

    if (needsCollapsing) {
      const collapsedHeight = computeCollapsedHeight(filteredCards, baseCount);
      portfolioGrid.style.maxHeight = collapsedHeight + 'px';
      if (gridFadeOverlay) gridFadeOverlay.classList.remove('is-hidden');
    } else {
      portfolioGrid.style.maxHeight = 'none';
      if (gridFadeOverlay) gridFadeOverlay.classList.add('is-hidden');
    }

    // Show More / Show Less button + label. The wrapper switches between
    // "floating over the grid" and "sitting in normal flow" via the
    // .expanded class already defined in style.css — this is the other
    // half of what keeps it from drifting underneath cards on mobile.
    if (showMoreBtn && showMoreWrapper) {
      const btnText = showMoreBtn.querySelector('.btn-text');

      if (filteredCards.length > baseCount) {
        showMoreWrapper.style.display = 'flex';
        showMoreWrapper.classList.toggle('expanded', isExpanded);
        showMoreBtn.classList.toggle('expanded', isExpanded);
        if (btnText) btnText.textContent = isExpanded ? 'SHOW LESS' : 'SHOW MORE';
      } else {
        showMoreWrapper.style.display = 'none';
      }
    }
  }

  // Handle Filter Clicks
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      currentFilter = btn.getAttribute('data-filter');
      isExpanded = false; // start collapsed again on category change
      renderGallery();

      // Keep the address bar in sync with whichever tab is active, so
      // copying the URL after clicking a tab always gives the right
      // shareable link — no need to go through the Works dropdown.
      // replaceState (not pushState) so tab-clicking doesn't spam
      // "back" history with every filter change.
      const newHash = currentFilter === 'all' ? '' : '#' + currentFilter;
      history.replaceState(null, '', window.location.pathname + window.location.search + newHash);
    });
  });

  // Handle Show More / Show Less Click
  if (showMoreBtn) {
    showMoreBtn.addEventListener('click', () => {
      isExpanded = !isExpanded;
      renderGallery();

      if (!isExpanded) {
        const filterTabs = document.querySelector('.filter-tabs');
        if (filterTabs) filterTabs.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  // Recalculate on resize — this is what makes the reveal count
  // smoothly shift between 5 (mobile) and 9 (desktop), and keeps the
  // "peek" cutoff accurate as columns reflow at any width. It only
  // touches anything if Show More hasn't been clicked yet.
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      baseCount = getBaseCount();
      if (!isExpanded) renderGallery();
    }, 120);
  });

  // Initial gallery render — measured again once everything (fonts,
  // thumbnails) has actually finished loading. This is what fixes the
  // "Show More sits underneath a card" bug: the very first render can
  // measure card positions a moment before web fonts/images settle into
  // their final size, especially on a slower mobile connection. Re-running
  // it after window 'load' guarantees the measurement matches what the
  // visitor actually sees.
  renderGallery();
  window.addEventListener('load', () => {
    baseCount = getBaseCount();
    if (!isExpanded) renderGallery();
  });

  // DEEP-LINKING VIA URL HASH — lets the Works dropdown (and anyone you
  // send a link like index.html#3d-motion) jump straight to a specific
  // tab instead of landing on "All" and having to click it manually.
  // The hash value must match a tab's data-filter exactly.
  function applyFilterFromHash() {
    const hash = decodeURIComponent(window.location.hash.replace('#', ''));
    const matchingBtn = Array.from(filterBtns).find(b => b.getAttribute('data-filter') === hash);
    if (!matchingBtn) return; // not a tab hash (e.g. "#contact-section") — ignore

    filterBtns.forEach(b => b.classList.remove('active'));
    matchingBtn.classList.add('active');
    currentFilter = hash;
    isExpanded = false;
    renderGallery();

    // Scroll to the tabs once layout has settled, so the visitor lands
    // right on the filtered grid instead of the very top of the hero.
    window.requestAnimationFrame(() => {
      const filterTabsEl = document.querySelector('.filter-tabs');
      if (filterTabsEl) filterTabsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  applyFilterFromHash();
  // Same-page hash changes (clicking another Works sub-link while
  // already on index.html) don't reload the page, only fire this event.
  window.addEventListener('hashchange', applyFilterFromHash);


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
  let pristineTopCards = null;
  let pristineBottomCards = null;

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
     7. LIGHTBOX MODAL
     ========================================= */
  const lightbox = document.getElementById('lightbox');
  const lightboxControls = document.getElementById('lightboxControls');
  const lightboxClose = document.getElementById('lightboxClose');
  const lightboxPrev = document.querySelector('.lightbox-prev');
  const lightboxNext = document.querySelector('.lightbox-next');
  const modalTitle = document.getElementById('modalTitle');
  const modalDesc = document.getElementById('modalDesc');
  const modalFullDesc = document.getElementById('modalFullDesc');
  const modalMediaContainer = document.getElementById('lightboxMediaContainer');

  let currentLightboxIndex = 0;
  let activeLightboxCards = []; // Only navigate through currently filtered items

  // Reads a YouTube URL and returns the video ID plus whether it's a Short.
  // Supports: /shorts/ID, youtu.be/ID, watch?v=ID, and /embed/ID links.
  function parseYouTubeUrl(url) {
    let id = null;
    let isShort = false;

    if (url.includes('/shorts/')) {
      id = url.split('/shorts/')[1].split(/[?&]/)[0];
      isShort = true;
    } else if (url.includes('youtu.be/')) {
      id = url.split('youtu.be/')[1].split(/[?&]/)[0];
    } else if (url.includes('watch?v=')) {
      id = url.split('watch?v=')[1].split('&')[0];
    } else if (url.includes('/embed/')) {
      id = url.split('/embed/')[1].split(/[?&]/)[0];
    }

    return { id, isShort };
  }

  // Builds one artwork image with save-protection applied only when
  // switched on at the top of this file (right-click + drag disabled,
  // so there's no "Save Image As" path — no watermark, no zoom, just a
  // clean image that can't be casually saved).
  function buildImageMedia(imgUrl) {
    const img = document.createElement('img');
    img.src = imgUrl;
    img.draggable = false;

    if (PROTECTION_ENABLED) {
      img.classList.add('no-save');
      // Worth being upfront: no front-end trick can block a screenshot
      // outright. This blocks the right-click "Save Image As" menu and
      // drag-to-save, which covers casual reuse — a determined person
      // with a screenshot tool can't be stopped client-side.
      img.addEventListener('contextmenu', (e) => e.preventDefault());
      img.addEventListener('dragstart', (e) => e.preventDefault());
    }

    return img;
  }

  // Builds a small caption under a media item — but only if there's
  // actual text. Add one by putting data-description="..." on that
  // <div class="media-item">; leave it off (or empty) and nothing
  // renders, no empty box.
  function buildMediaCaption(text) {
    if (!text || !text.trim()) return null;
    const p = document.createElement('p');
    p.className = 'media-caption';
    p.textContent = text.trim();
    return p;
  }

  // Wraps one media element (image or video iframe) together with its
  // optional caption so they stay grouped as a single unit.
  function buildMediaEntry(mediaEl, captionText) {
    const wrap = document.createElement('div');
    wrap.className = 'lightbox-media-item';
    wrap.appendChild(mediaEl);

    const caption = buildMediaCaption(captionText);
    if (caption) wrap.appendChild(caption);

    return wrap;
  }

  function openLightbox(index) {
    currentLightboxIndex = index;
    const card = activeLightboxCards[currentLightboxIndex];

    // 1. Populate Text
    modalTitle.textContent = card.querySelector('.glass-info h3').textContent;
    modalDesc.textContent = card.querySelector('.glass-info p').textContent;

    const descEl = card.querySelector('.project-description');
    modalFullDesc.innerHTML = descEl ? descEl.innerHTML : '';

    // 2. Clear previous media to stop playing videos (and reset any zoom)
    modalMediaContainer.innerHTML = '';

    // 3. Populate Media (Images & YouTube)
    const mediaList = card.querySelectorAll('.project-media-list .media-item');

    if (mediaList.length > 0) {
      mediaList.forEach(item => {
        const imgUrl = item.getAttribute('data-image');
        const ytUrl = item.getAttribute('data-youtube');
        const videoUrl = item.getAttribute('data-video');
        const lottieUrl = item.getAttribute('data-lottie');
        const caption = item.getAttribute('data-description');

        if (imgUrl) {
          modalMediaContainer.appendChild(buildMediaEntry(buildImageMedia(imgUrl), caption));
        }

        if (ytUrl) {
          const { id, isShort } = parseYouTubeUrl(ytUrl);
          const embedUrl = id ? `https://www.youtube.com/embed/${id}` : ytUrl;

          const iframe = document.createElement('iframe');
          iframe.src = embedUrl;
          iframe.frameBorder = '0';
          iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
          iframe.allowFullscreen = true;

          // Orientation: a manual "data-orientation" attribute always wins.
          // Otherwise, Shorts links default to portrait and everything
          // else defaults to landscape.
          const manualOrientation = item.getAttribute('data-orientation');
          let orientationClass = 'yt-landscape';

          if (manualOrientation === 'portrait') {
            orientationClass = 'yt-portrait';
          } else if (manualOrientation === 'square') {
            orientationClass = 'yt-square';
          } else if (manualOrientation === 'landscape') {
            orientationClass = 'yt-landscape';
          } else if (isShort) {
            orientationClass = 'yt-portrait';
          }

          iframe.classList.add(orientationClass);
          modalMediaContainer.appendChild(buildMediaEntry(iframe, caption));
        }

        if (videoUrl) {
          const video = document.createElement('video');
          video.src = videoUrl;
          video.controls = true;
          video.playsInline = true;
          video.controlsList = 'nodownload';
          video.disablePictureInPicture = true;

          if (PROTECTION_ENABLED) {
            video.classList.add('no-save');
            video.addEventListener('contextmenu', (e) => e.preventDefault());
          }

          const manualVideoOrientation = item.getAttribute('data-orientation');

          if (manualVideoOrientation === 'portrait') {
            video.classList.add('yt-portrait');
          } else if (manualVideoOrientation === 'square') {
            video.classList.add('yt-square');
          } else if (manualVideoOrientation === 'landscape') {
            video.classList.add('yt-landscape');
          } else {
            // No manual override — start with a landscape placeholder
            // (avoids a layout jump before the file loads), then read
            // the video's own real width/height as soon as we know
            // them and size it exactly to that, same spirit as how
            // YouTube Shorts links get auto-detected as portrait.
            video.classList.add('yt-landscape');

            video.addEventListener('loadedmetadata', () => {
              const ratio = video.videoWidth / video.videoHeight;

              video.classList.remove('yt-landscape', 'yt-portrait', 'yt-square');
              if (ratio > 1.15) {
                video.classList.add('yt-landscape');
              } else if (ratio < 0.85) {
                video.classList.add('yt-portrait');
              } else {
                video.classList.add('yt-square');
              }

              // Exact proportions rather than a fixed 16:9 / 9:16 / 1:1
              // template — the class above just sets a sensible max-size
              // envelope for that general shape.
              video.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
            });
          }

          modalMediaContainer.appendChild(buildMediaEntry(video, caption));
        }

        if (lottieUrl) {
          // <lottie-player> plays a Lottie/JSON animation the same way
          // <video> plays a video file — same orientation handling as
          // video above (manual override, else a landscape default),
          // since there's no equivalent of videoWidth/videoHeight to
          // read the real proportions from up front.
          const player = document.createElement('lottie-player');
          player.setAttribute('src', lottieUrl);
          player.setAttribute('autoplay', '');
          player.setAttribute('loop', '');
          player.setAttribute('background', 'transparent');

          const manualLottieOrientation = item.getAttribute('data-orientation');
          if (manualLottieOrientation === 'portrait') player.classList.add('yt-portrait');
          else if (manualLottieOrientation === 'square') player.classList.add('yt-square');
          else player.classList.add('yt-landscape');

          modalMediaContainer.appendChild(buildMediaEntry(player, caption));
        }
      });
    } else {
      // Fallback: If no media list exists, just use the thumbnail
      const fallbackSrc = card.querySelector('.card-thumbnail img').src;
      modalMediaContainer.appendChild(buildImageMedia(fallbackSrc));
    }

    // 4. Show Lightbox and lock body scroll
    lightbox.classList.add('active');
    if (lightboxControls) lightboxControls.classList.add('active');
    lightbox.scrollTop = 0;
    document.body.style.overflow = 'hidden';
  }

  // Attach click events to all cards
  allCards.forEach(card => {
    card.addEventListener('click', () => {
      activeLightboxCards = allCards.filter(c =>
        currentFilter === 'all' || c.classList.contains(currentFilter)
      );
      const index = activeLightboxCards.indexOf(card);
      openLightbox(index);
    });
  });

  // Close Lightbox function
  function closeLightbox() {
    lightbox.classList.remove('active');
    if (lightboxControls) lightboxControls.classList.remove('active');
    document.body.style.overflow = ''; // Restore body scroll
    modalMediaContainer.innerHTML = ''; // Destroys iframes to stop audio playing in background
  }

  // Event Listeners for Lightbox Controls
  if (lightboxClose) {
    lightboxClose.addEventListener('click', closeLightbox);
  }

  if (lightboxPrev) {
    lightboxPrev.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentLightboxIndex > 0) {
        openLightbox(currentLightboxIndex - 1);
      } else {
        openLightbox(activeLightboxCards.length - 1); // Loop to end
      }
    });
  }

  if (lightboxNext) {
    lightboxNext.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentLightboxIndex < activeLightboxCards.length - 1) {
        openLightbox(currentLightboxIndex + 1);
      } else {
        openLightbox(0); // Loop to start
      }
    });
  }

  // Close when clicking the dark background outside the modal interior
  if (lightbox) {
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) {
        closeLightbox();
      }
    });
  }

  // Close on 'Esc' key
  document.addEventListener('keydown', (e) => {
    if (lightbox && e.key === 'Escape' && lightbox.classList.contains('active')) {
      closeLightbox();
    }
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
  const pageTransition = document.getElementById('pageTransition');

  if (pageTransition) {
    // Entrance: fade the logo in, hold briefly, then fade the whole
    // overlay away to reveal the page. Runs on every load.
    requestAnimationFrame(() => {
      pageTransition.classList.add('is-entering');
    });
    setTimeout(() => {
      pageTransition.classList.add('is-hidden');
    }, 550);

    // If the browser restores this page from its back/forward cache,
    // the DOM can come back in whatever state it was in right as we
    // navigated away — make sure that's never a dark screen stuck mid-
    // transition.
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) pageTransition.classList.add('is-hidden');
    });

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

});