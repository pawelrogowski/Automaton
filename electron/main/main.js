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
import { appendFile } from 'fs/promises';
import {
  createMainWindow,
  toggleWidgetWindowVisibility,
} from './windows/createMainWindow.js';
import './ipc/ipcListeners.js';
import {
  unregisterGlobalShortcuts,
  registerGlobalShortcuts,
} from './core/globalShortcuts.js';
import { getLinuxHardwareId } from './core/hardwareId.js';
import { autoLoadRules } from './core/saveManager.js';
import { createLogger } from './utils/logger.js';
import workerManager from './core/workerManager.js';
import windowinfo from 'windowinfo-native';
import setGlobalState from './core/setGlobalState.js';

const MAIN_LOG_INTERVAL_MS = 10000;
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

const filename = fileURLToPath(import.meta.url);
const cwd = dirname(filename);
const preloadPath = path.join(cwd, '../renderer/preload/preload.js');
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
      preload: path.join(cwd, '../renderer/preload/selectWindowPreload.js'),
    },
  });

  const selectHtmlPath = path.join(
    cwd,
    '../renderer/selectWindow/selectWindow.html',
  );
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

    workerManager.initialize(app, path.join(cwd, '..'), {});
    registerGlobalShortcuts(); // Register global shortcuts on startup
    setGlobalState('global/setGlobalShortcutsEnabled', true); // Set default to enabled

    (async () => {
      try {
        const header = `\n--- Main Process Session Started at ${new Date().toISOString()} ---\n`;
        await appendFile(MAIN_LOG_FILE_PATH, header);
        console.log(
          `[Main MemoryLogger] Memory usage logging is active. Outputting to ${MAIN_LOG_FILE_PATH}`,
        );

        await logMainProcessMemoryUsage();
        setInterval(logMainProcessMemoryUsage, MAIN_LOG_INTERVAL_MS);
      } catch (error) {
        console.error(
          '[Main MemoryLogger] Could not initialize memory log file:',
          error,
        );
      }
    })();
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

export default app;
