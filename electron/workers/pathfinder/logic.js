// /home/feiron/Dokumenty/Automaton/electron/workers/pathfinder/logic.js
//start file
// /electron/workers/pathfinder/logic.js

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
  PATH_TARGET_X_INDEX,
  PATH_TARGET_Y_INDEX,
  PATH_TARGET_Z_INDEX,
  PATH_WPT_ID_INDEX,
  PATH_INSTANCE_ID_INDEX,
} from '../sharedConstants.js';
import { deepHash } from '../../utils/deepHash.js';

let lastWrittenPathSignature = '';

export function runPathfindingLogic(context) {
  
  const {
    logicContext,
    state,
    pathfinderInstance,
    logger,
    pathDataArray,
    throttleReduxUpdate,
  } = context;

  logicContext.lastProcessedWptId = logicContext.lastProcessedWptId ?? 0;
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

    const isTargetingMode = !!cavebot.dynamicTarget;
    const currentWptId = cavebot.wptId;
    const currentDynamicTargetJson = isTargetingMode ? JSON.stringify(cavebot.dynamicTarget) : null;

    let result = null;
    let targetIdentifier = isTargetingMode ? currentDynamicTargetJson : currentWptId;

    // --- NEW LOGIC START ---
    // Get both permanent and temporary special areas
    const permanentSpecialAreas = state.cavebot?.specialAreas || [];
    const temporaryBlockedTiles = state.cavebot?.temporaryBlockedTiles || [];

    // Convert temporary tiles into the format the pathfinder expects for special areas
    const temporarySpecialAreas = temporaryBlockedTiles.map(tile => ({
      x: tile.x,
      y: tile.y,
      z: tile.z,
      sizeX: 1,
      sizeY: 1,
      avoidance: 100, // High avoidance cost to ensure it's avoided
      type: 'temporary', // Custom type for debugging
      enabled: true,
    }));

    const allSpecialAreas = [...permanentSpecialAreas, ...temporarySpecialAreas];
    const activeSpecialAreas = allSpecialAreas.filter((area) => area.enabled);
    // --- NEW LOGIC END ---

    const pathfindingInput = {
      start: playerMinimapPosition,
      target: isTargetingMode ? cavebot.dynamicTarget : currentWptId,
      obstacles: creaturePositions,
      specialAreas: activeSpecialAreas, // Use the combined list
    };

    const currentSignature = deepHash(pathfindingInput);

    if (
      logicContext.lastSignature === currentSignature
    ) {
      result = logicContext.lastResult;
    } else {
      logicContext.lastSignature = currentSignature;
    }

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

    let hasChanges = false;
    for (const zStr of allZLevels) {
        const z = parseInt(zStr, 10);
        const newAreasForZ = newAreasByZ[z] || [];
        const oldAreasForZ = oldAreasByZ[z] || [];

        const newAreasJson = JSON.stringify(newAreasForZ);
        const oldAreasJson = JSON.stringify(oldAreasForZ);

        if (newAreasJson !== oldAreasJson) {
            hasChanges = true;
            logger('debug', `Special areas for z-level ${z} have changed. Updating native module.`);
            const areasForNative = newAreasForZ.map((area) => ({
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

    if (hasChanges) {
        logicContext.lastAreasByZ = newAreasByZ;
    }

    if (!result) {
      if (isTargetingMode) {
        const targetInstanceId = cavebot.dynamicTarget.targetInstanceId;

        if (!targetInstanceId) {
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
            const correctedDynamicTarget = {
              ...cavebot.dynamicTarget,
              targetCreaturePos: targetCreature.gameCoords,
            };

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
            result = pathfinderInstance.findPathToGoal(
              playerMinimapPosition,
              cavebot.dynamicTarget,
              creaturePositions,
            );
          }
        }
      } else if (targetIdentifier) {
        const { waypointSections, currentSection, wptId } = cavebot;
        const targetWaypoint = waypointSections[currentSection]?.waypoints.find(
          (wp) => wp.id === wptId,
        );
        if (targetWaypoint) {
          result = pathfinderInstance.findPathSync(
            playerMinimapPosition,
            { x: targetWaypoint.x, y: targetWaypoint.y, z: targetWaypoint.z },
            creaturePositions
          );
        }
      }
      logicContext.lastResult = result;
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
    const wptId = isTargetingMode ? 0 : (cavebot.wptId ? cavebot.wptId.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a }, 0) : 0);
    const instanceId = isTargetingMode ? (cavebot.dynamicTarget.targetInstanceId || 0) : 0;

    if (pathDataArray) {
      Atomics.store(pathDataArray, PATH_WPT_ID_INDEX, wptId);
      Atomics.store(pathDataArray, PATH_INSTANCE_ID_INDEX, instanceId);
    }

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
      case 'DIFFERENT_FLOOR':
        statusCode = PATH_STATUS_DIFFERENT_FLOOR;
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

    const currentTargetWptIdHash = isTargetingMode ? instanceId : wptId;
    const targetWptIdChanged = currentTargetWptIdHash !== logicContext.lastProcessedWptId;

    if (pathSignature !== lastWrittenPathSignature || targetWptIdChanged) {
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

        let pathTargetCoords = { x: 0, y: 0, z: 0 };
        if (isTargetingMode) {
          pathTargetCoords = cavebot.dynamicTarget.targetCreaturePos;
        } else {
          const { waypointSections, currentSection, wptId } = cavebot;
          const targetWaypoint =
            waypointSections[currentSection]?.waypoints.find(
              (wp) => wp.id === wptId,
            );
          if (targetWaypoint) {
            pathTargetCoords = {
              x: targetWaypoint.x,
              y: targetWaypoint.y,
              z: targetWaypoint.z,
            };
          }
        }

        Atomics.store(pathDataArray, PATH_LENGTH_INDEX, pathLength);
        Atomics.store(
          pathDataArray,
          PATH_CHEBYSHEV_DISTANCE_INDEX,
          chebyshevDistance,
        );
        Atomics.store(pathDataArray, PATH_START_X_INDEX, x);
        Atomics.store(pathDataArray, PATH_START_Y_INDEX, y);
        Atomics.store(pathDataArray, PATH_START_Z_INDEX, z);
        Atomics.store(
          pathDataArray,
          PATH_TARGET_X_INDEX,
          pathTargetCoords.x,
        );
        Atomics.store(
          pathDataArray,
          PATH_TARGET_Y_INDEX,
          pathTargetCoords.y,
        );
        Atomics.store(
          pathDataArray,
          PATH_TARGET_Z_INDEX,
          pathTargetCoords.z,
        );
        Atomics.store(pathDataArray, PATHFINDING_STATUS_INDEX, statusCode);

        if (isBlocked && blockingCreatureCoords) {
          Atomics.store(pathDataArray, PATH_BLOCKING_CREATURE_X_INDEX, blockingCreatureCoords.x);
          Atomics.store(pathDataArray, PATH_BLOCKING_CREATURE_Y_INDEX, blockingCreatureCoords.y);
          Atomics.store(pathDataArray, PATH_BLOCKING_CREATURE_Z_INDEX, blockingCreatureCoords.z);
        } else {
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
      logicContext.lastProcessedWptId = currentTargetWptIdHash; // Update the last processed target ID
    }

    const distance =
      statusString === 'NO_PATH_FOUND' ? null : normalizedPath.length;

    throttleReduxUpdate({
      pathWaypoints: normalizedPath,
      wptDistance: distance,
      routeSearchMs: result.performance?.totalTimeMs || 0,
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
//endFile