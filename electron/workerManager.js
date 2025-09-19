// /home/feiron/Dokumenty/Automaton/electron/workerManager.js
// --- Drop-in Replacement ---

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
import { deepHash } from './utils/deepHash.js'; // Import deepHash
import {
  PLAYER_POS_SAB_SIZE,
  PATH_DATA_SAB_SIZE,
  BATTLE_LIST_SAB_SIZE,
  CREATURES_SAB_SIZE,
  LOOTING_SAB_SIZE,
  TARGETING_LIST_SAB_SIZE,
  TARGET_SAB_SIZE,
} from './workers/sharedConstants.js';

const log = createLogger();

const DEFAULT_WORKER_CONFIG = {
  captureWorker: true,
  regionMonitor: true,
  screenMonitor: true,
  minimapMonitor: true,
  ocrWorker: true,
  creatureMonitor: true,
  cavebotWorker: true,
  targetingWorker: true,
  pathfinderWorker: true,
  windowTitleMonitor: true,
  inputOrchestrator: true,
  enableLuaScriptWorkers: true,
};

const MAX_RESTART_ATTEMPTS = 5;
const RESTART_COOLDOWN = 500;
const RESTART_LOCK_TIMEOUT = 5000;
const DEBOUNCE_INTERVAL = 16;

function quickHash(obj) {
  return deepHash(obj);
}

const WORKER_STATE_DEPENDENCIES = {
  // cavebotWorker needs the full state, so it's handled separately
  // luaScriptWorker also needs the full state, handled separately

  targetingWorker: [
    'targeting',
    'global',
    'gameState',
    'pathfinder',
    'cavebot',
    'regionCoordinates',
    'battleList',
  ],
  regionMonitor: ['global'],
  screenMonitor: [
    'global',
    'regionCoordinates',
    'gameState',
    'rules',
    'uiValues',
  ],
  minimapMonitor: ['gameState', 'regionCoordinates'],
  ocrWorker: ['global', 'regionCoordinates', 'gameState', 'ocr'],
  creatureMonitor: [
    'global',
    'regionCoordinates',
    'gameState',
    'ocr',
    'cavebot',
    'targeting',
  ],
  captureWorker: ['global'],
  pathfinderWorker: ['targeting', 'cavebot', 'gameState'],
  windowTitleMonitor: ['global', 'gameState'],
  inputOrchestrator: ['global'],
};

const GRACEFUL_SHUTDOWN_WORKERS = new Set([
  'regionMonitor',
  'screenMonitor',
  'minimapMonitor',
  'ocrWorker',
  'creatureMonitor',
  'cavebotWorker',
  'targetingWorker',
  'pathfinderWorker',
]);

// --- NEW ---
/**
 * Checks if two rectangle objects intersect.
 * @param {object} rectA - The first rectangle {x, y, width, height}.
 * @param {object} rectB - The second rectangle {x, y, width, height}.
 * @returns {boolean} True if the rectangles overlap.
 */
function rectsIntersect(rectA, rectB) {
  if (
    !rectA ||
    !rectB ||
    rectA.width <= 0 ||
    rectA.height <= 0 ||
    rectB.width <= 0 ||
    rectB.height <= 0
  ) {
    return false;
  }
  return (
    rectA.x < rectB.x + rectB.width &&
    rectA.x + rectA.width > rectB.x &&
    rectA.y < rectB.y + rectB.height &&
    rectA.y + rectA.height > rectB.y
  );
}

// --- NEW ---
// Maps workers to the regions they depend on for frame updates.
const WORKER_REGION_DEPENDENCIES = {
  screenMonitor: [
    'healthBar',
    'manaBar',
    'cooldownBar',
    'statusBar',
    'amuletSlot',
    'ringSlot',
    'bootsSlot',
    'hotkeyBar',
    'battleList',
  ],
  minimapMonitor: ['minimapFull', 'minimapFloorIndicatorColumn'],
  ocrWorker: [
    'skillsWidget',
    'chatBoxTabRow',
    'selectCharacterModal',
    'vipWidget',
    'gameWorld',
    'battleList',
  ],
  creatureMonitor: ['gameWorld'],
  // `null` is a special case: regionMonitor needs an update on ANY screen change.
  regionMonitor: null,
};

