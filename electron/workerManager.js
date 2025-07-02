import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import store from './store.js';
import setGlobalState from './setGlobalState.js';
import { showNotification } from './notificationHandler.js';
import { createLogger } from './utils/logger.js';
import { BrowserWindow } from 'electron';
import { playSound } from './globalShortcuts.js';
const log = createLogger();

const MAX_RESTART_ATTEMPTS = 5;
const RESTART_COOLDOWN = 500;
const RESTART_LOCK_TIMEOUT = 5000;
const WORKER_INIT_DELAY = 50;

class WorkerManager {
  constructor() {
    const filename = fileURLToPath(import.meta.url);
    this.electronDir = dirname(filename);

    this.workers = new Map();
    this.workerPaths = new Map();
    this.prevWindowId = null;
    this.restartLocks = new Map();
    this.restartAttempts = new Map();
    this.restartTimeouts = new Map();

    // <<< ADDED: State for shared screen capture buffers
    this.sharedScreenState = null;

    this.paths = {
      utils: null,
      workers: null,
    };

    this.handleWorkerError = this.handleWorkerError.bind(this);
    this.handleWorkerExit = this.handleWorkerExit.bind(this);
    this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
    this.handleStoreUpdate = this.handleStoreUpdate.bind(this);
  }

  setupPaths(app, cwd) {
    if (app.isPackaged) {
      this.paths.utils = path.join(app.getAppPath(), '..', 'resources', 'x11utils');
    } else {
      this.paths.utils = path.join(cwd, '..', 'resources', 'x11utils');
    }
    this.paths.useItemOn = path.join(this.paths.utils, 'useItemOn.node');

    if (!app.isPackaged) {
      log('info', '[Worker Manager] Paths initialized:', this.paths);
    }
  }

  resetRestartState(name) {
    this.restartLocks.set(name, false);
    this.restartAttempts.set(name, 0);
    clearTimeout(this.restartTimeouts.get(name));
    this.restartTimeouts.delete(name);
  }

  async clearRestartLockWithTimeout(name) {
    const timeout = setTimeout(() => {
      log('warn', `[Worker Manager] Force clearing restart lock: ${name}`);
      this.resetRestartState(name);
    }, RESTART_LOCK_TIMEOUT);

    this.restartTimeouts.set(name, timeout);
  }

  getWorkerPath(workerName) {
    const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(workerName);

    // <<< MODIFIED: Handle the new captureWorker
    // The generic logic already works, but this shows how it fits.
    // 'captureWorker' is not a UUID, so it will fall through correctly.
    if (isUUID) {
      return resolve(this.electronDir, './workers', 'luaScriptWorker.js');
    }
    // For 'screenMonitor', 'captureWorker', etc.
    return resolve(this.electronDir, './workers', `${workerName}.js`);
  }

  // +++ ADDED: New method to create and initialize shared buffers +++
  createSharedBuffers() {
    // Allocate a large buffer for the screen image data (e.g., 2560x1600 @ 4 bytes/pixel)
    const maxImageSize = 2560 * 1600 * 4;
    const imageSAB = new SharedArrayBuffer(maxImageSize);

    // Allocate a small buffer for synchronization and metadata.
    // Index 0: Frame Counter (incremented by producer)
    // Index 1: Image Width
    // Index 2: Image Height
    // Index 3: Is Running Flag (1 for running, 0 for stopped)
    // Index 4: Window ID
    const syncSAB = new SharedArrayBuffer(5 * Int32Array.BYTES_PER_ELEMENT);

    this.sharedScreenState = {
      imageSAB,
      syncSAB,
    };
    log('info', '[Worker Manager] Created SharedArrayBuffers for screen capture.');
  }

  // ... handleWorkerError and handleWorkerExit remain unchanged ...
  handleWorkerError(name, error) {
    log('error', `[Worker Manager] Worker error: ${name}`, error);
    if (!name.startsWith('script-') && !this.restartLocks.get(name)) {
      this.restartWorker(name).catch((err) => {
        log('error', `[Worker Manager] Restart failed after error: ${name}`, err);
      });
    } else if (name.startsWith('script-')) {
      log('info', `[Worker Manager] Script worker ${name} encountered an error. Lifecycle managed by store updates.`);
      this.workers.delete(name);
    }
  }

  handleWorkerExit(name, code) {
    log('info', `[Worker Manager] Worker exited: ${name}, code ${code}`);
    this.workers.delete(name);
    this.workerPaths.delete(name);

    const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(name);
    if (!isUUID && code !== 0) {
      const attempts = this.restartAttempts.get(name) || 0;
      if (!this.restartLocks.get(name) && attempts < MAX_RESTART_ATTEMPTS) {
        log(
          'error',
          `[Worker Manager] Non-script worker exited with error: ${name}, code ${code}, attempt ${attempts + 1}/${MAX_RESTART_ATTEMPTS}`,
        );
        setTimeout(
          () => {
            this.restartWorker(name).catch((err) => log('error', `Failed to restart worker ${name} after exit:`, err));
          },
          RESTART_COOLDOWN * (attempts + 1),
        );
      } else if (attempts >= MAX_RESTART_ATTEMPTS) {
        log('error', `[Worker Manager] Max restart attempts reached for non-script worker: ${name}`);
        this.resetRestartState(name);
      }
    }
  }

