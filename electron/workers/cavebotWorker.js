import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import keypress from 'keypress-native';
import mouseController from 'mouse-controller';
import useItemOnCoordinates from '../mouseControll/useItemOnCoordinates.js';
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

const MAIN_LOOP_INTERVAL = 25;
const STATE_CHANGE_POLL_INTERVAL = 5;
const PRUNE_DISTANCE_THRESHOLD = 8;

const config = {
  actionStateChangeTimeoutMs: 200,
  preClickDelayMs: 250,
  toolHotkeyWaitMs: 250,
  teleportDistanceThreshold: 5,
  postTeleportGraceMs: 1250,
  moveConfirmTimeoutMs: 400,
  toolHotkeys: {
    rope: 'b',
    machete: 'n',
    shovel: 'v',
  },
};

let globalState = null;
let isShuttingDown = false;
let isInitialized = false;
let fsmState = 'IDLE';
let lastFsmState = null;
let lastControlState = 'CAVEBOT';

let lastPlayerPosCounter = -1;
let lastPathDataCounter = -1;
let playerMinimapPosition = null;
let path = [];
let pathChebyshevDistance = null;
let pathfindingStatus = PATH_STATUS_IDLE;

const { playerPosSAB, pathDataSAB } = workerData;
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const pathDataArray = pathDataSAB ? new Int32Array(pathDataSAB) : null;

let luaExecutor = null;
let stuckDetectionGraceUntil = 0;
let floorChangeGraceUntil = 0;
let recentKeyboardFailures = [];
let lastProcessedWptId = null;

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

const logger = createLogger({ info: true, error: true, debug: true });

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
    let consistentRead = false;
    let attempts = 0;
    do {
      const counterBeforeRead = Atomics.load(
        pathDataArray,
        PATH_UPDATE_COUNTER_INDEX,
      );
      if (counterBeforeRead === lastPathDataCounter) return;

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
      const safePathLength = Math.min(pathLength, MAX_PATH_WAYPOINTS);
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
        consistentRead = true;
        let finalPath = tempPath;

        if (playerMinimapPosition && tempPath.length > 0) {
          let closestIndex = -1;
          let minDistance = Infinity;

          for (let i = 0; i < tempPath.length; i++) {
            const distance = getDistance(playerMinimapPosition, tempPath[i]);
            if (distance < minDistance) {
              minDistance = distance;
              closestIndex = i;
            }
          }

          if (closestIndex !== -1 && minDistance < PRUNE_DISTANCE_THRESHOLD) {
            finalPath = tempPath.slice(closestIndex);
          } else {
            finalPath = [];
          }
        }

        path = finalPath;
        pathfindingStatus = tempPathfindingStatus;
        pathChebyshevDistance = tempPathChebyshevDistance;
        lastPathDataCounter = counterAfterRead;
      } else {
        attempts++;
      }
    } while (!consistentRead && attempts < 3);
  }
};

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

const resetInternalState = () => {
  if (fsmState !== 'IDLE') {
    fsmState = 'IDLE';
    fsm.IDLE.enter();
  }
  path = [];
  pathfindingStatus = PATH_STATUS_IDLE;
  lastPathDataCounter = -1;
  lastFsmState = null;
};

const awaitZLevelChange = (initialZ, timeoutMs) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const intervalId = setInterval(() => {
      const currentZ = Atomics.load(playerPosArray, PLAYER_Z_INDEX);
      if (currentZ !== initialZ) {
        clearInterval(intervalId);
        resolve(true);
      }
      if (Date.now() - startTime > timeoutMs) {
        clearInterval(intervalId);
        resolve(false);
      }
    }, STATE_CHANGE_POLL_INTERVAL);
  });
};

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
    const confirmed = await awaitStateChange(
      (state) => state?.cavebot?.wptId === nextWpt.id,
      500,
    );
    if (confirmed) {
      lastProcessedWptId = nextWpt.id;
    }
    return confirmed;
  }
  return false;
};

