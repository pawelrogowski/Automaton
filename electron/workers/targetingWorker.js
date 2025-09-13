import { parentPort, workerData } from 'worker_threads';
import { createLogger } from '../utils/logger.js';
import { createTargetingActions } from './targeting/actions.js';
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

let isInitialized = false;
let globalState = null;
let isShuttingDown = false;
let isProcessing = false;
let playerMinimapPosition = null;
let path = [];
let pathfindingStatus = 0;
let lastPlayerPosCounter = -1;
let lastPathDataCounter = -1;
let shouldRequestNewPath = false;
let justGainedControl = false;

const targetingContext = {
  pathfindingTarget: null,
  acquisitionUnlockTime: 0,
  lastMovementTime: 0,
  lastDispatchedVisitedTile: null,
  lastClickTime: 0,
};

let lastBattleListHash = null;
let lastCreaturesHash = null;
let lastTargetInstanceId = null;
let lastTargetingListHash = null;
let lastPlayerPosKey = null;
let lastControlState = 'CAVEBOT';
let lastTargetingEnabled = false;
let lastCavebotEnabled = false;
let lastIsLootingRequired = false; // New: To track the previous state of isLootingRequired

const { playerPosSAB, pathDataSAB, battleListSAB, creaturesSAB, lootingSAB } =
  workerData;
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const pathDataArray = pathDataSAB ? new Int32Array(pathDataSAB) : null;
const battleListArray = battleListSAB ? new Int32Array(battleListSAB) : null;
const creaturesArray = creaturesSAB ? new Int32Array(creaturesSAB) : null;
const lootingArray = lootingSAB ? new Int32Array(lootingSAB) : null;

const targetingActions = createTargetingActions({
  playerPosArray,
  pathDataArray,
  parentPort,
  battleListArray,
  creaturesArray,
  lootingArray,
});

const updateSABData = () => {
  if (playerPosArray) {
    const newPlayerPosCounter = Atomics.load(
      playerPosArray,
      PLAYER_POS_UPDATE_COUNTER_INDEX,
    );
    if (newPlayerPosCounter > lastPlayerPosCounter) {
      playerMinimapPosition = {
        x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
        y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
        z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
      };
      lastPlayerPosCounter = newPlayerPosCounter;
    }
  }

  if (pathDataArray) {
    if (shouldRequestNewPath) {
      path = [];
      pathfindingStatus = PATH_STATUS_IDLE;
      lastPathDataCounter = -1;
      shouldRequestNewPath = false;
      return;
    }

    let consistentRead = false;
    let attempts = 0;
    do {
      const counterBeforeRead = Atomics.load(
        pathDataArray,
        PATH_UPDATE_COUNTER_INDEX,
      );
      if (counterBeforeRead === lastPathDataCounter) return;

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

      if (counterAfterRead === counterBeforeRead) {
        pathfindingStatus = Atomics.load(
          pathDataArray,
          PATHFINDING_STATUS_INDEX,
        );

        // =================================================================================
        // --- NEW, RELAXED PATH VALIDATION LOGIC ---
        // =================================================================================
        if (tempPath.length > 0) {
          const pathStart = tempPath[0];

          // We ONLY check if the path starts at the player's current position.
          // We no longer care if the end position matches the target, as the target
          // may have moved. This allows for smoother pursuit.
          if (
            !playerMinimapPosition ||
            pathStart.x !== playerMinimapPosition.x ||
            pathStart.y !== playerMinimapPosition.y ||
            pathStart.z !== playerMinimapPosition.z
          ) {
            path = []; // Invalidate: Path is for a previous player position.
          } else {
            path = tempPath; // The path is valid enough to continue walking.
          }
        } else {
          // An empty path is always a valid state.
          path = [];
        }
        // =================================================================================
        // --- END OF VALIDATION LOGIC ---
        // =================================================================================

        lastPathDataCounter = counterBeforeRead;
        consistentRead = true;
      } else {
        attempts++;
      }
    } while (!consistentRead && attempts < 3);
  }
};

