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

const DEFAULT_WORKER_CONFIG = {
  captureWorker: true,
  regionMonitor: true,
  screenMonitor: true,
  minimapMonitor: true,
  ocrWorker: true,
  cavebotWorker: true,
  enableLuaScriptWorkers: true,
};

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
    this.restartLocks = new Map();
    this.restartAttempts = new Map();
    this.restartTimeouts = new Map();
    this.sharedScreenState = null;
    this.workerConfig = {};
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
    if (isUUID) {
      return resolve(this.electronDir, './workers', 'luaScriptWorker.js');
    }
    return resolve(this.electronDir, './workers', `${workerName}.js`);
  }

  createSharedBuffers() {
    const maxImageSize = 3840 * 2160 * 4;
    const imageSAB = new SharedArrayBuffer(maxImageSize + 8);
    const syncSAB = new SharedArrayBuffer(5 * Int32Array.BYTES_PER_ELEMENT);
    this.sharedScreenState = { imageSAB, syncSAB };
    log('info', '[Worker Manager] Created SharedArrayBuffers for screen capture.');
  }

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
    // Clean up the worker from the map. This is crucial.
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

  handleWorkerMessage(message) {
    if (message.notification) {
      showNotification(message.notification.title, message.notification.body);
    } else if (message.storeUpdate) {
      setGlobalState(message.type, message.payload);
    } else if (message.command === 'requestRegionRescan') {
      log('info', '[Worker Manager] Received request for region rescan. Relaying to regionMonitor...');
      const regionWorkerEntry = this.workers.get('regionMonitor');
      if (regionWorkerEntry?.worker) {
        regionWorkerEntry.worker.postMessage({ command: 'forceRegionSearch' });
      } else {
        log('warn', '[Worker Manager] Could not relay rescan request: regionMonitor is not running.');
      }
    }
    // --- [NEW] --- Handle the one-shot script execution request from cavebotWorker
    else if (message.command === 'executeLuaScript') {
      const state = store.getState();
      const { enabled: luaEnabled } = state.lua;

      if (!luaEnabled) {
        log('info', `[Worker Manager] Skipping one-shot Lua script execution: ${id} - Lua scripts are disabled`);
        // Send failure response back to cavebotWorker
        const cavebotWorkerEntry = this.workers.get('cavebotWorker');
        if (cavebotWorkerEntry?.worker) {
          cavebotWorkerEntry.worker.postMessage({ type: 'script-finished', id, success: false, error: 'Lua scripts are disabled' });
        }
        return;
      }

      const { script, id } = message.payload;
      log('info', `[Worker Manager] Received request to execute one-shot Lua script: ${id}`);
      // Use the unique ID as the worker's name to track it.
      // Pass a config object indicating this is a 'oneshot' script.
      this.startWorker(id, { id, code: script, type: 'oneshot' }, this.paths);
    }
    // --- [NEW] --- Handle the result from the one-shot script worker
    else if (message.type === 'scriptExecutionResult') {
      const { id, success, error } = message;
      log('info', `[Worker Manager] One-shot script ${id} finished. Success: ${success}.`);
      if (error) {
        log('error', `[Worker Manager] Script ${id} failed with error: ${error}`);
      }

      // Find the cavebotWorker and relay the "finished" message it's waiting for.
      const cavebotWorkerEntry = this.workers.get('cavebotWorker');
      if (cavebotWorkerEntry?.worker) {
        cavebotWorkerEntry.worker.postMessage({ type: 'script-finished', id });
      } else {
        log('warn', `[Worker Manager] Could not relay script-finished for ${id}: cavebotWorker is not running.`);
      }

      // IMPORTANT: Terminate and clean up the temporary worker.
      this.stopWorker(id);
    }
    // --- [END NEW] ---
    else if (['scriptError', 'luaPrint', 'luaStatusUpdate'].includes(message.type)) {
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

  startWorker(name, scriptConfig = null, paths = null) {
    log('debug', `[Worker Manager] Attempting to start worker: ${name}`);
    if (this.workers.has(name)) {
      log('warn', `[Worker Manager] Worker already exists: ${name}`);
      return this.workers.get(name).worker;
    }

    try {
      const workerPath = this.getWorkerPath(name);
      const needsSharedScreen = ['captureWorker', 'screenMonitor', 'minimapMonitor', 'regionMonitor', 'ocrWorker'].includes(name);

      const workerData = {
        paths: paths || this.paths,
        sharedData: needsSharedScreen ? this.sharedScreenState : null,
      };

      workerData.enableMemoryLogging = true;

      const worker = new Worker(workerPath, {
        name,
        workerData,
      });

      this.workers.set(name, { worker, config: scriptConfig });
      worker.on('message', (msg) => this.handleWorkerMessage(msg));
      worker.on('error', (error) => this.handleWorkerError(name, error));
      worker.on('exit', (code) => this.handleWorkerExit(name, code));
      log('info', `[Worker Manager] Worker ${name} started successfully.`);

      setTimeout(() => {
        if (scriptConfig) {
          worker.postMessage({ type: 'init', script: scriptConfig });
        }
        if (name !== 'captureWorker') {
          // For one-shot scripts, we don't want to send the whole state initially,
          // only when it's needed. The luaScriptWorker will get it on subsequent messages.
          // However, the cavebot worker *does* need the initial state.
          const isOneShotLua = /^[0-9a-fA-F]{8}-/.test(name);
          if (!isOneShotLua) {
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

  async restartWorker(name, scriptConfig = null) {
    if (this.restartLocks.get(name)) {
      log('info', `[Worker Manager] Restart in progress, skipping: ${name}`);
      return null;
    }
    this.restartLocks.set(name, true);
    this.restartAttempts.set(name, (this.restartAttempts.get(name) || 0) + 1);
    this.clearRestartLockWithTimeout(name);
    try {
      await this.stopWorker(name);
      const newWorker = this.startWorker(name, scriptConfig, this.paths);
      if (!newWorker) throw new Error(`Failed to create new worker: ${name}`);
      log('info', `[Worker Manager] Worker ${name} restarted successfully.`);
      this.resetRestartState(name);
      return newWorker;
    } catch (error) {
      log('error', `[Worker Manager] Error during restart: ${name}`, error);
    } finally {
      this.restartLocks.set(name, false);
    }
  }

  stopWorker(name) {
    const workerEntry = this.workers.get(name);
    if (workerEntry?.worker) {
      log('info', `[Worker Manager] Terminating worker: ${name}`);
      return workerEntry.worker.terminate();
    }
    return Promise.resolve();
  }

  async stopAllWorkers() {
    log('info', '[Worker Manager] Stopping all workers...');
    const terminationPromises = [];
    for (const name of this.workers.keys()) {
      terminationPromises.push(this.stopWorker(name));
    }
    await Promise.all(terminationPromises);
    log('info', '[Worker Manager] All workers have been terminated.');
  }

  handleStoreUpdate() {
    const state = store.getState();
    const { windowId } = state.global;
    const { enabled: cavebotEnabled } = state.cavebot;
    const { enabled: luaEnabled } = state.lua;

    if (windowId) {
      if (!this.sharedScreenState) this.createSharedBuffers();
      const syncArray = new Int32Array(this.sharedScreenState.syncSAB);
      Atomics.store(syncArray, 4, parseInt(windowId, 10) || 0);

      if (this.workerConfig.captureWorker && !this.workers.has('captureWorker')) this.startWorker('captureWorker');
      if (this.workerConfig.regionMonitor && !this.workers.has('regionMonitor')) this.startWorker('regionMonitor');
      if (this.workerConfig.screenMonitor && !this.workers.has('screenMonitor')) this.startWorker('screenMonitor');
      if (this.workerConfig.minimapMonitor && !this.workers.has('minimapMonitor')) this.startWorker('minimapMonitor');
      if (this.workerConfig.ocrWorker && !this.workers.has('ocrWorker')) this.startWorker('ocrWorker'); // Start the new OCR worker
      if (cavebotEnabled && this.workerConfig.cavebotWorker && !this.workers.has('cavebotWorker'))
        this.startWorker('cavebotWorker', null, this.paths);
    } else {
      ['captureWorker', 'regionMonitor', 'screenMonitor', 'minimapMonitor', 'ocrWorker', 'cavebotWorker'].forEach((w) =>
        this.stopWorker(w),
      );
      if (this.sharedScreenState) {
        log('info', '[Worker Manager] Clearing SharedArrayBuffers.');
        this.sharedScreenState = null;
      }
    }

    const allPersistentScripts = state.lua.persistentScripts;
    const runningScriptWorkerIds = new Set(Array.from(this.workers.keys()).filter((name) => /^[0-9a-fA-F]{8}-/.test(name)));

    // Stop workers for scripts that have been removed
    for (const workerId of runningScriptWorkerIds) {
      if (!allPersistentScripts.some((s) => s.id === workerId)) {
        this.stopWorker(workerId);
      }
    }

    // Start new workers or update existing ones
    if (this.workerConfig.enableLuaScriptWorkers && luaEnabled) {
      for (const script of allPersistentScripts) {
        const workerName = script.id;
        const workerEntry = this.workers.get(workerName);

        if (!workerEntry) {
          // This is a new script, start a worker for it.
          this.startWorker(workerName, script, this.paths);
        } else {
          // Worker exists, check for changes that require a restart vs. a simple message.
          const oldConfig = workerEntry.config;
          if (oldConfig.code !== script.code || oldConfig.loopMin !== script.loopMin || oldConfig.loopMax !== script.loopMax) {
            // If the core logic changes, a restart is necessary.
            this.restartWorker(workerName, script);
          } else if (oldConfig.enabled !== script.enabled) {
            // If only the enabled status changes, just send a message.
            workerEntry.worker.postMessage({ type: 'update', script });
            // Update the config in the manager to reflect the new state.
            workerEntry.config = script;
          }
        }
      }
    } else {
      // If Lua scripts are disabled via luaSlice.enabled = false, stop all running scripts
      for (const workerId of runningScriptWorkerIds) {
        this.stopWorker(workerId);
      }
    }

    // Send the full state to all workers except captureWorker
    for (const [name, workerEntry] of this.workers) {
      if (workerEntry.worker && name !== 'captureWorker') {
        // Send the full state to all workers except captureWorker and one-shot Lua scripts.
        // One-shot Lua script workers receive their script config on init and don't need the full state.
        // Persistent Lua script workers (identified by UUID) *do* need continuous state updates.
        const isPersistentLua = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(name);
        if (name !== 'captureWorker' && (!isPersistentLua || workerEntry.config?.type !== 'oneshot')) {
          workerEntry.worker.postMessage(state);
        }
      }
    }
  }

  initialize(app, cwd, config = {}) {
    this.setupPaths(app, cwd);
    this.workerConfig = { ...DEFAULT_WORKER_CONFIG, ...config };
    log('info', '[Worker Manager] Initializing and subscribing to store updates.');
    store.subscribe(this.handleStoreUpdate);
  }
}

const workerManager = new WorkerManager();
export default workerManager;
