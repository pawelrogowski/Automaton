// /workers/cavebot/index.js

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { CavebotLuaExecutor } from '../cavebotLuaExecutor.js';
import { createLogger } from '../../utils/logger.js';
import { config } from './config.js'; // Still need config for other values
import { createFsm } from './fsm.js';
import { delay } from './helpers/asyncUtils.js';
import {
  postStoreUpdate,
  postGlobalVarUpdate,
  getFreshState,
  updateSABData,
} from './helpers/communication.js';
import {
  findCurrentWaypoint,
  findFirstValidWaypoint,
  advanceToNextWaypoint,
  resetInternalState,
  goToLabel,
  goToSection,
  goToWpt,
} from './helpers/navigation.js';
import { deepMerge } from './helpers/objectUtils.js';

// --- Worker State Management ---
const workerState = {
  globalState: null,
  isShuttingDown: false,
  isInitialized: false,
  fsmState: 'IDLE',
  lastFsmState: null,
  lastControlState: 'CAVEBOT',
  lastPlayerPosCounter: -1,
  lastPathDataCounter: -1,
  playerMinimapPosition: null,
  path: [],
  pathChebyshevDistance: null,
  pathfindingStatus: 0,
  playerPosArray: null,
  pathDataArray: null,
  luaExecutor: null,
  floorChangeGraceUntil: 0,
  lastProcessedWptId: null,
  shouldRequestNewPath: false,
  scriptErrorWaypointId: null,
  scriptErrorCount: 0,
  logger: createLogger({ info: false, error: true, debug: false }),
  parentPort: parentPort,
};

// --- Initialization ---
const fsm = createFsm(workerState, config);
if (workerData.playerPosSAB) {
  workerState.playerPosArray = new Int32Array(workerData.playerPosSAB);
}
if (workerData.pathDataSAB) {
  workerState.pathDataArray = new Int32Array(workerData.pathDataSAB);
}

// --- Main Loop & Orchestration ---

function handleControlHandover() {
  const { waypointIdAtTargetingStart, visitedTiles } =
    workerState.globalState.cavebot;
  let skippedWaypoint = false;

  if (waypointIdAtTargetingStart && visitedTiles && visitedTiles.length > 0) {
    const currentWaypoint = findCurrentWaypoint(workerState.globalState);
    if (
      currentWaypoint &&
      currentWaypoint.id === waypointIdAtTargetingStart &&
      currentWaypoint.type === 'Node'
    ) {
      // Get nodeRange from Redux store
      const radius = workerState.globalState.cavebot.nodeRange;
      const wasVisited = visitedTiles.some(
        (tile) =>
          tile.z === currentWaypoint.z &&
          Math.max(
            Math.abs(tile.x - currentWaypoint.x),
            Math.abs(tile.y - currentWaypoint.y),
          ) <= radius,
      );

      if (wasVisited) {
        workerState.logger(
          'info',
          `[Cavebot] Node waypoint ${currentWaypoint.id} was visited during targeting. Skipping.`,
        );
        advanceToNextWaypoint(workerState, config);
        skippedWaypoint = true;
      }
    }
  }

  postStoreUpdate('cavebot/clearVisitedTiles');
  if (!skippedWaypoint) {
    workerState.shouldRequestNewPath = true;
  }
}

