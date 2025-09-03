// /home/feiron/Dokumenty/Automaton/electron/workers/cavebotWorker.js

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import keypress from 'keypress-native';
import mouseController from 'mouse-controller';
import useItemOnCoordinates from '../mouseControll/useItemOnCoordinates.js';
import { getAbsoluteClickCoordinates } from '../utils/minimapClickTranslator.js';
import { getAbsoluteGameWorldClickCoordinates } from '../utils/gameWorldClickTranslator.js';
import { createLogger } from '../utils/logger.js';
import getDirectionKey from '../utils/getDirectionKey.js';
import { getDistance } from '../utils/distance.js';
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

const config = {
  mainLoopInterval: 25,
  stateChangePollInterval: 25,
  maxScriptRetries: 1,
  actionStateChangeTimeoutMs: 200,
  preClickDelayMs: 250,
  toolHotkeyWaitMs: 250,
  teleportDistanceThreshold: 5,
  postTeleportGraceMs: 1250,
  moveConfirmTimeoutMs: 400,
  moveConfirmTimeoutDiagonalMs: 750,
  moveConfirmGraceDiagonalMs: 150,
  toolHotkeys: {
    rope: 'b',
    machete: 'n',
    shovel: 'v',
  },
  waypointSkipRadius: 4,
  defaultAwaitStateChangeTimeout: 500,
  floorChangeGraceMs: 500,
  macheteRetryDelay: 250,
  scriptErrorDelay: 250,
  controlHandoverGraceMs: 100,
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
let shouldRequestNewPath = false;

let scriptErrorWaypointId = null;
let scriptErrorCount = 0;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const logger = createLogger({ info: true, error: true, debug: false });

const getFreshState = () =>
  new Promise((res) => {
    const onSnap = (msg) => {
      if (msg.type === 'state_snapshot') {
        parentPort.off('message', onSnap);
        globalState = msg.payload;
        res(msg.payload);
      }
    };
    parentPort.on('message', onSnap);
    parentPort.postMessage({ type: 'request_state_snapshot' });
  });

const updateSABData = () => {
  if (playerPosArray) {
    // ======================= FIX: Corrected variable from SAB to TypedArray view =======================
    const newPlayerPosCounter = Atomics.load(
      playerPosArray, // <-- This must be the Int32Array view, not the raw SharedArrayBuffer.
      PLAYER_POS_UPDATE_COUNTER_INDEX,
    );
    // ===================================================================================================
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
      // Do not read from SAB immediately, let the FSM trigger a new path request
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
        path = tempPath;
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

const postGlobalVarUpdate = (key, value) => {
  parentPort.postMessage({
    type: 'lua_global_update',
    payload: { key, value },
  });
};

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
    }, config.stateChangePollInterval);
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
    }, config.stateChangePollInterval);
  });
};

