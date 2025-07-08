import { parentPort, workerData } from 'worker_threads';
import { createLogger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import Pathfinder from 'pathfinder-native';
import { v4 as uuidv4 } from 'uuid';

/**
 * This worker is responsible for all heavy pathfinding calculations and stateful stuck detection.
 * Its primary roles are:
 * 1. Calculating paths from the player's current position to the target waypoint using a native C++ addon.
 * 2. Managing "special areas" (avoidance zones) and updating the native addon when they change.
 * 3. Detecting when the bot is genuinely stuck (e.g., against an obstacle or due to a "Not Possible" message).
 * 4. Calculating the player's "stand time" to feed into the stuck detection logic.
 */

const logger = createLogger({ info: true, error: true, debug: false });

// --- CONFIGURATION ---
// These values control the behavior of the stuck detection and temporary block logic.
const pathfinderConfig = {
  stuckTimeThresholdMs: 1000, // How long the bot must be standing still (while trying to move) to be considered stuck.
  stuckCooldownMs: 3000, // A cooldown to prevent adding temporary blocks too frequently.
  notPossibleCooldownMs: 5000, // A separate cooldown for the "Not Possible" message trigger.
  notPossibleMessageLingerMs: 1000, // How long a "Not Possible" message is considered "recent".
  tempBlockMinLifetimeMs: 2000, // The minimum time a temporary block will exist.
  tempBlockMaxLifetimeMs: 10000, // The maximum time a temporary block will exist.
  tempBlockMsPerStep: 500, // Used to dynamically calculate block lifetime based on the new path length.
};
// --- END CONFIGURATION ---

// --- Native Addon Initialization ---
// This attempts to load the compiled C++ pathfinder module. If it fails, the worker cannot function.
let pathfinderInstance;
try {
  pathfinderInstance = new Pathfinder.Pathfinder();
  logger('info', 'Native Pathfinder addon loaded successfully.');
} catch (e) {
  logger('error', `FATAL: Failed to load native Pathfinder module: ${e.message}`);
  if (parentPort) parentPort.postMessage({ fatalError: `Pathfinder addon failed: ${e.message}` });
  process.exit(1);
}

// --- Worker State ---
let state = null; // A full copy of the Redux state, received from the main thread.
let lastPlayerPosKey = null; // Caches the last position to avoid redundant path calculations.
let lastTargetWptId = null; // Caches the last target to avoid redundant path calculations.
const lastJsonForType = new Map(); // Caches the JSON representation of special areas to avoid redundant updates to the C++ module.

// --- State for Stand Timer ---
let lastMinimapPosKey = null; // The last known position for calculating stand time.
let standStillStartTime = null; // The timestamp when the player started standing still.
let lastStandTimeUpdate = 0; // Throttles updates to the main thread.

// --- Internal State for "Stuck" Logic ---
let temporaryBlocks = []; // An array of temporary obstacles created by the stuck logic.
let isApplyingTemporaryBlock = false; // A flag to prevent spamming the stuck detection logic.
let lastNotPossibleHandledTimestamp = 0; // Timestamp for the "Not Possible" cooldown.

const PREPROCESSED_BASE_DIR = path.join(process.cwd(), 'resources', 'preprocessed_minimaps');

// Maps waypoint types to the type of special areas they should respect.
const WAYPOINT_AVOIDANCE_MAP = {
  Node: 'cavebot',
  Stand: 'cavebot',
  Shovel: 'cavebot',
  Rope: 'cavebot',
  Machete: 'cavebot',
  Ladder: 'cavebot',
  Use: 'cavebot',
  Action: 'cavebot',
  Lure: 'targeting',
  Attack: 'targeting',
};

/**
 * Adds a new temporary block to the internal list and forces a path recalculation.
 * @param {object} block - An object with x, y, z coordinates for the block.
 */
function addTemporaryBlock(block) {
  temporaryBlocks.push({
    id: uuidv4(),
    x: block.x,
    y: block.y,
    z: block.z,
    sizeX: 1,
    sizeY: 1,
    avoidance: 9999,
    type: 'cavebot',
    enabled: true,
    timerSet: false, // This flag indicates the block's removal timer has not been set yet.
  });
  // By clearing the last known position, we force the pathfinding logic to run again on the next tick.
  lastPlayerPosKey = null;
}

/**
 * The core of the stuck detection logic. It determines if the bot is genuinely stuck
 * or if it's in a deliberate, user-scripted pause.
 */
function handleStuckCondition() {
  if (!state || !state.cavebot || !state.statusMessages) return;

  const { enabled, isActionPaused, wptDistance, standTime, pathWaypoints } = state.cavebot;
  const { notPossible: notPossibleTimestamp } = state.statusMessages;

  // --- THE MASTER RULE FOR STUCK DETECTION ---
  // The bot is NOT stuck if it's disabled OR if the pathFollowerWorker has
  // explicitly signaled that it's in a timed action pause (e.g., 'Stand' delay).
  // This is the most critical check to prevent false positives.
  const isPerformingIntentionalPause = !enabled || isActionPaused;

  // Condition 1: Physically stuck (not moving for a while when supposed to).
  // This only triggers if the bot is enabled, not in a special action, and has been
  // standing still for too long while still having a path to follow (wptDistance > 0).
  const isPhysicallyStuck = wptDistance > 0 && standTime > pathfinderConfig.stuckTimeThresholdMs && !isPerformingIntentionalPause;

  // Condition 2: "Not Possible" message received from the game.
  // This trigger also respects the `enabled` flag.
  const isNotPossibleRecent = notPossibleTimestamp && Date.now() - notPossibleTimestamp < pathfinderConfig.notPossibleMessageLingerMs;
  const isNotPossibleCooldownOver = Date.now() - lastNotPossibleHandledTimestamp > pathfinderConfig.notPossibleCooldownMs;
  const isNotPossibleTrigger = enabled && isNotPossibleRecent && isNotPossibleCooldownOver;

  // If either stuck condition is met and we're not already in the process of adding a block...
  if ((isPhysicallyStuck || isNotPossibleTrigger) && !isApplyingTemporaryBlock) {
    isApplyingTemporaryBlock = true; // Prevents this block from running again immediately.

    const blockedTile = pathWaypoints?.[0]; // The tile we are trying to walk to.
    if (blockedTile) {
      if (isPhysicallyStuck) {
        logger('warn', `Bot is stuck at [${blockedTile.x},${blockedTile.y}]. Applying temporary obstacle.`);
      } else {
        logger('warn', `'Not Possible' detected. Applying temporary obstacle at [${blockedTile.x},${blockedTile.y}].`);
        lastNotPossibleHandledTimestamp = Date.now();
      }
      addTemporaryBlock(blockedTile);
    }

    // A simple cooldown to prevent this logic from firing in rapid succession.
    setTimeout(() => {
      isApplyingTemporaryBlock = false;
    }, pathfinderConfig.stuckCooldownMs);
  }
}

/**
 * Loads all pre-processed map data from the disk into the C++ pathfinder addon's memory.
 * This is done once when the worker starts.
 */
function loadAllMapData() {
  if (pathfinderInstance.isLoaded) return;
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
    if (pathfinderInstance.isLoaded) logger('info', 'Pathfinding data successfully loaded.');
    else logger('error', 'Failed to load data into native module.');
  } catch (e) {
    logger('error', `Critical error during map data loading: ${e.message}`);
    if (parentPort) parentPort.postMessage({ fatalError: 'Failed to load pathfinding map data.' });
    process.exit(1);
  }
}

