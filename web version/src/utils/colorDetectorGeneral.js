import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
// Import the local model file URL (Vite syntax)
import multiclassModelUrl from './selfie_multiclass_256x256.tflite?url';

// Use the local model if available, otherwise fall back to CDN
const MULTICLASS_MODEL_URL = multiclassModelUrl || 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

// ===== HELPER FUNCTIONS (Copied from colorDetector.js) =====

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

const extractCategoryMaskData = (categoryMask, fallbackWidth, fallbackHeight) => {
    if (!categoryMask) {
        return {
            maskData: null,
            maskWidth: fallbackWidth,
            maskHeight: fallbackHeight,
            isRGBA: false
        };
    }

    let maskData = null;
    let maskWidth = fallbackWidth;
    let maskHeight = fallbackHeight;
    let isRGBA = false;

    try {
        if (typeof categoryMask.getAsUint8Array === 'function') {
            maskData = categoryMask.getAsUint8Array();
            maskWidth = categoryMask.width || fallbackWidth;
            maskHeight = categoryMask.height || fallbackHeight;
            return { maskData, maskWidth, maskHeight, isRGBA: false };
        }

        if (categoryMask instanceof Uint8Array || categoryMask instanceof Uint8ClampedArray) {
            maskData = categoryMask;
            return { maskData, maskWidth, maskHeight, isRGBA: false };
        }

        if (categoryMask.canvas) {
            const canvas = categoryMask.canvas;
            maskWidth = canvas.width;
            maskHeight = canvas.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const imageData = ctx.getImageData(0, 0, maskWidth, maskHeight);
            maskData = imageData.data;
            isRGBA = true;
            return { maskData, maskWidth, maskHeight, isRGBA };
        }

        if (categoryMask instanceof ImageData) {
            maskData = categoryMask.data;
            maskWidth = categoryMask.width || fallbackWidth;
            maskHeight = categoryMask.height || fallbackHeight;
            isRGBA = true;
            return { maskData, maskWidth, maskHeight, isRGBA };
        }

        if (categoryMask.data) {
            maskData = categoryMask.data;
            maskWidth = categoryMask.width || fallbackWidth;
            maskHeight = categoryMask.height || fallbackHeight;
            isRGBA = maskData.length >= maskWidth * maskHeight * 4;
            return { maskData, maskWidth, maskHeight, isRGBA };
        }
    } catch (err) {
        console.warn('[ColorDetectorGeneral] Failed to extract category mask data:', err);
    }

    return {
        maskData: null,
        maskWidth: fallbackWidth,
        maskHeight: fallbackHeight,
        isRGBA: false
    };
};

const euclideanDistance = (a = [], b = []) => {
    return Math.sqrt(a.reduce((sum, val, idx) => sum + Math.pow(val - (b[idx] || 0), 2), 0));
};

const runKMeans = (points = [], k = 2, maxIterations = 25) => {
    if (!Array.isArray(points) || points.length === 0) {
        throw new Error('No points provided for k-means clustering');
    }

    const dimension = points[0].length;
    let centroids = [];

    // Initialize centroids using two farthest points for stability
    const first = points[0];
    let farthestPoint = first;
    let maxDistance = -Infinity;
    for (const point of points) {
        const dist = euclideanDistance(point, first);
        if (dist > maxDistance) {
            maxDistance = dist;
            farthestPoint = point;
        }
    }
    centroids.push(first.slice());
    if (k > 1) {
        centroids.push(farthestPoint.slice());
    }
    while (centroids.length < k) {
        centroids.push(points[Math.floor(Math.random() * points.length)].slice());
    }

    let assignments = new Array(points.length).fill(0);
    let iteration = 0;
    let changed = true;

    while (changed && iteration < maxIterations) {
        changed = false;

        // Assignment step
        for (let i = 0; i < points.length; i++) {
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let c = 0; c < centroids.length; c++) {
                const dist = euclideanDistance(points[i], centroids[c]);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestIdx = c;
                }
            }
            if (assignments[i] !== bestIdx) {
                assignments[i] = bestIdx;
                changed = true;
            }
        }

        // Update centroids
        const sums = Array.from({ length: centroids.length }, () => new Array(dimension).fill(0));
        const counts = new Array(centroids.length).fill(0);

        points.forEach((point, idx) => {
            const cluster = assignments[idx];
            counts[cluster] += 1;
            for (let d = 0; d < dimension; d++) {
                sums[cluster][d] += point[d];
            }
        });

        for (let c = 0; c < centroids.length; c++) {
            if (counts[c] === 0) {
                centroids[c] = points[Math.floor(Math.random() * points.length)].slice();
            } else {
                centroids[c] = sums[c].map((val) => val / counts[c]);
            }
        }

        iteration += 1;
    }

    return { assignments, centroids };
};

