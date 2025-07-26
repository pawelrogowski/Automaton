import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import Pathfinder from 'pathfinder-native';
import keypress from 'keypress-native';
import mouseController from 'mouse-controller';
import { getAbsoluteClickCoordinates } from '../utils/minimapClickTranslator.js';
import { getAbsoluteGameWorldClickCoordinates } from '../utils/gameWorldClickTranslator.js';
import { createLogger } from '../utils/logger.js';
import { CavebotLuaExecutor } from './cavebotLuaExecutor.js';

// --- Worker Configuration ---
const MAIN_LOOP_INTERVAL = 5; // 200fps main loop for responsiveness
const PERFORMANCE_LOG_INTERVAL = 10000; // Log performance every 10 seconds
const STATE_CHANGE_POLL_INTERVAL = 10; // Poll state changes every 10ms

// --- Configuration ---
const config = {
  stuckTimeThresholdMs: 600,
  stuckCooldownMs: 600,
  sorryNotPossibleLingerMs: 5000,
  thereIsNoWayLingerMs: 5000,
  keyboardFailureThreshold: 2,
  keyboardFailureWindowMs: 10000,
  tempBlockMinLifetimeMs: 5000,
  tempBlockMaxLifetimeMs: 20000,
  tempBlockMsPerStep: 800,
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

// --- Performance Tracking ---
let operationCount = 0;
let totalOperationTime = 0;
let lastPerfReport = Date.now();

// --- Cavebot Specific State ---
let pathfinderInstance;
let pathfinderLoaded = false;
let lastSpecialAreasJson = '';
let temporaryBlocks = [];
let lastStuckEventHandledTimestamp = 0;
let recentKeyboardFailures = [];
let luaExecutor = null;
let currentMapClickTarget = null;
let currentActionStatus = 'IDLE';
let contextualStandStillStartTime = null;
let lastWalkCheckPosition = null;
let stuckDetectionGraceUntil = 0;
let lastLoggedPlayerPosition = null;

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

const logger = createLogger({ info: false, error: true, debug: false });

// --- Performance Monitoring ---
function logPerformanceStats() {
  const now = Date.now();
  const timeSinceLastReport = now - lastPerfReport;

  if (timeSinceLastReport >= PERFORMANCE_LOG_INTERVAL) {
    const avgOpTime =
      operationCount > 0 ? (totalOperationTime / operationCount).toFixed(2) : 0;
    const opsPerSecond = (
      (operationCount / timeSinceLastReport) *
      1000
    ).toFixed(1);

    logger(
      'info',
      `[CavebotWorker] Performance: ${opsPerSecond} ops/sec, avg: ${avgOpTime}ms`,
    );

    // Reset counters
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

// --- Navigation Functions ---
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
    logger(
      'info',
      `Advancing to next target: ${nextWpt.label || nextWpt.type} (${nextWpt.id})`,
    );
    postStoreUpdate('cavebot/setwptId', nextWpt.id);
  }
  await delay(50);
};

const goToLabel = async (label) => {
  logger(
    'info',
    `Attempting to jump to label within current section: "${label}"`,
  );
  const { waypointSections, currentSection } = currentState.cavebot;
  const currentWaypoints = waypointSections[currentSection].waypoints;
  const targetWpt = currentWaypoints.find((wpt) => wpt.label === label);

  if (targetWpt) {
    logger(
      'info',
      `Found waypoint with label "${label}". Jumping to ID: ${targetWpt.id}`,
    );
    postStoreUpdate('cavebot/setwptId', targetWpt.id);
  } else {
    logger(
      'warn',
      `No waypoint found with label: "${label}" in section "${currentSection}". Continuing sequence.`,
    );
    await advanceToNextWaypoint();
  }
};

const goToSection = async (sectionName) => {
  logger('info', `Attempting to jump to section: "${sectionName}"`);
  const { waypointSections } = currentState.cavebot;
  const foundEntry = Object.entries(waypointSections).find(
    ([, section]) => section.name === sectionName,
  );

  if (foundEntry) {
    const [targetSectionId, targetSection] = foundEntry;
    if (targetSection.waypoints && targetSection.waypoints.length > 0) {
      const firstWpt = targetSection.waypoints[0];
      logger(
        'info',
        `Found section "${sectionName}". Jumping to its first waypoint: ${firstWpt.id}`,
      );
      postStoreUpdate('cavebot/setCurrentWaypointSection', targetSectionId);
      postStoreUpdate('cavebot/setwptId', firstWpt.id);
    } else {
      logger(
        'warn',
        `Section "${sectionName}" was found but is empty. Cannot jump. Continuing sequence.`,
      );
      await advanceToNextWaypoint();
    }
  } else {
    logger(
      'warn',
      `No section found with name: "${sectionName}". Continuing sequence.`,
    );
    await advanceToNextWaypoint();
  }
};

const goToWpt = async (index) => {
  const userIndex = parseInt(index, 10);
  if (isNaN(userIndex) || userIndex < 1) {
    logger(
      'warn',
      `goToWpt received an invalid index: ${index}. Must be a number >= 1.`,
    );
    return;
  }

  const arrayIndex = userIndex - 1;
  const { waypointSections, currentSection } = currentState.cavebot;
  const waypoints = waypointSections[currentSection]?.waypoints || [];

  if (arrayIndex < waypoints.length) {
    const targetWpt = waypoints[arrayIndex];
    logger(
      'info',
      `Jumping to waypoint index ${userIndex} (ID: ${targetWpt.id})`,
    );
    postStoreUpdate('cavebot/setwptId', targetWpt.id);
  } else {
    logger(
      'warn',
      `goToWpt received an out-of-bounds index: ${userIndex}. Section only has ${waypoints.length} waypoints.`,
    );
  }
};

// --- Worker Initialization ---
async function initializeWorker() {
  logger('info', 'Cavebot worker starting up...');

  try {
    pathfinderInstance = new Pathfinder.Pathfinder();
    logger('info', 'Native Pathfinder addon loaded successfully.');
  } catch (e) {
    logger(
      'error',
      `FATAL: Failed to load native Pathfinder module: ${e.message}`,
    );
    parentPort.postMessage({
      fatalError: `Pathfinder addon failed: ${e.message}`,
    });
    process.exit(1);
  }

  logger('info', 'Loading pathfinding data for all Z-levels...');
  const mapDataForAddon = {};

  try {
    const PREPROCESSED_BASE_DIR =
      workerData?.paths?.minimapResources ||
      path.join(process.cwd(), 'resources', 'preprocessed_minimaps');

    const zLevelDirs = fs
      .readdirSync(PREPROCESSED_BASE_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('z'))
      .map((d) => d.name);

    for (const zDir of zLevelDirs) {
      const zLevel = parseInt(zDir.substring(1), 10);
      const zLevelPath = path.join(PREPROCESSED_BASE_DIR, zDir);

      try {
        const metadata = JSON.parse(
          fs.readFileSync(path.join(zLevelPath, 'walkable.json'), 'utf8'),
        );
        const grid = fs.readFileSync(path.join(zLevelPath, 'walkable.bin'));
        mapDataForAddon[zLevel] = { ...metadata, grid };
      } catch (e) {
        if (e.code !== 'ENOENT') {
          logger(
            'warn',
            `Could not load pathfinding data for Z=${zLevel}: ${e.message}`,
          );
        }
      }
    }

    pathfinderInstance.loadMapData(mapDataForAddon);

    if (pathfinderInstance.isLoaded) {
      pathfinderLoaded = true;
      logger('info', 'Pathfinding data successfully loaded.');
    } else {
      logger(
        'error',
        'Failed to load data into native module. Worker will not function.',
      );
    }
  } catch (e) {
    logger('error', `Critical error during map data loading: ${e.message}`);
    parentPort.postMessage({
      fatalError: 'Failed to load pathfinding map data.',
    });
    process.exit(1);
  }

  logger('info', 'Initializing Cavebot Lua Executor...');
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

    const initialized = await luaExecutor.initialize();
    if (!initialized) {
      throw new Error('LuaExecutor failed to initialize.');
    }
    logger('info', 'Cavebot Lua Executor initialized successfully.');
  } catch (e) {
    logger('error', `Could not initialize Cavebot Lua Executor: ${e.message}`);
    luaExecutor = null;
  }

  isInitialized = true;
  logger('info', 'Cavebot worker initialization complete.');
}

