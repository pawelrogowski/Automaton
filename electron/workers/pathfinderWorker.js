// pathfinderWorker.js (Final Production Version)

import { parentPort, workerData } from 'worker_threads';
import { createLogger } from '../utils/logger.js';
import { createRequire } from 'module';
import fs from 'fs/promises';
import path from 'path';

const logger = createLogger({ info: true, error: true, debug: false });
const require = createRequire(import.meta.url);

// --- Native Addon Initialization ---
let Pathfinder;
let pathfinderInstance;
try {
  if (!workerData?.paths?.pathfinder) {
    throw new Error('Path to native Pathfinder addon is missing from workerData.');
  }
  ({ Pathfinder } = require(workerData.paths.pathfinder));
  pathfinderInstance = new Pathfinder();
  logger('info', 'Native Pathfinder addon loaded successfully.');
} catch (e) {
  logger('error', `FATAL: Failed to load native Pathfinder module: ${e.message}`);
  if (parentPort) parentPort.postMessage({ fatalError: `Pathfinder addon failed: ${e.message}` });
  process.exit(1);
}

// --- Worker State ---
let state = null;
let lastPlayerPosKey = null;
let lastWaypointId = null;
let latestRequestId = 0;
const PREPROCESSED_BASE_DIR = path.join(process.cwd(), 'resources', 'preprocessed_minimaps');

/**
 * Loads all walkable.bin and walkable.json files into a format the C++ addon can consume.
 */
async function loadAllMapData() {
  if (pathfinderInstance.isLoaded) {
    logger('info', 'Pathfinding data already loaded into native module.');
    return;
  }
  logger('info', 'Loading pathfinding data for all Z-levels...');
  const mapDataForAddon = {};

  const zLevelDirs = (await fs.readdir(PREPROCESSED_BASE_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && d.name.startsWith('z'))
    .map((d) => d.name);

  for (const zDir of zLevelDirs) {
    const zLevel = parseInt(zDir.substring(1), 10);
    const zLevelPath = path.join(PREPROCESSED_BASE_DIR, zDir);
    try {
      const metadata = JSON.parse(await fs.readFile(path.join(zLevelPath, 'walkable.json'), 'utf8'));
      const grid = await fs.readFile(path.join(zLevelPath, 'walkable.bin'));
      mapDataForAddon[zLevel] = { ...metadata, grid };
    } catch (e) {
      if (e.code !== 'ENOENT') {
        logger('warn', `Could not load pathfinding data for Z=${zLevel}: ${e.message}`);
      }
    }
  }

  pathfinderInstance.loadMapData(mapDataForAddon);
  if (pathfinderInstance.isLoaded) {
    logger('info', `Pathfinding data successfully loaded into native module. Ready for path requests.`);
  } else {
    logger('error', 'Failed to load data into native module, even after processing files.');
  }
}

/**
 * The core logic loop for the cavebot pathfinder.
 */
async function processCavebotPathRequest() {
  const myRequestId = ++latestRequestId;
  const currentState = state;

  if (!currentState?.gameState?.playerMinimapPosition) {
    pathfinderInstance.cancelSearch();
    return;
  }

  const { waypoints, wptId } = currentState.cavebot;
  let targetWaypoint = null;

  if (wptId) {
    targetWaypoint = waypoints.find((wp) => wp.id === wptId);
  } else if (waypoints && waypoints.length > 0) {
    targetWaypoint = waypoints[0];
  }

  if (!targetWaypoint) {
    return;
  }

  const nonPathableTypes = ['Action', 'Lure'];
  if (nonPathableTypes.includes(targetWaypoint.type)) {
    // If the current waypoint doesn't require a path, we should clear any old path data.
    if (lastWaypointId !== targetWaypoint.id) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/setPathfindingFeedback',
        payload: { pathWaypoints: [], targetWpt: null, wptDistance: null },
      });
      lastWaypointId = targetWaypoint.id;
    }
    return;
  }

  const { x, y, z } = currentState.gameState.playerMinimapPosition;
  const currentPosKey = `${x},${y},${z}`;

  if (lastPlayerPosKey === currentPosKey && lastWaypointId === targetWaypoint.id) {
    return;
  }

  if (z !== targetWaypoint.z) {
    if (lastWaypointId !== targetWaypoint.id) {
      // Different Z-level, clear the path.
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/setPathfindingFeedback',
        payload: { pathWaypoints: [], wptDistance: null },
      });
    }
    lastPlayerPosKey = currentPosKey;
    lastWaypointId = targetWaypoint.id;
    return;
  }

  lastPlayerPosKey = currentPosKey;
  lastWaypointId = targetWaypoint.id;

  try {
    const result = await pathfinderInstance.findPath({ x, y, z }, { x: targetWaypoint.x, y: targetWaypoint.y, z: targetWaypoint.z });

    if (myRequestId !== latestRequestId) {
      return; // Stale result, discard.
    }

    // --- CORRECTED SECTION ---
    const path = result.path || [];

    // Add the correct 'z' coordinate to each node in the path, as the worker
    // knows which Z-level the pathfinding operation was performed on.
    const pathWithZ = path.map((node) => ({ ...node, z: targetWaypoint.z }));

    const distance = path.length > 0 ? path.length - 1 : result.reason === 'WAYPOINT_REACHED' ? 0 : null;

    // Send the enriched path (pathWithZ) in the payload to the main thread.
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setPathfindingFeedback',
      payload: {
        pathWaypoints: pathWithZ,
        wptDistance: distance,
        routeSearchMs: result.performance.totalTimeMs,
      },
    });
    // --- END OF CORRECTION ---
  } catch (error) {
    if (myRequestId === latestRequestId && error.message !== 'Search cancelled') {
      logger('error', `Pathfinding error: ${error.message}`);
      // On error, clear the path in the state.
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/setPathfindingFeedback',
        payload: { pathWaypoints: [], wptDistance: null },
      });
    }
  }
}

async function mainLoop() {
  while (true) {
    if (!pathfinderInstance.isLoaded) {
      logger('info', 'Pathfinder data not loaded yet. Waiting...');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    try {
      await processCavebotPathRequest();
    } catch (e) {
      logger('error', `Error in main loop: ${e.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function start() {
  logger('info', 'Pathfinder worker started.');
  await loadAllMapData();
  await mainLoop();
}

// --- Event Listeners ---
parentPort.on('message', (message) => {
  state = message;
});

parentPort.on('close', () => {
  logger('info', 'Parent port closed. Stopping pathfinder worker.');
  process.exit(0);
});

start().catch((err) => {
  logger('error', `Pathfinder worker fatal error: ${err.message}`, err);
  if (parentPort) parentPort.postMessage({ fatalError: err.message || 'Unknown fatal error in worker' });
  process.exit(1);
});
