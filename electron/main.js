// /home/orimorfus/Documents/Automaton/electron/main.js
import { app, ipcMain, BrowserWindow, dialog } from 'electron';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import { appendFile } from 'fs/promises'; // <-- ADDED FOR LOGGING
import { createMainWindow } from './createMainWindow.js';
import './ipcListeners.js';
import { unregisterGlobalShortcuts } from './globalShortcuts.js';
import { getLinuxHardwareId } from './hardwareId.js';
import { createLogger } from './utils/logger.js';
import workerManager from './workerManager.js';

// --- Main Process Memory Logging Setup ---
const MAIN_LOG_INTERVAL_MS = 10000; // 10 seconds
const MAIN_LOG_FILE_NAME = 'main-process-memory-usage.log';
const MAIN_LOG_FILE_PATH = path.join(process.cwd(), MAIN_LOG_FILE_NAME);

const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

async function logMainProcessMemoryUsage() {
  try {
    const memoryUsage = process.memoryUsage();
    const timestamp = new Date().toISOString();
    const logEntry =
      `${timestamp} | ` +
      `RSS: ${toMB(memoryUsage.rss)} MB, ` +
      `HeapTotal: ${toMB(memoryUsage.heapTotal)} MB, ` +
      `HeapUsed: ${toMB(memoryUsage.heapUsed)} MB, ` +
      `External: ${toMB(memoryUsage.external)} MB\n`;

    await appendFile(MAIN_LOG_FILE_PATH, logEntry);
  } catch (error) {
    console.error(
      '[Main MemoryLogger] Failed to write to memory log file:',
      error,
    );
  }
}
// --- End of Main Process Memory Logging Setup ---

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
    workerManager.initialize(app, cwd, {}); // Pass an empty config to use default (all disabled)

    // --- Start Main Process Memory Logging ---
    (async () => {
      try {
        const header = `\n--- Main Process Session Started at ${new Date().toISOString()} ---\n`;
        await appendFile(MAIN_LOG_FILE_PATH, header);
        console.log(
          `[Main MemoryLogger] Memory usage logging is active. Outputting to ${MAIN_LOG_FILE_PATH}`,
        );

        // Log immediately on start
        await logMainProcessMemoryUsage();

        // Start the periodic logging. This is safe in the main process.
        setInterval(logMainProcessMemoryUsage, MAIN_LOG_INTERVAL_MS);
      } catch (error) {
        console.error(
          '[Main MemoryLogger] Could not initialize memory log file:',
          error,
        );
      }
    })();
    // --- End of Main Process Memory Logging ---
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
  event.preventDefault(); // Prevent the app from quitting immediately
  console.log('[Main] App is quitting. Terminating all workers...');
  await workerManager.stopAllWorkers(); // Wait for all workers to stop
  console.log('[Main] All workers terminated. Exiting now.');
  app.exit(); // Now, exit the app
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
