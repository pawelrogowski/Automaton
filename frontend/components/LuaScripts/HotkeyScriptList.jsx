// /home/orimorfus/Documents/Automaton/frontend/components/LuaScripts/HotkeyScriptList.jsx
import React, { useState, useCallback } from 'react';
import ScriptEditorModal from '../ScriptEditorModal/ScriptEditorModal.jsx';
import { useSelector, useDispatch } from 'react-redux';
import { addScript, removeScript, clearScriptLog, updateScript } from '../../redux/slices/luaSlice';
import { v4 as uuidv4 } from 'uuid';
import ScriptTable from './ScriptTable.jsx';

const HotkeyScriptList = () => {
  const dispatch = useDispatch();
  const hotkey_scripts = useSelector((state) => state.lua.hotkeyScripts);
  const [modalState, setModalState] = useState({ isOpen: false, script: null });

  const handleAddScript = useCallback(() => {
    const newScriptDetails = {
      id: uuidv4(),
      name: `New Hotkey Script ${hotkey_scripts.length + 1}`,
      code: '-- Your Lua code here',
      type: 'hotkey',
      hotkey: null,
      log: [],
    };
    dispatch(addScript(newScriptDetails));
  }, [dispatch, hotkey_scripts.length]);

  const handleRemoveScript = useCallback(
    (id) => {
      if (window.confirm('Are you sure you want to remove this script?')) {
        dispatch(removeScript(id));
      }
    },
    [dispatch],
  );

  const handleEditScript = useCallback(
    (scriptId) => {
      const scriptToEdit = hotkey_scripts.find((s) => s.id === scriptId);
      if (scriptToEdit) {
        setModalState({ isOpen: true, script: { ...scriptToEdit } });
      }
    },
    [hotkey_scripts],
  );

  const handleCloseModal = useCallback(() => {
    setModalState({ isOpen: false, script: null });
  }, []);

  const handleSaveScript = useCallback(
    (updates) => {
      // The modal dispatches updateScript directly, so this function is not strictly needed here
      // but kept for consistency if a different flow was desired.
      // For now, the modal handles the dispatch.
      handleCloseModal();
    },
    [handleCloseModal],
  );

  const handleUpdateScriptData = useCallback(
    (id, updates) => {
      dispatch(updateScript({ id, updates }));
    },
    [dispatch],
  );

  const handleClearLog = useCallback(
    (scriptId) => {
      dispatch(clearScriptLog(scriptId));
    },
    [dispatch],
  );

  return (
    <>
      <ScriptTable
        scripts={hotkey_scripts}
        updateScriptData={handleUpdateScriptData}
        onEditScript={handleEditScript}
        onRemoveScript={handleRemoveScript}
        onClearScriptLog={handleClearLog}
        onAddScript={handleAddScript}
        type="hotkey"
      />
      <ScriptEditorModal
        isOpen={modalState.isOpen}
        onClose={handleCloseModal}
        scriptData={modalState.script}
        onSave={handleSaveScript}
        onRemove={handleRemoveScript}
      />
    </>
  );
};

export default HotkeyScriptList;
