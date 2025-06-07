import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import ScriptEditor from './components/ScriptEditor/ScriptEditor';

// Assuming window.electron.ipcRenderer is available via preload.js
const { ipcRenderer } = window.electron;

const App = () => {
  const [scriptData, setScriptData] = useState(null);

  useEffect(() => {
    // Listen for the 'load-script-data' event from the main process
    ipcRenderer.on('load-script-data', (event, data) => {
      console.log('Received script data:', data);
      setScriptData(data);
    });

    // Clean up the listener when the component unmounts
    return () => {
      ipcRenderer.removeAllListeners('load-script-data');
    };
  }, []); // Empty dependency array means this effect runs once on mount

  if (!scriptData) {
    return <div>Loading script...</div>;
  }

  return <ScriptEditor scriptData={scriptData} />;
};

const container = document.getElementById('script-editor-root');
const root = ReactDOM.createRoot(container);
root.render(<App />);
