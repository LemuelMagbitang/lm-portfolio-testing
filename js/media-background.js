/*
 * LM Media Backgrounds
 * Lightweight, dependency-free visual fills for transparent Lottie and 3D
 * artwork. The same data shape is used by the public site and CMS previews.
 *
 * Supported fills:
 *   none | solid | gradient | pattern | image | video | shader
 *
 * "shader" is intentionally a browser-friendly procedural/shader-style
 * background rather than a custom WebGPU authoring environment. It provides
 * parameterized animated gradients without adding a heavy rendering stack.
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    type: 'none',
    color: '#121212',
    color2: '#2a2a2a',
    angle: 135,
    opacity: 1,
    blur: 0,
    image: { src: '', position: '50% 50%', fit: 'cover' },
    video: { src: '', position: '50% 50%', fit: 'cover' },
    pattern: { kind: 'grid', size: 48, thickness: 1, opacity: 0.12, color: '#ffffff' },
    shader: { preset: 'aurora', speed: 0.45, intensity: 0.65, color1: '#5b5cff', color2: '#ff4fd8', color3: '#22d3ee' },
    overlay: { color: '#000000', opacity: 0 }
  };

  function clamp(value, min, max) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
  }

  function copy(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function normalizeBackground(input) {
    const src = input && typeof input === 'object' ? input : {};
    const out = {
      ...copy(DEFAULTS),
      ...src,
      image: { ...copy(DEFAULTS.image), ...(src.image || {}) },
      video: { ...copy(DEFAULTS.video), ...(src.video || {}) },
      pattern: { ...copy(DEFAULTS.pattern), ...(src.pattern || {}) },
      shader: { ...copy(DEFAULTS.shader), ...(src.shader || {}) },
      overlay: { ...copy(DEFAULTS.overlay), ...(src.overlay || {}) }
    };
    if (!['none', 'solid', 'gradient', 'pattern', 'image', 'video', 'shader'].includes(out.type)) out.type = 'none';
    out.color = out.color || DEFAULTS.color;
    out.color2 = out.color2 || DEFAULTS.color2;
    out.angle = clamp(out.angle, 0, 360);
    out.opacity = clamp(out.opacity, 0, 1);
    out.blur = clamp(out.blur, 0, 48);
    out.pattern.size = clamp(out.pattern.size, 8, 180);
    out.pattern.thickness = clamp(out.pattern.thickness, 1, 12);
    out.pattern.opacity = clamp(out.pattern.opacity, 0, 1);
    out.shader.speed = clamp(out.shader.speed, 0.05, 2);
    out.shader.intensity = clamp(out.shader.intensity, 0, 1);
    out.overlay.opacity = clamp(out.overlay.opacity, 0, 1);
    return out;
  }

  function safeCssColor(value, fallback) {
    const v = String(value || '').trim();
    // Browser CSS color parsing does the heavy lifting after this conservative
    // filter. Accept named colors, hex, rgb(a), hsl(a), etc.
    return /^[#a-z0-9(),.%\s-]+$/i.test(v) ? v : fallback;
  }

  function resolveSrc(src, resolveUrl) {
    if (!src) return '';
    try { return typeof resolveUrl === 'function' ? resolveUrl(src) : src; }
    catch (e) { return src; }
  }

  function buildPattern(bg) {
    const kind = bg.pattern.kind || 'grid';
    const size = clamp(bg.pattern.size, 8, 180);
    const thickness = clamp(bg.pattern.thickness, 1, 12);
    const color = safeCssColor(bg.pattern.color, '#ffffff');
    if (kind === 'dots') {
      return `radial-gradient(circle, ${color} ${thickness}px, transparent ${thickness + 0.5}px)`;
    }
    if (kind === 'diagonal') {
      return `repeating-linear-gradient(135deg, transparent 0 ${Math.max(1, size - thickness)}px, ${color} ${Math.max(1, size - thickness)}px ${size}px)`;
    }
    if (kind === 'checker') {
      return `conic-gradient(${color} 25%, transparent 0 50%, ${color} 0 75%, transparent 0)`;
    }
    return `linear-gradient(${color} ${thickness}px, transparent ${thickness}px), linear-gradient(90deg, ${color} ${thickness}px, transparent ${thickness}px)`;
  }

  function buildShaderStyle(bg) {
    const p = bg.shader || DEFAULTS.shader;
    const c1 = safeCssColor(p.color1, '#5b5cff');
    const c2 = safeCssColor(p.color2, '#ff4fd8');
    const c3 = safeCssColor(p.color3, '#22d3ee');
    const intensity = clamp(p.intensity, 0, 1);
    if ((p.preset || 'aurora') === 'mesh') {
      return {
        background: `radial-gradient(circle at 18% 24%, color-mix(in srgb, ${c1} ${Math.round(intensity * 85)}%, transparent), transparent 42%), radial-gradient(circle at 82% 22%, color-mix(in srgb, ${c2} ${Math.round(intensity * 78)}%, transparent), transparent 38%), radial-gradient(circle at 55% 80%, color-mix(in srgb, ${c3} ${Math.round(intensity * 70)}%, transparent), transparent 45%), #0c0c0f`
      };
    }
    return {
      background: `conic-gradient(from 210deg at 50% 50%, color-mix(in srgb, ${c1} ${Math.round(intensity * 70)}%, transparent), color-mix(in srgb, ${c2} ${Math.round(intensity * 72)}%, transparent), color-mix(in srgb, ${c3} ${Math.round(intensity * 68)}%, transparent), color-mix(in srgb, ${c1} ${Math.round(intensity * 70)}%, transparent))`
    };
  }

  function apply(host, input, resolveUrl) {
    if (!host) return null;
    const bg = normalizeBackground(input);
    host.style.position = host.style.position || 'relative';
    host.style.overflow = host.style.overflow || 'hidden';
    host.style.isolation = 'isolate';
    host.classList.add('lm-media-background-host');

    const old = host.querySelector(':scope > .lm-media-background-layer');
    if (old) old.remove();
    const oldOverlay = host.querySelector(':scope > .lm-media-background-overlay');
    if (oldOverlay) oldOverlay.remove();

    if (!bg || bg.type === 'none') return bg;

    const layer = document.createElement('div');
    layer.className = 'lm-media-background-layer';
    Object.assign(layer.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex: '0',
      opacity: String(bg.opacity),
      background: safeCssColor(bg.color, '#121212')
    });

    if (bg.type === 'solid') {
      layer.style.background = safeCssColor(bg.color, '#121212');
    } else if (bg.type === 'gradient') {
      layer.style.background = `linear-gradient(${clamp(bg.angle, 0, 360)}deg, ${safeCssColor(bg.color, '#121212')} 0%, ${safeCssColor(bg.color2, '#2a2a2a')} 100%)`;
    } else if (bg.type === 'pattern') {
      layer.style.backgroundColor = safeCssColor(bg.color, '#121212');
      layer.style.backgroundImage = buildPattern(bg);
      const size = clamp(bg.pattern.size, 8, 180);
      layer.style.backgroundSize = bg.pattern.kind === 'dots' ? `${size}px ${size}px` : `${size}px ${size}px`;
      layer.style.opacity = String(clamp(bg.pattern.opacity, 0, 1) * bg.opacity);
    } else if (bg.type === 'image') {
      const img = document.createElement('img');
      img.src = resolveSrc(bg.image.src, resolveUrl);
      img.alt = '';
      Object.assign(img.style, {
        position: 'absolute', inset: '0', width: '100%', height: '100%',
        objectFit: bg.image.fit || 'cover', objectPosition: bg.image.position || '50% 50%',
        filter: bg.blur ? `blur(${clamp(bg.blur, 0, 48)}px)` : 'none',
        transform: bg.blur ? 'scale(1.08)' : 'none',
        display: 'block'
      });
      layer.appendChild(img);
    } else if (bg.type === 'video') {
      const video = document.createElement('video');
      video.src = resolveSrc(bg.video.src, resolveUrl);
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      Object.assign(video.style, {
        position: 'absolute', inset: '0', width: '100%', height: '100%',
        objectFit: bg.video.fit || 'cover', objectPosition: bg.video.position || '50% 50%',
        filter: bg.blur ? `blur(${clamp(bg.blur, 0, 48)}px)` : 'none',
        transform: bg.blur ? 'scale(1.08)' : 'none',
        display: 'block'
      });
      layer.appendChild(video);
      const play = video.play();
      if (play && typeof play.catch === 'function') play.catch(() => {});
    } else if (bg.type === 'shader') {
      const shaderStyle = buildShaderStyle(bg);
      layer.style.background = shaderStyle.background;
      layer.classList.add('lm-media-background-shader', `shader-${bg.shader.preset || 'aurora'}`);
      layer.style.setProperty('--lm-shader-speed', `${Math.max(0.01, Number(bg.shader.speed) || 0.45)}s`);
      layer.style.setProperty('--lm-shader-intensity', String(bg.shader.intensity));
    }

    host.insertBefore(layer, host.firstChild || null);

    // Keep actual artwork above both the background and tint layer without
    // overriding the artwork's own positioning. The 3D viewer creates its
    // canvas/UI after the background layer, so a generic position:relative
    // rule here would move those controls out of their intended overlay.
    Array.from(host.children).forEach(child => {
      if (child === layer) return;
      const computed = typeof global.getComputedStyle === 'function'
        ? global.getComputedStyle(child)
        : null;
      if (!child.style.position && (!computed || computed.position === 'static')) {
        child.style.position = 'relative';
      }
      child.style.zIndex = child.style.zIndex || '2';
    });

    const overlay = document.createElement('div');
    overlay.className = 'lm-media-background-overlay';
    Object.assign(overlay.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '1',
      background: 'transparent'
    });
    if (bg.overlay && typeof bg.overlay === 'object') {
      overlay.style.background = safeCssColor(bg.overlay.color, 'transparent');
      overlay.style.opacity = String(clamp(bg.overlay.opacity, 0, 1));
    }
    host.insertBefore(overlay, host.firstChild?.nextSibling || null);

    return bg;
  }

  global.LMMediaBackground = { DEFAULTS, normalize: normalizeBackground, apply };
})(window);
