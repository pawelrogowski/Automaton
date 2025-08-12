import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import keypress from 'keypress-native';
import mouseController from 'mouse-controller';
import { getAbsoluteClickCoordinates } from '../utils/minimapClickTranslator.js';
import { getAbsoluteGameWorldClickCoordinates } from '../utils/gameWorldClickTranslator.js';
import { createLogger } from '../utils/logger.js';
import { CavebotLuaExecutor } from './cavebotLuaExecutor.js';
import {
  PLAYER_X_INDEX,
  PLAYER_Y_INDEX,
  PLAYER_Z_INDEX,
  PLAYER_POS_UPDATE_COUNTER_INDEX,
  PATH_LENGTH_INDEX,
  PATH_UPDATE_COUNTER_INDEX,
  PATH_WAYPOINTS_START_INDEX,
  PATH_WAYPOINT_SIZE,
  PATH_START_X_INDEX,
  PATH_START_Y_INDEX,
  PATH_START_Z_INDEX,
  PATH_CHEBYSHEV_DISTANCE_INDEX,
  PATHFINDING_STATUS_INDEX,
  PATH_STATUS_IDLE,
  PATH_STATUS_PATH_FOUND,
  PATH_STATUS_WAYPOINT_REACHED,
  PATH_STATUS_NO_PATH_FOUND,
  PATH_STATUS_DIFFERENT_FLOOR,
  PATH_STATUS_ERROR,
  PATH_STATUS_NO_VALID_START_OR_END,
  MAX_PATH_WAYPOINTS,
} from './sharedConstants.js';

// --- Worker Configuration ---
const MAIN_LOOP_INTERVAL = 25;
const STATE_CHANGE_POLL_INTERVAL = 5;
const PERFORMANCE_LOG_INTERVAL = 10000;

// --- Configuration ---
const config = {
  actionStateChangeTimeoutMs: 200,
  preClickDelayMs: 250,
  toolHotkeyWaitMs: 150,
  teleportDistanceThreshold: 5,
  postTeleportGraceMs: 1250,
  moveConfirmTimeoutMs: 400,
};

// --- Worker State ---
let globalState = null;
let isShuttingDown = false;
let isInitialized = false;
let fsmState = 'IDLE';
let lastFsmState = null;

// --- SAB State ---
let lastPlayerPosCounter = -1;
let lastPathDataCounter = -1;
let playerMinimapPosition = null;
let path = [];
let pathChebyshevDistance = null;
let pathfindingStatus = PATH_STATUS_IDLE;

// --- Shared Buffer Setup ---
const { playerPosSAB, pathDataSAB } = workerData;
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const pathDataArray = pathDataSAB ? new Int32Array(pathDataSAB) : null;

// --- Performance Tracking ---
let operationCount = 0;
let totalOperationTime = 0;
let lastPerfReport = Date.now();

// --- Cavebot Specific State ---
let luaExecutor = null;
let stuckDetectionGraceUntil = 0;
let floorChangeGraceUntil = 0;
let recentKeyboardFailures = [];
let lastProcessedWptId = null;

// --- Utility Functions & Logging ---
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getDistance = (p1, p2) =>
  Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
const getDirectionKey = (current, target) => {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  if (dy < 0) {
    if (dx < 0) return 'q';
    if (dx === 0) return 'w';
    if (dx > 0) return 'e';
  } else if (dy === 0) {
    if (dx < 0) return 'a';
    if (dx > 0) return 'd';
  } else if (dy > 0) {
    if (dx < 0) return 'z';
    if (dx === 0) return 's';
    if (dx > 0) return 'c';
  }
  return null;
};
const logger = createLogger({ info: false, error: true, debug: false });
const pathingLogger = createLogger({
  info: true,
  error: true,
  debug: false,
  prefix: '[CavebotPathing]',
});

function logPerformanceStats() {
  const now = Date.now();
  if (now - lastPerfReport >= PERFORMANCE_LOG_INTERVAL) {
    const avgOpTime =
      operationCount > 0 ? (totalOperationTime / operationCount).toFixed(2) : 0;
    const opsPerSecond = (
      (operationCount / (now - lastPerfReport)) *
      1000
    ).toFixed(1);
    logger(
      'info',
      `[CavebotWorker] Performance: ${opsPerSecond} ops/sec, avg: ${avgOpTime}ms`,
    );
    operationCount = 0;
    totalOperationTime = 0;
    lastPerfReport = now;
  }
}

