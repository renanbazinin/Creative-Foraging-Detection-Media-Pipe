import React, { useState, useEffect } from 'react';
import './App.css';
import StartDialog from './components/StartDialog';
import GameCanvas from './components/GameCanvas';
import BraceletDetector from './components/BraceletDetector';
import ColorCalibration from './components/ColorCalibration';
import Tests from './components/Tests';

// ===== CONFIGURATION =====
const ENABLE_DETECTOR = true; // Set to false to disable bracelet detector
const DETECTOR_IN_NEW_WINDOW = false; // Show detector inline (no popup)
// ===== END CONFIGURATION =====

function App() {
  const [gameStarted, setGameStarted] = useState(false);
  const [gameConfig, setGameConfig] = useState(null);
  const [detectorWindow, setDetectorWindow] = useState(null);
  const [currentRoute, setCurrentRoute] = useState(window.location.hash);

  // Listen for hash changes
  useEffect(() => {
    const handleHashChange = () => {
      setCurrentRoute(window.location.hash);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleStartGame = (config) => {
    setGameConfig(config);
    setGameStarted(true);

    // Open detector in new window if enabled
    if (ENABLE_DETECTOR && DETECTOR_IN_NEW_WINDOW) {
      openDetectorWindow();
    }
  };

  const openDetectorWindow = () => {
    // Close existing detector window if any
    if (detectorWindow && !detectorWindow.closed) {
      detectorWindow.close();
    }

    // Use hash routing - works on any domain
    const detectorUrl = window.location.origin + window.location.pathname + '#/detector';

    // Open new popup window
    const popup = window.open(
      detectorUrl,
      'BraceletDetector',
      'width=700,height=600,left=100,top=100'
    );

    setDetectorWindow(popup);
  };

  useEffect(() => {
    // Cleanup: close detector window when main window closes
    return () => {
      if (detectorWindow && !detectorWindow.closed) {
        detectorWindow.close();
      }
    };
  }, [detectorWindow]);

  // Route-aware rendering without early returns to keep hooks order stable
  let body = null;
  if (currentRoute === '#/detector') {
    body = <BraceletDetector />;
  } else if (currentRoute === '#/calibrate') {
    body = <ColorCalibration />;
  } else if (currentRoute === '#/tests') {
    body = <Tests />;
  } else {
    body = (!gameStarted ? (
      <StartDialog onStart={handleStartGame} />
    ) : (
      <>
        <GameCanvas config={gameConfig} />
        {ENABLE_DETECTOR && !DETECTOR_IN_NEW_WINDOW && <BraceletDetector />}
        {ENABLE_DETECTOR && DETECTOR_IN_NEW_WINDOW && gameStarted && (
          <button className="reopen-detector-btn" onClick={openDetectorWindow}>
            Open Detector Window
          </button>
        )}
      </>
    ));
  }

  return (
    <div className="App">
      {body}
    </div>
  );
}

export default App;
