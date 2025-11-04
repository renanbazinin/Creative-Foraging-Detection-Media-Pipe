import cv2
import mediapipe as mp
import numpy as np
import os
import json
import time
from datetime import datetime

"""
Bracelet Detector (Red/Blue only)
- Detects the highest hand in frame using MediaPipe Hands
- Samples a wrist-centered ROI and classifies dominant color as Red, Blue, or None
- Writes logs every second to:
  - player_detector/logs/detector_status.txt  (CSV lines: ISO8601,timestamp,status)
  - player_detector/logs/detector_status.jsonl (JSONL: one JSON object per line)

Controls:
- Press 'q' to quit
- Trackbars allow tuning of saturation/value minima, ROI size and pixel threshold

Notes:
- Only Red and Blue detection are active. Yellow/Purple/Black are commented out by request.
- To use OBS Virtual Camera, ensure it is started in OBS (Tools -> VirtualCam -> Start).
"""

# --- Configuration ---
USE_OBS_CAMERA = False  # Set False to use default camera index 0
LOG_DIR = os.path.join(os.path.dirname(__file__), 'logs')
TXT_LOG = os.path.join(LOG_DIR, 'detector_status.txt')
JSONL_LOG = os.path.join(LOG_DIR, 'detector_status.jsonl')

os.makedirs(LOG_DIR, exist_ok=True)

# --- Setup MediaPipe Hands ---
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(
    static_image_mode=False,
    max_num_hands=2,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)
mp_drawing = mp.solutions.drawing_utils

# --- Camera helpers ---
def find_obs_camera(max_check: int = 5):
    """Scan first N indices to list available cameras (best-effort)."""
    found = []
    for i in range(max_check):
        cap = cv2.VideoCapture(i)
        if cap.isOpened():
            ret, _ = cap.read()
            if ret:
                try:
                    backend = cap.getBackendName()
                except Exception:
                    backend = 'unknown'
                found.append((i, backend))
            cap.release()
        else:
            cap.release()
    return found

if USE_OBS_CAMERA:
    print('Searching for OBS Virtual Camera...')
    cams = find_obs_camera()
    for i, be in cams:
        print(f'Camera {i}: Found (Backend: {be})')
    camera_index = 1  # adjust if needed
    print(f'Attempting to use camera index {camera_index} for OBS...')
else:
    camera_index = 0
    print('Using original camera (index 0)...')

cap = cv2.VideoCapture(camera_index)
if not cap.isOpened():
    print(f'Error: Could not open video stream at index {camera_index}.')
    if USE_OBS_CAMERA:
        print('Make sure OBS Virtual Camera is started (Tools -> VirtualCam -> Start).')
    raise SystemExit(1)

# --- UI: Trackbars ---
cv2.namedWindow('Bracelet Detector', cv2.WINDOW_NORMAL)

def nothing(x):
    pass

_window_initialized = False

def init_window():
    global _window_initialized
    cv2.namedWindow('Bracelet Detector', cv2.WINDOW_NORMAL)
    # Enable only Red/Blue controls
    cv2.createTrackbar('Red Sat Min', 'Bracelet Detector', 120, 255, nothing)
    cv2.createTrackbar('Blue Sat Min', 'Bracelet Detector', 150, 255, nothing)
    # Commented out per request:
    # cv2.createTrackbar('Yellow Sat Min', 'Bracelet Detector', 50, 255, nothing)
    # cv2.createTrackbar('Purple Sat Min', 'Bracelet Detector', 50, 255, nothing)
    # cv2.createTrackbar('Black Max Sat', 'Bracelet Detector', 80, 255, nothing)
    # cv2.createTrackbar('Black Max Val', 'Bracelet Detector', 100, 255, nothing)
    cv2.createTrackbar('Min Value (Bright)', 'Bracelet Detector', 70, 255, nothing)
    cv2.createTrackbar('ROI Size (px)', 'Bracelet Detector', 60, 200, nothing)
    cv2.createTrackbar('Pixel Threshold', 'Bracelet Detector', 200, 5000, nothing)
    cv2.waitKey(1)
    _window_initialized = True

# Ensure window/trackbars exist at startup
init_window()

# --- Logging helpers ---
_last_log_ts = 0.0

def log_status(status: str):
    global _last_log_ts
    now = time.time()
    if now - _last_log_ts < 1.0:
        return  # write at most once per second
    _last_log_ts = now

    ts = datetime.utcnow().isoformat() + 'Z'
    # TXT (CSV-like)
    with open(TXT_LOG, 'a', encoding='utf-8') as f:
        f.write(f'{ts},{status}\n')
    # JSONL
    entry = {'timestamp': ts, 'status': status}
    with open(JSONL_LOG, 'a', encoding='utf-8') as f:
        f.write(json.dumps(entry) + '\n')

