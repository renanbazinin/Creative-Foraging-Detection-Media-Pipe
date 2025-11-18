import { SelfieSegmentation } from '@mediapipe/selfie_segmentation';
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

const DEFAULT_SEGMENTATION_MODEL = 1;
const MULTICLASS_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

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

  const rgbA = normalizeColorToRGB(colorAConfig);
  const rgbB = normalizeColorToRGB(colorBConfig);
  if (!rgbA || !rgbB) {
    console.warn('[ColorDetector] Invalid color configs, returning None');
    return { suggestion: 'None', stats: { mode: 'segmentation' } };
  }

  try {
    const imageElement = await loadImageElement(frameDataUrl);
    const width = imageElement.naturalWidth || imageElement.width;
    const height = imageElement.naturalHeight || imageElement.height;

    // Get segmentation mask (white = person, black = background)
    const results = await runSegmentation(imageElement, {
      modelSelection: options.modelSelection ?? DEFAULT_SEGMENTATION_MODEL
    });

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.drawImage(results.segmentationMask, 0, 0, width, height);
    const maskData = maskCtx.getImageData(0, 0, width, height).data;

    // Get original image data for color checking
    const videoCanvas = document.createElement('canvas');
    videoCanvas.width = width;
    videoCanvas.height = height;
    const videoCtx = videoCanvas.getContext('2d');
    videoCtx.drawImage(imageElement, 0, 0, width, height);
    const videoData = videoCtx.getImageData(0, 0, width, height).data;

    const maskThreshold = options.maskThreshold || 100;
    const colorThreshold = options.colorThreshold ?? 95;
    const anchor = options.anchor || 'bottom';
    const sqThresh = colorThreshold * colorThreshold;

    // Find all person pixels (arms/body)
    const personPixels = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = (y * width + x) * 4;
        const isPerson = maskData[idx] >= maskThreshold;
        if (isPerson) {
          personPixels.push({ x, y, idx });
        }
      }
    }

    if (personPixels.length === 0) {
      return {
        suggestion: 'None',
        stats: {
          mode: 'segmentation',
          width,
          height,
          reason: 'no_person_detected'
        },
        preview: null,
        maskPreview: null
      };
    }

    // Scan all person pixels to find color matches
    let pixelsA = 0;
    let pixelsB = 0;
    const armPixelsA = []; // Pixels matching color A
    const armPixelsB = []; // Pixels matching color B

    for (const pixel of personPixels) {
      const vidIdx = pixel.idx;
      const r = videoData[vidIdx];
      const g = videoData[vidIdx + 1];
      const b = videoData[vidIdx + 2];

      const dA = rgbDistanceSq({ r, g, b }, rgbA);
      const dB = rgbDistanceSq({ r, g, b }, rgbB);

      if (dA < sqThresh && dA < dB) {
        pixelsA += 1;
        armPixelsA.push(pixel);
      } else if (dB < sqThresh && dB < dA) {
        pixelsB += 1;
        armPixelsB.push(pixel);
      }
    }

    // Determine which arm is closer to anchor
    let suggestion = 'None';
    let bestArm = null;
    let bestDistance = Infinity;

    // Check arm with color A
    if (armPixelsA.length > 0) {
      let minY = height;
      let maxY = 0;
      for (const pixel of armPixelsA) {
        if (pixel.y < minY) minY = pixel.y;
        if (pixel.y > maxY) maxY = pixel.y;
      }
      const anchorY = anchor === 'top' ? minY : maxY;
      const distance = anchor === 'top' ? anchorY : height - anchorY;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestArm = { color: 'A', pixels: armPixelsA, minY, maxY, anchorY };
        suggestion = 'A';
      }
    }

    // Check arm with color B
    if (armPixelsB.length > 0) {
      let minY = height;
      let maxY = 0;
      for (const pixel of armPixelsB) {
        if (pixel.y < minY) minY = pixel.y;
        if (pixel.y > maxY) maxY = pixel.y;
      }
      const anchorY = anchor === 'top' ? minY : maxY;
      const distance = anchor === 'top' ? anchorY : height - anchorY;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestArm = { color: 'B', pixels: armPixelsB, minY, maxY, anchorY };
        suggestion = 'B';
      }
    }

    // Create simple black/white preview showing only detected arms
    let preview = null;
    let maskPreview = null;
    try {
      // Preview: Black background, white = detected arms (color A or B)
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = width;
      previewCanvas.height = height;
      const previewCtx = previewCanvas.getContext('2d');
      const previewImageData = previewCtx.createImageData(width, height);
      const previewPixels = previewImageData.data;

      // Fill with black
      for (let i = 0; i < width * height * 4; i += 4) {
        previewPixels[i] = 0;     // R
        previewPixels[i + 1] = 0; // G
        previewPixels[i + 2] = 0; // B
        previewPixels[i + 3] = 255; // A
      }

      // Mark detected arms in white
      const allArmPixels = [...armPixelsA, ...armPixelsB];
      for (const pixel of allArmPixels) {
        const idx = pixel.idx;
        previewPixels[idx] = 255;     // R
        previewPixels[idx + 1] = 255; // G
        previewPixels[idx + 2] = 255; // B
        previewPixels[idx + 3] = 255; // A
      }

      previewCtx.putImageData(previewImageData, 0, 0);
      preview = previewCanvas.toDataURL('image/png');

      // Mask preview: Raw segmentation (white = person, black = background)
      const maskPreviewCanvas = document.createElement('canvas');
      maskPreviewCanvas.width = width;
      maskPreviewCanvas.height = height;
      const maskPreviewCtx = maskPreviewCanvas.getContext('2d');
      const maskPreviewImageData = maskPreviewCtx.createImageData(width, height);
      const maskPreviewPixels = maskPreviewImageData.data;

      for (let i = 0; i < width * height; i += 1) {
        const idx = i * 4;
        const isPerson = maskData[i * 4] >= maskThreshold;
        const value = isPerson ? 255 : 0;
        maskPreviewPixels[idx] = value;     // R
        maskPreviewPixels[idx + 1] = value; // G
        maskPreviewPixels[idx + 2] = value; // B
        maskPreviewPixels[idx + 3] = 255;   // A
      }

      maskPreviewCtx.putImageData(maskPreviewImageData, 0, 0);
      maskPreview = maskPreviewCanvas.toDataURL('image/png');
    } catch (previewError) {
      console.warn('[ColorDetector] Failed generating preview', previewError);
    }

    const stats = {
      mode: 'segmentation',
      width,
      height,
      maskThreshold,
      colorThreshold,
      anchor,
      personPixels: personPixels.length,
      pixelsA,
      pixelsB,
      bestArm: bestArm ? {
        color: bestArm.color,
        pixelCount: bestArm.pixels.length,
        minY: bestArm.minY,
        maxY: bestArm.maxY,
        anchorY: bestArm.anchorY
      } : null
    };

    return { suggestion, stats, preview, maskPreview };
  } catch (error) {
    console.error('[ColorDetector] Segmentation failed:', error);
    throw error;
  }
};