// --- Contextual Stand Time Tracking ---
const updateContextualStandTime = (status, playerPos) => {
  if (status !== CavebotActionStatus.WALKING) {
    contextualStandStillStartTime = null;
    return 0;
  }

  const currentPosKey = `${playerPos.x},${playerPos.y},${playerPos.z}`;
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

// --- Temporary Block Management ---
const applyTemporaryBlock = (blockedTile, reason) => {
  if (blockedTile) {
    logger(
      'info',
      `${reason} at [${blockedTile.x},${blockedTile.y}]. Applying temporary obstacle.`,
    );
    const newBlock = {
      id: uuidv4(),
      x: blockedTile.x,
      y: blockedTile.y,
      z: blockedTile.z,
      sizeX: 1,
      sizeY: 1,
      avoidance: 9999,
      type: 'cavebot',
      enabled: true,
      timerSet: false,
    };
    temporaryBlocks.push(newBlock);
    lastStuckEventHandledTimestamp = Date.now();
  }
};

// --- Stuck Detection ---
const handleStuckCondition = (contextualStandTime, wptDistance) => {
  if (Date.now() < stuckDetectionGraceUntil || !currentState?.statusMessages) {
    return;
  }

  const { sorryNotPossible: sorryNotPossibleTimestamp } =
    currentState.statusMessages;
  const isSorryNotPossibleNew =
    sorryNotPossibleTimestamp &&
    sorryNotPossibleTimestamp > lastStuckEventHandledTimestamp;

  if (isSorryNotPossibleNew) {
    const blockedTile = currentState.cavebot.pathWaypoints?.[0];
    applyTemporaryBlock(blockedTile, "'Sorry, not possible' message detected");
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
    const blockedTile = currentState.cavebot.pathWaypoints?.[0];
    applyTemporaryBlock(blockedTile, 'Bot is physically stuck');
  }
};

// --- Pathfinding ---
const runPathfinding = (playerPos, targetWaypoint) => {
  const permanentAreas = (currentState.cavebot?.specialAreas || []).filter(
    (area) => area.enabled,
  );
  const allRelevantAreas = [...permanentAreas, ...temporaryBlocks];
  const newSpecialAreasJson = JSON.stringify(allRelevantAreas);

  if (newSpecialAreasJson !== lastSpecialAreasJson) {
    logger('info', `Special areas have changed. Updating native cache...`);
    const areasForNative = allRelevantAreas.map((area) => ({
      x: area.x,
      y: area.y,
      z: area.z,
      avoidance: area.avoidance,
      width: area.sizeX,
      height: area.sizeY,
    }));
    pathfinderInstance.updateSpecialAreas(areasForNative, playerPos.z);
    lastSpecialAreasJson = newSpecialAreasJson;
    logger('info', 'Native cache updated.');
  }

  const result = pathfinderInstance.findPathSync(
    playerPos,
    { x: targetWaypoint.x, y: targetWaypoint.y, z: targetWaypoint.z },
    { waypointType: targetWaypoint.type },
  );

  const path = result.path || [];

  // Set timers for temporary blocks
  temporaryBlocks.forEach((block) => {
    if (!block.timerSet) {
      const estimatedTime = path.length * config.tempBlockMsPerStep;
      const timeout = Math.max(
        config.tempBlockMinLifetimeMs,
        Math.min(estimatedTime, config.tempBlockMaxLifetimeMs),
      );

      logger(
        'info',
        `New path length is ${path.length}. Setting temporary block lifetime to ${timeout}ms.`,
      );

      setTimeout(() => {
        temporaryBlocks = temporaryBlocks.filter((b) => b.id !== block.id);
        logger(
          'info',
          `Dynamic timer expired for block at ${block.x},${block.y}.`,
        );
      }, timeout);

      block.timerSet = true;
    }
  });

  const distance =
    result.reason === 'NO_PATH_FOUND'
      ? null
      : path.length > 0
        ? path.length
        : result.reason === 'WAYPOINT_REACHED'
          ? 0
          : null;

  postStoreUpdate('cavebot/setPathfindingFeedback', {
    pathWaypoints: path,
    wptDistance: distance,
    routeSearchMs: result.performance.totalTimeMs,
    pathfindingStatus: result.reason,
  });

  return { path, distance, status: result.reason };
};

// --- Action Handlers ---
const handleZLevelToolAction = async (toolType, targetCoords) => {
  const hotkey = currentState.settings.hotkeys[toolType.toLowerCase()];
  if (!hotkey) {
    logger('error', `No hotkey configured for tool: ${toolType}`);
    return false;
  }

  const { gameWorld, tileSize } = currentState.regionCoordinates.regions;
  if (!gameWorld || !tileSize) {
    logger(
      'error',
      'Game world region or tile size not yet detected. Cannot perform click action.',
    );
    return false;
  }

  const initialPos = { ...currentState.gameState.playerMinimapPosition };
  logger(
    'info',
    `Attempting to use ${toolType} on tile [${targetCoords.x}, ${targetCoords.y}]...`,
  );

  keypress.sendKey(
    parseInt(currentState.global.windowId, 10),
    hotkey,
    currentState.global.display || ':0',
  );
  await delay(config.toolHotkeyWaitMs);
  await delay(config.preClickDelayMs);

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
      logger(
        'info',
        `Teleport detected after ${toolType} action. Activating grace period.`,
      );
      stuckDetectionGraceUntil = Date.now() + config.postTeleportGraceMs;
    } else {
      logger('info', `${toolType} action successful (local Z change).`);
    }
    return true;
  } else {
    logger(
      'warn',
      `Z-level did not change after using ${toolType}. Will retry on next loop.`,
    );
    return false;
  }
};