async function performTargeting() {
  if (
    isShuttingDown ||
    !isInitialized ||
    !globalState?.global?.display ||
    !globalState.regionCoordinates?.regions?.gameWorld
  )
    return;
  if (globalState.targeting?.isPausedByScript) return;
  if (justGainedControl) justGainedControl = false;

  // Check SAB looting state first for immediate response
  const sabLootingRequired = lootingArray
    ? Atomics.load(lootingArray, 0) === 1
    : false;
  const reduxLootingRequired = globalState.cavebot?.isLootingRequired;

  if (sabLootingRequired || reduxLootingRequired) {
    return; // Pause all targeting actions until looting is complete
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

  updateSABData();
  if (!playerMinimapPosition) return;

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

  targetingActions.updateDynamicTarget(globalState);

  await targetingActions.manageMovement(
    targetingContext,
    globalState,
    path,
    pathfindingStatus,
    playerMinimapPosition,
  );

  if (!targetingContext.pathfindingTarget && cavebotIsEnabled) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/releaseTargetingControl',
    });
  }
}

parentPort.on('message', (message) => {
  if (isShuttingDown) return;
  try {
    if (message.type === 'shutdown') {
      isShuttingDown = true;
      return;
    } else if (message.type === 'state_diff') {
      if (!globalState) globalState = {};
      Object.assign(globalState, message.payload);
    } else if (typeof message === 'object' && !message.type) {
      globalState = message;
      if (!isInitialized) {
        isInitialized = true;
        logger('info', '[TargetingWorker] Initial state received.');
      }
    }
    if (!globalState) return;

    // Prevent concurrent processing
    if (isProcessing) {
      return;
    }

    const newBattleListHash = JSON.stringify(globalState.battleList?.entries);
    const newCreaturesHash = JSON.stringify(globalState.targeting?.creatures);
    const newTargetInstanceId = globalState.targeting?.target?.instanceId;
    const newTargetingListHash = JSON.stringify(
      globalState.targeting?.targetingList,
    );
    const newPlayerPosKey = playerMinimapPosition
      ? `${playerMinimapPosition.x},${playerMinimapPosition.y},${playerMinimapPosition.z}`
      : null;
    const newControlState = globalState.cavebot?.controlState;
    const newTargetingEnabled = globalState.targeting?.enabled;
    const newCavebotEnabled = globalState.cavebot?.enabled;
    const newIsLootingRequired =
      globalState.cavebot?.isLootingRequired || false; // Read current looting state

    const shouldProcess =
      newBattleListHash !== lastBattleListHash ||
      newCreaturesHash !== lastCreaturesHash ||
      newTargetInstanceId !== lastTargetInstanceId ||
      newTargetingListHash !== lastTargetingListHash ||
      newPlayerPosKey !== lastPlayerPosKey ||
      newControlState !== lastControlState ||
      newTargetingEnabled !== lastTargetingEnabled ||
      newCavebotEnabled !== lastCavebotEnabled ||
      newIsLootingRequired !== lastIsLootingRequired; // Trigger if looting state changes

    if (shouldProcess) {
      isProcessing = true; // Set processing flag
      if (
        (newControlState === 'TARGETING' && lastControlState !== 'TARGETING') ||
        (newControlState === 'HANDOVER_TO_TARGETING' &&
          lastControlState !== 'HANDOVER_TO_TARGETING')
      ) {
        shouldRequestNewPath = true;
        justGainedControl = true;
      }
      lastBattleListHash = newBattleListHash;
      lastCreaturesHash = newCreaturesHash;
      lastTargetInstanceId = newTargetInstanceId;
      lastTargetingListHash = newTargetingListHash;
      lastPlayerPosKey = newPlayerPosKey;
      lastControlState = newControlState;
      lastTargetingEnabled = newTargetingEnabled;
      lastCavebotEnabled = newCavebotEnabled;
      lastIsLootingRequired = newIsLootingRequired; // Update last known looting state

      performTargeting()
        .catch((err) =>
          logger('error', '[TargetingWorker] Unhandled error:', err),
        )
        .finally(() => {
          isProcessing = false; // Reset processing flag
        });
    }
  } catch (error) {
    logger('error', '[TargetingWorker] Error handling message:', error);
    isProcessing = false; // Ensure isProcessing is reset even if an error occurs outside performTargeting
  }
});
