// /home/orimorfus/Documents/Automaton/electron/ipcListeners.js
import { ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import store from './store.js';
import { saveRulesToFile, loadRulesFromFile, autoLoadRules } from './rulesManager.js';
import { registerGlobalShortcuts } from './globalShortcuts.js';
import { getMainWindow } from './createMainWindow.js';
import luaSlice from '../frontend/redux/slices/luaSlice.js'; // Import the luaSlice
import setGlobalState from './setGlobalState.js';
const { updateScript, removeScript } = luaSlice.actions; // Destructure actions from the slice

const filename = fileURLToPath(import.meta.url);
const cwd = dirname(filename);
const preloadPath = path.join(cwd, '/preload.js');

ipcMain.on('state-change', (_, serializedAction) => {
  try {
    const action = JSON.parse(serializedAction);
    if (action.origin === 'renderer') {
      store.dispatch(action);
    }
  } catch (error) {
    console.error('Error dispatching action in main process:', error);
  }
});

ipcMain.on('save-rules', async () => {
  const mainWindow = getMainWindow();
  mainWindow.minimize();
  await saveRulesToFile(() => {
    mainWindow.restore();
  });
});

ipcMain.handle('load-rules', async () => {
  const mainWindow = getMainWindow();
  mainWindow.minimize();
  await loadRulesFromFile(() => {
    mainWindow.restore();
  });
});

ipcMain.on('renderer-ready', () => {
  autoLoadRules();
  registerGlobalShortcuts();
});

// Handle the request to open the script editor window
ipcMain.on('open-script-editor', (event, scriptId) => {
    console.log(`Received request to open editor for script ID: ${scriptId}`);

    // Find the script data from the Redux store
    const state = store.getState();
    console.log("lua state:", state.lua);

    let scriptToEdit = state.lua.persistentScripts.find(s => s.id === scriptId);
    let scriptType = null;

    if (scriptToEdit) {
        scriptType = 'persistent';
    } else {
        scriptToEdit = state.lua.hotkeyScripts.find(s => s.id === scriptId);
        if (scriptToEdit) {
            scriptType = 'hotkey';
        }
    }

    if (!scriptToEdit) {
        console.error(`Script with ID ${scriptId} not found.`);
        // Optionally, send an error back to the renderer
        event.sender.send('script-editor-error', `Script with ID ${scriptId} not found.`);
        return;
    }

    // **Add the type property to the script object before sending it**
    const scriptDataToSend = { ...scriptToEdit, type: scriptType };

    // Prevent opening multiple editor windows for the same script (optional but good practice)
    // You could maintain a map of scriptId to editorWindow instance

    // Create a new browser window for the editor
    const editorWindow = new BrowserWindow({
        width: 800, // Adjust size as needed
        height: 600,
        autoHideMenuBar: true,
        height: 633,
        width: 1046,
        maxWidth: 1046,
        minWidth: 1046,
        minHeight: 633,
        maxHeight: 633,
        resizable: false,
        alwaysOnTop: true,
        transparent: false,
        title: `Edit Script: ${scriptToEdit.name}`,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: preloadPath, // Use the same preload script
            // Pass script data to the new window (this is one way, could also use IPC after window is ready)
             additionalArguments: [`--script-id=${scriptId}`]
        },
    });


    // Load the script editor HTML file from the dist directory
    const editorHtmlPath = path.join(cwd, '../dist/scriptEditor.html');
    editorWindow.loadFile(editorHtmlPath);
    // Optional: Send the script data to the new window once it's ready
    // And ensure dev tools open after content loads
        editorWindow.webContents.on('did-finish-load', () => {
            // Send the scriptDataToSend object which now includes the type
            editorWindow.webContents.send('load-script-data', scriptDataToSend);
            // Open developer tools for debugging after content loads
            editorWindow.webContents.openDevTools();
        });

    // Add error handling for the web contents
    editorWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error(`Script Editor Window failed to load: ${validatedURL} - ${errorCode}: ${errorDescription}`);
        // Optionally, display an error in the main window or the editor window itself
    });

    editorWindow.webContents.on('render-process-gone', (event, details) => {
        console.error(`Script Editor Window render process gone: ${details.reason} - ${details.exitCode}`);
        // Handle cases where the renderer process crashes
    });



    // Handle window close (optional cleanup)
    editorWindow.on('closed', () => {
        console.log(`Script editor window closed for script ID: ${scriptId}`);
    // Clean up any references if you were tracking multiple windows
    });
});

// Handle the request to remove a script
ipcMain.on('remove-script', (event, scriptId) => {
    console.log(`Received remove request for script ID: ${scriptId}`);
    if (typeof removeScript === 'function') {
        try {
            // Use setGlobalState to dispatch in main process and sync with renderer
            setGlobalState(removeScript.type, scriptId);
            console.log(`Script ID: ${scriptId} removed from main store.`);
            // Optional: Send a confirmation back to the editor window (if needed)
            // event.sender.send('script-removed-confirmation', scriptId);
        } catch (error) {
            console.error('Error dispatching removeScript in main process:', error);
            // Optional: Send an error back to the editor window (if needed)
            // event.sender.send('script-remove-error', { id: scriptId, error: error.message });
        }
    } else {
        console.error('Error: removeScript is not a function in main process.', typeof removeScript);
        // event.sender.send('script-remove-error', { id: scriptId, error: 'Internal error: Could not dispatch remove action.' });
    }
});


// New IPC listener to handle saving script content from the editor window
ipcMain.on('save-script-content', (event, { id, updates }) => {
    console.log(`Received save request for script ID: ${id} with updates:`, updates);
    if (typeof updateScript === 'function') {
        try {
            // Use setGlobalState to dispatch in main process and sync with renderer
            setGlobalState(updateScript.type, { id, updates });
            console.log(`Script ID: ${id} updated in main store.`);
            // Optional: Send a confirmation back to the editor window
            event.sender.send('script-saved-confirmation', id);
        } catch (error) {
            console.error('Error dispatching updateScript in main process:', error);
            // Optional: Send an error back to the editor window
            event.sender.send('script-save-error', { id, error: error.message });
        }
    } else {
        console.error('Error: updateScript is not a function in main process.', typeof updateScript);
        event.sender.send('script-save-error', { id, error: 'Internal error: Could not dispatch update action.' });
    }
});