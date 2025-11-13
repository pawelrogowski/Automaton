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
import { deepHash } from './utils/deepHash.js';
import { rectsIntersect } from './utils/rectsIntersect.js';

// Unified SAB State Management
import { SABState, CONTROL_STATES } from './workers/sabState/index.js';

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
    'workerConfig',
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
    'workerConfig',
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
  creatureMonitor: ['gameWorld', 'battleList', 'playerList', 'npcList'],
  // `null` is a special case: regionMonitor needs an update on ANY screen change.
  regionMonitor: null,
};

let inspectorPort = 9230; // Base port for worker inspection

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
    this.paths = { workers: null, minimapResources: null };
    this.previousState = null;
    this.storeUpdateTimeout = null;
    this.updateCount = 0;
    this.lastPerfReport = Date.now();
    this.reusableChangedSlices = {};
    this.workerStateCache = new Map();
    this.debounceTimeout = null;
    this.sharedLuaGlobals = {}; // NEW: Centralized object for shared Lua globals
    this.awaitingInputActions = new Map(); // NEW: Map to track which worker is waiting for which actionId
    this.handleWorkerError = this.handleWorkerError.bind(this);
    this.handleWorkerExit = this.handleWorkerExit.bind(this);
    this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
    this.handleStoreUpdate = this.handleStoreUpdate.bind(this);
    this.debouncedStoreUpdate = this.debouncedStoreUpdate.bind(this);
    this.precalculatedWorkerPayloads = new Map(); // New map for pre-calculated payloads
    this.debounceMs = 16; // adaptive debounce interval for store updates
    this.updateTimeEma = 8; // ms, exponential moving average of update time

    // NEW: Unified SAB State Management
    this.sabState = null; // Will be initialized with SABState instance
    this.reduxSyncInterval = null; // Interval for SAB → Redux sync
    this.lastReduxSyncTime = 0;
    this.previousConfigState = {}; // Track config changes
    this.lastSyncedVersions = null; // Initialized when SAB → Redux sync starts
  }

  setupPaths(app, cwd) {
    if (app.isPackaged) {
      this.paths.minimapResources = path.join(
        app.getAppPath(),
        '..',
        'resources',
        'preprocessed_minimaps',
      );
    } else {
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
    if (workerName === 'cavebotWorker') {
      return resolve(this.electronDir, './workers', 'cavebot', 'index.js');
    }
    return resolve(this.electronDir, './workers', `${workerName}.js`);
  }

  createSharedBuffers() {
    const maxImageSize = 3840 * 2160 * 4;
    // Single image buffer for screen capture
    const imageSAB = new SharedArrayBuffer(maxImageSize + 8); // +8 for width/height header
    const MAX_DIRTY_REGIONS = 100;
    const SYNC_BUFFER_SIZE = 6 + MAX_DIRTY_REGIONS * 4;
    const syncSAB = new SharedArrayBuffer(
      SYNC_BUFFER_SIZE * Int32Array.BYTES_PER_ELEMENT,
    );

    this.sharedData = {
      imageSAB,
      syncSAB,
    };
    log(
      'info',
      '[Worker Manager] Created SharedArrayBuffers (imageSAB, syncSAB).',
    );

    // NEW: Create unified SAB state manager
    try {
      this.sabState = new SABState();
      log('info', '[Worker Manager] Created unified SABState manager.');

      // Start Redux → SAB sync (immediate on store changes)
      this.setupReduxToSABSync();

      // Start SAB → Redux sync (throttled 100ms)
      this.startSABToReduxSync();
    } catch (error) {
      log('error', '[Worker Manager] Failed to create SABState:', error);
    }
  }

  /**
   * Setup Redux → SAB sync (immediate on config changes)
   * Writes UI config to SAB whenever Redux state changes
   */
  setupReduxToSABSync() {
    if (!this.sabState) return;

    // Subscribe to Redux store changes
    const unsubscribe = store.subscribe(() => {
      if (!this.sabState) return;

      try {
        const state = store.getState();

        // Sync cavebot config
        if (this.configChanged('cavebot', state.cavebot)) {
          const controlStateMap = {
            CAVEBOT: CONTROL_STATES.CAVEBOT,
            HANDOVER_TO_TARGETING: CONTROL_STATES.HANDOVER_TO_TARGETING,
            TARGETING: CONTROL_STATES.TARGETING,
            HANDOVER_TO_CAVEBOT: CONTROL_STATES.HANDOVER_TO_CAVEBOT,
          };

          this.sabState.set('cavebotConfig', {
            enabled: state.cavebot?.enabled ? 1 : 0,
            controlState:
              controlStateMap[state.cavebot?.controlState] ??
              CONTROL_STATES.CAVEBOT,
            nodeRange: state.cavebot?.nodeRange ?? 1,
            isPausedByScript: state.cavebot?.isPausedByScript ? 1 : 0,
            currentSection: state.cavebot?.currentSection ?? '',
            wptId: state.cavebot?.wptId ?? '',
          });

          // NOTE:
          // dynamicTarget in SAB is now authored exclusively by targetingWorker
          // via sabInterface.set('dynamicTarget', ...).
          // We intentionally do NOT mirror cavebot.dynamicTarget into SAB here
          // to avoid races and duplicated writers.

          // Sync targetWaypoint (resolve current waypoint coordinates)
          const wptId = state.cavebot?.wptId;
          const currentSection = state.cavebot?.currentSection;
          const waypointSections = state.cavebot?.waypointSections;

          if (
            wptId &&
            currentSection &&
            waypointSections &&
            waypointSections[currentSection]
          ) {
            const targetWaypoint = waypointSections[
              currentSection
            ].waypoints.find((wp) => wp.id === wptId);

            if (targetWaypoint) {
              this.sabState.set('targetWaypoint', {
                x: targetWaypoint.x ?? 0,
                y: targetWaypoint.y ?? 0,
                z: targetWaypoint.z ?? 0,
                valid: 1,
              });
            } else {
              // Waypoint ID exists but not found - clear
              this.sabState.set('targetWaypoint', {
                x: 0,
                y: 0,
                z: 0,
                valid: 0,
              });
            }
          } else {
            // No target waypoint
            this.sabState.set('targetWaypoint', {
              x: 0,
              y: 0,
              z: 0,
              valid: 0,
            });
          }

          // Sync specialAreas
          const specialAreas = state.cavebot?.specialAreas || [];
          this.sabState.set(
            'specialAreas',
            specialAreas.map((area) => ({
              x: area.x ?? 0,
              y: area.y ?? 0,
              z: area.z ?? 0,
              sizeX: area.sizeX ?? 1,
              sizeY: area.sizeY ?? 1,
              avoidance: area.avoidance ?? 0,
              enabled: area.enabled ? 1 : 0,
              hollow: area.hollow ? 1 : 0,
            })),
          );

          // Sync temporaryBlockedTiles
          const temporaryBlockedTiles =
            state.cavebot?.temporaryBlockedTiles || [];
          this.sabState.set(
            'temporaryBlockedTiles',
            temporaryBlockedTiles.map((tile) => ({
              x: tile.x ?? 0,
              y: tile.y ?? 0,
              z: tile.z ?? 0,
              expiresAt: Math.floor((tile.expiresAt ?? 0) / 100), // Scale down to fit int32
            })),
          );

          // Sync visitedTiles
          const visitedTiles = state.cavebot?.visitedTiles || [];
          this.sabState.set(
            'visitedTiles',
            visitedTiles.map((tile) => ({
              x: tile.x ?? 0,
              y: tile.y ?? 0,
              z: tile.z ?? 0,
            })),
          );

          this.previousConfigState.cavebot = {
            version: state.cavebot?.version,
            enabled: state.cavebot?.enabled,
            controlState: state.cavebot?.controlState,
            wptId: state.cavebot?.wptId,
            dynamicTarget: state.cavebot?.dynamicTarget,
          };
        }

        // Sync targeting config
        if (this.configChanged('targeting', state.targeting)) {
          this.sabState.set('targetingConfig', {
            enabled: state.targeting?.enabled ? 1 : 0,
          });

          this.previousConfigState.targeting = {
            version: state.targeting?.version,
            enabled: state.targeting?.enabled,
          };
        }

        // Sync global config
        if (this.configChanged('global', state.global)) {
          this.sabState.set('globalConfig', {
            windowId: parseInt(state.global?.windowId ?? 0, 10),
            display: state.global?.display ? 1 : 0,
          });

          this.previousConfigState.global = {
            version: state.global?.version,
            windowId: state.global?.windowId,
            display: state.global?.display,
          };
        }

        // Sync creatureMonitor worker config
        if (this.configChanged('workerConfig', state.workerConfig)) {
          const cmConfig = state.workerConfig?.creatureMonitor;
          if (cmConfig) {
            this.sabState.set('creatureMonitorConfig', {
              PLAYER_ANIMATION_FREEZE_MS:
                cmConfig.PLAYER_ANIMATION_FREEZE_MS ?? 25,
              STICKY_SNAP_THRESHOLD_TILES: Math.round(
                (cmConfig.STICKY_SNAP_THRESHOLD_TILES ?? 0.5) * 100,
              ),
              JITTER_CONFIRMATION_TIME_MS:
                cmConfig.JITTER_CONFIRMATION_TIME_MS ?? 75,
              CORRELATION_DISTANCE_THRESHOLD_PIXELS:
                cmConfig.CORRELATION_DISTANCE_THRESHOLD_PIXELS ?? 200,
              CREATURE_GRACE_PERIOD_MS:
                cmConfig.CREATURE_GRACE_PERIOD_MS ?? 250,
              UNMATCHED_BLACKLIST_MS: cmConfig.UNMATCHED_BLACKLIST_MS ?? 500,
              NAME_MATCH_THRESHOLD: Math.round(
                (cmConfig.NAME_MATCH_THRESHOLD ?? 0.4) * 100,
              ),
            });
          }

          const twConfig = state.workerConfig?.targetingWorker;
          if (twConfig) {
            this.sabState.set('targetingWorkerConfig', {
              mainLoopIntervalMs: twConfig.mainLoopIntervalMs ?? 50,
              unreachableTimeoutMs: twConfig.unreachableTimeoutMs ?? 250,
              clickThrottleMs: twConfig.clickThrottleMs ?? 250,
              verifyWindowMs: twConfig.verifyWindowMs ?? 300,
              antiStuckAdjacentMs: twConfig.antiStuckAdjacentMs ?? 5000,
            });
          }

          this.previousConfigState.workerConfig = {
            version: state.workerConfig?.version,
          };
        }
      } catch (error) {
        log('error', '[Worker Manager] Error in Redux → SAB sync:', error);
      }
    });

    // Store unsubscribe function for cleanup
    this.reduxSyncUnsubscribe = unsubscribe;
    log('info', '[Worker Manager] Redux → SAB sync enabled');
  }

  /**
   * Check if config has changed
   */
  configChanged(sliceName, currentSlice) {
    const prev = this.previousConfigState[sliceName];
    if (!prev) return true; // First time

    // Check version if available
    if (
      typeof currentSlice?.version === 'number' &&
      typeof prev.version === 'number'
    ) {
      return currentSlice.version !== prev.version;
    }

    // Fallback: deep check key properties
    if (sliceName === 'cavebot') {
      return (
        currentSlice?.enabled !== prev.enabled ||
        currentSlice?.controlState !== prev.controlState ||
        currentSlice?.wptId !== prev.wptId ||
        currentSlice?.dynamicTarget !== prev.dynamicTarget
      );
    } else if (sliceName === 'targeting') {
      return currentSlice?.enabled !== prev.enabled;
    } else if (sliceName === 'workerConfig') {
      return currentSlice?.version !== prev.version;
    } else if (sliceName === 'global') {
      return (
        currentSlice?.windowId !== prev.windowId ||
        currentSlice?.display !== prev.display
      );
    }

    return false;
  }

  /**
   * Start SAB → Redux sync (throttled 100ms)
   * Reads real-time data from SAB and dispatches to Redux for UI
   */
  startSABToReduxSync() {
    if (!this.sabState) return;
    if (this.reduxSyncInterval) return; // Already started

    // Track last synced versions to avoid redundant Redux updates
    this.lastSyncedVersions = {
      playerPos: -1,
      creatures: -1,
      battleList: -1,
      target: -1,
      cavebotPathData: -1,
      targetingPathData: -1,
    };

    this.reduxSyncInterval = setInterval(() => {
      if (!this.sabState) return;

      try {
        const now = Date.now();

        // Throttle to once per 100ms
        if (now - this.lastReduxSyncTime < 100) return;
        this.lastReduxSyncTime = now;

        // Read real-time data from SAB
        const playerPosResult = this.sabState.get('playerPos');
        const creaturesResult = this.sabState.get('creatures');
        const battleListResult = this.sabState.get('battleList');
        const targetResult = this.sabState.get('target');
        const cavebotPathResult = this.sabState.get('cavebotPathData');
        const targetingPathResult = this.sabState.get('targetingPathData');

        // Build batch update payload
        const updates = {};
        let hasUpdates = false;

        if (
          playerPosResult?.data &&
          playerPosResult.version !== this.lastSyncedVersions.playerPos
        ) {
          this.lastSyncedVersions.playerPos = playerPosResult.version;
          updates.gameState = updates.gameState || {};
          updates.gameState.playerMinimapPosition = {
            x: playerPosResult.data.x,
            y: playerPosResult.data.y,
            z: playerPosResult.data.z,
          };
          hasUpdates = true;
        }

        if (
          creaturesResult?.data &&
          creaturesResult.version !== this.lastSyncedVersions.creatures
        ) {
          this.lastSyncedVersions.creatures = creaturesResult.version;
          updates.targeting = updates.targeting || {};
          updates.targeting.creatures = creaturesResult.data;
          hasUpdates = true;
        }

        if (
          battleListResult?.data &&
          battleListResult.version !== this.lastSyncedVersions.battleList
        ) {
          this.lastSyncedVersions.battleList = battleListResult.version;
          updates.battleList = { entries: battleListResult.data };
          hasUpdates = true;
        }

        if (
          targetResult?.data &&
          targetResult.data.instanceId !== 0 &&
          targetResult.version !== this.lastSyncedVersions.target
        ) {
          this.lastSyncedVersions.target = targetResult.version;
          updates.targeting = updates.targeting || {};
          updates.targeting.target = {
            instanceId: targetResult.data.instanceId,
            name: targetResult.data.name,
            distance: targetResult.data.distance / 100,
            isReachable: targetResult.data.isReachable === 1,
            gameCoordinates: {
              x: targetResult.data.x,
              y: targetResult.data.y,
              z: targetResult.data.z,
            },
          };
          hasUpdates = true;
        }

        // Sync cavebot path data → dedicated pathfinder slice channel
        if (
          cavebotPathResult?.data &&
          cavebotPathResult.version !== this.lastSyncedVersions.cavebotPathData
        ) {
          this.lastSyncedVersions.cavebotPathData = cavebotPathResult.version;
          const waypoints = cavebotPathResult.data.waypoints || [];
          const status = this.getPathStatusString(
            cavebotPathResult.data.status,
          );
          const chebyshevDistance =
            typeof cavebotPathResult.data.chebyshevDistance === 'number'
              ? cavebotPathResult.data.chebyshevDistance
              : null;

          setGlobalState('pathfinder/setCavebotPath', {
            waypoints,
            status,
            chebyshevDistance,
          });
          hasUpdates = true;
        }

        // Sync targeting path data → dedicated pathfinder slice channel
        if (
          targetingPathResult?.data &&
          targetingPathResult.version !==
            this.lastSyncedVersions.targetingPathData
        ) {
          this.lastSyncedVersions.targetingPathData =
            targetingPathResult.version;
          const waypoints = targetingPathResult.data.waypoints || [];
          const status = this.getPathStatusString(
            targetingPathResult.data.status,
          );
          const chebyshevDistance =
            typeof targetingPathResult.data.chebyshevDistance === 'number'
              ? targetingPathResult.data.chebyshevDistance
              : null;

          setGlobalState('pathfinder/setTargetingPath', {
            waypoints,
            status,
            chebyshevDistance,
          });
          hasUpdates = true;
        }

        // Dispatch batch update to Redux using setGlobalState
        if (hasUpdates) {
          for (const [sliceName, sliceUpdates] of Object.entries(updates)) {
            // For slices managed via granular actions, use individual keys
            for (const [key, value] of Object.entries(sliceUpdates)) {
              setGlobalState(`${sliceName}/${key}`, value);
            }
          }
        }
      } catch (error) {
        log('error', '[Worker Manager] Error in SAB → Redux sync:', error);
      }
    }, 100);

    log('info', '[Worker Manager] SAB → Redux sync started (100ms interval)');
  }

  /**
   * Convert path status enum to string (shared by cavebot/targeting path channels)
   */
  getPathStatusString(status) {
    const statusMap = {
      0: 'IDLE',
      1: 'PATH_FOUND',
      2: 'WAYPOINT_REACHED',
      3: 'NO_PATH_FOUND',
      4: 'DIFFERENT_FLOOR',
      5: 'ERROR',
      6: 'NO_VALID_START_OR_END',
      7: 'BLOCKED_BY_CREATURE',
    };
    return statusMap[status] || 'IDLE';
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

    if (message.type === 'request_regions_snapshot') {
      const worker = this.workers.get(workerName)?.worker;
      if (worker) {
        const full = store.getState().regionCoordinates;
        worker.postMessage({ type: 'regions_snapshot', payload: full });
      }
      return;
    }

    if (message.type === 'inputAction') {
      const { payload } = message;
      // NEW: If the action has an ID, it's from a Lua worker that needs a response.
      if (payload.actionId !== undefined) {
        this.awaitingInputActions.set(payload.actionId, workerName);
      }
      const inputOrchestrator = this.workers.get('inputOrchestrator');
      if (inputOrchestrator && inputOrchestrator.worker) {
        inputOrchestrator.worker.postMessage(message);
      }
      return;
    }

    // NEW: Handle the completion message from the orchestrator
    if (message.type === 'inputActionCompleted') {
      const { actionId } = message.payload;
      const originWorkerName = this.awaitingInputActions.get(actionId);
      if (originWorkerName) {
        const originWorker = this.workers.get(originWorkerName);
        if (originWorker && originWorker.worker) {
          originWorker.worker.postMessage(message);
        }
        this.awaitingInputActions.delete(actionId); // Clean up the map
      }
      return;
    }

    // // Forward pause/resume messages to mouseNoiseWorker
    // if (message.type === 'pauseMouseNoise') {
    //   const mouseNoiseWorker = this.workers.get('mouseNoiseWorker');
    //   if (mouseNoiseWorker && mouseNoiseWorker.worker) {
    //     mouseNoiseWorker.worker.postMessage({ type: 'mouseNoisePause' });
    //   }
    //   return;
    // }

    // if (message.type === 'resumeMouseNoise') {
    //   const mouseNoiseWorker = this.workers.get('mouseNoiseWorker');
    //   if (mouseNoiseWorker && mouseNoiseWorker.worker) {
    //     mouseNoiseWorker.worker.postMessage({ type: 'mouseNoiseResume' });
    //   }
    //   return;
    // }

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
      // Track duplicate actions being queued
      const existingIndex = this.incomingActionQueue.findIndex(
        (a) => a.type === message.type,
      );
      if (existingIndex !== -1) {
        log(
          'warn',
          `[Worker Manager] Duplicate action queued from ${workerName}: ${message.type} (${this.incomingActionQueue.length} items in queue)`,
        );
      }
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
      const soundFile = message.payload?.soundFile || 'alert.wav';
      playSound(soundFile);
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

      // Targeting worker does not need shared screen buffer, but should receive unified SAB
      const workerData = {
        paths: paths || this.paths,
        sharedData: needsSharedScreen ? this.sharedData : null,
        sharedLuaGlobals: this.sharedLuaGlobals,
        enableMemoryLogging: true,
        // Pass unified SAB state to all workers that need it
        unifiedSAB: this.sabState
          ? this.sabState.getSharedArrayBuffer()
          : null,
      };
      if (needsSharedScreen) {
        workerData.display = store.getState().global.display;
      }

      const execArgv = [`--inspect=${inspectorPort++}`];
      const worker = new Worker(workerPath, {
        name,
        workerData,
        execArgv,
      });

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
      const curr = currentState[key];
      const prev = previousState[key];

      if (prev === undefined) {
        changedSlices[key] = curr;
        hasChanges = true;
        continue;
      }

      const currVer =
        curr && typeof curr.version === 'number' ? curr.version : null;
      const prevVer =
        prev && typeof prev.version === 'number' ? prev.version : null;

      if (currVer !== null && prevVer !== null) {
        if (currVer !== prevVer) {
          changedSlices[key] = curr;
          hasChanges = true;
        }
      } else if (curr !== prev) {
        changedSlices[key] = curr;
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

      const workerDeps = WORKER_STATE_DEPENDENCIES[name];
      // Compute signature first, without constructing payload
      const FNV_OFFSET = 0x811c9dc5 >>> 0;
      const FNV_PRIME = 0x01000193 >>> 0;
      let signature = FNV_OFFSET;
      let hasRelevant = false;
      for (const dep of workerDeps) {
        if (Object.prototype.hasOwnProperty.call(changedSlices, dep)) {
          const slice = changedSlices[dep];
          const ver =
            slice && typeof slice.version === 'number'
              ? slice.version
              : quickHash(slice);
          signature = (((signature ^ (ver >>> 0)) >>> 0) * FNV_PRIME) >>> 0;
          hasRelevant = true;
        }
      }
      if (!hasRelevant) continue;

      const hash = signature >>> 0;
      if (this.workerStateCache.get(name) === hash) continue;
      this.workerStateCache.set(name, hash);

      // Construct payload only when signature has changed
      const relevant = {};
      for (const dep of workerDeps) {
        if (Object.prototype.hasOwnProperty.call(changedSlices, dep)) {
          if (
            dep === 'regionCoordinates' &&
            (name === 'minimapMonitor' ||
              name === 'screenMonitor' ||
              name === 'ocrWorker')
          ) {
            const v = changedSlices[dep]?.version;
            relevant[dep] =
              typeof v === 'number' ? { version: v } : { version: 0 };
          } else {
            relevant[dep] = changedSlices[dep];
          }
        }
      }

      if (Object.keys(relevant).length) {
        workerEntry.worker.postMessage({
          type: 'state_diff',
          payload: relevant,
        });
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
    }, this.debounceMs);
  }

  async handleStoreUpdate() {
    const perfStart = performance.now();
    this.updateCount++;
    let isCriticalWindow = false;
    try {
      const currentState = store.getState();
      const { windowId, display } = currentState.global;

      // Detect critical windows where we want faster cadence (if budget allows)
      const cavebotControl = currentState.cavebot?.controlState;
      const targetingEnabled = !!currentState.targeting?.enabled;
      const hasTarget = !!currentState.targeting?.target;
      const hasCreatures = (currentState.targeting?.creatures?.length || 0) > 0;
      if (
        cavebotControl === 'HANDOVER_TO_TARGETING' ||
        cavebotControl === 'TARGETING' ||
        (targetingEnabled && (hasTarget || hasCreatures))
      ) {
        isCriticalWindow = true;
      }

      if (windowId && display) {
        if (!this.sharedData) this.createSharedBuffers();
        const windowIdChanged = this.previousState && 
          currentState.global.windowId !== this.previousState.global.windowId;
        
        if (
          !this.previousState ||
          windowIdChanged
        ) {
          const syncArray = new Int32Array(this.sharedData.syncSAB);
          Atomics.store(syncArray, 4, parseInt(windowId, 10) || 0);
          
          // Notify workers that window has changed - they should reset initial scan flags
          if (windowIdChanged) {
            log('info', '[Worker Manager] Window changed, notifying workers to reset initial scan state');
            for (const [workerName, workerEntry] of this.workers.entries()) {
              if (['screenMonitor', 'ocrWorker', 'minimapMonitor', 'regionMonitor'].includes(workerName)) {
                workerEntry.worker.postMessage({ type: 'window_changed' });
              }
            }
          }
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
        ) {
          // TargetingWorker consumes state snapshots coming primarily from creatureMonitor
          // and targeting slice (enabled flag, creatures, target, etc).
          // It is started automatically once window and display are valid.
          this.startWorker('targetingWorker');
        }
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

        // if (
        //   this.workerConfig.mouseNoiseWorker &&
        //   !this.workers.has('mouseNoiseWorker')
        // )
        //   this.startWorker('mouseNoiseWorker');
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
    // Update EMA and adapt debounce interval with simple hysteresis
    const alpha = 0.2;
    this.updateTimeEma = (1 - alpha) * this.updateTimeEma + alpha * updateTime;

    let newDebounce = this.debounceMs;
    if (this.updateTimeEma > 20) {
      newDebounce = 32; // under load, slow down
    } else if (this.updateTimeEma < 12) {
      newDebounce = 16; // restore baseline
    }

    // Critical window fast-track: if budget allows, go faster (down to 12ms)
    if (isCriticalWindow && this.updateTimeEma < 20) {
      newDebounce = Math.min(newDebounce, 12);
    }

    if (newDebounce !== this.debounceMs) {
      this.debounceMs = newDebounce;
      log(
        'info',
        `[Worker Manager] Debounce adjusted to ${this.debounceMs}ms (EMA ${this.updateTimeEma.toFixed(1)}ms${isCriticalWindow ? ', critical' : ''})`,
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

        // Coalesce high-frequency updates: keep only the last action per type,
        // except for additive event types that must not be deduplicated.
        const ACCUMULATIVE_TYPES = new Set([
          'lua/addLogEntry',
          'cavebot/addVisitedTile',
          'targeting/updateCreatureInTargetingList',
        ]);

        const latestByType = new Map();
        const coalesced = [];

        for (const action of batch) {
          if (ACCUMULATIVE_TYPES.has(action.type)) {
            coalesced.push(action);
          } else {
            latestByType.set(action.type, action);
          }
        }

        // Append latest of each type
        for (const a of latestByType.values()) {
          coalesced.push(a);
        }

        for (const action of coalesced) {
          setGlobalState(action.type, action.payload);
        }
      }
    }, 16);
  }
}

const workerManager = new WorkerManager();
export default workerManager;
