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

        // Check waypoint type first - handle each type appropriately
        switch (targetWaypoint.type) {
          case 'Script':
            return 'EXECUTING_SCRIPT';
          case 'Stand':
          case 'Ladder':
          case 'Rope':
          case 'Shovel':
          case 'Machete':
          case 'Door':
            if (typeof chebyshevDist === 'number' && chebyshevDist <= 1) {
              if (
                playerPos.x === targetWaypoint.x &&
                playerPos.y === targetWaypoint.y
              ) {
                logger(
                  'info',
                  `[Cavebot] Player is on action waypoint ${targetWaypoint.type}. Performing action.`,
                );
              }
              return 'PERFORMING_ACTION';
            }
            // If not close enough, fall through to pathfinding logic
            break;
          case 'Node':
          case 'Walk':
            if (
              typeof chebyshevDist === 'number' &&
              chebyshevDist === 0 &&
              playerPos.z === targetWaypoint.z
            ) {
              await advanceToNextWaypoint(workerState, config);
              return 'IDLE';
            }
            // If not at the waypoint, fall through to pathfinding logic
            break;
        }

        // Check pathfinding status waypoint reached signal
        if (status === PATH_STATUS_WAYPOINT_REACHED) {
          logger('debug', '[FSM] Waypoint reached per pathfinder. Advancing.');
          await advanceToNextWaypoint(workerState, config);
          return 'IDLE';
        }

        switch (status) {
          case PATH_STATUS_NO_PATH_FOUND:
          case PATH_STATUS_NO_VALID_START_OR_END:
          case PATH_STATUS_ERROR:
          case PATH_STATUS_DIFFERENT_FLOOR:
            logger(
              'warn',
              `[FSM] Unreachable waypoint ${targetWaypoint.id} (${targetWaypoint.type}) due to path status: ${status}. Skipping to next waypoint.`,
            );
            await advanceToNextWaypoint(workerState, config);
            return 'IDLE';
          case PATH_STATUS_PATH_FOUND:
            // More thorough validation before entering WALKING state
            if (workerState.path && workerState.path.length > 1) {
              // Verify that the path is valid and starts from current position
              const pathStart = workerState.path[0];
              const currentPos = context.playerPos;
              if (
                pathStart &&
                currentPos &&
                pathStart.x === currentPos.x &&
                pathStart.y === currentPos.y &&
                pathStart.z === currentPos.z
              ) {
                return 'WALKING';
              } else {
                // Path doesn't start from current position, request new path
                workerState.shouldRequestNewPath = true;
                return 'EVALUATING_WAYPOINT';
              }
            }
            // Path is empty or only contains the player's position, re-evaluate.
            return 'EVALUATING_WAYPOINT';
          case PATH_STATUS_IDLE:
          default:
            return 'EVALUATING_WAYPOINT'; // Waiting for pathfinder
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
