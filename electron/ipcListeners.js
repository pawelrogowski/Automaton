// /home/orimorfus/Documents/Automaton/electron/ipcListeners.js
import { ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import store from './store.js';
import {
  saveRulesToFile,
  loadRulesFromFile,
  autoLoadRules,
} from './saveManager.js';
import { playSound, registerGlobalShortcuts } from './globalShortcuts.js';
import { getMainWindow } from './createMainWindow.js';
import luaSlice from '../frontend/redux/slices/luaSlice.js'; // Import the luaSlice
import setGlobalState from './setGlobalState.js';
const { updateScript, removeScript } = luaSlice.actions; // Destructure actions from the slice

const filename = fileURLToPath(import.meta.url);
const cwd = dirname(filename);
const preloadPath = path.join(cwd, '/preload.js');

// --- THIS IS THE CORRECTED LISTENER ---
ipcMain.on('state-change', (_, serializedAction) => {
  try {
    const action = JSON.parse(serializedAction);
    if (action.origin === 'renderer') {
      setGlobalState(action.type, action.payload);
    }
  } catch (error) {
    console.error('Error handling state-change from renderer:', error);
  }
});
// --- END CORRECTION ---

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
