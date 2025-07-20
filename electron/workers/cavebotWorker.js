import { parentPort } from 'worker_threads';
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

const logger = createLogger({ info: false, error: true, debug: false });

// --- CONFIGURATION ---
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

// --- STATE AND HELPERS ---
let pathfinderInstance;
const PREPROCESSED_BASE_DIR = path.join(process.cwd(), 'resources', 'preprocessed_minimaps');
let appState = null;
let pathfinderLoaded = false;
let lastSpecialAreasJson = '';
let temporaryBlocks = [];
let lastStuckEventHandledTimestamp = 0;
let recentKeyboardFailures = [];
let luaExecutor = null;
let currentMapClickTarget = null;
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
let currentActionStatus = CavebotActionStatus.IDLE;
let contextualStandStillStartTime = null;
let lastWalkCheckPosition = null;
let stuckDetectionGraceUntil = 0;
let lastLoggedPlayerPosition = null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getDistance = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
const getChebyshevDistance = (p1, p2) => Math.max(Math.abs(p1.x - p2.x), Math.abs(p1.y - p2.y));
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

const postStoreUpdate = (type, payload) => {
  parentPort.postMessage({ storeUpdate: true, type, payload });
};

const advanceToNextWaypoint = async () => {
  if (!appState || !appState.cavebot) return;
  const { waypointSections, currentSection, wptId } = appState.cavebot;
  const waypoints = waypointSections[currentSection]?.waypoints || [];
  if (waypoints.length === 0) return;
  const currentIndex = waypoints.findIndex((wp) => wp.id === wptId);
  if (currentIndex === -1) return;
  const nextIndex = (currentIndex + 1) % waypoints.length;
  const nextWpt = waypoints[nextIndex];
  if (nextWpt) {
    logger('info', `Advancing to next target: ${nextWpt.label || nextWpt.type} (${nextWpt.id})`);
    postStoreUpdate('cavebot/setwptId', nextWpt.id);
  }
  await sleep(50);
};

const goToLabel = async (label) => {
  logger('info', `Attempting to jump to label within current section: "${label}"`);
  const { waypointSections, currentSection } = appState.cavebot;
  const currentWaypoints = waypointSections[currentSection].waypoints;
  const targetWpt = currentWaypoints.find((wpt) => wpt.label === label);
  if (targetWpt) {
    logger('info', `Found waypoint with label "${label}". Jumping to ID: ${targetWpt.id}`);
    postStoreUpdate('cavebot/setwptId', targetWpt.id);
  } else {
    logger('warn', `No waypoint found with label: "${label}" in section "${currentSection}". Continuing sequence.`);
    await advanceToNextWaypoint();
  }
};

const goToSection = async (sectionName) => {
  logger('info', `Attempting to jump to section: "${sectionName}"`);
  const { waypointSections } = appState.cavebot;
  const foundEntry = Object.entries(waypointSections).find(([, section]) => section.name === sectionName);
  if (foundEntry) {
    const [targetSectionId, targetSection] = foundEntry;
    if (targetSection.waypoints && targetSection.waypoints.length > 0) {
      const firstWpt = targetSection.waypoints[0];
      logger('info', `Found section "${sectionName}". Jumping to its first waypoint: ${firstWpt.id}`);
      postStoreUpdate('cavebot/setCurrentWaypointSection', targetSectionId);
      postStoreUpdate('cavebot/setwptId', firstWpt.id);
    } else {
      logger('warn', `Section "${sectionName}" was found but is empty. Cannot jump. Continuing sequence.`);
      await advanceToNextWaypoint();
    }
  } else {
    logger('warn', `No section found with name: "${sectionName}". Continuing sequence.`);
    await advanceToNextWaypoint();
  }
};