const handleUseAction = async (targetCoords) => {
  await delay(config.preClickDelayMs);
  const { gameWorld, tileSize } = currentState.regionCoordinates.regions;
  if (!gameWorld || !tileSize) {
    logger(
      'error',
      'Game world region or tile size not yet detected. Cannot perform click action.',
    );
    return false;
  }

  const initialPos = { ...currentState.gameState.playerMinimapPosition };
  const clickCoords = getAbsoluteGameWorldClickCoordinates(
    targetCoords.x,
    targetCoords.y,
    initialPos,
    gameWorld,
    tileSize,
    'center',
  );
  if (!clickCoords) return false;

  logger('info', `Using tile [${targetCoords.x}, ${targetCoords.y}]`);
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
  if (!gameWorld || !tileSize) {
    logger(
      'error',
      'Game world region or tile size not yet detected. Cannot perform click action.',
    );
    return false;
  }

  const initialPos = { ...currentState.gameState.playerMinimapPosition };
  const clickCoords = getAbsoluteGameWorldClickCoordinates(
    targetCoords.x,
    targetCoords.y,
    initialPos,
    gameWorld,
    tileSize,
    'bottomRight',
  );
  if (!clickCoords) return false;

  logger(
    'info',
    `Attempting to use ladder at [${targetCoords.x}, ${targetCoords.y}]...`,
  );
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
      logger(
        'info',
        'Teleport detected after Ladder action. Activating grace period.',
      );
      stuckDetectionGraceUntil = Date.now() + config.postTeleportGraceMs;
    } else {
      logger('info', 'Ladder action successful (local Z change).');
    }
    return true;
  } else {
    logger(
      'warn',
      `Z-level did not change after using ladder. Will retry on next loop.`,
    );
    return false;
  }
};