class WorkerManager {
  constructor() {
    const filename = fileURLToPath(import.meta.url);
    this.electronDir = dirname(filename);
    this.workers = new Map();
    this.workerInitialized = new Map();
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
    this.debounceTimeout = null;
    this.sharedLuaGlobals = {}; // NEW: Centralized object for shared Lua globals
    this.handleWorkerError = this.handleWorkerError.bind(this);
    this.handleWorkerExit = this.handleWorkerExit.bind(this);
    this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
    this.handleStoreUpdate = this.handleStoreUpdate.bind(this);
    this.debouncedStoreUpdate = this.debouncedStoreUpdate.bind(this);
    this.precalculatedWorkerPayloads = new Map(); // New map for pre-calculated payloads
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
    // ====================== MODIFICATION START ======================
    // Point cavebotWorker to its new modular entry point.
    if (workerName === 'cavebotWorker') {
      return resolve(this.electronDir, './workers', 'cavebot', 'index.js');
    }
    // ======================= MODIFICATION END =======================
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
    const battleListSAB = new SharedArrayBuffer(
      BATTLE_LIST_SAB_SIZE * Int32Array.BYTES_PER_ELEMENT,
    );
    const creaturesSAB = new SharedArrayBuffer(
      CREATURES_SAB_SIZE * Int32Array.BYTES_PER_ELEMENT,
    );
    const lootingSAB = new SharedArrayBuffer(
      LOOTING_SAB_SIZE * Int32Array.BYTES_PER_ELEMENT,
    );
    const targetingListSAB = new SharedArrayBuffer(
      TARGETING_LIST_SAB_SIZE * Int32Array.BYTES_PER_ELEMENT,
    );
    const targetSAB = new SharedArrayBuffer(
      TARGET_SAB_SIZE * Int32Array.BYTES_PER_ELEMENT,
    );

    this.sharedData = {
      imageSAB,
      syncSAB,
      playerPosSAB,
      pathDataSAB,
      battleListSAB,
      creaturesSAB,
      lootingSAB,
      targetingListSAB,
      targetSAB,
    };
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
    this.workerInitialized.delete(name);
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

  handleWorkerMessage(message, workerName) {
    if (message.type === 'request_state_snapshot') {
      const worker = this.workers.get(workerName)?.worker;
      if (worker) {
        worker.postMessage({
          type: 'state_snapshot',
          payload: store.getState(),
        });
      }
      return;
    }

    if (message.type === 'inputAction') {
      const inputOrchestrator = this.workers.get('inputOrchestrator');
      if (inputOrchestrator && inputOrchestrator.worker) {
        inputOrchestrator.worker.postMessage(message);
      }
      return;
    }

    // --- MODIFIED: Centralized Frame Update Distribution ---
    if (message.type === 'frame-update') {
      const dirtyRects = message.payload.dirtyRects;
      if (!dirtyRects || dirtyRects.length === 0) return;

      const allRegions = store.getState().regionCoordinates.regions;
      if (!allRegions) return;

      for (const [name, workerEntry] of this.workers.entries()) {
        if (name === 'captureWorker' || !workerEntry.worker) continue;

        const dependencies = WORKER_REGION_DEPENDENCIES[name];

        // Special case for regionMonitor: it needs an update on ANY screen change.
        if (dependencies === null) {
          workerEntry.worker.postMessage(message);
          continue;
        }

        if (dependencies) {
          let needsUpdate = false;
          for (const regionKey of dependencies) {
            const region = allRegions[regionKey];
            if (region) {
              for (const dirtyRect of dirtyRects) {
                if (rectsIntersect(region, dirtyRect)) {
                  workerEntry.worker.postMessage(message);
                  needsUpdate = true;
                  break; // Break from inner loop (dirtyRects)
                }
              }
            }
            if (needsUpdate) break; // Break from outer loop (dependencies)
          }
        }
      }
      return;
    }
    // --- END MODIFICATION ---

    if (message.notification) {
      showNotification(message.notification.title, message.notification.body);
    } else if (message.storeUpdate) {
      this.incomingActionQueue.push({
        type: message.type,
        payload: message.payload,
      });
    } else if (message.type === 'batch-update') {
      for (const action of message.payload) {
        setGlobalState(action.type, action.payload);
      }
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
    } else if (message.type === 'lua_global_update') {
      const { key, value } = message.payload;
      log(
        'debug',
        `[Worker Manager] Received lua_global_update: key=${key}, value=${value}`,
      );
      this.sharedLuaGlobals[key] = value; // Update the master copy

      // Broadcast to all other workers, including cavebotWorker
      for (const [name, workerEntry] of this.workers) {
        // The `workerName` is the sender, so don't send it back to the sender
        if (
          name !== workerName &&
          (/^[0-9a-fA-F]{8}-/.test(name) || name === 'cavebotWorker')
        ) {
          workerEntry.worker.postMessage({
            type: 'lua_global_broadcast',
            payload: { key, value },
          });
        }
      }
      return; // Message handled
    } else if (message.type === 'play_alert') {
      playSound('alert.wav');
      return;
    } else if (message.type === 'lua-pause-walking') {
      store.dispatch(setWalkingPause(message.payload));
      return;
    } else if (message.type === 'lua-pause-targeting') {
      store.dispatch(setTargetingPause(message.payload));
      return;
    } else if (message.type === 'lua_set_script_enabled') {
      const { name, enabled } = message.payload;
      setGlobalState('lua/setScriptEnabledByName', { name, enabled });
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
        'creatureMonitor',
      ].includes(name);
      const needsPlayerPosSAB = [
        'minimapMonitor',
        'pathfinderWorker',
        'cavebotWorker',
        'targetingWorker',
        'creatureMonitor',
      ].includes(name);
      const needsPathDataSAB = [
        'pathfinderWorker',
        'cavebotWorker',
        'targetingWorker',
      ].includes(name);
      const needsBattleListSAB = [
        'creatureMonitor',
        'cavebotWorker',
        'targetingWorker',
      ].includes(name);
      const needsCreaturesSAB = [
        'creatureMonitor',
        'cavebotWorker',
        'targetingWorker',
      ].includes(name);
      const needsLootingSAB = [
        'creatureMonitor',
        'cavebotWorker',
        'targetingWorker',
      ].includes(name);
      const needsTargetingListSAB = [
        'creatureMonitor',
        'targetingWorker',
      ].includes(name);
      const needsTargetSAB = [
        'creatureMonitor',
        'cavebotWorker',
        'targetingWorker',
      ].includes(name);

      const workerData = {
        paths: paths || this.paths,
        sharedData: needsSharedScreen ? this.sharedData : null,
        playerPosSAB: needsPlayerPosSAB ? this.sharedData.playerPosSAB : null,
        pathDataSAB: needsPathDataSAB ? this.sharedData.pathDataSAB : null,
        battleListSAB: needsBattleListSAB
          ? this.sharedData.battleListSAB
          : null,
        creaturesSAB: needsCreaturesSAB ? this.sharedData.creaturesSAB : null,
        lootingSAB: needsLootingSAB ? this.sharedData.lootingSAB : null,
        targetingListSAB: needsTargetingListSAB
          ? this.sharedData.targetingListSAB
          : null,
        targetSAB: needsTargetSAB ? this.sharedData.targetSAB : null,
        sharedLuaGlobals: this.sharedLuaGlobals, // NEW: Pass the shared Lua globals object
        enableMemoryLogging: true,
      };
      if (needsSharedScreen) {
        workerData.display = store.getState().global.display;
      }
      const worker = new Worker(workerPath, { name, workerData });
      this.workers.set(name, { worker, config: scriptConfig });
      this.workerInitialized.set(name, false);
      worker.on('message', (msg) => this.handleWorkerMessage(msg, name));
      worker.on('error', (error) => this.handleWorkerError(name, error));
      worker.on('exit', (code) => this.handleWorkerExit(name, code));
      log('info', `[Worker Manager] Worker ${name} started successfully.`);

      if (scriptConfig) {
        setTimeout(() => {
          worker.postMessage({ type: 'init', script: scriptConfig });
        }, 16);
      }

      // NEW: Immediately send global state to inputOrchestrator upon start
      if (name === 'inputOrchestrator') {
        const currentState = store.getState();
        worker.postMessage({
          type: 'state_full_sync',
          payload: { global: currentState.global },
        });
      }

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
    // FIX: If worker doesn't exist or is already stopping, do nothing.
    if (!workerEntry?.worker || workerEntry.stopping) {
      return Promise.resolve();
    }
    // FIX: Mark the worker as stopping to prevent duplicate shutdown commands.
    workerEntry.stopping = true;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.workers.has(name) && !workerEntry.worker.killed) {
          log(
            'warn',
            `[Worker Manager] Worker ${name} did not exit gracefully. Forcing termination.`,
          );
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
    if (this.incomingActionInterval) {
      clearInterval(this.incomingActionInterval);
      this.incomingActionInterval = null;
    }
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

  syncReduxToSAB(currentState) {
    // Sync targeting list to SAB for creatureMonitor
    const creatureMonitorEntry = this.workers.get('creatureMonitor');
    if (creatureMonitorEntry && currentState.targeting?.targetingList) {
      creatureMonitorEntry.worker.postMessage({
        type: 'sab_sync_targeting_list',
        payload: currentState.targeting.targetingList,
      });
    }
  }

  broadcastStateUpdate(changedSlices, currentState) {
    // Sync specific Redux data to SAB before broadcasting
    this.syncReduxToSAB(currentState);

    this.precalculatedWorkerPayloads.clear();
    for (const workerName in WORKER_STATE_DEPENDENCIES) {
      const workerDeps = WORKER_STATE_DEPENDENCIES[workerName];
      const relevantPayload = {};
      let hasRelevantChanges = false;
      for (const k of Object.keys(changedSlices)) {
        if (workerDeps.includes(k)) {
          relevantPayload[k] = changedSlices[k];
          hasRelevantChanges = true;
        }
      }
      if (hasRelevantChanges) {
        this.precalculatedWorkerPayloads.set(workerName, relevantPayload);
      }
    }

    for (const [name, workerEntry] of this.workers) {
      if (!workerEntry.worker || name === 'captureWorker') continue;

      const isLuaWorker =
        /^[0-9a-fA-F]{8}-/.test(name) || name === 'cavebotWorker';

      if (!this.workerInitialized.get(name) || isLuaWorker) {
        // For initial setup or Lua workers, always send the full state
        workerEntry.worker.postMessage(currentState);
        this.workerInitialized.set(name, true);
        if (isLuaWorker) {
          // For Lua workers, we don't use state_diff, so clear cache
          this.workerStateCache.delete(name);
        }
        log('info', `[Worker Manager] Sent full state to ${name}.`);
        continue;
      }

      const relevant = this.precalculatedWorkerPayloads.get(name);

      if (relevant && Object.keys(relevant).length) {
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
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    this.debounceTimeout = setTimeout(() => {
      this.handleStoreUpdate();
    }, DEBOUNCE_INTERVAL);
  }

  async handleStoreUpdate() {
    const perfStart = performance.now();
    this.updateCount++;
    try {
      const currentState = store.getState();
      const { windowId, display } = currentState.global;

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
          this.workerConfig.creatureMonitor &&
          !this.workers.has('creatureMonitor')
        )
          this.startWorker('creatureMonitor');
        if (
          this.workerConfig.pathfinderWorker &&
          !this.workers.has('pathfinderWorker')
        )
          this.startWorker('pathfinderWorker');
        if (
          this.workerConfig.cavebotWorker &&
          !this.workers.has('cavebotWorker')
        )
          this.startWorker('cavebotWorker');
        if (
          this.workerConfig.targetingWorker &&
          !this.workers.has('targetingWorker')
        )
          this.startWorker('targetingWorker');
        if (
          this.workerConfig.windowTitleMonitor &&
          !this.workers.has('windowTitleMonitor')
        )
          this.startWorker('windowTitleMonitor');

        if (
          this.workerConfig.inputOrchestrator &&
          !this.workers.has('inputOrchestrator')
        )
          this.startWorker('inputOrchestrator');
      } else {
        if (this.workers.size > 0) {
          log(
            'info',
            '[Worker Manager] Window not detected, stopping all workers...',
          );
          await this.stopAllWorkers();
        }
        if (this.sharedData) {
          log('info', '[Worker Manager] Clearing SharedArrayBuffers.');
          this.sharedData = null;
        }
      }

      await this.manageLuaWorkers(currentState, currentState.lua.enabled);

      if (this.previousState) {
        const changed = this.getStateChanges(currentState, this.previousState);
        if (changed) this.broadcastStateUpdate(changed, currentState);
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

    this.incomingActionQueue = [];
    this.incomingActionInterval = setInterval(() => {
      if (this.incomingActionQueue.length > 0) {
        const batch = this.incomingActionQueue.splice(
          0,
          this.incomingActionQueue.length,
        );
        for (const action of batch) {
          setGlobalState(action.type, action.payload);
        }
      }
    }, 5);
  }
}

const workerManager = new WorkerManager();
export default workerManager;
