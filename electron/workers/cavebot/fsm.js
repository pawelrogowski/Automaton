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
      enter: () => postStoreUpdate('cavebot/setActionPaused', true),
      execute: (context) =>
        context.targetWaypoint ? 'EVALUATING_WAYPOINT' : 'IDLE',
    },
    EVALUATING_WAYPOINT: {
      execute: async (context) => {
        const { playerPos, targetWaypoint, status, chebyshevDist } = context;

        // Handle Script waypoints first, as they ignore pathfinding and position.
        if (targetWaypoint.type === 'Script') {
          return 'EXECUTING_SCRIPT';
        }

        // Case 1: We are already on the target waypoint.
        const isOnWaypoint =
          playerPos.x === targetWaypoint.x &&
          playerPos.y === targetWaypoint.y &&
          playerPos.z === targetWaypoint.z;

        if (isOnWaypoint) {
          switch (targetWaypoint.type) {
            case 'Stand':
              return 'PERFORMING_ACTION';
            default: // For Ladder, Rope, Node, etc., being on the tile means we're done.
              await advanceToNextWaypoint(workerState, config);
              return 'IDLE';
          }
        }

        // Case 2: We are not on the waypoint, so we must evaluate the path.
        switch (status) {
          case PATH_STATUS_PATH_FOUND:
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
              return 'PERFORMING_ACTION';
            }

            // Path is valid and we're not performing a special action, so walk.
            if (workerState.path && workerState.path.length > 1) {
              return 'WALKING';
            }
            // If path is stale or invalid, wait for a new one.
            workerState.shouldRequestNewPath = true;
            return 'EVALUATING_WAYPOINT';

          case PATH_STATUS_NO_PATH_FOUND:
          case PATH_STATUS_NO_VALID_START_OR_END:
          case PATH_STATUS_ERROR:
          case PATH_STATUS_DIFFERENT_FLOOR:
            logger(
              'warn',
              `[FSM] Unreachable waypoint ${targetWaypoint.id} (${targetWaypoint.type}) due to path status: ${status}. Skipping.`,
            );
            await advanceToNextWaypoint(workerState, config);
            return 'IDLE';

          case PATH_STATUS_WAYPOINT_REACHED:
            // Pathfinder says we're there, but we're not exactly on the tile.
            // This is a success condition, so we advance.
            await advanceToNextWaypoint(workerState, config);
            return 'IDLE';

          case PATH_STATUS_IDLE:
          default:
            // Waiting for pathfinder.
            return 'EVALUATING_WAYPOINT';
        }
      },
    },
    WALKING: {
      enter: () => postStoreUpdate('cavebot/setActionPaused', false),
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
      enter: () => postStoreUpdate('cavebot/setActionPaused', true),
      execute: async (context) => {
        const { targetWaypoint } = context;
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
          if (
            getDistance(workerState.playerMinimapPosition, targetWaypoint) >=
            config.teleportDistanceThreshold
          ) {
            // After a teleport-like action, give grace
            workerState.floorChangeGraceUntil =
              Date.now() + config.postTeleportGraceMs;
          }
          await advanceToNextWaypoint(workerState, config);
          return 'IDLE';
        } else {
          logger(
            'warn',
            `[FSM] Action '${targetWaypoint.type}' failed. Retrying after delay.`,
          );
          await delay(config.actionFailureRetryDelayMs);
          return 'EVALUATING_WAYPOINT';
        }
      },
    },
    EXECUTING_SCRIPT: {
      enter: () => postStoreUpdate('cavebot/setActionPaused', true),
      execute: async (context) => {
        await handleScriptAction(workerState, config, context.targetWaypoint);
        return 'EVALUATING_WAYPOINT';
      },
    },
  };
}