const goToLabel = async (label) => {
  const { waypointSections, currentSection } = globalState.cavebot;
  const targetWaypoint = waypointSections[currentSection].waypoints.find(
    (wpt) => wpt.label === label,
  );
  if (targetWaypoint) {
    postStoreUpdate('cavebot/setwptId', targetWaypoint.id);
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

const handleWalkAction = async (targetWaypoint) => {
  const nextStep = path[0] || targetWaypoint;
  if (!nextStep) {
    return;
  }
  if (
    playerMinimapPosition.x === nextStep.x &&
    playerMinimapPosition.y === nextStep.y
  ) {
    await delay(MAIN_LOOP_INTERVAL);
    return;
  }
  const posCounterBeforeMove = lastPlayerPosCounter;
  const pathCounterBeforeMove = lastPathDataCounter;
  const dirKey = getDirectionKey(playerMinimapPosition, nextStep);
  if (!dirKey) {
    return;
  }
  keypress.sendKey(dirKey, globalState.global.display);
  try {
    await awaitWalkConfirmation(
      posCounterBeforeMove,
      pathCounterBeforeMove,
      config.moveConfirmTimeoutMs,
    );
  } catch (error) {
    recentKeyboardFailures.push(Date.now());
  }
};

const handleStandAction = async (targetWaypoint) => {
  const initialPos = { ...playerMinimapPosition };
  const dirKey = getDirectionKey(initialPos, targetWaypoint);
  if (!dirKey) {
    return false;
  }
  keypress.sendKey(dirKey, globalState.global.display);
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
    return false;
  }
};

const handleLadderAction = async (targetCoords) => {
  const initialPos = { ...playerMinimapPosition };
  if (!initialPos) return false;
  await delay(config.preClickDelayMs);
  const { gameWorld, tileSize } = globalState.regionCoordinates.regions;
  logger('debug', '[handleLadderAction] initialPos:', initialPos);
  logger('debug', '[handleLadderAction] targetCoords:', targetCoords);
  logger('debug', '[handleLadderAction] gameWorld:', gameWorld);
  logger('debug', '[handleLadderAction] tileSize:', tileSize);
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
    'bottomRight',
  );
  logger('info', 'Ladder:', clickCoords);
  if (!clickCoords) {
    logger(
      'error',
      '[handleLadderAction] Could not calculate click coordinates.',
    );
    return false;
  }
  mouseController.leftClick(
    parseInt(globalState.global.windowId, 10),
    clickCoords.x,
    clickCoords.y,
    globalState.global.display || ':0',
  );
  const zChanged = await awaitZLevelChange(initialPos.z, 500);
  if (zChanged) {
    floorChangeGraceUntil = Date.now() + 500;
    return true;
  }
  return false;
};

const handleRopeAction = async (targetCoords) => {
  const initialPos = { ...playerMinimapPosition };
  if (!initialPos) return false;
  await delay(config.preClickDelayMs);
  const { gameWorld, tileSize } = globalState.regionCoordinates.regions;
  logger('debug', '[handleRopeAction] initialPos:', initialPos);
  logger('debug', '[handleRopeAction] targetCoords:', targetCoords);
  logger('debug', '[handleRopeAction] gameWorld:', gameWorld);
  logger('debug', '[handleRopeAction] tileSize:', tileSize);
  if (!gameWorld || !tileSize) {
    logger('error', '[handleRopeAction] Missing region coordinates for click.');
    return false;
  }
  const clickCoords = getAbsoluteGameWorldClickCoordinates(
    targetCoords.x,
    targetCoords.y,
    initialPos,
    gameWorld,
    tileSize,
    'bottomRight',
  );
  logger('info', 'Rope:', clickCoords);
  if (!clickCoords) {
    logger(
      'error',
      '[handleLadderAction] Could not calculate click coordinates.',
    );
    return false;
  }
  keypress.sendKey(config.toolHotkeys.rope, globalState.global.display);
  await delay(50);
  mouseController.leftClick(
    parseInt(globalState.global.windowId, 10),
    clickCoords.x,
    clickCoords.y,
    globalState.global.display || ':0',
  );
  const zChanged = await awaitZLevelChange(initialPos.z, 500);
  if (zChanged) {
    floorChangeGraceUntil = Date.now() + 500;
    return true;
  }
  return false;
};

