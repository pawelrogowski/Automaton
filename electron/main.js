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

// Set environment variables
process.env.XDG_SESSION_TYPE = 'x11';
process.env.ELECTRON_OZONE_PLATFORM_HINT = 'x11';
process.env.GDK_BACKEND = 'x11';

// Get application paths
const filename = fileURLToPath(import.meta.url);
const cwd = dirname(filename);
const preloadPath = path.join(cwd, '/preload.js');

class WorkerManager {
  constructor() {
    this.workers = new Map();
    this.prevWindowId = null;
    this.paths = {
      x11capture: null,
      keypress: null,
      useItemOn: null,
      windowInfo: null,
      sequenceFinder: null,
    };
  }

  setupPaths(app, cwd) {
    const basePath = app.isPackaged
      ? path.join(app.getAppPath(), '..', 'resources', 'x11utils')
      : path.join(cwd, '..', 'resources', 'x11utils');

    this.paths = {
      x11capturePath: path.join(basePath, 'x11capture.node'),
      keypressPath: path.join(basePath, 'keypress.node'),
      useItemOnPath: path.join(basePath, 'useItemOn.node'),
      windowInfoPath: path.join(basePath, 'windowinfo.node'),
      sequenceFinderPath: path.join(basePath, 'sequence_finder.node'),
    };
  }

  startWorker(name, workerPath) {
    if (this.workers.has(name)) {
      console.warn(`Worker ${name} already exists`);
      return;
    }

    const worker = new Worker(workerPath, {
      name,
      workerData: this.paths, // Pass the paths directly as workerData
    });

    worker.on('message', (message) => {
      if (message.storeUpdate) {
        setGlobalState(`gameState/${message.type}`, message.payload);
      }
    });

    worker.on('error', (error) => {
      console.error(`Worker ${name} encountered an error:`, error);
      this.stopWorker(name);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`Worker ${name} exited with code ${code}`);
      }
      this.workers.delete(name);
    });

    this.workers.set(name, worker);
    return worker;
  }

  stopWorker(name) {
    const worker = this.workers.get(name);
    if (worker) {
      worker.terminate();
      this.workers.delete(name);
    }
  }

  stopAllWorkers() {
    for (const [name] of this.workers) {
      this.stopWorker(name);
    }
  }

  handleStoreUpdate() {
    const state = store.getState();
    const { windowId } = state.global;

    // Handle window ID changes
    if (windowId !== this.prevWindowId) {
      this.stopAllWorkers();
    }

    // Start screen monitor if needed
    if (windowId && !this.workers.has('screenMonitor')) {
      const screenMonitorWorkerPath = resolve(cwd, './workers', 'screenMonitor.js');
      const worker = this.startWorker('screenMonitor', screenMonitorWorkerPath);
      if (worker) {
        worker.postMessage(state);
      }
    }

    // Update all active workers with new state
    for (const [, worker] of this.workers) {
      worker.postMessage(state);
    }

    this.prevWindowId = windowId;
  }

  initialize(app, cwd) {
    this.setupPaths(app, cwd);
    store.subscribe(this.handleStoreUpdate.bind(this));

    // Setup cleanup handlers
    app.on('before-quit', this.stopAllWorkers.bind(this));
    app.on('will-quit', this.stopAllWorkers.bind(this));
    app.on('window-all-closed', this.stopAllWorkers.bind(this));
  }
}

// Create worker manager instance
const workerManager = new WorkerManager();

// Initialize login window
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
