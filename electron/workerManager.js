import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import store from './store.js';
import setGlobalState from './setGlobalState.js';
import { showNotification } from './notificationHandler.js';
import { createLogger } from './utils/logger.js';
import { BrowserWindow } from 'electron';
const log = createLogger();

const MAX_RESTART_ATTEMPTS = 5;
const RESTART_COOLDOWN = 500;
const RESTART_LOCK_TIMEOUT = 5000;
const WORKER_INIT_DELAY = 50;
const SNIPPET_SCRIPT_ID = 'script-snippet'; // Special ID for snippets

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
    this.lastEnabledPersistentScripts = []; // Store the last list sent to the worker

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

    this.paths.x11capture = path.join(this.paths.utils, 'x11RegionCapture.node');
    this.paths.keypress = path.join(this.paths.utils, 'keypress.node');
    this.paths.useItemOn = path.join(this.paths.utils, 'useItemOn.node');
    this.paths.findSequences = path.join(this.paths.utils, 'findSequences.node');

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
    return resolve(this.electronDir, './workers', `${workerName}.js`);
  }

  handleWorkerError(name, error) {
    log('error', `[Worker Manager] Worker error: ${name}`, error);
    if (!this.restartLocks.get(name)) {
      this.restartWorker(name).catch((err) => {
        log('error', `[Worker Manager] Restart failed after error: ${name}`, err);
      });
    }
  }

  handleWorkerExit(name, code) {
    const attempts = this.restartAttempts.get(name) || 0;

    if (code !== 0 && !this.restartLocks.get(name) && attempts < MAX_RESTART_ATTEMPTS) {
      log('error', `[Worker Manager] Worker exited: ${name}, code ${code}, attempt ${attempts + 1}/${MAX_RESTART_ATTEMPTS}`);
      this.workers.delete(name);

      setTimeout(
        () => {
          this.restartWorker(name).catch((err) => {
            console.error(`Failed to restart worker ${name} after exit:`, err);
          });
        },
        RESTART_COOLDOWN * (attempts + 1),
      );
    } else if (attempts >= MAX_RESTART_ATTEMPTS) {
      log('error', `[Worker Manager] Max restart attempts reached: ${name}`);
      this.resetRestartState(name);
    } else {
      this.workers.delete(name);
    }
  }

  handleWorkerMessage(message) {
    if (message.notification) {
      const { title, body } = message.notification;
      showNotification(title, body);
    }

    // Handle specific store updates originating from workers
    if (message.storeUpdate) {
      const { type, payload } = message;
      if (type) {
        setGlobalState(type, payload);
      } else {
        log('warn', '[Worker Manager] Received storeUpdate message without type.', message);
      }
    }
    // Handle messages specifically from the luaVMWorker
    else if (message.type === 'scriptResult' || message.type === 'scriptError') {
         // Mute internal log
         // log('info', `[Worker Manager] Lua script execution finished for ID: ${message.scriptId}`, message.success ? 'Success' : 'Error');

         // Always add the result/error as a log entry in the store
         const logMessage = message.success ? `[Execution Result] Success` : `[Execution Error] ${message.error}`;
         setGlobalState('lua/addLogEntry', { id: message.scriptId, message: logMessage });


         // Forward the result/error message to all renderer windows
         const { scriptId } = message; // Get scriptId from message
         const allWindows = BrowserWindow.getAllWindows();
         allWindows.forEach(win => {
             if (!win.isDestroyed()) {
                 win.webContents.send('script-log-update', { scriptId, message: logMessage });
             }
         });

    } else if (message.type === 'luaPrint') {
        const { scriptId, message: logMessage } = message;
        if (scriptId && logMessage !== undefined) {
            setGlobalState('lua/addLogEntry', { id: scriptId, message: logMessage });

            // Forward the log message to all renderer windows
            const allWindows = BrowserWindow.getAllWindows();
            allWindows.forEach(win => {
                if (!win.isDestroyed()) {
                    win.webContents.send('script-log-update', { scriptId, message: logMessage });
                }
            });
        } else {
            log('warn', '[Worker Manager] Received incomplete luaPrint message:', message);
        }
    } else if (message.type === 'luaStatusUpdate') {
        const { scriptId, message: statusMessage } = message;
        if (scriptId && statusMessage !== undefined) {
            // Dispatch the status update as a log entry
            setGlobalState('lua/addLogEntry', { id: scriptId, message: statusMessage });

            // Forward the status message to all renderer windows
            const allWindows = BrowserWindow.getAllWindows();
            allWindows.forEach(win => {
                if (!win.isDestroyed()) {
                    win.webContents.send('script-log-update', { scriptId, message: statusMessage });
                }
            });
        } else {
             log('warn', '[Worker Manager] Received incomplete luaStatusUpdate message:', message);
        }

    } else {
        // Handle other types of messages if necessary
    }
  }

  startWorker(name) {
    if (this.workers.has(name)) {
      log('warn', `[Worker Manager] Worker already exists: ${name}`);
      return this.workers.get(name);
    }

    try {
      const workerPath = this.getWorkerPath(name);
      const worker = new Worker(workerPath, {
        name,
        workerData: {
          x11capturePath: this.paths.x11capture,
          keypressPath: this.paths.keypress,
          useItemOnPath: this.paths.useItemOn,
          findSequencesPath: this.paths.findSequences,
        },
      });

      this.workerPaths.set(name, workerPath);
      worker.on('message', (msg) => this.handleWorkerMessage(msg));
      worker.on('error', (error) => this.handleWorkerError(name, error));
      worker.on('exit', (code) => this.handleWorkerExit(name, code));

      this.workers.set(name, worker);
      // Post initial state once worker is ready, after a small delay
        setTimeout(() => {
            const initialState = store.getState();
            // Send the full initial state object directly to non-Lua workers
            if (name !== 'luaVMWorker') {
                worker.postMessage(initialState);
            } else {
                // For Lua worker, send specific initial messages
                 const enabledPersistentScripts = initialState.lua.persistentScripts.filter(script => script.enabled)
                    .map(({ id, code, loopMin, loopMax }) => ({ id, code, loopMin, loopMax }));
                 worker.postMessage({ type: 'updatePersistentScripts', scripts: enabledPersistentScripts });
                 this.lastEnabledPersistentScripts = enabledPersistentScripts;

                 // Also send initial game state specifically to Lua worker
                 worker.postMessage({ type: 'initialState', state: { gameState: initialState.gameState } });
            }
        }, WORKER_INIT_DELAY);


      return worker;
    } catch (error) {
      log('error', `[Worker Manager] Failed to start worker: ${name}`, error);
      return null;
    }
  }

  async restartWorker(name) {
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

      const newWorker = this.startWorker(name);
      if (!newWorker) {
        throw new Error(`Failed to create new worker: ${name}`);
      }

      // After starting, send the latest state
      await new Promise((resolve) => setTimeout(resolve, WORKER_INIT_DELAY));
      const reduxState = store.getState();

      // Send the full latest state object directly to non-Lua workers
      if (name !== 'luaVMWorker') {
           newWorker.postMessage(reduxState);
       } else {
           // For Lua worker, send specific messages
            const enabledPersistentScripts = reduxState.lua.persistentScripts.filter(script => script.enabled)
                .map(({ id, code, loopMin, loopMax }) => ({ id, code, loopMin, loopMax }));
            newWorker.postMessage({ type: 'updatePersistentScripts', scripts: enabledPersistentScripts });
            this.lastEnabledPersistentScripts = enabledPersistentScripts;
             // Also send latest game state specifically to Lua worker
            newWorker.postMessage({ type: 'stateUpdate', state: { gameState: reduxState.gameState } });
       }

      return newWorker;
    } catch (error) {
      log('error', `[Worker Manager] Error during restart: ${name}`, error);
      this.resetRestartState(name);
    } finally {
      setTimeout(() => {
        this.restartLocks.set(name, false);
      }, RESTART_COOLDOWN);
    }
  }

  async stopWorker(name) {
    const worker = this.workers.get(name);
    if (worker) {
      try {
        await worker.terminate();
      } catch (error) {
        log('error', `[Worker Manager] Error terminating worker: ${name}`, error);
      }
      this.workers.delete(name);
      this.workerPaths.delete(name);
    }
  }

  stopAllWorkers() {
    for (const [name] of this.workers) {
      this.stopWorker(name);
    }
  }

  async restartAllWorkers() {
    const workers = Array.from(this.workers.keys());
    for (const name of workers) {
      await this.restartWorker(name);
    }
  }

  handleStoreUpdate() {
    const state = store.getState();
    const { windowId } = state.global;

    // Handle starting screenMonitor worker based on windowId presence
    if (windowId) {
      if (!this.workers.has('screenMonitor')) {
        log('info', '[Worker Manager] Starting screenMonitor for window ID:', windowId);
        this.startWorker('screenMonitor');
      }
    } else {
        // If windowId is no longer present, stop screenMonitor
        if (this.workers.has('screenMonitor')) {
             log('info', '[Worker Manager] Stopping screenMonitor as window ID is no longer set.');
             this.stopWorker('screenMonitor');
        }
    }


    // Update existing workers with the latest state (except the luaVMWorker which gets specific updates)
    for (const [name, worker] of this.workers) {
       if (name !== 'luaVMWorker' && !this.restartLocks.get(name)) {
            // Send the full state object directly
            worker.postMessage(state);
        }
    }

    const luaWorker = this.workers.get('luaVMWorker');
    if (luaWorker && !this.restartLocks.get('luaVMWorker')) {
         const currentEnabledPersistentScripts = state.lua.persistentScripts.filter(script => script.enabled)
              .map(({ id, code, loopMin, loopMax }) => ({ id, code, loopMin, loopMax }));

         const currentEnabledString = JSON.stringify(currentEnabledPersistentScripts);
         const lastEnabledString = JSON.stringify(this.lastEnabledPersistentScripts);

         if (currentEnabledString !== lastEnabledString) {
              // Mute this log if you find it too noisy, as status updates are sent to frontend
              log('info', '[Worker Manager] Enabled persistent scripts list changed. Updating luaVMWorker.');
              luaWorker.postMessage({ type: 'updatePersistentScripts', scripts: currentEnabledPersistentScripts });
              this.lastEnabledPersistentScripts = currentEnabledPersistentScripts;
         }

         // Always send the latest game state specifically to the Lua worker
         luaWorker.postMessage({ type: 'stateUpdate', state: { gameState: state.gameState } });
    }
  }

  initialize(app, cwd) {
    this.setupPaths(app, cwd);
    // Start the Lua VM worker on initialization
    this.startWorker('luaVMWorker');
    store.subscribe(this.handleStoreUpdate);

    app.on('before-quit', () => this.stopAllWorkers());
    app.on('will-quit', () => this.stopAllWorkers());
    // app.on('window-all-closed', () => this.stopAllWorkers()); // May not want to stop if main window closes but other windows (like editor) are open
  }
}

const workerManager = new WorkerManager();


export default workerManager;