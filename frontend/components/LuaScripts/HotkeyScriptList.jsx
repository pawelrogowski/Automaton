// /home/orimorfus/Documents/Automaton/frontend/components/LuaScripts/HotkeyScriptList.jsx
import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { addScript, removeScript } from '../../redux/slices/luaSlice'; // Import addScript
import { v4 as uuidv4 } from 'uuid'; // Assuming you'll need to add scripts
import StyledList from './ScriptList.styled'; // Reuse the styled component

// Assuming window.electron.ipcRenderer is available via preload.js
const { ipcRenderer } = window.electron;


const HotkeyScriptList = () => {
  const dispatch = useDispatch();
  const hotkeyScripts = useSelector((state) => state.lua.hotkeyScripts);

  // Function for adding hotkey script
   const handleAddScript = () => {
       const newScriptDetails = {
           id: uuidv4(), // Generate a unique ID for the script
            name: `New Hotkey Script ${hotkeyScripts.length + 1}`,
            code: '-- Your Lua code here',
            type: 'hotkey', // Specify the type
            hotkey: null, // User will set this
       };
        // Dispatch the action to add the new script with the generated ID to the Redux store
       dispatch(addScript(newScriptDetails));
        // Note: The ID is generated in the renderer process, and the action is dispatched directly.
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
      <h3>Hotkey Scripts</h3>
       <button onClick={handleAddScript}>Add Hotkey Script</button>
      <ul>
        {hotkeyScripts.map((script) => (
          <li key={script.id}>
            <span>{script.name} ({script.hotkey || 'No hotkey'})</span>
             <button onClick={() => handleEditScript(script.id)}>Edit</button>
             <button onClick={() => handleRemoveScript(script.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </StyledList>
  );
};

export default HotkeyScriptList;