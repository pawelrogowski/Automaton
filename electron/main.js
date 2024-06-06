import { app, ipcMain, dialog, BrowserWindow } from 'electron';
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
let AntiIdleWorker = null;
let antiIdleWorker = null;
let prevWindowId = null;
let mainWindow = getMainWindow;
let loginWindow;

const userDataPath = app.getPath('userData');
const autoLoadFilePath = path.join(userDataPath, 'autoLoadRules.json');

store.subscribe(() => {
  const state = store.getState();
  const { global } = state;
  const { windowId } = global;

  if (ScreenMonitor) {
    ScreenMonitor.postMessage(state);
  }

  if (windowId !== prevWindowId) {
    if (ScreenMonitor) {
      ScreenMonitor.terminate();
      ScreenMonitor = null;
    }
    if (AntiIdleWorker) {
      AntiIdleWorker.terminate();
      AntiIdleWorker = null;
    }
  }

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

  if (!antiIdleWorker && windowId) {
    const antiIdleWorkerPath = resolve(cwd, './workers', 'antiIdleWorker.js');
    antiIdleWorker = new Worker(antiIdleWorkerPath, { name: 'antiIdleWorker.js' });
    console.log('antiIdle module started');

    antiIdleWorker.on('error', (error) => {
      console.error('An error occurred in the antiIdle worker:', error);
      resetWorkers();
    });
    antiIdleWorker.postMessage(state);
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
  mainWindow.minimize();
  await saveRulesToFile(() => {
    mainWindow.restore();
  });
});
ipcMain.handle('load-rules', async (event) => {
  const mainWindow = getMainWindow();
  mainWindow.minimize();
  await loadRulesFromFile(() => {
    mainWindow.restore();
  });
});

ipcMain.on('renderer-ready', (event) => {
  autoLoadRules();
  registerGlobalShortcuts();
});

app.whenReady().then(() => {
  try {
    loginWindow = new BrowserWindow({
      width: 360,
      height: 400,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(cwd, '/preload.js'),
      },
    });
    // Assuming cwd is defined and holds the path to your application's root directory
    const loginHtmlPath = path.join(cwd, 'loginWindow', 'loginWindow.html');
    loginWindow.loadFile(loginHtmlPath);

    loginWindow.on('close', () => {
      if (!mainWindow) app.quit();
    });

    // Listen for the login success event
    ipcMain.on('login-success', () => {
      loginWindow.close();
      createMainWindow();
    });
  } catch (error) {
    console.error('Error initializing login window:', error);
  }
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