const rgbToHue = (r, g, b) => {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return 0;
    let h = 0;
    if (max === r) {
        h = (g - b) / (max - min);
    } else if (max === g) {
        h = 2 + (b - r) / (max - min);
    } else {
        h = 4 + (r - g) / (max - min);
    }
    h *= 60;
    if (h < 0) h += 360;
    return h;
};

const rgbToHex = (r, g, b) => {
    const toHex = (val) => {
        const hex = Math.max(0, Math.min(255, Math.round(val))).toString(16);
        return hex.length === 1 ? `0${hex}` : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
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

// ===== MAIN FUNCTION: identifyPlayersByAllAll =====

/**
 * Identify players by analyzing all pixels (excluding background class 0).
 * If manualBounds is provided, only sample pixels within that Y range.
 * 
 * @param {Array} frames - Array of frame objects: [{ moveId, frameDataUrl, existingPlayer }]
 * @param {Object} options - Configuration options
 * @param {Object} options.manualBounds - Optional { topY, bottomY } to restrict sampling area
 * @param {Number} options.maxFrames - Maximum number of frames to process
 * @param {Number} options.stride - Pixel stride for sampling (default: 2)
 * @param {Number} options.minPixels - Minimum pixels required per frame (default: 80)
 * @returns {Object} - { assignments, clusters, analytics }
 */
const identifyPlayersByAllAll = async (frames = [], options = {}) => {
    if (!Array.isArray(frames) || frames.length === 0) {
        throw new Error('No frames provided for analysis');
    }

    const segmenter = await getImageSegmenter();
    const maxFrames = options.maxFrames || frames.length;
    const stride = options.stride || 2;
    const minPixels = options.minPixels || 80;
    const manualBounds = options.manualBounds || null;

    const framesToProcess = frames.slice(0, maxFrames);
    const results = [];
    let skippedFrames = 0;

    for (const frame of framesToProcess) {
        try {
            const imageElement = await loadImageElement(frame.frameDataUrl);
            const width = imageElement.naturalWidth || imageElement.width;
            const height = imageElement.naturalHeight || imageElement.height;

            const segmentation = segmenter.segment(imageElement);
            const {
                maskData: categoryMaskData,
                maskWidth,
                maskHeight,
                isRGBA: isCategoryMaskRGBA
            } = extractCategoryMaskData(segmentation.categoryMask, width, height);

            if (!categoryMaskData) {
                skippedFrames += 1;
                continue;
            }

            const videoCanvas = document.createElement('canvas');
            videoCanvas.width = width;
            videoCanvas.height = height;
            const videoCtx = videoCanvas.getContext('2d');
            videoCtx.drawImage(imageElement, 0, 0, width, height);
            const videoData = videoCtx.getImageData(0, 0, width, height).data;

            const scaleX = width / maskWidth;
            const scaleY = height / maskHeight;

            // Determine Y range for sampling
            let startY = 0;
            let endY = height;
            if (manualBounds) {
                startY = Math.max(0, manualBounds.topY);
                endY = Math.min(height, manualBounds.bottomY);
            }

            let sumR = 0;
            let sumG = 0;
            let sumB = 0;
            let sumX = 0;
            let sumY = 0;
            let pixelCount = 0;

            // Sample pixels, filtering out background (class 0)
            for (let y = startY; y < endY; y += stride) {
                const maskY = Math.min(maskHeight - 1, Math.floor(y / scaleY));
                for (let x = 0; x < width; x += stride) {
                    const maskX = Math.min(maskWidth - 1, Math.floor(x / scaleX));
                    const maskIdx = (maskY * maskWidth + maskX) * (isCategoryMaskRGBA ? 4 : 1);
                    const category = categoryMaskData[maskIdx];

                    // Filter: exclude background (class 0)
                    if (category !== 0) {
                        const idx = (y * width + x) * 4;
                        const r = videoData[idx];
                        const g = videoData[idx + 1];
                        const b = videoData[idx + 2];
                        sumR += r;
                        sumG += g;
                        sumB += b;
                        sumX += x;
                        sumY += y;
                        pixelCount += 1;
                    }
                }
            }

            if (pixelCount < minPixels) {
                skippedFrames += 1;
                continue;
            }

            const meanColor = {
                r: sumR / pixelCount,
                g: sumG / pixelCount,
                b: sumB / pixelCount
            };

            // Generate debug preview showing what MediaPipe sees (all non-background pixels)
            let debugPreview = null;
            try {
                const debugCanvas = document.createElement('canvas');
                debugCanvas.width = width;
                debugCanvas.height = height;
                const debugCtx = debugCanvas.getContext('2d');

                // Draw original image
                debugCtx.drawImage(imageElement, 0, 0, width, height);

                // Overlay non-background pixels in blue with transparency
                const debugImageData = debugCtx.getImageData(0, 0, width, height);
                const debugPixels = debugImageData.data;

                for (let y = 0; y < height; y += 1) {
                    const maskY = Math.min(maskHeight - 1, Math.floor(y / scaleY));
                    for (let x = 0; x < width; x += 1) {
                        const maskX = Math.min(maskWidth - 1, Math.floor(x / scaleX));
                        const maskIdx = (maskY * maskWidth + maskX) * (isCategoryMaskRGBA ? 4 : 1);
                        const category = categoryMaskData[maskIdx];

                        if (category !== 0) { // Non-background pixels
                            const idx = (y * width + x) * 4;
                            // Blue tint for all non-background
                            debugPixels[idx] = Math.round(debugPixels[idx] * 0.5 + 50); // R
                            debugPixels[idx + 1] = Math.round(debugPixels[idx + 1] * 0.5 + 100); // G
                            debugPixels[idx + 2] = Math.round(debugPixels[idx + 2] * 0.5 + 255 * 0.5); // B
                        }
                    }
                }

                debugCtx.putImageData(debugImageData, 0, 0);

                // If manual bounds, draw the scan area boundaries
                if (manualBounds) {
                    // Dim area outside bounds
                    debugCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                    debugCtx.fillRect(0, 0, width, manualBounds.topY); // Top area
                    debugCtx.fillRect(0, manualBounds.bottomY, width, height - manualBounds.bottomY); // Bottom area

                    // Draw boundary lines
                    debugCtx.strokeStyle = '#00FF00'; // Green = Top
                    debugCtx.lineWidth = 3;
                    debugCtx.setLineDash([]);
                    debugCtx.beginPath();
                    debugCtx.moveTo(0, manualBounds.topY);
                    debugCtx.lineTo(width, manualBounds.topY);
                    debugCtx.stroke();

                    debugCtx.strokeStyle = '#FFFF00'; // Yellow = Bottom
                    debugCtx.lineWidth = 3;
                    debugCtx.setLineDash([5, 5]);
                    debugCtx.beginPath();
                    debugCtx.moveTo(0, manualBounds.bottomY);
                    debugCtx.lineTo(width, manualBounds.bottomY);
                    debugCtx.stroke();

                    // Add label
                    const scanAreaHeight = manualBounds.bottomY - manualBounds.topY;
                    debugCtx.fillStyle = '#00FF00';
                    debugCtx.font = 'bold 16px Arial';
                    debugCtx.fillText(`Manual Scan Area (${scanAreaHeight}px)`, 10, manualBounds.topY - 10);
                }

                // Add info text
                debugCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                debugCtx.fillRect(10, 10, 300, 80);
                debugCtx.fillStyle = '#FFFFFF';
                debugCtx.font = 'bold 14px Arial';
                debugCtx.fillText(`Non-BG Pixels: ${pixelCount}`, 20, 30);
                debugCtx.fillText(`Threshold: ${minPixels}`, 20, 50);
                debugCtx.fillText(`Mean Color: ${rgbToHex(meanColor.r, meanColor.g, meanColor.b)}`, 20, 70);

                debugPreview = debugCanvas.toDataURL('image/png');
            } catch (previewErr) {
                console.warn('[ColorDetectorGeneral] Failed to generate debug preview:', previewErr);
            }

            results.push({
                moveId: frame.moveId,
                meanColor,
                feature: [
                    meanColor.r / 255,
                    meanColor.g / 255,
                    meanColor.b / 255
                ],
                centroidX: (sumX / pixelCount) / width,
                centroidY: (sumY / pixelCount) / height,
                pixelCount,
                existingPlayer: frame.existingPlayer || null,
                debugPreview // Add debug preview to results
            });
        } catch (err) {
            console.warn('[ColorDetectorGeneral] Analysis failed for frame', frame.moveId, err);
            skippedFrames += 1;
        }
    }

    if (results.length < 2) {
        throw new Error('Not enough frames with detectable pixels (need at least 2)');
    }

    const features = results.map((r) => r.feature);
    const { assignments, centroids } = runKMeans(features, Math.min(2, results.length));

    const clusterStats = centroids.map(() => ({
        samples: [],
        sumR: 0,
        sumG: 0,
        sumB: 0,
        sumPixels: 0,
        sumBrightness: 0,
        labelCounts: {
            'Player A': 0,
            'Player B': 0
        }
    }));

    assignments.forEach((clusterIndex, idx) => {
        const result = results[idx];
        const stats = clusterStats[clusterIndex];

        stats.samples.push({
            moveId: result.moveId,
            centroidX: result.centroidX,
            centroidY: result.centroidY,
            pixelCount: result.pixelCount
        });

        stats.sumR += result.meanColor.r;
        stats.sumG += result.meanColor.g;
        stats.sumB += result.meanColor.b;
        stats.sumPixels += result.pixelCount;
        stats.sumBrightness += (result.meanColor.r + result.meanColor.g + result.meanColor.b) / 3;

        if (result.existingPlayer === 'Player A' || result.existingPlayer === 'Player B') {
            stats.labelCounts[result.existingPlayer] += 1;
        }
    });

    const clusterPlayerMap = {};
    clusterStats.forEach((stats, idx) => {
        const a = stats.labelCounts['Player A'];
        const b = stats.labelCounts['Player B'];
        if (a > b) clusterPlayerMap[idx] = 'Player A';
        else if (b > a) clusterPlayerMap[idx] = 'Player B';
    });

    // Assign remaining clusters deterministically by hue order
    const hueOrder = clusterStats
        .map((stats, idx) => {
            const avgR = stats.sumR / Math.max(1, stats.samples.length);
            const avgG = stats.sumG / Math.max(1, stats.samples.length);
            const avgB = stats.sumB / Math.max(1, stats.samples.length);
            return { idx, hue: rgbToHue(avgR, avgG, avgB), brightness: stats.sumBrightness / Math.max(1, stats.samples.length) };
        })
        .sort((a, b) => a.hue - b.hue || a.brightness - b.brightness);

    const playerOrder = ['Player A', 'Player B'];
    hueOrder.forEach(({ idx }) => {
        if (!clusterPlayerMap[idx]) {
            const assignedPlayers = Object.values(clusterPlayerMap);
            const available = playerOrder.find((p) => !assignedPlayers.includes(p)) || 'Player A';
            clusterPlayerMap[idx] = available;
        }
    });

    const assignmentsMap = {};
    assignments.forEach((clusterIndex, idx) => {
        const result = results[idx];
        const player = clusterPlayerMap[clusterIndex] || (clusterIndex === 0 ? 'Player A' : 'Player B');
        const centroid = centroids[clusterIndex];
        const otherCentroid = centroids[clusterIndex === 0 ? 1 : 0];
        const distanceToOwn = euclideanDistance(result.feature, centroid);
        const distanceToOther = otherCentroid ? euclideanDistance(result.feature, otherCentroid) : distanceToOwn;
        const confidence = otherCentroid
            ? Math.max(0, 1 - distanceToOwn / (distanceToOwn + distanceToOther + 1e-6))
            : 1;

        assignmentsMap[result.moveId] = {
            player,
            clusterId: clusterIndex,
            styleLabel: `Style ${clusterIndex + 1}`,
            confidence,
            stats: {
                meanColor: result.meanColor,
                pixelCount: result.pixelCount,
                debugPreview: result.debugPreview // Include debug preview
            }
        };
    });

    const clusterSummaries = clusterStats.map((stats, idx) => {
        const avgR = stats.sumR / Math.max(1, stats.samples.length);
        const avgG = stats.sumG / Math.max(1, stats.samples.length);
        const avgB = stats.sumB / Math.max(1, stats.samples.length);
        const hexColor = rgbToHex(avgR, avgG, avgB);

        return {
            id: idx,
            styleLabel: `Style ${idx + 1}`,
            assignedPlayer: clusterPlayerMap[idx] || (idx === 0 ? 'Player A' : 'Player B'),
            hexColor,
            meanColor: { r: avgR, g: avgG, b: avgB },
            sampleCount: stats.samples.length,
            avgPixels: stats.sumPixels / Math.max(1, stats.samples.length),
            avgBrightness: stats.sumBrightness / Math.max(1, stats.samples.length),
            knownAssignments: stats.labelCounts
        };
    });

    return {
        assignments: assignmentsMap,
        clusters: clusterSummaries,
        analytics: {
            totalFrames: framesToProcess.length,
            usedFrames: results.length,
            skippedFrames,
            clusters: clusterSummaries
        }
    };
};

export { identifyPlayersByAllAll };
