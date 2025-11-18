import { SelfieSegmentation } from '@mediapipe/selfie_segmentation';

const DEFAULT_SEGMENTATION_MODEL = 1;

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

const loadImageElement = (source) => new Promise((resolve, reject) => {
  if (!source || typeof source !== 'string') {
    reject(new Error('Invalid image source'));
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = (e) => reject(e);
  if (source.startsWith('data:image')) {
    img.src = source;
  } else {
    img.src = `data:image/jpeg;base64,${source}`;
  }
});

const rgbDistanceSq = (a, b) => (
  (a.r - b.r) * (a.r - b.r) +
  (a.g - b.g) * (a.g - b.g) +
  (a.b - b.b) * (a.b - b.b)
);

const rgbToHex = (r, g, b) => {
  const toHex = (val) => {
    const hex = Math.max(0, Math.min(255, Math.round(val))).toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
};

// RGB to HSV conversion - Returns h=[0-360], s=[0-100], v=[0-100]
const rgbToHsv = (r, g, b) => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max === min) {
    h = 0;
  } else {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
      default:
        h = 0;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, v: v * 100 };
};

// Normalize color input to HSV format
const normalizeColorToHSV = (input) => {
  if (!input) return null;

  // Handle Hex String
  if (typeof input === 'string') {
    let hex = input.trim().replace('#', '');
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length !== 6) return null;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if ([r, g, b].some((v) => Number.isNaN(v))) return null;
    return rgbToHsv(r, g, b);
  }

  // Handle existing Object
  if (typeof input === 'object' && input !== null) {
    // If it's already HSV-like (h, s, v in 0-360, 0-100, 0-100 range)
    if (input.h !== undefined && input.s !== undefined && input.v !== undefined) {
      // If it's in the old format (h: 0-180, s/v: 0-255), convert it
      if (input.s <= 255 && input.v <= 255) {
        return {
          h: (input.h || 0) * 2, // 0-180 -> 0-360
          s: ((input.s || 0) / 255) * 100, // 0-255 -> 0-100
          v: ((input.v || 0) / 255) * 100 // 0-255 -> 0-100
        };
      }
      // Already in correct format
      return input;
    }
    // If it's RGB object
    if (input.r !== undefined && input.g !== undefined && input.b !== undefined) {
      return rgbToHsv(input.r, input.g, input.b);
    }
  }

  return null;
};

// Circular hue distance - calculates shortest distance around the color wheel
// e.g., 355° and 5° are 10 units apart, not 350
const getHueDistance = (h1, h2) => {
  const diff = Math.abs(h1 - h2);
  return Math.min(diff, 360 - diff);
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const createOverlayFromMask = (baseImage, width, height, mask, maskThreshold, highlights = []) => {
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = width;
  overlayCanvas.height = height;
  const overlayCtx = overlayCanvas.getContext('2d');
  overlayCtx.drawImage(baseImage, 0, 0, width, height);

  const overlayImageData = overlayCtx.getImageData(0, 0, width, height);
  const overlayData = overlayImageData.data;
  const tintColor = { r: 20, g: 180, b: 255 };

  for (let i = 0; i < width * height; i += 1) {
    if (mask[i * 4] >= maskThreshold) {
      const idx = i * 4;
      overlayData[idx] = Math.round(overlayData[idx] * 0.35 + tintColor.r * 0.65);
      overlayData[idx + 1] = Math.round(overlayData[idx + 1] * 0.35 + tintColor.g * 0.65);
      overlayData[idx + 2] = Math.round(overlayData[idx + 2] * 0.35 + tintColor.b * 0.65);
      overlayData[idx + 3] = 255;
    }
  }

  overlayCtx.putImageData(overlayImageData, 0, 0);

  highlights.forEach((point) => {
    if (!point) return;
    overlayCtx.beginPath();
    overlayCtx.arc(point.x, point.y, 6, 0, Math.PI * 2);
    overlayCtx.fillStyle = point.fill || 'rgba(0, 230, 118, 0.35)';
    overlayCtx.strokeStyle = point.stroke || '#00E676';
    overlayCtx.lineWidth = 2;
    overlayCtx.fill();
    overlayCtx.stroke();
  });

  return overlayCanvas.toDataURL('image/png');
};

let selfieSegmentationInstance = null;

const getSelfieSegmentation = () => {
  if (typeof window === 'undefined') {
    throw new Error('Selfie segmentation is only available in the browser');
  }
  if (!selfieSegmentationInstance) {
    selfieSegmentationInstance = new SelfieSegmentation({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
    });
    selfieSegmentationInstance.setOptions({
      modelSelection: DEFAULT_SEGMENTATION_MODEL,
      selfieMode: false
    });
  }
  return selfieSegmentationInstance;
};

const runSegmentation = (imageSource, options = {}) => {
  const instance = getSelfieSegmentation();
  if (typeof options.modelSelection === 'number') {
    instance.setOptions({
      modelSelection: options.modelSelection,
      selfieMode: false
    });
  }
  return new Promise((resolve, reject) => {
    instance.onResults((results) => resolve(results));
    instance.send({ image: imageSource }).catch(reject);
  });
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
) => new Promise((resolve) => {
  if (!frameDataUrl) {
    resolve({ suggestion: 'None', stats: { mode: 'colorMask' } });
    return;
  }

  const rgbA = normalizeColorToRGB(colorAConfig);
  const rgbB = normalizeColorToRGB(colorBConfig);
  if (!rgbA || !rgbB) {
    console.warn('[ColorDetector] Invalid color configs, returning None');
    resolve({ suggestion: 'None', stats: { mode: 'colorMask' } });
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
  img.crossOrigin = 'anonymous';

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
        resolve({ suggestion: 'None', stats: { mode: 'colorMask' } });
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
        mode: 'colorMask',
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
      resolve({ suggestion: 'None', stats: { mode: 'colorMask' } });
    }
  };

  img.onerror = (e) => {
    console.error('[ColorDetector] Failed to load frame image', e);
    resolve({ suggestion: 'None', stats: { mode: 'colorMask' } });
  };

  if (typeof frameDataUrl === 'string' && frameDataUrl.startsWith('data:image')) {
    img.src = frameDataUrl;
  } else if (typeof frameDataUrl === 'string') {
    img.src = `data:image/jpeg;base64,${frameDataUrl}`;
  } else {
    resolve({ suggestion: 'None', stats: { mode: 'colorMask' } });
  }
});

