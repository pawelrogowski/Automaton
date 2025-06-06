// /home/orimorfus/Documents/Automaton/frontend/components/LuaScripts/PersistentScriptList.jsx
import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { togglePersistentScript, removeScript } from '../../redux/slices/luaSlice.js'; // Assuming you'll add removeScript back
import { v4 as uuidv4 } from 'uuid'; // Assuming you'll need to add scripts
import StyledList from './ScriptList.styled.js'; // We will create a styled component for lists

const PersistentScriptList = () => {
  const dispatch = useDispatch();
  const persistentScripts = useSelector((state) => state.lua.persistentScripts);

  // Placeholder functions for adding/editing/removing
   const handleAddScript = () => {
       const newScript = {
            name: `New Persistent Script ${persistentScripts.length + 1}`,
            code: '-- Your Lua code here',
            type: 'persistent',
            enabled: false,
       };
       // Dispatch an action to add the script (assuming you add this reducer back)
       // dispatch(addScript(newScript));
       console.log("Add persistent script clicked", newScript); // Placeholder
   };

  const handleToggleEnabled = (id) => {
    dispatch(togglePersistentScript(id));
  };

   const handleRemoveScript = (id) => {
       // Dispatch an action to remove the script
       dispatch(removeScript(id));
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
             <button onClick={() => console.log(`Edit script ${script.id}`)}>Edit</button> {/* Placeholder */}
            <button onClick={() => handleRemoveScript(script.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </StyledList>
  );
};

export default PersistentScriptList;