  // ... handleWorkerMessage remains unchanged ...
  handleWorkerMessage(message) {
    if (message.notification) {
      showNotification(message.notification.title, message.notification.body);
    }
    if (message.storeUpdate) {
      setGlobalState(message.type, message.payload);
    } else if (['scriptError', 'luaPrint', 'luaStatusUpdate'].includes(message.type)) {
      const { scriptId, message: logMessage } = message;
      if (scriptId) {
        setGlobalState('lua/addLogEntry', { id: scriptId, message: logMessage });
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) win.webContents.send('script-log-update', { scriptId, message: logMessage });
        });
      }
    } else if (message.type === 'play_alert') {
      playSound('alert.wav');
    }
  }

  // <<< MODIFIED: To pass shared buffers to relevant workers
  startWorker(name, scriptConfig = null, paths = null) {
    log('debug', `[Worker Manager] Attempting to start worker: ${name}`);
    if (this.workers.has(name)) {
      log('warn', `[Worker Manager] Worker already exists: ${name}`);
      return this.workers.get(name).worker;
    }

    try {
      const workerPath = this.getWorkerPath(name);
      log('debug', `[Worker Manager] Resolved worker path for ${name}: ${workerPath}`);

      // Determine if this worker needs the shared screen data
      const needsSharedScreen = ['captureWorker', 'screenMonitor', 'minimapMonitor'].includes(name);

      const worker = new Worker(workerPath, {
        name,
        workerData: {
          paths: paths || this.paths,
          // Pass the shared state ONLY if the worker needs it
          sharedData: needsSharedScreen ? this.sharedScreenState : null,
        },
      });

      this.workerPaths.set(name, workerPath);
      worker.on('message', (msg) => this.handleWorkerMessage(msg));
      worker.on('error', (error) => this.handleWorkerError(name, error));
      worker.on('exit', (code) => this.handleWorkerExit(name, code));

      this.workers.set(name, { worker, config: scriptConfig });
      log('info', `[Worker Manager] Worker ${name} started successfully.`);

      setTimeout(() => {
        if (scriptConfig) {
          worker.postMessage({ type: 'init', script: scriptConfig });
          worker.postMessage({ type: 'stateUpdate', state: store.getState() });
        } else {
          // Send initial state to non-script workers (like pathfinder)
          // Screen workers get their state from the shared buffer
          if (!needsSharedScreen) {
            worker.postMessage(store.getState());
          }
        }
      }, WORKER_INIT_DELAY);

      return worker;
    } catch (error) {
      log('error', `[Worker Manager] Failed to start worker: ${name}`, error);
      return null;
    }
  }

  // ... restartWorker and stopWorker remain unchanged ...
  async restartWorker(name, scriptConfig = null) {
    if (this.restartLocks.get(name)) {
      log('info', `[Worker Manager] Restart in progress: ${name}`);
      return null;
    }
    this.restartLocks.set(name, true);
    this.restartAttempts.set(name, (this.restartAttempts.get(name) || 0) + 1);
    this.clearRestartLockWithTimeout(name);
    try {
      await this.stopWorker(name);
      await new Promise((resolve) => setTimeout(resolve, WORKER_INIT_DELAY));
      const newWorker = this.startWorker(name, scriptConfig, this.paths);
      if (!newWorker) throw new Error(`Failed to create new worker: ${name}`);
      log('info', `[Worker Manager] Worker ${name} restarted successfully.`);
      return newWorker;
    } catch (error) {
      log('error', `[Worker Manager] Error during restart: ${name}`, error);
      this.resetRestartState(name);
    } finally {
      setTimeout(() => this.restartLocks.set(name, false), RESTART_COOLDOWN);
    }
  }

  async stopWorker(name) {
    const workerEntry = this.workers.get(name);
    if (workerEntry && workerEntry.worker) {
      try {
        await workerEntry.worker.terminate();
        log('info', `[Worker Manager] Worker ${name} terminated successfully.`);
      } catch (error) {
        log('error', `[Worker Manager] Error terminating worker: ${name}`, error);
      }
      this.workers.delete(name);
      this.workerPaths.delete(name);
    }
  }

  stopAllWorkers() {
    log('info', '[Worker Manager] Stopping all workers.');
    for (const [name] of this.workers) {
      this.stopWorker(name);
    }
  }

  // <<< MODIFIED: The core logic for managing workers based on state
  handleStoreUpdate() {
    log('debug', '[Worker Manager] handleStoreUpdate triggered.');
    const state = store.getState();
    const { windowId } = state.global;
    const { enabled: cavebotEnabled } = state.cavebot;

    // --- Screen Capture and Analysis Workers Lifecycle ---
    if (windowId) {
      // 1. Create shared buffers if they don't exist
      if (!this.sharedScreenState) {
        this.createSharedBuffers();
      }

      // 2. Update the window ID in the sync buffer for the capture worker
      const syncArray = new Int32Array(this.sharedScreenState.syncSAB);
      Atomics.store(syncArray, 4 /* WINDOW_ID_INDEX */, parseInt(windowId, 10) || 0);

      // 3. Start the producer worker (captureWorker)
      if (!this.workers.has('captureWorker')) {
        log('info', '[Worker Manager] Starting captureWorker.');
        this.startWorker('captureWorker');
      }

      // 4. Start consumer workers (screenMonitor, minimapMonitor)
      if (!this.workers.has('screenMonitor')) {
        log('info', '[Worker Manager] Starting screenMonitor.');
        this.startWorker('screenMonitor', null, this.paths);
      }
      if (!this.workers.has('minimapMonitor')) {
        log('info', '[Worker Manager] Starting minimapMonitor.');
        this.startWorker('minimapMonitor', null, this.paths);
      }
    } else {
      // If no window ID, stop all screen-related workers and clear shared state
      if (this.workers.has('captureWorker')) this.stopWorker('captureWorker');
      if (this.workers.has('screenMonitor')) this.stopWorker('screenMonitor');
      if (this.workers.has('minimapMonitor')) this.stopWorker('minimapMonitor');

      if (this.sharedScreenState) {
        log('info', '[Worker Manager] Clearing SharedArrayBuffers.');
        this.sharedScreenState = null;
      }
    }

    // --- Other Workers (pathfinder, pathFollower) ---
    if (windowId) {
      if (!this.workers.has('pathfinderWorker')) {
        this.startWorker('pathfinderWorker', null, this.paths);
      }
      if (cavebotEnabled && !this.workers.has('pathFollowerWorker')) {
        this.startWorker('pathFollowerWorker', null, this.paths);
      }
    } else {
      if (this.workers.has('pathfinderWorker')) this.stopWorker('pathfinderWorker');
    }

    if (!cavebotEnabled && this.workers.has('pathFollowerWorker')) {
      this.stopWorker('pathFollowerWorker');
    }

    // --- Lua Script Workers Lifecycle (Unchanged) ---
    const currentEnabledPersistentScripts = state.lua.persistentScripts.filter((script) => script.enabled);
    const activeScriptIds = new Set(currentEnabledPersistentScripts.map((script) => script.id));
    const runningScriptWorkerIds = new Set(Array.from(this.workers.keys()).filter((name) => /^[0-9a-fA-F]{8}-/.test(name)));

    // Stop workers for disabled scripts
    for (const scriptId of runningScriptWorkerIds) {
      if (!activeScriptIds.has(scriptId)) {
        log('info', `[Worker Manager] Stopping worker for script: ${scriptId}.`);
        this.stopWorker(scriptId);
      }
    }

    // Start or update workers for enabled scripts
    for (const script of currentEnabledPersistentScripts) {
      const workerName = script.id;
      const workerEntry = this.workers.get(workerName);
      if (!workerEntry) {
        this.startWorker(workerName, script, this.paths);
      } else {
        const oldConfig = workerEntry.config;
        if (oldConfig.code !== script.code || oldConfig.loopMin !== script.loopMin || oldConfig.loopMax !== script.loopMax) {
          this.restartWorker(workerName, script);
        }
      }
    }

    // --- State Updates for All Running Workers ---
    for (const [name, workerEntry] of this.workers) {
      const isUUID = /^[0-9a-fA-F]{8}-/.test(name);
      // Don't send state updates to screen workers (they get it from shared buffer)
      // or to workers that are being restarted.
      if (!['captureWorker', 'screenMonitor', 'minimapMonitor'].includes(name) && !this.restartLocks.get(name)) {
        if (workerEntry.worker) {
          log('debug', `[Worker Manager] Sending state update to worker: ${name}`);
          // Lua scripts expect a specific message format
          if (isUUID) {
            workerEntry.worker.postMessage({ type: 'stateUpdate', state });
          } else {
            // Other workers (pathfinder) expect the raw state
            workerEntry.worker.postMessage(state);
          }
        }
      }
    }
  }

  initialize(app, cwd) {
    this.setupPaths(app, cwd);
    log('info', '[Worker Manager] Initializing worker manager. Subscribing to store updates.');
    store.subscribe(this.handleStoreUpdate);

    const quitHandler = () => {
      log('info', '[Worker Manager] App quitting. Stopping all workers.');
      this.stopAllWorkers();
    };

    app.on('before-quit', quitHandler);
    app.on('will-quit', quitHandler);
    app.on('window-all-closed', quitHandler);
  }
}

const workerManager = new WorkerManager();
export default workerManager;
