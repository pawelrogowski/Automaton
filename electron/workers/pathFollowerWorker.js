import { parentPort } from 'worker_threads';
import { createLogger } from '../utils/logger.js';
import keypress from 'keypress-native';

const logger = createLogger({ info: true, error: true, debug: false });

// --- CONFIGURATION ---
const SPECIAL_WAYPOINT_TYPES = ['Stand', 'Machete', 'Rope', 'Shovel'];
const SPECIAL_WAYPOINT_DELAY_MS = 400; // Delay upon ARRIVAL at a special waypoint.

// --- NEW FIXED SPEED CONFIGURATION ---
const STANDARD_WALK_DELAY_MS = 50; // Standard speed for normal pathing.
const APPROACH_WALK_DELAY_MS = 300; // Slower speed when approaching the target.
const APPROACH_DISTANCE_THRESHOLD = 2; // The distance (in tiles) at which to start slowing down.
const MOVE_TIMEOUT_MS = 1000; // Timeout before a move is considered failed/stuck.
// --- END CONFIGURATION ---

// --- Worker State ---
let appState = null;
// The `learnedMoveSpeedMs` variable is no longer needed.

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
  if (waypoints.length === 0) return;

  const currentIndex = waypoints.findIndex((wp) => wp.id === wptId);
  if (currentIndex === -1) return;

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

// The `isStraightPath` function is no longer needed.

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
    const { waypointSections, currentSection, wptId, pathWaypoints, wptDistance } = appState.cavebot;
    const targetWaypoint = waypointSections[currentSection]?.waypoints.find((wp) => wp.id === wptId);

    if (!targetWaypoint) {
      continue;
    }

    if (playerMinimapPosition.z !== targetWaypoint.z) {
      advanceToNextWaypoint();
      await sleep(100);
      continue;
    }

    if (pathWaypoints.length > 0) {
      // --- NEW SIMPLIFIED WALKING LOGIC ---
      const positionBeforeMove = { ...playerMinimapPosition };
      const nextStep = pathWaypoints[0];
      const moveKey = getDirectionKey(positionBeforeMove, nextStep);

      if (!moveKey) {
        continue; // Already at the next step, wait for path update
      }

      // Determine the correct delay based on the distance to the final waypoint.
      const walkDelay = wptDistance <= APPROACH_DISTANCE_THRESHOLD ? APPROACH_WALK_DELAY_MS : STANDARD_WALK_DELAY_MS;

      logger('info', `Walking. Distance: ${wptDistance}, Delay: ${walkDelay}ms`);

      const moveStartTime = Date.now();
      keypress.sendKey(parseInt(appState.global.windowId, 10), moveKey);

      // Wait for the determined duration.
      await sleep(walkDelay);

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
      // --- END NEW WALKING LOGIC ---
    } else {
      // --- ARRIVAL LOGIC ---
      // This block is only entered when the path is empty. We confirm arrival
      // by checking if the pathfinder has told us the distance is 0.
      if (wptDistance === 0) {
        logger('info', `Arrival confirmed at waypoint ${targetWaypoint.id}.`);

        // Handle special waypoint delays upon arrival.
        if (SPECIAL_WAYPOINT_TYPES.includes(targetWaypoint.type)) {
          logger('info', `Arrived at special waypoint "${targetWaypoint.type}". Pausing...`);
          await sleep(SPECIAL_WAYPOINT_DELAY_MS);
        }

        // Now that we've handled the arrival, advance to the next waypoint.
        advanceToNextWaypoint();
        await sleep(50);
      }
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
