// /home/feiron/Dokumenty/Automaton/electron/workers/creatureMonitor.js

import { parentPort, workerData } from 'worker_threads';
import findTarget from 'find-target-native';
import { calculateDistance } from '../utils/distance.js';
import {
  getGameCoordinatesFromScreen,
  PLAYER_SCREEN_TILE_X,
  PLAYER_SCREEN_TILE_Y,
} from '../utils/gameWorldClickTranslator.js';
// REMOVED: SAB constants for creatures are no longer needed here

// --- Shared data & SAB views ---
const { sharedData } = workerData;
if (!sharedData) throw new Error('[CreatureMonitor] Shared data not provided.');
const { imageSAB, syncSAB, playerPosSAB } = sharedData; // creaturePosSAB is removed
const syncArray = new Int32Array(syncSAB);
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const sharedBufferView = Buffer.from(imageSAB);

const IS_RUNNING_INDEX = 3;
const PLAYER_X_INDEX = 0;
const PLAYER_Y_INDEX = 1;
const PLAYER_Z_INDEX = 2;

// --- Config, State, and Helpers (largely unchanged, but SAB logic is gone) ---
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

let previousPlayerMinimapPosition = { x: 0, y: 0, z: 0 };
let playerAnimationFreezeEndTime = 0;
let playerSettlingGracePeriodEndTime = 0;
let lastStablePlayerMinimapPosition = { x: 0, y: 0, z: 0 };

const creatureLastReportedGameCoords = new Map();
const creatureLastCalculatedFloatCoords = new Map();
const creatureReportHistory = new Map();

function arePositionsEqual(pos1, pos2) {
  if (!pos1 || !pos2) return false;
  return pos1.x === pos2.x && pos1.y === pos2.y && pos1.z === pos2.z;
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
        !entityA.gameCoords ||
        !entityB.gameCoords ||
        !arePositionsEqual(entityA.gameCoords, entityB.gameCoords)
      ) {
        return false;
      }
      if (entityA.name !== entityB.name) return false;
    }
    return true;
  }

  if (typeof a === 'object' && typeof b === 'object') {
    if (
      !a.gameCoordinates ||
      !b.gameCoordinates ||
      !arePositionsEqual(a.gameCoordinates, b.gameCoordinates)
    ) {
      return false;
    }
    if (a.name !== b.name) return false;
    return true;
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
        absoluteCoords: {
          x: Math.round(creatureScreenX),
          y: Math.round(creatureScreenY),
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
      !currentState?.regionCoordinates?.regions ||
      !currentState?.ocr?.regions ||
      !currentState?.gameState
    )
      return;

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
    const isPlayerInSettlingGracePeriod =
      now < playerSettlingGracePeriodEndTime;
    const ocrData = currentState.ocr.regions.gameWorld || [];

    const detectedEntities = processGameWorldEntities(
      ocrData,
      currentPlayerMinimapPosition,
      regions,
      tileSize,
      now,
      isPlayerInAnimationFreeze,
      isPlayerInSettlingGracePeriod,
    );

    // REMOVED: All logic writing to creaturePosSAB is gone.

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

// --- (message handler remains the same) ---
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
      if (!isInitialized) {
        isInitialized = true;
        if (currentState.gameState?.playerMinimapPosition) {
          previousPlayerMinimapPosition = {
            ...currentState.gameState.playerMinimapPosition,
          };
          lastStablePlayerMinimapPosition = {
            ...currentState.gameState.playerMinimapPosition,
          };
        }
      }
      performOperation();
      return;
    } else if (typeof message === 'object' && !message.type) {
      currentState = message;
      lastSentCreatures = [];
      lastSentTarget = null;
      creatureLastReportedGameCoords.clear();
      creatureLastCalculatedFloatCoords.clear();
      creatureReportHistory.clear();
      if (!isInitialized) {
        isInitialized = true;
        if (currentState.gameState?.playerMinimapPosition) {
          previousPlayerMinimapPosition = {
            ...currentState.gameState.playerMinimapPosition,
          };
          lastStablePlayerMinimapPosition = {
            ...currentState.gameState.playerMinimapPosition,
          };
        }
      }
      performOperation();
      return;
    }
  } catch (e) {
    console.error('[CreatureMonitor] Error handling message:', e);
  }
});