// --- Store & State Management ---
const postStoreUpdate = (type, payload) =>
  parentPort.postMessage({ storeUpdate: true, type, payload });

const awaitStateChange = (condition, timeoutMs) => {
  return new Promise((resolve) => {
    let intervalId = null;
    const timeoutId = setTimeout(() => {
      if (intervalId) clearInterval(intervalId);
      resolve(false);
    }, timeoutMs);
    intervalId = setInterval(() => {
      if (globalState && condition(globalState)) {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        resolve(true);
      }
    }, STATE_CHANGE_POLL_INTERVAL);
  });
};

const awaitZLevelChange = (initialZ, timeoutMs) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const intervalId = setInterval(() => {
      const currentZ = Atomics.load(playerPosArray, PLAYER_Z_INDEX);

      // If Z-level has changed, the action was a success.
      if (currentZ !== initialZ) {
        clearInterval(intervalId);
        resolve(true);
      }

      // If the timeout is reached without a Z-level change, it failed.
      if (Date.now() - startTime > timeoutMs) {
        clearInterval(intervalId);
        resolve(false);
      }
    }, STATE_CHANGE_POLL_INTERVAL);
  });
};

// --- Navigation Functions ---
const advanceToNextWaypoint = async () => {
  if (!globalState?.cavebot) return false;
  const {
    waypointSections,
    currentSection,
    wptId: oldWptId,
  } = globalState.cavebot;
  const waypoints = waypointSections[currentSection]?.waypoints || [];
  if (waypoints.length === 0) return false;
  const currentIndex = waypoints.findIndex((wp) => wp.id === oldWptId);
  if (currentIndex === -1) return false;
  const nextIndex = (currentIndex + 1) % waypoints.length;
  const nextWpt = waypoints[nextIndex];
  if (nextWpt) {
    postStoreUpdate('cavebot/setwptId', nextWpt.id);
    const success = await awaitStateChange(
      (state) => state.cavebot.wptId === nextWpt.id,
      500,
    );
    if (success) {
      lastProcessedWptId = nextWpt.id;
    } else {
      pathingLogger(
        'error',
        `Failed to confirm waypoint advance from ${oldWptId} to ${nextWpt.id} within timeout!`,
      );
    }
    return success;
  }
  return false;
};

const goToLabel = async (label) => {
  const { waypointSections, currentSection } = globalState.cavebot;
  const targetWpt = waypointSections[currentSection].waypoints.find(
    (wpt) => wpt.label === label,
  );
  if (targetWpt) {
    postStoreUpdate('cavebot/setwptId', targetWpt.id);
  } else {
    await advanceToNextWaypoint();
  }
};

const goToSection = async (sectionName) => {
  const { waypointSections } = globalState.cavebot;
  const foundEntry = Object.entries(waypointSections).find(
    ([, section]) => section.name === sectionName,
  );
  if (foundEntry) {
    const [targetSectionId, targetSection] = foundEntry;
    if (targetSection.waypoints?.length > 0) {
      const firstWpt = targetSection.waypoints[0];
      postStoreUpdate('cavebot/setCurrentWaypointSection', targetSectionId);
      postStoreUpdate('cavebot/setwptId', firstWpt.id);
    } else {
      await advanceToNextWaypoint();
    }
  } else {
    await advanceToNextWaypoint();
  }
};

const goToWpt = async (index) => {
  const userIndex = parseInt(index, 10);
  if (isNaN(userIndex) || userIndex < 1) return;
  const arrayIndex = userIndex - 1;
  const { waypointSections, currentSection } = globalState.cavebot;
  const waypoints = waypointSections[currentSection]?.waypoints || [];
  if (arrayIndex < waypoints.length) {
    postStoreUpdate('cavebot/setwptId', waypoints[arrayIndex].id);
  }
};

