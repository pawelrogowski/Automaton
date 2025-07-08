import { parentPort } from 'worker_threads';
import { createLogger } from '../utils/logger.js';
import keypress from 'keypress-native';
import { getAbsoluteClickCoordinates } from '../utils/minimapClickTranslator.js';
import mouseController from 'mouse-controller';
import { getAbsoluteGameWorldClickCoordinates } from '../utils/gameWorldClickTranslator.js';

const logger = createLogger({ info: true, error: true, debug: true });

// --- CONFIGURATION ---
const pathFollowerConfig = {
  /**
   * General Movement Settings
   */
  useMapclicks: true, // If true, the bot will prefer clicking on the minimap to move. If false, it will use keyboard only.
  switchToKeyboardDistance: 7, // When the bot is this many tiles (or closer) to the target waypoint, it switches to keyboard movement.
  // This helps with precision for the final steps.

  /**
   * Special Waypoint Handling
   */
  specialWaypointTypes: ['Stand', 'Machete', 'Rope', 'Shovel', 'Ladder'], // List of waypoint types that trigger special actions/delays.
  specialWaypointDelayMs: 500, // The delay (in milliseconds) applied specifically for 'Stand' waypoint types after arrival.

  /**
   * Walking Delays
   * These delays are applied after sending a keyboard movement command.
   */
  standardWalkDelayMs: 0, // Delay (in milliseconds) after a standard keyboard walk command.
  approachWalkDelayMs: 300, // Delay (in milliseconds) after a keyboard walk command when approaching the target waypoint.
  approachDistanceThreshold: 1, // The distance (in tiles) at which 'approachWalkDelayMs' is used instead of 'standardWalkDelayMs'.

  /**
   * Movement Timeout
   */
  moveTimeoutMs: 1500, // Maximum time (in milliseconds) to wait for the player character to move after a keyboard command.
  // If the character doesn't move within this time, it's considered stuck (handled by pathfinderWorker).

  /**
   * Map Click Settings
   */
  mapClickMaxDistance: 60, // Maximum distance (in tiles) from the player that a map click will be performed.
  // If the target is further, the bot will click a point closer to itself on the path.
  mapClickPostClickDelayMs: 100, // Delay (in milliseconds) after performing a map click to allow the game to register the click.
  mapClickStandTimeThresholdMs: 600, // If the character has been standing still for less than this time (in ms),
  // the bot assumes it's still walking from a previous map click and waits.

  /**
   * "There is no way" Message Handling
   */
  thereIsNoWayKeyboardOnlyDurationMs: 5000, // If a "There is no way" message is detected, the bot will force keyboard movement
  // for this duration (in milliseconds) to try and navigate around the obstacle.

  /**
   * Z-Level Change (Ladder/Shovel) Action Settings
   * These settings control the robust "fire-and-confirm" mechanism for Z-level changes.
   */
  zLevelChangeRetries: 5, // The maximum number of times to click and check for a Z-level change.
  zLevelChangeRetryDelayMs: 200, // The delay (in milliseconds) *between* each retry attempt (after a click and before checking Z-level).
  ladderClickPostClickDelayMs: 200, // An additional delay (in milliseconds) *after* a successful Z-level change is confirmed,
  // to allow the game client to fully stabilize on the new floor.
};
// --- END CONFIGURATION ---

// --- Worker State ---
let appState = null; // Holds the current application state received from the main thread.
let isFirstActionOnNewTarget = true; // Flag to ensure certain actions (like map clicks) only happen once per new target.

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
    isFirstActionOnNewTarget = true;
    parentPort.postMessage({ storeUpdate: true, type: 'cavebot/setwptId', payload: nextWpt.id });
  }
}
async function handleZLevelChangeAction(clickCoords, actionType) {
  const initialZ = appState.gameState.playerMinimapPosition.z;
  logger('info', `Performing '${actionType}' action, expecting Z-level change from ${initialZ}.`);
  for (let i = 0; i < pathFollowerConfig.zLevelChangeRetries; i++) {
    mouseController.rightClick(parseInt(appState.global.windowId, 10), clickCoords.x, clickCoords.y);
    await sleep(pathFollowerConfig.zLevelChangeRetryDelayMs);
    if (appState.gameState.playerMinimapPosition.z !== initialZ) {
      logger('info', `Z-level change successful! New Z: ${appState.gameState.playerMinimapPosition.z}`);
      await sleep(pathFollowerConfig.ladderClickPostClickDelayMs);
      return true;
    }
    logger('warn', `Attempt ${i + 1}/${pathFollowerConfig.zLevelChangeRetries}: Z-level did not change. Retrying...`);
  }
  logger('error', `Failed to change Z-level with '${actionType}' after ${pathFollowerConfig.zLevelChangeRetries} attempts.`);
  return false;
}

/**
 * The main logic loop for the path follower worker.
 */