/**
 * Calculates how long the player has been standing in the same spot.
 * Per user requirements, this timer continues to tick even when the bot is disabled.
 * The `handleStuckCondition` function is responsible for ignoring the high standTime
 * when the bot is disabled.
 */
function updateStandTimer() {
  if (!state || !state.gameState?.playerMinimapPosition) return;
  const { x, y, z } = state.gameState.playerMinimapPosition;
  const currentMinimapPosKey = `${x},${y},${z}`;
  if (currentMinimapPosKey !== lastMinimapPosKey) {
    standStillStartTime = null;
    lastMinimapPosKey = currentMinimapPosKey;
    if (state.cavebot?.standTime !== 0) parentPort.postMessage({ storeUpdate: true, type: 'cavebot/setStandTime', payload: 0 });
  } else {
    if (standStillStartTime === null) standStillStartTime = Date.now();
    const now = Date.now();
    if (now - lastStandTimeUpdate > 10) {
      const duration = now - standStillStartTime;
      parentPort.postMessage({ storeUpdate: true, type: 'cavebot/setStandTime', payload: duration });
      lastStandTimeUpdate = now;
    }
  }
}

/**
 * The main pathfinding logic. It calls the native addon to get a path and then
 * sends the result back to the main thread.
 */
function runPathfindingLogic() {
  try {
    if (!state || !state.gameState?.playerMinimapPosition || !state.cavebot?.wptId) return;
    const { waypointSections, currentSection, wptId } = state.cavebot;
    const currentWaypoints = waypointSections[currentSection]?.waypoints || [];
    const targetWaypoint = currentWaypoints.find((wp) => wp.id === wptId);
    if (!targetWaypoint) return;

    // Update the C++ addon with any new or changed special areas (permanent or temporary).
    const requiredAvoidanceType = WAYPOINT_AVOIDANCE_MAP[targetWaypoint.type];
    if (requiredAvoidanceType) {
      const permanentAreas = (state.cavebot?.specialAreas || []).filter((area) => area.enabled && area.type === requiredAvoidanceType);
      const allRelevantAreas = [...permanentAreas, ...temporaryBlocks];
      const currentJson = JSON.stringify(allRelevantAreas);
      if (currentJson !== lastJsonForType.get(requiredAvoidanceType)) {
        logger('info', `Special areas for type "${requiredAvoidanceType}" have changed. Updating native cache...`);
        const areasForNative = allRelevantAreas.map((area) => ({
          x: area.x,
          y: area.y,
          z: area.z,
          avoidance: area.avoidance,
          width: area.sizeX,
          height: area.sizeY,
        }));
        pathfinderInstance.updateSpecialAreas(areasForNative);
        lastJsonForType.set(requiredAvoidanceType, currentJson);
        logger('info', 'Native cache updated.');
      }
    }

    const { x, y, z } = state.gameState.playerMinimapPosition;
    if (z !== targetWaypoint.z) {
      if (lastTargetWptId !== targetWaypoint.id) {
        parentPort.postMessage({
          storeUpdate: true,
          type: 'cavebot/setPathfindingFeedback',
          payload: { pathWaypoints: [], wptDistance: null, pathfindingStatus: 'DIFFERENT_FLOOR' },
        });
        lastTargetWptId = targetWaypoint.id;
      }
      return;
    }

    // Avoid recalculating the path if nothing has changed.
    const currentPosKey = `${x},${y},${z}`;
    if (lastPlayerPosKey === currentPosKey && lastTargetWptId === targetWaypoint.id) return;
    lastPlayerPosKey = currentPosKey;
    lastTargetWptId = targetWaypoint.id;

    // Call the synchronous C++ function to find the path.
    const result = pathfinderInstance.findPathSync(
      { x, y, z },
      { x: targetWaypoint.x, y: targetWaypoint.y, z: targetWaypoint.z },
      { waypointType: targetWaypoint.type },
    );
    const path = result.path || [];
    const status = result.reason; // e.g., 'PATH_FOUND', 'NO_PATH_FOUND'
    const distance = status === 'NO_PATH_FOUND' ? null : path.length > 0 ? path.length : status === 'WAYPOINT_REACHED' ? 0 : null;

    // For any newly created temporary blocks, set their removal timer.
    temporaryBlocks.forEach((block) => {
      if (!block.timerSet) {
        const estimatedTime = path.length * pathfinderConfig.tempBlockMsPerStep;
        const timeout = Math.max(pathfinderConfig.tempBlockMinLifetimeMs, Math.min(estimatedTime, pathfinderConfig.tempBlockMaxLifetimeMs));
        logger('info', `New path length is ${path.length}. Setting temporary block lifetime to ${timeout}ms.`);
        setTimeout(() => {
          temporaryBlocks = temporaryBlocks.filter((b) => b.id !== block.id);
          logger('info', `Dynamic timer expired for block at ${block.x},${block.y}.`);
          lastPlayerPosKey = null; // Force recalculation to use the now-unblocked tile.
        }, timeout);
        block.timerSet = true;
      }
    });

    // Send all the pathfinding results back to the main thread to update the Redux state.
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setPathfindingFeedback',
      payload: {
        pathWaypoints: path,
        wptDistance: distance,
        routeSearchMs: result.performance.totalTimeMs,
        pathfindingStatus: status,
      },
    });
  } catch (error) {
    logger('error', `Pathfinding error: ${error.message}`);
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setPathfindingFeedback',
      payload: { pathWaypoints: [], wptDistance: null, pathfindingStatus: 'ERROR' },
    });
  }
}

