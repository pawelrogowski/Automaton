// /home/orimorfus/Documents/Automaton/frontend/components/LuaScripts/HotkeyScriptList.jsx
import React, { useState, useCallback } from 'react';
import ScriptEditorModal from '../ScriptEditorModal/ScriptEditorModal.jsx';
import { useSelector, useDispatch } from 'react-redux';
import { addScript, removeScript, clearScriptLog, updateScript } from '../../redux/slices/luaSlice';
import { v4 as uuidv4 } from 'uuid';
import ScriptTable from './ScriptTable.jsx';

const { ipcRenderer } = window.electron || {};

const HotkeyScriptList = () => {
  const dispatch = useDispatch();
  // Use separate selectors to avoid creating new objects on every render
  const hotkey_scripts = useSelector((state) => state.lua.hotkeyScripts);
  const persistent_scripts = useSelector((state) => state.lua.persistentScripts);
  const [modalState, setModalState] = useState({ isOpen: false, script: null });

  const handleAddScript = useCallback(() => {
    const all_scripts = [...persistent_scripts, ...hotkey_scripts];
    let counter = 1;
    let scriptName = `New Hotkey Script ${counter}`;
    while (all_scripts.some((s) => s.name === scriptName)) {
      counter++;
      scriptName = `New Hotkey Script ${counter}`;
    }

    const newScriptDetails = {
      id: uuidv4(),
      name: scriptName,
      code: '-- Your Lua code here',
      type: 'hotkey',
      hotkey: null,
      log: [],
    };
    dispatch(addScript(newScriptDetails));
  }, [dispatch, persistent_scripts, hotkey_scripts]);

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

  const handleExportScript = useCallback(
    async (script) => {
      if (ipcRenderer) {
        await ipcRenderer.invoke('save-lua-script', script);
      }
    },
    [],
  );

  const handleImportScript = useCallback(async () => {
    if (ipcRenderer) {
      const loadedScript = await ipcRenderer.invoke('load-lua-script');
      if (loadedScript) {
        // Generate new ID to avoid conflicts
        const newScript = {
          ...loadedScript,
          id: uuidv4(),
          log: [],
        };
        dispatch(addScript(newScript));
      }
    }
  }, [dispatch]);

  const handleExportPackage = useCallback(async (scripts) => {
    if (ipcRenderer) {
      await ipcRenderer.invoke('save-lua-script-package', scripts);
    }
  }, []);

  const handleImportPackage = useCallback(async () => {
    if (ipcRenderer) {
      const loadedScripts = await ipcRenderer.invoke('load-lua-script-package');
      if (loadedScripts && Array.isArray(loadedScripts)) {
        loadedScripts.forEach(script => {
          const newScript = {
            ...script,
            id: uuidv4(), // Generate new ID to avoid conflicts
            log: [],
          };
          dispatch(addScript(newScript));
        });
      }
    }
  }, [dispatch]);

  return (
    <>
      <ScriptTable
        scripts={hotkey_scripts}
        updateScriptData={handleUpdateScriptData}
        onEditScript={handleEditScript}
        onRemoveScript={handleRemoveScript}
        onClearScriptLog={handleClearLog}
        onAddScript={handleAddScript}
        onExportScript={handleExportScript}
        onImportScript={handleImportScript}
        onExportPackage={handleExportPackage}
        onImportPackage={handleImportPackage}
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
