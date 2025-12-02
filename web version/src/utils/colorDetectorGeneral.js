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

const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
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
            outputCategoryMask: false,
            outputConfidenceMasks: true,
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
 * @param {Object} options.playerColors - Optional { 'Player A': hex, 'Player B': hex } for calibration matching
 * @returns {Object} - { assignments, clusters, analytics }
 */
const identifyPlayersByAllAll = async (frames = [], options = {}) => {
    if (!Array.isArray(frames) || frames.length === 0) {
        throw new Error('No frames provided for analysis');
    }

    const segmenter = await getImageSegmenter();
    const maxFrames = options.maxFrames || frames.length;
    const stride = options.stride || 2;
    //const minPixels = options.minPixels || 80;
    const minPixels = options.minPixels || 5;
    const manualBounds = options.manualBounds || null;
    const playerColors = options.playerColors || null;

    // NEW: Sensitivity Threshold
    // 0.5 = Standard
    // 0.8 = Very Sensitive (Includes pixels even if model thinks they are likely background)
    // 0.95 = Extremely Sensitive (Almost everything except pure green screen is included)
    const backgroundThreshold = options.sensitivity || 0.8;

    const framesToProcess = frames.slice(0, maxFrames);
    const results = [];
    let skippedFrames = 0;

    for (const frame of framesToProcess) {
        try {
            const imageElement = await loadImageElement(frame.frameDataUrl);
            const width = imageElement.naturalWidth || imageElement.width;
            const height = imageElement.naturalHeight || imageElement.height;

            const segmentation = segmenter.segment(imageElement);

            // --- NEW: Handle Confidence Masks ---
            // Index 0 is always Background in this model
            const bgMaskFloatArray = segmentation.confidenceMasks[0].getAsFloat32Array();

            // Confidence masks are usually the size of the model output (e.g., 256x256)
            // We need to know the mask dimensions to map them to the image
            const maskWidth = segmentation.confidenceMasks[0].width;
            const maskHeight = segmentation.confidenceMasks[0].height;
            // ------------------------------------

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
            let rotation = 0;
            let cosRot = 1;
            let sinRot = 0;
            let cx = width / 2;
            let cy = height / 2;

            if (manualBounds) {
                rotation = manualBounds.rotation || 0;
                if (rotation !== 0) {
                    const rad = (-rotation * Math.PI) / 180;
                    cosRot = Math.cos(rad);
                    sinRot = Math.sin(rad);
                    // Scan whole image if rotated (optimization possible but keeping it simple for now)
                    startY = 0;
                    endY = height;
                } else {
                    startY = Math.max(0, manualBounds.topY);
                    endY = Math.min(height, manualBounds.bottomY);
                }
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

                    // Check bounds with rotation
                    if (manualBounds && rotation !== 0) {
                        const dx = x - cx;
                        const dy = y - cy;
                        const ry = dx * sinRot + dy * cosRot + cy;

                        if (ry < manualBounds.topY || ry > manualBounds.bottomY) {
                            continue;
                        }
                    }

                    const maskX = Math.min(maskWidth - 1, Math.floor(x / scaleX));

                    // --- NEW: Check Probability instead of Class Index ---
                    const maskIdx = maskY * maskWidth + maskX;
                    const bgConfidence = bgMaskFloatArray[maskIdx];

                    // If the model's confidence that this is background is LOWER 
                    // than our threshold, we consider it a Player/Foreground.
                    if (bgConfidence < backgroundThreshold) {
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
                        const maskIdx = maskY * maskWidth + maskX;

                        // Check confidence for visual debug
                        const bgConfidence = bgMaskFloatArray[maskIdx];

                        if (bgConfidence < backgroundThreshold) {
                            const idx = (y * width + x) * 4;
                            // Red tint to show what we captured
                            debugPixels[idx] = Math.min(255, debugPixels[idx] + 50);
                            debugPixels[idx + 1] = Math.max(0, debugPixels[idx + 1] - 20);
                            debugPixels[idx + 2] = Math.max(0, debugPixels[idx + 2] - 20);
                        }
                    }
                }

                debugCtx.putImageData(debugImageData, 0, 0);

                // If manual bounds, draw the scan area boundaries
                if (manualBounds) {
                    debugCtx.save();
                    if (rotation !== 0) {
                        debugCtx.translate(cx, cy);
                        debugCtx.rotate((rotation * Math.PI) / 180);
                        debugCtx.translate(-cx, -cy);
                    }

                    // Dim area outside bounds (approximate for rotation or just draw lines)
                    // For rotation, filling the outside is harder, let's just draw the box and lines

                    // Draw boundary lines
                    debugCtx.strokeStyle = '#00FF00'; // Green = Top
                    debugCtx.lineWidth = 3;
                    debugCtx.setLineDash([]);
                    debugCtx.beginPath();
                    debugCtx.moveTo(-width, manualBounds.topY);
                    debugCtx.lineTo(width * 2, manualBounds.topY);
                    debugCtx.stroke();

                    debugCtx.strokeStyle = '#FFFF00'; // Yellow = Bottom
                    debugCtx.lineWidth = 3;
                    debugCtx.setLineDash([5, 5]);
                    debugCtx.beginPath();
                    debugCtx.moveTo(-width, manualBounds.bottomY);
                    debugCtx.lineTo(width * 2, manualBounds.bottomY);
                    debugCtx.stroke();

                    // Draw scan area highlight
                    debugCtx.fillStyle = 'rgba(0, 255, 0, 0.2)';
                    debugCtx.fillRect(-width, manualBounds.topY, width * 3, manualBounds.bottomY - manualBounds.topY);

                    // Add label
                    const scanAreaHeight = manualBounds.bottomY - manualBounds.topY;
                    debugCtx.fillStyle = '#00FF00';
                    debugCtx.font = 'bold 16px Arial';
                    debugCtx.fillText(`Manual Scan Area (${scanAreaHeight}px)`, 10, manualBounds.topY - 10);

                    debugCtx.restore();
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

    // STRATEGY 1: Use provided player colors (Calibration)
    if (playerColors && playerColors['Player A'] && playerColors['Player B']) {
        const colorA = hexToRgb(playerColors['Player A']);
        const colorB = hexToRgb(playerColors['Player B']);

        if (colorA && colorB) {
            // Calculate distances for each cluster to each player color
            const costs = clusterStats.map((stats, idx) => {
                const avgR = stats.sumR / Math.max(1, stats.samples.length);
                const avgG = stats.sumG / Math.max(1, stats.samples.length);
                const avgB = stats.sumB / Math.max(1, stats.samples.length);
                const clusterColor = [avgR, avgG, avgB];

                return {
                    idx,
                    distA: euclideanDistance(clusterColor, [colorA.r, colorA.g, colorA.b]),
                    distB: euclideanDistance(clusterColor, [colorB.r, colorB.g, colorB.b])
                };
            });

            // If we have 2 clusters, assign optimally
            if (costs.length === 2) {
                const c1 = costs[0];
                const c2 = costs[1];

                // Option 1: C1 is A, C2 is B
                const totalDist1 = c1.distA + c2.distB;
                // Option 2: C1 is B, C2 is A
                const totalDist2 = c1.distB + c2.distA;

                if (totalDist1 < totalDist2) {
                    clusterPlayerMap[c1.idx] = 'Player A';
                    clusterPlayerMap[c2.idx] = 'Player B';
                } else {
                    clusterPlayerMap[c1.idx] = 'Player B';
                    clusterPlayerMap[c2.idx] = 'Player A';
                }
            } else {
                // If more or less than 2, just assign each to closest
                costs.forEach(c => {
                    if (c.distA < c.distB) {
                        clusterPlayerMap[c.idx] = 'Player A';
                    } else {
                        clusterPlayerMap[c.idx] = 'Player B';
                    }
                });
            }
        }
    }

    // STRATEGY 2: Use existing labels (Majority Vote)
    // Only fill in if not already assigned by Strategy 1
    clusterStats.forEach((stats, idx) => {
        if (clusterPlayerMap[idx]) return;

        const a = stats.labelCounts['Player A'];
        const b = stats.labelCounts['Player B'];
        if (a > b) clusterPlayerMap[idx] = 'Player A';
        else if (b > a) clusterPlayerMap[idx] = 'Player B';
    });

    // STRATEGY 3: Hue/Brightness Sort (Fallback)
    // Assign remaining clusters deterministically
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

        // Calculate cluster mean color for consistent styling
        const clusterStat = clusterStats[clusterIndex];
        const avgR = clusterStat.sumR / Math.max(1, clusterStat.samples.length);
        const avgG = clusterStat.sumG / Math.max(1, clusterStat.samples.length);
        const avgB = clusterStat.sumB / Math.max(1, clusterStat.samples.length);

        assignmentsMap[result.moveId] = {
            player,
            clusterId: clusterIndex,
            styleLabel: `Style ${clusterIndex + 1}`,
            confidence,
            stats: {
                // Use the CLUSTER'S mean color, not the individual frame's mean color
                meanColor: { r: avgR, g: avgG, b: avgB },
                pixelCount: result.pixelCount,
                debugPreview: result.debugPreview
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