const handleScriptAction = async (targetWpt) => {
  const { label } = targetWpt;
  logger('info', `Executing Script waypoint [${label}].`);
  currentActionStatus = CavebotActionStatus.EXECUTING_SCRIPT;

  if (!luaExecutor || !luaExecutor.isInitialized) {
    logger('error', 'Cannot execute script: Lua executor is not available.');
    await advanceToNextWaypoint();
    return;
  }

  const result = await luaExecutor.executeScript(targetWpt.script);
  if (result.success && !result.navigationOccurred) {
    logger(
      'info',
      `Script for [${label}] completed without navigation. Advancing to next waypoint.`,
    );
    await advanceToNextWaypoint();
  } else if (result.navigationOccurred) {
    logger(
      'info',
      `Script for [${label}] completed and handled its own navigation.`,
    );
  } else if (!result.success) {
    logger('error', `Script for waypoint [${label}] failed: ${result.error}`);
  }
};

const handleStandAction = async (targetWaypoint) => {
  const initialPos = { ...currentState.gameState.playerMinimapPosition };
  const moveKey = getDirectionKey(initialPos, targetWaypoint);
  if (!moveKey) {
    logger(
      'error',
      `Could not determine move key for Stand action, though adjacent.`,
    );
    return false;
  }

  logger(
    'info',
    `Attempting to step on Stand waypoint at [${targetWaypoint.x}, ${targetWaypoint.y}], monitoring for position change...`,
  );
  keypress.sendKey(
    parseInt(currentState.global.windowId, 10),
    moveKey,
    currentState.global.display || ':0',
  );
  await delay(config.approachWalkDelayMs);

  const positionChanged = await awaitStateChange((state) => {
    const newPos = state.gameState?.playerMinimapPosition;
    if (!newPos) return false;
    if (newPos.z !== initialPos.z) return true;
    if (getDistance(initialPos, newPos) >= config.teleportDistanceThreshold)
      return true;
    return false;
  }, config.actionStateChangeTimeoutMs);

  if (positionChanged) {
    const finalPos = currentState.gameState.playerMinimapPosition;
    if (getDistance(initialPos, finalPos) >= config.teleportDistanceThreshold) {
      logger(
        'info',
        'Teleport detected after Stand action. Activating grace period.',
      );
      stuckDetectionGraceUntil = Date.now() + config.postTeleportGraceMs;
    } else {
      logger('info', 'Stand action successful (local position change).');
    }
    return true;
  } else {
    logger(
      'warn',
      'Position did not change after stepping on Stand waypoint. Will retry.',
    );
    return false;
  }
};

