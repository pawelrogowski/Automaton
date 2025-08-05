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
} from './sharedConstants.js';

// --- Worker Configuration ---
const MAIN_LOOP_INTERVAL = 5;
const PERFORMANCE_LOG_INTERVAL = 10000;
const STATE_CHANGE_POLL_INTERVAL = 10;

// --- Configuration ---
const config = {
  stuckTimeThresholdMs: 600,
  stuckCooldownMs: 600,
  sorryNotPossibleLingerMs: 5000,
  thereIsNoWayLingerMs: 5000,
  keyboardFailureThreshold: 2,
  keyboardFailureWindowMs: 10000,
  useMapclicks: true,
  switchToKeyboardDistance: 4,
  mapClickMaxDistance: 30,
  mapClickPostClickDelayMs: 300,
  mapClickStandTimeThresholdMs: 600,
  standardWalkDelayMs: 0,
  approachWalkDelayMs: 300,
  approachDistanceThreshold: 3,
  moveConfirmTimeoutMs: 500,
  standWaypointDelayMs: 0,
  toolHotkeyWaitMs: 150,
  actionStateChangeTimeoutMs: 600,
  preClickDelayMs: 250,
  postUseDelayMs: 500,
  teleportDistanceThreshold: 5,
  postTeleportGraceMs: 1250,
};

// --- Worker State ---
let currentState = null;
let isShuttingDown = false;
let isInitialized = false;

// --- SAB State ---
let lastPlayerPosCounter = -1;
let lastPathDataCounter = -1;
let playerMinimapPosition = null;
let path = [];

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
let currentMapClickTarget = null;
let currentActionStatus = 'IDLE';
let contextualStandStillStartTime = null;
let lastWalkCheckPosition = null;
let stuckDetectionGraceUntil = 0;
let lastLoggedPlayerPosition = null;
let recentKeyboardFailures = []; // This was also missing in some versions
// --- FIX: Re-add the missing variable initialization ---
let lastStuckEventHandledTimestamp = 0;
// --- END FIX ---

// --- LOGGING ENHANCEMENT: State for timing ---
let lastPositionUpdateTime = null;

// --- Redux Update Throttling for Cavebot ---
const CAVEBOT_REDUX_UPDATE_INTERVAL_MS = 150;
let lastStandTimeUpdateTime = 0;
let standTimeUpdateTimeout = null;
let pendingStandTime = null;

function postThrottledStandTimeUpdate() {
  if (pendingStandTime !== null) {
    postStoreUpdate('cavebot/setStandTime', pendingStandTime);
    lastStandTimeUpdateTime = Date.now();
    pendingStandTime = null;
  }
  if (standTimeUpdateTimeout) {
    clearTimeout(standTimeUpdateTimeout);
    standTimeUpdateTimeout = null;
  }
}

function throttleStandTimeUpdate(standTime) {
  pendingStandTime = standTime;
  const now = Date.now();
  const timeSinceLastUpdate = now - lastStandTimeUpdateTime;
  if (timeSinceLastUpdate >= CAVEBOT_REDUX_UPDATE_INTERVAL_MS) {
    postThrottledStandTimeUpdate();
  } else if (!standTimeUpdateTimeout) {
    standTimeUpdateTimeout = setTimeout(
      postThrottledStandTimeUpdate,
      CAVEBOT_REDUX_UPDATE_INTERVAL_MS - timeSinceLastUpdate,
    );
  }
}

// --- Constants ---
const CavebotActionStatus = {
  IDLE: 'IDLE',
  WALKING: 'WALKING',
  USING_LADDER: 'USING_LADDER',
  USING_ROPE: 'USING_ROPE',
  USING_SHOVEL: 'USING_SHOVEL',
  USING_MACHETE: 'USING_MACHETE',
  PERFORMING_USE: 'PERFORMING_USE',
  EXECUTING_SCRIPT: 'EXECUTING_SCRIPT',
  SETTING_LURE: 'SETTING_LURE',
};

// --- Utility Functions ---
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getDistance = (p1, p2) =>
  Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
const getChebyshevDistance = (p1, p2) =>
  Math.max(Math.abs(p1.x - p2.x), Math.abs(p1.y - p2.y));
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
// --- Original logger for general messages ---
const logger = createLogger({ info: false, error: true, debug: false });
// --- LOGGING ENHANCEMENT: Dedicated logger for pathing info ---
const pathingLogger = createLogger({
  info: true,
  error: true,
  debug: false,
  prefix: '[CavebotPathing]',
});

