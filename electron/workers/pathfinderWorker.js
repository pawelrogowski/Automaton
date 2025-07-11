import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { appendFile } from 'fs/promises';
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

// --- Worker Configuration ---
const { enableMemoryLogging = false } = workerData;

// --- Memory Usage Logging (Conditional) ---
const LOG_INTERVAL_MS = 10000; // 10 seconds
const LOG_FILE_NAME = 'pathfinder-worker-memory-usage.log';
const LOG_FILE_PATH = path.join(process.cwd(), LOG_FILE_NAME);
let lastLogTime = 0;

const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

async function logMemoryUsage() {
  try {
    const memoryUsage = process.memoryUsage();
    const timestamp = new Date().toISOString();
    const logEntry =
      `${timestamp} | ` +
      `RSS: ${toMB(memoryUsage.rss)} MB, ` +
      `HeapTotal: ${toMB(memoryUsage.heapTotal)} MB, ` +
      `HeapUsed: ${toMB(memoryUsage.heapUsed)} MB, ` +
      `External: ${toMB(memoryUsage.external)} MB\n`;

    await appendFile(LOG_FILE_PATH, logEntry);
  } catch (error) {
    console.error('[MemoryLogger] Failed to write to memory log file:', error);
  }
}
// --- End of Memory Usage Logging ---

const logger = createLogger({ info: true, error: true, debug: false });

// --- CONFIGURATION ---
const pathfinderConfig = {
  stuckTimeThresholdMs: 1000,
  stuckCooldownMs: 3000,
  notPossibleCooldownMs: 5000,
  notPossibleMessageLingerMs: 1000,
  tempBlockMinLifetimeMs: 2000,
  tempBlockMaxLifetimeMs: 10000,
  tempBlockMsPerStep: 800,
};
// --- END CONFIGURATION ---

// --- Native Addon Initialization ---
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
let state = null;
let lastPlayerPosKey = null;
let lastTargetWptId = null;
const lastJsonForType = new Map();
let lastMinimapPosKey = null;
let standStillStartTime = null;
let lastStandTimeUpdate = 0;
let temporaryBlocks = [];
let isApplyingTemporaryBlock = false;
let lastNotPossibleHandledTimestamp = 0;

const PREPROCESSED_BASE_DIR = path.join(process.cwd(), 'resources', 'preprocessed_minimaps');
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
    timerSet: false,
  });
  lastPlayerPosKey = null;
}

function handleStuckCondition() {
  if (!state || !state.cavebot || !state.statusMessages) return;
  const { enabled, isActionPaused, wptDistance, standTime, pathWaypoints } = state.cavebot;
  const { notPossible: notPossibleTimestamp } = state.statusMessages;
  const isPerformingIntentionalPause = !enabled || isActionPaused;
  const isPhysicallyStuck = wptDistance > 0 && standTime > pathfinderConfig.stuckTimeThresholdMs && !isPerformingIntentionalPause;
  const isNotPossibleRecent = notPossibleTimestamp && Date.now() - notPossibleTimestamp < pathfinderConfig.notPossibleMessageLingerMs;
  const isNotPossibleCooldownOver = Date.now() - lastNotPossibleHandledTimestamp > pathfinderConfig.notPossibleCooldownMs;
  const isNotPossibleTrigger = enabled && isNotPossibleRecent && isNotPossibleCooldownOver;

  if ((isPhysicallyStuck || isNotPossibleTrigger) && !isApplyingTemporaryBlock) {
    isApplyingTemporaryBlock = true;
    const blockedTile = pathWaypoints?.[0];
    if (blockedTile) {
      if (isPhysicallyStuck) {
        logger('warn', `Bot is stuck at [${blockedTile.x},${blockedTile.y}]. Applying temporary obstacle.`);
      } else {
        logger('warn', `'Not Possible' detected. Applying temporary obstacle at [${blockedTile.x},${blockedTile.y}].`);
        lastNotPossibleHandledTimestamp = Date.now();
      }
      addTemporaryBlock(blockedTile);
    }
    setTimeout(() => {
      isApplyingTemporaryBlock = false;
    }, pathfinderConfig.stuckCooldownMs);
  }
}

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