const handleWalkAction = async (path, chebyshevDistance) => {
  currentActionStatus = CavebotActionStatus.WALKING;
  const { playerMinimapPosition } = currentState.gameState;
  const minimapRegionDef = currentState.regionCoordinates?.regions?.minimapFull;
  const { thereIsNoWay: thereIsNoWayTimestamp } = currentState.statusMessages;

  const isThereIsNoWayRecent =
    thereIsNoWayTimestamp &&
    Date.now() - thereIsNoWayTimestamp < config.thereIsNoWayLingerMs;

  const isStuckByTime =
    currentState.cavebot.standTime > config.mapClickStandTimeThresholdMs;

  recentKeyboardFailures = recentKeyboardFailures.filter(
    (ts) => Date.now() - ts < config.keyboardFailureWindowMs,
  );

  if (currentMapClickTarget && (isStuckByTime || isThereIsNoWayRecent)) {
    logger(
      'warn',
      `Cancelling current map click walk. Reason: ${isThereIsNoWayRecent ? "'There is no way.' message" : 'Character is not moving'}.`,
    );
    currentMapClickTarget = null;
  }

  let shouldUseKeyboard;
  let reason = '';
  if (isThereIsNoWayRecent) {
    shouldUseKeyboard = true;
    reason = 'recent "There is no way" event';
  } else if (recentKeyboardFailures.length >= config.keyboardFailureThreshold) {
    shouldUseKeyboard = false;
    reason = `multiple keyboard failures (${recentKeyboardFailures.length})`;
  } else {
    shouldUseKeyboard =
      !config.useMapclicks ||
      chebyshevDistance < config.switchToKeyboardDistance;
    reason = shouldUseKeyboard ? 'target is too close' : 'target is far';
  }

  if (shouldUseKeyboard) {
    if (currentMapClickTarget) {
      logger('info', 'Switching from map click to keyboard movement.');
      currentMapClickTarget = null;
    }
    logger('info', `Using keyboard movement. Reason: ${reason}.`);
    const nextStep = path[0];
    const positionBeforeMove = { ...playerMinimapPosition };
    const moveKey = getDirectionKey(positionBeforeMove, nextStep);
    if (!moveKey) {
      logger('warn', 'Could not determine move key for next step. Waiting.');
      await delay(20);
      return;
    }

    const walkDelay =
      chebyshevDistance <= config.approachDistanceThreshold
        ? config.approachWalkDelayMs
        : config.standardWalkDelayMs;

    keypress.sendKey(
      parseInt(currentState.global.windowId, 10),
      moveKey,
      currentState.global.display || ':0',
    );
    await delay(walkDelay);

    const moveConfirmed = await awaitStateChange(
      (state) =>
        state.gameState?.playerMinimapPosition?.x !== positionBeforeMove.x ||
        state.gameState?.playerMinimapPosition?.y !== positionBeforeMove.y,
      config.moveConfirmTimeoutMs,
    );

    if (moveConfirmed) {
      if (recentKeyboardFailures.length > 0) {
        logger('info', 'Keyboard move successful. Resetting failure counter.');
        recentKeyboardFailures = [];
      }
    } else {
      logger(
        'warn',
        `Keyboard move to [${nextStep.x},${nextStep.y}] was not confirmed. Immediately treating as stuck.`,
      );
      applyTemporaryBlock(nextStep, 'Failed keyboard move');
      recentKeyboardFailures.push(Date.now());
    }
    return;
  }

  if (currentMapClickTarget) {
    logger('debug', 'Map click walk is in progress. Monitoring movement.');
    await delay(100);
    return;
  }

  logger('info', `Initiating new map click movement. Reason: ${reason}.`);

  // Find the furthest tile on the path that is reachable via a single map click
  let furthestReachableTile = null;
  let furthestReachableTileIndex = -1;
  for (let i = 0; i < path.length; i++) {
    if (
      getChebyshevDistance(playerMinimapPosition, path[i]) <=
      config.mapClickMaxDistance
    ) {
      furthestReachableTile = path[i];
      furthestReachableTileIndex = i;
    } else {
      break; // Path is sorted by distance, so we can stop once a tile is out of range
    }
  }

  if (!furthestReachableTile) {
    logger('error', 'Could not determine a map click target on the path.');
    return;
  }

  let clickTargetWaypoint = furthestReachableTile;

  // If the furthest reachable tile is the actual last tile of the path, click the one before it
  const isLastTileOfPath = furthestReachableTileIndex === path.length - 1;
  if (isLastTileOfPath && path.length > 1) {
    clickTargetWaypoint = path[path.length - 2];
    logger(
      'info',
      `Final target is within range; clicking tile before last to ensure arrival: [${clickTargetWaypoint.x}, ${clickTargetWaypoint.y}]`,
    );
  }

  const clickCoords = getAbsoluteClickCoordinates(
    clickTargetWaypoint.x,
    clickTargetWaypoint.y,
    playerMinimapPosition,
    minimapRegionDef,
  );

  if (!clickCoords) {
    logger(
      'error',
      `Could not get absolute click coordinates for ${clickTargetWaypoint.x},${clickTargetWaypoint.y}.`,
    );
    return;
  }

  logger(
    'debug',
    `Clicking map at ${clickCoords.x},${clickCoords.y} (target tile ${clickTargetWaypoint.x},${clickTargetWaypoint.y}).`,
  );
  currentMapClickTarget = clickTargetWaypoint;
  mouseController.leftClick(
    parseInt(currentState.global.windowId, 10),
    clickCoords.x,
    clickCoords.y,
    currentState.global.display || ':0',
  );
  await delay(config.mapClickPostClickDelayMs);
};

