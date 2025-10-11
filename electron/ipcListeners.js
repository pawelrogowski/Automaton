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
  saveLuaScript,
  loadLuaScript,
  saveLuaScriptPackage,
  loadLuaScriptPackage,
} from './saveManager.js';
import { playSound, registerGlobalShortcuts } from './globalShortcuts.js';
import { getMainWindow } from './createMainWindow.js';
import luaSlice from '../frontend/redux/slices/luaSlice.js'; // Import the luaSlice
import setGlobalState from './setGlobalState.js';
const { updateScript, removeScript } = luaSlice.actions; // Destructure actions from the slice

const filename = fileURLToPath(import.meta.url);
const cwd = dirname(filename);
const preloadPath = path.join(cwd, '/preload.js');

ipcMain.on('state-change-batch', (_, batchOrString) => {
  try {
    const batch = Array.isArray(batchOrString)
      ? batchOrString
      : JSON.parse(batchOrString);
    if (Array.isArray(batch)) {
      for (const action of batch) {
        if (action.origin === 'renderer') {
          setGlobalState(action.type, action.payload);
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

// ============================================================================
// Lua Script Import/Export IPC Handlers
// ============================================================================

// Save a single Lua script
ipcMain.handle('save-lua-script', async (event, script) => {
  const mainWindow = getMainWindow();
  if (mainWindow) mainWindow.minimize();

  await saveLuaScript(script, () => {
    if (mainWindow) mainWindow.restore();
  });
});

// Load a single Lua script
ipcMain.handle('load-lua-script', async () => {
  const mainWindow = getMainWindow();
  if (mainWindow) mainWindow.minimize();

  const loadedScript = await loadLuaScript(() => {
    if (mainWindow) mainWindow.restore();
  });

  return loadedScript;
});

// Save Lua script package (all scripts or selected)
ipcMain.handle('save-lua-script-package', async (event, scripts) => {
  const mainWindow = getMainWindow();
  if (mainWindow) mainWindow.minimize();

  await saveLuaScriptPackage(scripts, () => {
    if (mainWindow) mainWindow.restore();
  });
});

// Load Lua script package
ipcMain.handle('load-lua-script-package', async () => {
  const mainWindow = getMainWindow();
  if (mainWindow) mainWindow.minimize();

  const loadedScripts = await loadLuaScriptPackage(() => {
    if (mainWindow) mainWindow.restore();
  });

  return loadedScripts;
});
