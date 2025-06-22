import React, { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import styled from 'styled-components';

// --- Styled Components for the Modal ---
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
  overflow: hidden; /* Important for border-radius */
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
  /* The editor will fill this space */
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

// --- The Modal Component ---
const MonacoEditorModal = ({ isOpen, initialValue, onClose, onSave }) => {
  const [code, setCode] = useState(initialValue);

  // Reset local code state when the modal is opened for a new item
  useEffect(() => {
    if (isOpen) {
      setCode(initialValue);
    }
  }, [initialValue, isOpen]);

  // Handle keyboard shortcuts
  useEffect(() => {
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

  if (!isOpen) {
    return null;
  }

  return (
    <ModalOverlay onClick={onClose}>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <ModalHeader>Edit Action Script (Lua)</ModalHeader>
        <ModalBody>
          <Editor
            height="100%"
            language="lua"
            theme="vs-dark" // The default theme for Monaco
            value={code}
            onChange={(newValue) => setCode(newValue || '')}
            options={{
              minimap: { enabled: true },
              fontSize: 14,
            }}
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

export default MonacoEditorModal;