// --- Main Operation ---
async function performOperation() {
  if (!isInitialized || !currentState) {
    return;
  }

  const opStart = performance.now();

  try {
    // Check basic requirements
    if (
      !currentState.global?.windowId ||
      !currentState.cavebot?.enabled ||
      !pathfinderLoaded
    ) {
      currentActionStatus = CavebotActionStatus.IDLE;
      return;
    }

    // Check if user is online
    if (!currentState.regionCoordinates?.regions?.onlineMarker) {
      currentActionStatus = CavebotActionStatus.IDLE;
      await delay(100);
      return;
    }

    const { playerMinimapPosition } = currentState.gameState;

    // Log position changes
    if (
      playerMinimapPosition &&
      (!lastLoggedPlayerPosition ||
        playerMinimapPosition.x !== lastLoggedPlayerPosition.x ||
        playerMinimapPosition.y !== lastLoggedPlayerPosition.y ||
        playerMinimapPosition.z !== lastLoggedPlayerPosition.z)
    ) {
      const dx = lastLoggedPlayerPosition
        ? playerMinimapPosition.x - lastLoggedPlayerPosition.x
        : 0;
      const dy = lastLoggedPlayerPosition
        ? playerMinimapPosition.y - lastLoggedPlayerPosition.y
        : 0;
      const dz = lastLoggedPlayerPosition
        ? playerMinimapPosition.z - lastLoggedPlayerPosition.z
        : 0;

      logger(
        'info',
        `Player position changed: X=${playerMinimapPosition.x}, Y=${playerMinimapPosition.y}, Z=${playerMinimapPosition.z} (dx=${dx}, dy=${dy}, dz=${dz})`,
      );
      lastLoggedPlayerPosition = { ...playerMinimapPosition };
    }

    const { waypointSections, currentSection, wptId } = currentState.cavebot;
    let targetWaypoint = waypointSections[currentSection]?.waypoints.find(
      (wp) => wp.id === wptId,
    );

    // Handle case when no current waypoint is selected
    if (!targetWaypoint) {
      const firstSectionWithWaypoints = Object.keys(waypointSections).find(
        (sectionId) => waypointSections[sectionId]?.waypoints?.length > 0,
      );

      if (firstSectionWithWaypoints) {
        const firstWaypoint =
          waypointSections[firstSectionWithWaypoints].waypoints[0];
        if (firstWaypoint) {
          logger(
            'info',
            `No current waypoint found. Selecting first waypoint of first section: ${firstWaypoint.id}`,
          );
          postStoreUpdate(
            'cavebot/setCurrentWaypointSection',
            firstSectionWithWaypoints,
          );
          postStoreUpdate('cavebot/setwptId', firstWaypoint.id);
          targetWaypoint = firstWaypoint;
        }
      }
    }

    if (!targetWaypoint || !playerMinimapPosition) {
      await delay(20);
      return;
    }

    const contextualStandTime = updateContextualStandTime(
      currentActionStatus,
      playerMinimapPosition,
    );
    postStoreUpdate('cavebot/setStandTime', contextualStandTime);

    if (targetWaypoint.type === 'Script') {
      await handleScriptAction(targetWaypoint);
      await delay(5);
      return;
    }

    if (playerMinimapPosition.z !== targetWaypoint.z) {
      logger(
        'error',
        `Z-level mismatch! Player is at Z:${playerMinimapPosition.z}, waypoint is at Z:${targetWaypoint.z}. Skipping waypoint.`,
      );
      postStoreUpdate('cavebot/setPathfindingFeedback', {
        pathWaypoints: [],
        wptDistance: null,
        pathfindingStatus: 'DIFFERENT_FLOOR',
      });
      await advanceToNextWaypoint();
      return;
    }

    const {
      path,
      distance: pathDistance,
      status,
    } = runPathfinding(playerMinimapPosition, targetWaypoint);

    const chebyshevDistance = getChebyshevDistance(
      playerMinimapPosition,
      targetWaypoint,
    );

    if (status === 'NO_PATH_FOUND') {
      logger(
        'error',
        `Pathfinder reported NO PATH to waypoint ${targetWaypoint.id}. Skipping.`,
      );
      await advanceToNextWaypoint();
      return;
    }

    handleStuckCondition(contextualStandTime, pathDistance);
    postStoreUpdate('cavebot/setActionPaused', true);

    let actionSucceeded = false;
    currentActionStatus = CavebotActionStatus.IDLE;

    if (
      targetWaypoint.type === 'Node' &&
      chebyshevDistance <= targetWaypoint.range - 1
    ) {
      logger('info', `Reached area of Node waypoint.`);
      actionSucceeded = true;
    } else if (targetWaypoint.type === 'Lure' && pathDistance === 0) {
      currentActionStatus = CavebotActionStatus.SETTING_LURE;
      logger(
        'info',
        `Setting Lure location to [${targetWaypoint.x}, ${targetWaypoint.y}, ${targetWaypoint.z}]`,
      );
      actionSucceeded = true;
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
    } else if (targetWaypoint.type === 'Use' && pathDistance === 1) {
      currentActionStatus = CavebotActionStatus.PERFORMING_USE;
      actionSucceeded = await handleUseAction(targetWaypoint);
    } else if (targetWaypoint.type === 'Stand' && pathDistance === 1) {
      currentActionStatus = CavebotActionStatus.IDLE;
      actionSucceeded = await handleStandAction(targetWaypoint);
    } else if (targetWaypoint.type === 'Ladder' && pathDistance <= 1) {
      currentActionStatus = CavebotActionStatus.USING_LADDER;
      const target =
        pathDistance === 0 ? playerMinimapPosition : targetWaypoint;
      actionSucceeded = await handleLadderAction(target);
    } else if (path && path.length > 0) {
      currentActionStatus = CavebotActionStatus.WALKING;
      postStoreUpdate('cavebot/setActionPaused', false);
      await handleWalkAction(path, chebyshevDistance);
    } else if (status === 'WAYPOINT_REACHED') {
      logger(
        'info',
        `Arrived at generic waypoint ${targetWaypoint.id}. Advancing.`,
      );
      actionSucceeded = true;
    }

    if (actionSucceeded) {
      if (currentMapClickTarget) {
        logger('debug', 'Waypoint reached. Clearing stale map click target.');
        currentMapClickTarget = null;
      }
      await advanceToNextWaypoint();
    } else {
      logger('debug', `Awaiting next loop cycle for ${targetWaypoint.id}...`);
      await delay(5);
    }
  } catch (error) {
    logger('error', '[CavebotWorker] Error in operation:', error);
  } finally {
    const opEnd = performance.now();
    const opTime = opEnd - opStart;

    // Update performance stats
    operationCount++;
    totalOperationTime += opTime;

    // Log slow operations
    if (opTime > 50) {
      logger('info', `[CavebotWorker] Slow operation: ${opTime.toFixed(2)}ms`);
    }
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
      // Wait longer on error to avoid tight error loops
      await delay(Math.max(MAIN_LOOP_INTERVAL * 2, 100));
      continue;
    }

    const loopEnd = performance.now();
    const elapsedTime = loopEnd - loopStart;
    const delayTime = Math.max(0, MAIN_LOOP_INTERVAL - elapsedTime);

    if (delayTime > 0) {
      await delay(delayTime);
    }
  }

  logger('info', '[CavebotWorker] Main loop stopped.');
}

