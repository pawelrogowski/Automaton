// /home/feiron/Dokumenty/Automaton/electron/workers/pathfinder/logic.js

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

let lastWrittenPathSignature = '';

// A simple hashing function for the creature array
function hashCreatureData(creatures) {
  if (!creatures || creatures.length === 0) return 0;
  // Simple hash: combine length and coords of first/last creature
  const first = creatures[0].gameCoords;
  const last = creatures[creatures.length - 1].gameCoords;
  return (
    creatures.length ^
    (first.x << 8) ^
    (first.y << 16) ^
    (last.x << 4) ^
    (last.y << 24)
  );
}

export function runPathfindingLogic(context) {
  const {
    logicContext,
    state,
    pathfinderInstance,
    logger,
    pathDataArray,
    throttleReduxUpdate,
  } = context;

  try {
    const { cavebot, gameState, targeting } = state; // Add targeting
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
      logger('error', `Invalid player position: {x: ${x}, y: ${y}, z: ${z}}`);
      return null;
    }

    // Get creatures from Redux state
    const creaturePositions = (targeting.creatures || []).map(
      (c) => c.gameCoords,
    );

    const pathfinderMode = cavebot.pathfinderMode;
    let result = null;
    let targetIdentifier = null;

    const allSpecialAreas = state.cavebot?.specialAreas || [];
    const activeSpecialAreas = allSpecialAreas.filter((area) => {
      if (!area.enabled) return false;
      return area.type === 'all' || area.type === pathfinderMode;
    });

    const currentJson = JSON.stringify(activeSpecialAreas);
    if (currentJson !== logicContext.lastJsonForType.get(pathfinderMode)) {
      const areasForNative = activeSpecialAreas.map((area) => ({
        x: area.x,
        y: area.y,
        z: area.z,
        avoidance: area.avoidance,
        width: area.sizeX,
        height: area.sizeY,
      }));
      pathfinderInstance.updateSpecialAreas(areasForNative, z);
      logicContext.lastJsonForType.set(pathfinderMode, currentJson);
    }

    if (pathfinderMode === 'targeting' && cavebot.dynamicTarget) {
      targetIdentifier = JSON.stringify(cavebot.dynamicTarget);
    } else if (pathfinderMode === 'cavebot' && cavebot.wptId) {
      const { waypointSections, currentSection, wptId } = cavebot;
      const targetWaypoint = waypointSections[currentSection]?.waypoints.find(
        (wp) => wp.id === wptId,
      );
      if (targetWaypoint) {
        targetIdentifier = targetWaypoint.id;
      }
    }

    const currentPosKey = `${x},${y},${z}`;
    const currentCreatureDataHash = hashCreatureData(targeting.creatures);

    if (
      logicContext.lastPlayerPosKey === currentPosKey &&
      logicContext.lastTargetWptId === targetIdentifier &&
      logicContext.lastCreatureDataHash === currentCreatureDataHash
    ) {
      return null;
    }

    logicContext.lastPlayerPosKey = currentPosKey;
    logicContext.lastTargetWptId = targetIdentifier;
    logicContext.lastCreatureDataHash = currentCreatureDataHash;

    if (pathfinderMode === 'targeting' && cavebot.dynamicTarget) {
      result = pathfinderInstance.findPathToGoal(
        playerMinimapPosition,
        cavebot.dynamicTarget,
        creaturePositions, // Pass creatures from Redux
      );
    } else if (pathfinderMode === 'cavebot' && targetIdentifier) {
      const { waypointSections, currentSection, wptId } = cavebot;
      const targetWaypoint = waypointSections[currentSection]?.waypoints.find(
        (wp) => wp.id === wptId,
      );
      if (targetWaypoint) {
        if (z !== targetWaypoint.z) {
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
          return null;
        }
        result = pathfinderInstance.findPathSync(
          playerMinimapPosition,
          { x: targetWaypoint.x, y: targetWaypoint.y, z: targetWaypoint.z },
          creaturePositions, // Pass creatures from Redux
        );
      }
    }

    if (targetIdentifier && !result) {
      result = {
        path: [],
        reason: 'NO_PATH_FOUND',
        performance: { totalTimeMs: 0 },
      };
    }

    if (!result) {
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

    const rawPath = result.path || [];
    const statusString = result.reason;

    const normalizedPath = Array.isArray(rawPath) ? rawPath.slice() : [];
    if (normalizedPath.length > 0) {
      const first = normalizedPath[0];
      if (first.x === x && first.y === y && first.z === z) {
        normalizedPath.shift();
      }
    }

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
        break;
    }

    const pathSignature = `${statusCode}:${normalizedPath.map((p) => `${p.x},${p.y}`).join(';')}`;
    if (pathSignature !== lastWrittenPathSignature) {
      if (pathDataArray) {
        const pathLength = Math.min(normalizedPath.length, MAX_PATH_WAYPOINTS);
        const targetX =
          normalizedPath.length > 0
            ? normalizedPath[normalizedPath.length - 1].x
            : x;
        const targetY =
          normalizedPath.length > 0
            ? normalizedPath[normalizedPath.length - 1].y
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

    const distance =
      statusString === 'NO_PATH_FOUND' ? null : normalizedPath.length;

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