// --- Action Handlers ---
const handleWalkAction = async () => {
  const nextStep = path[0];
  const posCounterBeforeMove = lastPlayerPosCounter;
  const pathCounterBeforeMove = lastPathDataCounter;
  keypress.sendKey(
    getDirectionKey(playerMinimapPosition, nextStep),
    globalState.global.display,
  );
  try {
    await awaitWalkConfirmation(
      posCounterBeforeMove,
      pathCounterBeforeMove,
      config.moveConfirmTimeoutMs,
    );
  } catch (error) {
    pathingLogger('error', `Walk step failed: ${error.message}`);
    recentKeyboardFailures.push(Date.now());
  }
};

const handleStandAction = async (targetWaypoint) => {
  const initialPos = { ...playerMinimapPosition };
  keypress.sendKey(
    getDirectionKey(initialPos, targetWaypoint),
    globalState.global.display,
  );
  try {
    const { finalPos } = await awaitStandConfirmation(
      initialPos,
      targetWaypoint,
      500,
    );
    if (finalPos.z !== initialPos.z) floorChangeGraceUntil = Date.now() + 500;
    if (getDistance(initialPos, finalPos) >= config.teleportDistanceThreshold) {
      stuckDetectionGraceUntil = Date.now() + config.postTeleportGraceMs;
    }
    return true;
  } catch (error) {
    pathingLogger('error', `Stand action failed: ${error.message}`);
    return false;
  }
};

const handleLadderAction = async (targetCoords) => {
  const initialPos = { ...playerMinimapPosition };
  if (!initialPos) return false; // Safety check

  await delay(config.preClickDelayMs);

  const { gameWorld, tileSize } = globalState.regionCoordinates.regions;
  if (!gameWorld || !tileSize) {
    logger(
      'error',
      '[handleLadderAction] Missing region coordinates for click.',
    );
    return false;
  }

  const clickCoords = getAbsoluteGameWorldClickCoordinates(
    targetCoords.x,
    targetCoords.y,
    initialPos,
    gameWorld,
    tileSize,
    'bottomRight', // Using 'bottomRight' as it was in the original code
  );

  if (!clickCoords) {
    logger(
      'error',
      '[handleLadderAction] Could not calculate click coordinates.',
    );
    return false;
  }

  mouseController.rightClick(
    parseInt(globalState.global.windowId, 10),
    clickCoords.x,
    clickCoords.y,
    globalState.global.display || ':0',
  );

  // Wait for a Z-level change within 500ms, as per your requirement.
  const zChanged = await awaitZLevelChange(initialPos.z, 500);

  if (zChanged) {
    // Success! Give the game a moment to settle after a floor change.
    floorChangeGraceUntil = Date.now() + 500;
    return true;
  }

  // Failure: Z-level did not change in time.
  return false;
};

const handleZLevelToolAction = async (toolType, targetCoords) => {
  const state = globalState;
  const hotkey = state.settings.hotkeys[toolType.toLowerCase()];
  if (!hotkey) return false;
  const { gameWorld, tileSize } = state.regionCoordinates.regions;
  if (!gameWorld || !tileSize) return false;
  const initialPos = { ...playerMinimapPosition };
  keypress.sendKey(hotkey, state.global.display || ':0');
  await delay(config.toolHotkeyWaitMs + config.preClickDelayMs);
  const clickCoords = getAbsoluteGameWorldClickCoordinates(
    targetCoords.x,
    targetCoords.y,
    initialPos,
    gameWorld,
    tileSize,
    'center',
  );
  if (!clickCoords) return false;
  mouseController.leftClick(
    parseInt(state.global.windowId, 10),
    clickCoords.x,
    clickCoords.y,
    state.global.display || ':0',
  );
  const zChanged = await awaitStateChange(
    (s) => s.gameState?.playerMinimapPosition?.z !== initialPos.z,
    config.actionStateChangeTimeoutMs,
  );
  if (zChanged) {
    floorChangeGraceUntil = Date.now() + 500;
    const finalPos = globalState.gameState.playerMinimapPosition; // globalState is updated by awaitStateChange
    if (getDistance(initialPos, finalPos) >= config.teleportDistanceThreshold) {
      stuckDetectionGraceUntil = Date.now() + config.postTeleportGraceMs;
    }
    return true;
  }
  return false;
};

const handleScriptAction = async (targetWpt) => {
  if (!luaExecutor || !luaExecutor.isInitialized) {
    await advanceToNextWaypoint();
    return;
  }
  const result = await luaExecutor.executeScript(targetWpt.script);
  if (result.success && !result.navigationOccurred) {
    await advanceToNextWaypoint();
  }
};

