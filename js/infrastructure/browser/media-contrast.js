/**
 * Shared foreground-contrast helpers for media-backed surfaces.
 *
 * The default sampling path preserves the footer's established average crop.
 * An optional viewport point samples the corresponding visible pixel patch,
 * which lets fixed UI (such as the brand mark) follow the content underneath.
 * Cross-origin media that taints canvas fails closed to a caller-owned fallback.
 */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function positionFraction(token, fallback = 0.5) {
  const value = String(token || '').trim().toLowerCase();
  if (value === 'left' || value === 'top') return 0;
  if (value === 'right' || value === 'bottom') return 1;
  if (value === 'center') return 0.5;
  if (value.endsWith('%')) {
    const percent = Number.parseFloat(value);
    return Number.isFinite(percent) ? clamp(percent / 100, 0, 1) : fallback;
  }
  return fallback;
}

function linearChannel(value) {
  const channel = clamp(value / 255, 0, 1);
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

export function foregroundForLuminance(luminance) {
  if (!Number.isFinite(luminance)) return '#fff';
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  return blackContrast > whiteContrast ? '#000' : '#fff';
}

export function sampleMediaLuminance(documentRef, media, viewportPoint = null) {
  const width = Number(media?.naturalWidth || media?.videoWidth || 0);
  const height = Number(media?.naturalHeight || media?.videoHeight || 0);
  if (!width || !height) return null;

  try {
    const canvas = documentRef.createElement('canvas');
    const sampleSize = viewportPoint ? 8 : 32;
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    let sourceWidth = width;
    let sourceHeight = height;
    let sourceX = 0;
    let sourceY = 0;

    if (viewportPoint) {
      const rect = media.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0 ||
          viewportPoint.x < rect.left || viewportPoint.x > rect.right ||
          viewportPoint.y < rect.top || viewportPoint.y > rect.bottom) {
        return null;
      }

      const style = documentRef.defaultView?.getComputedStyle?.(media);
      const objectFit = style?.objectFit || 'fill';
      const localX = clamp((viewportPoint.x - rect.left) / rect.width, 0, 1);
      const localY = clamp((viewportPoint.y - rect.top) / rect.height, 0, 1);
      const renderedAspect = rect.width / rect.height;
      const sourceAspect = width / height;

      if (objectFit === 'cover') {
        let horizontalPosition = 0.5;
        let verticalPosition = 0.5;
        const positionTokens = String(style?.objectPosition || '50% 50%').split(/\\s+/);
        horizontalPosition = positionFraction(positionTokens[0], 0.5);
        verticalPosition = positionFraction(positionTokens[1] || '50%', 0.5);

        if (sourceAspect > renderedAspect) {
          sourceWidth = height * renderedAspect;
          sourceX = (width - sourceWidth) * horizontalPosition;
        } else {
          sourceHeight = width / renderedAspect;
          sourceY = (height - sourceHeight) * verticalPosition;
        }
      } else if (objectFit === 'contain') {
        const contentAspect = sourceAspect;
        if (contentAspect > renderedAspect) {
          const contentHeight = rect.width / contentAspect;
          const offsetY = (rect.height - contentHeight) * verticalPositionFraction(style?.objectPosition);
          if (viewportPoint.y < rect.top + offsetY || viewportPoint.y > rect.top + offsetY + contentHeight) return null;
          sourceHeight = height;
          sourceY = 0;
        } else {
          const contentWidth = rect.height * contentAspect;
          const offsetX = (rect.width - contentWidth) * horizontalPositionFraction(style?.objectPosition);
          if (viewportPoint.x < rect.left + offsetX || viewportPoint.x > rect.left + offsetX + contentWidth) return null;
          sourceWidth = width;
          sourceX = 0;
        }
        const fittedWidth = sourceWidth;
        const fittedHeight = sourceHeight;
        const u = clamp((viewportPoint.x - rect.left) / rect.width, 0, 1);
        const v = clamp((viewportPoint.y - rect.top) / rect.height, 0, 1);
        sourceX += u * fittedWidth;
        sourceY += v * fittedHeight;
        const patchWidth = Math.max(1, width * Math.min(0.035, 8 / rect.width));
        const patchHeight = Math.max(1, height * Math.min(0.035, 8 / rect.height));
        sourceX = clamp(sourceX - patchWidth / 2, 0, width - patchWidth);
        sourceY = clamp(sourceY - patchHeight / 2, 0, height - patchHeight);
        context.drawImage(media, sourceX, sourceY, patchWidth, patchHeight, 0, 0, sampleSize, sampleSize);
        return readLuminance(context, sampleSize);
      }

      sourceX += localX * sourceWidth;
      sourceY += localY * sourceHeight;
      const patchWidth = Math.max(1, sourceWidth * Math.min(0.035, 8 / rect.width));
      const patchHeight = Math.max(1, sourceHeight * Math.min(0.035, 8 / rect.height));
      sourceX = clamp(sourceX - patchWidth / 2, 0, width - patchWidth);
      sourceY = clamp(sourceY - patchHeight / 2, 0, height - patchHeight);
      context.drawImage(media, sourceX, sourceY, patchWidth, patchHeight, 0, 0, sampleSize, sampleSize);
      return readLuminance(context, sampleSize);
    }

    // Keep the footer's existing central crop (with a lower bias for portrait
    // media) so the refactor does not change its current foreground choices.
    const targetAspect = 1;
    if (width / height > targetAspect) {
      sourceWidth = height * targetAspect;
      sourceX = (width - sourceWidth) * 0.5;
    } else {
      sourceHeight = width / targetAspect;
      sourceY = (height - sourceHeight) * 0.74;
      sourceY = Math.max(0, Math.min(sourceY, height - sourceHeight));
    }
    context.drawImage(media, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    return readLuminance(context, sampleSize);
  } catch (_) {
    return null;
  }
}

function readLuminance(context, sampleSize) {
  const { data } = context.getImageData(0, 0, sampleSize, sampleSize);
  let luminance = 0;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const r = linearChannel(data[index]);
    const g = linearChannel(data[index + 1]);
    const b = linearChannel(data[index + 2]);
    luminance += (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    count += 1;
  }
  return count ? luminance / count : null;
}

function horizontalPositionFraction(value) {
  const tokens = String(value || '50% 50%').split(/\\s+/);
  return positionFraction(tokens[0], 0.5);
}

function verticalPositionFraction(value) {
  const tokens = String(value || '50% 50%').split(/\\s+/);
  return positionFraction(tokens[1] || tokens[0], 0.5);
}

export function chooseForeground(documentRef, source, media) {
  if (source?.foreground === 'dark') return '#000';
  if (source?.foreground === 'light') return '#fff';

  const luminance = source?.type === 'image' || source?.type === 'video'
    ? sampleMediaLuminance(documentRef, media)
    : null;

  return foregroundForLuminance(luminance);
}
