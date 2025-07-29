import { parentPort } from 'worker_threads';
import { WAYPOINT_AVOIDANCE_MAP } from './config.js';

/**
 * The main pathfinding logic for the worker.
 * @param {object} context - An object containing the necessary state and instances.
 * @returns {number|null} The duration of the pathfinding search in ms, or null if no search was performed.
 */
export function runPathfindingLogic(context) {
  const { state, pathfinderInstance, lastJsonForType, logger } = context;

  try {
    // --- Guard Clauses: Ensure necessary state exists ---
    if (!state.gameState?.playerMinimapPosition || !state.cavebot?.wptId)
      return null;

    const { waypointSections, currentSection, wptId } = state.cavebot;
    const currentWaypoints = waypointSections[currentSection]?.waypoints || [];
    const targetWaypoint = currentWaypoints.find((wp) => wp.id === wptId);
    if (!targetWaypoint) return null;

    // --- Update Special Avoidance Areas if they have changed ---
    const requiredAvoidanceType = WAYPOINT_AVOIDANCE_MAP[targetWaypoint.type];
    if (requiredAvoidanceType) {
      const permanentAreas = (state.cavebot?.specialAreas || []).filter(
        (area) => area.enabled && area.type === requiredAvoidanceType,
      );
      const currentJson = JSON.stringify(permanentAreas);
      if (currentJson !== lastJsonForType.get(requiredAvoidanceType)) {
        logger(
          'info',
          `Special areas for type "${requiredAvoidanceType}" changed. Updating native cache...`,
        );
        const areasForNative = permanentAreas.map((area) => ({
          x: area.x,
          y: area.y,
          z: area.z,
          avoidance: area.avoidance,
          width: area.sizeX,
          height: area.sizeY,
        }));
        pathfinderInstance.updateSpecialAreas(areasForNative);
        lastJsonForType.set(requiredAvoidanceType, currentJson);
      }
    }

    // --- Check for different floors ---
    const { x, y, z } = state.gameState.playerMinimapPosition;
    if (z !== targetWaypoint.z) {
      if (context.lastTargetWptId !== targetWaypoint.id) {
        parentPort.postMessage({
          storeUpdate: true,
          type: 'cavebot/setPathfindingFeedback',
          payload: {
            pathWaypoints: [],
            wptDistance: null,
            pathfindingStatus: 'DIFFERENT_FLOOR',
          },
        });
        context.lastTargetWptId = targetWaypoint.id;
      }
      return null;
    }

    // --- Check if a new path is needed ---
    const currentPosKey = `${x},${y},${z}`;
    if (
      context.lastPlayerPosKey === currentPosKey &&
      context.lastTargetWptId === targetWaypoint.id
    ) {
      return null; // No change, no need to re-calculate
    }
    context.lastPlayerPosKey = currentPosKey;
    context.lastTargetWptId = targetWaypoint.id;

    // --- Execute Native Pathfinding ---
    const result = pathfinderInstance.findPathSync(
      { x, y, z },
      { x: targetWaypoint.x, y: targetWaypoint.y, z: targetWaypoint.z },
      { waypointType: targetWaypoint.type },
    );

    // --- Post Results ---
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

    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setPathfindingFeedback',
      payload: {
        pathWaypoints: path,
        wptDistance: distance,
        routeSearchMs: result.performance.totalTimeMs,
        pathfindingStatus: status,
      },
    });

    // Return the native search time for performance tracking
    return result.performance.totalTimeMs;
  } catch (error) {
    logger('error', `Pathfinding error: ${error.message}`);
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setPathfindingFeedback',
      payload: {
        pathWaypoints: [],
        wptDistance: null,
        pathfindingStatus: 'ERROR',
      },
    });
    return null;
  }
}