// --- Message Handler ---
parentPort.on('message', (message) => {
  try {
    if (message.type === 'state_diff') {
      // Handle state updates from WorkerManager
      if (!currentState) {
        currentState = {};
      }

      // Apply state diff - merge the payload into current state
      Object.assign(currentState, message.payload);

      // Handle specific state changes if needed
      if (message.payload.global) {
        const globalState = message.payload.global;

        // React to window changes
        if (globalState.windowId !== undefined) {
          logger(
            'debug',
            '[CavebotWorker] Window changed:',
            globalState.windowId,
          );
        }
      }
    } else if (message.type === 'shutdown') {
      logger('info', '[CavebotWorker] Received shutdown command.');
      isShuttingDown = true;

      // Cleanup resources
      if (luaExecutor) {
        luaExecutor.destroy();
      }
    } else if (message.type === 'script-finished') {
      // Handle script finished messages from one-shot Lua workers
      logger(
        'debug',
        '[CavebotWorker] Received script-finished message:',
        message.id,
      );
    } else if (typeof message === 'object' && !message.type) {
      // Handle full state updates (initial state from WorkerManager)
      currentState = message;
      logger('info', '[CavebotWorker] Received initial state update.');

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
    } else {
      // Handle custom commands
      logger(
        'debug',
        '[CavebotWorker] Received message:',
        message.type || 'unknown',
      );
    }
  } catch (error) {
    logger('error', '[CavebotWorker] Error handling message:', error);
  }
});

