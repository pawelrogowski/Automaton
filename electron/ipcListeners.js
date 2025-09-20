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

ipcMain.on('state-change-batch', (_, serializedBatch) => {
  try {
    const batch = JSON.parse(serializedBatch);
    if (Array.isArray(batch)) {
      for (const action of batch) {
        if (action.origin === 'renderer') {
          // Pass the origin to setGlobalState so it can be echoed back.
          setGlobalState(action.type, action.payload, action.origin);
        }
      }
    }
  } catch (error) {
    console.error('Error handling state-change-batch from renderer:', error);
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

// IPC handler to provide current control states to the widget
ipcMain.handle('get-control-states', () => {
  const state = store.getState();
  return {
    isRulesEnabled: state.rules.enabled,
    isCavebotEnabled: state.cavebot.enabled,
    isTargetingEnabled: state.targeting.enabled,
    isLuaEnabled: state.lua.enabled,
  };
});

// IPC handler for widget to toggle main window visibility
ipcMain.handle('toggle-main-window', () => {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
    return mainWindow.isVisible();
  }
  return false;
});

// IPC handler to check if main window is visible
ipcMain.handle('is-main-window-visible', () => {
  const mainWindow = getMainWindow();
  return mainWindow ? mainWindow.isVisible() : false;
});