async function mainLoop() {
  while (true) {
    await sleep(5);

    if (!appState || !appState.global?.windowId || !appState.cavebot?.enabled) continue;

    const { playerMinimapPosition } = appState.gameState;
    const { waypointSections, currentSection, wptId, pathWaypoints, wptDistance, standTime, pathfindingStatus } = appState.cavebot;
    const { statusMessages } = appState;
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
    if (pathfindingStatus === 'NO_PATH_FOUND') {
      logger('warn', `Pathfinder reported no path to waypoint ${targetWaypoint.id}. Skipping.`);
      advanceToNextWaypoint();
      continue;
    }

    // --- RESTRUCTURED LOGIC ---
    let actionTaken = false;

    // --- STEP 1: UNIFIED LADDER ACTION ---
    // This single block handles both approaching a ladder (to go up) and standing on one (to go down).
    if (targetWaypoint.type === 'Ladder') {
      const dx = Math.abs(playerMinimapPosition.x - targetWaypoint.x);
      const dy = Math.abs(playerMinimapPosition.y - targetWaypoint.y);
      const isAdjacentOrOnTop = dx <= 1 && dy <= 1;

      if (isAdjacentOrOnTop) {
        let clickTarget;
        let logMessage;

        if (dx === 0 && dy === 0) {
          // If we are ON the tile, we click our own position (e.g., to go down).
          clickTarget = playerMinimapPosition;
          logMessage = "On Ladder waypoint. Clicking player's tile.";
        } else {
          // If we are ADJACENT to the tile, we click the target's position (e.g., to go up).
          clickTarget = targetWaypoint;
          logMessage = 'Adjacent to Ladder waypoint. Clicking target tile.';
        }

        logger('info', logMessage);
        const clickCoords = getAbsoluteGameWorldClickCoordinates(clickTarget.x, clickTarget.y, playerMinimapPosition, 'bottomRight');

        if (clickCoords) {
          parentPort.postMessage({ storeUpdate: true, type: 'cavebot/setActionPaused', payload: true });
          try {
            await handleZLevelChangeAction(clickCoords, 'Ladder');
          } finally {
            parentPort.postMessage({ storeUpdate: true, type: 'cavebot/setActionPaused', payload: false });
          }
        }
        actionTaken = true;
      }
    }

    // --- STEP 2: OTHER "ARRIVED" ACTIONS ---
    // If no ladder action was taken, check for other actions that happen upon arrival.
    if (!actionTaken && wptDistance === 0) {
      logger('debug', `Arrived at waypoint ${targetWaypoint.id} (Type: ${targetWaypoint.type}).`);
      parentPort.postMessage({ storeUpdate: true, type: 'cavebot/setActionPaused', payload: true });
      try {
        if (targetWaypoint.type === 'Shovel') {
          logger('info', `On a ${targetWaypoint.type} waypoint. Clicking player's tile.`);
          const clickCoords = getAbsoluteGameWorldClickCoordinates(
            playerMinimapPosition.x,
            playerMinimapPosition.y,
            playerMinimapPosition,
            'center',
          );
          if (clickCoords) await handleZLevelChangeAction(clickCoords, targetWaypoint.type);
        } else if (targetWaypoint.type === 'Stand') {
          logger('info', `Executing 'Stand' waypoint. Waiting for ${pathFollowerConfig.specialWaypointDelayMs}ms.`);
          await sleep(pathFollowerConfig.specialWaypointDelayMs);
        } else if (targetWaypoint.type === 'Action') {
          logger('info', `Executing 'Action' waypoint.`);
          keypress.sendKey(parseInt(appState.global.windowId, 10), 'f12');
          await sleep(1500);
          keypress.sendKey(parseInt(appState.global.windowId, 10), 'f11');
          await sleep(100);
          keypress.sendKey(parseInt(appState.global.windowId, 10), 'f10');
          await sleep(100);
          keypress.sendKey(parseInt(appState.global.windowId, 10), 'f9');
        }
      } finally {
        parentPort.postMessage({ storeUpdate: true, type: 'cavebot/setActionPaused', payload: false });
      }
      actionTaken = true;
    }

    // If any special action was taken, advance to the next waypoint and restart the loop.
    if (actionTaken) {
      advanceToNextWaypoint();
      continue;
    }

    // --- STEP 3: GENERAL WALKING LOGIC ---
    // If no actions were taken, perform standard walking.
    if (pathWaypoints && pathWaypoints.length > 0) {
      const isThereNoWayRecent =
        statusMessages?.thereIsNoWay && Date.now() - statusMessages.thereIsNoWay < pathFollowerConfig.thereIsNoWayKeyboardOnlyDurationMs;
      const shouldUseKeyboard =
        isThereNoWayRecent || !pathFollowerConfig.useMapclicks || wptDistance < pathFollowerConfig.switchToKeyboardDistance;

      if (shouldUseKeyboard) {
        if (isThereNoWayRecent) logger('info', "'There is no way' detected. Forcing keyboard movement.");
        const nextStep = pathWaypoints[0];
        const positionBeforeMove = { ...playerMinimapPosition };
        const moveKey = getDirectionKey(positionBeforeMove, nextStep);
        if (!moveKey) {
          await sleep(50);
          continue;
        }
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
            logger('warn', `Keyboard move timed out. The pathfinder will detect this and find a new route.`);
            break;
          }
          await sleep(5);
        }
      } else {
        const isCharacterWalking = standTime < pathFollowerConfig.mapClickStandTimeThresholdMs;
        if (isCharacterWalking && !isFirstActionOnNewTarget) {
          await sleep(5);
          continue;
        }
        isFirstActionOnNewTarget = false;
        let clickTargetWaypoint = pathWaypoints[pathWaypoints.length - 1];
        for (let i = pathWaypoints.length - 1; i >= 0; i--) {
          if (getDistance(playerMinimapPosition, pathWaypoints[i]) <= pathFollowerConfig.mapClickMaxDistance) {
            clickTargetWaypoint = pathWaypoints[i];
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
    } else {
      logger('debug', `Awaiting path to ${targetWaypoint.id}...`);
      await sleep(50);
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
