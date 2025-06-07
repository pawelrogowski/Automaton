// /home/orimorfus/Documents/Automaton/frontend/components/LuaScripts/PersistentScriptList.jsx
import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { addScript, togglePersistentScript, removeScript } from '../../redux/slices/luaSlice'; // Import addScript
import { v4 as uuidv4 } from 'uuid'; // Assuming you'll need to add scripts
import StyledList from './ScriptList.styled'; // We will create a styled component for lists

// Assuming window.electron.ipcRenderer is available via preload.js
const { ipcRenderer } = window.electron;

const PersistentScriptList = () => {
  const dispatch = useDispatch();
  const persistentScripts = useSelector((state) => state.lua.persistentScripts);

  // Function for adding persistent script
   const handleAddScript = () => {
       const newScriptDetails = {
           id: uuidv4(), // Generate a unique ID for the script
            name: `New Persistent Script ${persistentScripts.length + 1}`,
            code: '-- Your Lua code here',
            type: 'persistent', // Specify the type
            enabled: false,
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

  return (
    <StyledList>
      <h3>Persistent Scripts</h3>
      <button onClick={handleAddScript}>Add Persistent Script</button>
      <ul>
        {persistentScripts.map((script) => (
          <li key={script.id}>
            <span>{script.name}</span>
            <button onClick={() => handleToggleEnabled(script.id)}>
              {script.enabled ? 'Disable' : 'Enable'}
            </button>
            {/* Update Edit button to call handleEditScript with script.id */}
            <button onClick={() => handleEditScript(script.id)}>Edit</button>
            <button onClick={() => handleRemoveScript(script.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </StyledList>
  );
};

export default PersistentScriptList;