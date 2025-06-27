// workers/pathFollowerWorker.js

import { parentPort, workerData } from 'worker_threads';
import { createLogger } from '../utils/logger.js';
import { createRequire } from 'module';

const logger = createLogger({ info: true, error: true, debug: false });
const require = createRequire(import.meta.url);

// --- CONFIGURATION ---
const SPECIAL_WAYPOINT_TYPES = ['Stand', 'Machete', 'Rope', 'Shovel'];
const SPECIAL_WAYPOINT_DELAY_MS = 500;

// --- ADAPTIVE LEARNING CONFIGURATION ---
// The bot's initial guess for move speed. It will learn and replace this value.
const INITIAL_MOVE_DURATION_MS = 250;
// A small safety buffer added to the learned speed for reliable walking on turns.
const SAFETY_BUFFER_MS = 50;
// Minimum path length required to enter high-speed "calibration" mode.
const CALIBRATION_PATH_LENGTH = 5;
// Timeout for a single move attempt before it's considered failed.
const MOVE_TIMEOUT_MS = 500;
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
let appState = null;
// This will store the character's measured move speed.
let learnedMoveSpeedMs = INITIAL_MOVE_DURATION_MS;

// --- Helper Functions ---
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function advanceToNextWaypoint() {
  logger('info', 'Advancing to the next waypoint.');
  if (!appState || !appState.cavebot) return;

  const { waypointSections, currentSection, wptId } = appState.cavebot;
  const waypoints = waypointSections[currentSection]?.waypoints || [];
  if (waypoints.length === 0) {
    return;
  }

  const currentIndex = waypoints.findIndex((wp) => wp.id === wptId);
  if (currentIndex === -1) {
    return;
  }

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
 * Checks if the next N steps in a path are in a straight line (horizontally, vertically, or diagonally).
 */
function isStraightPath(path, length) {
  if (!path || path.length < length) return false;

  // Need at least two points to determine a direction
  if (path.length < 2) return false;

  const firstStep = path[0];
  const secondStep = path[1];
  const dx = secondStep.x - firstStep.x;
  const dy = secondStep.y - firstStep.y;

  for (let i = 1; i < length - 1; i++) {
    // Check if we have enough elements for the next comparison
    if (i + 1 >= path.length) return false;

    const current = path[i];
    const next = path[i + 1];
    if (next.x - current.x !== dx || next.y - current.y !== dy) {
      return false;
    }
  }
  return true;
}

/**
 * The main logic loop for the path follower.
 */
async function mainLoop() {
  while (true) {
    await sleep(10);

    if (!appState || !appState.global?.windowId || !appState.cavebot?.enabled) {
      continue;
    }

    const { playerMinimapPosition } = appState.gameState;
    const { waypointSections, currentSection, wptId, pathWaypoints } = appState.cavebot;
    const targetWaypoint = waypointSections[currentSection]?.waypoints.find((wp) => wp.id === wptId);

    if (!targetWaypoint) {
      continue;
    }

    if (playerMinimapPosition.z !== targetWaypoint.z) {
      advanceToNextWaypoint();
      await sleep(10);
      continue;
    }

    if (pathWaypoints.length > 0) {
      const positionBeforeMove = { ...playerMinimapPosition };
      const nextStep = pathWaypoints[0];
      const moveKey = getDirectionKey(positionBeforeMove, nextStep);

      if (!moveKey) {
        continue;
      } // Already at the next step, wait for path update

      const isLastStep = pathWaypoints.length === 1;
      const isSpecialTarget = SPECIAL_WAYPOINT_TYPES.includes(targetWaypoint.type);
      const isCalibrating = isStraightPath(pathWaypoints, CALIBRATION_PATH_LENGTH);

      // --- Mode 3: The Specialist (Final move to special waypoint) ---
      if (isLastStep && isSpecialTarget) {
        logger('info', `Performing final move to special waypoint "${targetWaypoint.type}".`);
        keypress.sendKey(parseInt(appState.global.windowId, 10), moveKey);
        console.log(moveKey, 'calibration');
        await sleep(SPECIAL_WAYPOINT_DELAY_MS);

        // --- Mode 1: The Calibrator (High-speed on straight paths) ---
      } else if (isCalibrating) {
        const moveStartTime = Date.now();
        keypress.sendKey(parseInt(appState.global.windowId, 10), moveKey);
        console.log(moveKey, 'calibration');
        // Fast polling loop to precisely measure move time
        while (
          appState.gameState.playerMinimapPosition.x === positionBeforeMove.x &&
          appState.gameState.playerMinimapPosition.y === positionBeforeMove.y
        ) {
          if (Date.now() - moveStartTime > MOVE_TIMEOUT_MS) {
            logger('warn', 'Calibration move timed out.');
            break;
          }
          await sleep(5); // Poll very quickly
        }

        // If move was successful, update our learned speed
        if (
          appState.gameState.playerMinimapPosition.x !== positionBeforeMove.x ||
          appState.gameState.playerMinimapPosition.y !== positionBeforeMove.y
        ) {
          const duration = Date.now() - moveStartTime;
          // Use a moving average to smooth out the learned speed and prevent wild fluctuations
          learnedMoveSpeedMs = Math.round((learnedMoveSpeedMs * 3 + duration) / 4);
          logger('info', `Move confirmed in ${duration}ms. New learned speed: ${learnedMoveSpeedMs}ms.`);
        }

        // --- Mode 2: The Pacer (Reliable walking on turns or short paths) ---
      } else {
        logger('info', `Pacing move with learned speed: ${learnedMoveSpeedMs}ms`);
        const moveStartTime = Date.now();
        keypress.sendKey(parseInt(appState.global.windowId, 10), moveKey);

        // Wait for the learned duration + a safety buffer. This prevents double-stepping.
        await sleep(learnedMoveSpeedMs + SAFETY_BUFFER_MS);

        // After the wait, quickly check to ensure the move actually happened, in case of lag.
        while (
          appState.gameState.playerMinimapPosition.x === positionBeforeMove.x &&
          appState.gameState.playerMinimapPosition.y === positionBeforeMove.y
        ) {
          if (Date.now() - moveStartTime > MOVE_TIMEOUT_MS) {
            logger('warn', 'Paced move timed out. Character may be stuck.');
            break;
          }
          await sleep(20);
        }
      }
    } else {
      // --- ARRIVAL LOGIC ---
      // This block is now only for special waypoints that are reached normally (no Z change)
      if (SPECIAL_WAYPOINT_TYPES.includes(targetWaypoint.type)) {
        logger('info', `Arrived at special waypoint "${targetWaypoint.type}". Pausing...`);
        await sleep(SPECIAL_WAYPOINT_DELAY_MS);
      }
      advanceToNextWaypoint();
      await sleep(20);
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
