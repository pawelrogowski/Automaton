import { parentPort, workerData } from 'worker_threads';
import { createLogger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import Pathfinder from 'pathfinder-native';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger({ info: true, error: true, debug: false });

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

// --- State for Stand Timer ---
let lastMinimapPosKey = null;
let standStillStartTime = null;
let lastStandTimeUpdate = 0;

// --- Internal State for "Stuck" Logic ---
let temporaryBlocks = [];
let isApplyingTemporaryBlock = false;

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

// This function now ONLY adds a block. The timer is set later.
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
    timerSet: false, // NEW: Flag to indicate the removal timer has not been set yet.
  });
  // Force an immediate path recalculation
  lastPlayerPosKey = null;
}

function handleStuckCondition() {
  if (!state || !state.cavebot) return;

  const { enabled, wptDistance, standTime, pathWaypoints } = state.cavebot;
  const isStuck = enabled && wptDistance > 0 && standTime > 1000;

  if (isStuck && !isApplyingTemporaryBlock) {
    isApplyingTemporaryBlock = true;

    const blockedTile = pathWaypoints[0];
    if (blockedTile) {
      logger('warn', `Bot is stuck at ${blockedTile.x},${blockedTile.y}. Applying temporary obstacle.`);
      addTemporaryBlock(blockedTile);
    }

    // Use a simple cooldown on the trigger itself to prevent spamming.
    // The actual block lifetime is now dynamic.
    setTimeout(() => {
      isApplyingTemporaryBlock = false;
    }, 3000);
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
          payload: { pathWaypoints: [], wptDistance: null },
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
    const distance = path.length > 0 ? path.length : result.reason === 'WAYPOINT_REACHED' ? 0 : null;

    // --- NEW LOGIC: Set dynamic timeout AFTER path is calculated ---
    temporaryBlocks.forEach((block) => {
      if (!block.timerSet) {
        // Estimate time to walk the new path (e.g., 300ms per step)
        const estimatedTime = path.length * 300;
        // Apply safety rails: min 2 seconds, max 10 seconds
        const timeout = Math.max(2000, Math.min(estimatedTime, 10000));

        logger('info', `New path length is ${path.length}. Setting temporary block lifetime to ${timeout}ms.`);

        setTimeout(() => {
          temporaryBlocks = temporaryBlocks.filter((b) => b.id !== block.id);
          logger('info', `Dynamic timer expired for block at ${block.x},${block.y}.`);
          // Force another recalculation to allow pathing through the tile again
          lastPlayerPosKey = null;
        }, timeout);

        block.timerSet = true; // Mark the timer as set
      }
    });

    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setPathfindingFeedback',
      payload: { pathWaypoints: path, wptDistance: distance, routeSearchMs: result.performance.totalTimeMs },
    });
  } catch (error) {
    logger('error', `Pathfinding error: ${error.message}`);
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setPathfindingFeedback',
      payload: { pathWaypoints: [], wptDistance: null },
    });
  }
}

function start() {
  logger('info', 'Pathfinder worker started.');
  loadAllMapData();
  if (pathfinderInstance.isLoaded) {
    setInterval(() => {
      handleStuckCondition();
      runPathfindingLogic();
      updateStandTimer();
    }, 100);
  } else {
    logger('error', 'Pathfinder did not load map data, main loop will not start.');
  }
}

parentPort.on('message', (message) => {
  state = message;
});
parentPort.on('close', () => {
  logger('info', 'Parent port closed. Stopping pathfinder worker.');
  process.exit(0);
});

try {
  start();
} catch (err) {
  logger('error', `Pathfinder worker fatal error: ${err.message}`, err);
  if (parentPort) parentPort.postMessage({ fatalError: err.message || 'Unknown fatal error in worker' });
  process.exit(1);
}
