import { app, ipcMain, BrowserWindow } from 'electron';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import path from 'path';
import { createMainWindow, getMainWindow } from './createMainWindow.js';
import './ipcListeners.js';
import store from './store.js';
import setGlobalState from './setGlobalState.js';
import { unregisterGlobalShortcuts } from './globalShortcuts.js';

process.env.XDG_SESSION_TYPE = 'x11';
process.env.ELECTRON_OZONE_PLATFORM_HINT = 'x11';
process.env.GDK_BACKEND = 'x11';
const filename = fileURLToPath(import.meta.url);
const cwd = dirname(filename);
const preloadPath = path.join(cwd, '/preload.js');

let xdotoolPath;

if (app.isPackaged) {
  xdotoolPath = path.join(app.getAppPath(), '..', 'resources', 'xdotool', 'xdotool');
} else {
  xdotoolPath = path.join(cwd, 'resources', 'xdotool', 'xdotool');
}

let ScreenMonitor = null;
let prevWindowId = null;
let loginWindow;

export const resetWorkers = () => {
  if (ScreenMonitor) {
    ScreenMonitor.terminate();
    ScreenMonitor = null;
  }
};

store.subscribe(() => {
  const state = store.getState();
  const { windowId } = state.global;

  if (ScreenMonitor) {
    ScreenMonitor.postMessage(state);
  }

  if (windowId !== prevWindowId) {
    resetWorkers();
  }

  if (!ScreenMonitor && windowId) {
    const screenMonitorWorkerPath = resolve(cwd, './workers', 'screenMonitor.js');
    ScreenMonitor = new Worker(screenMonitorWorkerPath, {
      name: 'screenMonitor.js',
      workerData: { xdotoolPath },
    });

    ScreenMonitor.on('message', (message) => {
      if (message.storeUpdate) {
        setGlobalState(`gameState/${message.type}`, message.payload);
      }
    });

    ScreenMonitor.on('error', (error) => {
      console.error('resetting screen monitor worker due to an unexpected error...');
      resetWorkers();
    });

    ScreenMonitor.postMessage(state);
  }

  prevWindowId = windowId;
});

app.whenReady().then(() => {
  try {
    loginWindow = new BrowserWindow({
      width: 360,
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
        preload: preloadPath,
      },
    });

    const loginHtmlPath = path.join(cwd, 'loginWindow', 'loginWindow.html');
    loginWindow.loadFile(loginHtmlPath);

    loginWindow.on('close', () => {
      if (!getMainWindow()) app.quit();
    });

    ipcMain.on('login-success', () => {
      loginWindow.close();
      createMainWindow();
    });
  } catch (error) {
    console.error("couldn't start the login window:", error);
  }
});

app.on('before-quit', async () => {
  if (ScreenMonitor) {
    ScreenMonitor.terminate();
    ScreenMonitor = null;
  }
});

app.on('will-quit', async () => {
  if (ScreenMonitor) {
    ScreenMonitor.terminate();
    ScreenMonitor = null;
  }
  unregisterGlobalShortcuts();
});

app.on('window-all-closed', async () => {
  if (ScreenMonitor) {
    ScreenMonitor.terminate();
    ScreenMonitor = null;
  }
  app.quit();
});
