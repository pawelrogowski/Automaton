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
      minimapResources: null,
    };
    this.previousState = null;

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
      this.restartWorker(name).catch((err) =>
        log(
          'error',
          `[Worker Manager] Restart failed after error: ${name}`,
          err,
        ),
      );
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
      const worker = new Worker(workerPath, { name, workerData });
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
          const isOneShotLua =
            /^[0-9a-fA-F]{8}-/.test(name) && scriptConfig?.type === 'oneshot';
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

  // --- [ROBUST FIX] --- Use a graceful shutdown message for Lua workers.
  stopWorker(name) {
    const workerEntry = this.workers.get(name);
    if (!workerEntry?.worker) {
      return Promise.resolve();
    }

    const isLuaWorker = /^[0-9a-fA-F]{8}-/.test(name);

    return new Promise((resolve) => {
      workerEntry.worker.once('exit', () => {
        log('debug', `Worker ${name} has confirmed exit.`);
        resolve();
      });

      if (isLuaWorker) {
        log(
          'info',
          `[Worker Manager] Requesting graceful shutdown for Lua worker: ${name}`,
        );
        workerEntry.worker.postMessage({ type: 'shutdown' });
      } else {
        log('info', `[Worker Manager] Terminating non-Lua worker: ${name}`);
        workerEntry.worker.terminate();
      }
    });
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

  async handleStoreUpdate() {
    const currentState = store.getState();
    const { windowId, display } = currentState.global;
    const { enabled: cavebotEnabled } = currentState.cavebot;
    const { enabled: luaEnabled } = currentState.lua;

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
      // --- [ROBUST FIX] --- Stop all non-essential workers when Lua is disabled
      const essentialWorkers = new Set([
        'captureWorker',
        'regionMonitor',
        'screenMonitor',
        'minimapMonitor',
        'pathfinderWorker',
        'ocrWorker',
        'cavebotWorker',
      ]);

      const allWorkers = Array.from(this.workers.keys());
      const workersToStop = allWorkers.filter(
        (name) => !essentialWorkers.has(name),
      );

      await Promise.all(workersToStop.map((w) => this.stopWorker(w)));

      if (this.sharedScreenState) {
        log('info', '[Worker Manager] Clearing SharedArrayBuffers.');
        this.sharedScreenState = null;
      }
    }

    await (async () => {
      const allPersistentScripts = currentState.lua.persistentScripts;
      const runningScriptWorkerIds = new Set(
        Array.from(this.workers.keys()).filter((name) =>
          /^[0-9a-fA-F]{8}-/.test(name),
        ),
      );

      if (this.workerConfig.enableLuaScriptWorkers && luaEnabled) {
        const activeScripts = allPersistentScripts.filter((s) => s.enabled);
        const activeScriptIds = new Set(activeScripts.map((s) => s.id));
        const workersToStop = [];
        for (const workerId of runningScriptWorkerIds) {
          if (!activeScriptIds.has(workerId)) {
            workersToStop.push(this.stopWorker(workerId));
          }
        }
        if (workersToStop.length > 0) {
          await Promise.all(workersToStop);
        }
        for (const script of activeScripts) {
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
              await this.restartWorker(workerName, script);
            } else {
              workerEntry.config = script;
            }
          }
        }
      } else {
        const workersToStop = Array.from(runningScriptWorkerIds);
        if (workersToStop.length > 0) {
          await Promise.all(workersToStop.map((id) => this.stopWorker(id)));
        }
      }
    })();

    const changedSlices = {};
    let hasChanges = false;
    for (const key in currentState) {
      if (currentState[key] !== this.previousState[key]) {
        changedSlices[key] = currentState[key];
        hasChanges = true;
      }
    }
    if (hasChanges) {
      const updateMessage = { type: 'state_diff', payload: changedSlices };
      for (const [name, workerEntry] of this.workers) {
        if (workerEntry.worker && name !== 'captureWorker') {
          const isOneShotLua =
            /^[0-9a-fA-F]{8}-/.test(name) &&
            workerEntry.config?.type === 'oneshot';
          if (!isOneShotLua) {
            workerEntry.worker.postMessage(updateMessage);
          }
        }
      }
    }
    this.previousState = currentState;
  }

  initialize(app, cwd, config = {}) {
    this.setupPaths(app, cwd);
    this.workerConfig = { ...DEFAULT_WORKER_CONFIG, ...config };
    log(
      'info',
      '[Worker Manager] Initializing and subscribing to store updates.',
    );
    this.previousState = store.getState();
    store.subscribe(() => this.handleStoreUpdate());
  }
}

const workerManager = new WorkerManager();
export default workerManager;
