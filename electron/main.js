import {
  app,
  ipcMain,
  BrowserWindow,
  dialog,
  Tray,
  Menu,
  nativeImage,
} from 'electron';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import {
  createMainWindow,
  toggleWidgetWindowVisibility,
  getWidgetWindow, // Import getWidgetWindow
} from './createMainWindow.js';
import './ipcListeners.js';
import {
  unregisterGlobalShortcuts,
  registerGlobalShortcuts,
} from './globalShortcuts.js';
import { getLinuxHardwareId } from './hardwareId.js';
import { autoLoadRules } from './saveManager.js';
import { createLogger } from './utils/logger.js';
import workerManager from './workerManager.js';
import windowinfo from 'windowinfo-native';
import setGlobalState from './setGlobalState.js';
import store from './store.js'; // Import the store

const filename = fileURLToPath(import.meta.url);
const cwd = dirname(filename);
const preloadPath = path.join(cwd, '/preload.js');
const log = createLogger();

let selectWindow;
let mainWindow;
let isQuitting = false;

const createSelectWindow = () => {
  selectWindow = new BrowserWindow({
    width: 600,
    height: 400,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    devTools: false,
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(cwd, 'selectWindow', 'preload.js'),
    },
  });

  const selectHtmlPath = path.join(cwd, 'selectWindow', 'selectWindow.html');
  selectWindow.loadFile(selectHtmlPath);

  selectWindow.on('closed', () => {
    selectWindow = null;
    if (!isQuitting && !mainWindow) {
      app.quit();
    }
  });
};

app.whenReady().then(async () => {
  try {
    await autoLoadRules();
    createSelectWindow();

    workerManager.initialize(app, cwd, {});
    registerGlobalShortcuts(); // Register global shortcuts on startup
    setGlobalState('global/setGlobalShortcutsEnabled', true); // Set default to enabled
  } catch (error) {
    console.error('[Main] FATAL: Error during application startup:', error);
    dialog.showErrorBox(
      'Application Startup Error',
      `Failed to initialize critical components: ${error.message}\n\nPlease check logs for details. The application will now exit.`,
    );
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  event.preventDefault();
  console.log('[Main] App is quitting. Terminating all workers...');
  await workerManager.stopAllWorkers();
  console.log('[Main] All workers terminated. Exiting now.');
  app.exit();
});
app.on('window-all-closed', () => {
  log('info', '[Main] All windows closed, initiating app quit.');
  app.quit();
});

ipcMain.handle('get-hardware-id', () => {
  try {
    return getLinuxHardwareId();
  } catch (error) {
    console.error('Hardware ID error:', error);
    return 'error-failed-retrieval';
  }
});

ipcMain.handle('get-tibia-window-list', async () => {
  try {
    const windowList = await windowinfo.getWindowList();
    return windowList;
  } catch (error) {
    console.error('[Main] Error getting Tibia window list:', error);
    return [];
  }
});

ipcMain.on('select-tibia-window', (event, windowId, display, windowName) => {
  if (selectWindow && !selectWindow.isDestroyed()) {
    selectWindow.close();
  }
  setGlobalState('global/setWindowId', windowId);
  setGlobalState('global/setDisplay', display);
  setGlobalState('global/setWindowName', windowName);

  mainWindow = createMainWindow(windowId, display, windowName);
});

ipcMain.on('exit-app', () => {
  isQuitting = true;
  app.quit();
});

ipcMain.on('update-bot-status', (event, { feature, isEnabled }) => {
  console.log(`[Main] Received update from widget: ${feature} - ${isEnabled}`);
  switch (feature) {
    case 'healing':
      setGlobalState('rules/setenabled', isEnabled);
      break;
    case 'cavebot':
      setGlobalState('cavebot/setenabled', isEnabled);
      break;
    case 'targeting':
      setGlobalState('targeting/setenabled', isEnabled);
      break;
    case 'scripts':
      setGlobalState('lua/setenabled', isEnabled);
      break;
    default:
      console.warn(`[Main] Unknown feature received from widget: ${feature}`);
  }
});

// Store subscription to send state updates to the widget window
let previousRulesEnabled = false;
let previousCavebotEnabled = false;
let previousTargetingEnabled = false;
let previousLuaEnabled = false;

store.subscribe(() => {
  const state = store.getState();
  const widgetWindow = getWidgetWindow();

  if (widgetWindow && !widgetWindow.isDestroyed()) {
    const currentRulesEnabled = state.rules.enabled;
    const currentCavebotEnabled = state.cavebot.enabled;
    const currentTargetingEnabled = state.targeting.enabled;
    const currentLuaEnabled = state.lua.enabled;

    if (currentRulesEnabled !== previousRulesEnabled) {
      widgetWindow.webContents.send('state-update', {
        type: 'rules/setenabled',
        payload: currentRulesEnabled,
      });
      previousRulesEnabled = currentRulesEnabled;
    }

    if (currentCavebotEnabled !== previousCavebotEnabled) {
      widgetWindow.webContents.send('state-update', {
        type: 'cavebot/setenabled',
        payload: currentCavebotEnabled,
      });
      previousCavebotEnabled = currentCavebotEnabled;
    }

    if (currentTargetingEnabled !== previousTargetingEnabled) {
      widgetWindow.webContents.send('state-update', {
        type: 'targeting/setenabled',
        payload: currentTargetingEnabled,
      });
      previousTargetingEnabled = currentTargetingEnabled;
    }

    if (currentLuaEnabled !== previousLuaEnabled) {
      widgetWindow.webContents.send('state-update', {
        type: 'lua/setenabled',
        payload: currentLuaEnabled,
      });
      previousLuaEnabled = currentLuaEnabled;
    }
  }
});

export default app;
