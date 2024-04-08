import { app, ipcMain, dialog } from 'electron';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';
import path from 'path';
import { createMainWindow, getMainWindow, toggleMainWindowVisibility } from './createMainWindow.js';
import './ipcListeners.js';
import { showNotification } from './notificationHandler.js';
import setupAppMenu from './menus/setupAppMenu.js';
import store from './store.js';
import setGlobalState from './setGlobalState.js';
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './globalShortcuts.js';
import {
  saveRulesToFile,
  loadRulesFromFile,
  autoSaveRules,
  autoLoadRules,
} from './rulesManager.js';

const filename = fileURLToPath(import.meta.url);
const cwd = dirname(filename);

let ScreenMonitor = null;
let HealingWorker = null;
let prevWindowId = null;
let mainWindow = getMainWindow;

const userDataPath = app.getPath('userData');
const autoLoadFilePath = path.join(userDataPath, 'autoLoadRules.json');

store.subscribe(() => {
  const state = store.getState();
  const { global } = state;
  const { windowId } = global;

  // forward state to healing worker
  if (ScreenMonitor) {
    ScreenMonitor.postMessage(state);
  }

  // reset all workers on windowId change
  if (windowId !== prevWindowId) {
    if (ScreenMonitor) {
      ScreenMonitor.terminate();
      ScreenMonitor = null;
    }
  }

  // Start a new worker with the updated state.
  if (!ScreenMonitor && windowId) {
    const screenMonitorWorkerPath = resolve(cwd, './workers', 'screenMonitor.js');
    ScreenMonitor = new Worker(screenMonitorWorkerPath, { name: 'screeenMonitor.js' });
    console.log('screen monitor started from main.js');
    ScreenMonitor.on('message', (message) => {
      if (message.type) {
        setGlobalState(`gameState/${message.type}`, message.payload);
      } else {
        setGlobalState('gameState/setCharacterStatus', message.payload);
      }
    });
    ScreenMonitor.on('error', (error) => {
      console.error('An error occurred in the worker:', error);
      resetWorkers();
    });
    ScreenMonitor.postMessage(state);
  }

  prevWindowId = windowId;
});

export const resetWorkers = () => {
  if (ScreenMonitor) {
    ScreenMonitor.terminate();
    ScreenMonitor = null;
  }
};

ipcMain.on('save-rules', async (event) => {
  const mainWindow = getMainWindow();
  mainWindow.minimize(); // Minimize the window
  await saveRulesToFile(() => {
    mainWindow.restore(); // Restore the window after saving
  });
});
ipcMain.handle('load-rules', async (event) => {
  const mainWindow = getMainWindow();
  mainWindow.minimize(); // Minimize the window
  await loadRulesFromFile(() => {
    mainWindow.restore(); // Restore the window after loading
  });
});

ipcMain.on('renderer-ready', (event) => {
  autoLoadRules();
  registerGlobalShortcuts();
});

app.whenReady().then(() => {
  mainWindow = createMainWindow();
  setupAppMenu(null);
});

app.on('before-quit', () => {
  if (ScreenMonitor) {
    ScreenMonitor.terminate();
    ScreenMonitor = null;
  }
  if (HealingWorker) {
    HealingWorker.terminate();
    HealingWorker = null;
  }
  autoSaveRules();
});

app.on('will-quit', () => {
  unregisterGlobalShortcuts();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
