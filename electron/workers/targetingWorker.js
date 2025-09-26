import { parentPort, workerData } from 'worker_threads';
import { createLogger } from '../utils/logger.js';
import { createTargetingActions,createAmbiguousAcquirer } from './targeting/actions.js';
import { SABStateManager } from './sabStateManager.js';
import { performance } from 'perf_hooks';
import {
  PLAYER_POS_UPDATE_COUNTER_INDEX,
  PATH_UPDATE_COUNTER_INDEX,
  PATH_WAYPOINTS_START_INDEX,
  PATH_WAYPOINT_SIZE,
  PATH_LENGTH_INDEX,
  PATHFINDING_STATUS_INDEX,
  PLAYER_X_INDEX,
  PLAYER_Y_INDEX,
  PLAYER_Z_INDEX,
  PATH_STATUS_IDLE,
  WORLD_STATE_UPDATE_COUNTER_INDEX,
} from './sharedConstants.js';


const logger = createLogger({ info: true, error: true, debug: true });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chebyshevDistance = (p1, p2) => {
  if (!p1 || !p2) return Infinity;
  return Math.max(
    Math.abs(p1.x - p2.x),
    Math.abs(p1.y - p2.y),
    Math.abs(p1.z - p2.z),
  );
};


const config = {
  mainLoopIntervalMs: 100,
  stateChangePollIntervalMs: 25,
  mainLoopErrorDelayMs: 1000,
};


const workerState = {
  globalState: null,
  isInitialized: false,
  isShuttingDown: false,
  playerMinimapPosition: null,
  path: [],
  pathfindingStatus: 0,
  cachedPath: [],
  cachedPathStart: null,
  cachedPathStatus: 0,
  lastPlayerPosCounter: -1,
  lastPathDataCounter: -1,
  lastWorldStateCounter: -1, 
  shouldRequestNewPath: false,
  justGainedControl: false,
  logger: logger,
};


const targetingContext = {
  pathfindingTarget: null,
  acquisitionUnlockTime: 0,
  lastMovementTime: 0,
  lastDispatchedVisitedTile: null,
  lastClickTime: 0,
  currentTargetInstanceId: null,
  ambiguousTargetCycle: new Map(), 
  previousTargetName: null,
  _ambiguousMeta: new Map(),
  _ambigAdaptive: { latencies: [] },
};


let lastControlState = 'CAVEBOT';
let lastTargetingEnabled = false;
let lastCavebotEnabled = false;


const { playerPosSAB, pathDataSAB, creaturesSAB } = workerData;
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const pathDataArray = pathDataSAB ? new Int32Array(pathDataSAB) : null;
const creaturesArray = creaturesSAB ? new Int32Array(creaturesSAB) : null;


const sabStateManager = new SABStateManager({
  playerPosSAB: workerData.playerPosSAB,
  battleListSAB: workerData.battleListSAB,
  creaturesSAB: workerData.creaturesSAB,
  lootingSAB: workerData.lootingSAB,
  targetingListSAB: workerData.targetingListSAB,
  targetSAB: workerData.targetSAB,
  pathDataSAB: workerData.pathDataSAB,
});


const targetingActions = createTargetingActions({
  playerPosArray,
  pathDataArray,
  parentPort,
  sabStateManager,
});


const ambiguousAcquirer = createAmbiguousAcquirer({
  sabStateManager,
  parentPort,
  targetingContext,
  logger,
});