const advanceToNextWaypoint = async () => {
  scriptErrorWaypointId = null;
  scriptErrorCount = 0;

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
      config.defaultAwaitStateChangeTimeout,
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

const handleWalkAction = async () => {
  if (!path || path.length === 0) {
    return;
  }
  const nextStep = path[0];
  if (
    playerMinimapPosition.x === nextStep.x &&
    playerMinimapPosition.y === nextStep.y
  ) {
    await delay(config.mainLoopInterval);
    return;
  }
  const posCounterBeforeMove = lastPlayerPosCounter;
  const pathCounterBeforeMove = lastPathDataCounter;
  const dirKey = getDirectionKey(playerMinimapPosition, nextStep);
  if (!dirKey) {
    return;
  }

  const isDiagonal = ['q', 'e', 'z', 'c'].includes(dirKey);
  const timeout = isDiagonal
    ? config.moveConfirmTimeoutDiagonalMs
    : config.moveConfirmTimeoutMs;

  keypress.sendKey(dirKey, globalState.global.display);
  try {
    await awaitWalkConfirmation(
      posCounterBeforeMove,
      pathCounterBeforeMove,
      timeout,
    );
    if (isDiagonal) {
      await delay(config.moveConfirmGraceDiagonalMs);
    }
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
      config.defaultAwaitStateChangeTimeout,
    );
    if (finalPos.z !== initialPos.z)
      floorChangeGraceUntil = Date.now() + config.floorChangeGraceMs;
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
  const zChanged = await awaitZLevelChange(
    initialPos.z,
    config.defaultAwaitStateChangeTimeout,
  );
  if (zChanged) {
    floorChangeGraceUntil = Date.now() + config.floorChangeGraceMs;
    return true;
  }
  return false;
};

const handleRopeAction = async (targetCoords) => {
  const initialPos = { ...playerMinimapPosition };
  if (!initialPos) return false;
  await delay(config.preClickDelayMs);
  const { gameWorld, tileSize } = globalState.regionCoordinates.regions;
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
  const zChanged = await awaitZLevelChange(
    initialPos.z,
    config.defaultAwaitStateChangeTimeout,
  );
  if (zChanged) {
    floorChangeGraceUntil = Date.now() + config.floorChangeGraceMs;
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
  const zChanged = await awaitZLevelChange(
    initialPos.z,
    config.defaultAwaitStateChangeTimeout,
  );
  if (zChanged) {
    floorChangeGraceUntil = Date.now() + config.floorChangeGraceMs;
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
        actionSucceeded = true;
        break;
      } catch (error) {
        logger(
          'debug',
          '[handleMacheteAction] Walk failed, attempting to use machete.',
        );
      }
    }

    useItemOnCoordinates(
      parseInt(globalState.global.windowId, 10),
      globalState.global.display || ':0',
      clickCoords.x,
      clickCoords.y,
      hotkey,
    );
    await delay(config.toolHotkeyWaitMs + config.preClickDelayMs);

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
    await delay(250);
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
      return true;
    } catch (error) {
      logger(
        'debug',
        '[handleDoorAction] Walk failed, attempting to click door.',
      );
    }
  }

  await delay(config.preClickDelayMs);
  mouseController.leftClick(
    parseInt(globalState.global.windowId, 10),
    clickCoords.x,
    clickCoords.y,
    globalState.global.display || ':0',
  );

  const moved = await awaitWalkConfirmation(
    posCounterBeforeMove,
    pathCounterBeforeMove,
    config.actionStateChangeTimeoutMs,
  );
  return moved;
};

