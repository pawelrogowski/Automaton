// /home/orimorfus/Documents/Automaton/frontend/components/LuaScripts/HotkeyScriptList.jsx
// This file is open but not being modified.

// /home/orimorfus/Documents/Automaton/frontend/scriptEditorEntry.js
// Assuming window.electron.ipcRenderer is available via preload.js
const { ipcRenderer } = window.electron;

// Configure Monaco Environment for Electron
// This is necessary to tell Monaco how to load its web workers in a file:// environment
self.MonacoEnvironment = {
    getWorkerUrl: function (_moduleId, label) {
        const path = require('path'); // Require path module
        // __dirname will be the directory of the currently executing script (scriptEditorEntry.js in dist)
        const distPath = __dirname;
        let workerFileName = 'editor/editor.worker.js'; // Default to the main editor worker

        if (label === 'json') {
            workerFileName = 'language/json/json.worker.js';
        } else if (label === 'css' || label === 'scss' || label === 'less') {
            workerFileName = 'language/css/css.worker.js';
        } else if (label === 'html' || label === 'handlebars' || label === 'razor') {
            workerFileName = 'language/html/html.worker.js';
        } else if (label === 'typescript' || label === 'javascript') {
            workerFileName = 'language/typescript/ts.worker.js';
        }

        // Construct the full file:// URL using path.join for robustness
        const fullWorkerPath = path.join(distPath, 'monaco-editor', 'min', 'vs', workerFileName);
        return `file://${fullWorkerPath}`;
    }
};

let monacoEditor = null; // Variable to hold the Monaco Editor instance
let currentScriptId = null;
let scriptLogElement = null; // Element to display logs
let currentScriptType = null; // Store script type to show/hide settings
const SNIPPET_SCRIPT_ID = 'script-snippet'; // Must match the ID used in workerManager