/**
 * The worker's entry point.
 */
function start() {
  logger('info', 'Pathfinder worker started.');
  loadAllMapData();
  if (!pathfinderInstance.isLoaded) {
    logger('error', 'Pathfinder did not load map data, worker will not function correctly.');
  }
}

/**
 * The main event listener for the worker. It receives the full application state
 * from the main thread whenever it changes.
 */
parentPort.on('message', (message) => {
  const oldState = state;
  state = message;

  // Always update the stand timer. It has its own internal logic to handle the enabled state.
  if (state.gameState?.playerMinimapPosition || oldState?.gameState?.playerMinimapPosition) {
    updateStandTimer();
  }

  // Only run the heavy pathfinding logic if the bot is actually enabled.
  if (state.cavebot?.enabled) {
    runPathfindingLogic();
  }

  // Check for stuck conditions if any relevant state has changed.
  if (
    state.cavebot?.enabled !== oldState?.cavebot?.enabled ||
    state.cavebot?.isActionPaused !== oldState?.cavebot?.isActionPaused ||
    state.cavebot?.wptDistance !== oldState?.cavebot?.wptDistance ||
    state.cavebot?.standTime !== oldState?.cavebot?.standTime ||
    state.statusMessages?.notPossible !== oldState?.statusMessages?.notPossible
  ) {
    handleStuckCondition();
  }
});

/**
 * Handles the worker's graceful shutdown.
 */
parentPort.on('close', () => {
  logger('info', 'Parent port closed. Stopping pathfinder worker.');
  process.exit(0);
});

/**
 * Top-level error handler to catch any unhandled exceptions during worker initialization.
 */
try {
  start();
} catch (err) {
  logger('error', `Pathfinder worker fatal error: ${err.message}`, err);
  if (parentPort) parentPort.postMessage({ fatalError: err.message || 'Unknown fatal error in worker' });
  process.exit(1);
}