let imageSegmenterInstance = null;

const getImageSegmenter = async () => {
  if (typeof window === 'undefined') {
    throw new Error('Image segmenter is only available in the browser');
  }
  if (!imageSegmenterInstance) {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );
    imageSegmenterInstance = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MULTICLASS_MODEL_URL,
        delegate: 'GPU'
      },
      outputCategoryMask: true,
      outputConfidenceMasks: false,
      runningMode: 'IMAGE'
    });
  }
  return imageSegmenterInstance;
};

/**
 * Detect arms using Image Segmentation and check for color A/B in each arm
 */
const identifyPlayerByArmSegmentation = async (
  frameDataUrl,
  colorAConfig,
  colorBConfig,
  options = {}
) => {
  if (!frameDataUrl) {
    return { suggestion: 'None', stats: { mode: 'arm-segmentation' } };
  }

  const rgbA = normalizeColorToRGB(colorAConfig);
  const rgbB = normalizeColorToRGB(colorBConfig);
  if (!rgbA || !rgbB) {
    console.warn('[ColorDetector] Invalid color configs, returning None');
    return { suggestion: 'None', stats: { mode: 'arm-segmentation' } };
  }

  try {
    const imageElement = await loadImageElement(frameDataUrl);
    const width = imageElement.naturalWidth || imageElement.width;
    const height = imageElement.naturalHeight || imageElement.height;

    const segmenter = await getImageSegmenter();
    const results = segmenter.segment(imageElement);

    if (!results.categoryMask) {
      return {
        suggestion: 'None',
        stats: {
          mode: 'arm-segmentation',
          width,
          height,
          reason: 'no_segmentation_mask'
        }
      };
    }

    // Get the category mask data
    // MediaPipe returns categoryMask as ImageData or similar format
    let maskData;
    let maskWidth = width;
    let maskHeight = height;
    
    try {
      // MediaPipe returns categoryMask as an object with a canvas property (OffscreenCanvas)
      // We need to read ImageData from that canvas
      if (results.categoryMask && results.categoryMask.canvas) {
        // It has a canvas property - read from it
        const maskCanvas = results.categoryMask.canvas;
        try {
          const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
          if (!maskCtx) {
            throw new Error('Could not get 2d context from canvas');
          }
          const imageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
          maskData = imageData.data;
          maskWidth = maskCanvas.width;
          maskHeight = maskCanvas.height;
          console.log('[ColorDetector] Using canvas property, dimensions:', maskWidth, 'x', maskHeight, 'data length:', maskData.length);
        } catch (ctxErr) {
          // If we can't read from OffscreenCanvas directly, try to transfer it
          console.warn('[ColorDetector] Failed to read from canvas directly, trying transfer:', ctxErr);
          if (maskCanvas.transferToImageBitmap) {
            const bitmap = maskCanvas.transferToImageBitmap();
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = bitmap.width;
            tempCanvas.height = bitmap.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(bitmap, 0, 0);
            const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
            maskData = imageData.data;
            maskWidth = tempCanvas.width;
            maskHeight = tempCanvas.height;
            console.log('[ColorDetector] Using transferred bitmap, dimensions:', maskWidth, 'x', maskHeight);
          } else {
            throw ctxErr;
          }
        }
      } else if (results.categoryMask instanceof ImageData) {
        maskData = results.categoryMask.data;
        maskWidth = results.categoryMask.width;
        maskHeight = results.categoryMask.height;
        console.log('[ColorDetector] Using ImageData format, dimensions:', maskWidth, 'x', maskHeight, 'data length:', maskData.length);
      } else if (results.categoryMask && results.categoryMask.data) {
        // If it has a data property (might be ImageData-like)
        maskData = results.categoryMask.data;
        if (results.categoryMask.width) maskWidth = results.categoryMask.width;
        if (results.categoryMask.height) maskHeight = results.categoryMask.height;
        console.log('[ColorDetector] Using data property, dimensions:', maskWidth, 'x', maskHeight, 'data length:', maskData.length);
      } else if (results.categoryMask instanceof Uint8ClampedArray || 
                 results.categoryMask instanceof Uint8Array) {
        // Direct array
        maskData = results.categoryMask;
        console.log('[ColorDetector] Using direct array, length:', maskData.length);
      } else if (results.categoryMask instanceof HTMLCanvasElement || 
                 results.categoryMask instanceof OffscreenCanvas) {
        // Direct canvas
        const maskCtx = results.categoryMask.getContext('2d');
        const imageData = maskCtx.getImageData(0, 0, results.categoryMask.width, results.categoryMask.height);
        maskData = imageData.data;
        maskWidth = results.categoryMask.width;
        maskHeight = results.categoryMask.height;
        console.log('[ColorDetector] Using direct canvas, dimensions:', maskWidth, 'x', maskHeight, 'data length:', maskData.length);
      } else {
        // Try to create ImageData from the mask
        // MediaPipe might return it as a canvas or need conversion
        console.warn('[ColorDetector] Unexpected categoryMask type:', typeof results.categoryMask, 
          'constructor:', results.categoryMask?.constructor?.name,
          'has canvas:', !!results.categoryMask?.canvas,
          'value:', results.categoryMask);
        throw new Error('Unsupported categoryMask format');
      }
    } catch (err) {
      console.error('[ColorDetector] Error accessing categoryMask:', err);
      return {
        suggestion: 'None',
        stats: {
          mode: 'arm-segmentation',
          width,
          height,
          reason: 'category_mask_access_error',
          error: err.message
        }
      };
    }

    // Get original image data for color checking
    const videoCanvas = document.createElement('canvas');
    videoCanvas.width = width;
    videoCanvas.height = height;
    const videoCtx = videoCanvas.getContext('2d');
    videoCtx.drawImage(imageElement, 0, 0, width, height);
    const videoData = videoCtx.getImageData(0, 0, width, height).data;

    // Categories: 0=background, 1=hair, 2=body-skin, 3=face-skin, 4=clothes, 5=others
    // We'll look for body-skin (2) and clothes (4) as potential arms
    const ARM_CATEGORIES = [2, 4]; // body-skin and clothes

    const {
      anchor = 'bottom',
      colorThreshold = 95,
      minArmPixels = 100
    } = options;

    // Determine if mask is RGBA (4 bytes per pixel) or single channel (1 byte per pixel)
    const maskPixelCount = maskWidth * maskHeight;
    const isRGBA = maskData.length >= maskPixelCount * 4;
    const bytesPerPixel = isRGBA ? 4 : 1;
    
    // Scale factors if mask dimensions differ from image dimensions
    const scaleX = width / maskWidth;
    const scaleY = height / maskHeight;

    // Find arm regions
    const armRegions = [];
    const armPixels = new Map(); // category -> Set of pixel indices

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        // Map image coordinates to mask coordinates
        const maskX = Math.floor(x / scaleX);
        const maskY = Math.floor(y / scaleY);
        const maskIdx = (maskY * maskWidth + maskX) * bytesPerPixel;
        
        if (maskIdx >= 0 && maskIdx < maskData.length) {
          // Category is in the R channel (index 0) for RGBA, or directly for single channel
          const category = maskData[maskIdx];
          if (ARM_CATEGORIES.includes(category)) {
            if (!armPixels.has(category)) {
              armPixels.set(category, new Set());
            }
            armPixels.get(category).add(y * width + x);
          }
        }
      }
    }

    // Analyze each arm category for color matches
    for (const [category, pixelSet] of armPixels.entries()) {
      if (pixelSet.size < minArmPixels) continue;

      // Check colors in this arm region
      let pixelsA = 0;
      let pixelsB = 0;
      let minY = height;
      let maxY = -1;

      const sqThresh = colorThreshold * colorThreshold;

      for (const pixelIdx of pixelSet) {
        const y = Math.floor(pixelIdx / width);
        const x = pixelIdx % width;
        const vidIdx = (y * width + x) * 4;

        const r = videoData[vidIdx];
        const g = videoData[vidIdx + 1];
        const b = videoData[vidIdx + 2];

        const dA = rgbDistanceSq({ r, g, b }, rgbA);
        const dB = rgbDistanceSq({ r, g, b }, rgbB);

        if (dA < sqThresh && dA < dB) {
          pixelsA += 1;
        } else if (dB < sqThresh && dB < dA) {
          pixelsB += 1;
        }

        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      // Determine which color is dominant in this arm
      const totalColored = pixelsA + pixelsB;
      if (totalColored > 0) {
        const dominantColor = pixelsA > pixelsB ? 'A' : 'B';
        const anchorY = anchor === 'top' ? minY : maxY;

        armRegions.push({
          category,
          pixelsA,
          pixelsB,
          totalColored,
          dominantColor,
          minY,
          maxY,
          anchorY,
          pixelCount: pixelSet.size
        });
      }
    }

    if (armRegions.length === 0) {
      return {
        suggestion: 'None',
        stats: {
          mode: 'arm-segmentation',
          width,
          height,
          reason: 'no_arms_with_matching_colors'
        }
      };
    }

    // Find the arm closest to the anchor with a matching color
    let bestArm = null;
    let bestDistance = Infinity;

    for (const arm of armRegions) {
      const distance = anchor === 'top' ? arm.anchorY : height - arm.anchorY;
      if (distance < bestDistance && arm.dominantColor) {
        bestDistance = distance;
        bestArm = arm;
      }
    }

    const suggestion = bestArm?.dominantColor || 'None';

    // Create preview showing only arms
    let preview = null;
    let maskPreview = null;
    try {
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = width;
      previewCanvas.height = height;
      const previewCtx = previewCanvas.getContext('2d');
      
      // Draw original image
      previewCtx.drawImage(imageElement, 0, 0, width, height);
      
      // Apply color mask overlay only on arm regions
      const imageData = previewCtx.getImageData(0, 0, width, height);
      const pixels = imageData.data;
      
      const tintA = { r: 255, g: 82, b: 97 };
      const tintB = { r: 80, g: 170, b: 255 };
      
      for (const [category, pixelSet] of armPixels.entries()) {
        for (const pixelIdx of pixelSet) {
          const y = Math.floor(pixelIdx / width);
          const x = pixelIdx % width;
          const vidIdx = (y * width + x) * 4;
          const idx = vidIdx;

          const r = videoData[vidIdx];
          const g = videoData[vidIdx + 1];
          const b = videoData[vidIdx + 2];

          const dA = rgbDistanceSq({ r, g, b }, rgbA);
          const dB = rgbDistanceSq({ r, g, b }, rgbB);
          const sqThresh = colorThreshold * colorThreshold;

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
      
      previewCtx.putImageData(imageData, 0, 0);
      preview = previewCanvas.toDataURL('image/png');

      // Create mask preview showing only arms (white = arm, black = background)
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = width;
      maskCanvas.height = height;
      const maskCtx = maskCanvas.getContext('2d');
      const maskImageData = maskCtx.createImageData(width, height);
      const maskPixels = maskImageData.data;

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const imgIdx = (y * width + x) * 4;
          // Map image coordinates to mask coordinates
          const maskX = Math.floor(x / scaleX);
          const maskY = Math.floor(y / scaleY);
          const maskIdx = (maskY * maskWidth + maskX) * bytesPerPixel;
          
          let isArm = false;
          if (maskIdx >= 0 && maskIdx < maskData.length) {
            const category = maskData[maskIdx];
            isArm = ARM_CATEGORIES.includes(category);
          }
          
          const value = isArm ? 255 : 0;
          maskPixels[imgIdx] = value;
          maskPixels[imgIdx + 1] = value;
          maskPixels[imgIdx + 2] = value;
          maskPixels[imgIdx + 3] = 255;
        }
      }

      maskCtx.putImageData(maskImageData, 0, 0);
      maskPreview = maskCanvas.toDataURL('image/png');
    } catch (previewError) {
      console.warn('[ColorDetector] Failed generating arm preview', previewError);
    }

    const stats = {
      mode: 'arm-segmentation',
      width,
      height,
      colorThreshold,
      anchor,
      armRegions: armRegions.map(arm => ({
        category: arm.category,
        categoryName: arm.category === 2 ? 'body-skin' : 'clothes',
        pixelsA: arm.pixelsA,
        pixelsB: arm.pixelsB,
        dominantColor: arm.dominantColor,
        minY: arm.minY,
        maxY: arm.maxY,
        anchorY: arm.anchorY,
        pixelCount: arm.pixelCount
      })),
      bestArm: bestArm ? {
        category: bestArm.category,
        categoryName: bestArm.category === 2 ? 'body-skin' : 'clothes',
        dominantColor: bestArm.dominantColor,
        anchorY: bestArm.anchorY
      } : null
    };

    return { suggestion, stats, preview, maskPreview };
  } catch (error) {
    console.error('[ColorDetector] Arm segmentation failed:', error);
    throw error;
  }
};

export {
  identifyPlayerByColor,
  identifyPlayerBySegmentation,
  identifyPlayerByArmSegmentation,
  normalizeColorToRGB
};

