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

// =======================================================================
// --- NEW: Worker Dependency Configuration ---
// This object defines which slices of the Redux state each worker needs.
// This is the single source of truth for our smart state synchronization.
// `null` means the worker receives the entire state object.
// An empty array `[]` means the worker receives no state updates.
// =======================================================================
const WORKER_DEPENDENCIES = {
  // Receives the entire state object for maximum flexibility.
  luaScriptWorker: null,

  // Receive specific, targeted state slices.
  pathfinderWorker: ['cavebot', 'gameState', 'statusMessages'],
  minimapMonitor: ['regionCoordinates'],
  screenMonitor: ['regionCoordinates', 'gameState'],
  ocrWorker: ['regionCoordinates', 'gameState'],
  cavebotWorker: [
    'cavebot',
    'gameState',
    'statusMessages',
    'regionCoordinates',
  ],

  // Receives no state updates as it's driven by the shared buffer.
  regionMonitor: [],
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
      minimapResources: null,
    };

    // NEW: Map to store the last state sent to each worker to avoid redundant sends.
    this.lastSentStateJSON = new Map();

    this.handleWorkerError = this.handleWorkerError.bind(this);
    this.handleWorkerExit = this.handleWorkerExit.bind(this);
    this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
    this.handleStoreUpdate = this.handleStoreUpdate.bind(this);
  }

  setupPaths(app, cwd) {
    if (app.isPackaged) {
      this.paths.utils = path.join(
        app.getAppPath(),
        '..',
        'resources',
        'x11utils',
      );
      this.paths.minimapResources = path.join(
        app.getAppPath(),
        '..',
        'resources',
        'preprocessed_minimaps',
      );
    } else {
      this.paths.utils = path.join(cwd, '..', 'resources', 'x11utils');
      this.paths.minimapResources = path.join(
        cwd,
        '..',
        'resources',
        'preprocessed_minimaps',
      );
    }

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
    const isUUID =
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        workerName,
      );
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
    log(
      'info',
      '[Worker Manager] Created SharedArrayBuffers for screen capture.',
    );
  }

  handleWorkerError(name, error) {
    log('error', `[Worker Manager] Worker error: ${name}`, error);
    if (!name.startsWith('script-') && !this.restartLocks.get(name)) {
      this.restartWorker(name).catch((err) => {
        log(
          'error',
          `[Worker Manager] Restart failed after error: ${name}`,
          err,
        );
      });
    } else if (name.startsWith('script-')) {
      log(
        'info',
        `[Worker Manager] Script worker ${name} encountered an error. Lifecycle managed by store updates.`,
      );
      this.workers.delete(name);
    }
  }

  handleWorkerExit(name, code) {
    log('info', `[Worker Manager] Worker exited: ${name}, code ${code}`);
    this.workers.delete(name);
    this.workerPaths.delete(name);
    // NEW: Clean up the last sent state for the exited worker.
    this.lastSentStateJSON.delete(name);

    const isUUID =
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        name,
      );
    if (!isUUID && code !== 0) {
      const attempts = this.restartAttempts.get(name) || 0;
      if (!this.restartLocks.get(name) && attempts < MAX_RESTART_ATTEMPTS) {
        log(
          'error',
          `[Worker Manager] Non-script worker exited with error: ${name}, code ${code}, attempt ${attempts + 1}/${MAX_RESTART_ATTEMPTS}`,
        );
        setTimeout(
          () => {
            this.restartWorker(name).catch((err) =>
              log('error', `Failed to restart worker ${name} after exit:`, err),
            );
          },
          RESTART_COOLDOWN * (attempts + 1),
        );
      } else if (attempts >= MAX_RESTART_ATTEMPTS) {
        log(
          'error',
          `[Worker Manager] Max restart attempts reached for non-script worker: ${name}`,
        );
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
      log(
        'info',
        '[Worker Manager] Received request for region rescan. Relaying to regionMonitor...',
      );
      const regionWorkerEntry = this.workers.get('regionMonitor');
      if (regionWorkerEntry?.worker) {
        regionWorkerEntry.worker.postMessage({ command: 'forceRegionSearch' });
      } else {
        log(
          'warn',
          '[Worker Manager] Could not relay rescan request: regionMonitor is not running.',
        );
      }
    } else if (message.command === 'executeLuaScript') {
      const state = store.getState();
      const { enabled: luaEnabled } = state.lua;
      const { script, id } = message.payload;

      if (!luaEnabled) {
        log(
          'info',
          `[Worker Manager] Skipping one-shot Lua script execution: ${id} - Lua scripts are disabled`,
        );
        const cavebotWorkerEntry = this.workers.get('cavebotWorker');
        if (cavebotWorkerEntry?.worker) {
          cavebotWorkerEntry.worker.postMessage({
            type: 'script-finished',
            id,
            success: false,
            error: 'Lua scripts are disabled',
          });
        }
        return;
      }

      log(
        'info',
        `[Worker Manager] Received request to execute one-shot Lua script: ${id}`,
      );
      this.startWorker(id, { id, code: script, type: 'oneshot' }, this.paths);
    } else if (message.type === 'scriptExecutionResult') {
      const { id, success, error } = message;
      log(
        'info',
        `[Worker Manager] One-shot script ${id} finished. Success: ${success}.`,
      );
      if (error) {
        log(
          'error',
          `[Worker Manager] Script ${id} failed with error: ${error}`,
        );
      }

      const cavebotWorkerEntry = this.workers.get('cavebotWorker');
      if (cavebotWorkerEntry?.worker) {
        cavebotWorkerEntry.worker.postMessage({ type: 'script-finished', id });
      } else {
        log(
          'warn',
          `[Worker Manager] Could not relay script-finished for ${id}: cavebotWorker is not running.`,
        );
      }
      this.stopWorker(id);
    } else if (
      ['scriptError', 'luaPrint', 'luaStatusUpdate'].includes(message.type)
    ) {
      const { scriptId, message: logMessage } = message;
      if (scriptId) {
        setGlobalState('lua/addLogEntry', {
          id: scriptId,
          message: logMessage,
        });
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed())
            win.webContents.send('script-log-update', {
              scriptId,
              message: logMessage,
            });
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
      const needsSharedScreen = [
        'captureWorker',
        'screenMonitor',
        'minimapMonitor',
        'regionMonitor',
        'ocrWorker',
      ].includes(name);

      const workerData = {
        paths: paths || this.paths,
        sharedData: needsSharedScreen ? this.sharedScreenState : null,
      };

      if (needsSharedScreen) {
        const state = store.getState();
        workerData.display = state.global.display;
      }

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
        // Send initial state upon creation. Subsequent updates are handled by handleStoreUpdate.
        // We can use the same smart logic here.
        const isLuaScript = /^[0-9a-fA-F]{8}-/.test(name);
        if (
          name !== 'captureWorker' &&
          (!isLuaScript || scriptConfig?.type !== 'oneshot')
        ) {
          const state = store.getState();
          const dependencyKey = isLuaScript ? 'luaScriptWorker' : name;
          const dependencies = WORKER_DEPENDENCIES[dependencyKey];
          let stateToSend = state; // Default to full state

          if (dependencies && dependencies.length > 0) {
            stateToSend = {};
            for (const sliceName of dependencies) {
              stateToSend[sliceName] = state[sliceName];
            }
          } else if (dependencies && dependencies.length === 0) {
            stateToSend = {}; // Send empty object if no dependencies
          }

          worker.postMessage(stateToSend);
          this.lastSentStateJSON.set(name, JSON.stringify(stateToSend));
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

  // =======================================================================
  // --- REPLACED: This is the new, efficient handleStoreUpdate function ---
  // =======================================================================
  handleStoreUpdate() {
    const state = store.getState();
    const { windowId, display } = state.global;
    const { enabled: cavebotEnabled } = state.cavebot;
    const { enabled: luaEnabled } = state.lua;

    // --- This part for starting/stopping workers is unchanged ---
    if (windowId && display) {
      if (!this.sharedScreenState) this.createSharedBuffers();
      const syncArray = new Int32Array(this.sharedScreenState.syncSAB);
      Atomics.store(syncArray, 4, parseInt(windowId, 10) || 0);

      if (this.workerConfig.captureWorker && !this.workers.has('captureWorker'))
        this.startWorker('captureWorker');
      if (this.workerConfig.regionMonitor && !this.workers.has('regionMonitor'))
        this.startWorker('regionMonitor');
      if (this.workerConfig.screenMonitor && !this.workers.has('screenMonitor'))
        this.startWorker('screenMonitor');
      if (
        this.workerConfig.minimapMonitor &&
        !this.workers.has('minimapMonitor')
      )
        this.startWorker('minimapMonitor');
      if (this.workerConfig.ocrWorker && !this.workers.has('ocrWorker'))
        this.startWorker('ocrWorker');
      if (
        cavebotEnabled &&
        this.workerConfig.cavebotWorker &&
        !this.workers.has('cavebotWorker')
      )
        this.startWorker('cavebotWorker', null, this.paths);
    } else {
      [
        'captureWorker',
        'regionMonitor',
        'screenMonitor',
        'minimapMonitor',
        'ocrWorker',
        'cavebotWorker',
      ].forEach((w) => this.stopWorker(w));
      if (this.sharedScreenState) {
        log('info', '[Worker Manager] Clearing SharedArrayBuffers.');
        this.sharedScreenState = null;
      }
    }

    const allPersistentScripts = state.lua.persistentScripts;
    const runningScriptWorkerIds = new Set(
      Array.from(this.workers.keys()).filter((name) =>
        /^[0-9a-fA-F]{8}-/.test(name),
      ),
    );

    for (const workerId of runningScriptWorkerIds) {
      if (!allPersistentScripts.some((s) => s.id === workerId)) {
        this.stopWorker(workerId);
      }
    }

    if (this.workerConfig.enableLuaScriptWorkers && luaEnabled) {
      for (const script of allPersistentScripts) {
        const workerName = script.id;
        const workerEntry = this.workers.get(workerName);
        if (!workerEntry) {
          this.startWorker(workerName, script, this.paths);
        } else {
          const oldConfig = workerEntry.config;
          if (
            oldConfig &&
            (oldConfig.code !== script.code ||
              oldConfig.loopMin !== script.loopMin ||
              oldConfig.loopMax !== script.loopMax)
          ) {
            this.restartWorker(workerName, script);
          } else if (oldConfig.enabled !== script.enabled) {
            workerEntry.worker.postMessage({ type: 'update', script });
            workerEntry.config = script;
          }
        }
      }
    } else {
      for (const workerId of runningScriptWorkerIds) {
        this.stopWorker(workerId);
      }
    }
    // --- End of unchanged section ---

    // =======================================================================
    // --- NEW: Smart State Synchronization Logic ---
    // =======================================================================
    for (const [name, workerEntry] of this.workers) {
      if (!workerEntry.worker || name === 'captureWorker') {
        continue; // Skip captureWorker and non-existent workers
      }

      // Determine the base name for our dependency lookup
      const isLuaScript = /^[0-9a-fA-F]{8}-/.test(name);
      const dependencyKey = isLuaScript ? 'luaScriptWorker' : name;

      const dependencies = WORKER_DEPENDENCIES[dependencyKey];

      // If a worker has no defined dependencies, we don't send it any state updates.
      if (dependencies && dependencies.length === 0) {
        continue;
      }

      // 1. Build the relevant part of the state for this specific worker
      let stateToSend;
      let currentStateJSON;

      if (dependencies === null) {
        // `null` means send the entire state object (for Lua workers)
        stateToSend = state;
        currentStateJSON = JSON.stringify(stateToSend);
      } else {
        // Build an object with only the slices the worker needs
        stateToSend = {};
        for (const sliceName of dependencies) {
          stateToSend[sliceName] = state[sliceName];
        }
        currentStateJSON = JSON.stringify(stateToSend);
      }

      // 2. Check if the relevant data has actually changed
      const lastStateJSON = this.lastSentStateJSON.get(name);

      if (currentStateJSON !== lastStateJSON) {
        // 3. If it changed, send the update and store the new version
        log(
          'debug',
          `[Worker Manager] State changed for '${name}', sending update.`,
        );
        workerEntry.worker.postMessage(stateToSend);
        this.lastSentStateJSON.set(name, currentStateJSON);
      }
    }
  }

  initialize(app, cwd, config = {}) {
    this.setupPaths(app, cwd);
    this.workerConfig = { ...DEFAULT_WORKER_CONFIG, ...config };
    log(
      'info',
      '[Worker Manager] Initializing and subscribing to store updates.',
    );
    store.subscribe(this.handleStoreUpdate);
  }
}

const workerManager = new WorkerManager();
export default workerManager;
