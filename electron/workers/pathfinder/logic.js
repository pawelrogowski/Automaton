// /home/feiron/Dokumenty/Automaton/electron/workers/pathfinder/logic.js
//start file
// /electron/workers/pathfinder/logic.js

import {
  PATH_STATUS_IDLE,
  PATH_STATUS_PATH_FOUND,
  PATH_STATUS_WAYPOINT_REACHED,
  PATH_STATUS_NO_PATH_FOUND,
  PATH_STATUS_DIFFERENT_FLOOR,
  PATH_STATUS_ERROR,
  PATH_STATUS_NO_VALID_START_OR_END,
  PATH_STATUS_BLOCKED_BY_CREATURE,
} from '../sharedConstants.js';
import { deepHash } from '../../utils/deepHash.js';
import { CONTROL_COMMANDS } from '../sabState/schema.js';

let lastWrittenPathSignature = '';
let sabInterface = null;

export const setSABInterface = (sab) => {
  sabInterface = sab;
};

export function runPathfindingLogic(context) {
  
  const {
    logicContext,
    state,
    pathfinderInstance,
    logger,
    throttleReduxUpdate,
  } = context;

  logicContext.lastProcessedWptId = logicContext.lastProcessedWptId ?? 0;
  try {
    const { cavebot, gameState, targeting } = state;
    
    if (!gameState) {
      logger('debug', `[Pathfinder] Missing gameState`);
      return;
    }
    
    const { playerMinimapPosition } = gameState;
    
    // Read cavebot config from unified SAB (primary source)
    let cavebotConfig = null;
    if (sabInterface) {
      try {
        const result = sabInterface.get('cavebotConfig');
        if (result && result.data) {
          cavebotConfig = result.data;
          logger('debug', `[Pathfinder] Read from SAB: wptId=${cavebotConfig.wptId}, enabled=${cavebotConfig.enabled}`);
        }
      } catch (err) {
        logger('debug', `[Pathfinder] SAB config read failed: ${err.message}`);
      }
    }
    
    // Fallback to Redux cavebot state if SAB read failed
    if (!cavebotConfig && cavebot) {
      cavebotConfig = {
        enabled: cavebot.enabled ? 1 : 0,
        wptId: cavebot.wptId || '',
        currentSection: cavebot.currentSection || '',
      };
      logger('debug', `[Pathfinder] Using Redux fallback: wptId=${cavebotConfig.wptId}`);
    }
    
    if (!cavebotConfig) {
      logger('debug', `[Pathfinder] No cavebot config available`);
      return;
    }

    // Try reading from unified SAB first (consistent snapshot)
    let playerPos = playerMinimapPosition;
    if (sabInterface) {
      try {
        const snapshot = sabInterface.snapshot(['playerPos']);
        if (snapshot.playerPos && typeof snapshot.playerPos.x === 'number') {
          playerPos = snapshot.playerPos;
        }
      } catch (err) {
        logger('debug', `SAB snapshot read failed, falling back to Redux: ${err.message}`);
      }
    }

    if (!playerPos) {
      return;
    }

    const { x, y, z } = playerPos;
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

    // Use wptId from SAB config (primary), fallback to Redux for complex data
    const currentWptId = cavebotConfig.wptId || cavebot?.wptId || '';
    const isTargetingMode = !!(cavebot?.dynamicTarget);
    const currentDynamicTargetJson = isTargetingMode ? JSON.stringify(cavebot.dynamicTarget) : null;

    let result = null;
    let targetIdentifier = isTargetingMode ? currentDynamicTargetJson : currentWptId;
    
    // Early exit if no target
    if (!targetIdentifier) {
      logger('debug', `[Pathfinder] No target identifier (wptId or dynamicTarget)`);
      return;
    }

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
      start: playerPos,
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
                hollow: area.hollow || false,
            }));
            pathfinderInstance.updateSpecialAreas(areasForNative, z);
        }
    }

    if (hasChanges) {
        logicContext.lastAreasByZ = newAreasByZ;
    }

    if (!result) {
      if (isTargetingMode) {
        // Validate dynamicTarget exists before accessing properties
        if (!cavebot.dynamicTarget || !cavebot.dynamicTarget.targetCreaturePos) {
          logger('warn', `[Pathfinder] Invalid dynamicTarget (flickering?): ${JSON.stringify(cavebot.dynamicTarget)}`);
          result = { path: [], reason: 'NO_VALID_END' };
        } else {
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
            playerPos,
            cavebot.dynamicTarget,
            obstacles,
          );
        } else {
          const targetCreature = (targeting.creatures || []).find(
            (c) => c.instanceId === targetInstanceId,
          );

          if (targetCreature && targetCreature.gameCoords) {
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
              playerPos,
              correctedDynamicTarget,
              obstacles,
            );
          } else {
            result = pathfinderInstance.findPathToGoal(
              playerPos,
              cavebot.dynamicTarget,
              creaturePositions,
            );
          }
        }
        }
      } else if (targetIdentifier) {
        const { waypointSections, currentSection, wptId } = cavebot;
        const targetWaypoint = waypointSections[currentSection]?.waypoints.find(
          (wp) => wp.id === wptId,
        );
        if (targetWaypoint) {
          result = pathfinderInstance.findPathSync(
            playerPos,
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
      return;
    }

    const rawPath = result.path || [];
    const statusString = result.reason;
    const isBlocked = result.isBlocked || false;
    const blockingCreatureCoords = result.blockingCreatureCoords || null;

    const normalizedPath = Array.isArray(rawPath) ? rawPath.slice() : [];
    const wptId = isTargetingMode ? 0 : (cavebot.wptId ? cavebot.wptId.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a }, 0) : 0);
    const instanceId = isTargetingMode ? (cavebot.dynamicTarget?.targetInstanceId || 0) : 0;

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

    // Calculate pathTargetCoords outside pathDataArray block (needed by SAB write)
    let pathTargetCoords = { x: 0, y: 0, z: 0 };
    if (isTargetingMode && cavebot.dynamicTarget && cavebot.dynamicTarget.targetCreaturePos) {
      pathTargetCoords = cavebot.dynamicTarget.targetCreaturePos;
    } else {
      const { waypointSections, currentSection, wptId } = cavebot;
      const targetWaypoint = waypointSections[currentSection]?.waypoints.find(
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

    if (pathSignature !== lastWrittenPathSignature || targetWptIdChanged) {
      // Write to unified SAB with complete header fields
      if (sabInterface) {
        try {
          const targetX = normalizedPath.length > 0 ? normalizedPath[normalizedPath.length - 1].x : x;
          const targetY = normalizedPath.length > 0 ? normalizedPath[normalizedPath.length - 1].y : y;
          const chebyshevDistance = Math.max(Math.abs(x - targetX), Math.abs(y - targetY));
          
          const pathPayload = {
            waypoints: normalizedPath,
            length: normalizedPath.length,
            status: statusCode,
            chebyshevDistance,
            startX: x,
            startY: y,
            startZ: z,
            targetX: pathTargetCoords.x,
            targetY: pathTargetCoords.y,
            targetZ: pathTargetCoords.z,
            blockingCreatureX: blockingCreatureCoords?.x || 0,
            blockingCreatureY: blockingCreatureCoords?.y || 0,
            blockingCreatureZ: blockingCreatureCoords?.z || 0,
            wptId,
            instanceId,
          };
          
          // Write to legacy pathData (will be removed in future)
          sabInterface.set('pathData', pathPayload);
          
          // Write to appropriate separate path array
          if (isTargetingMode) {
            sabInterface.set('targetingPathData', pathPayload);
          } else {
            sabInterface.set('cavebotPathData', pathPayload);
          }
        } catch (err) {
          logger('error', `Failed to write path to SAB: ${err.message}`);
        }
      }

      lastWrittenPathSignature = pathSignature;
      logicContext.lastProcessedWptId = currentTargetWptIdHash; // Update the last processed target ID
    }

    // NOTE: We no longer call throttleReduxUpdate here because workerManager
    // now handles SAB→Redux sync. Pathfinder only writes to SAB above.
  } catch (error) {
    logger('error', `Pathfinding error: ${error.message}`);
  }
}
//endFile
