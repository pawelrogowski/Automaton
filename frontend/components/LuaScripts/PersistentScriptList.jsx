// /home/orimorfus/Documents/Automaton/frontend/components/LuaScripts/PersistentScriptList.jsx
import React, { useState } from 'react'; // Import useState
import { useSelector, useDispatch } from 'react-redux';
import { addScript, togglePersistentScript, removeScript, clearScriptLog } from '../../redux/slices/luaSlice';
import { v4 as uuidv4 } from 'uuid';
import StyledList from './ScriptList.styled';

// Assuming window.electron.ipcRenderer is available via preload.js
const { ipcRenderer } = window.electron;

const PersistentScriptList = () => {
  const dispatch = useDispatch();
  const persistentScripts = useSelector((state) => state.lua.persistentScripts);
  const [expandedLogId, setExpandedLogId] = useState(null); // State to track which script's log is expanded

  // Function for adding persistent script
   const handleAddScript = () => {
       const newScriptDetails = {
           id: uuidv4(), // Generate a unique ID for the script
            name: `New Persistent Script ${persistentScripts.length + 1}`,
            code: '-- Your Lua code here',
            type: 'persistent', // Specify the type
            enabled: false,
            loopMin: 1000, // Default values for loop interval
            loopMax: 5000, // Default values for loop interval
            log: [], // Initialize log array for script output/errors
       };
       // Dispatch the action to add the new script with the generated ID to the Redux store
       dispatch(addScript(newScriptDetails));
       // Note: The ID is generated in the renderer process, and the action is dispatched directly.
   };

  const handleToggleEnabled = (id) => {
    dispatch(togglePersistentScript(id));
  };

   const handleRemoveScript = (id) => {
       // Dispatch an action to remove the script
       dispatch(removeScript(id));
   };

   // Function to request opening a new editor window for the script
   const handleEditScript = (scriptId) => {
       console.log(`Requesting edit window for script ID: ${scriptId}`);
       // Send a message to the main process to open the editor window
       ipcRenderer.send('open-script-editor', scriptId);
   };

   // Toggle log visibility for a script
    const handleToggleLog = (scriptId) => {
        setExpandedLogId(expandedLogId === scriptId ? null : scriptId);
    };

    // Clear log for a script
    const handleClearLog = (scriptId) => {
        dispatch(clearScriptLog(scriptId));
    };

  return (
    <StyledList>
      <button onClick={handleAddScript}>New Script</button>
      <ul>
        {persistentScripts.map((script) => (
          <li key={script.id}>
            <div> {/* Wrapper div for name and buttons */}
                <span>
                    {script.name}
                </span>
                <button onClick={() => handleToggleEnabled(script.id)}>
                  {script.enabled ? 'Disable' : 'Enable'}
                </button>
                {/* Update Edit button to call handleEditScript with script.id */}
                <button onClick={() => handleEditScript(script.id)}>Edit</button>
                 <button onClick={() => handleToggleLog(script.id)}>
                    {expandedLogId === script.id ? 'Hide Log' : 'View Log'} ({script.log ? script.log.length : 0}) {/* Show log count, handle case where log might be undefined */}
                </button>
                 <button onClick={() => handleClearLog(script.id)}>Clear Log</button>
                <button onClick={() => handleRemoveScript(script.id)}>Remove</button>
            </div>
             {/* Log display area */}
            {expandedLogId === script.id && script.log && (
                <pre className="script-log-display"> {/* Add a class for styling */}
                    {script.log.join('\n')}
                </pre>
            )}
          </li>
        ))}
      </ul>
    </StyledList>
  );
};

export default PersistentScriptList;