// --- Graceful Shutdown ---
parentPort.on('close', () => {
  logger(
    'info',
    '[CavebotWorker] Parent port closed. Stopping cavebot worker.',
  );
  isShuttingDown = true;

  if (luaExecutor) {
    luaExecutor.destroy();
  }

  process.exit(0);
});

// --- Worker Startup ---
async function startWorker() {
  logger('info', '[CavebotWorker] Worker starting up...');

  // Handle graceful shutdown signals
  process.on('SIGTERM', () => {
    logger('info', '[CavebotWorker] Received SIGTERM, shutting down...');
    isShuttingDown = true;
  });

  process.on('SIGINT', () => {
    logger('info', '[CavebotWorker] Received SIGINT, shutting down...');
    isShuttingDown = true;
  });

  // Start the main loop
  mainLoop().catch((error) => {
    logger('error', '[CavebotWorker] Fatal error in main loop:', error);
    process.exit(1);
  });
}

// --- Worker Data Validation ---
function validateWorkerData() {
  if (!workerData) {
    throw new Error('[CavebotWorker] Worker data not provided');
  }

  // Validate paths
  if (!workerData.paths) {
    logger(
      'warn',
      '[CavebotWorker] Paths not provided in worker data, using defaults',
    );
  }
}

// Initialize and start the worker
try {
  validateWorkerData();
  startWorker();
} catch (error) {
  logger('error', '[CavebotWorker] Failed to start worker:', error);
  process.exit(1);
}
