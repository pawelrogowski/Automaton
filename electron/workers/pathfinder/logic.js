import { WAYPOINT_AVOIDANCE_MAP } from './config.js';
import {
  // Import all existing constants
  PATH_LENGTH_INDEX,
  PATH_UPDATE_COUNTER_INDEX,
  PATH_WAYPOINTS_START_INDEX,
  PATH_WAYPOINT_SIZE,
  MAX_PATH_WAYPOINTS,
  PATH_CHEBYSHEV_DISTANCE_INDEX,
  PATH_START_X_INDEX,
  PATH_START_Y_INDEX,
  PATH_START_Z_INDEX,

  // Import the new constants from the updated sharedConstants.js
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
    lastConfigForType,
    logger,
    pathDataArray,
    throttleReduxUpdate,
  } = context;

  try {
    if (!state?.cavebot?.wptId || !state?.gameState?.playerMinimapPosition) {
      return null;
    }

    const { x, y, z } = state.gameState.playerMinimapPosition;

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

    const { waypointSections, currentSection, wptId } = state.cavebot;
    const currentWaypoints = waypointSections[currentSection]?.waypoints || [];
    const targetWaypoint = currentWaypoints.find((wp) => wp.id === wptId);
    if (!targetWaypoint) return null;

    // --- Handle Special Areas (Unchanged) ---
    const requiredAvoidanceType = WAYPOINT_AVOIDANCE_MAP[targetWaypoint.type];
    if (requiredAvoidanceType) {
      const permanentAreas = (state.cavebot?.specialAreas || []).filter(
        (area) => area.enabled && area.type === requiredAvoidanceType,
      );

      // Create a cheap-to-compute string signature instead of JSON.stringify
      const currentKey = permanentAreas
        .map((a) => `${a.x},${a.y},${a.z},${a.avoidance},${a.sizeX},${a.sizeY}`)
        .join('|');

      if (currentKey !== lastConfigForType.get(requiredAvoidanceType)) {
        const areasForNative = permanentAreas.map((area) => ({
          x: area.x,
          y: area.y,
          z: area.z,
          avoidance: area.avoidance,
          width: area.sizeX,
          height: area.sizeY,
        }));
        pathfinderInstance.updateSpecialAreas(areasForNative, z);
        lastConfigForType.set(requiredAvoidanceType, currentKey);
      }
    }

    // --- Handle Different Floor Case ---
    if (z !== targetWaypoint.z) {
      // Only update if this is a new target, to avoid spamming updates.
      if (context.lastTargetWptId !== targetWaypoint.id) {
        throttleReduxUpdate({
          pathWaypoints: [],
          wptDistance: null,
          pathfindingStatus: 'DIFFERENT_FLOOR',
        });
        // Write the definitive status to the SAB
        if (pathDataArray) {
          Atomics.store(
            pathDataArray,
            PATHFINDING_STATUS_INDEX,
            PATH_STATUS_DIFFERENT_FLOOR,
          );
          Atomics.store(pathDataArray, PATH_LENGTH_INDEX, 0); // Ensure path is empty
          Atomics.add(pathDataArray, PATH_UPDATE_COUNTER_INDEX, 1); // Notify worker
        }
        context.lastTargetWptId = targetWaypoint.id;
      }
      return null;
    }

    // --- Prevent Recalculation if Nothing Changed (Unchanged) ---
    const currentPosKey = `${x},${y},${z}`;
    if (
      context.lastPlayerPosKey === currentPosKey &&
      context.lastTargetWptId === targetWaypoint.id
    ) {
      return null;
    }
    context.lastPlayerPosKey = currentPosKey;
    context.lastTargetWptId = targetWaypoint.id;

    // --- Perform Pathfinding ---
    const result = pathfinderInstance.findPathSync(
      { x, y, z },
      { x: targetWaypoint.x, y: targetWaypoint.y, z: targetWaypoint.z },
      { waypointType: targetWaypoint.type },
    );

    const path = result.path || [];
    const statusString = result.reason;

    // --- Convert Status String to Integer Code ---
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
        statusCode = PATH_STATUS_ERROR; // Should not happen
    }

    // --- Write Results to Shared Array Buffer ---
    const pathSignature = `${statusCode}:${path.map((p) => `${p.x},${p.y}`).join(';')}`;
    if (pathSignature === lastWrittenPathSignature) return;

    if (pathDataArray) {
      const pathLength = Math.min(path.length, MAX_PATH_WAYPOINTS);
      const chebyshevDistance = Math.max(
        Math.abs(x - targetWaypoint.x),
        Math.abs(y - targetWaypoint.y),
      );

      // Store all path metadata in the SAB
      Atomics.store(pathDataArray, PATH_LENGTH_INDEX, pathLength);
      Atomics.store(
        pathDataArray,
        PATH_CHEBYSHEV_DISTANCE_INDEX,
        chebyshevDistance,
      );
      Atomics.store(pathDataArray, PATH_START_X_INDEX, x);
      Atomics.store(pathDataArray, PATH_START_Y_INDEX, y);
      Atomics.store(pathDataArray, PATH_START_Z_INDEX, z);

      // ** THE CRUCIAL CHANGE: Store the definitive status code **
      Atomics.store(pathDataArray, PATHFINDING_STATUS_INDEX, statusCode);

      // Store the waypoints
      for (let i = 0; i < pathLength; i++) {
        const waypoint = path[i];
        const offset = PATH_WAYPOINTS_START_INDEX + i * PATH_WAYPOINT_SIZE;
        Atomics.store(pathDataArray, offset + 0, waypoint.x);
        Atomics.store(pathDataArray, offset + 1, waypoint.y);
        Atomics.store(pathDataArray, offset + 2, waypoint.z);
      }

      // Increment update counter to notify consumers
      Atomics.add(pathDataArray, PATH_UPDATE_COUNTER_INDEX, 1);
    }
    lastWrittenPathSignature = pathSignature;

    // --- Throttle Redux Update for UI (Unchanged) ---
    const distance =
      statusString === 'NO_PATH_FOUND'
        ? null
        : path.length > 0
          ? path.length
          : statusString === 'WAYPOINT_REACHED'
            ? 0
            : null;
    throttleReduxUpdate({
      pathWaypoints: path,
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
    // On error, notify the worker so it can handle it gracefully
    if (pathDataArray) {
      Atomics.store(pathDataArray, PATHFINDING_STATUS_INDEX, PATH_STATUS_ERROR);
      Atomics.store(pathDataArray, PATH_LENGTH_INDEX, 0);
      Atomics.add(pathDataArray, PATH_UPDATE_COUNTER_INDEX, 1);
    }
    return null;
  }
}
