import React, { useState, useEffect } from 'react';
import './App.css';
import StartDialog from './components/StartDialog';
import GameCanvas from './components/GameCanvas';
import BraceletDetector from './components/BraceletDetector';
import ColorCalibration from './components/ColorCalibration';
import Summary from './components/Summary';
import Tests from './components/Tests';
import Tests2 from './components/Tests2';
import Tests3 from './components/Tests3';
import BraceletDetector2 from './components/BraceletDetector2';
import TopDownPlayerClassifier from './components/TopDownPlayerClassifier';
import TopDownPlayerClassifierV2 from './components/TopDownPlayerClassifierV2';
import { getGameTracker } from './utils/gameTracker';

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

  // Setup secret function to end experience
  useEffect(() => {
    // Expose secEnd function globally
    window.secEnd = () => {
      try {
        // Get game tracker instance
        const tracker = getGameTracker();
        
        // Stop tracking
        tracker.stop();
        
        // Export and download JSON
        const jsonData = tracker.exportToJSON();
        
        // Save to localStorage for Summary component
        localStorage.setItem('lastGameSession', jsonData);
        
        // Download the file
        tracker.downloadJSON();
        
        // Navigate to summary page
        window.location.hash = '#/summary';
        
        console.log('Experience ended. JSON downloaded and saved. Redirecting to summary...');
      } catch (error) {
        console.error('Error ending experience:', error);
        alert('Error ending experience: ' + error.message);
      }
    };
    
    return () => {
      // Cleanup
      if (window.secEnd) {
        delete window.secEnd;
      }
    };
  }, []);

  // Route-aware rendering without early returns to keep hooks order stable
  let body = null;
  if (currentRoute === '#/detector') {
    body = <BraceletDetector />;
  } else if (currentRoute === '#/calibrate') {
    body = <ColorCalibration />;
  } else if (currentRoute === '#/detector2') {
    body = <BraceletDetector2 />;
  } else if (currentRoute === '#/summary') {
    body = <Summary />;
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
        <div style={{ position:'fixed', bottom:8, right:8, display:'flex', flexDirection:'column', gap:4, zIndex:9999 }}>
            <a href="#/detector2" style={{ background:'#222', color:'#fff', padding:'4px 8px', borderRadius:4, fontSize:12, textDecoration:'none' }}>Detector2</a>
           </div>
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