async function performOperation() {
  const { globalState, isInitialized } = workerState;
  if (!globalState || !isInitialized || !globalState.global?.windowId) {
    return;
  }

  if (!globalState.regionCoordinates?.regions?.onlineMarker) {
    if (
      workerState.fsmState === 'SCRIPT' &&
      workerState.luaExecutor.isExecuting()
    ) {
      const scriptContent = workerState.luaExecutor.getCurrentScriptContent();
      if (scriptContent && !scriptContent.includes('login(')) {
        workerState.logger(
          'warn',
          '[Cavebot] Player is offline. Terminating non-login script.',
        );
        workerState.luaExecutor.forceStop();
        resetInternalState(workerState, fsm);
      }
    } else if (workerState.fsmState !== 'IDLE') {
      workerState.logger(
        'info',
        '[Cavebot] Player is offline. Resetting cavebot state.',
      );
      resetInternalState(workerState, fsm);
    }
    return;
  }

  if (
    !globalState.regionCoordinates ||
    !globalState.regionCoordinates.regions.gameWorld
  ) {
    if (
      workerState.fsmState === 'SCRIPT' &&
      workerState.luaExecutor.isExecuting()
    ) {
      const scriptContent = workerState.luaExecutor.getCurrentScriptContent();
      if (scriptContent && !scriptContent.includes('login(')) {
        workerState.logger(
          'warn',
          '[Cavebot] Game world not visible. Terminating non-login script.',
        );
        workerState.luaExecutor.forceStop();
        resetInternalState(workerState, fsm);
      }
    }
    return;
  }

  const {
    enabled: cavebotIsEnabled,
    controlState,
    isPausedByScript,
    isLootingRequired,
  } = globalState.cavebot;

  if (isPausedByScript) {
    if (workerState.fsmState !== 'IDLE') resetInternalState(workerState, fsm);
    return;
  }

  // --- NEW: Respect looting pause from Redux state ---
  if (isLootingRequired) {
    if (workerState.fsmState !== 'IDLE') resetInternalState(workerState, fsm);
    return; // Do not perform any cavebot operations if looting is required
  }
  // --- END NEW ---

  if (!cavebotIsEnabled) {
    if (workerState.fsmState !== 'IDLE') resetInternalState(workerState, fsm);
    return;
  }

  if (controlState !== 'CAVEBOT') {
    if (workerState.lastControlState === 'CAVEBOT') {
      resetInternalState(workerState, fsm); // Reset state when losing control
    }
    workerState.lastControlState = controlState;
    return;
  }

  if (workerState.lastControlState !== 'CAVEBOT') {
    handleControlHandover();
    await delay(config.controlHandoverGraceMs);
  }

  updateSABData(workerState, config);
  if (!workerState.playerMinimapPosition) return;

  let targetWaypoint = findCurrentWaypoint(globalState);
  if (!targetWaypoint) {
    const fallback = findFirstValidWaypoint(globalState);
    if (fallback) {
      workerState.logger(
        'warn',
        'Current waypoint not found, resetting to first valid waypoint.',
      );
      postStoreUpdate('cavebot/setCurrentWaypointSection', fallback.sectionId);
      postStoreUpdate('cavebot/setwptId', fallback.waypoint.id);
    }
    if (workerState.fsmState !== 'IDLE') resetInternalState(workerState, fsm);
    return;
  }

  if (
    workerState.lastProcessedWptId &&
    targetWaypoint.id !== workerState.lastProcessedWptId
  ) {
    resetInternalState(workerState, fsm);
  }
  workerState.lastProcessedWptId = targetWaypoint.id;

  // --- Z-level Mismatch Logic Change ---
  if (
    targetWaypoint.z !== workerState.playerMinimapPosition.z &&
    targetWaypoint.type !== 'Script' // Scripts are now exempt from this check
  ) {
    workerState.logger(
      'debug',
      `Skipping waypoint ${targetWaypoint.id} due to Z-level mismatch.`,
    );
    await advanceToNextWaypoint(workerState, config);
    return;
  }

  const context = {
    playerPos: workerState.playerMinimapPosition,
    targetWaypoint: targetWaypoint,
    status: workerState.pathfindingStatus,
    chebyshevDist: workerState.pathChebyshevDistance,
  };

  const stateLogic = fsm[workerState.fsmState];
  if (stateLogic) {
    const nextState = await stateLogic.execute(context);
    if (nextState && nextState !== workerState.fsmState) {
      workerState.logger(
        'debug',
        `[FSM] State transition: ${workerState.fsmState} -> ${nextState}`,
      );
      workerState.lastFsmState = workerState.fsmState;
      workerState.fsmState = nextState;
      const newStateLogic = fsm[workerState.fsmState];
      if (newStateLogic && newStateLogic.enter) {
        newStateLogic.enter(context);
      }
    }
  } else {
    workerState.logger(
      'error',
      `Invalid FSM state: ${workerState.fsmState}. Resetting to IDLE.`,
    );
    workerState.fsmState = 'IDLE';
  }

  workerState.lastControlState = globalState.cavebot.controlState;
}

