// /home/orimorfus/Documents/Automaton/electron/main.js
import { app, ipcMain, BrowserWindow, dialog } from 'electron';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import { createMainWindow } from './createMainWindow.js';
import './ipcListeners.js';
import { unregisterGlobalShortcuts } from './globalShortcuts.js';
import { getLinuxHardwareId } from './hardwareId.js';
import { createLogger } from './utils/logger.js';
import workerManager from './workerManager.js'; // Keep this import, it's still needed for initialization

const filename = fileURLToPath(import.meta.url);
const cwd = dirname(filename);
const preloadPath = path.join(cwd, '/preload.js');
const log = createLogger();

let loginWindow;
let isQuitting = false;

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

app.on('before-quit', async (event) => {
  if (isQuitting) {
    return; // Already in the process of quitting, do nothing.
  }

  // 1. Prevent the application from closing immediately.
  event.preventDefault();
  isQuitting = true;

  log('info', '[Main] Graceful shutdown initiated...');

  // 2. Show a confirmation dialog to the user.
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Yes, Quit', 'No, Cancel'],
    defaultId: 1,
    title: 'Confirm Quit',
    message: 'Are you sure you want to quit the application?',
    cancelId: 1,
  });

  if (response === 1) {
    // User clicked "No, Cancel"
    isQuitting = false;
    log('info', '[Main] Shutdown cancelled by user.');
    return;
  }

  // 3. User confirmed. Proceed with cleanup.
  try {
    log('info', '[Main] Terminating all workers...');
    await workerManager.stopAllWorkers(); // Wait for all workers to stop.

    log('info', '[Main] Unregistering global shortcuts...');
    unregisterGlobalShortcuts();

    log('info', '[Main] Application cleanup finished. Exiting now.');
  } catch (error) {
    log('error', '[Main] Error during shutdown cleanup:', error);
  } finally {
    // 4. After all cleanup, allow the app to finally quit.
    // We call app.quit() again, but since isQuitting is true, it will now exit.
    app.exit();
  }
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

export default app;
