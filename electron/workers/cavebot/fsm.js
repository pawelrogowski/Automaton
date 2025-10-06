// /home/feiron/Dokumenty/Automaton/electron/workers/cavebot/fsm.js

import { postStoreUpdate } from './helpers/communication.js';
import { advanceToNextWaypoint } from './helpers/navigation.js';
import { delay } from './helpers/asyncUtils.js';
import { getDistance } from '../../utils/distance.js';
import {
  handleWalkAction,
  handleStandAction,
  handleLadderAction,
  handleRopeAction,
  handleShovelAction,
  handleMacheteAction,
  handleDoorAction,
  handleScriptAction,
} from './actionHandlers.js';
import { mapClickTick } from './helpers/mapClickController.js';
import {
  PATH_STATUS_PATH_FOUND,
  PATH_STATUS_WAYPOINT_REACHED,
  PATH_STATUS_NO_PATH_FOUND,
  PATH_STATUS_DIFFERENT_FLOOR,
  PATH_STATUS_ERROR,
  PATH_STATUS_NO_VALID_START_OR_END,
  PATH_STATUS_IDLE,
} from '../sharedConstants.js';

export function createFsm(workerState, config) {
  const logger = workerState.logger;
  return {
    IDLE: {
      enter: () => {
        logger('debug', '[FSM] Entering IDLE state.');
        postStoreUpdate('cavebot/setActionPaused', true);
      },
      execute: (context) => {
        if (context.targetWaypoint) {
          logger('debug', '[FSM] Target waypoint found, moving to EVALUATING_WAYPOINT.');
          return 'EVALUATING_WAYPOINT';
        }
        return 'IDLE';
      },
    },
    EVALUATING_WAYPOINT: {
      enter: () => {
        logger('debug', '[FSM] Entering EVALUATING_WAYPOINT state.');
        // Track when we entered this state for timeout detection
        workerState.evaluatingWaypointSince = Date.now();
      },
      execute: async (context) => {

        const { playerPos, targetWaypoint } = context;
        const { unreachableWaypointIds = [], waypointSections = {} } =
          workerState.globalState.cavebot;
        const allWaypoints = Object.values(waypointSections).flatMap(
          (section) => section.waypoints || [],
        );
        const waypointIndex = allWaypoints.findIndex(
          (wpt) => wpt.id === targetWaypoint.id,
        );

        // DEFENSIVE FIX: Timeout detection for infinite EVALUATING_WAYPOINT loops
        const now = Date.now();
        const timeInState = now - (workerState.evaluatingWaypointSince || now);
        if (timeInState > 5000) { // 5 second timeout
          logger(
            'warn',
            `[FSM] EVALUATING_WAYPOINT timeout after ${timeInState}ms for waypoint ${waypointIndex + 1}. Forcing path reset.`,
          );
          workerState.shouldRequestNewPath = true;
          workerState.evaluatingWaypointSince = now; // Reset timer
          return 'EVALUATING_WAYPOINT';
        }

        // 1. Determine the Desired State (Cavebot's Target)
        const desiredWptIdHash = targetWaypoint.id
          ? targetWaypoint.id.split('').reduce((a, b) => {
              a = (a << 5) - a + b.charCodeAt(0);
              return a & a;
            }, 0)
          : 0;

        // 2. Get the Actual State (Pathfinder's Current Work)
        const pathWptIdHash = workerState.pathWptId;
        const status = workerState.pathfindingStatus;

        // console.log("pathfindingStatus:",status)

        logger(
          'debug',
          `[FSM] Evaluating Wpt ${waypointIndex + 1}. Desired ID Hash: ${desiredWptIdHash}, Path ID Hash: ${pathWptIdHash}, Status: ${status}`,
        );

        // Immediately skip if this waypoint is known to be unreachable
        if (unreachableWaypointIds.includes(targetWaypoint.id)) {
          logger(
            'info',
            `[FSM] Skipping known unreachable waypoint index ${
              waypointIndex + 1
            }.`,
          );
          await advanceToNextWaypoint(workerState, config);
          return 'IDLE';
        }

        // Handle Script waypoints first, as they are special.
        if (targetWaypoint.type === 'Script') {
          return 'EXECUTING_SCRIPT';
        }

        // Check if we are already on the target waypoint.
        const isOnWaypoint =
          playerPos.x === targetWaypoint.x &&
          playerPos.y === targetWaypoint.y &&
          playerPos.z === targetWaypoint.z;

        if (isOnWaypoint) {
          logger(
            'debug',
            `[FSM] Player is already on waypoint index ${waypointIndex + 1}.`,
          );
          switch (targetWaypoint.type) {
            case 'Stand':
            case 'Ladder':
            case 'Rope':
            case 'Shovel':
              return 'PERFORMING_ACTION';
            default:
              await advanceToNextWaypoint(workerState, config);
              return 'IDLE';
          }
        }

        // 3. Compare Desired State vs. Actual State
        if (desiredWptIdHash !== pathWptIdHash) {
          // DIAGNOSTIC: Log hash mismatch for debugging
          if (timeInState > 1000) { // Only log after 1 second to avoid spam
            logger(
              'debug',
              `[FSM] Hash mismatch persisting for ${timeInState}ms: desired=${desiredWptIdHash}, actual=${pathWptIdHash}`,
            );
          }
          return 'EVALUATING_WAYPOINT'; // Stay in this state and wait.
        }

        // 4. IDs MATCH: Now we can trust the pathfinder's status for this waypoint.
        switch (status) {
          case PATH_STATUS_PATH_FOUND:
            if (workerState.path && workerState.path.length > 1) {
              // Adjacency check for special actions
              const isAdjacent = context.chebyshevDist <= 1;
              const isActionType = ['Ladder', 'Rope', 'Shovel', 'Machete', 'Door'].includes(targetWaypoint.type);

              // Special check for Ladder: if player is at +1,+1 (bottom-right diagonal) from ladder, skip action and proceed to walk
              if (
                targetWaypoint.type === 'Ladder' &&
                playerPos.x === targetWaypoint.x + 1 &&
                playerPos.y === targetWaypoint.y + 1
              ) {
                logger(
                  'debug',
                  `[FSM] Player at diagonal +1,+1 from Ladder waypoint index ${waypointIndex + 1}. Skipping action, proceeding to walk.`,
                );
                return 'WALKING';
              }

              if (isActionType && isAdjacent) {
                return 'PERFORMING_ACTION';
              }
              // Path is valid and for the correct waypoint. Let's walk.
              return 'WALKING';
            }
            // Path status is found, but array is not ready yet. Wait one more tick.
            return 'EVALUATING_WAYPOINT';

          case PATH_STATUS_NO_PATH_FOUND:
          case PATH_STATUS_DIFFERENT_FLOOR:
          case PATH_STATUS_ERROR:
          case PATH_STATUS_NO_VALID_START_OR_END:
            // The pathfinder confirms it cannot reach our CURRENT target. Skip it.
            logger(
              'warn',
              `[FSM] Unreachable waypoint index ${
                waypointIndex + 1
              } due to path status: ${status}. Skipping.`,
            );
            await advanceToNextWaypoint(workerState, config, { skipCurrent: true });
            return 'IDLE';

          case PATH_STATUS_WAYPOINT_REACHED:
            // The pathfinder confirms we have reached our CURRENT target. Advance.
            logger(
              'debug',
              `[FSM] Path status is WAYPOINT_REACHED for index ${
                waypointIndex + 1
              }. Advancing.`,
            );
            await advanceToNextWaypoint(workerState, config);
            return 'IDLE';

          case PATH_STATUS_IDLE:
          default:
            // The pathfinder is still working on our CURRENT target. Wait.
            logger(
              'debug',
              `[FSM] Path status is ${status}. Waiting for pathfinder.`,
            );
            return 'EVALUATING_WAYPOINT';
        }
      },
    },
    WALKING: {
      enter: () => {
        logger('debug', '[FSM] Entering WALKING state.');
        postStoreUpdate('cavebot/setActionPaused', false);
      },
      execute: async () => {
        // Delegate to map-click controller per spec. It returns whether to suppress keyboard this tick.
        // CRITICAL FIX: Now properly awaits the async mapClickTick to ensure mouse action completes
        const decision = await mapClickTick(workerState, config);
        if (decision === 'handled') {
          return 'EVALUATING_WAYPOINT';
        }
        try {
          await handleWalkAction(workerState, config);
        } catch (error) {
          logger(
            'warn',
            `[FSM] Walk action failed: ${error.message}. Re-evaluating.`,
          );
        }
        return 'EVALUATING_WAYPOINT';
      },
    },
    PERFORMING_ACTION: {
      enter: () => {
        logger('debug', '[FSM] Entering PERFORMING_ACTION state.');
        postStoreUpdate('cavebot/setActionPaused', true);
      },
      execute: async (context) => {
        const { targetWaypoint } = context;
        const { waypointSections = {} } = workerState.globalState.cavebot;
        const allWaypoints = Object.values(waypointSections).flatMap(
          (section) => section.waypoints || [],
        );
        const waypointIndex = allWaypoints.findIndex(
          (wpt) => wpt.id === targetWaypoint.id,
        );
        logger(
          'debug',
          `[FSM] Performing action '${targetWaypoint.type}' for waypoint index ${
            waypointIndex + 1
          }.`,
        );
        let actionSucceeded = false;
        const targetCoords = {
          x: targetWaypoint.x,
          y: targetWaypoint.y,
          z: targetWaypoint.z,
        };
        switch (targetWaypoint.type) {
          case 'Stand':
            actionSucceeded = await handleStandAction(
              workerState,
              config,
              targetWaypoint,
            );
            break;
          case 'Ladder':
            actionSucceeded = await handleLadderAction(
              workerState,
              config,
              targetCoords,
            );
            break;
          case 'Rope':
            actionSucceeded = await handleRopeAction(
              workerState,
              config,
              targetCoords,
            );
            break;
          case 'Shovel':
            actionSucceeded = await handleShovelAction(
              workerState,
              config,
              targetCoords,
            );
            break;
          case 'Machete':
            actionSucceeded = await handleMacheteAction(
              workerState,
              config,
              targetWaypoint,
            );
            break;
          case 'Door':
            actionSucceeded = await handleDoorAction(
              workerState,
              config,
              targetWaypoint,
            );
            break;
        }

        if (actionSucceeded) {
          logger(
            'debug',
            `[FSM] Action '${targetWaypoint.type}' succeeded. Advancing to next waypoint.`,
          );
          await advanceToNextWaypoint(workerState, config);
          return 'IDLE';
        } else {
          logger(
            'warn',
            `[FSM] Action '${
              targetWaypoint.type
            }' failed for waypoint index ${
              waypointIndex + 1
            }. Retrying after delay.`,
          );
          await delay(config.actionFailureRetryDelayMs);
          return 'EVALUATING_WAYPOINT';
        }
      },
    },
    EXECUTING_SCRIPT: {
      enter: () => {
        logger('debug', '[FSM] Entering EXECUTING_SCRIPT state.');
        postStoreUpdate('cavebot/setActionPaused', true);
      },
      execute: async (context) => {
        await handleScriptAction(workerState, config, context.targetWaypoint);
        return 'EVALUATING_WAYPOINT';
      },
    },
  };
}