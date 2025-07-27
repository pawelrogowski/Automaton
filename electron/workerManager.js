// @workerManager.js  (drop-in replacement)

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
const STORE_UPDATE_DEBOUNCE = 32; // 32 ms

// ------------------------------------------------------------------
// Small non-crypto 32-bit FNV-1a hash for fast equality check
// ------------------------------------------------------------------
function quickHash(obj) {
  let h = 0x811c9dc5;
  const str = JSON.stringify(obj);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

// Workers that need specific state slices
const WORKER_STATE_DEPENDENCIES = {
  cavebotWorker: [
    'cavebot',
    'global',
    'lua',
    'gameState',
    'regionCoordinates',
    'statusMessages',
    'settings',
  ],
  regionMonitor: ['global'],
  screenMonitor: [
    'global',
    'regionCoordinates',
    'gameState',
    'rules',
    'uiValues',
  ],
  minimapMonitor: ['global', 'regionCoordinates'],
  ocrWorker: ['global', 'regionCoordinates'],
  captureWorker: ['global'],
};

const GRACEFUL_SHUTDOWN_WORKERS = new Set([
  'regionMonitor',
  'screenMonitor',
  'minimapMonitor',
  'ocrWorker',
  'cavebotWorker',
]);

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
    this.paths = { utils: null, workers: null, minimapResources: null };
    this.previousState = null;

    // Debouncing / batching
    this.storeUpdateTimeout = null;
    this.pendingStateUpdate = false;
    this.lastUpdateTime = 0;

    // Performance tracking
    this.updateCount = 0;
    this.lastPerfReport = Date.now();

    // Re-usable objects
    this.reusableUpdateMessage = { type: 'state_diff', payload: {} };
    this.reusableChangedSlices = {};

    // NEW: per-worker last-sent hash cache
    this.workerStateCache = new Map();

    this.handleWorkerError = this.handleWorkerError.bind(this);
    this.handleWorkerExit = this.handleWorkerExit.bind(this);
    this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
    this.handleStoreUpdate = this.handleStoreUpdate.bind(this);
    this.debouncedStoreUpdate = this.debouncedStoreUpdate.bind(this);
  }

  /* ------------ unchanged helper methods -------------- */
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
    const imageSAB = new SharedArrayBuffer(maxImageSize);
    const MAX_DIRTY_REGIONS = 64;
    const SYNC_BUFFER_SIZE = 5 + 1 + MAX_DIRTY_REGIONS * 4;
    const syncSAB = new SharedArrayBuffer(
      SYNC_BUFFER_SIZE * Int32Array.BYTES_PER_ELEMENT,
    );
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

  /* ------------ unchanged start/stop helpers -------------- */
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

  stopWorker(name) {
    const workerEntry = this.workers.get(name);
    if (!workerEntry?.worker) {
      return Promise.resolve();
    }

    const isLuaWorker = /^[0-9a-fA-F]{8}-/.test(name);
    const supportsGracefulShutdown = GRACEFUL_SHUTDOWN_WORKERS.has(name);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        log(
          'warn',
          `[Worker Manager] Force terminating worker after timeout: ${name}`,
        );
        if (!workerEntry.worker.killed) {
          workerEntry.worker.terminate();
        }
        resolve();
      }, 5000);

      workerEntry.worker.once('exit', () => {
        clearTimeout(timeout);
        log('debug', `Worker ${name} has confirmed exit.`);
        resolve();
      });

      if (isLuaWorker || supportsGracefulShutdown) {
        log(
          'info',
          `[Worker Manager] Requesting graceful shutdown for worker: ${name}`,
        );
        workerEntry.worker.postMessage({ type: 'shutdown' });
      } else {
        log('info', `[Worker Manager] Terminating worker: ${name}`);
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

  /* ------------ optimized state diff -------------- */
  getStateChanges(currentState, previousState) {
    for (const key in this.reusableChangedSlices)
      delete this.reusableChangedSlices[key];
    let hasChanges = false;
    for (const key in currentState) {
      if (currentState[key] !== previousState[key]) {
        this.reusableChangedSlices[key] = currentState[key];
        hasChanges = true;
      }
    }
    return hasChanges ? this.reusableChangedSlices : null;
  }

  broadcastStateUpdate(changedSlices) {
    const changedKeys = Object.keys(changedSlices);
    for (const [name, workerEntry] of this.workers) {
      if (!workerEntry.worker || name === 'captureWorker') continue;

      const isOneShotLua =
        /^[0-9a-fA-F]{8}-/.test(name) && workerEntry.config?.type === 'oneshot';
      if (isOneShotLua) continue;

      const workerDeps = WORKER_STATE_DEPENDENCIES[name];
      if (workerDeps) {
        const needsUpdate = changedKeys.some((k) => workerDeps.includes(k));
        if (!needsUpdate) continue;

        const relevant = {};
        for (const k of changedKeys)
          if (workerDeps.includes(k)) relevant[k] = changedSlices[k];

        if (Object.keys(relevant).length) {
          const hash = quickHash(relevant);
          if (this.workerStateCache.get(name) !== hash) {
            this.workerStateCache.set(name, hash);
            workerEntry.worker.postMessage({
              type: 'state_diff',
              payload: relevant,
            });
          }
        }
      } else {
        const hash = quickHash(changedSlices);
        if (this.workerStateCache.get(name) !== hash) {
          this.workerStateCache.set(name, hash);
          workerEntry.worker.postMessage({
            type: 'state_diff',
            payload: changedSlices,
          });
        }
      }
    }
  }

  /* ------------ unchanged performance / debounce -------------- */
  logPerformanceStats() {
    const now = Date.now();
    const timeSinceLastReport = now - this.lastPerfReport;
    if (timeSinceLastReport >= 10000) {
      const ups = ((this.updateCount / timeSinceLastReport) * 1000).toFixed(1);
      log(
        'debug',
        `[Worker Manager] Performance: ${ups} store updates/sec, ${this.workers.size} active workers`,
      );
      this.updateCount = 0;
      this.lastPerfReport = now;
    }
  }

  debouncedStoreUpdate() {
    if (this.storeUpdateTimeout) clearTimeout(this.storeUpdateTimeout);
    this.storeUpdateTimeout = setTimeout(() => {
      this.handleStoreUpdate();
      this.storeUpdateTimeout = null;
    }, STORE_UPDATE_DEBOUNCE);
  }

  async handleStoreUpdate() {
    const perfStart = performance.now();
    this.updateCount++;

    try {
      const currentState = store.getState();
      const { windowId, display } = currentState.global;
      const { enabled: cavebotEnabled } = currentState.cavebot;
      const { enabled: luaEnabled } = currentState.lua;

      if (windowId && display) {
        if (!this.sharedScreenState) this.createSharedBuffers();

        if (
          !this.previousState ||
          currentState.global.windowId !== this.previousState.global.windowId
        ) {
          const syncArray = new Int32Array(this.sharedScreenState.syncSAB);
          Atomics.store(syncArray, 4, parseInt(windowId, 10) || 0);
        }

        if (
          this.workerConfig.captureWorker &&
          !this.workers.has('captureWorker')
        )
          this.startWorker('captureWorker');
        if (
          this.workerConfig.regionMonitor &&
          !this.workers.has('regionMonitor')
        )
          this.startWorker('regionMonitor');
        if (
          this.workerConfig.screenMonitor &&
          !this.workers.has('screenMonitor')
        )
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
        const essentialWorkers = new Set([
          'captureWorker',
          'regionMonitor',
          'screenMonitor',
          'minimapMonitor',
          'pathfinderWorker',
          'ocrWorker',
          'cavebotWorker',
        ]);
        const workersToStop = Array.from(this.workers.keys()).filter(
          (name) => !essentialWorkers.has(name),
        );
        if (workersToStop.length)
          await Promise.all(workersToStop.map((w) => this.stopWorker(w)));
        if (this.sharedScreenState) {
          log('info', '[Worker Manager] Clearing SharedArrayBuffers.');
          this.sharedScreenState = null;
        }
      }

      await this.manageLuaWorkers(currentState, luaEnabled);

      if (this.previousState) {
        const changed = this.getStateChanges(currentState, this.previousState);
        if (changed) this.broadcastStateUpdate(changed);
      }
      this.previousState = currentState;
      this.logPerformanceStats();
    } catch (error) {
      log('error', '[Worker Manager] Error in handleStoreUpdate:', error);
    }

    const updateTime = performance.now() - perfStart;
    if (updateTime > 16) {
      log(
        'warn',
        `[Worker Manager] Slow store update: ${updateTime.toFixed(2)}ms`,
      );
    }
  }

  async manageLuaWorkers(currentState, luaEnabled) {
    const allPersistentScripts = currentState.lua.persistentScripts;
    const runningScriptWorkerIds = new Set(
      Array.from(this.workers.keys()).filter((n) => /^[0-9a-fA-F]{8}-/.test(n)),
    );

    if (this.workerConfig.enableLuaScriptWorkers && luaEnabled) {
      const activeScripts = allPersistentScripts.filter((s) => s.enabled);
      const activeScriptIds = new Set(activeScripts.map((s) => s.id));

      const workersToStop = [];
      for (const id of runningScriptWorkerIds) {
        if (!activeScriptIds.has(id)) workersToStop.push(this.stopWorker(id));
      }
      if (workersToStop.length) await Promise.all(workersToStop);

      for (const script of activeScripts) {
        const workerName = script.id;
        const entry = this.workers.get(workerName);
        if (!entry) {
          this.startWorker(workerName, script, this.paths);
        } else {
          const old = entry.config;
          if (
            old &&
            (old.code !== script.code ||
              old.loopMin !== script.loopMin ||
              old.loopMax !== script.loopMax)
          ) {
            await this.restartWorker(workerName, script);
          } else {
            entry.config = script;
          }
        }
      }
    } else {
      const workersToStop = Array.from(runningScriptWorkerIds);
      if (workersToStop.length)
        await Promise.all(workersToStop.map((id) => this.stopWorker(id)));
    }
  }

  initialize(app, cwd, config = {}) {
    this.setupPaths(app, cwd);
    this.workerConfig = { ...DEFAULT_WORKER_CONFIG, ...config };
    log('info', '[Worker Manager] Initializing with debounced store updates.');
    this.previousState = store.getState();
    store.subscribe(this.debouncedStoreUpdate);
  }
}

const workerManager = new WorkerManager();
export default workerManager;