const updateSABData = () => {
  if (creaturesArray) {
    const newWorldStateCounter = Atomics.load(
      creaturesArray,
      WORLD_STATE_UPDATE_COUNTER_INDEX,
    );
    if (newWorldStateCounter > workerState.lastWorldStateCounter) {
      workerState.lastWorldStateCounter = newWorldStateCounter;
    }
  }

  if (playerPosArray) {
    const newPlayerPosCounter = Atomics.load(
      playerPosArray,
      PLAYER_POS_UPDATE_COUNTER_INDEX,
    );
    if (newPlayerPosCounter > workerState.lastPlayerPosCounter) {
      workerState.playerMinimapPosition = {
        x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
        y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
        z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
      };
      workerState.lastPlayerPosCounter = newPlayerPosCounter;
    }
  }

  if (pathDataArray) {
    if (workerState.shouldRequestNewPath) {
      workerState.path = [];
      workerState.pathfindingStatus = PATH_STATUS_IDLE;
      workerState.lastPathDataCounter = -1;
      workerState.shouldRequestNewPath = false;
      return;
    }

    const counterBeforeRead = Atomics.load(
      pathDataArray,
      PATH_UPDATE_COUNTER_INDEX,
    );

    if (counterBeforeRead !== workerState.lastPathDataCounter) {
      const {
        path: tempPath,
        status,
        pathStart,
      } = sabStateManager.getPath();
      const counterAfterRead = Atomics.load(
        pathDataArray,
        PATH_UPDATE_COUNTER_INDEX,
      );

      if (counterBeforeRead === counterAfterRead) {
        workerState.cachedPath = tempPath;
        workerState.cachedPathStart = pathStart;
        workerState.cachedPathStatus = status;
        workerState.lastPathDataCounter = counterBeforeRead;
      }
    }

    if (workerState.cachedPathStart) {
      if (
        !workerState.playerMinimapPosition ||
        workerState.cachedPathStart.x !== workerState.playerMinimapPosition.x ||
        workerState.cachedPathStart.y !== workerState.playerMinimapPosition.y ||
        workerState.cachedPathStart.z !== workerState.playerMinimapPosition.z
      ) {
        workerState.path = [];
        workerState.pathfindingStatus = PATH_STATUS_IDLE;
      } else {
        workerState.path = workerState.cachedPath;
        workerState.pathfindingStatus = workerState.cachedPathStatus;
      }
    }
  }
};


