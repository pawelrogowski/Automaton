// /home/orimorfus/Documents/Automaton/frontend/components/LuaScripts/PersistentScriptList.jsx
import React, { useState, useCallback } from 'react';
import ScriptEditorModal from '../ScriptEditorModal/ScriptEditorModal.jsx';
import { useSelector, useDispatch } from 'react-redux';
import { addScript, togglePersistentScript, removeScript, clearScriptLog, updateScript } from '../../redux/slices/luaSlice';
import { v4 as uuidv4 } from 'uuid';
import ScriptTable from './ScriptTable.jsx';

const PersistentScriptList = () => {
  const dispatch = useDispatch();
  const persistent_scripts = useSelector((state) => state.lua.persistentScripts);
  const [modalState, setModalState] = useState({ isOpen: false, script: null });

  const handleAddScript = useCallback(() => {
    const newScriptDetails = {
      id: uuidv4(),
      name: `New Persistent Script ${persistent_scripts.length + 1}`,
      code: '-- Your Lua code here',
      type: 'persistent',
      enabled: false,
      loopMin: 1000,
      loopMax: 5000,
      log: [],
    };
    dispatch(addScript(newScriptDetails));
  }, [dispatch, persistent_scripts.length]);

  const handleToggleEnabled = useCallback(
    (id) => {
      dispatch(togglePersistentScript(id));
    },
    [dispatch],
  );

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
      const scriptToEdit = persistent_scripts.find((s) => s.id === scriptId);
      if (scriptToEdit) {
        setModalState({ isOpen: true, script: { ...scriptToEdit } });
      }
    },
    [persistent_scripts],
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
        scripts={persistent_scripts}
        updateScriptData={handleUpdateScriptData}
        onEditScript={handleEditScript}
        onRemoveScript={handleRemoveScript}
        onToggleScriptEnabled={handleToggleEnabled}
        onClearScriptLog={handleClearLog}
        onAddScript={handleAddScript}
        type="persistent"
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

export default PersistentScriptList;
