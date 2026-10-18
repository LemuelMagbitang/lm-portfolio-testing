/**
 * Optional navigation and selection feedback, dynamically loaded only when
 * enabled in CMS Settings. Sound is requested only after a trusted click.
 */
const PREFERENCE_KEY = 'lm-interaction-feedback-muted-v1';
const NAVIGATION_TARGETS = '.nav-logo, .nav-links a[href]';
const SELECTION_TARGETS = '.filter-tabs .tab-btn, .filter-tabs .filter-btn, .contact-mobile-tab';

function clampVolume(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(0.3, number)) : 0.12;
}
function readMuted(windowRef) {
  try { return windowRef?.localStorage?.getItem(PREFERENCE_KEY) === 'off'; } catch (_) { return false; }
}
function writeMuted(windowRef, muted) {
  try { windowRef?.localStorage?.setItem(PREFERENCE_KEY, muted ? 'off' : 'on'); } catch (_) {}
}

export function initInteractionFeedback({ root = globalThis.document, settings = {}, resolveAssetUrl } = {}) {
  const enabled = settings?.enabled === true;
  const soundEnabled = settings?.soundEnabled !== false;
  const hapticsEnabled = settings?.hapticsEnabled === true;
  const volume = clampVolume(settings?.volume);
  const sources = {
    navigation: String(settings?.navigationSound || '').trim(),
    selection: String(settings?.selectionSound || '').trim()
  };
  const windowRef = root?.defaultView || globalThis.window;
  if (!enabled || (!soundEnabled && !hapticsEnabled) || !root?.addEventListener) return { destroy() {} };

  let muted = readMuted(windowRef);
  let destroyed = false;
  let preferenceButton = null;
  const audioByCue = new Map();

  function renderPreferenceButton() {
    if (!preferenceButton) return;
    preferenceButton.textContent = muted ? 'Interface feedback: Off' : 'Interface feedback: On';
    preferenceButton.setAttribute('aria-pressed', String(!muted));
    preferenceButton.setAttribute('aria-label', muted
      ? 'Enable optional interface sound and haptic feedback'
      : 'Disable optional interface sound and haptic feedback');
  }
  function togglePreference() {
    muted = !muted;
    writeMuted(windowRef, muted);
    renderPreferenceButton();
    if (muted) audioByCue.forEach(audio => {
      try { audio.pause(); audio.currentTime = 0; } catch (_) {}
    });
  }
  function createPreferenceButton() {
    const footer = root.querySelector('footer .footer-content');
    if (!footer) return;
    const doc = root.ownerDocument || root;
    preferenceButton = doc.createElement('button');
    preferenceButton.type = 'button';
    preferenceButton.className = 'interaction-feedback-toggle';
    preferenceButton.addEventListener('click', togglePreference);
    const socials = footer.querySelector('.social-icons');
    if (socials) socials.insertAdjacentElement('afterend', preferenceButton);
    else footer.appendChild(preferenceButton);
    renderPreferenceButton();
  }
  function getAudio(cue) {
    const path = sources[cue];
    if (!path || typeof windowRef?.Audio !== 'function') return null;
    let audio = audioByCue.get(cue);
    if (audio) return audio;
    let resolved = path;
    if (!/^https:\/\//i.test(path) && typeof resolveAssetUrl === 'function') {
      try { resolved = resolveAssetUrl(path); } catch (_) { return null; }
    }
    if (!resolved) return null;
    try {
      audio = new windowRef.Audio();
      audio.preload = 'none';
      audio.volume = volume;
      audio.src = String(resolved);
      audioByCue.set(cue, audio);
      return audio;
    } catch (_) { return null; }
  }
  function playCue(cue) {
    if (muted || !soundEnabled) return;
    const audio = getAudio(cue);
    if (!audio) return;
    try {
      audio.currentTime = 0;
      const playback = audio.play();
      if (playback && typeof playback.catch === 'function') playback.catch(() => {});
    } catch (_) {}
  }
  function vibrate() {
    if (muted || !hapticsEnabled) return;
    try {
      const nav = windowRef?.navigator;
      if (typeof nav?.vibrate === 'function') nav.vibrate(8);
    } catch (_) {}
  }
  function handleInteraction(event) {
    if (destroyed || muted || !event?.isTrusted) return;
    const cue = event.target?.closest?.(NAVIGATION_TARGETS)
      ? 'navigation'
      : event.target?.closest?.(SELECTION_TARGETS) ? 'selection' : '';
    if (!cue) return;
    playCue(cue);
    vibrate();
  }

  createPreferenceButton();
  root.addEventListener('click', handleInteraction, true);
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.removeEventListener('click', handleInteraction, true);
      preferenceButton?.removeEventListener('click', togglePreference);
      preferenceButton?.remove();
      preferenceButton = null;
      audioByCue.forEach(audio => {
        try { audio.pause(); audio.removeAttribute('src'); audio.load?.(); } catch (_) {}
      });
      audioByCue.clear();
    }
  };
}