async function performTargeting() {
  updateSABData();

  const { globalState, isInitialized } = workerState;

  if (globalState?.targeting?.targetingList) {
    try {
      sabStateManager.writeTargetingList(globalState.targeting.targetingList);
    } catch (error) {
      logger(
        'debug',
        '[TargetingWorker] Failed to sync targeting list to SAB:',
        error,
      );
    }
  }

  if (
    !globalState ||
    !isInitialized ||
    !globalState?.global?.display ||
    !globalState.regionCoordinates?.regions?.gameWorld
  ) {
    return;
  }

  if (globalState.targeting?.isPausedByScript) return;

  
  if (!workerState.playerMinimapPosition && playerPosArray) {
    try {
      const fallbackCounter = Atomics.load(playerPosArray, PLAYER_POS_UPDATE_COUNTER_INDEX);
      if (fallbackCounter >= 0) {
        workerState.playerMinimapPosition = {
          x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
          y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
          z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
        };
        workerState.lastPlayerPosCounter = fallbackCounter;
        logger('debug', '[TargetingWorker] Fallback player position read performed.');
      }
    } catch (err) {
      
    }
  }

  if (workerState.justGainedControl) {
    workerState.justGainedControl = false;
  }

  if (sabStateManager.isLootingRequired()) {
    return;
  }

  if (!globalState.targeting?.enabled) {
    if (globalState.cavebot?.controlState === 'TARGETING') {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/releaseTargetingControl',
      });
    }
    return;
  }

  const { controlState, enabled: cavebotIsEnabled } = globalState.cavebot;

  if (!cavebotIsEnabled && controlState !== 'TARGETING') {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/confirmTargetingControl',
    });
    return;
  }

  
  const currentTarget = sabStateManager.getCurrentTarget();
  if (
    targetingContext.pathfindingTarget &&
    (!currentTarget ||
      currentTarget.instanceId !== targetingContext.pathfindingTarget.instanceId)
  ) {
    logger(
      'info',
      '[TargetingWorker] Desync detected. Resetting pathfinding target.',
    );
    targetingContext.pathfindingTarget = null; 
  }

  
  const previousTargetId = targetingContext.pathfindingTarget?.instanceId;
  const { creature, rule } =
    targetingActions.selectBestTarget(
      globalState,
      targetingContext.pathfindingTarget,
    ) || {};
  targetingContext.pathfindingTarget = creature;

  if (!creature) {
    logger('debug', '[TargetingWorker] selectBestTarget returned NO creature candidate.');
  }

  
  const previousTargetName = targetingContext.previousTargetName;
  if (creature?.name !== previousTargetName) {
    if (previousTargetName) {
      targetingContext.ambiguousTargetCycle.delete(previousTargetName);
    }
    if (creature) {
      targetingContext.previousTargetName = creature.name;
      if (!targetingContext.ambiguousTargetCycle.get(creature.name)) {
        targetingContext.ambiguousTargetCycle.set(creature.name, new Set());
      }
    } else {
      targetingContext.previousTargetName = null;
    }
  }

  if (creature?.instanceId !== previousTargetId) {
    workerState.path = [];
    workerState.lastPathDataCounter = -1;
  }

  
  targetingActions.updateDynamicTarget(creature, rule);

  if (controlState === 'CAVEBOT' && cavebotIsEnabled) {
    if (targetingContext.pathfindingTarget) {
      if (rule.onlyIfTrapped && !creature.isBlockingPath) {
        return;
      }
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/requestTargetingControl',
      });
    }
    return;
  }

  if (controlState === 'HANDOVER_TO_TARGETING') {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/confirmTargetingControl',
    });
    return;
  }

  if (controlState !== 'TARGETING') return;

  if (!workerState.playerMinimapPosition) {
    logger('debug', '[TargetingWorker] Missing playerMinimapPosition — skipping this tick.');
    return;
  }

  
  parentPort.postMessage({
    storeUpdate: true,
    type: 'cavebot/addVisitedTile',
    payload: workerState.playerMinimapPosition,
  });

  
  await targetingActions.manageTargetAcquisition(
    targetingContext,
    targetingContext.pathfindingTarget,
    globalState,
  );

  
  const nowCurrent = sabStateManager.getCurrentTarget();
  if (targetingContext.pathfindingTarget) {
    const pfTarget = targetingContext.pathfindingTarget;
    const needVerify = !nowCurrent || nowCurrent.instanceId !== pfTarget.instanceId;
    if (needVerify) {
      
      const battleList = sabStateManager.getBattleList() || [];
      const matchingCount = battleList.filter((e) => e && e.name === pfTarget.name).length;
      if (matchingCount > 1) {
        logger('debug', `[TargetingWorker] attempting low-latency ambiguous acquire for ${pfTarget.name}`);
        try {
          const res = await ambiguousAcquirer.attemptAcquireAmbiguousLowLatency(pfTarget.name, {
            strictMatch: false,
            desiredInstanceId: pfTarget.instanceId,
          });
          if (res.success) {
            logger('debug', `[TargetingWorker] ambiguous acquire SUCCESS for ${pfTarget.name}: ${res.reason}`);
          } else {
            logger('debug', `[TargetingWorker] ambiguous acquire result for ${pfTarget.name}: ${res.reason}`);
          }
        } catch (err) {
          logger('error', '[TargetingWorker] Error in ambiguous acquire helper:', err);
        }
      }
    }
  }

  
  const battleList = sabStateManager.getBattleList();
  const cycleState = targetingContext.ambiguousTargetCycle.get(
    targetingContext.pathfindingTarget?.name,
  );

  if (
    targetingContext.pathfindingTarget &&
    !sabStateManager.getCurrentTarget() &&
    cycleState
  ) {
    const potentialEntriesCount = battleList.filter(
      (entry) => entry.name === targetingContext.pathfindingTarget.name,
    ).length;
    if (cycleState.size >= potentialEntriesCount && potentialEntriesCount > 0) {
      logger(
        'info',
        `[TargetingWorker] Exhausted all ${potentialEntriesCount} entries for ${targetingContext.pathfindingTarget.name}. Restarting cycle.`,
      );
      cycleState.clear();
    }
  }

  
  await targetingActions.manageMovement(
    targetingContext,
    workerState.path,
    workerState.pathfindingStatus,
    workerState.playerMinimapPosition,
    targetingContext.pathfindingTarget,
    rule,
  );

  
  if (!targetingContext.pathfindingTarget && cavebotIsEnabled) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/releaseTargetingControl',
    });
  }
}


