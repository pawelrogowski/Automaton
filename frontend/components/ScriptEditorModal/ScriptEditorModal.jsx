import React, { useState, useEffect, useCallback, useRef } from 'react';
import styled from 'styled-components';
import { useDispatch, useSelector } from 'react-redux';
import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { tokyoNight } from '@uiw/codemirror-theme-tokyo-night';
import { updateScript, removeScript } from '../../redux/slices/luaSlice.js';

// Styled Components for the Modal
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
  width: 80vw;
  height: 90vh;
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
  display: flex;
  align-items: center;
  gap: 10px;
`;

const ScriptNameInput = styled.input`
  flex-grow: 1;
  padding: 4px 8px;
  font-size: 16px;
  background-color: #3c3c3c;
  color: #ffffff;
  border: 1px solid #555;
  border-radius: 4px;
`;

const SettingsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  margin-left: 10px;

  label {
    white-space: nowrap;
  }

  input[type='number'] {
    width: 60px;
    padding: 4px;
    background-color: #3c3c3c;
    color: #ffffff;
    border: 1px solid #555;
    border-radius: 4px;
  }
`;

const ModalBody = styled.div`
  flex-grow: 1;
  overflow: hidden; /* Container overflow hidden to contain children */
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  min-height: 0; /* Important for nested flexbox scrolling */
`;

const EditorContainer = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  
  /* Ensure CodeMirror's internal scroller works correctly */
  .cm-editor {
    height: 100%;
    overflow: auto;
  }
  
  .cm-scroller {
    overflow: auto !important;
  }
`;

const LogContainer = styled.div`
  flex-shrink: 0; /* Prevent shrinking */
  height: 200px; /* Fixed height for the log area */
  overflow-y: auto; /* Add scroll if logs exceed height */
  background-color: #1e1e1e; /* Dark background for logs */
  border: 1px solid #555;
  padding: 5px;
  font-size: 12px;
  font-family: monospace; /* Monospace font for code/logs */
  color: #ccc;

  h4 {
    margin-top: 0;
    margin-bottom: 5px;
    color: #ccc;
  }

  pre {
    margin: 0;
    white-space: pre-wrap; /* Wrap long lines */
    word-wrap: break-word; /* Break words if needed */
  }
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

    &.remove-button {
      background-color: #cc3333;
      &:hover {
        background-color: #a02828;
      }
    }
  }
`;

const ScriptEditorModal = ({ isOpen, onClose, scriptData }) => {
  const dispatch = useDispatch();
  const [scriptName, setScriptName] = useState('');
  const [code, setCode] = useState('');
  const [loopMin, setLoopMin] = useState(1000);
  const [loopMax, setLoopMax] = useState(5000);
  const logContainerRef = useRef(null);
  const editorRef = useRef(null);

  const scriptId = scriptData?.id;
  const liveScript = useSelector((state) => {
    if (!scriptId) return null;
    return (
      state.lua.persistentScripts.find((s) => s.id === scriptId) ||
      state.lua.hotkeyScripts.find((s) => s.id === scriptId)
    );
  });

  useEffect(() => {
    if (scriptData) {
      setScriptName(scriptData.name || 'Unnamed Script');
      setCode(scriptData.code || '');
      setLoopMin(scriptData.loopMin !== undefined ? scriptData.loopMin : 1000);
      setLoopMax(scriptData.loopMax !== undefined ? scriptData.loopMax : 5000);
    }
  }, [scriptData]);

  useEffect(() => {
    if (isOpen && editorRef.current) {
      // Use a timeout to ensure the editor is fully rendered
      setTimeout(() => {
        editorRef.current.view.focus();
      }, 100);
    }
  }, [isOpen]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [liveScript?.log]);

  const handleSave = useCallback(() => {
    if (scriptData) {
      const updates = {
        name: scriptName,
        code: code,
      };
      if (scriptData.type === 'persistent') {
        updates.loopMin = Number(loopMin);
        updates.loopMax = Number(loopMax);
      }
      dispatch(updateScript({ id: scriptData.id, updates }));
      onClose();
    }
  }, [scriptData, scriptName, code, loopMin, loopMax, dispatch, onClose]);

  const handleRemove = useCallback(() => {
    if (scriptData && window.confirm(`Are you sure you want to remove script: ${scriptName}?`)) {
      dispatch(removeScript(scriptData.id));
      onClose();
    }
  }, [scriptData, scriptName, dispatch, onClose]);

  const handleCodeChange = useCallback((value) => {
    setCode(value);
  }, []);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    } else {
      window.removeEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  if (!isOpen) {
    return null;
  }

  return (
    <ModalOverlay>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <ScriptNameInput type="text" value={scriptName} onChange={(e) => setScriptName(e.target.value)} />
          {scriptData?.type === 'persistent' && (
            <SettingsRow>
              <label htmlFor="loop-min">Min Delay (ms):</label>
              <input type="number" id="loop-min" value={loopMin} onChange={(e) => setLoopMin(e.target.value)} min="0" />
              <label htmlFor="loop-max">Max Delay (ms):</label>
              <input type="number" id="loop-max" value={loopMax} onChange={(e) => setLoopMax(e.target.value)} min="0" />
            </SettingsRow>
          )}
        </ModalHeader>
        <ModalBody>
          <EditorContainer>
            <CodeMirror
              ref={editorRef}
              value={code}
              height="100%"
              theme={tokyoNight}
              extensions={[StreamLanguage.define(lua)]}
              onChange={handleCodeChange}
              style={{ fontSize: '14px' }}
            />
          </EditorContainer>
          <LogContainer ref={logContainerRef}>
            <h4>Script Output:</h4>
            <pre>{liveScript?.log?.join('\n') || ''}</pre>
          </LogContainer>
        </ModalBody>
        <ModalFooter>
          <button className="remove-button" onClick={handleRemove}>
            Remove Script
          </button>
          <button className="primary" onClick={handleSave}>
            Save Script
          </button>
        </ModalFooter>
      </ModalContent>
    </ModalOverlay>
  );
};


export default ScriptEditorModal;