// --- Performance Monitoring ---
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

// --- Store Communication ---
const postStoreUpdate = (type, payload) => {
  parentPort.postMessage({ storeUpdate: true, type, payload });
};

// --- State Change Detection ---
const awaitStateChange = (condition, timeoutMs) => {
  return new Promise((resolve) => {
    let intervalId = null;
    const timeoutId = setTimeout(() => {
      if (intervalId) clearInterval(intervalId);
      resolve(false);
    }, timeoutMs);
    intervalId = setInterval(() => {
      if (condition(currentState)) {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        resolve(true);
      }
    }, STATE_CHANGE_POLL_INTERVAL);
  });
};

// --- LOCKSTEP TEST: Corrected function to await updates by polling SABs directly ---
const awaitNextStep = (posCounterBeforeMove, pathCounterBeforeMove, timeoutMs) => {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      reject(new Error(`awaitNextStep timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const intervalId = setInterval(() => {
      // Poll the SABs directly to see if the counters have been updated by the other thread
      const currentPosCounter = Atomics.load(
        playerPosArray,
        PLAYER_POS_UPDATE_COUNTER_INDEX,
      );
      const currentPathCounter = Atomics.load(
        pathDataArray,
        PATH_UPDATE_COUNTER_INDEX,
      );

      const posChanged = currentPosCounter > posCounterBeforeMove;
      const pathChanged = currentPathCounter > pathCounterBeforeMove;

      if (posChanged && pathChanged) {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        resolve(true);
      }
    }, STATE_CHANGE_POLL_INTERVAL);
  });
};

// --- FIX: New helper function to explicitly wait for a new path ---
const awaitNewPath = (pathCounterBeforeAdvance, timeoutMs) => {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      resolve(false); // It's okay to fail, the main loop will retry
    }, timeoutMs);

    const intervalId = setInterval(() => {
      const currentPathCounter = Atomics.load(
        pathDataArray,
        PATH_UPDATE_COUNTER_INDEX,
      );
      if (currentPathCounter > pathCounterBeforeAdvance) {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        resolve(true);
      }
    }, STATE_CHANGE_POLL_INTERVAL);
  });
};

// --- Navigation Functions ---
// --- FIX: Made waypoint transition fully synchronous ---
const advanceToNextWaypoint = async () => {
  if (!currentState?.cavebot) return;
  const { waypointSections, currentSection, wptId } = currentState.cavebot;
  const waypoints = waypointSections[currentSection]?.waypoints || [];
  if (waypoints.length === 0) return;

  const currentIndex = waypoints.findIndex((wp) => wp.id === wptId);
  if (currentIndex === -1) return;

  const nextIndex = (currentIndex + 1) % waypoints.length;
  const nextWpt = waypoints[nextIndex];

  if (nextWpt) {
    const currentWptId = wptId;
    const pathCounterBeforeAdvance = lastPathDataCounter;

    postStoreUpdate('cavebot/setwptId', nextWpt.id);

    // 1. Wait for our local state to see the new waypoint ID.
    const wptIdChanged = await awaitStateChange(
      (state) => state.cavebot.wptId !== currentWptId,
      250,
    );

    // 2. If successful, now wait for the pathfinder to provide a path for this new waypoint.
    if (wptIdChanged) {
      await awaitNewPath(pathCounterBeforeAdvance, 500);
    }
  }
};
const goToLabel = async (label) => {
  const { waypointSections, currentSection } = currentState.cavebot;
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
  const { waypointSections } = currentState.cavebot;
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
  const { waypointSections, currentSection } = currentState.cavebot;
  const waypoints = waypointSections[currentSection]?.waypoints || [];
  if (arrayIndex < waypoints.length) {
    postStoreUpdate('cavebot/setwptId', waypoints[arrayIndex].id);
  }
};

// --- Worker Initialization ---
async function initializeWorker() {
  logger('info', 'Cavebot worker starting up...');
  try {
    luaExecutor = new CavebotLuaExecutor({
      logger,
      postStoreUpdate,
      getState: () => currentState,
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

// --- Contextual Stand Time Tracking ---
const updateContextualStandTime = (status, pos) => {
  if (status !== CavebotActionStatus.WALKING || !pos) {
    contextualStandStillStartTime = null;
    return 0;
  }
  const currentPosKey = `${pos.x},${pos.y},${pos.z}`;
  if (lastWalkCheckPosition !== currentPosKey) {
    contextualStandStillStartTime = null;
    lastWalkCheckPosition = currentPosKey;
    return 0;
  }
  if (contextualStandStillStartTime === null) {
    contextualStandStillStartTime = Date.now();
  }
  return Date.now() - contextualStandStillStartTime;
};

// --- Stuck Detection ---
const handleStuckCondition = (contextualStandTime, wptDistance) => {
  if (Date.now() < stuckDetectionGraceUntil || !currentState?.statusMessages)
    return;
  const { sorryNotPossible: sorryNotPossibleTimestamp } =
    currentState.statusMessages;
  const isSorryNotPossibleNew =
    sorryNotPossibleTimestamp &&
    sorryNotPossibleTimestamp > lastStuckEventHandledTimestamp;
  if (isSorryNotPossibleNew) {
    lastStuckEventHandledTimestamp = Date.now();
    recentKeyboardFailures.push(Date.now());
    return;
  }
  const isStuckCooldownOver =
    Date.now() - lastStuckEventHandledTimestamp > config.stuckCooldownMs;
  if (
    wptDistance > 0 &&
    contextualStandTime > config.stuckTimeThresholdMs &&
    isStuckCooldownOver
  ) {
    lastStuckEventHandledTimestamp = Date.now();
  }
};

// --- Action Handlers ---
const handleZLevelToolAction = async (toolType, targetCoords) => {
  const hotkey = currentState.settings.hotkeys[toolType.toLowerCase()];
  if (!hotkey) return false;
  const { gameWorld, tileSize } = currentState.regionCoordinates.regions;
  if (!gameWorld || !tileSize) return false;
  const initialPos = { ...playerMinimapPosition };
  keypress.sendKey(hotkey, currentState.global.display || ':0');
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
    parseInt(currentState.global.windowId, 10),
    clickCoords.x,
    clickCoords.y,
    currentState.global.display || ':0',
  );
  const zChanged = await awaitStateChange(
    (state) => state.gameState?.playerMinimapPosition?.z !== initialPos.z,
    config.actionStateChangeTimeoutMs,
  );
  if (zChanged) {
    const finalPos = currentState.gameState.playerMinimapPosition;
    if (getDistance(initialPos, finalPos) >= config.teleportDistanceThreshold) {
      stuckDetectionGraceUntil = Date.now() + config.postTeleportGraceMs;
    }
    return true;
  }
  return false;
};
const handleUseAction = async (targetCoords) => {
  await delay(config.preClickDelayMs);
  const { gameWorld, tileSize } = currentState.regionCoordinates.regions;
  if (!gameWorld || !tileSize) return false;
  const initialPos = { ...playerMinimapPosition };
  const clickCoords = getAbsoluteGameWorldClickCoordinates(
    targetCoords.x,
    targetCoords.y,
    initialPos,
    gameWorld,
    tileSize,
    'center',
  );
  if (!clickCoords) return false;
  mouseController.rightClick(
    parseInt(currentState.global.windowId, 10),
    clickCoords.x,
    clickCoords.y,
    currentState.global.display || ':0',
  );
  await delay(config.postUseDelayMs);
  return true;
};
const handleLadderAction = async (targetCoords) => {
  await delay(config.preClickDelayMs);
  const { gameWorld, tileSize } = currentState.regionCoordinates.regions;
  if (!gameWorld || !tileSize) return false;
  const initialPos = { ...playerMinimapPosition };
  const clickCoords = getAbsoluteGameWorldClickCoordinates(
    targetCoords.x,
    targetCoords.y,
    initialPos,
    gameWorld,
    tileSize,
    'bottomRight',
  );
  if (!clickCoords) return false;
  mouseController.rightClick(
    parseInt(currentState.global.windowId, 10),
    clickCoords.x,
    clickCoords.y,
    currentState.global.display || ':0',
  );
  const zChanged = await awaitStateChange(
    (state) => state.gameState?.playerMinimapPosition?.z !== initialPos.z,
    config.actionStateChangeTimeoutMs,
  );
  if (zChanged) {
    const finalPos = currentState.gameState.playerMinimapPosition;
    if (getDistance(initialPos, finalPos) >= config.teleportDistanceThreshold) {
      stuckDetectionGraceUntil = Date.now() + config.postTeleportGraceMs;
    }
    return true;
  }
  return false;
};
const handleScriptAction = async (targetWpt) => {
  currentActionStatus = CavebotActionStatus.EXECUTING_SCRIPT;
  if (!luaExecutor || !luaExecutor.isInitialized) {
    await advanceToNextWaypoint();
    return;
  }
  const result = await luaExecutor.executeScript(targetWpt.script);
  if (result.success && !result.navigationOccurred) {
    await advanceToNextWaypoint();
  }
};
// --- REFACTOR: Overhauled Stand action for Z-level changes and teleports ---
const handleStandAction = async (targetWaypoint) => {
  const initialPos = { ...playerMinimapPosition };
  const moveKey = getDirectionKey(initialPos, targetWaypoint);
  if (!moveKey) return false;

  keypress.sendKey(moveKey, currentState.global.display || ':0');

  // Wait for a significant position change (Z-level or teleport) with a generous timeout.
  const positionChanged = await awaitStateChange((state) => {
    const newPos = state.gameState?.playerMinimapPosition;
    if (!newPos) return false;
    // Condition is true if Z-level changes OR if we moved a large distance on the same floor.
    return (
      newPos.z !== initialPos.z ||
      getDistance(initialPos, newPos) >= config.teleportDistanceThreshold
    );
  }, 1500); // Use the requested 1500ms timeout.

  if (positionChanged) {
    const finalPos = currentState.gameState.playerMinimapPosition;
    // If the move was a teleport, apply a grace period to prevent stuck detection.
    if (getDistance(initialPos, finalPos) >= config.teleportDistanceThreshold) {
      stuckDetectionGraceUntil = Date.now() + config.postTeleportGraceMs;
    }
    return true;
  }

  // If the timeout is reached and nothing happened, the action failed.
  return false;
};

// --- LOCKSTEP TEST: Modified walk action ---
const handleWalkAction = async (currentPath, chebyshevDistance) => {
  currentActionStatus = CavebotActionStatus.WALKING;

  // FORCING KEYBOARD FOR LOCKSTEP TEST
  const shouldUseKeyboard = true;

  if (shouldUseKeyboard) {
    const nextStep = currentPath[0];
    const positionBeforeMove = { ...playerMinimapPosition };
    const moveKey = getDirectionKey(positionBeforeMove, nextStep);

    if (!moveKey) {
      await delay(20); // Safety delay if no move key can be determined
      return;
    }

    // Capture the state of the counters BEFORE we make the move
    const posCounterBeforeMove = lastPlayerPosCounter;
    const pathCounterBeforeMove = lastPathDataCounter;

    keypress.sendKey(moveKey, currentState.global.display || ':0');

    try {
      // Wait for the game to update position and for the pathfinder to provide a new path
      pathingLogger('info', `Step sent. Waiting for pos & path update...`);
      await awaitNextStep(posCounterBeforeMove, pathCounterBeforeMove, 2000); // 2-second timeout
      pathingLogger('info', `Update received. Proceeding.`);
    } catch (error) {
      pathingLogger('error', `Walk step failed: ${error.message}`);
      recentKeyboardFailures.push(Date.now());
    }
  }
  // The map-click logic is intentionally bypassed for this test.
};

// --- Main Operation ---
async function performOperation() {
  if (!isInitialized || !currentState) return;
  const opStart = performance.now();
  try {
    if (
      !currentState.global?.windowId ||
      !currentState.regionCoordinates?.regions?.onlineMarker
    ) {
      currentActionStatus = CavebotActionStatus.IDLE;
      return;
    }
    if (playerPosArray) {
      const newPlayerPosCounter = Atomics.load(
        playerPosArray,
        PLAYER_POS_UPDATE_COUNTER_INDEX,
      );
      if (newPlayerPosCounter > lastPlayerPosCounter) {
        lastPositionUpdateTime = performance.now();
        playerMinimapPosition = {
          x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
          y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
          z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
        };
        pathingLogger(
          'info',
          `Received new player position: { x: ${playerMinimapPosition.x}, y: ${playerMinimapPosition.y}, z: ${playerMinimapPosition.z} }`,
        );
        lastPlayerPosCounter = newPlayerPosCounter;
      }
    }
    if (!playerMinimapPosition) {
      await delay(20);
      return;
    }
    if (pathDataArray) {
      const newPathDataCounter = Atomics.load(
        pathDataArray,
        PATH_UPDATE_COUNTER_INDEX,
      );
      if (newPathDataCounter > lastPathDataCounter) {
        const lastPathUpdateTime = performance.now();
        const pathLength = Atomics.load(pathDataArray, PATH_LENGTH_INDEX);
        const newPath = [];
        for (let i = 0; i < pathLength; i++) {
          const offset = PATH_WAYPOINTS_START_INDEX + i * PATH_WAYPOINT_SIZE;
          newPath.push({
            x: Atomics.load(pathDataArray, offset + 0),
            y: Atomics.load(pathDataArray, offset + 1),
            z: Atomics.load(pathDataArray, offset + 2),
          });
        }
        path = newPath;
        lastPathDataCounter = newPathDataCounter;

        pathingLogger('info', `Received new path. Length: ${pathLength}`);
        if (lastPositionUpdateTime) {
          const timeDiff = lastPathUpdateTime - lastPositionUpdateTime;
          pathingLogger(
            'info',
            `Path received ${timeDiff.toFixed(
              2,
            )}ms after position update.`,
          );
          lastPositionUpdateTime = null; // Reset to prevent stale calculations
        }
      }
    }
    if (!currentState.cavebot?.enabled) {
      currentActionStatus = CavebotActionStatus.IDLE;
      return;
    }
    if (
      !lastLoggedPlayerPosition ||
      playerMinimapPosition.x !== lastLoggedPlayerPosition.x ||
      playerMinimapPosition.y !== lastLoggedPlayerPosition.y ||
      playerMinimapPosition.z !== lastLoggedPlayerPosition.z
    ) {
      lastLoggedPlayerPosition = { ...playerMinimapPosition };
    }
    const { waypointSections, currentSection, wptId } = currentState.cavebot;
    let targetWaypoint = waypointSections[currentSection]?.waypoints.find(
      (wp) => wp.id === wptId,
    );
    if (!targetWaypoint) {
      const firstSectionWithWaypoints = Object.keys(waypointSections).find(
        (sectionId) => waypointSections[sectionId]?.waypoints?.length > 0,
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
          targetWaypoint = firstWaypoint;
        }
      }
    }
    if (!targetWaypoint) {
      await delay(20);
      return;
    }
    const contextualStandTime = updateContextualStandTime(
      currentActionStatus,
      playerMinimapPosition,
    );
    throttleStandTimeUpdate(contextualStandTime);
    if (targetWaypoint.type === 'Script') {
      await handleScriptAction(targetWaypoint);
      await delay(5);
      return;
    }
    if (playerMinimapPosition.z !== targetWaypoint.z) {
      postStoreUpdate('cavebot/setPathfindingFeedback', {
        pathWaypoints: [],
        wptDistance: null,
        pathfindingStatus: 'DIFFERENT_FLOOR',
      });
      await advanceToNextWaypoint();
      return;
    }
    const pathDistance = path.length;
    const pathfindingStatus =
      pathDistance > 0 ? 'PATH_FOUND' : 'WAYPOINT_REACHED';
    if (pathfindingStatus === 'NO_PATH_FOUND') {
      await advanceToNextWaypoint();
      return;
    }
    handleStuckCondition(contextualStandTime, pathDistance);
    postStoreUpdate('cavebot/setActionPaused', true);

    let actionSucceeded = false;
    let reasonForSuccess = 'No success condition met';

    currentActionStatus = CavebotActionStatus.IDLE;
    const chebyshevDistance = getChebyshevDistance(
      playerMinimapPosition,
      targetWaypoint,
    );

    if (
      targetWaypoint.type === 'Node' &&
      chebyshevDistance <= targetWaypoint.range - 1
    ) {
      actionSucceeded = true;
      reasonForSuccess = `Node reached (distance: ${chebyshevDistance}, range: ${targetWaypoint.range})`;
    } else if (targetWaypoint.type === 'Lure' && pathDistance === 0) {
      currentActionStatus = CavebotActionStatus.SETTING_LURE;
      actionSucceeded = true;
      reasonForSuccess = 'Lure waypoint reached';
    } else if (
      ['Shovel', 'Machete', 'Rope'].includes(targetWaypoint.type) &&
      pathDistance === 0
    ) {
      currentActionStatus =
        CavebotActionStatus[`USING_${targetWaypoint.type.toUpperCase()}`];
      actionSucceeded = await handleZLevelToolAction(
        targetWaypoint.type,
        playerMinimapPosition,
      );
      if (actionSucceeded) {
        reasonForSuccess = `Used ${targetWaypoint.type} successfully`;
      }
    } else if (targetWaypoint.type === 'Use' && pathDistance === 1) {
      currentActionStatus = CavebotActionStatus.PERFORMING_USE;
      actionSucceeded = await handleUseAction(targetWaypoint);
      if (actionSucceeded) {
        reasonForSuccess = 'Use action succeeded';
      }
    } else if (
      targetWaypoint.type === 'Stand' &&
      chebyshevDistance === 1
    ) {
      currentActionStatus = CavebotActionStatus.IDLE;
      actionSucceeded = await handleStandAction(targetWaypoint);
      if (actionSucceeded) {
        reasonForSuccess = 'Stand action succeeded (Z/Teleport detected)';
      }
    } else if (targetWaypoint.type === 'Ladder' && pathDistance <= 1) {
      currentActionStatus = CavebotActionStatus.USING_LADDER;
      const target =
        pathDistance === 0 ? playerMinimapPosition : targetWaypoint;
      actionSucceeded = await handleLadderAction(target);
      if (actionSucceeded) {
        reasonForSuccess = 'Ladder action succeeded';
      }
    } else if (path && path.length > 0) {
      currentActionStatus = CavebotActionStatus.WALKING;
      postStoreUpdate('cavebot/setActionPaused', false);
      await handleWalkAction(path, chebyshevDistance);
    } else if (
      pathfindingStatus === 'WAYPOINT_REACHED' &&
      targetWaypoint.type !== 'Stand'
    ) {
      actionSucceeded = true;
      reasonForSuccess = 'Pathfinding status is WAYPOINT_REACHED';
    }

    if (actionSucceeded) {
      pathingLogger(
        'info',
        `SUCCESS: Advancing from waypoint ${targetWaypoint.id} (${
          targetWaypoint.type
        }). Reason: ${reasonForSuccess}. Pos: {${playerMinimapPosition.x},${
          playerMinimapPosition.y
        },${playerMinimapPosition.z}}`,
      );
      if (currentMapClickTarget) currentMapClickTarget = null;
      await advanceToNextWaypoint();
    } else {
      await delay(5);
    }
  } catch (error) {
    logger('error', '[CavebotWorker] Error in operation:', error);
  } finally {
    const opEnd = performance.now();
    operationCount++;
    totalOperationTime += opEnd - opStart;
  }
}

// --- Main Loop ---
async function mainLoop() {
  logger('info', '[CavebotWorker] Starting main loop...');
  while (!isShuttingDown) {
    const loopStart = performance.now();
    try {
      await performOperation();
      logPerformanceStats();
    } catch (error) {
      logger('error', '[CavebotWorker] Error in main loop:', error);
      await delay(Math.max(MAIN_LOOP_INTERVAL * 2, 100));
      continue;
    }
    const loopEnd = performance.now();
    const elapsedTime = loopEnd - loopStart;
    const delayTime = Math.max(0, MAIN_LOOP_INTERVAL - elapsedTime);
    if (delayTime > 0) await delay(delayTime);
  }
  logger('info', '[CavebotWorker] Main loop stopped.');
}

// --- Message Handler ---
parentPort.on('message', (message) => {
  try {
    if (message.type === 'state_diff') {
      if (!currentState) currentState = {};
      Object.assign(currentState, message.payload);
    } else if (message.type === 'shutdown') {
      isShuttingDown = true;
      if (luaExecutor) luaExecutor.destroy();
    } else if (message.type === 'script-finished') {
      // empty
    } else if (typeof message === 'object' && !message.type) {
      if (!currentState) currentState = message;
      else Object.assign(currentState, message);
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

// --- Graceful Shutdown ---
parentPort.on('close', () => {
  isShuttingDown = true;
  if (luaExecutor) luaExecutor.destroy();
  process.exit(0);
});

// --- Worker Startup ---
async function startWorker() {
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

// --- Worker Data Validation ---
function validateWorkerData() {
  if (!workerData) throw new Error('[CavebotWorker] Worker data not provided');
  if (!workerData.paths)
    logger(
      'warn',
      '[CavebotWorker] Paths not provided in worker data, using defaults',
    );
}

// Initialize and start the worker
try {
  validateWorkerData();
  startWorker();
} catch (error) {
  logger('error', '[CavebotWorker] Failed to start worker:', error);
  process.exit(1);
}