async function mainLoop() {
  logger('info', '[TargetingWorker] Starting continuous main loop...');

  while (!workerState.isShuttingDown) {
    const loopStart = performance.now();

    try {
      await performTargeting();
    } catch (error) {
      logger('error', '[TargetingWorker] Unhandled error in main loop:', error);
      await delay(config.mainLoopErrorDelayMs);
    }

    const loopEnd = performance.now();
    const elapsedTime = loopEnd - loopStart;
    const delayTime = Math.max(0, config.mainLoopIntervalMs - elapsedTime);

    if (delayTime > 0) {
      await delay(delayTime);
    }
  }

  logger('info', '[TargetingWorker] Main loop stopped.');
}


function handleControlStateChange(newControlState, oldControlState) {
  if (
    (newControlState === 'TARGETING' && oldControlState !== 'TARGETING') ||
    (newControlState === 'HANDOVER_TO_TARGETING' &&
      oldControlState !== 'HANDOVER_TO_TARGETING')
  ) {
    
    workerState.path = [];
    workerState.pathfindingStatus = PATH_STATUS_IDLE;
    workerState.lastPathDataCounter = -1;
    workerState.shouldRequestNewPath = true;
    workerState.justGainedControl = true;
    logger(
      'info',
      '[TargetingWorker] Gained control, cleared path and requesting new pathfinding',
    );
  } else if (
    (oldControlState === 'TARGETING' ||
      oldControlState === 'HANDOVER_TO_TARGETING') &&
    newControlState === 'CAVEBOT'
  ) {
    const { cavebot: cavebotState } = workerState.globalState || {};
    if (cavebotState?.visitedTiles?.length > 0) {
      const { waypoints, currentWaypointIndex } = cavebotState;
      if (waypoints && typeof currentWaypointIndex === 'number') {
        const currentWaypoint = waypoints[currentWaypointIndex];
        if (currentWaypoint && currentWaypoint.type === 'node') {
          const nodeCoord = {
            x: currentWaypoint.x,
            y: currentWaypoint.y,
            z: currentWaypoint.z,
          };
          const isClose = cavebotState.visitedTiles.some(
            (visitedTile) => chebyshevDistance(visitedTile, nodeCoord) <= 4,
          );

          if (isClose) {
            logger(
              'info',
              '[TargetingWorker] Visited area near node waypoint, skipping.',
            );
            parentPort.postMessage({
              storeUpdate: true,
              type: 'cavebot/goToNextWaypoint',
            });
          }
        }
      }
    }
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/clearVisitedTiles',
    });
  }
}


parentPort.on('message', (message) => {
  if (workerState.isShuttingDown) return;

  try {
    if (message.type === 'shutdown') {
      workerState.isShuttingDown = true;
      return;
    } else if (message.type === 'state_diff') {
      if (!workerState.globalState) workerState.globalState = {};
      Object.assign(workerState.globalState, message.payload);
    } else if (typeof message === 'object' && !message.type) {
      workerState.globalState = message;
      if (!workerState.isInitialized) {
        workerState.isInitialized = true;
        logger(
          'info',
          '[TargetingWorker] Initial state received, starting main loop.',
        );

        
        mainLoop().catch((error) => {
          logger('error', '[TargetingWorker] Fatal error in main loop:', error);
          process.exit(1);
        });
      }
    }

    
    if (workerState.globalState) {
      const newControlState = workerState.globalState.cavebot?.controlState;
      const newTargetingEnabled = workerState.globalState.targeting?.enabled;
      const newCavebotEnabled = workerState.globalState.cavebot?.enabled;

      if (newControlState !== lastControlState) {
        handleControlStateChange(newControlState, lastControlState);
        lastControlState = newControlState;
      }

      lastTargetingEnabled = newTargetingEnabled;
      lastCavebotEnabled = newCavebotEnabled;
    }
  } catch (error) {
    logger('error', '[TargetingWorker] Error handling message:', error);
  }
});


function startWorker() {
  if (!workerData) {
    throw new Error('[TargetingWorker] Worker data not provided');
  }

  logger(
    'info',
    '[TargetingWorker] Worker initialized, waiting for initial state...',
  );
}

startWorker();
