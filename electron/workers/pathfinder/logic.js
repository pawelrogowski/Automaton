// pathfinder/logic.js (Optimized Drop-in Replacement)

import { parentPort } from 'worker_threads';
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
} from '../sharedConstants.js';

// --- FIX: Add state to remember the last written path signature ---
let lastWrittenPathSignature = '';
// --- END FIX ---

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
    if (
      !state ||
      !state.cavebot ||
      !state.cavebot.wptId ||
      !state.gameState ||
      !state.gameState.playerMinimapPosition
    ) {
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

    const requiredAvoidanceType = WAYPOINT_AVOIDANCE_MAP[targetWaypoint.type];
    if (requiredAvoidanceType) {
      const permanentAreas = (state.cavebot?.specialAreas || []).filter(
        (area) => area.enabled && area.type === requiredAvoidanceType,
      );
      const currentJson = JSON.stringify(permanentAreas);
      if (currentJson !== lastJsonForType.get(requiredAvoidanceType)) {
        const areasForNative = permanentAreas.map((area) => ({
          x: area.x,
          y: area.y,
          z: area.z,
          avoidance: area.avoidance,
          width: area.sizeX,
          height: area.sizeY,
        }));
        pathfinderInstance.updateSpecialAreas(areasForNative, z);
        lastJsonForType.set(requiredAvoidanceType, currentJson);
      }
    }

    if (z !== targetWaypoint.z) {
      if (context.lastTargetWptId !== targetWaypoint.id) {
        throttleReduxUpdate({
          pathWaypoints: [],
          wptDistance: null,
          pathfindingStatus: 'DIFFERENT_FLOOR',
        });
        context.lastTargetWptId = targetWaypoint.id;
      }
      return null;
    }

    const currentPosKey = `${x},${y},${z}`;
    if (
      context.lastPlayerPosKey === currentPosKey &&
      context.lastTargetWptId === targetWaypoint.id
    ) {
      return null;
    }
    context.lastPlayerPosKey = currentPosKey;
    context.lastTargetWptId = targetWaypoint.id;

    const result = pathfinderInstance.findPathSync(
      { x, y, z },
      { x: targetWaypoint.x, y: targetWaypoint.y, z: targetWaypoint.z },
      { waypointType: targetWaypoint.type },
    );

    const path = result.path || [];
    const status = result.reason;
    const distance =
      status === 'NO_PATH_FOUND'
        ? null
        : path.length > 0
          ? path.length
          : status === 'WAYPOINT_REACHED'
            ? 0
            : null;

    // --- FIX: Check if the path has actually changed before updating ---
    const pathSignature = path.map((p) => `${p.x},${p.y}`).join(';');
    if (pathSignature !== lastWrittenPathSignature) {
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
        Atomics.notify(pathDataArray, PATH_UPDATE_COUNTER_INDEX);
      }
      lastWrittenPathSignature = pathSignature;
    }
    // --- END FIX ---

    throttleReduxUpdate({
      pathWaypoints: path,
      wptDistance: distance,
      routeSearchMs: result.performance.totalTimeMs,
      pathfindingStatus: status,
    });

    return result.performance.totalTimeMs;
  } catch (error) {
    logger('error', `Pathfinding error: ${error.message}`);
    throttleReduxUpdate({
      pathWaypoints: [],
      wptDistance: null,
      pathfindingStatus: 'ERROR',
    });
    return null;
  }
}