// --- Confirmation Utilities ---
const awaitWalkConfirmation = (
  posCounterBeforeMove,
  pathCounterBeforeMove,
  timeoutMs,
) => {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      reject(new Error(`awaitWalkConfirmation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const intervalId = setInterval(() => {
      const posChanged =
        Atomics.load(playerPosArray, PLAYER_POS_UPDATE_COUNTER_INDEX) >
        posCounterBeforeMove;
      const pathChanged =
        Atomics.load(pathDataArray, PATH_UPDATE_COUNTER_INDEX) >
        pathCounterBeforeMove;
      if (posChanged && pathChanged) {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        resolve(true);
      }
    }, STATE_CHANGE_POLL_INTERVAL);
  });
};

const awaitStandConfirmation = (initialPos, targetPos, timeoutMs) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const intervalId = setInterval(() => {
      const finalPos = {
        x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
        y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
        z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
      };
      const zChanged = finalPos.z !== initialPos.z;
      const teleported =
        getDistance(initialPos, finalPos) >= config.teleportDistanceThreshold;
      const reachedTarget =
        finalPos.x === targetPos.x &&
        finalPos.y === targetPos.y &&
        finalPos.z === targetPos.z;
      if (zChanged || teleported || reachedTarget) {
        clearInterval(intervalId);
        resolve({ success: true, finalPos });
      }
      if (Date.now() - startTime > timeoutMs) {
        clearInterval(intervalId);
        reject(
          new Error(`awaitStandConfirmation timed out after ${timeoutMs}ms`),
        );
      }
    }, STATE_CHANGE_POLL_INTERVAL);
  });
};

// --- FINITE STATE MACHINE (FSM) ---
const fsm = {
  IDLE: {
    enter: () => postStoreUpdate('cavebot/setActionPaused', true),
    execute: (context) =>
      context.targetWaypoint ? 'EVALUATING_WAYPOINT' : 'IDLE',
  },

  EVALUATING_WAYPOINT: {
    execute: async (context) => {
      const { playerPos, targetWaypoint, status, path, chebyshevDist } =
        context;

      // Helper function for advancing to the next waypoint
      const handleAdvance = async (reason) => {
        pathingLogger(
          'info',
          `${reason} for waypoint ${targetWaypoint.id}. Advancing.`,
        );
        const advanced = await advanceToNextWaypoint();
        // Go IDLE to re-evaluate the new state, or if advancing fails
        return 'IDLE';
      };

      // --- Step 1: Handle each waypoint type with its specific logic ---
      switch (targetWaypoint.type) {
        case 'Script':
          // Scripts are executed immediately, position is irrelevant.
          return 'EXECUTING_SCRIPT';

        case 'Node':
          // Success condition: Player is at the exact waypoint coordinates.
          if (
            playerPos.x === targetWaypoint.x &&
            playerPos.y === targetWaypoint.y &&
            playerPos.z === targetWaypoint.z
          ) {
            return await handleAdvance('SUCCESS: Reached Node waypoint');
          }
          // If not at the node, fall through to the pathing logic below.
          break;

        case 'Stand':
          // Success condition: Player is exactly 1 tile away (adjacent).
          if (chebyshevDist === 1) {
            return 'PERFORMING_ACTION';
          }
          // If not adjacent, fall through to the pathing logic below.
          break;

        case 'Ladder':
          // Success condition: Player is on the tile or adjacent.
          if (chebyshevDist <= 1) {
            return 'PERFORMING_ACTION';
          }
          // If not close enough, fall through to the pathing logic below.
          break;

        default:
          pathingLogger(
            'warn',
            `Unknown waypoint type "${targetWaypoint.type}". Treating as Node.`,
          );
          if (
            playerPos.x === targetWaypoint.x &&
            playerPos.y === targetWaypoint.y &&
            playerPos.z === targetWaypoint.z
          ) {
            return await handleAdvance(
              `SUCCESS: Reached unknown waypoint type '${targetWaypoint.type}'`,
            );
          }
          break;
      }

      // --- Step 2: If no success condition was met, use pathfinder to move ---
      // This block is only reached if we need to walk towards the target.
      switch (status) {
        case PATH_STATUS_PATH_FOUND:
          if (path.length > 0) {
            // We have a valid path with steps, so let's walk.
            return 'WALKING';
          } else {
            // Anomaly: path is found but empty, and we are NOT at the target.
            // This could be a stale path. Wait for a new path from the pathfinder.
            pathingLogger(
              'warn',
              `Path is empty but not at destination for wpt ${targetWaypoint.id}. Awaiting new path.`,
            );
            return 'EVALUATING_WAYPOINT'; // Re-evaluate next tick
          }

        case PATH_STATUS_WAYPOINT_REACHED:
          // The pathfinder says we've arrived, but our position check above failed.
          // This indicates a sync issue. Trust our position check and advance to avoid getting stuck.
          pathingLogger(
            'warn',
            `Pathfinder reported WAYPOINT_REACHED for wpt ${targetWaypoint.id}, but position mismatch. Advancing.`,
          );
          return await handleAdvance(
            'WARN: Advancing due to state mismatch (REACHED)',
          );

        case PATH_STATUS_NO_PATH_FOUND:
        case PATH_STATUS_NO_VALID_START_OR_END:
        case PATH_STATUS_ERROR:
        case PATH_STATUS_DIFFERENT_FLOOR:
          // The waypoint is unreachable. Log it and advance.
          return await handleAdvance(
            `WARN: Waypoint unreachable (Code: ${status})`,
          );

        case PATH_STATUS_IDLE:
        default:
          // No path information yet. Keep waiting.
          return 'EVALUATING_WAYPOINT';
      }
    },
  },

  WALKING: {
    enter: () => postStoreUpdate('cavebot/setActionPaused', false),
    execute: async () => {
      await handleWalkAction();
      return 'EVALUATING_WAYPOINT';
    },
  },

  PERFORMING_ACTION: {
    enter: () => postStoreUpdate('cavebot/setActionPaused', true),
    execute: async (context) => {
      const { targetWaypoint } = context;
      let actionSucceeded = false;
      const targetCoords = {
        x: targetWaypoint.x,
        y: targetWaypoint.y,
        z: targetWaypoint.z,
      };

      if (targetWaypoint.type === 'Stand')
        actionSucceeded = await handleStandAction(targetWaypoint);
      else if (targetWaypoint.type === 'Ladder')
        actionSucceeded = await handleLadderAction(targetCoords);

      if (actionSucceeded) {
        pathingLogger(
          'info',
          `SUCCESS: Action ${targetWaypoint.type} succeeded. Advancing.`,
        );
        const advanced = await advanceToNextWaypoint();
        return advanced ? 'IDLE' : 'EVALUATING_WAYPOINT';
      } else {
        pathingLogger(
          'error',
          `Action ${targetWaypoint.type} failed. Re-evaluating.`,
        );
        await delay(250);
        return 'EVALUATING_WAYPOINT';
      }
    },
  },

  EXECUTING_SCRIPT: {
    enter: () => postStoreUpdate('cavebot/setActionPaused', true),
    execute: async (context) => {
      await handleScriptAction(context.targetWaypoint);
      return 'IDLE';
    },
  },
};

// --- Data Update and Contextual Logic ---

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

  // --- This is the new, safe read logic for the path data ---
  if (pathDataArray) {
    let consistentRead = false;
    let attempts = 0;

    // We might need to loop if a write happens while we're reading.
    // A simple attempt limit prevents any infinite loops in weird edge cases.
    do {
      const counterBeforeRead = Atomics.load(
        pathDataArray,
        PATH_UPDATE_COUNTER_INDEX,
      );

      // Only proceed if there's new data to read.
      if (counterBeforeRead === lastPathDataCounter) {
        return; // No new data, exit.
      }

      // --- Read the entire data block ---
      const pathStartX = Atomics.load(pathDataArray, PATH_START_X_INDEX);
      const pathStartY = Atomics.load(pathDataArray, PATH_START_Y_INDEX);
      const pathStartZ = Atomics.load(pathDataArray, PATH_START_Z_INDEX);
      const tempPathfindingStatus = Atomics.load(
        pathDataArray,
        PATHFINDING_STATUS_INDEX,
      );
      const tempPathChebyshevDistance = Atomics.load(
        pathDataArray,
        PATH_CHEBYSHEV_DISTANCE_INDEX,
      );
      const pathLength = Atomics.load(pathDataArray, PATH_LENGTH_INDEX);
      const tempPath = [];

      // Boundary check to prevent reading out of bounds if pathLength is corrupt
      const safePathLength = Math.min(pathLength, MAX_PATH_WAYPOINTS);
      for (let i = 0; i < safePathLength; i++) {
        const offset = PATH_WAYPOINTS_START_INDEX + i * PATH_WAYPOINT_SIZE;
        tempPath.push({
          x: Atomics.load(pathDataArray, offset + 0),
          y: Atomics.load(pathDataArray, offset + 1),
          z: Atomics.load(pathDataArray, offset + 2),
        });
      }

      // --- Read the counter again ---
      const counterAfterRead = Atomics.load(
        pathDataArray,
        PATH_UPDATE_COUNTER_INDEX,
      );

      // --- The Consistency Check ---
      if (counterBeforeRead === counterAfterRead) {
        // SUCCESS! The data is consistent.
        consistentRead = true;

        // Now, perform the validation against our current player position.
        if (
          !playerMinimapPosition ||
          playerMinimapPosition.x !== pathStartX ||
          playerMinimapPosition.y !== pathStartY ||
          playerMinimapPosition.z !== pathStartZ
        ) {
          // The data is consistent, but stale. We ignore it.
          // This isn't an error, just the pathfinder lagging behind.
        } else {
          // The data is consistent AND valid for our current position.
          // Commit the read data to our worker's state.
          path = tempPath;
          pathfindingStatus = tempPathfindingStatus;
          pathChebyshevDistance = tempPathChebyshevDistance;
        }

        // Mark this update counter as processed, so we don't try to read it again.
        lastPathDataCounter = counterAfterRead;
      } else {
        // A "torn read" occurred. The writer updated the buffer while we were reading.
        // We will loop and try again.
        attempts++;
      }
    } while (!consistentRead && attempts < 3);
  }
};

function findCurrentWaypoint() {
  if (!globalState?.cavebot) return null;
  const { waypointSections, currentSection, wptId } = globalState.cavebot;
  let targetWaypoint = waypointSections[currentSection]?.waypoints.find(
    (wp) => wp.id === wptId,
  );
  if (!targetWaypoint) {
    const firstSectionWithWaypoints = Object.keys(waypointSections).find(
      (id) => waypointSections[id]?.waypoints?.length > 0,
    );
    if (firstSectionWithWaypoints) {
      const firstWaypoint =
        waypointSections[firstSectionWithWaypoints].waypoints[0];
      if (firstWaypoint) {
        postStoreUpdate(
          'cavebot/setCurrentWaypointSection',
          firstSectionWithWaypoints,
        );
        postStoreUpdate('cavebot/setwptId', firstWaypoint.id);
        return firstWaypoint;
      }
    }
    return null;
  }
  return targetWaypoint;
}

// --- Main Operation ---
async function performOperation() {
  const opStart = performance.now();
  try {
    if (
      !isInitialized ||
      !globalState?.cavebot?.enabled ||
      !globalState.global?.windowId
    ) {
      if (fsmState !== 'IDLE') {
        fsmState = 'IDLE';
        fsm.IDLE.enter();
      }
      return;
    }

    updateSABData();
    if (!playerMinimapPosition) return;

    let targetWaypoint = findCurrentWaypoint();
    if (!targetWaypoint) {
      fsmState = 'IDLE';
      lastProcessedWptId = null;
      return;
    }

    // --- Pre-emptive "Seek" Loop ---
    while (targetWaypoint.z !== playerMinimapPosition.z) {
      pathingLogger(
        'info',
        `Waypoint ${targetWaypoint.id} is on a different floor (Z:${targetWaypoint.z}). Skipping.`,
      );
      const advanced = await advanceToNextWaypoint();
      if (!advanced) {
        pathingLogger(
          'error',
          'Failed to advance during fast-skip. Breaking loop.',
        );
        return;
      }
      targetWaypoint = findCurrentWaypoint();
      if (!targetWaypoint) {
        fsmState = 'IDLE';
        return;
      }
    }

    // --- Interruption Check Logic ---
    if (lastProcessedWptId && targetWaypoint.id !== lastProcessedWptId) {
      pathingLogger(
        'info',
        `Target waypoint changed externally to ${targetWaypoint.id}. Resetting state.`,
      );
      fsmState = 'IDLE';
      path = [];
      pathfindingStatus = PATH_STATUS_IDLE;
    }
    lastProcessedWptId = targetWaypoint.id;

    const context = {
      playerPos: playerMinimapPosition,
      path: path,
      chebyshevDist: pathChebyshevDistance,
      targetWaypoint: targetWaypoint,
      status: pathfindingStatus,
    };

    const stateLogic = fsm[fsmState];
    if (stateLogic) {
      const nextState = await stateLogic.execute(context);
      if (nextState !== fsmState) {
        lastFsmState = fsmState;
        fsmState = nextState;
        const newStateLogic = fsm[fsmState];
        if (newStateLogic && newStateLogic.enter) newStateLogic.enter(context);
        pathingLogger(
          'info',
          `[FSM] Transition: ${lastFsmState} -> ${fsmState}`,
        );
      }
    } else {
      logger('error', `Invalid FSM state: ${fsmState}. Resetting to IDLE.`);
      fsmState = 'IDLE';
    }
  } finally {
    const opEnd = performance.now();
    operationCount++;
    totalOperationTime += opEnd - opStart;
  }
}

// --- Main Loop & Worker Lifecycle ---
async function mainLoop() {
  logger('info', '[CavebotWorker] Starting main loop...');
  while (!isShuttingDown) {
    const loopStart = performance.now();
    try {
      await performOperation();
      logPerformanceStats();
    } catch (error) {
      logger('error', '[CavebotWorker] Unhandled error in main loop:', error);
      fsmState = 'IDLE';
      await delay(100);
    }
    const loopEnd = performance.now();
    const elapsedTime = loopEnd - loopStart;
    const delayTime = Math.max(0, MAIN_LOOP_INTERVAL - elapsedTime);
    if (delayTime > 0) await delay(delayTime);
  }
  logger('info', '[CavebotWorker] Main loop stopped.');
}

async function initializeWorker() {
  logger('info', 'Cavebot worker starting up...');
  try {
    luaExecutor = new CavebotLuaExecutor({
      logger,
      postStoreUpdate,
      getState: () => globalState,
      advanceToNextWaypoint,
      goToLabel,
      goToSection,
      goToWpt,
    });
    if (!(await luaExecutor.initialize()))
      throw new Error('LuaExecutor failed to initialize.');
    logger('info', 'Cavebot Lua Executor initialized successfully.');
  } catch (e) {
    logger('error', `Could not initialize Cavebot Lua Executor: ${e.message}`);
    luaExecutor = null;
  }
  isInitialized = true;
  logger('info', 'Cavebot worker initialization complete.');
}

parentPort.on('message', (message) => {
  try {
    if (message.type === 'state_diff') {
      if (!globalState) globalState = {};
      Object.assign(globalState, message.payload);
    } else if (message.type === 'shutdown') {
      isShuttingDown = true;
      if (luaExecutor) luaExecutor.destroy();
    } else if (typeof message === 'object' && !message.type) {
      if (!globalState) globalState = message;
      else Object.assign(globalState, message);
      if (!isInitialized) {
        initializeWorker().catch((error) => {
          logger(
            'error',
            '[CavebotWorker] Failed to initialize worker:',
            error,
          );
          process.exit(1);
        });
      }
    }
  } catch (error) {
    logger('error', '[CavebotWorker] Error handling message:', error);
  }
});

parentPort.on('close', () => {
  isShuttingDown = true;
  if (luaExecutor) luaExecutor.destroy();
  process.exit(0);
});

function startWorker() {
  logger('info', '[CavebotWorker] Worker starting up...');
  process.on('SIGTERM', () => {
    isShuttingDown = true;
  });
  process.on('SIGINT', () => {
    isShuttingDown = true;
  });
  mainLoop().catch((error) => {
    logger('error', '[CavebotWorker] Fatal error in main loop:', error);
    process.exit(1);
  });
}

try {
  if (!workerData) throw new Error('[CavebotWorker] Worker data not provided');
  startWorker();
} catch (error) {
  logger('error', '[CavebotWorker] Failed to start worker:', error);
  process.exit(1);
}