const handleShovelAction = async (targetCoords) => {
  const hotkey = config.toolHotkeys.shovel;
  if (!hotkey) {
    logger('error', '[handleShovelAction] Shovel hotkey not configured.');
    return false;
  }
  const initialPos = { ...playerMinimapPosition };
  if (!initialPos) return false;
  await delay(config.preClickDelayMs);
  const { gameWorld, tileSize } = globalState.regionCoordinates.regions;
  if (!gameWorld || !tileSize) {
    logger(
      'error',
      '[handleShovelAction] Missing region coordinates for click.',
    );
    return false;
  }
  const clickCoords = getAbsoluteGameWorldClickCoordinates(
    targetCoords.x,
    targetCoords.y,
    initialPos,
    gameWorld,
    tileSize,
    'center',
  );
  if (!clickCoords) {
    logger(
      'error',
      '[handleShovelAction] Could not calculate click coordinates.',
    );
    return false;
  }
  useItemOnCoordinates(
    parseInt(globalState.global.windowId, 10),
    globalState.global.display || ':0',
    clickCoords.x,
    clickCoords.y,
    hotkey,
  );
  const zChanged = await awaitZLevelChange(initialPos.z, 500);
  if (zChanged) {
    floorChangeGraceUntil = Date.now() + 500;
    return true;
  }
  return false;
};

const handleMacheteAction = async (targetWaypoint) => {
  const hotkey = config.toolHotkeys.machete;
  if (!hotkey) {
    logger('error', '[handleMacheteAction] Machete hotkey not configured.');
    return false;
  }
  const initialPos = { ...playerMinimapPosition };
  if (!initialPos) return false;
  const { gameWorld, tileSize } = globalState.regionCoordinates.regions;
  if (!gameWorld || !tileSize) {
    logger(
      'error',
      '[handleMacheteAction] Missing region coordinates for click.',
    );
    return false;
  }
  const clickCoords = getAbsoluteGameWorldClickCoordinates(
    targetWaypoint.x,
    targetWaypoint.y,
    initialPos,
    gameWorld,
    tileSize,
    'center',
  );
  if (!clickCoords) {
    logger(
      'error',
      '[handleMacheteAction] Could not calculate click coordinates.',
    );
    return false;
  }

  let actionSucceeded = false;
  for (let i = 0; i < 3; i++) {
    // Try to walk onto the tile
    const posCounterBeforeMove = lastPlayerPosCounter;
    const pathCounterBeforeMove = lastPathDataCounter;
    const dirKey = getDirectionKey(playerMinimapPosition, targetWaypoint);
    if (dirKey) {
      keypress.sendKey(dirKey, globalState.global.display);
      try {
        await awaitWalkConfirmation(
          posCounterBeforeMove,
          pathCounterBeforeMove,
          config.moveConfirmTimeoutMs,
        );
        // If walk succeeded, we are done
        actionSucceeded = true;
        break;
      } catch (error) {
        logger(
          'debug',
          '[handleMacheteAction] Walk failed, attempting to use machete.',
        );
      }
    }

    // If walk failed, use machete and try to walk again
    useItemOnCoordinates(
      parseInt(globalState.global.windowId, 10),
      globalState.global.display || ':0',
      clickCoords.x,
      clickCoords.y,
      hotkey,
    );
    await delay(config.toolHotkeyWaitMs + config.preClickDelayMs);

    // Try walking again after using machete
    const posCounterBeforeMoveAfterTool = lastPlayerPosCounter;
    const pathCounterBeforeMoveAfterTool = lastPathDataCounter;
    if (dirKey) {
      keypress.sendKey(dirKey, globalState.global.display);
      try {
        await awaitWalkConfirmation(
          posCounterBeforeMoveAfterTool,
          pathCounterBeforeMoveAfterTool,
          config.moveConfirmTimeoutMs,
        );
        actionSucceeded = true;
        break;
      } catch (error) {
        logger(
          'debug',
          '[handleMacheteAction] Walk failed again after using machete.',
        );
      }
    }
    await delay(250); // Small delay before next retry
  }
  return actionSucceeded;
};

