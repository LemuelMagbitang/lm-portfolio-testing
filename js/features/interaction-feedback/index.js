/**
 * CMS-controlled navigation and selection feedback.
 * Audio is primed only after a trusted user gesture, and rejected playback is
 * intentionally silent so blocked autoplay never interferes with navigation.
 */
const NAVIGATION_TARGETS = '.nav-logo, .nav-links a[href]';
const SELECTION_TARGETS = '.filter-tabs .tab-btn, .filter-tabs .filter-btn, .contact-mobile-tab';
const FILTER_SELECTION_TARGETS = '.filter-tabs .tab-btn, .filter-tabs .filter-btn';

function clampVolume(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(0.3, number)) : 0.12;
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

  let destroyed = false;
  let lastCue = '';
  let lastCueAt = 0;
  let audioOperation = 0;
  const audioByCue = new Map();
  const primeTokens = new WeakMap();
  const unlockedAudio = new WeakSet();

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
      audio.preload = 'auto';
      audio.volume = volume;
      audio.src = String(resolved);
      audioByCue.set(cue, audio);
      return audio;
    } catch (_) {
      return null;
    }
  }

  function primeAudioFromGesture(audio) {
    if (!audio || unlockedAudio.has(audio) || !audio.paused) return;
    const token = ++audioOperation;
    primeTokens.set(audio, token);
    try {
      // The muted play attempt is made within trusted user activation. It primes
      // restrictive browsers without adding an audible sound to the gesture.
      audio.muted = true;
      const playback = audio.play();
      if (playback && typeof playback.then === 'function') {
        playback.then(() => {
          if (primeTokens.get(audio) !== token) return;
          try {
            audio.pause();
            audio.currentTime = 0;
            audio.muted = false;
            unlockedAudio.add(audio);
          } catch (_) {}
        }).catch(() => {
          if (primeTokens.get(audio) === token) audio.muted = false;
        });
      } else {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        unlockedAudio.add(audio);
      }
    } catch (_) {
      if (primeTokens.get(audio) === token) audio.muted = false;
    }
  }

  function getGestureCue(event) {
    const target = event?.target;
    if (target?.closest?.(NAVIGATION_TARGETS)) return 'navigation';
    if (target?.closest?.(SELECTION_TARGETS)) return 'selection';
    return '';
  }

  function unlockAudioFromGesture(event) {
    if (destroyed || !soundEnabled || !event?.isTrusted) return;
    const cue = getGestureCue(event);
    if (!cue) return;
    primeAudioFromGesture(getAudio(cue));
  }

  function playCue(cue) {
    if (destroyed || !soundEnabled) return;
    const audio = getAudio(cue);
    if (!audio) return;

    // Drop immediate duplicate deliveries and stop any older cue before playing.
    const now = Date.now();
    if (lastCue === cue && now - lastCueAt < 110) return;
    lastCue = cue;
    lastCueAt = now;

    audioByCue.forEach(otherAudio => {
      if (otherAudio === audio) return;
      primeTokens.set(otherAudio, ++audioOperation);
      try {
        otherAudio.pause();
        otherAudio.currentTime = 0;
        otherAudio.muted = false;
      } catch (_) {}
    });

    primeTokens.set(audio, ++audioOperation);
    try {
      audio.muted = false;
      audio.pause();
      audio.currentTime = 0;
      const playback = audio.play();
      if (playback && typeof playback.catch === 'function') playback.catch(() => {});
    } catch (_) {
      // Blocked or missing media never interferes with visual/keyboard behavior.
    }
  }

  function vibrate() {
    if (!hapticsEnabled) return;
    try {
      const nav = windowRef?.navigator;
      if (typeof nav?.vibrate === 'function') nav.vibrate(8);
    } catch (_) {}
  }

  function isMobileFilterControl(target) {
    return !!target?.closest?.(FILTER_SELECTION_TARGETS) &&
      (Number(windowRef?.innerWidth) || 0) < 768;
  }

  function handleInteraction(event) {
    if (destroyed || !event?.isTrusted) return;
    unlockAudioFromGesture(event);

    const target = event.target;
    const cue = target?.closest?.(NAVIGATION_TARGETS)
      ? 'navigation'
      : target?.closest?.(SELECTION_TARGETS) ? 'selection' : '';
    if (!cue) return;

    // Mobile filter sound belongs to its settled center, not its initial tap.
    if (isMobileFilterControl(target)) {
      vibrate();
      return;
    }

    playCue(cue);
    vibrate();
  }

  function handleCenteredFilter(event) {
    if (destroyed || !soundEnabled || !event?.detail?.filter) return;
    playCue('selection');
  }

  root.addEventListener('pointerdown', unlockAudioFromGesture, true);
  root.addEventListener('keydown', unlockAudioFromGesture, true);
  root.addEventListener('click', handleInteraction, true);
  root.addEventListener('lm:filter-centered', handleCenteredFilter);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.removeEventListener('pointerdown', unlockAudioFromGesture, true);
      root.removeEventListener('keydown', unlockAudioFromGesture, true);
      root.removeEventListener('click', handleInteraction, true);
      root.removeEventListener('lm:filter-centered', handleCenteredFilter);
      audioByCue.forEach(audio => {
        try { audio.pause(); audio.removeAttribute('src'); audio.load?.(); } catch (_) {}
      });
      audioByCue.clear();
    }
  };
}
