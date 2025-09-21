// /workers/cavebot/fsm.js

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
      execute: async (context) => {
        const { playerPos, targetWaypoint, status, chebyshevDist } = context;
        const { unreachableWaypointIds = [], waypointSections = {} } =
          workerState.globalState.cavebot;
        const allWaypoints = Object.values(waypointSections).flatMap(
          (section) => section.waypoints || [],
        );
        const waypointIndex = allWaypoints.findIndex(
          (wpt) => wpt.id === targetWaypoint.id,
        );

        logger(
          'debug',
          `[FSM] Evaluating waypoint index ${waypointIndex + 1} (${
            targetWaypoint.type
          }) with path status: ${status}`,
        );

        // Immediately skip if this waypoint is known to be unreachable
        if (unreachableWaypointIds.includes(targetWaypoint.id)) {
          logger(
            'info',
            `[FSM] Skipping known unreachable waypoint index ${
              waypointIndex + 1
            }.`,
          );
          await advanceToNextWaypoint(workerState, config, {
            skipCurrent: false,
          }); // Already marked, just advance
          return 'IDLE';
        }

        // Handle Script waypoints first, as they ignore pathfinding and position.
        if (targetWaypoint.type === 'Script') {
          logger(
            'debug',
            `[FSM] Waypoint index ${
              waypointIndex + 1
            } is a script. Transitioning to EXECUTING_SCRIPT.`,
          );
          return 'EXECUTING_SCRIPT';
        }

        // Case 1: We are already on the target waypoint.
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
              logger(
                'debug',
                '[FSM] Waypoint is a Stand action. Transitioning to PERFORMING_ACTION.',
              );
              return 'PERFORMING_ACTION';
            default: // For Ladder, Rope, Node, etc., being on the tile means we're done.
              logger(
                'debug',
                '[FSM] Actionless waypoint reached. Advancing to next.',
              );
              await advanceToNextWaypoint(workerState, config);
              return 'IDLE';
          }
        }

        // Case 2: We are not on the waypoint, so we must evaluate the path.
        switch (status) {
          case PATH_STATUS_PATH_FOUND:
            logger('debug', '[FSM] Path found.');
            const isAdjacent =
              typeof chebyshevDist === 'number' && chebyshevDist <= 1;
            const isActionType = [
              'Ladder',
              'Rope',
              'Shovel',
              'Machete',
              'Door',
            ].includes(targetWaypoint.type);

            if (isActionType && isAdjacent) {
              logger(
                'debug',
                `[FSM] Adjacent to action waypoint. Transitioning to PERFORMING_ACTION.`,
              );
              return 'PERFORMING_ACTION';
            }

            // Path is valid and we're not performing a special action, so walk.
            if (workerState.path && workerState.path.length > 1) {
              logger(
                'debug',
                `[FSM] Path is valid (length: ${workerState.path.length}). Transitioning to WALKING.`,
              );
              return 'WALKING';
            }
            // If path is stale or invalid, wait for a new one.
            logger(
              'debug',
              '[FSM] Path found, but length is too short. Requesting new path.',
            );
            workerState.shouldRequestNewPath = true;
            return 'EVALUATING_WAYPOINT';

          case PATH_STATUS_DIFFERENT_FLOOR:
            logger(
              'debug',
              '[FSM] Path status is DIFFERENT_FLOOR. Checking player Z-level.',
            );
            // If the pathfinder thinks we're on a different floor, but the core logic in index.js
            // confirms we are on the correct Z-level, it means the path is just stale.
            // We should wait for a new, correct path instead of skipping the waypoint.
            if (playerPos.z === targetWaypoint.z) {
              // DEADLOCK FIX: If we have a valid path despite the bad status, trust the path.
              // This handles cases where the pathfinder provides a correct path but an incorrect (stale) status.
              if (workerState.path && workerState.path.length > 1) {
                logger(
                  'warn',
                  '[FSM] Path status is DIFFERENT_FLOOR, but a valid path exists on the same Z-level. Overriding status and proceeding to WALK.',
                );
                return 'WALKING';
              }

              logger(
                'debug',
                '[FSM] Player Z matches waypoint Z. Path is stale. Requesting refresh.',
              );
              postStoreUpdate('cavebot/setForcePathRefresh', true);
              workerState.shouldRequestNewPath = true;
              return 'EVALUATING_WAYPOINT'; // Wait for a new path
            }
          // Fallthrough to default skip logic if Z-levels actually mismatch
          case PATH_STATUS_NO_PATH_FOUND:
          case PATH_STATUS_NO_VALID_START_OR_END:
          case PATH_STATUS_ERROR:
            logger(
              'warn',
              `[FSM] Unreachable waypoint index ${
                waypointIndex + 1
              } due to path status: ${status}. Skipping.`,
            );
            await advanceToNextWaypoint(workerState, config, {
              skipCurrent: true,
            });
            return 'IDLE';

          case PATH_STATUS_WAYPOINT_REACHED:
            logger(
              'debug',
              `[FSM] Path status is WAYPOINT_REACHED for index ${
                waypointIndex + 1
              }. Advancing.`,
            );
            // Pathfinder says we're there, but we're not exactly on the tile.
            // This is a success condition, so we advance.
            await advanceToNextWaypoint(workerState, config);
            return 'IDLE';

          case PATH_STATUS_IDLE:
          default:
            logger(
              'debug',
              `[FSM] Path status is ${status}. Waiting for pathfinder.`,
            );
            // Waiting for pathfinder.
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
          if (
            getDistance(workerState.playerMinimapPosition, targetWaypoint) >=
            config.teleportDistanceThreshold
          ) {
            logger(
              'debug',
              '[FSM] Teleport distance detected, applying grace period.',
            );
            // After a teleport-like action, give grace
            workerState.floorChangeGraceUntil =
              Date.now() + config.postTeleportGraceMs;
          }
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
