// workers/pathFollowerWorker.js

import { parentPort, workerData } from 'worker_threads';
import { createLogger } from '../utils/logger.js';
import { createRequire } from 'module';

const logger = createLogger({ info: true, error: true, debug: false });
const require = createRequire(import.meta.url);

// --- CONFIGURATION ---
// The delay between each individual step (e.g., between pressing 'w' and then 'd').
const KEYPRESS_DELAY_MS = 5;

// Add waypoint types here that require an EXTRA pause after the character arrives.
const SPECIAL_WAYPOINT_TYPES = ['Stand', 'Machete', 'Rope', 'Shovel'];

// The duration of the EXTRA pause in milliseconds for the special types above.
const SPECIAL_WAYPOINT_DELAY_MS = 100;
// --- END CONFIGURATION ---

// --- Native Addon Initialization ---
let keypress;
try {
  if (!workerData?.paths?.keypress) {
    throw new Error('Path to native keypress addon is missing from workerData.');
  }
  keypress = require(workerData.paths.keypress);
  logger('info', 'Native keypress addon loaded successfully.');
} catch (e) {
  logger('error', `FATAL: Failed to load native keypress module: ${e.message}`);
  if (parentPort) parentPort.postMessage({ fatalError: `Keypress addon failed: ${e.message}` });
  process.exit(1);
}

// --- Worker State ---
let appState = null; // The entire Redux state from the main thread

// --- Helper Functions ---
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calculates the direction from current to target and returns the corresponding keyboard key.
 */
function getDirectionKey(current, target) {
  const dx = target.x - current.x;
  const dy = target.y - current.y;

  if (dy < 0) {
    // North
    if (dx < 0) return 'q'; // NW
    if (dx === 0) return 'w'; // N
    if (dx > 0) return 'e'; // NE
  } else if (dy === 0) {
    // Middle
    if (dx < 0) return 'a'; // W
    if (dx === 0) return null;
    if (dx > 0) return 'd'; // E
  } else if (dy > 0) {
    // South
    if (dx < 0) return 'z'; // SW
    if (dx === 0) return 's'; // S
    if (dx > 0) return 'c'; // SE
  }
  return null;
}

/**
 * Dispatches an action to move to the next waypoint in the current section.
 */
function advanceToNextWaypoint() {
  logger('info', 'Advancing to the next waypoint.');
  if (!appState || !appState.cavebot) return;

  const { waypointSections, currentSection, wptId } = appState.cavebot;
  const waypoints = waypointSections[currentSection]?.waypoints || [];
  if (waypoints.length === 0) {
    logger('warn', 'Cannot advance, no waypoints in current section.');
    return;
  }

  const currentIndex = waypoints.findIndex((wp) => wp.id === wptId);
  if (currentIndex === -1) {
    logger('warn', 'Current waypoint ID not found in list, cannot advance.');
    return;
  }

  // Loop back to the start if at the end
  const nextIndex = (currentIndex + 1) % waypoints.length;
  const nextWpt = waypoints[nextIndex];

  if (nextWpt) {
    logger('info', `Setting next waypoint target to: ${nextWpt.id} (${nextIndex + 1}/${waypoints.length})`);
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setwptId',
      payload: nextWpt.id,
    });
  }
}

/**
 * The main logic loop for the path follower.
 */
async function mainLoop() {
  while (true) {
    // 1. Always wait for the standard delay to avoid spamming keypresses.
    await sleep(KEYPRESS_DELAY_MS);

    // 2. Check for valid conditions to operate.
    if (!appState || !appState.global?.windowId || !appState.cavebot?.enabled) {
      continue;
    }

    // 3. Get all necessary state variables for this cycle.
    const { playerMinimapPosition } = appState.gameState;
    const { waypointSections, currentSection, wptId, pathWaypoints } = appState.cavebot;
    const targetWaypoint = waypointSections[currentSection]?.waypoints.find((wp) => wp.id === wptId);

    // 4. High-priority checks before doing anything.
    if (!targetWaypoint) {
      logger('warn', 'Cannot act, target waypoint not found.');
      continue;
    }

    if (playerMinimapPosition.z !== targetWaypoint.z) {
      logger('warn', `Z-level mismatch. Player Z: ${playerMinimapPosition.z}, Waypoint Z: ${targetWaypoint.z}. Advancing.`);
      advanceToNextWaypoint();
      await sleep(500); // Wait a moment for the state to update.
      continue;
    }

    // 5. Core logic: Decide whether to move or handle arrival.
    if (pathWaypoints.length > 0) {
      // --- ACTION: We have a path, so we need to move. ---
      const nextStep = pathWaypoints[0]; // Always take the first step of the current path.
      const moveKey = getDirectionKey(playerMinimapPosition, nextStep);

      if (moveKey) {
        keypress.sendKey(parseInt(appState.global.windowId, 10), moveKey);
      } else {
        logger('warn', 'Pathfinder provided current position as next step. Waiting for path update.');
      }
    } else {
      // --- ACTION: No path exists, which means we have arrived. ---
      logger('info', 'Path is empty, assuming arrival at destination.');

      // Check for special waypoint type and apply extra delay if needed.
      if (SPECIAL_WAYPOINT_TYPES.includes(targetWaypoint.type)) {
        logger('info', `Arrived at special waypoint "${targetWaypoint.type}". Pausing for ${SPECIAL_WAYPOINT_DELAY_MS}ms.`);
        await sleep(SPECIAL_WAYPOINT_DELAY_MS);
      }

      // Advance to the next waypoint.
      advanceToNextWaypoint();

      // Wait briefly for the pathfinder to generate a new path for the new target.
      await sleep(500);
    }
  }
}

async function start() {
  logger('info', 'Path Follower worker started.');
  mainLoop().catch((e) => {
    logger('error', 'Critical error in main loop:', e);
    if (parentPort) parentPort.postMessage({ fatalError: 'Path Follower worker main loop crashed.' });
    process.exit(1);
  });
}

// --- Event Listeners ---
parentPort.on('message', (message) => {
  appState = message;
});

parentPort.on('close', () => {
  logger('info', 'Parent port closed. Stopping path follower worker.');
  process.exit(0);
});

start();
