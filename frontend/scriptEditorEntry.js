// /home/orimorfus/Documents/Automaton/frontend/scriptEditorEntry.js

// Assuming window.electron.ipcRenderer is available via preload.js
const { ipcRenderer } = window.electron;


let monacoEditor = null; // Variable to hold the Monaco Editor instance
let currentScriptId = null;

// Configure Monaco Environment for Electron
// This is necessary to tell Monaco how to load its web workers in a file:// environment
self.MonacoEnvironment = {
    getWorkerUrl: function (_moduleId, label) {
        if (label === 'json') {
            return './monaco-editor/min/vs/language/json/json.worker.js';
        }
        if (label === 'css' || label === 'scss' || label === 'less') {
            return './monaco-editor/min/vs/language/css/css.worker.js';
        }
        if (label === 'html' || label === 'handlebars' || label === 'razor') {
            return './monaco-editor/min/vs/language/html/html.worker.js';
        }
        if (label === 'typescript' || label === 'javascript') {
            return './monaco-editor/min/vs/language/typescript/ts.worker.js';
        }
        // Fallback for the main editor worker and other languages
        return './monaco-editor/min/vs/editor/editor.worker.js';
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const scriptNameInput = document.getElementById('script-name-input');
    const enabledCheckbox = document.getElementById('enabled-checkbox'); // Get the enabled checkbox
    const saveButton = document.getElementById('save-script-button');
    const removeButton = document.getElementById('remove-script-button'); // Get the remove button
    const editorContainer = document.getElementById('monaco-editor-container');

    if (!scriptNameInput || !enabledCheckbox || !saveButton || !removeButton || !editorContainer) {
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
                scriptNameInput.value = scriptData.name || 'Unnamed Script';
                // Set the checked state of the enabled checkbox (only for persistent scripts)
                enabledCheckbox.checked = scriptData.enabled || false;
                enabledCheckbox.disabled = false; // Ensure checkbox is enabled for persistent scripts
                
                monacoEditor.setValue(scriptData.code || ''); // Set editor content
            } else if (!scriptData) {
                console.error('No script data received.');
                 scriptNameInput.value = 'Error Loading Script';
                 enabledCheckbox.disabled = true;
                 // monacoEditor.setValue('// Could not load script data'); // Uncomment if you want placeholder in editor
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
            const updatedEnabled = enabledCheckbox.checked; // Get the enabled state

            console.log(`Sending save request for script ID: ${currentScriptId}`);
            ipcRenderer.send('save-script-content', {
                id: currentScriptId,
                updates: {
                    name: updatedName,
                    code: updatedCode,
                    // Only include enabled status if it's a persistent script
                    ...(enabledCheckbox.disabled ? {} : { enabled: updatedEnabled }),
                }
            });
            console.log('Save request sent.');
            window.close(); // Close the window after saving
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

    // Optional: Listen for save confirmation from the main process (optional now as window closes)
    // ipcRenderer.on('script-saved-confirmation', (event, scriptId) => {
    //     console.log(`Script ID: ${scriptId} saved successfully.`);
    // });

     // Optional: Listen for save error from the main process
     ipcRenderer.on('script-save-error', (event, { id, error }) => {
         console.error(`Error saving script ID: ${id}: ${error}`);
         // Optionally, display an error message to the user in the editor window
         alert(`Error saving script: ${error}`);
     });
});
