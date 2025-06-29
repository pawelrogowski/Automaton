import { parentPort, workerData } from 'worker_threads';
import { createLogger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import Pathfinder from 'pathfinder-native';

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

function loadAllMapData() {
  if (pathfinderInstance.isLoaded) {
    logger('info', 'Pathfinding data already loaded into native module.');
    return;
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
        if (e.code !== 'ENOENT') {
          logger('warn', `Could not load pathfinding data for Z=${zLevel}: ${e.message}`);
        }
      }
    }

    pathfinderInstance.loadMapData(mapDataForAddon);
    if (pathfinderInstance.isLoaded) {
      logger('info', 'Pathfinding data successfully loaded into native module. Ready for path requests.');
    } else {
      logger('error', 'Failed to load data into native module, even after processing files.');
    }
  } catch (e) {
    logger('error', `Critical error during map data loading: ${e.message}`);
    if (parentPort) parentPort.postMessage({ fatalError: 'Failed to load pathfinding map data.' });
    process.exit(1);
  }
}

function runPathfindingLogic() {
  try {
    if (!state || !state.gameState?.playerMinimapPosition || !state.cavebot?.wptId) {
      return;
    }

    const { waypointSections, currentSection, wptId } = state.cavebot;
    const currentWaypoints = waypointSections[currentSection]?.waypoints || [];
    const targetWaypoint = currentWaypoints.find((wp) => wp.id === wptId);

    if (!targetWaypoint) {
      return;
    }

    const requiredAvoidanceType = WAYPOINT_AVOIDANCE_MAP[targetWaypoint.type];
    if (requiredAvoidanceType) {
      const relevantAreas = (state.cavebot?.specialAreas || []).filter((area) => area.enabled && area.type === requiredAvoidanceType);

      const currentJson = JSON.stringify(relevantAreas);

      if (currentJson !== lastJsonForType.get(requiredAvoidanceType)) {
        logger('info', `Special areas for type "${requiredAvoidanceType}" have changed. Updating native cache...`);

        // --- THE FIX: Map the data to the format C++ expects ---
        const areasForNative = relevantAreas.map((area) => ({
          x: area.x,
          y: area.y,
          z: area.z,
          avoidance: area.avoidance,
          // Translate sizeX/sizeY to width/height
          width: area.sizeX,
          height: area.sizeY,
        }));

        // Pass the correctly formatted data to the native module
        pathfinderInstance.updateSpecialAreas(areasForNative);

        // This line will now be reached, fixing the infinite loop.
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
    if (lastPlayerPosKey === currentPosKey && lastTargetWptId === targetWaypoint.id) {
      return;
    }

    lastPlayerPosKey = currentPosKey;
    lastTargetWptId = targetWaypoint.id;

    const result = pathfinderInstance.findPathSync(
      { x, y, z },
      { x: targetWaypoint.x, y: targetWaypoint.y, z: targetWaypoint.z },
      { waypointType: targetWaypoint.type },
    );

    const path = result.path || [];
    const distance = path.length > 0 ? path.length : result.reason === 'WAYPOINT_REACHED' ? 0 : null;

    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setPathfindingFeedback',
      payload: {
        pathWaypoints: path,
        wptDistance: distance,
        routeSearchMs: result.performance.totalTimeMs,
      },
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
    setInterval(runPathfindingLogic, 100);
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
