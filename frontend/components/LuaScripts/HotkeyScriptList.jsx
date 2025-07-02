// /home/orimorfus/Documents/Automaton/frontend/components/LuaScripts/HotkeyScriptList.jsx
import React, { useState, useCallback } from 'react';
import ScriptEditorModal from '../ScriptEditorModal/ScriptEditorModal.jsx';
import { useSelector, useDispatch } from 'react-redux';
import { addScript, removeScript, clearScriptLog } from '../../redux/slices/luaSlice';
import { v4 as uuidv4 } from 'uuid';
import StyledList from './ScriptList.styled';
import StyledScriptItem from './HotkeyScriptListItem.styled'; // Import styled item

const HotkeyScriptList = () => {
  const dispatch = useDispatch();
  const hotkey_scripts = useSelector((state) => state.lua.hotkeyScripts);
  const [expanded_log_id, set_expanded_log_id] = useState(null);
  const [modalState, setModalState] = useState({ isOpen: false, script: null });

  const handle_add_script = useCallback(() => {
    const new_script_details = {
      id: uuidv4(),
      name: `New Hotkey Script ${hotkey_scripts.length + 1}`,
      code: '-- Your Lua code here',
      type: 'hotkey',
      hotkey: null,
      log: [],
    };
    dispatch(addScript(new_script_details));
    setModalState({ isOpen: true, script: new_script_details });
  }, [dispatch, hotkey_scripts.length]);

  const handle_remove_script = useCallback(
    (id) => {
      dispatch(removeScript(id));
    },
    [dispatch],
  );

  const handle_edit_script = useCallback(
    (script_id) => {
      const scriptToEdit = hotkey_scripts.find((s) => s.id === script_id);
      if (scriptToEdit) {
        setModalState({ isOpen: true, script: { ...scriptToEdit } });
      }
    },
    [hotkey_scripts],
  );

  const handle_close_modal = useCallback(() => {
    setModalState({ isOpen: false, script: null });
  }, []);

  const handle_save_script = useCallback(
    (updates) => {
      // The modal dispatches updateScript directly, so this function is not strictly needed here
      // but kept for consistency if a different flow was desired.
      // For now, the modal handles the dispatch.
      handle_close_modal();
    },
    [handle_close_modal],
  );

  const handle_remove_script_from_modal = useCallback(
    (id) => {
      // The modal dispatches removeScript directly, so this function is not strictly needed here.
      // For now, the modal handles the dispatch.
      handle_close_modal();
    },
    [handle_close_modal],
  );

  const handle_toggle_log = useCallback(
    (script_id) => {
      set_expanded_log_id(expanded_log_id === script_id ? null : script_id);
    },
    [expanded_log_id],
  );

  const handle_clear_log = useCallback(
    (script_id) => {
      dispatch(clearScriptLog(script_id));
    },
    [dispatch],
  );

  return (
    <>
      <StyledList>
        <button onClick={handle_add_script}>New Script</button>
        <ul>
          {hotkey_scripts.map((script) => (
            <StyledScriptItem key={script.id}>
              <div>
                <span>
                  {script.name} ({script.hotkey || 'No hotkey'})
                </span>
                <button onClick={() => handle_edit_script(script.id)}>Edit</button>
                <button onClick={() => handle_toggle_log(script.id)}>
                  {expanded_log_id === script.id ? 'Hide Log' : 'View Log'} ({script.log.length})
                </button>
                <button onClick={() => handle_clear_log(script.id)}>Clear Log</button>
                <button onClick={() => dispatch(removeScript(script.id))}>Remove</button> {/* Direct dispatch for remove */}
              </div>
              {expanded_log_id === script.id && script.log && <pre className="script-log-display">{script.log.join('\n')}</pre>}
            </StyledScriptItem>
          ))}
        </ul>
      </StyledList>
      <ScriptEditorModal
        isOpen={modalState.isOpen}
        onClose={handle_close_modal}
        scriptData={modalState.script}
        onSave={handle_save_script}
        onRemove={handle_remove_script_from_modal}
      />
    </>
  );
};

export default HotkeyScriptList;
