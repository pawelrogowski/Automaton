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
  thereIsNoWayKeyboardOnlyDurationMs: 5000,
  notPossibleCooldownMs: 5000,
  blockedTileExpirationMs: 5000,
};
// --- END CONFIGURATION ---

// --- Worker State ---
let appState = null;
let isFirstActionOnNewTarget = true;
let lastNotPossibleHandledTimestamp = 0;
let temporaryBlocks = []; // In-memory list of temporarily blocked tiles

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

/**
 * The main logic loop for the path follower.
 */
async function mainLoop() {
  while (true) {
    await sleep(5);

    if (!appState || !appState.global?.windowId || !appState.cavebot?.enabled) continue;

    const { playerMinimapPosition } = appState.gameState;
    const { waypointSections, currentSection, wptId, pathWaypoints, wptDistance, standTime } = appState.cavebot;
    const { statusMessages } = appState;
    const targetWaypoint = waypointSections[currentSection]?.waypoints.find((wp) => wp.id === wptId);
    const minimapRegionDef = appState.regionCoordinates?.regions?.minimapFull;

    temporaryBlocks = temporaryBlocks.filter((block) => block.expiresAt > Date.now());

    if (!targetWaypoint || !minimapRegionDef) {
      await sleep(250);
      continue;
    }
    if (playerMinimapPosition.z !== targetWaypoint.z) {
      advanceToNextWaypoint();
      continue;
    }
    if (wptDistance === 0) {
      // --- CHANGE START: Handle 'Action' waypoint type ---
      if (pathFollowerConfig.specialWaypointTypes.includes(targetWaypoint.type)) {
        await sleep(pathFollowerConfig.specialWaypointDelayMs);
      } else if (targetWaypoint.type === 'Action') {
        logger('info', `Reached Action waypoint. Pressing F12.`);
        keypress.sendKey(parseInt(appState.global.windowId, 10), 'f12');
        await sleep(1500);
        keypress.sendKey(parseInt(appState.global.windowId, 10), 'f11');
        await sleep(100);
        keypress.sendKey(parseInt(appState.global.windowId, 10), 'f10');
        await sleep(100);
        keypress.sendKey(parseInt(appState.global.windowId, 10), 'f9');
      }
      // --- CHANGE END ---
      advanceToNextWaypoint();
      continue;
    }

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
          // This can happen if we are already on the next step. Wait for path update.
          await sleep(50);
          continue;
        }

        // --- ATTEMPT MOVE (Optimistic Approach) ---
        isFirstActionOnNewTarget = false;
        const walkDelay =
          wptDistance <= pathFollowerConfig.approachDistanceThreshold
            ? pathFollowerConfig.approachWalkDelayMs
            : pathFollowerConfig.standardWalkDelayMs;
        const moveStartTime = Date.now();
        keypress.sendKey(parseInt(appState.global.windowId, 10), moveKey);
        await sleep(walkDelay);

        // --- REACTIVE CHECK (Only runs if the move failed) ---
        while (
          appState.gameState.playerMinimapPosition.x === positionBeforeMove.x &&
          appState.gameState.playerMinimapPosition.y === positionBeforeMove.y
        ) {
          const now = Date.now();
          const notPossibleTimestamp = appState.statusMessages?.notPossible;
          const isNotPossibleDetected = notPossibleTimestamp && now - notPossibleTimestamp < 1000;
          const isCooldownOver = now - lastNotPossibleHandledTimestamp > pathFollowerConfig.notPossibleCooldownMs;

          // Check for failure conditions
          if ((isNotPossibleDetected && isCooldownOver) || now - moveStartTime > pathFollowerConfig.moveTimeoutMs) {
            if (isNotPossibleDetected) logger('warn', `'Not Possible' detected. Adding temporary block for [${nextStep.x},${nextStep.y}].`);
            else logger('warn', `Keyboard move timed out. Adding temporary block for [${nextStep.x},${nextStep.y}].`);

            // --- Define the action to take on failure ---
            const addBlockAndRecalculate = () => {
              lastNotPossibleHandledTimestamp = Date.now();
              const newBlock = {
                id: `temp-blocked-${nextStep.x}-${nextStep.y}-${playerMinimapPosition.z}`,
                x: nextStep.x,
                y: nextStep.y,
                z: playerMinimapPosition.z,
                avoidance: 10000,
                type: 'cavebot',
                expiresAt: now + pathFollowerConfig.blockedTileExpirationMs,
              };
              const existingBlockIndex = temporaryBlocks.findIndex((b) => b.id === newBlock.id);
              if (existingBlockIndex > -1) {
                temporaryBlocks[existingBlockIndex] = newBlock;
              } else {
                temporaryBlocks.push(newBlock);
              }

              const modifiedState = JSON.parse(JSON.stringify(appState));
              modifiedState.cavebot.specialAreas.push(...temporaryBlocks);
              parentPort.postMessage({ type: 'pathfinder/update', payload: modifiedState });
            };

            addBlockAndRecalculate();
            break; // Exit the "stuck" loop and wait for the new path to arrive.
          }
          await sleep(5);
        }
      } else {
        // --- MAP CLICKING LOGIC ---
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