function runPathfindingLogic() {
  try {
    if (!state || !state.gameState?.playerMinimapPosition || !state.cavebot?.wptId) return;
    const { waypointSections, currentSection, wptId } = state.cavebot;
    const currentWaypoints = waypointSections[currentSection]?.waypoints || [];
    const targetWaypoint = currentWaypoints.find((wp) => wp.id === wptId);
    if (!targetWaypoint) return;

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

    const currentPosKey = `${x},${y},${z}`;
    if (lastPlayerPosKey === currentPosKey && lastTargetWptId === targetWaypoint.id) return;
    lastPlayerPosKey = currentPosKey;
    lastTargetWptId = targetWaypoint.id;

    const result = pathfinderInstance.findPathSync(
      { x, y, z },
      { x: targetWaypoint.x, y: targetWaypoint.y, z: targetWaypoint.z },
      { waypointType: targetWaypoint.type },
    );
    const path = result.path || [];
    const status = result.reason;
    const distance = status === 'NO_PATH_FOUND' ? null : path.length > 0 ? path.length : status === 'WAYPOINT_REACHED' ? 0 : null;

    temporaryBlocks.forEach((block) => {
      if (!block.timerSet) {
        const estimatedTime = path.length * pathfinderConfig.tempBlockMsPerStep;
        const timeout = Math.max(pathfinderConfig.tempBlockMinLifetimeMs, Math.min(estimatedTime, pathfinderConfig.tempBlockMaxLifetimeMs));
        logger('info', `New path length is ${path.length}. Setting temporary block lifetime to ${timeout}ms.`);
        setTimeout(() => {
          temporaryBlocks = temporaryBlocks.filter((b) => b.id !== block.id);
          logger('info', `Dynamic timer expired for block at ${block.x},${block.y}.`);
          lastPlayerPosKey = null;
        }, timeout);
        block.timerSet = true;
      }
    });

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

async function initializeWorker() {
  logger('info', 'Pathfinder worker starting up...');

  if (enableMemoryLogging) {
    try {
      const header = `\n--- New Session Started at ${new Date().toISOString()} ---\n`;
      await appendFile(LOG_FILE_PATH, header);
      logger('info', `[MemoryLogger] Memory usage logging is active. Outputting to ${LOG_FILE_PATH}`);
      lastLogTime = performance.now();
      await logMemoryUsage();
    } catch (error) {
      logger('error', `[MemoryLogger] Could not initialize memory log file: ${error}`);
    }
  }

  loadAllMapData();
  if (!pathfinderInstance.isLoaded) {
    logger('error', 'Pathfinder did not load map data, worker will not function correctly.');
  }
}

parentPort.on('message', async (message) => {
  // --- Integrated Memory Logging Check ---
  const now = performance.now();
  if (enableMemoryLogging && now - lastLogTime > LOG_INTERVAL_MS) {
    await logMemoryUsage();
    lastLogTime = now;
  }
  // --- End of Integrated Memory Logging Check ---

  const oldState = state;
  state = message;

  if (state.gameState?.playerMinimapPosition || oldState?.gameState?.playerMinimapPosition) {
    updateStandTimer();
  }

  if (state.cavebot?.enabled) {
    runPathfindingLogic();
  }

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

parentPort.on('close', () => {
  logger('info', 'Parent port closed. Stopping pathfinder worker.');
  process.exit(0);
});

(async () => {
  try {
    await initializeWorker();
  } catch (err) {
    logger('error', `Pathfinder worker fatal error: ${err.message}`, err);
    if (parentPort) parentPort.postMessage({ fatalError: err.message || 'Unknown fatal error in worker' });
    process.exit(1);
  }
})();