const identifyPlayerBySegmentation = async (
  frameDataUrl,
  colorAConfig,
  colorBConfig,
  options = {}
) => {
  if (!frameDataUrl) {
    return { suggestion: 'None', stats: { mode: 'segmentation' } };
  }

  // CONVERT TARGETS TO HSV
  const hsvA = normalizeColorToHSV(colorAConfig);
  const hsvB = normalizeColorToHSV(colorBConfig);
  if (!hsvA || !hsvB) {
    console.warn('[ColorDetector] Invalid color configs, returning None');
    return { suggestion: 'None', stats: { mode: 'segmentation' } };
  }

  // Default configs with new HSV tuning parameters
  const {
    modelSelection = DEFAULT_SEGMENTATION_MODEL,
    stride = 2,
    maskThreshold = 100,
    wristOffsetPercent = 0.15,
    searchRadius = 60,
    // NEW TUNING PARAMETERS
    hueThreshold = 30,     // Degrees: How close the color must be (0-360)
    minSaturation = 20,    // 0-100: Ignores grey/white/black pixels. CRITICAL.
    minValue = 20          // 0-100: Ignores pitch black pixels.
  } = options;

  try {
    const imageElement = await loadImageElement(frameDataUrl);
    const width = imageElement.naturalWidth || imageElement.width;
    const height = imageElement.naturalHeight || imageElement.height;

    const results = await runSegmentation(imageElement, { modelSelection });

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.drawImage(results.segmentationMask, 0, 0, width, height);
    const maskData = maskCtx.getImageData(0, 0, width, height).data;

    const videoCanvas = document.createElement('canvas');
    videoCanvas.width = width;
    videoCanvas.height = height;
    const videoCtx = videoCanvas.getContext('2d');
    videoCtx.drawImage(imageElement, 0, 0, width, height);
    const videoData = videoCtx.getImageData(0, 0, width, height).data;

    // 1. CALCULATE CENTROID (Center of Mass of the person)
    let totalX = 0;
    let pixelCount = 0;
    
    // Stride for performance (check every 4th pixel)
    for (let i = 0; i < maskData.length; i += 4 * 4) {
      if (maskData[i] >= maskThreshold) {
        const pixelIndex = i / 4;
        const x = pixelIndex % width;
        totalX += x;
        pixelCount += 1;
      }
    }

    if (pixelCount < 500) {
      return {
        suggestion: 'None',
        stats: {
          mode: 'segmentation',
          width,
          height,
          reason: 'person_area_too_small',
          pixelCount
        }
      };
    }

    const centroidX = Math.floor(totalX / pixelCount);

    // 2. FIND TIP WITH SPATIAL FILTER (constrained to centroid window)
    let tip = null;
    const startX = Math.max(0, centroidX - searchRadius);
    const endX = Math.min(width, centroidX + searchRadius);

    for (let y = 0; y < height; y += stride) {
      for (let x = startX; x < endX; x += stride) {
        const idx = (y * width + x) * 4;
        if (maskData[idx] >= maskThreshold) {
          tip = { x, y };
          break;
        }
      }
      if (tip) break;
    }

    if (!tip) {
      return {
        suggestion: 'None',
        stats: {
          mode: 'segmentation',
          width,
          height,
          reason: 'no_tip_found_in_constrained_window',
          centroidX,
          searchRadius
        }
      };
    }

    // 3. WRIST SAMPLING & HSV COMPARISON
    const wristOffset = Math.floor(height * wristOffsetPercent);
    const wristY = clamp(tip.y + wristOffset, 0, height - 1);
    const wrist = { x: tip.x, y: wristY };

    // Helper to get HSV at coords
    const sampleHSVAt = (x, y) => {
      const clampedX = clamp(Math.round(x), 0, width - 1);
      const clampedY = clamp(Math.round(y), 0, height - 1);
      const idx = (clampedY * width + clampedX) * 4;
      const r = videoData[idx];
      const g = videoData[idx + 1];
      const b = videoData[idx + 2];
      const hsv = rgbToHsv(r, g, b);
      return {
        ...hsv,
        r,
        g,
        b,
        hex: rgbToHex(r, g, b)
      };
    };

    const wristHSV = sampleHSVAt(wrist.x, wrist.y);
    const tipHSV = sampleHSVAt(tip.x, tip.y);

    // --- THE NEW EVALUATION LOGIC (HSV-based) ---
    const evaluateMatch = (sample) => {
      if (!sample) {
        return { match: null, reason: 'no_sample' };
      }

      // 1. Filter out Grey/Dark pixels (Walls, Shadows, Ceiling)
      if (sample.s < minSaturation || sample.v < minValue) {
        return { match: null, reason: 'low_saturation_or_value', s: sample.s, v: sample.v };
      }

      const distA = hsvA ? getHueDistance(sample.h, hsvA.h) : 999;
      const distB = hsvB ? getHueDistance(sample.h, hsvB.h) : 999;

      // Check thresholds
      const validA = distA <= hueThreshold;
      const validB = distB <= hueThreshold;

      if (validA && !validB) {
        return { match: 'A', dist: distA, distA, distB };
      }
      if (!validA && validB) {
        return { match: 'B', dist: distB, distA, distB };
      }
      if (validA && validB) {
        return { match: distA < distB ? 'A' : 'B', dist: Math.min(distA, distB), distA, distB };
      }

      return { match: null, distA, distB };
    };

    const wristResult = evaluateMatch(wristHSV);
    const tipResult = evaluateMatch(tipHSV);

    // Prefer wrist match over tip (wrist is more reliable for bracelet color)
    const suggestion = wristResult.match || tipResult.match || 'None';
    let detectionPoint = null;
    if (wristResult.match) {
      detectionPoint = { ...wrist, label: 'wrist' };
    } else if (tipResult.match) {
      detectionPoint = { ...tip, label: 'tip' };
    }

    const personPixels = (() => {
      let count = 0;
      for (let i = 0; i < width * height; i += 1) {
        if (maskData[i * 4] >= maskThreshold) count += 1;
      }
      return count;
    })();

    let preview = null;
    let maskPreview = null;
    try {
      // Create preview with color mask overlay + person glow
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = width;
      previewCanvas.height = height;
      const previewCtx = previewCanvas.getContext('2d');
      
      // Draw original image
      previewCtx.drawImage(imageElement, 0, 0, width, height);
      
      // Apply color mask overlay (Player A/B bracelet colors)
      // Convert HSV targets back to RGB for visualization
      const rgbA = normalizeColorToRGB(colorAConfig);
      const rgbB = normalizeColorToRGB(colorBConfig);
      
      const imageData = previewCtx.getImageData(0, 0, width, height);
      const pixels = imageData.data;
      
      // Use a reasonable RGB threshold for visualization (not for matching)
      const visThreshold = 95;
      const sqThresh = visThreshold * visThreshold;
      const tintA = { r: 255, g: 82, b: 97 };
      const tintB = { r: 80, g: 170, b: 255 };
      
      if (rgbA && rgbB) {
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const idx = (y * width + x) * 4;
            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];
            
            const dA = rgbDistanceSq({ r, g, b }, rgbA);
            const dB = rgbDistanceSq({ r, g, b }, rgbB);
            
            if (dA < sqThresh && dA < dB) {
              pixels[idx] = Math.round(pixels[idx] * 0.3 + tintA.r * 0.7);
              pixels[idx + 1] = Math.round(pixels[idx + 1] * 0.3 + tintA.g * 0.7);
              pixels[idx + 2] = Math.round(pixels[idx + 2] * 0.3 + tintA.b * 0.7);
            } else if (dB < sqThresh && dB < dA) {
              pixels[idx] = Math.round(pixels[idx] * 0.3 + tintB.r * 0.7);
              pixels[idx + 1] = Math.round(pixels[idx + 1] * 0.3 + tintB.g * 0.7);
              pixels[idx + 2] = Math.round(pixels[idx + 2] * 0.3 + tintB.b * 0.7);
            }
          }
        }
      }
      
      previewCtx.putImageData(imageData, 0, 0);
      
      // Add glow effect around person coverage (MediaPipe mask edges)
      const glowRadius = 3;
      const glowColor = 'rgba(0, 255, 150, 0.6)'; // Cyan-green glow
      
      // Create a temporary canvas for the glow mask
      const glowCanvas = document.createElement('canvas');
      glowCanvas.width = width;
      glowCanvas.height = height;
      const glowCtx = glowCanvas.getContext('2d');
      
      // Draw person mask edges with glow
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const idx = (y * width + x) * 4;
          const isPerson = maskData[idx] >= maskThreshold;
          
          if (isPerson) {
            // Check if this pixel is on the edge (has a non-person neighbor)
            let isEdge = false;
            for (let dy = -1; dy <= 1 && !isEdge; dy += 1) {
              for (let dx = -1; dx <= 1 && !isEdge; dx += 1) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                  const nIdx = (ny * width + nx) * 4;
                  if (maskData[nIdx] < maskThreshold) {
                    isEdge = true;
                  }
                } else {
                  isEdge = true; // Edge of image
                }
              }
            }
            
            if (isEdge) {
              // Draw glow circle at edge pixels
              glowCtx.beginPath();
              glowCtx.arc(x, y, glowRadius, 0, Math.PI * 2);
              glowCtx.fillStyle = glowColor;
              glowCtx.fill();
            }
          }
        }
      }
      
      // Composite the glow onto the preview
      previewCtx.globalCompositeOperation = 'screen';
      previewCtx.drawImage(glowCanvas, 0, 0);
      previewCtx.globalCompositeOperation = 'source-over';
      
      // Draw centroid line (cyan vertical line down the center of the arm)
      if (centroidX >= 0) {
        previewCtx.beginPath();
        previewCtx.strokeStyle = 'cyan';
        previewCtx.lineWidth = 2;
        previewCtx.moveTo(centroidX, 0);
        previewCtx.lineTo(centroidX, height);
        previewCtx.stroke();
      }
      
      // Draw tip marker (yellow circle - the finger)
      if (tip) {
        previewCtx.beginPath();
        previewCtx.arc(tip.x, tip.y, 5, 0, Math.PI * 2);
        previewCtx.fillStyle = 'yellow';
        previewCtx.fill();
      }
      
      // Draw wrist marker (colored circle with detected color, lime stroke - where we check color)
      if (wrist && wristHSV) {
        previewCtx.beginPath();
        previewCtx.arc(wrist.x, wrist.y, 8, 0, Math.PI * 2);
        previewCtx.fillStyle = `rgb(${wristHSV.r},${wristHSV.g},${wristHSV.b})`;
        previewCtx.strokeStyle = 'lime';
        previewCtx.lineWidth = 2;
        previewCtx.fill();
        previewCtx.stroke();
      }
      
      preview = previewCanvas.toDataURL('image/png');
      
      // Generate raw MediaPipe mask visualization (white = person, black = background)
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = width;
      maskCanvas.height = height;
      const maskCtx = maskCanvas.getContext('2d');
      const maskImageData = maskCtx.createImageData(width, height);
      const maskPixels = maskImageData.data;
      
      for (let i = 0; i < width * height; i += 1) {
        const idx = i * 4;
        const isPerson = maskData[i * 4] >= maskThreshold;
        const value = isPerson ? 255 : 0;
        maskPixels[idx] = value;     // R
        maskPixels[idx + 1] = value; // G
        maskPixels[idx + 2] = value; // B
        maskPixels[idx + 3] = 255;   // A
      }
      
      maskCtx.putImageData(maskImageData, 0, 0);
      maskPreview = maskCanvas.toDataURL('image/png');
    } catch (previewError) {
      console.warn('[ColorDetector] Failed generating segmentation preview', previewError);
    }

    const stats = {
      mode: 'segmentation-hsv',
      width,
      height,
      maskThreshold,
      stride,
      wristOffset,
      wristOffsetPercent,
      searchRadius,
      centroidX,
      hueThreshold,
      minSaturation,
      minValue,
      tip,
      wrist,
      tipHSV,
      wristHSV,
      tipResult,
      wristResult,
      detectionPoint,
      personPixels,
      pixelCount,
      hsvA,
      hsvB
    };

    return { suggestion, stats, preview, maskPreview };
  } catch (error) {
    console.error('[ColorDetector] Segmentation failed:', error);
    throw error;
  }
};

export {
  identifyPlayerByColor,
  identifyPlayerBySegmentation,
  normalizeColorToRGB
};
