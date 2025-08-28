import { parentPort, workerData } from 'worker_threads';
import findTarget from 'find-target-native';
import Pathfinder from 'pathfinder-native';
import { calculateDistance } from '../utils/distance.js';
import {
  getGameCoordinatesFromScreen,
  PLAYER_SCREEN_TILE_X,
  PLAYER_SCREEN_TILE_Y,
} from '../utils/gameWorldClickTranslator.js';

let pathfinderInstance = null;
const { sharedData, paths } = workerData;
if (!sharedData) throw new Error('[CreatureMonitor] Shared data not provided.');
const { imageSAB, syncSAB, playerPosSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const sharedBufferView = Buffer.from(imageSAB);

const IS_RUNNING_INDEX = 3;
const PLAYER_X_INDEX = 0;
const PLAYER_Y_INDEX = 1;
const PLAYER_Z_INDEX = 2;

const PLAYER_ANIMATION_FREEZE_MS = 150;
const PLAYER_SETTLING_GRACE_PERIOD_MS = 500;
const STICKY_SNAP_THRESHOLD_TILES = 0.4;
const JITTER_FILTER_TIME_MS = 250;
const JITTER_HISTORY_LENGTH = 3;

// Increased from 45 to make correlation much more robust against player and creature movement.
const CORRELATION_DISTANCE_THRESHOLD_PIXELS = 150;

// Grace period to prevent target loss from single-frame detection failures.
const TARGET_LOSS_GRACE_PERIOD_MS = 100;

let currentState = null;
let isInitialized = false;
let isShuttingDown = false;
let lastSentCreatures = [];
let lastSentTarget = null;
let lastSpecialAreasJson = '';

let nextInstanceId = 0;
let activeCreatures = new Map(); // Map<instanceId, creatureObject>
let reachableTilesCache = new Map(); // Map<string, boolean>

function getCoordsKey(coords) {
  return `${coords.x},${coords.y},${coords.z}`;
}

// Timestamp for when the target is truly considered lost after disappearing.
let targetLossGracePeriodEndTime = 0;

let previousPlayerMinimapPosition = { x: 0, y: 0, z: 0 };
let playerAnimationFreezeEndTime = 0;
let playerSettlingGracePeriodEndTime = 0;
let lastStablePlayerMinimapPosition = { x: 0, y: 0, z: 0 };

function getHealthTagFromColor(color) {
  if (!color) return 'Full';
  const { r, g, b } = color;
  if (r === 96 && g === 0 && b === 0) return 'Critical';
  if (r === 192 && g === 0 && b === 0) return 'Low';
  if (r === 192 && g === 192 && b === 0) return 'Medium';
  if (r === 96 && g === 192 && b === 96) return 'High';
  if (r === 0 && g === 192 && b === 0) return 'Full';
  return 'Full';
}

function arePositionsEqual(pos1, pos2) {
  if (!pos1 || !pos2) return pos1 === pos2;
  return pos1.x === pos2.x && pos1.y === pos2.y && pos1.z === pos2.z;
}

function areAbsoluteCoordsEqual(coords1, coords2) {
  if (!coords1 || !coords2) return coords1 === coords2;
  return coords1.x === coords2.x && coords1.y === coords2.y;
}

function deepCompareEntities(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const entityA = a[i];
      const entityB = b[i];
      if (
        entityA.instanceId !== entityB.instanceId ||
        entityA.name !== entityB.name ||
        entityA.healthTag !== entityB.healthTag ||
        entityA.isReachable !== entityB.isReachable ||
        !arePositionsEqual(entityA.gameCoords, entityB.gameCoords) ||
        !areAbsoluteCoordsEqual(entityA.absoluteCoords, entityB.absoluteCoords)
      ) {
        return false;
      }
    }
    return true;
  }

  if (typeof a === 'object' && typeof b === 'object') {
    return (
      a.instanceId === b.instanceId &&
      a.name === b.name &&
      arePositionsEqual(a.gameCoordinates, b.gameCoordinates) &&
      areAbsoluteCoordsEqual(a.absoluteCoordinates, b.absoluteCoordinates)
    );
  }
  return a === b;
}

