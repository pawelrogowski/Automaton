// LuaEditorModal.js
import React from 'react';
import styled from 'styled-components';
import { Upload, Download } from 'react-feather';

// --- Import the CORRECT CodeMirror components ---
import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage } from '@codemirror/language'; // Helper for legacy modes
import { lua } from '@codemirror/legacy-modes/mode/lua'; // The actual Lua mode
import { tokyoNight } from '@uiw/codemirror-theme-tokyo-night'; // A great dark theme

// --- Styled Components for the Modal (No changes needed here) ---
const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
`;

const ModalContent = styled.div`
  background-color: rgb(26, 26, 26);
  color: #fafafa;
  border: 1px solid rgb(53, 53, 53);
  border-radius: 8px;
  width: 70vw;
  height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const ModalHeader = styled.div`
  padding: 12px 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', sans-serif;
  font-size: 16px;
  font-weight: 600;
  border-bottom: 1px solid rgb(53, 53, 53);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
`;

const ModalBody = styled.div`
  flex-grow: 1;
  overflow: auto;
`;

const ModalFooter = styled.div`
  padding: 12px;
  border-top: 1px solid rgb(53, 53, 53);
  display: flex;
  justify-content: flex-end;
  gap: 12px;

  button {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', sans-serif;
    font-size: 13px;
    background-color: rgba(255, 255, 255, 0.05);
    color: #fafafa;
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 8px 16px;
    cursor: pointer;
    border-radius: 6px;
    font-weight: 500;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    gap: 6px;

    &:hover {
      background-color: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
      transform: translateY(-1px);
    }

    &:active {
      transform: translateY(0);
    }

    &.primary {
      background-color: #007bff;
      border-color: #007bff;
      &:hover {
        background-color: #0056b3;
        border-color: #0056b3;
      }
    }
  }
`;

const HeaderButton = styled.button`
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', sans-serif;
  font-size: 13px;
  background-color: rgba(255, 255, 255, 0.05);
  color: #fafafa;
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 6px 12px;
  cursor: pointer;
  border-radius: 6px;
  font-weight: 500;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 6px;

  &:hover {
    background-color: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.2);
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }
`;

// --- The Modal Component (Now using the correct CodeMirror setup) ---
const LuaEditorModal = ({ isOpen, initialValue, onClose, onSave }) => {
  const [code, setCode] = React.useState(initialValue);

  React.useEffect(() => {
    if (isOpen) {
      setCode(initialValue);
    }
  }, [initialValue, isOpen]);

  React.useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSave = () => {
    onSave(code);
  };

  const onChange = React.useCallback((value) => {
    setCode(value);
  }, []);

  const handleImport = async () => {
    try {
      const loadedScript = await window.electron.loadLuaScript();
      if (loadedScript && loadedScript.code) {
        setCode(loadedScript.code);
      }
    } catch (error) {
      console.error('Failed to import script:', error);
    }
  };

  const handleExport = async () => {
    try {
      const scriptToSave = {
        name: 'Cavebot Waypoint Script',
        code: code,
        enabled: false,
      };
      await window.electron.saveLuaScript(scriptToSave);
    } catch (error) {
      console.error('Failed to export script:', error);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <ModalOverlay onClick={onClose}>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <span>Edit Waypoint Script (Lua)</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <HeaderButton onClick={handleImport} title="Import script from file">
              <Upload size={14} /> Import
            </HeaderButton>
            <HeaderButton onClick={handleExport} title="Export script to file">
              <Download size={14} /> Export
            </HeaderButton>
          </div>
        </ModalHeader>
        <ModalBody>
          {/* --- This is the new CodeMirror editor with the correct extension --- */}
          <CodeMirror
            value={code}
            height="100%"
            theme={tokyoNight}
            // THIS IS THE KEY CHANGE:
            // We wrap the imported legacy 'lua' mode with StreamLanguage.define
            extensions={[StreamLanguage.define(lua)]}
            onChange={onChange}
            style={{ fontSize: '14px' }}
          />
        </ModalBody>
        <ModalFooter>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={handleSave}>
            Save
          </button>
        </ModalFooter>
      </ModalContent>
    </ModalOverlay>
  );
};

export default LuaEditorModal;
