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
  CONTROL_COMMANDS,
} from '../sabState/schema.js';
import { deepHash } from '../../utils/deepHash.js';

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
    // Read all data from SAB (single source of truth)
    if (!sabInterface) {
      logger('error', `[Pathfinder] SAB interface not available`);
      return;
    }

    // Read configs from SAB
    const cavebotConfigResult = sabInterface.get('cavebotConfig');
    const targetingConfigResult = sabInterface.get('targetingConfig');

    const cavebotConfig = cavebotConfigResult?.data || null;
    const targetingConfig = targetingConfigResult?.data || null;

    const cavebotEnabled = cavebotConfig?.enabled === 1;
    const targetingEnabled = targetingConfig?.enabled === 1;

    // Early exit if neither system needs pathfinding
    if (!cavebotEnabled && !targetingEnabled) {
      logger('debug', `[Pathfinder] Both cavebot and targeting disabled`);
      return;
    }

    // Read player position from SAB
    const playerPosResult = sabInterface.get('playerPos');
    if (!playerPosResult || !playerPosResult.data) {
      logger('debug', `[Pathfinder] No player position in SAB`);
      return;
    }

    const playerPos = playerPosResult.data;
    const { x, y, z } = playerPos;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof z !== 'number'
    ) {
      logger('error', `Invalid player position: {x: ${x}, y: ${y}, z: ${z}}`);
      return;
    }

    // Read creatures from SAB for obstacle avoidance
    const creaturesResult = sabInterface.get('creatures');
    const creatures = creaturesResult?.data || [];
    const creaturePositions = creatures
      .filter(
        (c) => c.x !== undefined && c.y !== undefined && c.z !== undefined,
      )
      .map((c) => ({ x: c.x, y: c.y, z: c.z }));

    // Read dynamicTarget from SAB (high-performance struct)
    const dynamicTargetResult = sabInterface.get('dynamicTarget');
    const dynamicTargetSAB = dynamicTargetResult?.data;
    const isTargetingMode = dynamicTargetSAB?.valid === 1;

    // OPTIMIZATION: Read targetWaypoint ONCE at function start to avoid duplicate reads
    const targetWaypointResult = sabInterface.get('targetWaypoint');
    const targetWaypointSAB = targetWaypointResult?.data;

    // Reconstruct dynamicTarget object from SAB if valid
    let dynamicTarget = null;
    if (isTargetingMode) {
      const stanceMap = ['Follow', 'Stand', 'Reach'];
      dynamicTarget = {
        targetCreaturePos: {
          x: dynamicTargetSAB.targetCreaturePosX,
          y: dynamicTargetSAB.targetCreaturePosY,
          z: dynamicTargetSAB.targetCreaturePosZ,
        },
        targetInstanceId: dynamicTargetSAB.targetInstanceId,
        stance: stanceMap[dynamicTargetSAB.stance] || 'Follow',
        distance: dynamicTargetSAB.distance,
      };
    }

    const currentWptId = cavebotConfig?.wptId || '';

    // Determine effective mode based solely on SAB:
    // - Targeting mode: targeting enabled AND dynamicTarget.valid === 1
    // - Cavebot mode: cavebot enabled AND NOT in targeting mode
    const targetingModeActive = targetingEnabled && isTargetingMode;
    const cavebotModeActive = cavebotEnabled && !targetingModeActive;

    if (!targetingModeActive && !cavebotModeActive) {
      logger(
        'debug',
        `[Pathfinder] No active mode (no valid dynamicTarget and/or wptId)`,
      );
      return;
    }

    // Read special areas from SAB (permanent avoid areas)
    const specialAreasResult = sabInterface.get('specialAreas');
    const permanentSpecialAreas = (specialAreasResult?.data || []).map(
      (area) => ({
        x: area.x,
        y: area.y,
        z: area.z,
        sizeX: area.sizeX,
        sizeY: area.sizeY,
        avoidance: area.avoidance,
        enabled: area.enabled === 1,
        hollow: area.hollow === 1,
      }),
    );

    // Read temporary blocked tiles from SAB
    const temporaryBlockedTilesResult = sabInterface.get(
      'temporaryBlockedTiles',
    );
    const temporaryBlockedTiles = temporaryBlockedTilesResult?.data || [];

    // Convert temporary tiles into the format the pathfinder expects for special areas
    const temporarySpecialAreas = temporaryBlockedTiles.map((tile) => ({
      x: tile.x,
      y: tile.y,
      z: tile.z,
      sizeX: 1,
      sizeY: 1,
      avoidance: 100, // High avoidance cost to ensure it's avoided
      type: 'temporary', // Custom type for debugging
      enabled: true,
    }));

    const allSpecialAreas = [
      ...permanentSpecialAreas,
      ...temporarySpecialAreas,
    ];
    const activeSpecialAreas = allSpecialAreas.filter((area) => area.enabled);

    const pathfindingInput = targetingModeActive
      ? {
          // Targeting path input
          start: playerPos,
          target: dynamicTarget,
          obstacles: creaturePositions,
          specialAreas: activeSpecialAreas,
        }
      : {
          // Cavebot path input
          start: playerPos,
          target: currentWptId,
          obstacles: creaturePositions,
          specialAreas: activeSpecialAreas,
        };

    const currentSignature = deepHash(pathfindingInput);

    if (logicContext.lastSignature === currentSignature) {
      result = logicContext.lastResult;
    } else {
      logicContext.lastSignature = currentSignature;
      logicContext.lastResult = null;
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
        logger(
          'debug',
          `Special areas for z-level ${z} have changed. Updating native module.`,
        );
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
      if (targetingModeActive) {
        // Targeting mode: compute creature-focused path
        if (!dynamicTarget || !dynamicTarget.targetCreaturePos) {
          logger(
            'warn',
            `[Pathfinder] Invalid dynamicTarget (flickering?): ${JSON.stringify(
              dynamicTarget,
            )}`,
          );
          result = { path: [], reason: 'NO_VALID_END' };
        } else {
          const targetInstanceId = dynamicTarget.targetInstanceId;

          if (!targetInstanceId) {
            const obstacles = creaturePositions.filter((pos) => {
              return (
                pos.x !== dynamicTarget.targetCreaturePos.x ||
                pos.y !== dynamicTarget.targetCreaturePos.y ||
                pos.z !== dynamicTarget.targetCreaturePos.z
              );
            });
            result = pathfinderInstance.findPathToGoal(
              playerPos,
              dynamicTarget,
              obstacles,
            );
          } else {
            const targetCreature = creatures.find(
              (c) => c.instanceId === targetInstanceId,
            );

            if (targetCreature && targetCreature.x !== undefined) {
              const correctedDynamicTarget = {
                ...dynamicTarget,
                targetCreaturePos: {
                  x: targetCreature.x,
                  y: targetCreature.y,
                  z: targetCreature.z,
                },
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
                dynamicTarget,
                creaturePositions,
              );
            }
          }
        }
      } else if (cavebotModeActive) {
        // Cavebot mode: compute waypoint-focused path using targetWaypoint
        if (targetWaypointSAB && targetWaypointSAB.valid === 1) {
          result = pathfinderInstance.findPathSync(
            playerPos,
            {
              x: targetWaypointSAB.x,
              y: targetWaypointSAB.y,
              z: targetWaypointSAB.z,
            },
            creaturePositions,
          );
        } else {
          result = { path: [], reason: 'NO_VALID_END' };
        }
      }

      if (!result) {
        // Fallback classification when no result computed
        result = {
          path: [],
          reason: 'NO_PATH_FOUND',
        };
      }

      logicContext.lastResult = result;
    }

    if (!result) {
      // If still no result (defensive), emit IDLE for the active mode only
      if (sabInterface) {
        try {
          const baseIdlePayload = {
            waypoints: [],
            length: 0,
            status: PATH_STATUS_IDLE,
            chebyshevDistance: 0,
            startX: playerPos.x,
            startY: playerPos.y,
            startZ: playerPos.z,
            targetX: 0,
            targetY: 0,
            targetZ: 0,
            blockingCreatureX: 0,
            blockingCreatureY: 0,
            blockingCreatureZ: 0,
            wptId: 0,
            instanceId: 0,
            lastUpdateTimestamp: Date.now(),
          };

          if (targetingModeActive) {
            sabInterface.set('targetingPathData', baseIdlePayload);
            // Optional debug legacy mirror (no consumers allowed)
            sabInterface.set('pathData', baseIdlePayload);
          } else if (cavebotModeActive) {
            const wptIdHash =
              cavebotConfig?.wptId
                ?.split('')
                .reduce((a, b) => {
                  a = (a << 5) - a + b.charCodeAt(0);
                  return a & a;
                }, 0) || 0;

            const cavebotIdle = {
              ...baseIdlePayload,
              wptId: wptIdHash,
            };

            sabInterface.set('cavebotPathData', cavebotIdle);
            // Optional debug legacy mirror (no consumers allowed)
            sabInterface.set('pathData', cavebotIdle);
          }
        } catch (err) {
          logger('error', `[Pathfinder] Failed to write idle status: ${err.message}`);
        }
      }
      return;
    }

    const rawPath = result.path || [];
    const statusString = result.reason;
    const isBlocked = result.isBlocked || false;
    const blockingCreatureCoords = result.blockingCreatureCoords || null;

    const normalizedPath = Array.isArray(rawPath) ? rawPath.slice() : [];

    // Compute identifiers:
    // - Cavebot: wptId = hash(cavebotConfig.wptId), instanceId = 0
    // - Targeting: instanceId = dynamicTarget.targetInstanceId, wptId = 0
    const wptId =
      cavebotModeActive && cavebotConfig?.wptId
        ? cavebotConfig.wptId
            .split('')
            .reduce((a, b) => {
              a = (a << 5) - a + b.charCodeAt(0);
              return a & a;
            }, 0)
        : 0;
    const instanceId = targetingModeActive
      ? dynamicTarget?.targetInstanceId || 0
      : 0;

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

    const pathSignature = `${statusCode}:${normalizedPath
      .map((p) => `${p.x},${p.y},${p.z}`)
      .join(';')}:${wptId}:${instanceId}`;

    const currentTargetWptIdHash = targetingModeActive ? instanceId : wptId;
    const targetWptIdChanged =
      currentTargetWptIdHash !== logicContext.lastProcessedWptId;

    // Calculate pathTargetCoords outside pathDataArray block (needed by SAB write)
    let pathTargetCoords = { x: 0, y: 0, z: 0 };
    if (targetingModeActive && dynamicTarget && dynamicTarget.targetCreaturePos) {
      pathTargetCoords = dynamicTarget.targetCreaturePos;
    } else {
      // Use the cached targetWaypointSAB read above (avoid duplicate SAB reads)
      if (targetWaypointSAB && targetWaypointSAB.valid === 1) {
        pathTargetCoords = {
          x: targetWaypointSAB.x,
          y: targetWaypointSAB.y,
          z: targetWaypointSAB.z,
        };
      }
    }

    if (pathSignature !== lastWrittenPathSignature || targetWptIdChanged) {
      // Write to unified SAB with complete header fields
      if (sabInterface) {
        try {
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

          const basePayload = {
            waypoints: normalizedPath,
            length: normalizedPath.length,
            status: statusCode,
            chebyshevDistance,
            startX: x,
            startY: y,
            startZ: z,
            targetX: pathTargetCoords.x || targetX,
            targetY: pathTargetCoords.y || targetY,
            targetZ: pathTargetCoords.z || z,
            blockingCreatureX: blockingCreatureCoords?.x || 0,
            blockingCreatureY: blockingCreatureCoords?.y || 0,
            blockingCreatureZ: blockingCreatureCoords?.z || 0,
            wptId,
            instanceId,
            lastUpdateTimestamp: Date.now(),
          };

          if (targetingModeActive) {
            // Targeting: authoritative write to targetingPathData only
            const targetingPayload = {
              ...basePayload,
              wptId: 0,
              instanceId,
            };
            sabInterface.set('targetingPathData', targetingPayload);

            // Optional legacy debug mirror (no consumers allowed)
            sabInterface.set('pathData', targetingPayload);
          } else if (cavebotModeActive) {
            // Cavebot: authoritative write to cavebotPathData only
            const cavebotPayload = {
              ...basePayload,
              instanceId: 0,
            };
            sabInterface.set('cavebotPathData', cavebotPayload);

            // Optional legacy debug mirror (no consumers allowed)
            sabInterface.set('pathData', cavebotPayload);
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
