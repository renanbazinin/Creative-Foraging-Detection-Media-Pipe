// Normalize a color input (hex string or HSV-like object) into RGB
const normalizeColorToRGB = (input) => {
  if (!input) return null;

  if (typeof input === 'string') {
    let hex = input.trim();
    if (!hex.startsWith('#')) return null;
    hex = hex.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length !== 6) return null;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if ([r, g, b].some((v) => Number.isNaN(v))) return null;
    return { r, g, b };
  }

  // Accept HSV calibration objects similar to calibrationA/B
  if (typeof input === 'object' && input !== null && typeof input.h !== 'undefined') {
    const h = (input.h || 0) * 2; // 0-360
    const s = (input.s || 0) / 255;
    const v = (input.v || 0) / 255;

    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    let r1 = 0;
    let g1 = 0;
    let b1 = 0;
    if (h >= 0 && h < 60) { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }

    const to255 = (val) => Math.max(0, Math.min(255, Math.round((val + m) * 255)));
    return {
      r: to255(r1),
      g: to255(g1),
      b: to255(b1)
    };
  }

  return null;
};

/**
 * Color-band based detector. Looks for two bracelet colors and decides
 * which band is closer to the chosen edge (bottom/top).
 */
const identifyPlayerByColor = (
  frameDataUrl,
  colorAConfig,
  colorBConfig,
  options = {}
) => {
  return new Promise((resolve) => {
    if (!frameDataUrl) {
      resolve({ suggestion: 'None', stats: {} });
      return;
    }

    const rgbA = normalizeColorToRGB(colorAConfig);
    const rgbB = normalizeColorToRGB(colorBConfig);
    if (!rgbA || !rgbB) {
      console.warn('[ColorDetector] Invalid color configs, returning None');
      resolve({ suggestion: 'None', stats: {} });
      return;
    }

    const {
      anchor = 'bottom',
      maxWidth = 320,
      colorThreshold = 80,
      minPixels = 50,
      minGapRatio = 0.05
    } = options;

    const img = new Image();

    img.onload = () => {
      try {
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ suggestion: 'None', stats: {} });
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const { data } = imageData;

        const sqThresh = colorThreshold * colorThreshold;

        const statsA = { minY: height, maxY: -1, pixels: 0 };
        const statsB = { minY: height, maxY: -1, pixels: 0 };
        const mask = new Uint8Array(width * height); // 0 = none, 1 = A, 2 = B

        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const idx = (y * width + x) * 4;
            const maskIdx = y * width + x;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];

            const dA =
              (r - rgbA.r) * (r - rgbA.r) +
              (g - rgbA.g) * (g - rgbA.g) +
              (b - rgbA.b) * (b - rgbA.b);
            const dB =
              (r - rgbB.r) * (r - rgbB.r) +
              (g - rgbB.g) * (g - rgbB.g) +
              (b - rgbB.b) * (b - rgbB.b);

            if (dA < sqThresh && dA < dB) {
              statsA.pixels += 1;
              if (y < statsA.minY) statsA.minY = y;
              if (y > statsA.maxY) statsA.maxY = y;
              mask[maskIdx] = 1;
            } else if (dB < sqThresh && dB < dA) {
              statsB.pixels += 1;
              if (y < statsB.minY) statsB.minY = y;
              if (y > statsB.maxY) statsB.maxY = y;
              mask[maskIdx] = 2;
            }
          }
        }

        const resultStats = {
          pixelsA: statsA.pixels,
          pixelsB: statsB.pixels,
          minYA: statsA.pixels > 0 ? statsA.minY : null,
          maxYA: statsA.pixels > 0 ? statsA.maxY : null,
          minYB: statsB.pixels > 0 ? statsB.minY : null,
          maxYB: statsB.pixels > 0 ? statsB.maxY : null,
          width,
          height
        };

        const hasA = statsA.pixels >= minPixels;
        const hasB = statsB.pixels >= minPixels;

        let suggestion = 'None';

        if (hasA && !hasB) {
          suggestion = 'A';
        } else if (!hasA && hasB) {
          suggestion = 'B';
        } else if (hasA && hasB) {
          let anchorPosA;
          let anchorPosB;
          if (anchor === 'top') {
            anchorPosA = statsA.minY;
            anchorPosB = statsB.minY;
          } else {
            anchorPosA = statsA.maxY;
            anchorPosB = statsB.maxY;
          }

          const gap = Math.abs(anchorPosA - anchorPosB);
          const minGap = height * minGapRatio;
          if (gap >= minGap) {
            suggestion = anchor === 'top'
              ? (anchorPosA < anchorPosB ? 'A' : 'B')
              : (anchorPosA > anchorPosB ? 'A' : 'B');
          }
        }

        let preview = null;
        try {
          const overlayCanvas = document.createElement('canvas');
          overlayCanvas.width = width;
          overlayCanvas.height = height;
          const overlayCtx = overlayCanvas.getContext('2d');
          overlayCtx.drawImage(img, 0, 0, width, height);
          const overlayImageData = overlayCtx.getImageData(0, 0, width, height);
          const overlayData = overlayImageData.data;

          const tintPixel = (idx, color) => {
            overlayData[idx] = Math.round(overlayData[idx] * 0.3 + color.r * 0.7);
            overlayData[idx + 1] = Math.round(overlayData[idx + 1] * 0.3 + color.g * 0.7);
            overlayData[idx + 2] = Math.round(overlayData[idx + 2] * 0.3 + color.b * 0.7);
            overlayData[idx + 3] = 255;
          };

          const tintA = { r: 255, g: 82, b: 97 };
          const tintB = { r: 80, g: 170, b: 255 };

          for (let i = 0; i < mask.length; i += 1) {
            if (mask[i] === 1) {
              tintPixel(i * 4, tintA);
            } else if (mask[i] === 2) {
              tintPixel(i * 4, tintB);
            }
          }

          overlayCtx.putImageData(overlayImageData, 0, 0);
          preview = overlayCanvas.toDataURL('image/png');
        } catch (previewError) {
          console.warn('[ColorDetector] Failed generating preview', previewError);
        }

        resolve({ suggestion, stats: resultStats, preview });
      } catch (err) {
        console.error('[ColorDetector] Error processing frame:', err);
        resolve({ suggestion: 'None', stats: {} });
      }
    };

    img.onerror = (e) => {
      console.error('[ColorDetector] Failed to load frame image', e);
      resolve({ suggestion: 'None', stats: {} });
    };

    if (typeof frameDataUrl === 'string' && frameDataUrl.startsWith('data:image')) {
      img.src = frameDataUrl;
    } else if (typeof frameDataUrl === 'string') {
      img.src = `data:image/jpeg;base64,${frameDataUrl}`;
    } else {
      resolve({ suggestion: 'None', stats: {} });
    }
  });
};

export {
  identifyPlayerByColor,
  normalizeColorToRGB
};


