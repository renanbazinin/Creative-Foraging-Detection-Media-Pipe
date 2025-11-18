import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

let handLandmarkerInstance = null; // For 2 hands
let handLandmarkerInstance1 = null; // For 1 hand fallback
let handLandmarkerPromise = null;
let handLandmarkerPromise1 = null;

const HAND_MODEL_PATH = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_BASE_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm';

const initHandLandmarker = async (numHands = 2) => {
  // Return existing instance if it matches the requested numHands
  if (numHands === 2 && handLandmarkerInstance) {
    return handLandmarkerInstance;
  }
  if (numHands === 1 && handLandmarkerInstance1) {
    return handLandmarkerInstance1;
  }

  // Initialize 2-hand instance
  if (numHands === 2 && !handLandmarkerPromise) {
    handLandmarkerPromise = FilesetResolver.forVisionTasks(WASM_BASE_PATH)
      .then(async (vision) => {
        const instance = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: HAND_MODEL_PATH,
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numHands: 2,
          // LOWER THRESHOLDS: Better to detect and filter later than not detect at all
          minHandDetectionConfidence: 0.2,
          minHandPresenceConfidence: 0.2,
          minTrackingConfidence: 0.2
        });
        handLandmarkerInstance = instance;
        return instance;
      })
      .catch((error) => {
        console.error('[HandLandmarker] Failed to initialize (2 hands):', error);
        handLandmarkerPromise = null;
        throw error;
      });
    return handLandmarkerPromise;
  }

  // Initialize 1-hand instance (fallback)
  if (numHands === 1 && !handLandmarkerPromise1) {
    handLandmarkerPromise1 = FilesetResolver.forVisionTasks(WASM_BASE_PATH)
      .then(async (vision) => {
        const instance = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: HAND_MODEL_PATH,
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.2,
          minHandPresenceConfidence: 0.2,
          minTrackingConfidence: 0.2
        });
        handLandmarkerInstance1 = instance;
        return instance;
      })
      .catch((error) => {
        console.error('[HandLandmarker] Failed to initialize (1 hand):', error);
        handLandmarkerPromise1 = null;
        throw error;
      });
    return handLandmarkerPromise1;
  }

  return numHands === 2 ? handLandmarkerPromise : handLandmarkerPromise1;
};

// Helper: Rotate canvas by angle (in degrees)
const rotateCanvas = (canvas, angleDegrees) => {
  const rotatedCanvas = document.createElement('canvas');
  const width = canvas.width;
  const height = canvas.height;
  
  // For 90° and 270° rotations, swap width/height
  if (angleDegrees === 90 || angleDegrees === 270) {
    rotatedCanvas.width = height;
    rotatedCanvas.height = width;
  } else {
    rotatedCanvas.width = width;
    rotatedCanvas.height = height;
  }
  
  const ctx = rotatedCanvas.getContext('2d');
  const angleRad = (angleDegrees * Math.PI) / 180;
  
  ctx.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
  ctx.rotate(angleRad);
  ctx.drawImage(canvas, -width / 2, -height / 2);
  
  return rotatedCanvas;
};

// Helper: Un-rotate coordinates back to original orientation
const unrotateCoordinates = (normalizedX, normalizedY, angleDegrees, originalWidth, originalHeight) => {
  let x = normalizedX;
  let y = normalizedY;
  
  // Un-rotate based on angle
  // Note: When we rotate the canvas, we're rotating the coordinate system
  // So we need to apply the inverse transformation
  if (angleDegrees === 180) {
    // 180°: x' = 1 - x, y' = 1 - y
    x = 1.0 - x;
    y = 1.0 - y;
  } else if (angleDegrees === 90) {
    // 90° clockwise rotation: (x, y) -> (y, 1-x)
    // To un-rotate: (x_rot, y_rot) -> (1-y_rot, x_rot)
    const tempX = x;
    x = 1.0 - y;
    y = tempX;
  } else if (angleDegrees === 270) {
    // 270° clockwise (or -90°): (x, y) -> (1-y, x)
    // To un-rotate: (x_rot, y_rot) -> (y_rot, 1-x_rot)
    const tempX = x;
    x = y;
    y = 1.0 - tempX;
  }
  // 0°: no change needed
  
  return {
    x: x * originalWidth,
    y: y * originalHeight
  };
};

// Helper: Calculate distance between two hand detections (using wrist position)
const handDistance = (hand1, hand2) => {
  const dx = hand1.wrist.x - hand2.wrist.x;
  const dy = hand1.wrist.y - hand2.wrist.y;
  return Math.sqrt(dx * dx + dy * dy);
};

// Helper: Deduplicate hands - merge detections that are likely the same hand
const deduplicateHands = (allHands, thresholdPixels = 50) => {
  if (allHands.length === 0) return [];
  
  const merged = [];
  const used = new Set();
  
  for (let i = 0; i < allHands.length; i++) {
    if (used.has(i)) continue;
    
    const currentHand = allHands[i];
    const group = [currentHand];
    used.add(i);
    
    // Find all hands close to this one
    for (let j = i + 1; j < allHands.length; j++) {
      if (used.has(j)) continue;
      
      const otherHand = allHands[j];
      const distance = handDistance(currentHand, otherHand);
      
      if (distance < thresholdPixels) {
        group.push(otherHand);
        used.add(j);
      }
    }
    
    // Keep the hand with highest confidence from this group
    group.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    merged.push(group[0]);
  }
  
  return merged;
};

