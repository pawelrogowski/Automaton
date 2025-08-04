// @workerManager.js (Definitive Freeze Fix)

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
import {
  PLAYER_POS_SAB_SIZE,
  PATH_DATA_SAB_SIZE,
} from './workers/sharedConstants.js';

const log = createLogger();

const DEFAULT_WORKER_CONFIG = {
  captureWorker: true,
  regionMonitor: true,
  screenMonitor: true,
  minimapMonitor: true,
  ocrWorker: true,
  cavebotWorker: true,
  pathfinderWorker: true,
  enableLuaScriptWorkers: true,
};

const MAX_RESTART_ATTEMPTS = 5;
const RESTART_COOLDOWN = 500;
const RESTART_LOCK_TIMEOUT = 5000;
const WORKER_INIT_DELAY = 50;
const STORE_UPDATE_DEBOUNCE = 5;

function quickHash(obj) {
  let h = 0x811c9dc5;
  const str = JSON.stringify(obj);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

const WORKER_STATE_DEPENDENCIES = {
  cavebotWorker: [
    'cavebot',
    'global',
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
  // Pathfinder is now handled with custom logic below to prevent feedback loops.
};

const GRACEFUL_SHUTDOWN_WORKERS = new Set([
  'regionMonitor',
  'screenMonitor',
  'minimapMonitor',
  'ocrWorker',
  'cavebotWorker',
  'pathfinderWorker',
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
    this.sharedData = null;
    this.workerConfig = {};
    this.paths = { utils: null, workers: null, minimapResources: null };
    this.previousState = null;
    this.storeUpdateTimeout = null;
    this.updateCount = 0;
    this.lastPerfReport = Date.now();
    this.reusableChangedSlices = {};
    this.workerStateCache = new Map();
    this.handleWorkerError = this.handleWorkerError.bind(this);
    this.handleWorkerExit = this.handleWorkerExit.bind(this);
    this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
    this.handleStoreUpdate = this.handleStoreUpdate.bind(this);
    this.debouncedStoreUpdate = this.debouncedStoreUpdate.bind(this);
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
    const isUUID = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/.test(
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
    const playerPosSAB = new SharedArrayBuffer(
      PLAYER_POS_SAB_SIZE * Int32Array.BYTES_PER_ELEMENT,
    );
    const pathDataSAB = new SharedArrayBuffer(
      PATH_DATA_SAB_SIZE * Int32Array.BYTES_PER_ELEMENT,
    );
    this.sharedData = { imageSAB, syncSAB, playerPosSAB, pathDataSAB };
    log('info', '[Worker Manager] Created SharedArrayBuffers.');
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
    const isUUID = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/.test(
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
      const regionWorkerEntry = this.workers.get('regionMonitor');
      if (regionWorkerEntry?.worker) {
        regionWorkerEntry.worker.postMessage({ command: 'forceRegionSearch' });
      }
    } else if (message.command === 'executeLuaScript') {
      const state = store.getState();
      const { enabled: luaEnabled } = state.lua;
      const { script, id } = message.payload;
      if (!luaEnabled) {
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
      this.startWorker(id, { id, code: script, type: 'oneshot' }, this.paths);
    } else if (message.type === 'scriptExecutionResult') {
      const { id, success, error } = message;
      if (error)
        log(
          'error',
          `[Worker Manager] Script ${id} failed with error: ${error}`,
        );
      const cavebotWorkerEntry = this.workers.get('cavebotWorker');
      if (cavebotWorkerEntry?.worker) {
        cavebotWorkerEntry.worker.postMessage({ type: 'script-finished', id });
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
    if (this.workers.has(name)) return this.workers.get(name).worker;
    try {
      const workerPath = this.getWorkerPath(name);
      const needsSharedScreen = [
        'captureWorker',
        'screenMonitor',
        'minimapMonitor',
        'regionMonitor',
        'ocrWorker',
      ].includes(name);
      const needsPlayerPosSAB = [
        'minimapMonitor',
        'pathfinderWorker',
        'cavebotWorker',
      ].includes(name);
      const needsPathDataSAB = ['pathfinderWorker', 'cavebotWorker'].includes(
        name,
      );
      const workerData = {
        paths: paths || this.paths,
        sharedData: needsSharedScreen ? this.sharedData : null,
        playerPosSAB: needsPlayerPosSAB ? this.sharedData.playerPosSAB : null,
        pathDataSAB: needsPathDataSAB ? this.sharedData.pathDataSAB : null,
        enableMemoryLogging: true,
      };
      if (needsSharedScreen) {
        workerData.display = store.getState().global.display;
      }
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
        if (
          name !== 'captureWorker' &&
          !(/^[0-9a-fA-F]{8}-/.test(name) && scriptConfig?.type === 'oneshot')
        ) {
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
    if (this.restartLocks.get(name)) return null;
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
    if (!workerEntry?.worker) return Promise.resolve();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.workers.has(name) && !workerEntry.worker.killed) {
          workerEntry.worker.terminate();
        }
        resolve();
      }, 5000);
      workerEntry.worker.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      if (
        /^[0-9a-fA-F]{8}-/.test(name) ||
        GRACEFUL_SHUTDOWN_WORKERS.has(name)
      ) {
        workerEntry.worker.postMessage({ type: 'shutdown' });
      } else {
        workerEntry.worker.terminate();
      }
    });
  }

  async stopAllWorkers() {
    log('info', '[Worker Manager] Stopping all workers...');
    await Promise.all(
      Array.from(this.workers.keys()).map((name) => this.stopWorker(name)),
    );
    log('info', '[Worker Manager] All workers have been terminated.');
  }

  getStateChanges(currentState, previousState) {
    const changedSlices = {};
    let hasChanges = false;
    for (const key in currentState) {
      if (currentState[key] !== previousState[key]) {
        changedSlices[key] = currentState[key];
        hasChanges = true;
      }
    }
    return hasChanges ? changedSlices : null;
  }

  broadcastStateUpdate(changedSlices) {
    const changedKeys = Object.keys(changedSlices);
    const currentState = store.getState(); // Get the full current state for comparison

    for (const [name, workerEntry] of this.workers) {
      if (
        !workerEntry.worker ||
        name === 'captureWorker' ||
        (/^[0-9a-fA-F]{8}-/.test(name) &&
          workerEntry.config?.type === 'oneshot')
      )
        continue;

      // --- FIX: Custom, precise dependency check for pathfinderWorker ---
      if (name === 'pathfinderWorker') {
        const relevantPayload = {};
        let needsUpdate = false;

        if (changedKeys.includes('gameState')) {
          needsUpdate = true;
          relevantPayload.gameState = changedSlices.gameState;
        }

        if (changedKeys.includes('cavebot')) {
          const oldCavebot = this.previousState.cavebot;
          const newCavebot = currentState.cavebot;
          // Only trigger an update if the *inputs* to the pathfinder have changed.
          // This prevents an update caused by its own `pathfindingFeedback` output.
          if (
            oldCavebot.wptId !== newCavebot.wptId ||
            oldCavebot.currentSection !== newCavebot.currentSection ||
            oldCavebot.waypointSections !== newCavebot.waypointSections ||
            oldCavebot.specialAreas !== newCavebot.specialAreas
          ) {
            needsUpdate = true;
            relevantPayload.cavebot = newCavebot;
          }
        }

        if (needsUpdate) {
          workerEntry.worker.postMessage({
            type: 'state_diff',
            payload: relevantPayload,
          });
        }
        continue; // Move to the next worker
      }
      // --- END FIX ---

      const workerDeps = WORKER_STATE_DEPENDENCIES[name];
      const relevant = {};
      let needsUpdate = false;
      if (workerDeps) {
        for (const k of changedKeys) {
          if (workerDeps.includes(k)) {
            relevant[k] = changedSlices[k];
            needsUpdate = true;
          }
        }
      } else {
        Object.assign(relevant, changedSlices);
        needsUpdate = true;
      }
      if (needsUpdate && Object.keys(relevant).length) {
        const hash = quickHash(relevant);
        if (this.workerStateCache.get(name) !== hash) {
          this.workerStateCache.set(name, hash);
          workerEntry.worker.postMessage({
            type: 'state_diff',
            payload: relevant,
          });
        }
      }
    }
  }

  logPerformanceStats() {
    const now = Date.now();
    if (now - this.lastPerfReport >= 10000) {
      const ups = (
        (this.updateCount / (now - this.lastPerfReport)) *
        1000
      ).toFixed(1);
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
      const { enabled: luaEnabled } = currentState.lua;

      if (windowId && display) {
        if (!this.sharedData) this.createSharedBuffers();
        if (
          !this.previousState ||
          currentState.global.windowId !== this.previousState.global.windowId
        ) {
          const syncArray = new Int32Array(this.sharedData.syncSAB);
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
          this.workerConfig.cavebotWorker &&
          !this.workers.has('cavebotWorker')
        )
          this.startWorker('cavebotWorker');
        if (
          this.workerConfig.pathfinderWorker &&
          !this.workers.has('pathfinderWorker')
        )
          this.startWorker('pathfinderWorker');
      } else {
        const persistentWorkers = [
          'captureWorker',
          'regionMonitor',
          'screenMonitor',
          'minimapMonitor',
          'ocrWorker',
          'cavebotWorker',
          'pathfinderWorker',
        ];
        const workersToStop = Array.from(this.workers.keys()).filter((name) =>
          persistentWorkers.includes(name),
        );
        if (workersToStop.length > 0) {
          log(
            'info',
            '[Worker Manager] Window not detected, stopping persistent workers...',
          );
          await Promise.all(workersToStop.map((w) => this.stopWorker(w)));
        }
        if (this.sharedData) {
          log('info', '[Worker Manager] Clearing SharedArrayBuffers.');
          this.sharedData = null;
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
      const workersToStop = Array.from(runningScriptWorkerIds).filter(
        (id) => !activeScriptIds.has(id),
      );
      if (workersToStop.length)
        await Promise.all(workersToStop.map((id) => this.stopWorker(id)));
      for (const script of activeScripts) {
        const entry = this.workers.get(script.id);
        if (!entry) {
          this.startWorker(script.id, script, this.paths);
        } else if (
          entry.config &&
          (entry.config.code !== script.code ||
            entry.config.loopMin !== script.loopMin ||
            entry.config.loopMax !== script.loopMax)
        ) {
          await this.restartWorker(script.id, script);
        } else {
          entry.config = script;
        }
      }
    } else {
      if (runningScriptWorkerIds.size > 0) {
        await Promise.all(
          Array.from(runningScriptWorkerIds).map((id) => this.stopWorker(id)),
        );
      }
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
