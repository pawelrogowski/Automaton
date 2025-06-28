import { parentPort } from 'worker_threads';
import { createLogger } from '../utils/logger.js';
import keypress from 'keypress-native';

const logger = createLogger({ info: true, error: true, debug: false });

// --- CONFIGURATION ---
const SPECIAL_WAYPOINT_TYPES = ['Stand', 'Machete', 'Rope', 'Shovel'];
const SPECIAL_WAYPOINT_DELAY_MS = 500;

// --- ADAPTIVE LEARNING CONFIGURATION ---
const INITIAL_MOVE_DURATION_MS = 250;
const SAFETY_BUFFER_MS = 50;
const CALIBRATION_PATH_LENGTH = 5;
const MOVE_TIMEOUT_MS = 500;
// --- END CONFIGURATION ---

// --- Worker State ---
let appState = null;
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

function isStraightPath(path, length) {
  if (!path || path.length < length) return false;
  if (path.length < 2) return false;

  const firstStep = path[0];
  const secondStep = path[1];
  const dx = secondStep.x - firstStep.x;
  const dy = secondStep.y - firstStep.y;

  for (let i = 1; i < length - 1; i++) {
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
    // Destructure wptDistance here. This is crucial for the fix.
    const { waypointSections, currentSection, wptId, pathWaypoints, wptDistance } = appState.cavebot;
    const targetWaypoint = waypointSections[currentSection]?.waypoints.find((wp) => wp.id === wptId);

    if (!targetWaypoint) {
      continue;
    }

    // Check for Z-level mismatch. This logic is correct.
    if (playerMinimapPosition.z !== targetWaypoint.z) {
      advanceToNextWaypoint();
      // Add a slightly longer delay for Z-level changes to allow state to settle
      await sleep(100);
      continue;
    }

    // This block handles walking along a calculated path. It is unchanged and correct.
    if (pathWaypoints.length > 0) {
      const positionBeforeMove = { ...playerMinimapPosition };
      const nextStep = pathWaypoints[0];
      const moveKey = getDirectionKey(positionBeforeMove, nextStep);

      if (!moveKey) {
        continue; // Already at the next step, wait for path update
      }

      const isLastStep = pathWaypoints.length === 1;
      const isSpecialTarget = SPECIAL_WAYPOINT_TYPES.includes(targetWaypoint.type);
      const isCalibrating = isStraightPath(pathWaypoints, CALIBRATION_PATH_LENGTH);

      // --- Mode 3: The Specialist (Final move to special waypoint) ---
      if (isLastStep && isSpecialTarget) {
        logger('info', `Performing final move to special waypoint "${targetWaypoint.type}".`);
        keypress.sendKey(parseInt(appState.global.windowId, 10), moveKey);
        await sleep(SPECIAL_WAYPOINT_DELAY_MS);

        // --- Mode 1: The Calibrator (High-speed on straight paths) ---
      } else if (isCalibrating) {
        const moveStartTime = Date.now();
        keypress.sendKey(parseInt(appState.global.windowId, 10), moveKey);
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
          learnedMoveSpeedMs = Math.round((learnedMoveSpeedMs * 3 + duration) / 4);
          logger('info', `Move confirmed in ${duration}ms. New learned speed: ${learnedMoveSpeedMs}ms.`);
        }

        // --- Mode 2: The Pacer (Reliable walking on turns or short paths) ---
      } else {
        logger('info', `Pacing move with learned speed: ${learnedMoveSpeedMs}ms`);
        const moveStartTime = Date.now();
        keypress.sendKey(parseInt(appState.global.windowId, 10), moveKey);
        await sleep(learnedMoveSpeedMs + SAFETY_BUFFER_MS);

        // After the wait, quickly check to ensure the move actually happened
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
      // --- ROBUST ARRIVAL LOGIC (THE FIX) ---
      // This block now handles two cases:
      // 1. We have genuinely arrived at the waypoint (`wptDistance === 0`).
      // 2. We are waiting for the pathfinder to generate a new path (`wptDistance` is null or > 0).

      // Condition for being TRULY "at" the waypoint. This is an unambiguous signal from the pathfinder.
      if (wptDistance === 0) {
        logger('info', `Arrival confirmed at waypoint ${targetWaypoint.id}.`);
        // Handle special waypoint delays upon arrival.
        if (SPECIAL_WAYPOINT_TYPES.includes(targetWaypoint.type)) {
          logger('info', `Arrived at special waypoint "${targetWaypoint.type}". Pausing...`);
          await sleep(SPECIAL_WAYPOINT_DELAY_MS);
        }
        // Now that we've handled the arrival, advance to the next waypoint.
        advanceToNextWaypoint();
        await sleep(50); // A small delay to allow the state update to be dispatched.
      }
      // If pathWaypoints is empty but wptDistance is NOT 0 (i.e., it's null or > 0),
      // it means we are waiting for the pathfinder. In this case, we do nothing and
      // simply let the loop continue, effectively polling for the new path. This
      // prevents the race condition.
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
