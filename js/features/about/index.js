/**
 * About feature.
 * Owns CMS-backed biography and software-skill presentation.
 */

export async function initAbout({
  url,
  root = globalThis.document,
  loadJson,
  resolveAssetUrl,
  showSoftwareLogos = false
} = {}) {
  const section = root?.querySelector('.about-section');
  const skillsList = root?.querySelector('.software-skills');
  let skills = [];

  function applySoftwareLogosVisibility(show = showSoftwareLogos) {
    showSoftwareLogos = Boolean(show);
    root?.querySelectorAll('.software-skill').forEach(skill => {
      const logo = skill.querySelector('.software-logo');
      const name = skill.querySelector('.software-name');
      if (logo) logo.style.display = showSoftwareLogos ? '' : 'none';
      if (name) name.style.display = showSoftwareLogos ? 'none' : '';
    });
  }

  function renderSoftwareSkills(nextSkills = skills) {
    if (!skillsList || !Array.isArray(nextSkills)) return;
    skills = nextSkills;

    const fragment = root.createDocumentFragment();
    skills.forEach(skill => {
      if (!skill) return;

      const item = root.createElement('div');
      item.className = 'software-skill';

      const logo = root.createElement('img');
      logo.className = 'software-logo';
      if (skill.logo && typeof resolveAssetUrl === 'function') logo.src = resolveAssetUrl(skill.logo);
      logo.alt = skill.name || '';

      const name = root.createElement('span');
      name.className = 'software-name';
      name.textContent = skill.name || '';

      item.append(logo, name);
      fragment.appendChild(item);
    });

    skillsList.replaceChildren(fragment);
    applySoftwareLogosVisibility(showSoftwareLogos);
  }

  if (url && section && typeof loadJson === 'function') {
    try {
      const raw = await loadJson(url, null, { resolveUrl: resolveAssetUrl });
      if (raw && typeof raw === 'object') {
        const title = section.querySelector('.about-title');
        const body = section.querySelector('.about-body');
        if (title && raw.title) title.textContent = raw.title;
        if (body && raw.body) body.textContent = raw.body;
        if (Array.isArray(raw.skills)) renderSoftwareSkills(raw.skills);
      }
    } catch (error) {
      console.warn('About: could not load', url, error);
    }
  }

  applySoftwareLogosVisibility(showSoftwareLogos);

  return {
    setSoftwareLogosVisible: applySoftwareLogosVisibility,
    renderSoftwareSkills,
    getSkills: () => skills.slice(),
    cleanup() {}
  };
}
