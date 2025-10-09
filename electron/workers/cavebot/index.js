// /home/feiron/Dokumenty/Automaton/electron/workers/cavebot/index.js
//start file
import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { CavebotLuaExecutor } from '../cavebotLuaExecutor.js';
import { createLogger } from '../../utils/logger.js';
import { createWorkerInterface, WORKER_IDS } from '../sabState/index.js';
import { config } from './config.js';
import { createFsm } from './fsm.js';
import { delay } from './helpers/asyncUtils.js';
import { SABStateManager } from '../sabStateManager.js';
import Pathfinder from 'pathfinder-native';
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
  playerMinimapPosition: null,
  path: [],
  pathChebyshevDistance: null,
  pathfindingStatus: 0,

  luaExecutor: null,
  lastProcessedWptId: null,
  shouldRequestNewPath: false,
  scriptErrorWaypointId: null,
  scriptErrorCount: 0,
  pathfinderInstance: null,
  lastBlockedTileCheck: 0,
  // --- NEW LOGIC START ---
  // Tracks the last tile that failed a walk attempt to require a second failure before blocking.
  lastFailedStep: null,
  // Map-click controller state
  mapClick: {
    mode: 'idle', // 'idle' | 'pending' | 'moving'
    attemptAt: 0,
    startPos: null,
    lastObservedAt: 0,
    lastObservedPos: null,
    fallbackUntil: 0,
  },
  // Movement lock to prevent double-stepping
  isWaitingForMovement: false,
  movementWaitUntil: 0,
  // --- NEW LOGIC END ---
  logger: createLogger({ info: false, error: true, debug: false }),
  parentPort: parentPort,
};

// --- Initialization ---
const fsm = createFsm(workerState, config);

// Initialize SAB state manager
workerState.sabStateManager = new SABStateManager({
  playerPosSAB: workerData.playerPosSAB,
  battleListSAB: workerData.battleListSAB,
  creaturesSAB: workerData.creaturesSAB,
  lootingSAB: workerData.lootingSAB,
  targetingListSAB: workerData.targetingListSAB,
  targetSAB: workerData.targetSAB,
  pathDataSAB: workerData.pathDataSAB,
});

// Initialize unified SAB interface
if (workerData.unifiedSAB) {
  workerState.sabInterface = createWorkerInterface(workerData.unifiedSAB, WORKER_IDS.CAVEBOT);
  workerState.logger('info', '[Cavebot] Unified SAB interface initialized');
}

// --- Main Loop & Orchestration ---

function handleControlHandover() {
  const { waypointIdAtTargetingStart, visitedTiles } =
    workerState.globalState.cavebot;
  let skippedWaypoint = false;

  // Always clear path when gaining control
  workerState.path = [];
  workerState.pathfindingStatus = 0;
  workerState.shouldRequestNewPath = true;
  
  // Clear targeting path in SAB to prevent stale path usage
  if (workerState.sabInterface) {
    try {
      workerState.sabInterface.set('targetingPathData', {
        waypoints: [],
        length: 0,
        status: 0,
        chebyshevDistance: 0,
        startX: 0,
        startY: 0,
        startZ: 0,
        targetX: 0,
        targetY: 0,
        targetZ: 0,
        blockingCreatureX: 0,
        blockingCreatureY: 0,
        blockingCreatureZ: 0,
        wptId: 0,
        instanceId: 0,
      });
      workerState.logger('debug', '[Cavebot] Cleared targeting path on control handover');
    } catch (err) {
      workerState.logger('error', `[Cavebot] Failed to clear targeting path: ${err.message}`);
    }
  }


  const currentWaypoint = findCurrentWaypoint(workerState.globalState);
  const allWaypoints = Object.values(
    workerState.globalState.cavebot.waypointSections || {},
  ).flatMap((section) => section.waypoints || []);
  const waypointIndex = allWaypoints.findIndex(
    (wpt) => wpt.id === currentWaypoint?.id,
  );
  workerState.logger(
    'debug',
    `[Cavebot] Control handover at waypoint index: ${
      waypointIndex > -1 ? waypointIndex + 1 : 'N/A'
    }`,
  );

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
}

