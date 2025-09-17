// /home/feiron/Dokumenty/Automaton/electron/workers/pathfinder/logic.js
// --- Full file with fix for controlState logic ---

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
  PATH_STATUS_BLOCKED_BY_CREATURE,
  PATH_BLOCKING_CREATURE_X_INDEX,
  PATH_BLOCKING_CREATURE_Y_INDEX,
  PATH_BLOCKING_CREATURE_Z_INDEX,
} from '../sharedConstants.js';

let lastWrittenPathSignature = '';

function hashCreatureData(creatures) {
  if (!creatures || creatures.length === 0) return 0;
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
    const { cavebot, gameState, targeting } = state;
    const { playerMinimapPosition } = gameState;

    if (!playerMinimapPosition) {
      return;
    }

    const { x, y, z } = playerMinimapPosition;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof z !== 'number'
    ) {
      logger('error', `Invalid player position: {x: ${x}, y: ${y}, z: ${z}}`);
      return;
    }

    const creaturePositions = (targeting.creatures || []).map(
      (c) => c.gameCoords,
    );

    // --- NEW: Implicit Mode Detection ---
    // Instead of reading a mode flag, we infer the mode from the available data.
    // If a dynamicTarget exists, we are in 'targeting' mode. Otherwise, 'cavebot' mode.
    const isTargetingMode = !!cavebot.dynamicTarget;

    let result = null;
    let targetIdentifier = null;

    const allSpecialAreas = state.cavebot?.specialAreas || [];
    const activeSpecialAreas = allSpecialAreas.filter((area) => area.enabled);

    const activeAreasJson = JSON.stringify(activeSpecialAreas);

    if (activeAreasJson !== logicContext.lastActiveAreasJson) {
      logger('info', 'Special areas have changed, updating pathfinder cache.');
      const newAreasByZ = {};
      for (const area of activeSpecialAreas) {
        if (!newAreasByZ[area.z]) {
          newAreasByZ[area.z] = [];
        }
        newAreasByZ[area.z].push(area);
      }

      const oldAreasByZ = logicContext.lastAreasByZ || {};
      const allZLevels = new Set([
        ...Object.keys(newAreasByZ),
        ...Object.keys(oldAreasByZ),
      ]);

      for (const zStr of allZLevels) {
        const z = parseInt(zStr, 10);
        const newAreasJson = JSON.stringify(newAreasByZ[z] || []);
        const oldAreasJson = JSON.stringify(oldAreasByZ[z] || []);

        if (newAreasJson !== oldAreasJson) {
          logger('debug', `Updating special areas for z-level ${z}`);
          const areasForNative = (newAreasByZ[z] || []).map((area) => ({
            x: area.x,
            y: area.y,
            z: area.z,
            avoidance: area.avoidance,
            width: area.sizeX,
            height: area.sizeY,
          }));
          pathfinderInstance.updateSpecialAreas(areasForNative, z);
        }
      }

      logicContext.lastActiveAreasJson = activeAreasJson;
      logicContext.lastAreasByZ = newAreasByZ;
    }

    if (isTargetingMode) {
      targetIdentifier = JSON.stringify(cavebot.dynamicTarget);
    } else if (cavebot.wptId) {
      // Cavebot mode
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
      return; // No change in inputs, skip pathfinding.
    }

    logicContext.lastPlayerPosKey = currentPosKey;
    logicContext.lastTargetWptId = targetIdentifier;
    logicContext.lastCreatureDataHash = currentCreatureDataHash;

    if (isTargetingMode) {
      const targetInstanceId = cavebot.dynamicTarget.targetInstanceId;

      if (!targetInstanceId) {
        // Fallback for old dynamicTarget format, but still solve Problem B.
        const obstacles = creaturePositions.filter((pos) => {
          return (
            pos.x !== cavebot.dynamicTarget.targetCreaturePos.x ||
            pos.y !== cavebot.dynamicTarget.targetCreaturePos.y ||
            pos.z !== cavebot.dynamicTarget.targetCreaturePos.z
          );
        });
        result = pathfinderInstance.findPathToGoal(
          playerMinimapPosition,
          cavebot.dynamicTarget,
          obstacles,
        );
      } else {
        const targetCreature = (targeting.creatures || []).find(
          (c) => c.instanceId === targetInstanceId,
        );

        if (targetCreature) {
          // State is consistent, target found. Use its fresh position.
          const correctedDynamicTarget = {
            ...cavebot.dynamicTarget,
            targetCreaturePos: targetCreature.gameCoords,
          };

          // Filter the fresh position from the list of obstacles.
          const obstacles = creaturePositions.filter((pos) => {
            return (
              pos.x !== correctedDynamicTarget.targetCreaturePos.x ||
              pos.y !== correctedDynamicTarget.targetCreaturePos.y ||
              pos.z !== correctedDynamicTarget.targetCreaturePos.z
            );
          });

          result = pathfinderInstance.findPathToGoal(
            playerMinimapPosition,
            correctedDynamicTarget,
            obstacles,
          );
        } else {
          // Target has disappeared. Path to its last known position.
          // `creaturePositions` is already correct (doesn't contain the disappeared target).
          result = pathfinderInstance.findPathToGoal(
            playerMinimapPosition,
            cavebot.dynamicTarget,
            creaturePositions,
          );
        }
      }
    } else if (targetIdentifier) {
      // Cavebot mode with a valid waypoint
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
          return;
        }
        result = pathfinderInstance.findPathSync(
          playerMinimapPosition,
          { x: targetWaypoint.x, y: targetWaypoint.y, z: targetWaypoint.z },
          creaturePositions,
        );
      }
    }

    if (targetIdentifier && !result) {
      result = {
        path: [],
        reason: 'NO_PATH_FOUND'
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
      return;
    }

    const rawPath = result.path || [];
    const statusString = result.reason;
    const isBlocked = result.isBlocked || false;
    const blockingCreatureCoords = result.blockingCreatureCoords || null;

    const normalizedPath = Array.isArray(rawPath) ? rawPath.slice() : [];
    

    let statusCode = PATH_STATUS_IDLE;
    switch (statusString) {
      case 'PATH_FOUND':
        statusCode = PATH_STATUS_PATH_FOUND;
        break;
      case 'BLOCKED_BY_CREATURE':
        statusCode = PATH_STATUS_BLOCKED_BY_CREATURE;
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

        if (isBlocked && blockingCreatureCoords) {
          Atomics.store(pathDataArray, PATH_BLOCKING_CREATURE_X_INDEX, blockingCreatureCoords.x);
          Atomics.store(pathDataArray, PATH_BLOCKING_CREATURE_Y_INDEX, blockingCreatureCoords.y);
          Atomics.store(pathDataArray, PATH_BLOCKING_CREATURE_Z_INDEX, blockingCreatureCoords.z);
        } else {
          // Clear the coordinates if not blocked
          Atomics.store(pathDataArray, PATH_BLOCKING_CREATURE_X_INDEX, 0);
          Atomics.store(pathDataArray, PATH_BLOCKING_CREATURE_Y_INDEX, 0);
          Atomics.store(pathDataArray, PATH_BLOCKING_CREATURE_Z_INDEX, 0);
        }

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
      pathfindingStatus: statusString,
    });

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
  }
}
