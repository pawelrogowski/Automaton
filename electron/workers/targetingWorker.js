import { parentPort, workerData } from 'worker_threads';
import { createLogger } from '../utils/logger.js';
import { createTargetingActions } from './targeting/actions.js';
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
} from './sharedConstants.js';

const logger = createLogger({ info: true, error: true, debug: false });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Core configuration
const config = {
  mainLoopIntervalMs: 25,
  stateChangePollIntervalMs: 25,
  mainLoopErrorDelayMs: 1000,
};

// Worker state management
const workerState = {
  globalState: null,
  isInitialized: false,
  isShuttingDown: false,
  playerMinimapPosition: null,
  path: [],
  pathfindingStatus: 0,
  lastPlayerPosCounter: -1,
  lastPathDataCounter: -1,
  shouldRequestNewPath: false,
  justGainedControl: false,
  logger: logger,
};

// Targeting context (preserved from original)
const targetingContext = {
  pathfindingTarget: null,
  acquisitionUnlockTime: 0,
  lastMovementTime: 0,
  lastDispatchedVisitedTile: null,
  lastClickTime: 0,
};

// Control state tracking
let lastControlState = 'CAVEBOT';
let lastTargetingEnabled = false;
let lastCavebotEnabled = false;

// Initialize SharedArrayBuffer access
const { playerPosSAB, pathDataSAB } = workerData;
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const pathDataArray = pathDataSAB ? new Int32Array(pathDataSAB) : null;

// Initialize SAB state manager
const sabStateManager = new SABStateManager({
  playerPosSAB: workerData.playerPosSAB,
  battleListSAB: workerData.battleListSAB,
  creaturesSAB: workerData.creaturesSAB,
  lootingSAB: workerData.lootingSAB,
  targetingListSAB: workerData.targetingListSAB,
  targetSAB: workerData.targetSAB,
  pathDataSAB: workerData.pathDataSAB,
});

// Initialize targeting actions
const targetingActions = createTargetingActions({
  playerPosArray,
  pathDataArray,
  parentPort,
  sabStateManager,
});

// SAB data update function (now independent of Redux)
const updateSABData = () => {
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

    let consistentRead = false;
    let attempts = 0;
    do {
      const counterBeforeRead = Atomics.load(
        pathDataArray,
        PATH_UPDATE_COUNTER_INDEX,
      );
      if (counterBeforeRead === workerState.lastPathDataCounter) return;

      const pathLength = Atomics.load(pathDataArray, PATH_LENGTH_INDEX);
      const tempPath = [];
      const safePathLength = Math.min(pathLength, 50);

      for (let i = 0; i < safePathLength; i++) {
        const offset = PATH_WAYPOINTS_START_INDEX + i * PATH_WAYPOINT_SIZE;
        tempPath.push({
          x: Atomics.load(pathDataArray, offset + 0),
          y: Atomics.load(pathDataArray, offset + 1),
          z: Atomics.load(pathDataArray, offset + 2),
        });
      }

      const counterAfterRead = Atomics.load(
        pathDataArray,
        PATH_UPDATE_COUNTER_INDEX,
      );

      if (counterBeforeRead === counterAfterRead) {
        workerState.pathfindingStatus = Atomics.load(
          pathDataArray,
          PATHFINDING_STATUS_INDEX,
        );

        if (tempPath.length > 0) {
          const pathStart = tempPath[0];
          const pathEnd = tempPath[tempPath.length - 1];

          // Verify path starts from current player position
          if (
            !workerState.playerMinimapPosition ||
            pathStart.x !== workerState.playerMinimapPosition.x ||
            pathStart.y !== workerState.playerMinimapPosition.y ||
            pathStart.z !== workerState.playerMinimapPosition.z
          ) {
            logger(
              'debug',
              '[TargetingWorker] Path does not start from current position, discarding',
            );
            workerState.path = [];
          } else if (targetingContext.pathfindingTarget) {
            // Verify path ends at target creature position
            const targetCreature = sabStateManager
              .getCreatures()
              .find(
                (c) =>
                  c.instanceId ===
                    targetingContext.pathfindingTarget.rule?.targetInstanceId ||
                  (c.gameCoords.x ===
                    workerState.globalState?.cavebot?.dynamicTarget
                      ?.targetCreaturePos?.x &&
                    c.gameCoords.y ===
                      workerState.globalState?.cavebot?.dynamicTarget
                        ?.targetCreaturePos?.y &&
                    c.gameCoords.z ===
                      workerState.globalState?.cavebot?.dynamicTarget
                        ?.targetCreaturePos?.z),
              );

            if (targetCreature) {
              // Check if path ends near the target (within 1-2 tiles due to stance)
              const distanceToTarget = Math.max(
                Math.abs(pathEnd.x - targetCreature.gameCoords.x),
                Math.abs(pathEnd.y - targetCreature.gameCoords.y),
              );

              if (
                distanceToTarget <= 2 &&
                pathEnd.z === targetCreature.gameCoords.z
              ) {
                workerState.path = tempPath;
              } else {
                logger(
                  'debug',
                  `[TargetingWorker] Path does not end near target creature (distance: ${distanceToTarget}), discarding`,
                );
                workerState.path = [];
              }
            } else {
              // Target creature not found, use path anyway (creature might have moved/died)
              workerState.path = tempPath;
            }
          } else {
            workerState.path = tempPath;
          }
        } else {
          workerState.path = [];
        }

        workerState.lastPathDataCounter = counterBeforeRead;
        consistentRead = true;
      } else {
        attempts++;
      }
    } while (!consistentRead && attempts < 3);
  }
};