document.addEventListener('DOMContentLoaded', () => {
    const scriptNameInput = document.getElementById('script-name-input');
    const persistentSettingsDiv = document.getElementById('persistent-settings'); // Get the persistent settings div
    const loopMinInput = document.getElementById('loop-min'); // Get loop min input
    const loopMaxInput = document.getElementById('loop-max'); // Get loop max input
    const saveButton = document.getElementById('save-script-button');
    const removeButton = document.getElementById('remove-script-button'); // Get the remove button
    const editorContainer = document.getElementById('monaco-editor-container');
    scriptLogElement = document.getElementById('script-log'); // Get the log element


    if (!scriptNameInput || !persistentSettingsDiv || !loopMinInput || !loopMaxInput || !saveButton || !removeButton || !editorContainer || !scriptLogElement) {
        console.error('Required editor elements not found in HTML.');
        // Optionally, display an error message in the window
        return;
    }

    // Configure Monaco's loader
require.config({ paths: { 'vs': './monaco-editor/min/vs' } });
    // Load the editor
    require(['vs/editor/editor.main'], () => {
        monacoEditor = monaco.editor.create(editorContainer, {
            language: 'lua', // Set language mode to Lua
            theme: 'vs-dark', // Use a dark theme (optional)
            automaticLayout: true, // Automatically resize the editor
            autoIndent: 'full', // Enable auto-indentation
            autoClosingBrackets: 'always', // Always auto-close brackets
            autoClosingQuotes: 'always', // Always auto-close quotes
            mouseWheelZoom: true, // Allow zooming with mouse wheel
            scrollBeyondLastLine: false, // Do not scroll past the last line
            fontSize: 14, // Set font size to 14px
            lineNumbers: 'on', // Display line numbers
            minimap: {
                enabled: false // Enable the minimap
            },
            wordBasedSuggestions: true, // Enable word-based suggestions
            // Add other configuration options as needed
        });

        console.log('Monaco Editor initialized.');

        // Listen for the 'load-script-data' IPC message from the main process AFTER editor is ready
        ipcRenderer.on('load-script-data', (event, scriptData) => {
            console.log('Received script data in editor window:', scriptData);
            if (scriptData && monacoEditor) {
                currentScriptId = scriptData.id;
                currentScriptType = scriptData.type; // Store script type
                scriptNameInput.value = scriptData.name || 'Unnamed Script';
                // Set the checked state of the enabled checkbox (only for persistent scripts)
                // Disable checkbox for hotkey scripts (or if type is not persistent)
                const isPersistent = scriptData.type === 'persistent';
                console.log('Script type is persistent:', isPersistent); // Log the boolean result

                if (isPersistent) {
                    console.log('Handling persistent script settings.'); // Log when entering this block
                    // Show the persistent settings div
                    persistentSettingsDiv.style.display = 'flex';
                    loopMinInput.value = scriptData.loopMin !== undefined ? scriptData.loopMin : 1000;
                    loopMaxInput.value = scriptData.loopMax !== undefined ? scriptData.loopMax : 5000;
                } else {
                    // Hide persistent settings for non-persistent scripts
                    persistentSettingsDiv.style.display = 'none';
                    console.log('Handling non-persistent script, hiding settings.'); // Log when hiding
                }


                monacoEditor.setValue(scriptData.code || ''); // Set editor content

                 // Display initial log content if available
                if (scriptData.log && scriptLogElement) {
                    scriptLogElement.textContent = scriptData.log.join('\n');
                    // Scroll to the bottom of the log
                    scriptLogElement.scrollTop = scriptLogElement.scrollHeight;
                }
            } else if (!scriptData) {
                console.error('No script data received.');
                 scriptNameInput.value = 'Error Loading Script';
                 persistentSettingsDiv.style.display = 'none'; // Hide settings on error
                 if (monacoEditor) {
                     monacoEditor.setValue('// Could not load script data');
                     monacoEditor.updateOptions({ readOnly: true }); // Make editor read-only on error
                 }
                 if (scriptLogElement) scriptLogElement.textContent = 'Failed to load script logs.';
            } else if (!monacoEditor) {
                 console.error('Monaco Editor not initialized when data received.');
            }
        });
    });

    // Add event listener for the save button
    saveButton.addEventListener('click', () => {
        if (currentScriptId && monacoEditor) {
            const updatedName = scriptNameInput.value;
            const updatedCode = monacoEditor.getValue(); // Get editor content
             const updates = {
                 name: updatedName,
                 code: updatedCode,
             };

             // Include persistent specific updates if it's a persistent script
             if (currentScriptType === 'persistent') {
                 // Removed the problematic updatedEnabled variable reference
                 updates.loopMin = Number(loopMinInput.value);
                 updates.loopMax = Number(loopMaxInput.value);
             }


            console.log(`Sending save request for script ID: ${currentScriptId}`);
            ipcRenderer.send('save-script-content', {
                id: currentScriptId,
                updates
            });
            console.log('Save request sent.');
            window.close(); // Close the window on save
        } else if (!currentScriptId) {
            console.warn('Cannot save: No script ID available.');
        } else if (!monacoEditor) {
             console.warn('Cannot save: Monaco Editor not initialized.');
        }
    });

    // Add event listener for the remove button
    removeButton.addEventListener('click', () => {
        if (currentScriptId && confirm(`Are you sure you want to remove script: ${scriptNameInput.value}?`)) { // Confirmation dialog
            console.log(`Sending remove request for script ID: ${currentScriptId}`);
            ipcRenderer.send('remove-script', currentScriptId); // Send remove message
            console.log('Remove request sent.');
            window.close(); // Close the window after removing
        } else if (!currentScriptId) {
             console.warn('Cannot remove: No script ID available.');
        }
    });

    // Listen for log messages specific to the currently edited script or snippets
     ipcRenderer.on('script-log-update', (event, { scriptId, message }) => {
        // Only display logs if they match the currently edited script ID or the snippet ID
        if (currentScriptId === scriptId || scriptId === SNIPPET_SCRIPT_ID) {
            if (scriptLogElement) {
                scriptLogElement.textContent += message + '\n';
                 // Keep scrolled to the bottom
                 scriptLogElement.scrollTop = scriptLogElement.scrollHeight;
            }
        }
     });

     // Listen for save confirmation (optional now, as window might not close)
     ipcRenderer.on('script-saved-confirmation', (event, scriptId) => {
         console.log(`Script ID: ${scriptId} saved successfully.`);
         // Optional: Display a temporary "Saved!" message in the editor UI
     });

     // Listen for save error from the main process
     ipcRenderer.on('script-save-error', (event, { id, error }) => {
         console.error(`Error saving script ID: ${id}: ${error}`);
         // Optionally, display an error message to the user in the editor window
         alert(`Error saving script: ${error}`);
          if (scriptLogElement) {
             scriptLogElement.textContent += `SAVE ERROR: ${error}\n`;
              scriptLogElement.scrollTop = scriptLogElement.scrollHeight;
         }
     });
});