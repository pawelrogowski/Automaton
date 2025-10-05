import React, { useState, useEffect, useCallback, useRef } from 'react';
import styled from 'styled-components';
import { useDispatch, useSelector } from 'react-redux';
import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { tokyoNight } from '@uiw/codemirror-theme-tokyo-night';
import { updateScript, removeScript } from '../../redux/slices/luaSlice.js';
import { File, Trash2, Save, X, ChevronRight, ChevronDown } from 'react-feather';

// Styled Components for the IDE-like Editor
const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.85);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
`;

const ModalContent = styled.div`
  background-color: rgb(30, 30, 30);
  color: #fafafa;
  border: 1px solid rgb(60, 60, 60);
  border-radius: 8px;
  width: 95vw;
  height: 95vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
`;

const ModalHeader = styled.div`
  padding: 8px 16px;
  font-family: sans-serif;
  font-size: 14px;
  font-weight: 500;
  border-bottom: 1px solid rgb(60, 60, 60);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: rgb(40, 40, 40);
  flex-shrink: 0;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
`;

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ScriptNameInput = styled.input`
  padding: 6px 12px;
  font-size: 15px;
  background-color: #2a2a2a;
  color: #ffffff;
  border: 1px solid #555;
  border-radius: 4px;
  min-width: 250px;
  
  &:focus {
    outline: none;
    border-color: #007bff;
  }
`;

const SettingsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;

  label {
    white-space: nowrap;
    color: #aaa;
  }

  input[type='number'] {
    width: 70px;
    padding: 4px 8px;
    background-color: #2a2a2a;
    color: #ffffff;
    border: 1px solid #555;
    border-radius: 4px;
    
    &:focus {
      outline: none;
      border-color: #007bff;
    }
    
    &.error {
      border-color: #cc3333;
    }
  }
`;

const IconButton = styled.button`
  background: transparent;
  border: none;
  color: #aaa;
  cursor: pointer;
  padding: 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  transition: all 0.2s;
  
  &:hover {
    background-color: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
  
  &.primary {
    background-color: #007bff;
    color: #fff;
    
    &:hover {
      background-color: #0056b3;
    }
  }
  
  &.danger {
    &:hover {
      background-color: #cc3333;
      color: #fff;
    }
  }
`;

const ContentArea = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
  min-height: 0;
`;

const Sidebar = styled.div`
  width: ${props => props.$collapsed ? '0' : '250px'};
  background-color: rgb(35, 35, 35);
  border-right: 1px solid rgb(60, 60, 60);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.3s ease;
  flex-shrink: 0;
`;

const SidebarHeader = styled.div`
  padding: 10px 12px;
  border-bottom: 1px solid rgb(60, 60, 60);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #888;
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const SidebarContent = styled.div`
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  
  &::-webkit-scrollbar {
    width: 8px;
  }
  
  &::-webkit-scrollbar-track {
    background: rgb(35, 35, 35);
  }
  
  &::-webkit-scrollbar-thumb {
    background: rgb(60, 60, 60);
    border-radius: 4px;
    
    &:hover {
      background: rgb(80, 80, 80);
    }
  }
`;

const ScriptListItem = styled.div`
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: ${props => props.$active ? '#fff' : '#aaa'};
  background-color: ${props => props.$active ? 'rgba(0, 123, 255, 0.2)' : 'transparent'};
  border-left: 3px solid ${props => props.$active ? '#007bff' : 'transparent'};
  transition: all 0.2s;
  
  &:hover {
    background-color: ${props => props.$active ? 'rgba(0, 123, 255, 0.25)' : 'rgba(255, 255, 255, 0.05)'};
    color: #fff;
  }
  
  .script-icon {
    flex-shrink: 0;
  }
  
  .script-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .script-badge {
    flex-shrink: 0;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 10px;
    background-color: ${props => props.$enabled ? '#28a745' : '#555'};
    color: #fff;
  }
`;

const MainEditorArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
`;

const EditorContainer = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background-color: #1a1a1a;
  
  /* Ensure CodeMirror's internal scroller works correctly */
  .cm-editor {
    height: 100%;
    overflow: auto;
  }
  
  .cm-scroller {
    overflow: auto !important;
  }
`;

