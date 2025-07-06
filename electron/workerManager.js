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
    this.restartLocks = new Map();
    this.restartAttempts = new Map();
    this.restartTimeouts = new Map();
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

  startWorker(name, scriptConfig = null, paths = null) {
    log('debug', `[Worker Manager] Attempting to start worker: ${name}`);
    if (this.workers.has(name)) {
      log('warn', `[Worker Manager] Worker already exists: ${name}`);
      return this.workers.get(name).worker;
    }

    try {
      const workerPath = this.getWorkerPath(name);
      const needsSharedScreen = ['captureWorker', 'screenMonitor', 'minimapMonitor', 'regionMonitor'].includes(name);

      const worker = new Worker(workerPath, {
        name,
        workerData: {
          paths: paths || this.paths,
          sharedData: needsSharedScreen ? this.sharedScreenState : null,
        },
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
          worker.postMessage(store.getState());
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
    } finally {
      this.resetRestartState(name);
      setTimeout(() => this.restartLocks.set(name, false), RESTART_COOLDOWN);
    }
  }

  // <<< THIS IS THE CORRECTED stopWorker FUNCTION >>>
  stopWorker(name) {
    const workerEntry = this.workers.get(name);
    if (workerEntry?.worker) {
      log('info', `[Worker Manager] Terminating worker: ${name}`);
      // Return the promise from terminate() so it can be awaited.
      return workerEntry.worker.terminate().finally(() => {
        // The 'exit' event handler will clean up the maps.
      });
    }
    // If no worker, return a resolved promise to not break Promise.all
    return Promise.resolve();
  }

  // <<< THIS IS THE NEW stopAllWorkers FUNCTION TO ADD >>>
  async stopAllWorkers() {
    log('info', '[Worker Manager] Stopping all workers and waiting for completion...');
    const terminationPromises = [];
    for (const name of this.workers.keys()) {
      terminationPromises.push(this.stopWorker(name));
    }
    // Wait for all terminate() promises to resolve.
    await Promise.all(terminationPromises);
    log('info', '[Worker Manager] All workers have been terminated.');
  }

  handleStoreUpdate() {
    const state = store.getState();
    const { windowId } = state.global;
    const { enabled: cavebotEnabled } = state.cavebot;

    const regionsExist = state.regionCoordinates && Object.keys(state.regionCoordinates.regions).length > 5;

    if (windowId) {
      if (!this.sharedScreenState) this.createSharedBuffers();
      const syncArray = new Int32Array(this.sharedScreenState.syncSAB);
      Atomics.store(syncArray, 4, parseInt(windowId, 10) || 0);

      if (!this.workers.has('captureWorker')) this.startWorker('captureWorker');
      if (!this.workers.has('regionMonitor')) this.startWorker('regionMonitor');
    } else {
      ['captureWorker', 'regionMonitor', 'screenMonitor', 'minimapMonitor'].forEach((w) => this.stopWorker(w));
      if (this.sharedScreenState) {
        log('info', '[Worker Manager] Clearing SharedArrayBuffers.');
        this.sharedScreenState = null;
      }
    }

    if (windowId && regionsExist) {
      if (!this.workers.has('screenMonitor')) this.startWorker('screenMonitor');
      if (!this.workers.has('minimapMonitor')) this.startWorker('minimapMonitor');
    } else {
      if (this.workers.has('screenMonitor')) this.stopWorker('screenMonitor');
      if (this.workers.has('minimapMonitor')) this.stopWorker('minimapMonitor');
    }

    if (windowId) {
      if (!this.workers.has('pathfinderWorker')) this.startWorker('pathfinderWorker', null, this.paths);
      if (cavebotEnabled && !this.workers.has('pathFollowerWorker')) this.startWorker('pathFollowerWorker', null, this.paths);
    } else {
      if (this.workers.has('pathfinderWorker')) this.stopWorker('pathfinderWorker');
    }
    if (!cavebotEnabled && this.workers.has('pathFollowerWorker')) this.stopWorker('pathFollowerWorker');

    const currentEnabledPersistentScripts = state.lua.persistentScripts.filter((script) => script.enabled);
    const activeScriptIds = new Set(currentEnabledPersistentScripts.map((script) => script.id));
    const runningScriptWorkerIds = new Set(Array.from(this.workers.keys()).filter((name) => /^[0-9a-fA-F]{8}-/.test(name)));

    for (const scriptId of runningScriptWorkerIds) if (!activeScriptIds.has(scriptId)) this.stopWorker(scriptId);
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

    for (const [name, workerEntry] of this.workers) {
      if (workerEntry.worker && name !== 'captureWorker') {
        workerEntry.worker.postMessage(state);
      }
    }
  }

  // <<< THIS IS THE CORRECTED initialize FUNCTION >>>
  initialize(app, cwd) {
    this.setupPaths(app, cwd);
    log('info', '[Worker Manager] Initializing and subscribing to store updates.');
    store.subscribe(this.handleStoreUpdate);

    // The old quitHandler is removed from here, as its job is now
    // handled by the master 'before-quit' handler in main.js
  }
}

const workerManager = new WorkerManager();
export default workerManager;