// Core targeting logic (now continuous)
async function performTargeting() {
  // Always update SAB data first
  updateSABData();

  const { globalState, isInitialized } = workerState;

  // Sync targeting list to SAB for consistent access
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

  // Always evaluate target selection
  targetingContext.pathfindingTarget =
    targetingActions.selectBestTarget(globalState);

  if (controlState === 'CAVEBOT' && cavebotIsEnabled) {
    if (targetingContext.pathfindingTarget) {
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

  if (!workerState.playerMinimapPosition) return;

  // Continuous target acquisition attempt
  if (
    targetingContext.pathfindingTarget &&
    Date.now() > targetingContext.acquisitionUnlockTime
  ) {
    await targetingActions.manageTargetAcquisition(
      targetingContext,
      globalState,
      targetingContext.pathfindingTarget,
    );
  }

  // Always update dynamic target
  targetingActions.updateDynamicTarget(globalState);

  // Continuous movement management
  await targetingActions.manageMovement(
    targetingContext,
    globalState,
    workerState.path,
    workerState.pathfindingStatus,
    workerState.playerMinimapPosition,
  );

  // Release control if no target
  if (!targetingContext.pathfindingTarget && cavebotIsEnabled) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/releaseTargetingControl',
    });
  }
}

// Main continuous loop (like cavebot)
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

// Handle control state changes
function handleControlStateChange(newControlState, oldControlState) {
  if (
    (newControlState === 'TARGETING' && oldControlState !== 'TARGETING') ||
    (newControlState === 'HANDOVER_TO_TARGETING' &&
      oldControlState !== 'HANDOVER_TO_TARGETING')
  ) {
    // Clear path when gaining control
    workerState.path = [];
    workerState.pathfindingStatus = PATH_STATUS_IDLE;
    workerState.lastPathDataCounter = -1;
    workerState.shouldRequestNewPath = true;
    workerState.justGainedControl = true;
    logger(
      'info',
      '[TargetingWorker] Gained control, cleared path and requesting new pathfinding',
    );
  }
}

// Redux state management (non-blocking)
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

        // Start the continuous loop
        mainLoop().catch((error) => {
          logger('error', '[TargetingWorker] Fatal error in main loop:', error);
          process.exit(1);
        });
      }
    }

    // Handle control state changes
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

// Initialize worker
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
