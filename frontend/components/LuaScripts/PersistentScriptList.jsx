// /home/orimorfus/Documents/Automaton/frontend/components/LuaScripts/PersistentScriptList.jsx
import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { addScript, togglePersistentScript, removeScript, clearScriptLog } from '../../redux/slices/luaSlice';
import { v4 as uuidv4 } from 'uuid';
import StyledList from './ScriptList.styled';
import StyledScriptItem from './PersistentScriptListItem.styled'; // Import styled item

const { ipcRenderer } = window.electron;

const PersistentScriptList = () => {
  const dispatch = useDispatch();
  const persistent_scripts = useSelector((state) => state.lua.persistentScripts);
  const [expanded_log_id, set_expanded_log_id] = useState(null);

  const handle_add_script = () => {
    const new_script_details = {
      id: uuidv4(),
      name: `New Persistent Script ${persistent_scripts.length + 1}`,
      code: '-- Your Lua code here',
      type: 'persistent',
      enabled: false,
      loop_min: 1000,
      loop_max: 5000,
      log: [],
    };
    dispatch(addScript(new_script_details));
  };

  const handle_toggle_enabled = (id) => {
    dispatch(togglePersistentScript(id));
  };

  const handle_remove_script = (id) => {
    dispatch(removeScript(id));
  };

  const handle_edit_script = (script_id) => {
    // console.log(`Requesting edit window for script ID: ${script_id}`);
    ipcRenderer.send('open-script-editor', script_id);
  };

  const handle_toggle_log = (script_id) => {
    set_expanded_log_id(expanded_log_id === script_id ? null : script_id);
  };

  const handle_clear_log = (script_id) => {
    dispatch(clearScriptLog(script_id));
  };

  return (
    <StyledList>
      <button onClick={handle_add_script}>New Script</button>
      <ul>
        {persistent_scripts.map((script) => (
          <StyledScriptItem key={script.id}>
            <div>
              <span>{script.name}</span>
              <button onClick={() => handle_toggle_enabled(script.id)}>
                {script.enabled ? 'Disable' : 'Enable'}
              </button>
              <button onClick={() => handle_edit_script(script.id)}>Edit</button>
              <button onClick={() => handle_toggle_log(script.id)}>
                {expanded_log_id === script.id ? 'Hide Log' : 'View Log'} ({script.log ? script.log.length : 0})
              </button>
              <button onClick={() => handle_clear_log(script.id)}>Clear Log</button>
              <button onClick={() => handle_remove_script(script.id)}>Remove</button>
            </div>
            {expanded_log_id === script.id && script.log && (
              <pre className="script-log-display">
                {script.log.join('\n')}
              </pre>
            )}
          </StyledScriptItem>
        ))}
      </ul>
    </StyledList>
  );
};

export default PersistentScriptList;