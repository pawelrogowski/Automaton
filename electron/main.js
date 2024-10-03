import { app, ipcMain, BrowserWindow } from 'electron';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import path from 'path';
import { createMainWindow, getMainWindow } from './createMainWindow.js';
import './ipcListeners.js';
import store from './store.js';
import setGlobalState from './setGlobalState.js';
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './globalShortcuts.js';
import {
  saveRulesToFile,
  loadRulesFromFile,
  autoSaveRules,
  autoLoadRules,
} from './rulesManager.js';

// Set up some basic path stuff
const filename = fileURLToPath(import.meta.url);
const cwd = dirname(filename);
const preloadPath = path.join(cwd, '/preload.js');

let xdotoolPath;
if (app.isPackaged) {
  xdotoolPath = path.join(app.getAppPath(), '..', 'resources', 'xdotool', 'xdotool');
} else {
  xdotoolPath = path.join(cwd, 'resources', 'xdotool', 'xdotool');
}

// Initialize some variables we'll need later
let ScreenMonitor = null;
let prevWindowId = null;
let loginWindow;

// Function to reset our worker threads
export const resetWorkers = () => {
  if (ScreenMonitor) {
    ScreenMonitor.terminate();
    ScreenMonitor = null;
  }
};

// Keep an eye on our store for changes
store.subscribe(() => {
  const state = store.getState();
  const { windowId } = state.global;

  // If we have a ScreenMonitor, let's keep it up to date
  if (ScreenMonitor) {
    ScreenMonitor.postMessage(state);
  }

  // If the window ID changed, we need to reset our workers
  if (windowId !== prevWindowId) {
    resetWorkers();
  }

  // If we don't have a ScreenMonitor but we do have a window ID, let's set one up
  if (!ScreenMonitor && windowId) {
    const screenMonitorWorkerPath = resolve(cwd, './workers', 'screenMonitor.js');
    ScreenMonitor = new Worker(screenMonitorWorkerPath, {
      name: 'screenMonitor.js',
      workerData: { xdotoolPath },
    });

    // Handle messages from our ScreenMonitor
    ScreenMonitor.on('message', (message) => {
      if (message.type) {
        setGlobalState(`gameState/${message.type}`, message.payload);
      } else {
        setGlobalState('gameState/setCharacterStatus', message.payload);
      }
    });

    // Uh oh, something went wrong with our ScreenMonitor
    ScreenMonitor.on('error', (error) => {
      console.error('Oops! Something went wrong with our ScreenMonitor:', error);
      resetWorkers();
    });

    ScreenMonitor.postMessage(state);
  }

  prevWindowId = windowId;
});

// Handle saving rules
ipcMain.on('save-rules', async () => {
  const mainWindow = getMainWindow();
  mainWindow.minimize();
  await saveRulesToFile(() => {
    mainWindow.restore();
  });
});

// Handle loading rules
ipcMain.handle('load-rules', async () => {
  const mainWindow = getMainWindow();
  mainWindow.minimize();
  await loadRulesFromFile(() => {
    mainWindow.restore();
  });
});

// The renderer is ready, let's set some things up
ipcMain.on('renderer-ready', () => {
  autoLoadRules();
  registerGlobalShortcuts();
});

// When the app is ready, let's get this party started
app.whenReady().then(() => {
  try {
    // Create our login window
    loginWindow = new BrowserWindow({
      width: 360,
      height: 400,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: preloadPath,
      },
    });

    const loginHtmlPath = path.join(cwd, 'loginWindow', 'loginWindow.html');
    loginWindow.loadFile(loginHtmlPath);

    // If the login window is closed and we don't have a main window, quit the app
    loginWindow.on('close', () => {
      if (!getMainWindow()) app.quit();
    });

    // When login is successful, close the login window and create the main window
    ipcMain.on('login-success', () => {
      loginWindow.close();
      createMainWindow();
    });
  } catch (error) {
    console.error("Well, this is embarrassing. We couldn't start the login window:", error);
  }
});

// Clean up before we quit
app.on('before-quit', async () => {
  if (ScreenMonitor) {
    ScreenMonitor.terminate();
    ScreenMonitor = null;
  }
  await autoSaveRules();
});

// Unregister our shortcuts before we go
app.on('will-quit', async () => {
  if (ScreenMonitor) {
    ScreenMonitor.terminate();
    ScreenMonitor = null;
  }
  unregisterGlobalShortcuts();
  await autoSaveRules();
});

// If all windows are closed, quit the app (except on macOS)
app.on('window-all-closed', async () => {
  if (ScreenMonitor) {
    ScreenMonitor.terminate();
    ScreenMonitor = null;
  }
  await autoSaveRules();
  app.quit();
});
