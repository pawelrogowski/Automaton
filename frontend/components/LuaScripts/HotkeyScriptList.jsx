// /home/orimorfus/Documents/Automaton/frontend/components/LuaScripts/HotkeyScriptList.jsx
import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { removeScript } from '../../redux/slices/luaSlice'; // Assuming you'll add removeScript back
import { v4 as uuidv4 } from 'uuid'; // Assuming you'll need to add scripts
import StyledList from './ScriptList.styled'; // Reuse the styled component

const HotkeyScriptList = () => {
  const dispatch = useDispatch();
  const hotkeyScripts = useSelector((state) => state.lua.hotkeyScripts);

  // Placeholder functions for adding/editing/removing
   const handleAddScript = () => {
       const newScript = {
            name: `New Hotkey Script ${hotkeyScripts.length + 1}`,
            code: '-- Your Lua code here',
            type: 'hotkey',
            hotkey: null, // User will set this
       };
       // Dispatch an action to add the script (assuming you add this reducer back)
       // dispatch(addScript(newScript));
        console.log("Add hotkey script clicked", newScript); // Placeholder
   };

    const handleRemoveScript = (id) => {
       // Dispatch an action to remove the script
       dispatch(removeScript(id));
   };

  return (
    <StyledList>
      <h3>Hotkey Scripts</h3>
       <button onClick={handleAddScript}>Add Hotkey Script</button>
      <ul>
        {hotkeyScripts.map((script) => (
          <li key={script.id}>
            <span>{script.name} ({script.hotkey || 'No hotkey'})</span>
             <button onClick={() => console.log(`Edit script ${script.id}`)}>Edit</button> {/* Placeholder */}
             <button onClick={() => handleRemoveScript(script.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </StyledList>
  );
};

export default HotkeyScriptList;