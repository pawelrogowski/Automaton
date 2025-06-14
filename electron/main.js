// /home/orimorfus/Documents/Automaton/electron/main.js
import { app, ipcMain, BrowserWindow, dialog } from 'electron';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import { createMainWindow } from './createMainWindow.js';
import './ipcListeners.js';
import { unregisterGlobalShortcuts } from './globalShortcuts.js';
import workerManager from './workerManager.js';
import { getLinuxHardwareId } from './hardwareId.js';
import { createLogger } from './utils/logger.js';

const filename = fileURLToPath(import.meta.url);
const cwd = dirname(filename);
const preloadPath = path.join(cwd, '/preload.js');
const log = createLogger();

let loginWindow;

const createLoginWindow = () => {
  loginWindow = new BrowserWindow({
    width: 360,
    height: 420,
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
    // createLoginWindow();
    // ipcMain.on('login-success', () => {
    //   if (loginWindow && !loginWindow.isDestroyed()) {
    //     loginWindow.close();
    //   }

    //   createMainWindow();
    // });
    createMainWindow();
    workerManager.initialize(app, cwd);
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
  try {
  } catch (error) {
    log('error', `[Main] ${error}`);
  }
  unregisterGlobalShortcuts();
  log('info', '[Main] Application cleanup finished.');
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
