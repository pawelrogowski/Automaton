import { parentPort } from 'worker_threads';
import { createLogger } from '../utils/logger.js';
import keypress from 'keypress-native';
import { getAbsoluteClickCoordinates } from '../utils/minimapClickTranslator.js';
import mouseController from 'mouse-controller';

const logger = createLogger({ info: true, error: true, debug: true });

// --- CONFIGURATION ---
const pathFollowerConfig = {
  useMapclicks: true,
  switchToKeyboardDistance: 4,
  specialWaypointTypes: ['Stand', 'Machete', 'Rope', 'Shovel'],
  specialWaypointDelayMs: 500,
  standardWalkDelayMs: 0,
  approachWalkDelayMs: 300,
  approachDistanceThreshold: 1,
  moveTimeoutMs: 500,
  mapClickMaxDistance: 60,
  mapClickPostClickDelayMs: 100,
  mapClickStandTimeThresholdMs: 600,
};
// --- END CONFIGURATION ---

// --- Worker State ---
let appState = null;
// --- THE DEFINITIVE FIX: A flag to grant a one-time bypass to the standTime check ---
let isFirstActionOnNewTarget = true;

// --- Helper Functions ---
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function getDistance(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}
function getDirectionKey(current, target) {
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
}
function advanceToNextWaypoint() {
  if (!appState || !appState.cavebot) return;
  const { waypointSections, currentSection, wptId } = appState.cavebot;
  const waypoints = waypointSections[currentSection]?.waypoints || [];
  if (waypoints.length === 0) return;
  const currentIndex = waypoints.findIndex((wp) => wp.id === wptId);
  if (currentIndex === -1) return;
  const nextIndex = (currentIndex + 1) % waypoints.length;
  const nextWpt = waypoints[nextIndex];
  if (nextWpt) {
    logger('info', `Advancing to next target: ${nextWpt.id}`);
    // --- SET THE BYPASS FLAG ---
    // When we ask for a new waypoint, we know the next action should be immediate.
    isFirstActionOnNewTarget = true;
    parentPort.postMessage({ storeUpdate: true, type: 'cavebot/setwptId', payload: nextWpt.id });
  }
}

/**
 * The main logic loop for the path follower.
 */
async function mainLoop() {
  while (true) {
    await sleep(5);

    if (!appState || !appState.global?.windowId || !appState.cavebot?.enabled) continue;

    const { playerMinimapPosition } = appState.gameState;
    const { waypointSections, currentSection, wptId, pathWaypoints, wptDistance, standTime } = appState.cavebot;
    const targetWaypoint = waypointSections[currentSection]?.waypoints.find((wp) => wp.id === wptId);
    const minimapRegionDef = appState.regionCoordinates?.regions?.minimapFull;

    if (!targetWaypoint || !minimapRegionDef) {
      await sleep(250);
      continue;
    }

    if (playerMinimapPosition.z !== targetWaypoint.z) {
      advanceToNextWaypoint();
      continue;
    }

    // --- 1. HANDLE ARRIVAL ---
    if (wptDistance === 0) {
      logger('info', `Arrival confirmed at waypoint ${targetWaypoint.id}.`);
      if (pathFollowerConfig.specialWaypointTypes.includes(targetWaypoint.type)) {
        await sleep(pathFollowerConfig.specialWaypointDelayMs);
      }
      advanceToNextWaypoint();
      continue;
    }

    // --- 2. HANDLE MOVEMENT (if path exists) ---
    if (pathWaypoints && pathWaypoints.length > 0) {
      const shouldUseKeyboard = !pathFollowerConfig.useMapclicks || wptDistance < pathFollowerConfig.switchToKeyboardDistance;

      if (shouldUseKeyboard) {
        // --- KEYBOARD LOGIC ---
        const positionBeforeMove = { ...playerMinimapPosition };
        const nextStep = pathWaypoints[0];
        const moveKey = getDirectionKey(positionBeforeMove, nextStep);
        if (!moveKey) continue;

        // Consume the bypass flag, as we are taking an action.
        isFirstActionOnNewTarget = false;

        const walkDelay =
          wptDistance <= pathFollowerConfig.approachDistanceThreshold
            ? pathFollowerConfig.approachWalkDelayMs
            : pathFollowerConfig.standardWalkDelayMs;

        const moveStartTime = Date.now();
        keypress.sendKey(parseInt(appState.global.windowId, 10), moveKey);
        await sleep(walkDelay);

        while (
          appState.gameState.playerMinimapPosition.x === positionBeforeMove.x &&
          appState.gameState.playerMinimapPosition.y === positionBeforeMove.y
        ) {
          if (Date.now() - moveStartTime > pathFollowerConfig.moveTimeoutMs) {
            logger('warn', 'Keyboard move timed out.');
            break;
          }
          await sleep(5);
        }
      } else {
        // --- MAP CLICK LOGIC ---
        // This is the safety check to prevent clicking while the game is already handling a walk.
        const isCharacterWalking = standTime < pathFollowerConfig.mapClickStandTimeThresholdMs;

        // This is the crucial check: We only wait IF the character is walking AND it's NOT the first action for a new target.
        if (isCharacterWalking && !isFirstActionOnNewTarget) {
          logger('debug', `Character is already walking from a previous map click. Waiting...`);
          await sleep(5);
          continue;
        }

        logger('info', `Initiating map click to target ${wptId}. Bypass flag: ${isFirstActionOnNewTarget}`);
        // Consume the bypass flag, as we are taking our one-time immediate action.
        isFirstActionOnNewTarget = false;

        let clickTargetWaypoint = pathWaypoints[pathWaypoints.length - 1];
        for (let i = pathWaypoints.length - 1; i >= 0; i--) {
          const waypoint = pathWaypoints[i];
          if (getDistance(playerMinimapPosition, waypoint) <= pathFollowerConfig.mapClickMaxDistance) {
            clickTargetWaypoint = waypoint;
            break;
          }
        }
        const clickCoords = getAbsoluteClickCoordinates(
          clickTargetWaypoint.x,
          clickTargetWaypoint.y,
          playerMinimapPosition,
          minimapRegionDef,
        );
        mouseController.leftClick(parseInt(appState.global.windowId, 10), clickCoords.x, clickCoords.y);
        await sleep(pathFollowerConfig.mapClickPostClickDelayMs);
      }
    }
    // --- 3. HANDLE WAITING FOR PATH ---
    else {
      logger('debug', `Awaiting path to ${targetWaypoint.id}...`);
      await sleep(5);
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

parentPort.on('message', (message) => {
  appState = message;
});
parentPort.on('close', () => {
  logger('info', 'Parent port closed. Stopping path follower worker.');
  process.exit(0);
});

start();