const goToWpt = async (index) => {
  const userIndex = parseInt(index, 10);
  if (isNaN(userIndex) || userIndex < 1) {
    logger('warn', `goToWpt received an invalid index: ${index}. Must be a number >= 1.`);
    return;
  }

  const arrayIndex = userIndex - 1;
  const { waypointSections, currentSection } = appState.cavebot;
  const waypoints = waypointSections[currentSection]?.waypoints || [];

  if (arrayIndex < waypoints.length) {
    const targetWpt = waypoints[arrayIndex];
    logger('info', `Jumping to waypoint index ${userIndex} (ID: ${targetWpt.id})`);
    postStoreUpdate('cavebot/setwptId', targetWpt.id);
  } else {
    logger('warn', `goToWpt received an out-of-bounds index: ${userIndex}. Section only has ${waypoints.length} waypoints.`);
  }
};

const awaitStateChange = (condition, timeoutMs) => {
  return new Promise((resolve) => {
    let timeoutId = null;
    const onMessage = (newState) => {
      if (newState.type === 'script-finished') return;
      if (condition(newState)) {
        cleanup();
        resolve(true);
      }
    };
    const onTimeout = () => {
      cleanup();
      resolve(false);
    };
    const cleanup = () => {
      clearTimeout(timeoutId);
      parentPort.removeListener('message', onMessage);
    };
    parentPort.on('message', onMessage);
    timeoutId = setTimeout(onTimeout, timeoutMs);
  });
};