async function mainLoop() {
  workerState.logger('info', '[CavebotWorker] Starting main loop...');
  while (!workerState.isShuttingDown) {
    const loopStart = performance.now();
    try {
      await performOperation();
    } catch (error) {
      workerState.logger(
        'error',
        '[CavebotWorker] Unhandled error in main loop:',
        error,
      );
      workerState.fsmState = 'IDLE';
      // --- Error Resilience Change ---
      await delay(config.mainLoopErrorDelayMs);
    }
    const loopEnd = performance.now();
    const elapsedTime = loopEnd - loopStart;
    const delayTime = Math.max(0, config.mainLoopIntervalMs - elapsedTime);
    if (delayTime > 0) await delay(delayTime);
  }
  workerState.logger('info', '[CavebotWorker] Main loop stopped.');
}

// --- Worker Lifecycle ---

async function initializeWorker() {
  workerState.logger('info', 'Cavebot worker starting up...');
  try {
    workerState.luaExecutor = new CavebotLuaExecutor({
      logger: workerState.logger,
      postStoreUpdate,
      getState: () => workerState.globalState,
      getFreshState,
      advanceToNextWaypoint: () => advanceToNextWaypoint(workerState, config),
      goToLabel: (label) => goToLabel(label, workerState.globalState),
      goToSection: (sectionName) =>
        goToSection(sectionName, workerState, config),
      goToWpt: (index) => goToWpt(index, workerState.globalState),
      sharedLuaGlobals: workerData.sharedLuaGlobals,
      postGlobalVarUpdate,
    });
    if (!(await workerState.luaExecutor.initialize()))
      throw new Error('LuaExecutor failed to initialize.');
    workerState.logger(
      'info',
      'Cavebot Lua Executor initialized successfully.',
    );
  } catch (e) {
    workerState.logger(
      'error',
      `Could not initialize Cavebot Lua Executor: ${e.message}`,
    );
    workerState.luaExecutor = null;
  }
  workerState.isInitialized = true;
  workerState.logger('info', 'Cavebot worker initialization complete.');
}

parentPort.on('message', (message) => {
  try {
    if (message.type === 'state_full_sync') {
      workerState.globalState = message.payload;
    } else if (message.type === 'state_diff') {
      if (workerState.globalState && message.payload) {
        deepMerge(workerState.globalState, message.payload);
      }
    } else if (message.type === 'shutdown') {
      workerState.isShuttingDown = true;
      if (workerState.luaExecutor) workerState.luaExecutor.destroy();
    } else if (message.type === 'lua_global_broadcast') {
      const { key, value } = message.payload;
      if (workerData.sharedLuaGlobals) {
        workerData.sharedLuaGlobals[key] = value;
        workerState.logger(
          'debug',
          `[CavebotWorker] Received lua_global_broadcast: ${key} = ${value}`,
        );
      }
    } else if (typeof message === 'object' && !message.type) {
      workerState.globalState = message;
      if (!workerState.isInitialized) {
        initializeWorker().catch((error) => {
          workerState.logger(
            'error',
            '[CavebotWorker] Failed to initialize worker:',
            error,
          );
          process.exit(1);
        });
      }
    }
  } catch (error) {
    workerState.logger(
      'error',
      '[CavebotWorker] Error handling message:',
      error,
    );
  }
});

function startWorker() {
  if (!workerData) throw new Error('[CavebotWorker] Worker data not provided');
  mainLoop().catch((error) => {
    workerState.logger(
      'error',
      '[CavebotWorker] Fatal error in main loop:',
      error,
    );
    process.exit(1);
  });
}

startWorker();
