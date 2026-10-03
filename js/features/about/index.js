import { findSoftwareLogoCandidates, findSoftwareLogoDiscoveryCandidates } from '../../infrastructure/software-logo/lookup.js?v=20261003-12';

export async function initAbout({
  url,
  root = globalThis.document,
  loadJson,
  resolveAssetUrl,
  getSiteRootUrl,
  showSoftwareLogos = false
} = {}) {
  const headline = root?.getElementById('aboutHeadline');
  if (!headline) {
    return {
      setSoftwareLogosVisible() {},
      renderSoftwareSkills() {},
      getSkills: () => [],
      cleanup() {}
    };
  }

  const softwareList = root.getElementById('softwareSkillsList');
  const multimediaList = root.getElementById('multimediaSkillsList');
  const experienceList = root.getElementById('experienceList');
  const educationList = root.getElementById('educationList');
  const awardsList = root.getElementById('awardsList');
  const subhead = root.getElementById('aboutSubhead');
  const bio = root.getElementById('aboutBio');
  const photo = root.getElementById('aboutPhoto');

  let softwareSkills = [];
  let multimediaSkills = [];

  function skillInitials(name = '') {
    const words = String(name).trim().split(/\s+/).filter(Boolean);
    if (words.length <= 1) return String(name).trim();
    return words.map(word => /\d/.test(word) || word.length <= 2
      ? word.toUpperCase()
      : word[0].toUpperCase()).join('');
  }

  function showLogoFallback(frame, name) {
    if (!frame || !frame.isConnected) return;
    frame.classList.add('is-fallback');
    frame.replaceChildren();
    frame.textContent = skillInitials(name);
  }

  function preloadAndMountLogo(frame, name, candidates, index = 0, onExhausted) {
    if (!frame || !frame.isConnected || !candidates[index]) {
      onExhausted?.();
      return;
    }

    const image = root.createElement('img');
    image.className = 'skill-logo';
    image.alt = name;
    image.title = name;

    image.addEventListener('load', () => {
      if (!frame.isConnected) return;
      frame.classList.remove('is-fallback');
      frame.replaceChildren(image);
    }, { once: true });

    image.addEventListener('error', () => {
      preloadAndMountLogo(frame, name, candidates, index + 1, onExhausted);
    }, { once: true });

    image.src = candidates[index];
  }

  async function resolveSoftwareLogo(frame, name, manualIcon = '') {
    if (!frame || !frame.isConnected || !showSoftwareLogos) return;

    const directCandidates = [];
    if (manualIcon) directCandidates.push(manualIcon);
    findSoftwareLogoCandidates(name).forEach(url => {
      if (!directCandidates.includes(url)) directCandidates.push(url);
    });

    const fallbackToDiscovery = async () => {
      const discovered = await findSoftwareLogoDiscoveryCandidates(name);
      if (!frame.isConnected || !showSoftwareLogos) return;
      preloadAndMountLogo(frame, name, discovered, 0, () => showLogoFallback(frame, name));
    };

    if (!directCandidates.length) {
      await fallbackToDiscovery();
      return;
    }

    preloadAndMountLogo(frame, name, directCandidates, 0, fallbackToDiscovery);
  }

  function renderSoftwareSkills(list = softwareSkills) {
    if (!softwareList || !Array.isArray(list)) return;
    softwareSkills = list;

    const fragment = root.createDocumentFragment();

    list.forEach(skill => {
      if (!skill) return;

      const item = root.createElement('li');
      const name = typeof skill === 'string' ? skill.trim() : String(skill.name || '').trim();
      if (!name) return;

      const icon = typeof skill === 'object'
        ? String(skill.icon || skill.logo || '').trim()
        : '';

      if (!showSoftwareLogos) {
        item.textContent = name;
        fragment.appendChild(item);
        return;
      }

      item.className = 'has-logo';
      const frame = root.createElement('span');
      frame.className = 'skill-logo-frame is-fallback';
      frame.title = name;
      frame.textContent = skillInitials(name);

      item.appendChild(frame);
      fragment.appendChild(item);

      const manualUrl = icon && typeof resolveAssetUrl === 'function'
        ? resolveAssetUrl(icon)
        : icon;

      // Resolve after the initial text layout is committed. This mirrors the
      // reference branch's manual → Simple Icons → domain/discovery order,
      // while never inserting a failed image into the visible DOM.
      Promise.resolve(resolveSoftwareLogo(frame, name, manualUrl));
    });

    softwareList.replaceChildren(fragment);
  }

  function renderMultimediaSkills(list = multimediaSkills) {
    if (!multimediaList || !Array.isArray(list)) return;
    multimediaSkills = list;

    const fragment = root.createDocumentFragment();
    list.forEach(skill => {
      const name = typeof skill === 'string' ? skill.trim() : String(skill?.name || '').trim();
      if (!name) return;
      const item = root.createElement('li');
      item.textContent = name;
      fragment.appendChild(item);
    });
    multimediaList.replaceChildren(fragment);
  }

  function buildTimelineBlock({ title = '', dateLine = '', bullets = [] } = {}) {
    const item = root.createElement('div');
    item.className = 'timeline-item clean-timeline';

    const heading = root.createElement('h4');
    heading.textContent = title;
    item.appendChild(heading);

    if (dateLine) {
      const date = root.createElement('span');
      date.className = 'timeline-date';
      date.textContent = dateLine;
      item.appendChild(date);
    }

    (Array.isArray(bullets) ? bullets : [])
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .forEach((bullet, index, values) => {
        const paragraph = root.createElement('p');
        paragraph.textContent = bullet;
        item.appendChild(paragraph);
        if (index < values.length - 1) item.appendChild(root.createElement('br'));
      });

    return item;
  }

  function renderExperience(list) {
    if (!experienceList || !Array.isArray(list) || !list.length) return;
    const fragment = root.createDocumentFragment();

    list.forEach(exp => {
      if (!exp) return;
      const dates = [exp.startDate, exp.endDate].filter(Boolean).join(' – ');
      const dateLine = [exp.company, dates].filter(Boolean).join(' · ');
      fragment.appendChild(buildTimelineBlock({
        title: exp.role,
        dateLine,
        bullets: exp.bullets
      }));
    });

    experienceList.replaceChildren(fragment);
  }

  function renderEducation(list) {
    if (!educationList || !Array.isArray(list) || !list.length) return;
    const fragment = root.createDocumentFragment();

    list.forEach(entry => {
      if (!entry) return;
      const dateLine = [entry.degree, entry.graduationDate].filter(Boolean).join(' · ') || entry.detail || '';
      fragment.appendChild(buildTimelineBlock({
        title: entry.school || entry.title,
        dateLine
      }));
    });

    educationList.replaceChildren(fragment);
  }

  function renderAwards(list) {
    if (!awardsList || !Array.isArray(list) || !list.length) return;
    const fragment = root.createDocumentFragment();

    list.forEach(entry => {
      if (!entry) return;
      fragment.appendChild(buildTimelineBlock({
        title: entry.title,
        dateLine: entry.detail || ''
      }));
    });

    awardsList.replaceChildren(fragment);
  }

  function applySoftwareLogosVisibility(show = showSoftwareLogos) {
    showSoftwareLogos = Boolean(show);
    renderSoftwareSkills(softwareSkills);
  }

  if (url && typeof loadJson === 'function') {
    try {
      const about = await loadJson(url, null, { resolveUrl: resolveAssetUrl });
      if (about && typeof about === 'object') {
        if (about.headline) headline.textContent = about.headline;
        if (subhead && about.subhead) subhead.textContent = about.subhead;
        if (bio && about.bio) bio.textContent = about.bio;

        if (photo && about.photo) {
          const photoData = typeof about.photo === 'string' ? { src: about.photo } : about.photo;
          if (photoData?.src) {
            const resolved = typeof resolveAssetUrl === 'function'
              ? resolveAssetUrl(photoData.src)
              : photoData.src;
            photo.src = resolved;
            if (photoData.focus) {
              photo.style.objectPosition = photoData.focus;
              photo.style.transformOrigin = photoData.focus;
            }
            if (photoData.zoom) photo.style.setProperty('--thumb-zoom', String(photoData.zoom));
            if (photoData.rotate) photo.style.setProperty('--thumb-rotate', String(photoData.rotate) + 'deg');
          }
        }

        softwareSkills = Array.isArray(about.softwareSkills) ? about.softwareSkills : [];
        multimediaSkills = Array.isArray(about.multimediaSkills) ? about.multimediaSkills : [];
        renderSoftwareSkills();
        renderMultimediaSkills();
        renderExperience(about.experience);
        renderEducation(about.education);
        renderAwards(about.awards);
      }
    } catch (error) {
      console.warn('About: could not load', url, error);
    }
  }

  renderSoftwareSkills();
  return {
    setSoftwareLogosVisible: applySoftwareLogosVisibility,
    renderSoftwareSkills,
    getSkills: () => softwareSkills.slice(),
    cleanup() {}
  };
}