const handleDoorAction = async (targetWaypoint) => {
  const initialPos = { ...playerMinimapPosition };
  if (!initialPos) return false;
  const { gameWorld, tileSize } = globalState.regionCoordinates.regions;
  if (!gameWorld || !tileSize) {
    logger('error', '[handleDoorAction] Missing region coordinates for click.');
    return false;
  }
  const clickCoords = getAbsoluteGameWorldClickCoordinates(
    targetWaypoint.x,
    targetWaypoint.y,
    initialPos,
    gameWorld,
    tileSize,
    'center',
  );
  if (!clickCoords) {
    logger(
      'error',
      '[handleDoorAction] Could not calculate click coordinates.',
    );
    return false;
  }

  // Try to walk onto the tile
  const posCounterBeforeMove = lastPlayerPosCounter;
  const pathCounterBeforeMove = lastPathDataCounter;
  const dirKey = getDirectionKey(playerMinimapPosition, targetWaypoint);
  if (dirKey) {
    keypress.sendKey(dirKey, globalState.global.display);
    try {
      await awaitWalkConfirmation(
        posCounterBeforeMove,
        pathCounterBeforeMove,
        config.moveConfirmTimeoutMs,
      );
      // If walk succeeded, we are done
      return true;
    } catch (error) {
      logger(
        'debug',
        '[handleDoorAction] Walk failed, attempting to click door.',
      );
    }
  }

  // If walk failed, perform a direct left click
  await delay(config.preClickDelayMs);
  mouseController.leftClick(
    parseInt(globalState.global.windowId, 10),
    clickCoords.x,
    clickCoords.y,
    globalState.global.display || ':0',
  );

  // Assume click opens door and allows movement, then check if player moved
  const moved = await awaitWalkConfirmation(
    posCounterBeforeMove,
    pathCounterBeforeMove,
    config.actionStateChangeTimeoutMs,
  );
  return moved;
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
      const posChanged = playerPosArray
        ? Atomics.load(playerPosArray, PLAYER_POS_UPDATE_COUNTER_INDEX) >
          posCounterBeforeMove
        : false;
      const pathChanged = pathDataArray
        ? Atomics.load(pathDataArray, PATH_UPDATE_COUNTER_INDEX) >
          pathCounterBeforeMove
        : false;
      if (posChanged || pathChanged) {
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
      if (zChanged || teleported) {
        clearInterval(intervalId);
        setTimeout(() => resolve({ success: true, finalPos }), 10);
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
      switch (targetWaypoint.type) {
        case 'Script':
          return 'EXECUTING_SCRIPT';
        case 'Stand':
        case 'Ladder':
        case 'Rope':
        case 'Shovel':
        case 'Machete':
        case 'Door':
          if (typeof chebyshevDist === 'number' && chebyshevDist <= 1) {
            if (
              playerPos.x === targetWaypoint.x &&
              playerPos.y === targetWaypoint.y &&
              playerPos.z === targetWaypoint.z
            ) {
              logger(
                'info',
                `[Cavebot] Player is exactly on action waypoint ${targetWaypoint.type}. Performing action.`,
              );
            }
            return 'PERFORMING_ACTION';
          }
          break;
        case 'Node': // Assuming 'Node' is the default type for walk waypoints
        case 'Walk': // If there's a specific 'Walk' type
          if (
            playerPos.x === targetWaypoint.x &&
            playerPos.y === targetWaypoint.y &&
            playerPos.z === targetWaypoint.z
          ) {
            await advanceToNextWaypoint();
            return 'IDLE';
          }
          break;
        default:
          break;
      }
      if (
        (status === PATH_STATUS_PATH_FOUND ||
          status === PATH_STATUS_WAYPOINT_REACHED) &&
        Array.isArray(path) &&
        path.length === 0 &&
        chebyshevDist > 0
      ) {
        return 'WALKING';
      }
      if (status === PATH_STATUS_WAYPOINT_REACHED) {
        await advanceToNextWaypoint();
        return 'IDLE';
      }
      switch (status) {
        case PATH_STATUS_PATH_FOUND:
          if (path.length > 0) return 'WALKING';
          return 'EVALUATING_WAYPOINT';
        case PATH_STATUS_NO_PATH_FOUND:
        case PATH_STATUS_NO_VALID_START_OR_END:
        case PATH_STATUS_ERROR:
        case PATH_STATUS_DIFFERENT_FLOOR:
          await advanceToNextWaypoint();
          return 'IDLE';
        case PATH_STATUS_IDLE:
        default:
          return 'EVALUATING_WAYPOINT';
      }
    },
  },
  WALKING: {
    enter: () => postStoreUpdate('cavebot/setActionPaused', false),
    execute: async (context) => {
      await handleWalkAction(context.targetWaypoint);
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
      else if (targetWaypoint.type === 'Rope')
        actionSucceeded = await handleRopeAction(targetCoords);
      else if (targetWaypoint.type === 'Shovel')
        actionSucceeded = await handleShovelAction(targetCoords);
      else if (targetWaypoint.type === 'Machete')
        actionSucceeded = await handleMacheteAction(targetWaypoint);
      else if (targetWaypoint.type === 'Door')
        actionSucceeded = await handleDoorAction(targetWaypoint);
      if (actionSucceeded) {
        await advanceToNextWaypoint();
        return 'IDLE';
      } else {
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

async function performOperation() {
  try {
    if (!globalState) return;
    if (
      !isInitialized ||
      !globalState.cavebot?.enabled ||
      !globalState.global?.windowId
    ) {
      if (fsmState !== 'IDLE') resetInternalState();
      return;
    }
    const { controlState, waypointIdAtTargetingStart, visitedTiles } =
      globalState.cavebot;

    if (controlState === 'HANDOVER_TO_TARGETING') {
      resetInternalState();
      postStoreUpdate('cavebot/confirmTargetingControl');
      lastControlState = controlState;
      return;
    }
    if (controlState !== 'CAVEBOT') {
      if (lastControlState === 'CAVEBOT') {
        resetInternalState();
      }
      lastControlState = controlState;
      return;
    }

    // This block executes on the first tick after regaining control from targeting.
    if (lastControlState !== 'CAVEBOT' && controlState === 'CAVEBOT') {
      let skippedWaypoint = false;
      if (
        waypointIdAtTargetingStart &&
        visitedTiles &&
        visitedTiles.length > 0
      ) {
        let currentWaypoint = findCurrentWaypoint();

        if (
          currentWaypoint &&
          currentWaypoint.id === waypointIdAtTargetingStart &&
          currentWaypoint.type === 'Node'
        ) {
          const waypointCoords = {
            x: currentWaypoint.x,
            y: currentWaypoint.y,
            z: currentWaypoint.z,
          };
          const radius = 4; // Chebyshev distance

          const wasVisited = visitedTiles.some(
            (tile) =>
              tile.z === waypointCoords.z &&
              Math.max(
                Math.abs(tile.x - waypointCoords.x),
                Math.abs(tile.y - waypointCoords.y),
              ) <= radius,
          );

          if (wasVisited) {
            logger(
              'info',
              `[Cavebot] Node waypoint ${currentWaypoint.id} was visited during targeting. Skipping.`,
            );
            await advanceToNextWaypoint();
            skippedWaypoint = true;
          }
        }
      }

      // Always clean up visited tiles after the check, regardless of the outcome.
      postStoreUpdate('cavebot/clearVisitedTiles');

      if (skippedWaypoint) {
        // If we skipped, update lastControlState immediately and return.
        // The next loop will start fresh with the new waypoint.
        lastControlState = globalState.cavebot.controlState;
        return;
      }
    }

    updateSABData();
    if (!playerMinimapPosition) return;
    let targetWaypoint = findCurrentWaypoint();
    if (!targetWaypoint) {
      if (fsmState !== 'IDLE') resetInternalState();
      lastProcessedWptId = null;
      return;
    }
    if (lastProcessedWptId && targetWaypoint.id !== lastProcessedWptId) {
      resetInternalState();
      lastProcessedWptId = targetWaypoint.id;
      return;
    }
    if (targetWaypoint.z !== playerMinimapPosition.z) {
      await advanceToNextWaypoint();
      return;
    }
    if (!lastProcessedWptId) {
      lastProcessedWptId = targetWaypoint.id;
    }
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
      }
    } else {
      logger('error', `Invalid FSM state: ${fsmState}. Resetting to IDLE.`);
      fsmState = 'IDLE';
    }
  } finally {
    if (globalState?.cavebot) {
      lastControlState = globalState.cavebot.controlState;
    }
  }
}

async function mainLoop() {
  logger('info', '[CavebotWorker] Starting main loop...');
  while (!isShuttingDown) {
    const loopStart = performance.now();
    try {
      await performOperation();
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
