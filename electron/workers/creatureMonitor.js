// /home/feiron/Dokumenty/Automaton/electron/workers/creatureMonitor.js
// --- Drop-in Replacement with Full Pathfinder Context ---

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
const JITTER_FILTER_TIME_MS = 100;
const JITTER_HISTORY_LENGTH = 3;

let currentState = null;
let isInitialized = false;
let isShuttingDown = false;
let lastSentCreatures = [];
let lastSentTarget = null;
let lastSpecialAreasJson = ''; // NEW: To track changes in special areas

let previousPlayerMinimapPosition = { x: 0, y: 0, z: 0 };
let playerAnimationFreezeEndTime = 0;
let playerSettlingGracePeriodEndTime = 0;
let lastStablePlayerMinimapPosition = { x: 0, y: 0, z: 0 };

const creatureLastReportedGameCoords = new Map();
const creatureLastCalculatedFloatCoords = new Map();
const creatureReportHistory = new Map();

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
      a.name === b.name &&
      arePositionsEqual(a.gameCoordinates, b.gameCoordinates) &&
      areAbsoluteCoordsEqual(a.absoluteCoordinates, b.absoluteCoordinates)
    );
  }
  return a === b;
}

function processGameWorldEntities(
  ocrData,
  currentPlayerMinimapPosition,
  regions,
  tileSize,
  now,
  isPlayerInAnimationFreeze,
) {
  if (
    !regions?.gameWorld ||
    !tileSize ||
    !currentPlayerMinimapPosition ||
    !Array.isArray(ocrData)
  )
    return [];

  const playerFixedScreenCenterX =
    regions.gameWorld.x + (PLAYER_SCREEN_TILE_X + 0.5) * tileSize.width;
  const playerFixedScreenCenterY =
    regions.gameWorld.y + (PLAYER_SCREEN_TILE_Y + 0.5) * tileSize.height;

  const entities = ocrData
    .map((r) => {
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
        regions.gameWorld,
        tileSize,
      );

      if (!rawGameCoordsFloat) return null;
      const currentCreatureZ = currentPlayerMinimapPosition.z;

      if (isPlayerInAnimationFreeze) {
        let lastReported = creatureLastReportedGameCoords.get(creatureName);
        if (!lastReported) {
          lastReported = {
            x: Math.floor(rawGameCoordsFloat.x),
            y: Math.floor(rawGameCoordsFloat.y),
            z: currentCreatureZ,
          };
          creatureLastReportedGameCoords.set(creatureName, lastReported);
          creatureLastCalculatedFloatCoords.set(creatureName, {
            x: rawGameCoordsFloat.x,
            y: rawGameCoordsFloat.y,
          });
        }
        finalGameX = lastReported.x;
        finalGameY = lastReported.y;
        finalGameZ = lastReported.z;
      } else {
        const lastReportedGameCoords =
          creatureLastReportedGameCoords.get(creatureName);
        const lastCalculatedFloatCoords =
          creatureLastCalculatedFloatCoords.get(creatureName);

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

        const history = creatureReportHistory.get(creatureName) || [];
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
        creatureReportHistory.set(creatureName, history);
      }

      creatureLastReportedGameCoords.set(creatureName, {
        x: finalGameX,
        y: finalGameY,
        z: finalGameZ,
      });
      creatureLastCalculatedFloatCoords.set(creatureName, {
        x: rawGameCoordsFloat.x,
        y: rawGameCoordsFloat.y,
      });

      const dx_pixels = creatureScreenX - playerFixedScreenCenterX;
      const dy_pixels = creatureScreenY - playerFixedScreenCenterY;
      const dx_tiles = dx_pixels / tileSize.width;
      const dy_tiles = dy_pixels / tileSize.height;
      const distance = Math.sqrt(dx_tiles * dx_tiles + dy_tiles * dy_tiles);

      return {
        name: creatureName,
        healthTag: getHealthTagFromColor(r.color),
        absoluteCoords: {
          x: Math.round(creatureScreenX),
          y: Math.round(creatureScreenY),
          lastUpdate: now,
        },
        gameCoords: { x: finalGameX, y: finalGameY, z: finalGameZ },
        distance: parseFloat(distance.toFixed(1)),
      };
    })
    .filter(Boolean)
    .filter(
      (e) =>
        e.gameCoords.x !== currentPlayerMinimapPosition.x ||
        e.gameCoords.y !== currentPlayerMinimapPosition.y ||
        e.gameCoords.z !== currentPlayerMinimapPosition.z,
    );

  const detectedNames = new Set(entities.map((e) => e.name));
  for (const name of creatureLastReportedGameCoords.keys()) {
    if (!detectedNames.has(name)) {
      creatureLastReportedGameCoords.delete(name);
      creatureLastCalculatedFloatCoords.delete(name);
      creatureReportHistory.delete(name);
    }
  }

  entities.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.name.localeCompare(b.name);
  });

  return entities;
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

    // --- NEW: Update special areas if they have changed ---
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
    }
    // --- END NEW ---

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
    }
    previousPlayerMinimapPosition = { ...currentPlayerMinimapPosition };

    const isPlayerInAnimationFreeze = now < playerAnimationFreezeEndTime;
    const ocrData = currentState.ocr.regions.gameWorld || [];

    let detectedEntities = processGameWorldEntities(
      ocrData,
      currentPlayerMinimapPosition,
      regions,
      tileSize,
      now,
      isPlayerInAnimationFreeze,
    );

    if (detectedEntities.length > 0) {
      // Use the full, up-to-date creature list from the *targeting* slice as obstacles
      const allCreaturePositions = (
        currentState.targeting?.creatures || []
      ).map((c) => c.gameCoords);

      detectedEntities = detectedEntities.map((entity) => {
        const otherCreatures = allCreaturePositions.filter(
          (p) => p !== entity.gameCoords,
        );
        const pathLength = pathfinderInstance.getPathLength(
          currentPlayerMinimapPosition,
          entity.gameCoords,
          otherCreatures,
        );
        return {
          ...entity,
          isReachable: pathLength !== -1 && pathLength <= 10,
        };
      });
    }

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
            currentTarget = {
              name: closestCreature.name,
              distance: parseFloat(distanceFromPlayer.toFixed(1)),
              gameCoordinates: closestCreature.gameCoords,
              absoluteCoordinates: closestCreature.absoluteCoords,
            };
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
