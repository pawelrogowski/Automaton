import { app, ipcMain, BrowserWindow, dialog } from 'electron';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import { createMainWindow, getMainWindow } from './createMainWindow.js';
import './ipcListeners.js';
import { unregisterGlobalShortcuts } from './globalShortcuts.js';
import workerManager from './workerManager.js';
import { getLinuxHardwareId } from './hardwareId.js';
import { initializeStore, quitStore } from '../store/store.js';

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
    type: 'notification',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  });

  const loginHtmlPath = path.join(cwd, 'loginWindow', 'loginWindow.html');
  loginWindow.loadFile(loginHtmlPath);
};

// Application initialization
app.whenReady().then(async () => {
  try {
    await initializeStore();
    workerManager.initialize(app, cwd);
    createLoginWindow();

    ipcMain.on('login-success', () => {
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      createMainWindow();
    });
  } catch (error) {
    console.error('[Main] FATAL: Error during application startup:', error);
    dialog.showErrorBox(
      'Application Startup Error',
      `Failed to initialize critical components: ${error.message}\n\nPlease check logs for details. The application will now exit.`,
    );
    app.quit();
  }
});

app.on('before-quit', async () => {
  console.log('[Main] Preparing to quit application...');
  console.log('[Main] Closing store connection...');
  try {
    await quitStore();
  } catch (error) {
    console.error('[Main] Error closing store connection:', error);
  }
  unregisterGlobalShortcuts();
  console.log('[Main] Application cleanup finished.');
});

app.on('window-all-closed', () => {
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

export default app;
