// /home/feiron/Dokumenty/Automaton/electron/workers/pathfinder/logic.js

import { WAYPOINT_AVOIDANCE_MAP } from './config.js';
import {
  PATH_LENGTH_INDEX,
  PATH_UPDATE_COUNTER_INDEX,
  PATH_WAYPOINTS_START_INDEX,
  PATH_WAYPOINT_SIZE,
  MAX_PATH_WAYPOINTS,
  PATH_CHEBYSHEV_DISTANCE_INDEX,
  PATH_START_X_INDEX,
  PATH_START_Y_INDEX,
  PATH_START_Z_INDEX,
  PATHFINDING_STATUS_INDEX,
  PATH_STATUS_IDLE,
  PATH_STATUS_PATH_FOUND,
  PATH_STATUS_WAYPOINT_REACHED,
  PATH_STATUS_NO_PATH_FOUND,
  PATH_STATUS_DIFFERENT_FLOOR,
  PATH_STATUS_ERROR,
  PATH_STATUS_NO_VALID_START_OR_END,
} from '../sharedConstants.js';

// This helps prevent redundant writes to the SAB if the result is identical.
let lastWrittenPathSignature = '';

export function runPathfindingLogic(context) {
  const {
    state,
    pathfinderInstance,
    lastJsonForType,
    logger,
    pathDataArray,
    throttleReduxUpdate,
  } = context;

  try {
    const { cavebot, gameState } = state;
    const { playerMinimapPosition } = gameState;

    if (!playerMinimapPosition) {
      return null;
    }

    const { x, y, z } = playerMinimapPosition;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof z !== 'number'
    ) {
      logger(
        'error',
        `Pathfinder received invalid player position: {x: ${x}, y: ${y}, z: ${z}}`,
      );
      return null;
    }

    const pathfinderMode = cavebot.pathfinderMode;
    let result = null;
    let targetIdentifier = null; // Used to check if the target has changed

    // --- Filter Special Areas based on the current mode ---
    const allSpecialAreas = state.cavebot?.specialAreas || [];
    const activeSpecialAreas = allSpecialAreas.filter((area) => {
      if (!area.enabled) return false;
      return area.type === 'all' || area.type === pathfinderMode;
    });

    const currentJson = JSON.stringify(activeSpecialAreas);
    if (currentJson !== lastJsonForType.get(pathfinderMode)) {
      const areasForNative = activeSpecialAreas.map((area) => ({
        x: area.x,
        y: area.y,
        z: area.z,
        avoidance: area.avoidance,
        width: area.sizeX,
        height: area.sizeY,
      }));
      pathfinderInstance.updateSpecialAreas(areasForNative, z);
      lastJsonForType.set(pathfinderMode, currentJson);
    }

    // --- Determine which pathfinding logic to run ---
    if (pathfinderMode === 'targeting' && cavebot.dynamicTarget) {
      targetIdentifier = JSON.stringify(cavebot.dynamicTarget);
      result = pathfinderInstance.findPathToGoal(
        playerMinimapPosition,
        cavebot.dynamicTarget,
        context.creaturePositions, // Pass creature positions
      );
    } else if (pathfinderMode === 'cavebot' && cavebot.wptId) {
      const { waypointSections, currentSection, wptId } = cavebot;
      const targetWaypoint = waypointSections[currentSection]?.waypoints.find(
        (wp) => wp.id === wptId,
      );

      if (targetWaypoint) {
        targetIdentifier = targetWaypoint.id;
        if (z !== targetWaypoint.z) {
          if (context.lastTargetWptId !== targetIdentifier) {
            throttleReduxUpdate({
              pathWaypoints: [],
              wptDistance: null,
              pathfindingStatus: 'DIFFERENT_FLOOR',
            });
            if (pathDataArray) {
              Atomics.store(
                pathDataArray,
                PATHFINDING_STATUS_INDEX,
                PATH_STATUS_DIFFERENT_FLOOR,
              );
              Atomics.store(pathDataArray, PATH_LENGTH_INDEX, 0);
              Atomics.add(pathDataArray, PATH_UPDATE_COUNTER_INDEX, 1);
            }
            context.lastTargetWptId = targetIdentifier;
          }
          return null;
        }
        result = pathfinderInstance.findPathSync(
          playerMinimapPosition,
          { x: targetWaypoint.x, y: targetWaypoint.y, z: targetWaypoint.z },
          context.creaturePositions, // Pass creature positions
        );
      }
    }

    // *** START: MODIFIED LOGIC ***
    // If we had a target but 'result' is still null (e.g., pathfinding call failed),
    // explicitly treat it as NO_PATH_FOUND. This prevents the ambiguous 'IDLE' status
    // from being sent to the cavebot worker when it has an active target.
    if (targetIdentifier && !result) {
      result = {
        path: [],
        reason: 'NO_PATH_FOUND',
        performance: { totalTimeMs: 0 },
      };
    }
    // *** END: MODIFIED LOGIC ***

    if (!result) {
      // This block now only handles the "truly idle" case where there was no target.
      if (pathDataArray) {
        Atomics.store(
          pathDataArray,
          PATHFINDING_STATUS_INDEX,
          PATH_STATUS_IDLE,
        );
        Atomics.store(pathDataArray, PATH_LENGTH_INDEX, 0);
        Atomics.add(pathDataArray, PATH_UPDATE_COUNTER_INDEX, 1);
      }
      return null;
    }

    const currentPosKey = `${x},${y},${z}`;
    if (
      context.lastPlayerPosKey === currentPosKey &&
      context.lastTargetWptId === targetIdentifier
    ) {
      return null;
    }
    context.lastPlayerPosKey = currentPosKey;
    context.lastTargetWptId = targetIdentifier;

    // raw path from pathfinder
    const rawPath = result.path || [];
    const statusString = result.reason;

    // --- Normalize path: drop initial step if it equals the player's current tile ---
    const normalizedPath = Array.isArray(rawPath) ? rawPath.slice() : [];
    if (normalizedPath.length > 0) {
      const first = normalizedPath[0];
      if (first.x === x && first.y === y && first.z === z) {
        // drop the start tile so worker sees only steps to perform
        normalizedPath.shift();
      }
    }

    // Map status string to internal code
    let statusCode = PATH_STATUS_IDLE;
    switch (statusString) {
      case 'PATH_FOUND':
        statusCode = PATH_STATUS_PATH_FOUND;
        break;
      case 'WAYPOINT_REACHED':
        statusCode = PATH_STATUS_WAYPOINT_REACHED;
        break;
      case 'NO_PATH_FOUND':
        statusCode = PATH_STATUS_NO_PATH_FOUND;
        break;
      case 'NO_VALID_START':
      case 'NO_VALID_END':
        statusCode = PATH_STATUS_NO_VALID_START_OR_END;
        break;
      default:
        statusCode = PATH_STATUS_ERROR;
    }

    // Compose signature from normalized path so we avoid redundant SAB writes
    const pathSignature = `${statusCode}:${normalizedPath.map((p) => `${p.x},${p.y}`).join(';')}`;
    if (pathSignature !== lastWrittenPathSignature) {
      if (pathDataArray) {
        const pathLength = Math.min(normalizedPath.length, MAX_PATH_WAYPOINTS);
        const targetX =
          normalizedPath.length > 0
            ? normalizedPath[normalizedPath.length - 1].x
            : result.path && result.path.length > 0
              ? result.path[result.path.length - 1].x
              : x;
        const targetY =
          normalizedPath.length > 0
            ? normalizedPath[normalizedPath.length - 1].y
            : result.path && result.path.length > 0
              ? result.path[result.path.length - 1].y
              : y;
        const chebyshevDistance = Math.max(
          Math.abs(x - targetX),
          Math.abs(y - targetY),
        );

        Atomics.store(pathDataArray, PATH_LENGTH_INDEX, pathLength);
        Atomics.store(
          pathDataArray,
          PATH_CHEBYSHEV_DISTANCE_INDEX,
          chebyshevDistance,
        );
        Atomics.store(pathDataArray, PATH_START_X_INDEX, x);
        Atomics.store(pathDataArray, PATH_START_Y_INDEX, y);
        Atomics.store(pathDataArray, PATH_START_Z_INDEX, z);
        Atomics.store(pathDataArray, PATHFINDING_STATUS_INDEX, statusCode);

        for (let i = 0; i < pathLength; i++) {
          const waypoint = normalizedPath[i];
          const offset = PATH_WAYPOINTS_START_INDEX + i * PATH_WAYPOINT_SIZE;
          Atomics.store(pathDataArray, offset + 0, waypoint.x);
          Atomics.store(pathDataArray, offset + 1, waypoint.y);
          Atomics.store(pathDataArray, offset + 2, waypoint.z);
        }

        Atomics.add(pathDataArray, PATH_UPDATE_COUNTER_INDEX, 1);
      }
      lastWrittenPathSignature = pathSignature;
    }

    // wptDistance should reflect number of remaining steps (normalized path length)
    const distance =
      statusString === 'NO_PATH_FOUND'
        ? null
        : normalizedPath.length >= 0
          ? normalizedPath.length
          : null;

    throttleReduxUpdate({
      pathWaypoints: normalizedPath,
      wptDistance: distance,
      routeSearchMs: result.performance.totalTimeMs,
      pathfindingStatus: statusString,
    });

    return result.performance.totalTimeMs;
  } catch (error) {
    logger('error', `Pathfinding error: ${error.message}`);
    throttleReduxUpdate({
      pathWaypoints: [],
      wptDistance: null,
      pathfindingStatus: 'ERROR',
    });
    if (pathDataArray) {
      Atomics.store(pathDataArray, PATHFINDING_STATUS_INDEX, PATH_STATUS_ERROR);
      Atomics.store(pathDataArray, PATH_LENGTH_INDEX, 0);
      Atomics.add(pathDataArray, PATH_UPDATE_COUNTER_INDEX, 1);
    }
    return null;
  }
}
