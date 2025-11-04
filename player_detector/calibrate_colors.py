import cv2
import json
import os
from datetime import datetime
import numpy as np

"""
Calibration tool for Player A / Player B colors
- Opens the default camera (index 0)
- Shows a center ROI square; computes average HSV of that area each frame
- Press 'a' to save current average HSV as Player A
- Press 'b' to save current average HSV as Player B
- Press 'c' to clear both A and B from memory (does not delete file until saved)
- Press 's' to save current A/B to calibration.json
- Press 'q' or ESC to quit (auto-saves if both A and B exist and unsaved changes present)

Output file: calibration.json in the same folder as this script
Format: {
  "playerA": {"h": float, "s": float, "v": float},
  "playerB": {"h": float, "s": float, "v": float},
  "lastUpdated": "ISO8601Z"
}
Notes:
- HSV is OpenCV format (H 0..179, S 0..255, V 0..255)
- This tool does not require MediaPipe.
"""

HERE = os.path.dirname(__file__)
CALIB_PATH = os.path.join(HERE, 'calibration.json')
WINDOW = 'Calibration'
ROI_SIZE = 100  # px square


def load_existing():
    try:
        with open(CALIB_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        a = data.get('playerA')
        b = data.get('playerB')
        return a, b
    except Exception:
        return None, None


def save_to_file(a, b):
    data = {
        'playerA': a,
        'playerB': b,
        'lastUpdated': datetime.utcnow().isoformat() + 'Z'
    }
    tmp = CALIB_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, CALIB_PATH)


def main():
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print('Error: Could not open camera index 0')
        return 1

    a, b = load_existing()
    dirty = False

    cv2.namedWindow(WINDOW, cv2.WINDOW_NORMAL)

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                continue
            frame = cv2.flip(frame, 1)
            h, w, _ = frame.shape

            # Center ROI
            half = ROI_SIZE // 2
            cx, cy = w // 2, h // 2
            x1, y1 = max(0, cx - half), max(0, cy - half)
            x2, y2 = min(w, cx + half), min(h, cy + half)
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 255), 2)

            roi = frame[y1:y2, x1:x2]
            avg_h, avg_s, avg_v = 0.0, 0.0, 0.0
            if roi.size > 0:
                hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
                # Compute average HSV
                # Flatten for speed
                H = hsv[:, :, 0].astype(np.float32)
                S = hsv[:, :, 1].astype(np.float32)
                V = hsv[:, :, 2].astype(np.float32)
                avg_h = float(np.mean(H))
                avg_s = float(np.mean(S))
                avg_v = float(np.mean(V))

            # UI text
            line_y = 24
            def put(txt, color=(255, 255, 255)):
                nonlocal line_y
                cv2.putText(frame, txt, (10, line_y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
                line_y += 28

            put('Calibration tool:', (0, 255, 255))
            put(f'Current ROI avg HSV: h{avg_h:.0f} s{avg_s:.0f} v{avg_v:.0f}')
            put("Press 'a' to save as Player A, 'b' for Player B")
            put("Press 's' to save JSON, 'c' to clear, 'q' to quit")
            put(f'A: {"set" if a else "—"}   B: {"set" if b else "—"}')
            if dirty:
                put('Unsaved changes', (0, 165, 255))

            cv2.imshow(WINDOW, frame)
            key = cv2.waitKey(5) & 0xFF
            if key in (27, ord('q')):  # ESC or q
                # autosave if both present and dirty
                if dirty and a and b:
                    save_to_file(a, b)
                    print(f'Saved to {CALIB_PATH}')
                break
            elif key == ord('a'):
                a = {'h': avg_h, 's': avg_s, 'v': avg_v}
                dirty = True
            elif key == ord('b'):
                b = {'h': avg_h, 's': avg_s, 'v': avg_v}
                dirty = True
            elif key == ord('s'):
                if a and b:
                    save_to_file(a, b)
                    print(f'Saved to {CALIB_PATH}')
                    dirty = False
                else:
                    print('Need both A and B to save.')
            elif key == ord('c'):
                a, b = None, None
                dirty = True
    finally:
        cap.release()
        cv2.destroyAllWindows()

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