// Helper: Fix handedness label based on rotation angle
const fixHandedness = (detectedLabel, angleDegrees) => {
  if (!detectedLabel) return detectedLabel;
  
  // For 180° rotation, Left becomes Right and vice versa
  if (angleDegrees === 180) {
    return detectedLabel === 'Left' ? 'Right' : (detectedLabel === 'Right' ? 'Left' : detectedLabel);
  }
  
  // For 90° and 270°, handedness might also flip depending on perspective
  // For now, we'll keep it as-is for these angles, but you can adjust if needed
  return detectedLabel;
};

export const detectHandLandmarks = async (canvas, options = {}) => {
  try {
    console.log('[HandLandmarker] detectHandLandmarks called');
    
    // Try with 2 hands first
    let landmarker = await initHandLandmarker(2);
    if (!landmarker) {
      console.error('[HandLandmarker] Failed to initialize landmarker');
      return { found: false, reason: 'not_initialized' };
    }
    
    console.log('[HandLandmarker] Landmarker initialized successfully');

    const timestamp = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const originalWidth = canvas.width;
    const originalHeight = canvas.height;
    
    // --- MULTI-ANGLE SCAN: Prioritize most likely orientations ---
    // Start with 0° and 180° (most common), add 90°/270° if needed
    const scanAngles = [0, 180]; // Normal and upside-down (most critical)
    const allDetections = [];
    
    console.log('[HandLandmarker] Starting multi-angle scan...');
    
    for (const angle of scanAngles) {
      try {
        console.log(`[HandLandmarker] Scanning at ${angle}°...`);
        
        // Rotate canvas for this angle
        const rotatedCanvas = rotateCanvas(canvas, angle);
        
        // Detect on rotated image
        let result = landmarker.detectForVideo(rotatedCanvas, timestamp);
        console.log(`[HandLandmarker] ${angle}° scan with 2-hand mode found ${result?.landmarks?.length || 0} hands`);
        
        // If we got 0 hands with 2-hand mode, try with 1 hand as fallback
        if (!result?.landmarks || result.landmarks.length === 0) {
          console.log(`[HandLandmarker] Trying 1-hand fallback for ${angle}°...`);
          const fallbackLandmarker = await initHandLandmarker(1);
          if (fallbackLandmarker) {
            result = fallbackLandmarker.detectForVideo(rotatedCanvas, timestamp);
            console.log(`[HandLandmarker] ${angle}° scan with 1-hand mode found ${result?.landmarks?.length || 0} hands`);
          }
        }
        
        if (result?.landmarks?.length > 0) {
          // Process all detected hands from this angle
          const hands = result.landmarks.map((hand, index) => {
            const handednessEntry = result.handedness?.[index]?.[0];
            
            // Un-rotate coordinates back to original orientation
            const rawWrist = hand[0];
            const rawTip = hand[8];
            const fixedWrist = unrotateCoordinates(
              rawWrist.x,
              rawWrist.y,
              angle,
              originalWidth,
              originalHeight
            );
            const fixedTip = unrotateCoordinates(
              rawTip.x,
              rawTip.y,
              angle,
              originalWidth,
              originalHeight
            );
            
            // Fix handedness label based on rotation
            const realLabel = fixHandedness(handednessEntry?.categoryName, angle);
            
            return {
              wrist: fixedWrist,
              tip: fixedTip,
              confidence: handednessEntry?.score || 0,
              handedness: realLabel,
              scanAngle: angle, // Track which angle detected this
              allLandmarks: hand.map(pt => {
                const unrotated = unrotateCoordinates(pt.x, pt.y, angle, originalWidth, originalHeight);
                return {
                  x: unrotated.x / originalWidth,
                  y: unrotated.y / originalHeight,
                  z: pt.z
                };
              })
            };
          });
          
          allDetections.push(...hands);
        }
      } catch (angleError) {
        console.warn(`[HandLandmarker] Error scanning at angle ${angle}°:`, angleError);
        // Continue with other angles
      }
    }
    
    console.log(`[HandLandmarker] Total detections across all angles: ${allDetections.length}`);
    
    // --- MERGE & DEDUPLICATE: Combine results from all angles ---
    if (allDetections.length === 0) {
      console.log('[HandLandmarker] No hands detected at any angle');
      return { found: false, reason: 'no_hand_detected' };
    }
    
    // Deduplicate: merge detections that are likely the same hand
    const mergedHands = deduplicateHands(allDetections, 50); // 50px threshold
    console.log(`[HandLandmarker] After deduplication: ${mergedHands.length} unique hands`);
    
    if (mergedHands.length === 0) {
      return { found: false, reason: 'no_hand_detected_after_merge' };
    }
    
    // Sort by confidence (highest first) for consistent ordering
    mergedHands.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    
    console.log('[HandLandmarker] Best hand confidence:', mergedHands[0].confidence);
    console.log('[HandLandmarker] Successfully detected hands:', mergedHands.map((h, i) => 
      `Hand ${i+1}: ${h.handedness || 'Unknown'} (${((h.confidence || 0) * 100).toFixed(1)}%)`
    ).join(', '));
    
    return {
      found: true,
      hands: mergedHands,
      handCount: mergedHands.length,
      // For backward compatibility, also include first hand at top level
      wrist: mergedHands[0].wrist,
      tip: mergedHands[0].tip,
      confidence: mergedHands[0].confidence,
      handedness: mergedHands[0].handedness,
      raw: { mergedFrom: scanAngles.length, totalDetections: allDetections.length }
    };
  } catch (error) {
    console.error('[HandLandmarker] Detection error:', error);
    return { found: false, reason: 'detection_error', error: error?.message };
  }
};

export const hasHandLandmarker = () => !!(handLandmarkerInstance || handLandmarkerInstance1);
