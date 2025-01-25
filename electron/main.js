import { app, ipcMain, BrowserWindow } from 'electron';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import { createMainWindow, getMainWindow } from './createMainWindow.js';
import './ipcListeners.js';
import { unregisterGlobalShortcuts } from './globalShortcuts.js';
import workerManager from './workerManager.js';

const filename = fileURLToPath(import.meta.url);
const cwd = dirname(filename);
const preloadPath = path.join(cwd, '/preload.js');

let loginWindow;

const createLoginWindow = () => {
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
    alwaysOnTop: true,
    type: 'notification',
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
};

// Application initialization
app.whenReady().then(() => {
  try {
    // Initialize worker manager
    workerManager.initialize(app, cwd);

    // Create login window
    createLoginWindow();

    // Handle successful login
    ipcMain.on('login-success', () => {
      loginWindow.close();
      createMainWindow();
    });
  } catch (error) {
    console.error('Error during application startup:', error);
    app.quit();
  }
});

// Additional application event handlers
app.on('before-quit', async () => {
  unregisterGlobalShortcuts();
});

app.on('window-all-closed', () => {
  app.quit();
});

export default app;
