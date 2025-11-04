# Creative Foraging Detection with MediaPipe

A creative block arrangement game with real-time hand tracking and bracelet color detection using MediaPipe.

## 🎮 Project Overview

This project includes both a Python/PsychoPy version and a web-based React version of the Creative Foraging game, with integrated hand tracking and bracelet color detection capabilities.

### Features

- **Creative Block Game**: Arrange 10 blocks to create interesting figures
- **Gallery System**: Save your creations to a gallery
- **Hand Tracking**: Real-time hand detection using MediaPipe Hands
- **Bracelet Color Detection**: Detects red and blue colored bracelets
- **Data Logging**: Comprehensive CSV logging of all interactions and detections
- **Dual Implementation**: 
  - Python version using PsychoPy
  - Web version using React + Vite

## 📁 Project Structure

```
CreativeForaging/
├── CreativeForaging_Source.py    # Original PsychoPy implementation
├── ppc3.py                        # CSV logging utilities
├── player_detector/               # Hand tracking prototype (Python)
│   └── bracelet_detector.py
└── web version/                   # React web implementation
    ├── src/
    │   ├── components/
    │   │   ├── StartDialog.jsx
    │   │   ├── GameCanvas.jsx
    │   │   └── BraceletDetector.jsx
    │   ├── utils/
    │   │   ├── gameLogic.js
    │   │   └── csvLogger.js
    │   └── App.jsx
    └── public/
        └── detector.html          # Standalone detector window
```

## 🚀 Getting Started

### Python Version

1. **Create virtual environment:**
   ```powershell
   py -3.10 -m venv .venv
   .venv\Scripts\activate
   ```

2. **Install dependencies:**
   ```powershell
   pip install psychopy pandas numpy scipy matplotlib mediapipe opencv-python
   ```

3. **Run the game:**
   ```powershell
   python CreativeForaging_Source.py
   ```

### Web Version

1. **Navigate to web version:**
   ```powershell
   cd "web version"
   ```

2. **Install dependencies:**
   ```powershell
   npm install
   ```

3. **Run development server:**
   ```powershell
   npm run dev
   ```

4. **Build for production:**
   ```powershell
   npm run build
   ```

## 🎯 Web Version Features

### Configuration

Edit `src/App.jsx` to configure:
- `ENABLE_DETECTOR = true/false` - Enable/disable bracelet detector
- `DETECTOR_IN_NEW_WINDOW = true/false` - Show detector in separate window

### Game Controls

- **Mouse**: Drag and drop blocks (blue blocks are movable in practice mode)
- **Gallery Click**: Save current configuration to gallery
- **'P' Key**: Switch from practice to experiment mode
- **'Q' Key**: End experiment and download CSV

### Bracelet Detector

- Opens in a separate browser window
- Detects **Red** and **Blue** colored bracelets
- Logs detections every 1 second to localStorage
- Download logs as JSON or TXT format
- Adjust color thresholds in `src/components/BraceletDetector.jsx`

## 📊 Data Collection

Both versions generate CSV files with:
- Participant ID and condition
- Timestamps and elapsed time
- Block positions for each interaction
- Gallery saves with normalized coordinates
- Practice vs. experiment phase tracking

## 🛠️ Technologies

**Python Version:**
- PsychoPy 2025.2.1
- Python 3.10
- OpenCV
- MediaPipe

**Web Version:**
- React 18
- Vite 5
- MediaPipe Hands (Web)
- HTML5 Canvas API
- localStorage API

## 📝 License

This project is for research purposes.

## 👥 Contributors

Research project developed for creative cognition studies.

## 🌐 Live Demo

Visit the [GitHub Pages deployment](https://renanbazinin.github.io/Creative-Foraging-Detection-Media-Pipe/) to try the web version.