function screenDist(p1, p2) {
  if (!p1 || !p2) return Infinity;
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function updateCreatureState(
  creature,
  detection,
  currentPlayerMinimapPosition,
  regions,
  tileSize,
  now,
  isPlayerInAnimationFreeze,
) {
  const { gameWorld } = regions;
  const { r } = detection;
  const creatureName = r.text;
  const creatureScreenX = r.click.x;
  const NAMEPLATE_TEXT_HEIGHT = 10;
  const textHeight = r.height ?? NAMEPLATE_TEXT_HEIGHT;
  const nameplateCenterY = r.y + textHeight / 2 + tileSize.height / 10;
  const creatureScreenY = nameplateCenterY + tileSize.height / 1.4;

  let finalGameX,
    finalGameY,
    finalGameZ = currentPlayerMinimapPosition.z;

  const playerPosForCreatureCalc = isPlayerInAnimationFreeze
    ? lastStablePlayerMinimapPosition
    : currentPlayerMinimapPosition;

  const rawGameCoordsFloat = getGameCoordinatesFromScreen(
    creatureScreenX,
    creatureScreenY,
    playerPosForCreatureCalc,
    gameWorld,
    tileSize,
  );

  if (!rawGameCoordsFloat) return null;
  const currentCreatureZ = currentPlayerMinimapPosition.z;

  if (isPlayerInAnimationFreeze && creature.gameCoords) {
    finalGameX = creature.gameCoords.x;
    finalGameY = creature.gameCoords.y;
    finalGameZ = creature.gameCoords.z;
  } else {
    const lastReportedGameCoords = creature.gameCoords;
    const lastCalculatedFloatCoords = creature.lastCalculatedFloatCoords;

    const newGameX_int = Math.floor(rawGameCoordsFloat.x);
    const newGameY_int = Math.floor(rawGameCoordsFloat.y);

    finalGameX = newGameX_int;
    finalGameY = newGameY_int;

    if (lastReportedGameCoords && lastCalculatedFloatCoords) {
      const distX_to_last_int = Math.abs(
        rawGameCoordsFloat.x - lastReportedGameCoords.x,
      );
      const distY_to_last_int = Math.abs(
        rawGameCoordsFloat.y - lastReportedGameCoords.y,
      );

      if (
        distX_to_last_int < STICKY_SNAP_THRESHOLD_TILES &&
        distY_to_last_int < STICKY_SNAP_THRESHOLD_TILES
      ) {
        finalGameX = lastReportedGameCoords.x;
        finalGameY = lastReportedGameCoords.y;
      }
    }

    const history = creature.reportHistory || [];
    if (history.length >= 2) {
      const lastEntry = history[history.length - 1];
      const secondLastEntry = history[history.length - 2];

      if (
        now - lastEntry.timestamp < JITTER_FILTER_TIME_MS &&
        arePositionsEqual(
          { x: finalGameX, y: finalGameY, z: currentCreatureZ },
          secondLastEntry.coords,
        ) &&
        !arePositionsEqual(
          { x: finalGameX, y: finalGameY, z: currentCreatureZ },
          lastEntry.coords,
        )
      ) {
        finalGameX = secondLastEntry.coords.x;
        finalGameY = secondLastEntry.coords.y;
        finalGameZ = secondLastEntry.coords.z;
      }
    }

    history.push({
      coords: { x: finalGameX, y: finalGameY, z: finalGameZ },
      timestamp: now,
    });
    if (history.length > JITTER_HISTORY_LENGTH) {
      history.shift();
    }
    creature.reportHistory = history;
  }

  creature.lastCalculatedFloatCoords = {
    x: rawGameCoordsFloat.x,
    y: rawGameCoordsFloat.y,
  };

  const playerFixedScreenCenterX =
    gameWorld.x + (PLAYER_SCREEN_TILE_X + 0.5) * tileSize.width;
  const playerFixedScreenCenterY =
    gameWorld.y + (PLAYER_SCREEN_TILE_Y + 0.5) * tileSize.height;

  const dx_pixels = creatureScreenX - playerFixedScreenCenterX;
  const dy_pixels = creatureScreenY - playerFixedScreenCenterY;
  const dx_tiles = dx_pixels / tileSize.width;
  const dy_tiles = dy_pixels / tileSize.height;
  const distance = Math.sqrt(dx_tiles * dx_tiles + dy_tiles * dy_tiles);

  creature.name = creatureName;
  creature.healthTag = getHealthTagFromColor(r.color);
  creature.absoluteCoords = {
    x: Math.round(creatureScreenX),
    y: Math.round(creatureScreenY),
    lastUpdate: now,
  };
  creature.gameCoords = { x: finalGameX, y: finalGameY, z: finalGameZ };
  creature.distance = parseFloat(distance.toFixed(1));

  return creature;
}

async function performOperation() {
  try {
    if (
      !isInitialized ||
      !currentState?.regionCoordinates?.regions ||
      !currentState?.ocr?.regions ||
      !currentState?.gameState ||
      !pathfinderInstance ||
      !pathfinderInstance.isLoaded
    )
      return;

    const specialAreas = currentState.cavebot?.specialAreas || [];
    const currentSpecialAreasJson = JSON.stringify(specialAreas);
    if (currentSpecialAreasJson !== lastSpecialAreasJson) {
      const areasForNative = specialAreas.map((area) => ({
        x: area.x,
        y: area.y,
        z: area.z,
        avoidance: area.avoidance,
        width: area.sizeX,
        height: area.sizeY,
      }));
      pathfinderInstance.updateSpecialAreas(
        areasForNative,
        currentState.gameState.playerMinimapPosition.z,
      );
      lastSpecialAreasJson = currentSpecialAreasJson;
      reachableTilesCache.clear(); // Invalidate cache when special areas change
    }

    const { regions } = currentState.regionCoordinates;
    const { gameWorld, tileSize } = regions;
    if (
      !gameWorld ||
      !tileSize ||
      typeof gameWorld.x !== 'number' ||
      typeof tileSize.width !== 'number'
    )
      return;

    const currentPlayerMinimapPosition = {
      x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
      y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
      z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
    };

    const now = Date.now();
    const playerPositionChanged = !arePositionsEqual(
      currentPlayerMinimapPosition,
      previousPlayerMinimapPosition,
    );

    if (playerPositionChanged) {
      playerAnimationFreezeEndTime = now + PLAYER_ANIMATION_FREEZE_MS;
      playerSettlingGracePeriodEndTime =
        playerAnimationFreezeEndTime + PLAYER_SETTLING_GRACE_PERIOD_MS;
      lastStablePlayerMinimapPosition = { ...currentPlayerMinimapPosition };
      reachableTilesCache.clear(); // Invalidate cache when player position changes
    }
    previousPlayerMinimapPosition = { ...currentPlayerMinimapPosition };

    const isPlayerInAnimationFreeze = now < playerAnimationFreezeEndTime;
    const ocrData = currentState.ocr.regions.gameWorld || [];

    const preliminaryDetections = ocrData
      .map((r) => ({
        name: r.text,
        absoluteCoords: { x: r.click.x, y: r.click.y },
        r,
      }))
      .filter(Boolean);

    const newActiveCreatures = new Map();
    const matchedDetections = new Set();

    for (const [instanceId, oldCreature] of activeCreatures.entries()) {
      let bestMatch = null;
      let minDistance = CORRELATION_DISTANCE_THRESHOLD_PIXELS;

      for (const newDetection of preliminaryDetections) {
        if (matchedDetections.has(newDetection)) continue;
        if (newDetection.name !== oldCreature.name) continue;

        const distance = screenDist(
          newDetection.absoluteCoords,
          oldCreature.absoluteCoords,
        );
        if (distance < minDistance) {
          minDistance = distance;
          bestMatch = newDetection;
        }
      }

      if (bestMatch) {
        const updatedCreature = updateCreatureState(
          oldCreature,
          bestMatch,
          currentPlayerMinimapPosition,
          regions,
          tileSize,
          now,
          isPlayerInAnimationFreeze,
        );
        if (updatedCreature) {
          newActiveCreatures.set(instanceId, updatedCreature);
        }
        matchedDetections.add(bestMatch);
      }
    }

    for (const newDetection of preliminaryDetections) {
      if (!matchedDetections.has(newDetection)) {
        const newInstanceId = nextInstanceId++;
        let newCreature = { instanceId: newInstanceId, reportHistory: [] };
        newCreature = updateCreatureState(
          newCreature,
          newDetection,
          currentPlayerMinimapPosition,
          regions,
          tileSize,
          now,
          isPlayerInAnimationFreeze,
        );
        if (newCreature) {
          newActiveCreatures.set(newInstanceId, newCreature);
        }
      }
    }

    activeCreatures = newActiveCreatures;

    let detectedEntities = Array.from(activeCreatures.values()).filter(
      (e) =>
        e.gameCoords.x !== currentPlayerMinimapPosition.x ||
        e.gameCoords.y !== currentPlayerMinimapPosition.y ||
        e.gameCoords.z !== currentPlayerMinimapPosition.z,
    );

    if (detectedEntities.length > 0) {
      // Use the full, up-to-date creature list from the *targeting* slice as obstacles
      const allCreaturePositions = (
        currentState.targeting?.creatures || []
      ).map((c) => c.gameCoords);

      detectedEntities = detectedEntities.map((entity) => {
        const coordsKey = getCoordsKey(entity.gameCoords);
        let isReachable = reachableTilesCache.get(coordsKey);

        if (typeof isReachable === 'undefined') {
          const otherCreatures = allCreaturePositions.filter(
            (p) => p !== entity.gameCoords,
          );
          const pathLength = pathfinderInstance.getPathLength(
            currentPlayerMinimapPosition,
            entity.gameCoords,
            otherCreatures,
          );
          isReachable = pathLength !== -1 && pathLength <= 10;
          reachableTilesCache.set(coordsKey, isReachable);
        }

        return {
          ...entity,
          isReachable: isReachable,
        };
      });
    }

    detectedEntities.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.name.localeCompare(b.name);
    });

    if (!deepCompareEntities(detectedEntities, lastSentCreatures)) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'targeting/setEntities',
        payload: detectedEntities,
      });
      lastSentCreatures = detectedEntities;
    }

    let currentTarget = null;
    try {
      const targetRect = await findTarget.findTarget(
        sharedBufferView,
        gameWorld,
      );

      if (targetRect) {
        targetLossGracePeriodEndTime = 0; // Target found, reset grace period.
        const screenX = targetRect.x + targetRect.width / 2;
        const screenY = targetRect.y + targetRect.height / 2;
        const playerPosForTargetCalc = isPlayerInAnimationFreeze
          ? lastStablePlayerMinimapPosition
          : currentPlayerMinimapPosition;
        const targetGameCoordsRaw = getGameCoordinatesFromScreen(
          screenX,
          screenY,
          playerPosForTargetCalc,
          gameWorld,
          tileSize,
        );

        if (targetGameCoordsRaw) {
          let closestCreature = null;
          let minDistance = Infinity;
          for (const entity of detectedEntities) {
            if (entity.gameCoords) {
              const distance = calculateDistance(
                targetGameCoordsRaw,
                entity.gameCoords,
              );
              if (distance < minDistance) {
                minDistance = distance;
                closestCreature = entity;
              }
            }
          }

          if (closestCreature) {
            const distanceFromPlayer = calculateDistance(
              currentPlayerMinimapPosition,
              closestCreature.gameCoords,
            );
            // The target object in Redux needs the instanceId for unique identification.
            currentTarget = {
              instanceId: closestCreature.instanceId,
              name: closestCreature.name,
              distance: parseFloat(distanceFromPlayer.toFixed(1)),
              gameCoordinates: closestCreature.gameCoords,
              absoluteCoordinates: closestCreature.absoluteCoords,
            };
          }
        }
      } else {
        // --- Target NOT FOUND ---
        if (lastSentTarget) {
          // Only apply grace period if we previously had a target.
          if (targetLossGracePeriodEndTime === 0) {
            // Target was visible last frame, but not this one. Start the grace period.
            targetLossGracePeriodEndTime = now + TARGET_LOSS_GRACE_PERIOD_MS;
          }

          if (now < targetLossGracePeriodEndTime) {
            // Grace period is active, so we pretend the target is still there to prevent flickering.
            currentTarget = lastSentTarget;
          } else {
            // Grace period has expired. The target is officially lost.
            currentTarget = null;
          }
        }
      }
    } catch (err) {
      console.error('[CreatureMonitor] Error finding target:', err);
    }

    if (!deepCompareEntities(currentTarget, lastSentTarget)) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'targeting/setTarget',
        payload: currentTarget,
      });
      lastSentTarget = currentTarget;
    }
  } catch (error) {
    console.error('[CreatureMonitor] Error in operation:', error);
  }
}

