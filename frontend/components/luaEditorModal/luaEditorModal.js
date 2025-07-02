// LuaEditorModal.js
import React from 'react';
import styled from 'styled-components';

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
  font-family: sans-serif;
  font-size: 16px;
  font-weight: bold;
  border-bottom: 1px solid rgb(53, 53, 53);
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
    font-family: sans-serif;
    font-size: 14px;
    background-color: #5f6161;
    color: #fafafa;
    border: none;
    padding: 8px 16px;
    cursor: pointer;
    border-radius: 4px;

    &:hover {
      background-color: #7a7a7a;
    }

    &.primary {
      background-color: #007bff;
      &:hover {
        background-color: #0056b3;
      }
    }
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

  if (!isOpen) {
    return null;
  }

  return (
    <ModalOverlay onClick={onClose}>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <ModalHeader>Edit Action Script (Lua)</ModalHeader>
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