const ResizeHandle = styled.div`
  height: 6px;
  background-color: rgb(50, 50, 50);
  cursor: ns-resize;
  position: relative;
  
  &:hover {
    background-color: rgb(70, 70, 70);
  }
  
  &::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 40px;
    height: 3px;
    background-color: #666;
    border-radius: 2px;
  }
`;

const LogPanel = styled.div`
  height: ${props => props.$height}px;
  min-height: 100px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background-color: #1a1a1a;
  border-top: 1px solid rgb(60, 60, 60);
  overflow: hidden;
  flex-shrink: 0;
`;

const LogHeader = styled.div`
  padding: 8px 12px;
  background-color: rgb(35, 35, 35);
  border-bottom: 1px solid rgb(60, 60, 60);
  font-size: 12px;
  font-weight: 600;
  color: #aaa;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  
  .log-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .log-count {
    font-size: 11px;
    padding: 2px 6px;
    background-color: #555;
    border-radius: 10px;
    color: #fff;
  }
`;

const LogContent = styled.div`
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  padding: 8px;
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  color: #ccc;
  line-height: 1.5;
  
  &::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  
  &::-webkit-scrollbar-track {
    background: #1a1a1a;
  }
  
  &::-webkit-scrollbar-thumb {
    background: rgb(60, 60, 60);
    border-radius: 4px;
    
    &:hover {
      background: rgb(80, 80, 80);
    }
  }

  pre {
    margin: 0;
    white-space: pre;
    user-select: text;
    cursor: text;
  }
`;

const ValidationError = styled.div`
  color: #ff6b6b;
  font-size: 11px;
  margin-left: 4px;
  animation: shake 0.3s;
  
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-4px); }
    75% { transform: translateX(4px); }
  }
`;