const initialize = async () => {
  logger('info', 'Cavebot worker starting up...');
  try {
    pathfinderInstance = new Pathfinder.Pathfinder();
    logger('info', 'Native Pathfinder addon loaded successfully.');
  } catch (e) {
    logger('error', `FATAL: Failed to load native Pathfinder module: ${e.message}`);
    parentPort.postMessage({ fatalError: `Pathfinder addon failed: ${e.message}` });
    process.exit(1);
  }
  logger('info', 'Loading pathfinding data for all Z-levels...');
  const mapDataForAddon = {};
  try {
    const zLevelDirs = fs
      .readdirSync(PREPROCESSED_BASE_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('z'))
      .map((d) => d.name);
    for (const zDir of zLevelDirs) {
      const zLevel = parseInt(zDir.substring(1), 10);
      const zLevelPath = path.join(PREPROCESSED_BASE_DIR, zDir);
      try {
        const metadata = JSON.parse(fs.readFileSync(path.join(zLevelPath, 'walkable.json'), 'utf8'));
        const grid = fs.readFileSync(path.join(zLevelPath, 'walkable.bin'));
        mapDataForAddon[zLevel] = { ...metadata, grid };
      } catch (e) {
        if (e.code !== 'ENOENT') logger('warn', `Could not load pathfinding data for Z=${zLevel}: ${e.message}`);
      }
    }
    pathfinderInstance.loadMapData(mapDataForAddon);
    if (pathfinderInstance.isLoaded) {
      pathfinderLoaded = true;
      logger('info', 'Pathfinding data successfully loaded.');
    } else {
      logger('error', 'Failed to load data into native module. Worker will not function.');
    }
  } catch (e) {
    logger('error', `Critical error during map data loading: ${e.message}`);
    parentPort.postMessage({ fatalError: 'Failed to load pathfinding map data.' });
    process.exit(1);
  }
  logger('info', 'Initializing Cavebot Lua Executor...');
  try {
    luaExecutor = new CavebotLuaExecutor({
      logger,
      postStoreUpdate,
      getState: () => appState,
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
};

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

const applyTemporaryBlock = (blockedTile, reason) => {
  if (blockedTile) {
    logger('info', `${reason} at [${blockedTile.x},${blockedTile.y}]. Applying temporary obstacle.`);
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

const handleStuckCondition = (contextualStandTime, wptDistance) => {
  if (Date.now() < stuckDetectionGraceUntil || !appState?.statusMessages) {
    return;
  }
  const { sorryNotPossible: sorryNotPossibleTimestamp } = appState.statusMessages;
  const isSorryNotPossibleNew = sorryNotPossibleTimestamp && sorryNotPossibleTimestamp > lastStuckEventHandledTimestamp;
  if (isSorryNotPossibleNew) {
    const blockedTile = appState.cavebot.pathWaypoints?.[0];
    applyTemporaryBlock(blockedTile, "'Sorry, not possible' message detected");
    recentKeyboardFailures.push(Date.now());
    return;
  }
  const isStuckCooldownOver = Date.now() - lastStuckEventHandledTimestamp > config.stuckCooldownMs;
  if (wptDistance > 0 && contextualStandTime > config.stuckTimeThresholdMs && isStuckCooldownOver) {
    const blockedTile = appState.cavebot.pathWaypoints?.[0];
    applyTemporaryBlock(blockedTile, 'Bot is physically stuck');
  }
};

const runPathfinding = (playerPos, targetWaypoint) => {
  const permanentAreas = (appState.cavebot?.specialAreas || []).filter((area) => area.enabled);
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
  temporaryBlocks.forEach((block) => {
    if (!block.timerSet) {
      const estimatedTime = path.length * config.tempBlockMsPerStep;
      const timeout = Math.max(config.tempBlockMinLifetimeMs, Math.min(estimatedTime, config.tempBlockMaxLifetimeMs));
      logger('info', `New path length is ${path.length}. Setting temporary block lifetime to ${timeout}ms.`);
      setTimeout(() => {
        temporaryBlocks = temporaryBlocks.filter((b) => b.id !== block.id);
        logger('info', `Dynamic timer expired for block at ${block.x},${block.y}.`);
      }, timeout);
      block.timerSet = true;
    }
  });
  const distance =
    result.reason === 'NO_PATH_FOUND' ? null : path.length > 0 ? path.length : result.reason === 'WAYPOINT_REACHED' ? 0 : null;
  postStoreUpdate('cavebot/setPathfindingFeedback', {
    pathWaypoints: path,
    wptDistance: distance,
    routeSearchMs: result.performance.totalTimeMs,
    pathfindingStatus: result.reason,
  });
  return { path, distance, status: result.reason };
};

const handleZLevelToolAction = async (toolType, targetCoords) => {
  const hotkey = appState.settings.hotkeys[toolType.toLowerCase()];
  if (!hotkey) {
    logger('error', `No hotkey configured for tool: ${toolType}`);
    return false;
  }
  const { gameWorld, tileSize } = appState.regionCoordinates.regions;
  if (!gameWorld || !tileSize) {
    logger('error', 'Game world region or tile size not yet detected. Cannot perform click action.');
    return false;
  }
  const initialPos = { ...appState.gameState.playerMinimapPosition };
  logger('info', `Attempting to use ${toolType} on tile [${targetCoords.x}, ${targetCoords.y}]...`);
  keypress.sendKey(parseInt(appState.global.windowId, 10), hotkey);
  await sleep(config.toolHotkeyWaitMs);
  await sleep(config.preClickDelayMs);
  const clickCoords = getAbsoluteGameWorldClickCoordinates(targetCoords.x, targetCoords.y, initialPos, gameWorld, tileSize, 'center');
  if (!clickCoords) return false;
  mouseController.leftClick(parseInt(appState.global.windowId, 10), clickCoords.x, clickCoords.y);
  const zChanged = await awaitStateChange(
    (newState) => newState.gameState?.playerMinimapPosition?.z !== initialPos.z,
    config.actionStateChangeTimeoutMs,
  );
  if (zChanged) {
    const finalPos = appState.gameState.playerMinimapPosition;
    if (getDistance(initialPos, finalPos) >= config.teleportDistanceThreshold) {
      logger('info', `Teleport detected after ${toolType} action. Activating grace period.`);
      stuckDetectionGraceUntil = Date.now() + config.postTeleportGraceMs;
    } else {
      logger('info', `${toolType} action successful (local Z change).`);
    }
    return true;
  } else {
    logger('warn', `Z-level did not change after using ${toolType}. Will retry on next loop.`);
    return false;
  }
};

const handleUseAction = async (targetCoords) => {
  await sleep(config.preClickDelayMs);
  const { gameWorld, tileSize } = appState.regionCoordinates.regions;
  if (!gameWorld || !tileSize) {
    logger('error', 'Game world region or tile size not yet detected. Cannot perform click action.');
    return false;
  }
  const initialPos = { ...appState.gameState.playerMinimapPosition };
  const clickCoords = getAbsoluteGameWorldClickCoordinates(targetCoords.x, targetCoords.y, initialPos, gameWorld, tileSize, 'center');
  if (!clickCoords) return false;
  logger('info', `Using tile [${targetCoords.x}, ${targetCoords.y}]`);
  mouseController.rightClick(parseInt(appState.global.windowId, 10), clickCoords.x, clickCoords.y);
  await sleep(config.postUseDelayMs);
  return true;
};

const handleLadderAction = async (targetCoords) => {
  await sleep(config.preClickDelayMs);
  const { gameWorld, tileSize } = appState.regionCoordinates.regions;
  if (!gameWorld || !tileSize) {
    logger('error', 'Game world region or tile size not yet detected. Cannot perform click action.');
    return false;
  }
  const initialPos = { ...appState.gameState.playerMinimapPosition };
  const clickCoords = getAbsoluteGameWorldClickCoordinates(targetCoords.x, targetCoords.y, initialPos, gameWorld, tileSize, 'bottomRight');
  if (!clickCoords) return false;
  logger('info', `Attempting to use ladder at [${targetCoords.x}, ${targetCoords.y}]...`);
  mouseController.rightClick(parseInt(appState.global.windowId, 10), clickCoords.x, clickCoords.y);
  const zChanged = await awaitStateChange(
    (newState) => newState.gameState?.playerMinimapPosition?.z !== initialPos.z,
    config.actionStateChangeTimeoutMs,
  );
  if (zChanged) {
    const finalPos = appState.gameState.playerMinimapPosition;
    if (getDistance(initialPos, finalPos) >= config.teleportDistanceThreshold) {
      logger('info', 'Teleport detected after Ladder action. Activating grace period.');
      stuckDetectionGraceUntil = Date.now() + config.postTeleportGraceMs;
    } else {
      logger('info', 'Ladder action successful (local Z change).');
    }
    return true;
  } else {
    logger('warn', `Z-level did not change after using ladder. Will retry on next loop.`);
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
    logger('info', `Script for [${label}] completed without navigation. Advancing to next waypoint.`);
    await advanceToNextWaypoint();
  } else if (result.navigationOccurred) {
    logger('info', `Script for [${label}] completed and handled its own navigation.`);
  } else if (!result.success) {
    logger('error', `Script for waypoint [${label}] failed: ${result.error}`);
  }
};

const handleStandAction = async (targetWaypoint) => {
  const initialPos = { ...appState.gameState.playerMinimapPosition };
  const moveKey = getDirectionKey(initialPos, targetWaypoint);
  if (!moveKey) {
    logger('error', `Could not determine move key for Stand action, though adjacent.`);
    return false;
  }
  logger('info', `Attempting to step on Stand waypoint at [${targetWaypoint.x}, ${targetWaypoint.y}], monitoring for position change...`);
  keypress.sendKey(parseInt(appState.global.windowId, 10), moveKey);
  await sleep(config.approachWalkDelayMs);
  const positionChanged = await awaitStateChange((newState) => {
    const newPos = newState.gameState?.playerMinimapPosition;
    if (!newPos) return false;
    if (newPos.z !== initialPos.z) return true;
    if (getDistance(initialPos, newPos) >= config.teleportDistanceThreshold) return true;
    return false;
  }, config.actionStateChangeTimeoutMs);
  if (positionChanged) {
    const finalPos = appState.gameState.playerMinimapPosition;
    if (getDistance(initialPos, finalPos) >= config.teleportDistanceThreshold) {
      logger('info', 'Teleport detected after Stand action. Activating grace period.');
      stuckDetectionGraceUntil = Date.now() + config.postTeleportGraceMs;
    } else {
      logger('info', 'Stand action successful (local position change).');
    }
    return true;
  } else {
    logger('warn', 'Position did not change after stepping on Stand waypoint. Will retry.');
    return false;
  }
};

const handleWalkAction = async (path, chebyshevDistance) => {
  currentActionStatus = CavebotActionStatus.WALKING;
  const { playerMinimapPosition } = appState.gameState;
  const minimapRegionDef = appState.regionCoordinates?.regions?.minimapFull;
  const { thereIsNoWay: thereIsNoWayTimestamp } = appState.statusMessages;
  const isThereIsNoWayRecent = thereIsNoWayTimestamp && Date.now() - thereIsNoWayTimestamp < config.thereIsNoWayLingerMs;
  const isStuckByTime = appState.cavebot.standTime > config.mapClickStandTimeThresholdMs;
  recentKeyboardFailures = recentKeyboardFailures.filter((ts) => Date.now() - ts < config.keyboardFailureWindowMs);
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
    shouldUseKeyboard = !config.useMapclicks || chebyshevDistance < config.switchToKeyboardDistance;
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
      await sleep(20);
      return;
    }
    const walkDelay = chebyshevDistance <= config.approachDistanceThreshold ? config.approachWalkDelayMs : config.standardWalkDelayMs;
    keypress.sendKey(parseInt(appState.global.windowId, 10), moveKey);
    await sleep(walkDelay);
    const moveConfirmed = await awaitStateChange(
      (newState) =>
        newState.gameState?.playerMinimapPosition?.x !== positionBeforeMove.x ||
        newState.gameState?.playerMinimapPosition?.y !== positionBeforeMove.y,
      config.moveConfirmTimeoutMs,
    );
    if (moveConfirmed) {
      if (recentKeyboardFailures.length > 0) {
        logger('info', 'Keyboard move successful. Resetting failure counter.');
        recentKeyboardFailures = [];
      }
    } else {
      logger('warn', `Keyboard move to [${nextStep.x},${nextStep.y}] was not confirmed. Immediately treating as stuck.`);
      applyTemporaryBlock(nextStep, 'Failed keyboard move');
      recentKeyboardFailures.push(Date.now());
    }
    return;
  }
  if (currentMapClickTarget) {
    logger('debug', 'Map click walk is in progress. Monitoring movement.');
    await sleep(100);
    return;
  }
  logger('info', `Initiating new map click movement. Reason: ${reason}.`);

  // --- MODIFICATION START ---
  // Find the furthest tile on the path that is reachable via a single map click.
  let furthestReachableTile = null;
  let furthestReachableTileIndex = -1;
  for (let i = 0; i < path.length; i++) {
    if (getChebyshevDistance(playerMinimapPosition, path[i]) <= config.mapClickMaxDistance) {
      furthestReachableTile = path[i];
      furthestReachableTileIndex = i;
    } else {
      // The path is sorted by distance, so we can stop once a tile is out of range.
      break;
    }
  }

  // This check handles cases where the path is empty or no tile is in range for some reason.
  if (!furthestReachableTile) {
    logger('error', 'Could not determine a map click target on the path.');
    return;
  }

  let clickTargetWaypoint = furthestReachableTile;

  // If the furthest reachable tile is the *actual last tile* of the path, click the one before it.
  const isLastTileOfPath = furthestReachableTileIndex === path.length - 1;
  if (isLastTileOfPath && path.length > 1) {
    clickTargetWaypoint = path[path.length - 2];
    logger(
      'info',
      `Final target is within range; clicking tile before last to ensure arrival: [${clickTargetWaypoint.x}, ${clickTargetWaypoint.y}]`,
    );
  }
  // --- MODIFICATION END ---

  const clickCoords = getAbsoluteClickCoordinates(clickTargetWaypoint.x, clickTargetWaypoint.y, playerMinimapPosition, minimapRegionDef);
  if (!clickCoords) {
    logger('error', `Could not get absolute click coordinates for ${clickTargetWaypoint.x},${clickTargetWaypoint.y}.`);
    return;
  }
  logger('debug', `Clicking map at ${clickCoords.x},${clickCoords.y} (target tile ${clickTargetWaypoint.x},${clickTargetWaypoint.y}).`);
  currentMapClickTarget = clickTargetWaypoint;
  mouseController.leftClick(parseInt(appState.global.windowId, 10), clickCoords.x, clickCoords.y);
  await sleep(config.mapClickPostClickDelayMs);
};

const mainLoop = async () => {
  while (true) {
    await sleep(5);
    if (!appState || !appState.global?.windowId || !appState.cavebot?.enabled || !pathfinderLoaded) {
      currentActionStatus = CavebotActionStatus.IDLE;
      continue;
    }

    // Check if user is online before performing any actions
    if (!appState?.luaApi?.isOnline) {
      currentActionStatus = CavebotActionStatus.IDLE;
      await sleep(100);
      continue;
    }
    const { playerMinimapPosition } = appState.gameState;
    if (
      playerMinimapPosition &&
      (!lastLoggedPlayerPosition ||
        playerMinimapPosition.x !== lastLoggedPlayerPosition.x ||
        playerMinimapPosition.y !== lastLoggedPlayerPosition.y ||
        playerMinimapPosition.z !== lastLoggedPlayerPosition.z)
    ) {
      const dx = lastLoggedPlayerPosition ? playerMinimapPosition.x - lastLoggedPlayerPosition.x : 0;
      const dy = lastLoggedPlayerPosition ? playerMinimapPosition.y - lastLoggedPlayerPosition.y : 0;
      const dz = lastLoggedPlayerPosition ? playerMinimapPosition.z - lastLoggedPlayerPosition.z : 0;
      logger(
        'info',
        `Player position changed: X=${playerMinimapPosition.x}, Y=${playerMinimapPosition.y}, Z=${playerMinimapPosition.z} (dx=${dx}, dy=${dy}, dz=${dz})`,
      );
      lastLoggedPlayerPosition = { ...playerMinimapPosition };
    }
    const { waypointSections, currentSection, wptId } = appState.cavebot;
    let targetWaypoint = waypointSections[currentSection]?.waypoints.find((wp) => wp.id === wptId);

    // Handle case when no current waypoint is selected
    if (!targetWaypoint) {
      // Find first section with waypoints
      const firstSectionWithWaypoints = Object.keys(waypointSections).find(
        (sectionId) => waypointSections[sectionId]?.waypoints?.length > 0,
      );

      if (firstSectionWithWaypoints) {
        const firstWaypoint = waypointSections[firstSectionWithWaypoints].waypoints[0];
        if (firstWaypoint) {
          logger('info', `No current waypoint found. Selecting first waypoint of first section: ${firstWaypoint.id}`);
          postStoreUpdate('cavebot/setCurrentWaypointSection', firstSectionWithWaypoints);
          postStoreUpdate('cavebot/setwptId', firstWaypoint.id);
          targetWaypoint = firstWaypoint;
        }
      }
    }

    if (!targetWaypoint || !playerMinimapPosition) {
      await sleep(20);
      continue;
    }
    const contextualStandTime = updateContextualStandTime(currentActionStatus, playerMinimapPosition);
    postStoreUpdate('cavebot/setStandTime', contextualStandTime);
    if (targetWaypoint.type === 'Script') {
      await handleScriptAction(targetWaypoint);
      await sleep(5);
      continue;
    }
    if (playerMinimapPosition.z !== targetWaypoint.z) {
      logger(
        'error',
        `Z-level mismatch! Player is at Z:${playerMinimapPosition.z}, waypoint is at Z:${targetWaypoint.z}. Skipping waypoint.`,
      );
      postStoreUpdate('cavebot/setPathfindingFeedback', { pathWaypoints: [], wptDistance: null, pathfindingStatus: 'DIFFERENT_FLOOR' });
      await advanceToNextWaypoint();
      continue;
    }
    const { path, distance: pathDistance, status } = runPathfinding(playerMinimapPosition, targetWaypoint);
    const chebyshevDistance = getChebyshevDistance(playerMinimapPosition, targetWaypoint);
    if (status === 'NO_PATH_FOUND') {
      logger('error', `Pathfinder reported NO PATH to waypoint ${targetWaypoint.id}. Skipping.`);
      await advanceToNextWaypoint();
      continue;
    }
    handleStuckCondition(contextualStandTime, pathDistance);
    postStoreUpdate('cavebot/setActionPaused', true);
    let actionSucceeded = false;
    currentActionStatus = CavebotActionStatus.IDLE;
    if (targetWaypoint.type === 'Node' && chebyshevDistance <= targetWaypoint.range - 1) {
      logger('info', `Reached area of Node waypoint.`);
      actionSucceeded = true;
    } else if (targetWaypoint.type === 'Lure' && pathDistance === 0) {
      currentActionStatus = CavebotActionStatus.SETTING_LURE;
      logger('info', `Setting Lure location to [${targetWaypoint.x}, ${targetWaypoint.y}, ${targetWaypoint.z}]`);
      actionSucceeded = true;
    } else if (['Shovel', 'Machete', 'Rope'].includes(targetWaypoint.type) && pathDistance === 0) {
      currentActionStatus = CavebotActionStatus[`USING_${targetWaypoint.type.toUpperCase()}`];
      actionSucceeded = await handleZLevelToolAction(targetWaypoint.type, playerMinimapPosition);
    } else if (targetWaypoint.type === 'Use' && pathDistance === 1) {
      currentActionStatus = CavebotActionStatus.PERFORMING_USE;
      actionSucceeded = await handleUseAction(targetWaypoint);
    } else if (targetWaypoint.type === 'Stand' && pathDistance === 1) {
      currentActionStatus = CavebotActionStatus.IDLE;
      actionSucceeded = await handleStandAction(targetWaypoint);
    } else if (targetWaypoint.type === 'Ladder' && pathDistance <= 1) {
      currentActionStatus = CavebotActionStatus.USING_LADDER;
      const target = pathDistance === 0 ? playerMinimapPosition : targetWaypoint;
      actionSucceeded = await handleLadderAction(target);
    } else if (path && path.length > 0) {
      currentActionStatus = CavebotActionStatus.WALKING;
      postStoreUpdate('cavebot/setActionPaused', false);
      await handleWalkAction(path, chebyshevDistance);
    } else if (status === 'WAYPOINT_REACHED') {
      logger('info', `Arrived at generic waypoint ${targetWaypoint.id}. Advancing.`);
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
      await sleep(5);
    }
  }
};

parentPort.on('message', (message) => {
  if (message.type === 'script-finished') return;
  appState = message;
});

parentPort.on('close', () => {
  logger('info', 'Parent port closed. Stopping cavebot worker.');
  if (luaExecutor) {
    luaExecutor.destroy();
  }
  process.exit(0);
});
//
(async () => {
  try {
    await initialize();
    await mainLoop();
  } catch (err) {
    logger('error', `Cavebot worker fatal error: ${err.message}`, err);
    parentPort.postMessage({ fatalError: err.message || 'Unknown fatal error in worker' });
    process.exit(1);
  }
})();