async function performOperation() {
  const { globalState, isInitialized } = workerState;
  if (!globalState || !isInitialized || !globalState.global?.windowId) {
    return;
  }

  // Periodically check for and remove expired temporary blocks
  const now = Date.now();
  if (now - workerState.lastBlockedTileCheck > 1000) { // Check every second
    if (globalState.cavebot.temporaryBlockedTiles.length > 0) {
        postStoreUpdate('cavebot/removeExpiredBlockedTiles');
    }
    workerState.lastBlockedTileCheck = now;
  }

  if (!globalState.cavebot) {
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
      resetInternalState(workerState, fsm);
    }
    return;
  }

  if (
    !globalState.regionCoordinates ||
    !globalState.regionCoordinates.regions.gameWorld.endFound
  ) {
    workerState.logger(
      'debug',
      '[Cavebot] Game world not visible, skipping tick.',
    );
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
    waypointSections = {},
  } = globalState.cavebot;
  const waypoints = Object.values(waypointSections).flatMap(
    (section) => section.waypoints || [],
  );

  if (isPausedByScript) {
    workerState.logger('debug', '[Cavebot] Paused by script, skipping tick.');
    if (workerState.fsmState !== 'IDLE') resetInternalState(workerState, fsm);
    return;
  }

  if (workerState.sabStateManager.isLootingRequired()) {
    workerState.logger('debug', '[Cavebot] Looting required, skipping tick.');
    if (workerState.fsmState !== 'IDLE') resetInternalState(workerState, fsm);
    return;
  }

  if (!cavebotIsEnabled) {
    if (workerState.fsmState !== 'IDLE') resetInternalState(workerState, fsm);
    return;
  }

  if (controlState !== 'CAVEBOT') {
    if (workerState.lastControlState === 'CAVEBOT') {
      workerState.logger(
        'debug',
        `[Cavebot] Control lost. Current state: ${controlState}. Resetting FSM.`,
      );
      resetInternalState(workerState, fsm);
    }
    workerState.lastControlState = controlState;
    return;
  }

  if (workerState.lastControlState !== 'CAVEBOT') {
    workerState.logger(
      'debug',
      '[Cavebot] Control gained. Handling handover.',
    );
    handleControlHandover();
    
    // Force fresh player position read after control handover
    // The position might be stale from targeting movement
    const positionBeforeHandover = workerState.playerMinimapPosition 
      ? { ...workerState.playerMinimapPosition } 
      : null;
    
    // Wait for position to update (or timeout after 100ms)
    const maxWait = 100;
    const startWait = Date.now();
    let positionUpdated = false;
    
    while (Date.now() - startWait < maxWait && !positionUpdated) {
      await delay(10); // Check every 10ms
      updateSABData(workerState, config);
      
      const currentPos = workerState.playerMinimapPosition;
      if (currentPos && positionBeforeHandover) {
        // Check if position changed (indicating fresh data)
        const moved = currentPos.x !== positionBeforeHandover.x ||
                      currentPos.y !== positionBeforeHandover.y ||
                      currentPos.z !== positionBeforeHandover.z;
        if (moved) {
          workerState.logger('debug', `[Cavebot] Fresh position detected after ${Date.now() - startWait}ms`);
          positionUpdated = true;
        }
      } else if (currentPos && !positionBeforeHandover) {
        // We had no position before but now we do - accept it
        positionUpdated = true;
      }
    }
    
    if (!positionUpdated && positionBeforeHandover) {
      workerState.logger('debug', '[Cavebot] Position unchanged after handover, using existing position');
    }
  }

  updateSABData(workerState, config);


  let targetWaypoint = findCurrentWaypoint(globalState);
  if (!targetWaypoint) {
    const fallback = findFirstValidWaypoint(globalState);
    if (fallback) {
      const waypointIndex = waypoints.findIndex(
        (wpt) => wpt.id === fallback.waypoint.id,
      );
      workerState.logger(
        'warn',
        `Current waypoint not found, resetting to first valid waypoint at index ${
          waypointIndex + 1
        }.`,
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
    const fromIndex = waypoints.findIndex(
      (wpt) => wpt.id === workerState.lastProcessedWptId,
    );
    const toIndex = waypoints.findIndex((wpt) => wpt.id === targetWaypoint.id);
    workerState.logger(
      'info',
      `[Cavebot] Waypoint changed from index ${fromIndex + 1} to ${
        toIndex + 1
      }. Resetting FSM.`,
    );
    resetInternalState(workerState, fsm);
  }
  workerState.lastProcessedWptId = targetWaypoint.id;

  // Don't execute FSM if we don't have valid player position yet
  if (!workerState.playerMinimapPosition) {
    if (workerState.fsmState !== 'IDLE') resetInternalState(workerState, fsm);
    return;
  }

  // Don't execute FSM if we're waiting for movement confirmation
  if (workerState.isWaitingForMovement) {
    const remainingWait = workerState.movementWaitUntil - now;
    if (now < workerState.movementWaitUntil) {
      // Still waiting - skip FSM execution
      return;
    } else {
      // Timeout expired
      workerState.logger('warn', `[Cavebot] Movement timeout expired after ${-remainingWait}ms`);
      workerState.isWaitingForMovement = false;
    }
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
      const waypointIndex = waypoints.findIndex(
        (wpt) => wpt.id === targetWaypoint.id,
      );
      workerState.logger(
        'debug',
        `[FSM] State transition: ${workerState.fsmState} -> ${nextState} for waypoint index ${waypointIndex + 1}`,
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

async function initializePathfinder() {
  workerState.logger('info', 'Initializing Pathfinder instance...');
  try {
    workerState.pathfinderInstance = new Pathfinder.Pathfinder();
    const fs = await import('fs/promises');
    const path = await import('path');
    const mapDataForAddon = {};
    const baseDir = workerData.paths.minimapResources;

    if (!baseDir) {
      throw new Error('minimapResources path not provided');
    }

    const zLevelDirs = (await fs.readdir(baseDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && d.name.startsWith('z'))
      .map((d) => d.name);

    for (const zDir of zLevelDirs) {
      const zLevel = parseInt(zDir.substring(1), 10);
      const zLevelPath = path.join(baseDir, zDir);
      try {
        const metadata = JSON.parse(
          await fs.readFile(path.join(zLevelPath, 'walkable.json'), 'utf8'),
        );
        const grid = await fs.readFile(path.join(zLevelPath, 'walkable.bin'));
        mapDataForAddon[zLevel] = { ...metadata, grid };
      } catch (e) {
        if (e.code !== 'ENOENT')
          workerState.logger(
            'error',
            `Could not load path data for Z=${zLevel}: ${e.message}`,
          );
      }
    }

    workerState.pathfinderInstance.loadMapData(mapDataForAddon);
    if (workerState.pathfinderInstance.isLoaded) {
      workerState.logger(
        'info',
        'Pathfinder instance loaded map data successfully.',
      );
    } else {
      throw new Error('Pathfinder failed to load map data.');
    }
  } catch (err) {
    workerState.logger(
      'error',
      'Could not initialize Pathfinder instance:',
      err,
    );
    workerState.pathfinderInstance = null;
  }
}

async function initializeWorker() {
  workerState.logger('info', 'Cavebot worker starting up...');

  await initializePathfinder();

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
      pathfinderInstance: workerState.pathfinderInstance,
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

//endFile