const ScriptEditorModal = ({ isOpen, onClose, scriptData }) => {
  const dispatch = useDispatch();
  const [scriptName, setScriptName] = useState('');
  const [code, setCode] = useState('');
  const [loopMin, setLoopMin] = useState(1000);
  const [loopMax, setLoopMax] = useState(5000);
  const [validationError, setValidationError] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [logPanelHeight, setLogPanelHeight] = useState(250);
  const [isResizing, setIsResizing] = useState(false);
  const [logCollapsed, setLogCollapsed] = useState(false);
  const logContainerRef = useRef(null);
  const editorRef = useRef(null);
  const resizeStartY = useRef(0);
  const resizeStartHeight = useRef(0);

  const scriptId = scriptData?.id;
  
  // Get all scripts for sidebar
  const persistentScripts = useSelector((state) => state.lua.persistentScripts);
  const hotkeyScripts = useSelector((state) => state.lua.hotkeyScripts);
  
  // Only subscribe to the log array to avoid re-rendering on other script changes
  const scriptLog = useSelector((state) => {
    if (!scriptId) return [];
    const script = 
      state.lua.persistentScripts.find((s) => s.id === scriptId) ||
      state.lua.hotkeyScripts.find((s) => s.id === scriptId);
    return script?.log || [];
  });

  // Validation for loop values
  const validateLoopValues = useCallback((min, max) => {
    const minVal = Number(min);
    const maxVal = Number(max);
    
    if (isNaN(minVal) || isNaN(maxVal)) {
      setValidationError('Values must be numbers');
      return false;
    }
    
    if (minVal < 0 || maxVal < 0) {
      setValidationError('Values must be positive');
      return false;
    }
    
    if (minVal > maxVal) {
      setValidationError('Min delay cannot be greater than max delay');
      return false;
    }
    
    setValidationError('');
    return true;
  }, []);
  
  // Handle loop value changes with validation
  const handleLoopMinChange = useCallback((e) => {
    const value = e.target.value;
    setLoopMin(value);
    validateLoopValues(value, loopMax);
  }, [loopMax, validateLoopValues]);
  
  const handleLoopMaxChange = useCallback((e) => {
    const value = e.target.value;
    setLoopMax(value);
    validateLoopValues(loopMin, value);
  }, [loopMin, validateLoopValues]);
  
  // Resize handlers for log panel
  const handleResizeStart = useCallback((e) => {
    setIsResizing(true);
    resizeStartY.current = e.clientY;
    resizeStartHeight.current = logPanelHeight;
  }, [logPanelHeight]);
  
  const handleResizeMove = useCallback((e) => {
    if (!isResizing) return;
    const delta = resizeStartY.current - e.clientY;
    const newHeight = Math.max(100, Math.min(resizeStartHeight.current + delta, window.innerHeight * 0.7));
    setLogPanelHeight(newHeight);
  }, [isResizing]);
  
  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (scriptData) {
      setScriptName(scriptData.name || 'Unnamed Script');
      setCode(scriptData.code || '');
      const minVal = scriptData.loopMin !== undefined ? scriptData.loopMin : 1000;
      const maxVal = scriptData.loopMax !== undefined ? scriptData.loopMax : 5000;
      setLoopMin(minVal);
      setLoopMax(maxVal);
      validateLoopValues(minVal, maxVal);
    }
  }, [scriptData, validateLoopValues]);

  // Add resize event listeners
  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleResizeMove);
      window.addEventListener('mouseup', handleResizeEnd);
      return () => {
        window.removeEventListener('mousemove', handleResizeMove);
        window.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);

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
  }, [scriptLog]);

  const handleSave = useCallback(() => {
    if (!scriptData) return;
    
    // Validate loop values before saving
    if (scriptData.type === 'persistent' && !validateLoopValues(loopMin, loopMax)) {
      return;
    }
    
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
  }, [scriptData, scriptName, code, loopMin, loopMax, dispatch, onClose, validateLoopValues]);

  const handleRemove = useCallback(() => {
    if (scriptData && window.confirm(`Are you sure you want to remove script: ${scriptName}?`)) {
      dispatch(removeScript(scriptData.id));
      onClose();
    }
  }, [scriptData, scriptName, dispatch, onClose]);

  const handleCodeChange = useCallback((value) => {
    setCode(value);
  }, []);

  const handleScriptSwitch = useCallback((script) => {
    // Save current script before switching
    if (scriptData && scriptData.id !== script.id) {
      if (scriptData.type === 'persistent' && !validateLoopValues(loopMin, loopMax)) {
        return; // Don't switch if current script has validation errors
      }
      
      const updates = {
        name: scriptName,
        code: code,
      };
      
      if (scriptData.type === 'persistent') {
        updates.loopMin = Number(loopMin);
        updates.loopMax = Number(loopMax);
      }
      
      dispatch(updateScript({ id: scriptData.id, updates }));
    }
    
    // Switch to new script
    onClose();
    // The parent should handle opening the new script
    // For now, we'll just close and they can click the new one
  }, [scriptData, scriptName, code, loopMin, loopMax, dispatch, onClose, validateLoopValues]);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Escape') {
        onClose();
      } else if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        handleSave();
      }
    },
    [onClose, handleSave],
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
    <ModalOverlay onClick={onClose}>
      <ModalContent onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <HeaderLeft>
            <File size={18} style={{ color: '#007bff' }} />
            <ScriptNameInput
              type="text" 
              value={scriptName} 
              onChange={(e) => setScriptName(e.target.value)}
              placeholder="Script Name"
            />
            {scriptData?.type === 'persistent' && (
              <SettingsRow>
                <label htmlFor="loop-min">Min:</label>
                <input 
                  type="number" 
                  id="loop-min" 
                  value={loopMin} 
                  onChange={handleLoopMinChange}
                  min="0"
                  className={validationError ? 'error' : ''}
                />
                <label htmlFor="loop-max">Max:</label>
                <input 
                  type="number" 
                  id="loop-max" 
                  value={loopMax} 
                  onChange={handleLoopMaxChange}
                  min="0"
                  className={validationError ? 'error' : ''}
                />
                <span style={{ fontSize: '12px', color: '#666' }}>ms</span>
                {validationError && <ValidationError>{validationError}</ValidationError>}
              </SettingsRow>
            )}
          </HeaderLeft>
          <HeaderRight>
            <IconButton onClick={handleSave} className="primary" title="Save (Ctrl+S)">
              <Save size={16} />
              Save
            </IconButton>
            <IconButton onClick={handleRemove} className="danger" title="Delete Script">
              <Trash2 size={16} />
            </IconButton>
            <IconButton onClick={onClose} title="Close (Esc)">
              <X size={18} />
            </IconButton>
          </HeaderRight>
        </ModalHeader>
        
        <ContentArea>
          {/* Sidebar with script list */}
          <Sidebar $collapsed={sidebarCollapsed}>
            <SidebarHeader>
              <span>Scripts</span>
              <IconButton 
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                style={{ padding: '2px' }}
                title={sidebarCollapsed ? 'Expand' : 'Collapse'}
              >
                {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </IconButton>
            </SidebarHeader>
            <SidebarContent>
              {/* Persistent Scripts */}
              {persistentScripts.length > 0 && (
                <div style={{ padding: '8px 0' }}>
                  <div style={{ 
                    padding: '4px 12px', 
                    fontSize: '11px', 
                    fontWeight: 'bold', 
                    color: '#666',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    Persistent
                  </div>
                  {persistentScripts.map(script => (
                    <ScriptListItem
                      key={script.id}
                      $active={script.id === scriptId}
                      $enabled={script.enabled}
                      onClick={() => handleScriptSwitch(script)}
                      title={script.name}
                    >
                      <File size={14} className="script-icon" />
                      <span className="script-name">{script.name}</span>
                      {script.enabled && <span className="script-badge">ON</span>}
                    </ScriptListItem>
                  ))}
                </div>
              )}
              
              {/* Hotkey Scripts */}
              {hotkeyScripts.length > 0 && (
                <div style={{ padding: '8px 0' }}>
                  <div style={{ 
                    padding: '4px 12px', 
                    fontSize: '11px', 
                    fontWeight: 'bold', 
                    color: '#666',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    Hotkey
                  </div>
                  {hotkeyScripts.map(script => (
                    <ScriptListItem
                      key={script.id}
                      $active={script.id === scriptId}
                      onClick={() => handleScriptSwitch(script)}
                      title={script.name}
                    >
                      <File size={14} className="script-icon" />
                      <span className="script-name">{script.name}</span>
                    </ScriptListItem>
                  ))}
                </div>
              )}
            </SidebarContent>
          </Sidebar>
          
          {/* Main Editor Area */}
          <MainEditorArea>
            <EditorContainer>
              <CodeMirror
                ref={editorRef}
                value={code}
                height="100%"
                theme={tokyoNight}
                extensions={[StreamLanguage.define(lua)]}
                onChange={handleCodeChange}
                basicSetup={{
                  lineNumbers: true,
                  highlightActiveLineGutter: true,
                  highlightSpecialChars: true,
                  history: true,
                  foldGutter: true,
                  drawSelection: true,
                  dropCursor: true,
                  allowMultipleSelections: true,
                  indentOnInput: true,
                  syntaxHighlighting: true,
                  bracketMatching: true,
                  closeBrackets: true,
                  autocompletion: true,
                  rectangularSelection: true,
                  crosshairCursor: true,
                  highlightActiveLine: true,
                  highlightSelectionMatches: true,
                  closeBracketsKeymap: true,
                  defaultKeymap: true,
                  searchKeymap: true,
                  historyKeymap: true,
                  foldKeymap: true,
                  completionKeymap: true,
                  lintKeymap: true,
                }}
              />
            </EditorContainer>
            
            {/* Resizable Log Panel */}
            {!logCollapsed && (
              <>
                <ResizeHandle onMouseDown={handleResizeStart} />
                <LogPanel $height={logPanelHeight}>
                  <LogHeader>
                    <div className="log-title">
                      <span>Output</span>
                      <span className="log-count">{scriptLog.length}</span>
                    </div>
                    <IconButton 
                      onClick={() => setLogCollapsed(true)}
                      style={{ padding: '2px' }}
                      title="Collapse Output"
                    >
                      <ChevronDown size={14} />
                    </IconButton>
                  </LogHeader>
                  <LogContent ref={logContainerRef}>
                    <pre>{scriptLog.join('\n')}</pre>
                  </LogContent>
                </LogPanel>
              </>
            )}
            
            {/* Collapsed Log Panel Button */}
            {logCollapsed && (
              <div style={{ 
                padding: '6px 12px', 
                borderTop: '1px solid rgb(60, 60, 60)',
                background: 'rgb(35, 35, 35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer'
              }}
              onClick={() => setLogCollapsed(false)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                  <ChevronRight size={14} />
                  <span>Output</span>
                  <span className="log-count" style={{ 
                    fontSize: '11px',
                    padding: '2px 6px',
                    background: '#555',
                    borderRadius: '10px'
                  }}>
                    {scriptLog.length}
                  </span>
                </div>
              </div>
            )}
          </MainEditorArea>
        </ContentArea>
      </ModalContent>
    </ModalOverlay>
  );
};


export default ScriptEditorModal;
