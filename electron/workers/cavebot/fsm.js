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
            case 'Ladder':
            case 'Rope':
            case 'Shovel':
              logger(
                'debug',
                `[FSM] Waypoint is a '${targetWaypoint.type}' action. Transitioning to PERFORMING_ACTION.`,
              );
              return 'PERFORMING_ACTION';
            default: // For Node, etc., being on the tile means we're done.
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
            let isAdjacent =
              typeof chebyshevDist === 'number' && chebyshevDist <= 1;
            const isActionType = [
              'Ladder',
              'Rope',
              'Shovel',
              'Machete',
              'Door',
            ].includes(targetWaypoint.type);

            // Exclude South-East tile for Ladders
            if (targetWaypoint.type === 'Ladder' && isAdjacent) {
              if (
                playerPos.x === targetWaypoint.x + 1 &&
                playerPos.y === targetWaypoint.y + 1
              ) {
                logger(
                  'debug',
                  '[FSM] Player is on the south-east tile of a ladder. Ignoring adjacency.',
                );
                isAdjacent = false;
              }
            }

            if (isActionType && isAdjacent) {
              logger(
                'debug',
                `[FSM] Adjacent to action waypoint. Transitioning to PERFORMING_ACTION.`,
              );
              return 'PERFORMING_ACTION';
            }

            // Path is valid and we're not performing a special action, so walk.
            const wptIdHash = targetWaypoint.id
              ? targetWaypoint.id.split('').reduce((a, b) => {
                  a = (a << 5) - a + b.charCodeAt(0);
                  return a & a;
                }, 0)
              : 0;

            if (
              workerState.path &&
              workerState.path.length > 1 &&
              workerState.pathWptId === wptIdHash
            ) {
              logger(
                'debug',
                `[FSM] Path is valid (length: ${workerState.path.length}, wptId: ${workerState.pathWptId}). Transitioning to WALKING.`,
              );
              return 'WALKING';
            } else if (workerState.path && workerState.path.length > 1) {
               console.log(`[Cavebot FSM] Stale path detected. Expected WptIdHash: ${wptIdHash}, but path has ${workerState.pathWptId}. Waiting for new path.`);
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
            // DEADLOCK FIX: Immediately invalidate our knowledge of the current waypoint.
            // This forces the main loop to re-evaluate `findCurrentWaypoint` on the next tick
            // and prevents us from getting stuck processing the waypoint we just decided to skip.
            workerState.lastProcessedWptId = null;
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
            `[FSM] Action '${targetWaypoint.type}' succeeded.`,
          );
          if (
            getDistance(workerState.playerMinimapPosition, targetWaypoint) >=
              config.teleportDistanceThreshold ||
            targetWaypoint.type === 'Ladder' || // Explicitly include Ladder type
            targetWaypoint.type === 'Rope' ||
            targetWaypoint.type === 'Shovel'
          ) {
            logger(
              'debug',
              '[FSM] Teleport-like action detected, transitioning to WAITING_FOR_CREATURE_MONITOR_SYNC.',
            );
            return 'WAITING_FOR_CREATURE_MONITOR_SYNC';
          } else {
            logger(
              'debug',
              '[FSM] Actionless waypoint reached. Advancing to next.',
            );
            await advanceToNextWaypoint(workerState, config);
            return 'IDLE';
          }
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
    WAITING_FOR_CREATURE_MONITOR_SYNC: {
      enter: () => {
        logger(
          'debug',
          '[FSM] Entering WAITING_FOR_CREATURE_MONITOR_SYNC state.',
        );
        postStoreUpdate('cavebot/setActionPaused', true); // Keep cavebot actions paused
        workerState.creatureMonitorSyncTimeout =
          Date.now() + config.creatureMonitorSyncTimeoutMs; // Set timeout
      },
      execute: async (context) => {
        const { playerPos } = context;
        const now = Date.now();

        // Check for timeout
        if (now >= workerState.creatureMonitorSyncTimeout) {
          logger(
            'warn',
            '[FSM] Timeout waiting for CreatureMonitor sync. Proceeding without explicit confirmation.',
          );
          await advanceToNextWaypoint(workerState, config); // Proceed anyway
          return 'IDLE';
        }

        // Read the last processed Z-level from CreatureMonitor via SAB
        const lastProcessedZ =
          workerState.sabStateManager.readCreatureMonitorLastProcessedZ();

        if (lastProcessedZ === playerPos.z) {
          logger(
            'info',
            '[FSM] CreatureMonitor sync confirmed for current Z-level. Advancing waypoint.',
          );
          await advanceToNextWaypoint(workerState, config);
          return 'IDLE';
        }

        logger(
          'debug',
          '[FSM] Waiting for CreatureMonitor to sync for current Z-level.',
        );
        await delay(config.stateChangePollIntervalMs); // Poll frequently
        return 'WAITING_FOR_CREATURE_MONITOR_SYNC'; // Stay in this state
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