# --- Main Loop ---
while cap.isOpened():
    ok, frame = cap.read()
    if not ok:
        continue

    frame = cv2.flip(frame, 1)
    h, w, _ = frame.shape

    # Read sliders (ensure window exists)
    try:
        if cv2.getWindowProperty('Bracelet Detector', cv2.WND_PROP_VISIBLE) < 0:
            raise RuntimeError
    except Exception:
        init_window()
        cv2.imshow('Bracelet Detector', frame)
        cv2.waitKey(1)
    try:
        s_min_red = cv2.getTrackbarPos('Red Sat Min', 'Bracelet Detector')
        s_min_blue = cv2.getTrackbarPos('Blue Sat Min', 'Bracelet Detector')
        v_min_bright = cv2.getTrackbarPos('Min Value (Bright)', 'Bracelet Detector')
        roi_size = max(10, cv2.getTrackbarPos('ROI Size (px)', 'Bracelet Detector'))
        pixel_thresh = cv2.getTrackbarPos('Pixel Threshold', 'Bracelet Detector')
    except cv2.error:
        # If trackbars not ready yet, draw once and retry next frame
        cv2.imshow('Bracelet Detector', frame)
        cv2.waitKey(1)
        continue

    # Define HSV ranges (dynamic)
    # RED has two ranges due to hue wrap-around
    LOWER_RED_1 = np.array([0, s_min_red, v_min_bright])
    UPPER_RED_1 = np.array([10, 255, 255])
    LOWER_RED_2 = np.array([170, s_min_red, v_min_bright])
    UPPER_RED_2 = np.array([180, 255, 255])

    # BLUE range
    LOWER_BLUE = np.array([100, s_min_blue, v_min_bright])
    UPPER_BLUE = np.array([130, 255, 255])

    # Commented colors per request:
    # LOWER_YELLOW/UPPER_YELLOW
    # LOWER_PURPLE/UPPER_PURPLE
    # LOWER_BLACK/UPPER_BLACK

    # Process frame for hands
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = hands.process(rgb)

    status = 'None'

    if results.multi_hand_landmarks:
        # Draw landmarks for all hands
        for hlm in results.multi_hand_landmarks:
            mp_drawing.draw_landmarks(frame, hlm, mp_hands.HAND_CONNECTIONS)

        # Select highest hand (smallest y)
        highest = None
        min_y = h
        for hlm in results.multi_hand_landmarks:
            wrist = hlm.landmark[mp_hands.HandLandmark.WRIST]
            wy = int(wrist.y * h)
            if wy < min_y:
                min_y = wy
                highest = hlm

        if highest is not None:
            wrist = highest.landmark[mp_hands.HandLandmark.WRIST]
            wx = int(wrist.x * w)
            wy = int(wrist.y * h)

            # mark selected wrist
            cv2.circle(frame, (wx, wy), 10, (0, 255, 0), -1)
            cv2.putText(frame, 'SELECTED', (wx - 40, wy - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

            # ROI
            half = roi_size // 2
            x1 = max(0, wx - half)
            y1 = max(0, wy - half)
            x2 = min(w, wx + half)
            y2 = min(h, wy + half)
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)

            roi = frame[y1:y2, x1:x2]
            if roi.size > 0:
                hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
                # masks
                mask_red1 = cv2.inRange(hsv, LOWER_RED_1, UPPER_RED_1)
                mask_red2 = cv2.inRange(hsv, LOWER_RED_2, UPPER_RED_2)
                red_mask = cv2.bitwise_or(mask_red1, mask_red2)
                blue_mask = cv2.inRange(hsv, LOWER_BLUE, UPPER_BLUE)

                red_px = cv2.countNonZero(red_mask)
                blue_px = cv2.countNonZero(blue_mask)

                if red_px > pixel_thresh:
                    status = 'red'
                elif blue_px > pixel_thresh:
                    status = 'blue'
                else:
                    status = 'none'

                # Debug overlay
                cv2.putText(frame, f'Red: {red_px}', (10, 70), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
                cv2.putText(frame, f'Blue: {blue_px}', (10, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 0), 2)
                cv2.putText(frame, f'Threshold: {pixel_thresh}', (10, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

    # Log once per second
    log_status(status)

    # UI summary
    color = (255, 255, 255)
    if status == 'red':
        color = (0, 0, 255)
    elif status == 'blue':
        color = (255, 0, 0)

    hands_count = len(results.multi_hand_landmarks) if results.multi_hand_landmarks else 0
    cv2.putText(frame, f'Hands: {hands_count}', (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    cv2.putText(frame, f'Status: {status}', (10, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2)

    cv2.imshow('Bracelet Detector', frame)
    if cv2.waitKey(5) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