async function initialize() {
  console.log('[CreatureMonitor] Initializing Pathfinder instance...');
  try {
    pathfinderInstance = new Pathfinder.Pathfinder();
    const fs = await import('fs/promises');
    const path = await import('path');

    const mapDataForAddon = {};
    const baseDir = paths.minimapResources;
    const zLevelDirs = (await fs.readdir(baseDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && d.name.startsWith('z'))
      .map((d) => d.name);

    for (const zDir of zLevelDirs) {
      const zLevel = parseInt(zDir.substring(1), 10);
      const zLevelPath = path.join(baseDir, zDir);
      try {
        const metadata = JSON.parse(
          await fs.readFile(path.join(zLevelPath, 'walkable.json'), 'utf8'),
        );
        const grid = await fs.readFile(path.join(zLevelPath, 'walkable.bin'));
        mapDataForAddon[zLevel] = { ...metadata, grid };
      } catch (e) {
        if (e.code !== 'ENOENT') {
          console.warn(
            `[CreatureMonitor] Could not load path data for Z=${zLevel}: ${e.message}`,
          );
        }
      }
    }
    pathfinderInstance.loadMapData(mapDataForAddon);
    if (pathfinderInstance.isLoaded) {
      console.log(
        '[CreatureMonitor] Pathfinder instance loaded map data successfully.',
      );
    } else {
      throw new Error('Pathfinder failed to load map data.');
    }
  } catch (err) {
    console.error(
      '[CreatureMonitor] FATAL: Could not initialize Pathfinder instance:',
      err,
    );
    pathfinderInstance = null;
  }
}

parentPort.on('message', (message) => {
  if (isShuttingDown) {
    return;
  }
  try {
    if (message.type === 'shutdown') {
      isShuttingDown = true;
      return;
    } else if (message.type === 'state_diff') {
      if (!currentState) currentState = {};
      Object.assign(currentState, message.payload);
    } else if (typeof message === 'object' && !message.type) {
      currentState = message;
    }

    if (currentState && !isInitialized) {
      isInitialized = true;
      initialize()
        .then(() => {
          if (currentState.gameState?.playerMinimapPosition) {
            previousPlayerMinimapPosition = {
              ...currentState.gameState.playerMinimapPosition,
            };
            lastStablePlayerMinimapPosition = {
              ...currentState.gameState.playerMinimapPosition,
            };
          }
        })
        .catch((err) => {
          console.error('[CreatureMonitor] Initialization failed:', err);
        });
    }
    performOperation();
  } catch (e) {
    console.error('[CreatureMonitor] Error handling message:', e);
  }
});
