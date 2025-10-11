import React, { useState, useEffect } from 'react';

// Assuming window.electron.ipcRenderer is available via preload.js
const { ipcRenderer } = window.electron;

const ScriptEditor = ({ scriptData }) => {
  const [scriptCode, setScriptCode] = useState('');
  const [scriptName, setScriptName] = useState('');

  // Update state when scriptData prop changes (i.e., when data is loaded via IPC)
  useEffect(() => {
    if (scriptData) {
      setScriptCode(scriptData.code || '');
      setScriptName(scriptData.name || 'Unnamed Script');
    }
  }, [scriptData]);

  if (!scriptData) {
    return <div>No script data available.</div>;
  }

  // Handle changes in the textarea
  const handleCodeChange = (event) => {
    setScriptCode(event.target.value);
  };

  // Handle changes in the name input
  const handleNameChange = (event) => {
    setScriptName(event.target.value);
  };

  // Function to save the script
  const handleSaveScript = () => {
    console.log(`Saving script ID: ${scriptData.id}`);
    // Send the updated script data back to the main process
    ipcRenderer.send('save-script-content', {
      id: scriptData.id,
      updates: {
        code: scriptCode,
        name: scriptName, // Also send name updates
      },
    });
    // Optional: Provide user feedback (e.g., a saved message)
  };

  return (
    <div className="script-editor-container">
      {' '}
      {/* Add a class for styling */}
      <h2>
        <input
          type="text"
          value={scriptName}
          onChange={handleNameChange}
          className="script-name-input" // Add a class for styling
        />
      </h2>
      <div className="editor-area">
        {' '}
        {/* Wrapper for editor */}
        {/* Placeholder for code editor - using textarea for now */}
        <textarea
          value={scriptCode}
          onChange={handleCodeChange}
          rows="20" // Adjust size as needed
          cols="80" // Adjust size as needed
          className="script-code-editor" // Add a class for styling
        ></textarea>
      </div>
      <button onClick={handleSaveScript} className="save-button">
        Save Script
      </button>{' '}
      {/* Add a class for styling */}
      {/* Display other relevant script data as needed */}
      <p>Script ID: {scriptData.id}</p>
    </div>
  );
};

export default ScriptEditor;