const handleScriptAction = async (targetWpt) => {
  if (!luaExecutor || !luaExecutor.isInitialized) {
    await delay(config.controlHandoverGraceMs);
    return;
  }

  if (scriptErrorWaypointId !== targetWpt.id) {
    scriptErrorWaypointId = targetWpt.id;
    scriptErrorCount = 0;
  }

  const result = await luaExecutor.executeScript(targetWpt.script);

  if (result.success) {
    scriptErrorCount = 0;
    if (!result.navigationOccurred) {
      await advanceToNextWaypoint();
    }
  } else {
    scriptErrorCount++;
    logger(
      'warn',
      `[Cavebot] Script at waypoint ${targetWpt.id} failed. Attempt ${scriptErrorCount}/${config.maxScriptRetries}.`,
    );

    if (scriptErrorCount >= config.maxScriptRetries) {
      const attemptText =
        config.maxScriptRetries === 1
          ? '1 time'
          : `${config.maxScriptRetries} times`;
      logger(
        'error',
        `[Cavebot] Script at waypoint ${targetWpt.id} failed ${attemptText}. Skipping to next waypoint.`,
      );
      await advanceToNextWaypoint();
    } else {
      await delay(config.scriptErrorDelay);
    }
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
    }, config.stateChangePollInterval);
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
    }, config.stateChangePollInterval);
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
      const { playerPos, targetWaypoint, status, chebyshevDist } = context;

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
        case 'Node':
        case 'Walk':
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

      if (status === PATH_STATUS_WAYPOINT_REACHED) {
        await advanceToNextWaypoint();
        return 'IDLE';
      }

      switch (status) {
        case PATH_STATUS_PATH_FOUND:
          if (path.length > 0) {
            const isStalePath = path.some(
              (p) => p.x === playerPos.x && p.y === playerPos.y,
            );
            if (isStalePath) {
              logger(
                'debug',
                '[Cavebot] Stale path detected (player is on path). Awaiting new path.',
              );
              path = [];
              return 'EVALUATING_WAYPOINT';
            }
            return 'WALKING';
          }
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
        await delay(config.macheteRetryDelay);
        return 'EVALUATING_WAYPOINT';
      }
    },
  },
  EXECUTING_SCRIPT: {
    enter: () => postStoreUpdate('cavebot/setActionPaused', true),
    execute: async (context) => {
      await handleScriptAction(context.targetWaypoint);
      return 'EVALUATING_WAYPOINT';
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
    if (!globalState || !isInitialized || !globalState.global?.windowId) {
      return;
    }

    const { enabled: cavebotIsEnabled, controlState } = globalState.cavebot;
    const targetingIsEnabled = globalState.targeting?.enabled;

    if (!cavebotIsEnabled) {
      if (fsmState !== 'IDLE') {
        resetInternalState();
      }
      return;
    }

    if (controlState === 'TARGETING') {
      if (!targetingIsEnabled) {
        logger('info', '[Cavebot] Targeting disabled, reclaiming control.');
        postStoreUpdate('cavebot/setControlState', 'CAVEBOT');
        resetInternalState();
      }
      if (lastControlState !== 'TARGETING') {
        resetInternalState();
      }
      lastControlState = controlState;
      return;
    }

    if (controlState === 'HANDOVER_TO_TARGETING') {
      resetInternalState();
      lastControlState = controlState;
      return;
    }

    if (lastControlState !== 'CAVEBOT' && controlState === 'CAVEBOT') {
      const { waypointIdAtTargetingStart, visitedTiles } = globalState.cavebot;
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
          const radius = config.waypointSkipRadius;

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

      postStoreUpdate('cavebot/clearVisitedTiles');

      if (skippedWaypoint) {
        lastControlState = globalState.cavebot.controlState;
        return;
      }
      // Set flag to request new path after handover
      shouldRequestNewPath = true;
    }

    // Grace period after gaining control
    if (lastControlState !== 'CAVEBOT' && controlState === 'CAVEBOT') {
      await delay(config.controlHandoverGraceMs);
    }

    updateSABData();
    if (!playerMinimapPosition) return;

    if (globalState && globalState.gameState) {
      globalState.gameState.playerMinimapPosition = playerMinimapPosition;
    } else if (globalState) {
      globalState.gameState = { playerMinimapPosition: playerMinimapPosition };
    } else {
      globalState = {
        gameState: { playerMinimapPosition: playerMinimapPosition },
      };
    }

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
      await delay(config.controlHandoverGraceMs);
    }
    const loopEnd = performance.now();
    const elapsedTime = loopEnd - loopStart;
    const delayTime = Math.max(0, config.mainLoopInterval - elapsedTime);
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
      getFreshState,
      advanceToNextWaypoint,
      goToLabel,
      goToSection,
      goToWpt,
      sharedLuaGlobals: workerData.sharedLuaGlobals,
      postGlobalVarUpdate,
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
    if (message.type === 'state_full_sync') {
      if (!globalState) globalState = {};
      Object.assign(globalState, message.payload);
    } else if (message.type === 'shutdown') {
      isShuttingDown = true;
      if (luaExecutor) luaExecutor.destroy();
    } else if (message.type === 'lua_global_broadcast') {
      const { key, value } = message.payload;
      if (workerData.sharedLuaGlobals) {
        workerData.sharedLuaGlobals[key] = value;
        logger(
          'debug',
          `[CavebotWorker] Received lua_global_broadcast: ${key} = ${value}. Current sharedLuaGlobals: ${JSON.stringify(
            workerData.sharedLuaGlobals,
          )}`,
        );
      }
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
