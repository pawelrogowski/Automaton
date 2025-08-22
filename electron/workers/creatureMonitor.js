// /home/feiron/Dokumenty/Automaton/electron/workers/creatureMonitor.js
//start file
// creatureMonitor.dropin.js
// Event-driven worker for creature detection: processes only on state updates, no polling, no visual offset tracking, no dirty rects, no logs.

import { parentPort, workerData } from 'worker_threads';
import findTarget from 'find-target-native'; // Import findTarget
import { calculateDistance } from '../utils/distance.js'; // Import calculateDistance
import {
  getGameCoordinatesFromScreen,
  PLAYER_SCREEN_TILE_X,
  PLAYER_SCREEN_TILE_Y,
} from '../utils/gameWorldClickTranslator.js';

// --- Shared data & SAB views ---
const { sharedData } = workerData;
if (!sharedData) throw new Error('[CreatureMonitor] Shared data not provided.');
const { imageSAB, syncSAB, playerPosSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const sharedBufferView = Buffer.from(imageSAB); // Used for findTarget

// shared array indices - keep in sync with your main process
const IS_RUNNING_INDEX = 3;
const PLAYER_X_INDEX = 0;
const PLAYER_Y_INDEX = 1;
const PLAYER_Z_INDEX = 2;

// --- Configuration Constants for Mitigation ---
const PLAYER_ANIMATION_FREEZE_MS = 150; // Duration of strict freezing after playerMinimapPosition changes
const PLAYER_SETTLING_GRACE_PERIOD_MS = 500; // Duration *after* the animation freeze, where we still prioritize stability.
const STICKY_SNAP_THRESHOLD_TILES = 0.4; // How close a fractional coordinate must be to the last reported integer tile to stick to it
const JITTER_FILTER_TIME_MS = 100; // Time window for detecting rapid back-and-forth flickers
const JITTER_HISTORY_LENGTH = 3; // Number of history entries to keep for jitter filtering

// --- State ---
let currentState = null;
let isInitialized = false;
let isShuttingDown = false;
let lastSentCreatures = [];
let lastSentTarget = null;

// --- NEW: State for Positional Change-Triggered Cooldown ---
let previousPlayerMinimapPosition = { x: 0, y: 0, z: 0 }; // Player position from previous cycle
let playerAnimationFreezeEndTime = 0; // Timestamp when the strict animation freeze ends
let playerSettlingGracePeriodEndTime = 0; // Timestamp when the longer settling period ends
let lastStablePlayerMinimapPosition = { x: 0, y: 0, z: 0 }; // Player position used as reference during freeze/cooldown

// Map to store the last *reported stable integer tile* for each creature.
const creatureLastReportedGameCoords = new Map(); // Map<creatureName, {x, y, z}>

// Map to store the last *calculated fractional coordinates* for each creature.
const creatureLastCalculatedFloatCoords = new Map(); // Map<creatureName, {x_float, y_float}>

// Map to store a short history of reported coordinates for jitter filtering.
const creatureReportHistory = new Map(); // Map<creatureName, Array<{coords: {x,y,z}, timestamp: number}>>

// --- Helper to check if two positions are identical ---
function arePositionsEqual(pos1, pos2) {
  return pos1.x === pos2.x && pos1.y === pos2.y && pos1.z === pos2.z;
}

/**
 * Deep comparison for entity arrays/lists to detect meaningful changes.
 * Only compares gameCoords for stability.
 */
function deepCompareEntities(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const entityA = a[i];
      const entityB = b[i];
      // Only compare gameCoords for stability, ignore absoluteCoords and distance for this check
      if (
        !entityA.gameCoords ||
        !entityB.gameCoords ||
        !arePositionsEqual(entityA.gameCoords, entityB.gameCoords)
      ) {
        return false;
      }
      // Optionally compare name if it's part of identity
      if (entityA.name !== entityB.name) return false;
    }
    return true;
  }

  // For single target comparison
  if (typeof a === 'object' && typeof b === 'object') {
    if (
      !a.gameCoordinates ||
      !b.gameCoordinates ||
      !arePositionsEqual(a.gameCoordinates, b.gameCoordinates)
    ) {
      return false;
    }
    if (a.name !== b.name) return false;
    // Other fields like distance, absoluteCoords might fluctuate, focus on gameCoordinates
    return true;
  }

  return a === b;
}

// --- process OCR -> game coords with mitigation logic ---
function processGameWorldEntities(
  ocrData,
  currentPlayerMinimapPosition,
  regions,
  tileSize,
  now,
  isPlayerInAnimationFreeze, // NEW: Pass animation freeze state
  isPlayerInSettlingGracePeriod, // NEW: Pass settling grace period state
) {
  if (
    !regions?.gameWorld ||
    !tileSize ||
    !currentPlayerMinimapPosition ||
    !Array.isArray(ocrData)
  )
    return [];

  // Dynamically calculate player's fixed screen center for distance calculation.
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

      // --- Determine which player position to use for coordinate translation ---
      // During animation freeze, use the last stable player position as reference.
      // Otherwise, use the current player position.
      const playerPosForCreatureCalc = isPlayerInAnimationFreeze
        ? lastStablePlayerMinimapPosition
        : currentPlayerMinimapPosition;

      // Calculate raw fractional game coordinates (best estimate, still oscillates)
      const rawGameCoordsFloat = getGameCoordinatesFromScreen(
        creatureScreenX,
        creatureScreenY,
        playerPosForCreatureCalc, // Use the chosen player position
        regions.gameWorld,
        tileSize,
      );

      if (!rawGameCoordsFloat) return null;

      const currentCreatureZ = currentPlayerMinimapPosition.z; // Creatures are on the same Z as player

      // --- FREEZING LOGIC during animation freeze ---
      if (isPlayerInAnimationFreeze) {
        // If in animation freeze, report the last known stable position.
        // If this is a new creature detected during freeze, calculate its initial integer tile
        // based on the `lastStablePlayerMinimapPosition` and store it.
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
        finalGameZ = lastReported.z; // Ensure Z is also consistent
      } else {
        // --- STICKY SNAPPING LOGIC (when not in animation freeze) ---
        const lastReportedGameCoords =
          creatureLastReportedGameCoords.get(creatureName);
        const lastCalculatedFloatCoords =
          creatureLastCalculatedFloatCoords.get(creatureName);

        const newGameX_int = Math.floor(rawGameCoordsFloat.x);
        const newGameY_int = Math.floor(rawGameCoordsFloat.y);

        finalGameX = newGameX_int;
        finalGameY = newGameY_int;

        if (lastReportedGameCoords && lastCalculatedFloatCoords) {
          // Check if the new fractional position is "close enough" to the last reported integer tile.
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
            // Stick to the last reported integer tile if close.
            finalGameX = lastReportedGameCoords.x;
            finalGameY = lastReportedGameCoords.y;
          } else {
            // If not sticking, update to the new floored integer tile.
            finalGameX = newGameX_int;
            finalGameY = newGameY_int;
          }
        }
        // If no last reported coords, this is the first detection or after a reset, so just use the new floored integer.

        // --- TEMPORAL DEBOUNCING / JITTER FILTER (after sticky snapping) ---
        const history = creatureReportHistory.get(creatureName) || [];
        if (history.length >= 2) {
          const lastEntry = history[history.length - 1];
          const secondLastEntry = history[history.length - 2];

          // Check for rapid X -> Y -> X flicker
          if (
            now - lastEntry.timestamp < JITTER_FILTER_TIME_MS &&
            arePositionsEqual(
              { x: finalGameX, y: finalGameY, z: currentCreatureZ },
              secondLastEntry.coords,
            ) &&
            !arePositionsEqual(
              { x: finalGameX, y: finalGameY, z: currentCreatureZ },
              lastEntry.coords,
            ) // Ensure it's a flicker back
          ) {
            // Discard the flicker and stick to the second-last (stable) position
            finalGameX = secondLastEntry.coords.x;
            finalGameY = secondLastEntry.coords.y;
            finalGameZ = secondLastEntry.coords.z;
          }
        }

        // Update stored stable and float coordinates for next cycle
        creatureLastReportedGameCoords.set(creatureName, {
          x: finalGameX,
          y: finalGameY,
          z: currentCreatureZ,
        });
        creatureLastCalculatedFloatCoords.set(creatureName, {
          x: rawGameCoordsFloat.x,
          y: rawGameCoordsFloat.y,
        });
      }

      // Update creature report history
      let history = creatureReportHistory.get(creatureName) || [];
      history.push({
        coords: { x: finalGameX, y: finalGameY, z: finalGameZ },
        timestamp: now,
      });
      if (history.length > JITTER_HISTORY_LENGTH) {
        history.shift(); // Keep history buffer size limited
      }
      creatureReportHistory.set(creatureName, history);

      // Calculate distance based on dynamically derived player screen center
      const dx_pixels = creatureScreenX - playerFixedScreenCenterX;
      const dy_pixels = creatureScreenY - playerFixedScreenCenterY;

      const dx_tiles = dx_pixels / tileSize.width;
      const dy_tiles = dy_pixels / tileSize.height;

      const distance = Math.sqrt(dx_tiles * dx_tiles + dy_tiles * dy_tiles);

      return {
        name: creatureName,
        absoluteCoords: {
          x: Math.round(creatureScreenX), // Keep absolute screen coords for UI/debugging
          y: Math.round(creatureScreenY),
        },
        gameCoords: { x: finalGameX, y: finalGameY, z: finalGameZ },
        distance: parseFloat(distance.toFixed(1)), // Format distance to 1 decimal place
      };
    })
    .filter(Boolean)
    .filter(
      (e) =>
        e.gameCoords.x !== currentPlayerMinimapPosition.x || // Filter out player's own tile
        e.gameCoords.y !== currentPlayerMinimapPosition.y ||
        e.gameCoords.z !== currentPlayerMinimapPosition.z,
    );

  // Remove creatures that are no longer detected from our tracking maps
  const detectedNames = new Set(entities.map((e) => e.name));
  for (const name of creatureLastReportedGameCoords.keys()) {
    if (!detectedNames.has(name)) {
      creatureLastReportedGameCoords.delete(name);
      creatureLastCalculatedFloatCoords.delete(name);
      creatureReportHistory.delete(name); // Also clear history
    }
  }

  entities.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.name.localeCompare(b.name);
  });

  return entities;
}

// --- main operation ---
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

    // Player position from SAB (this is the one that updates mid-animation)
    const currentPlayerMinimapPosition = {
      x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
      y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
      z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
    };

    const now = Date.now();

    // Detect if player's absolute position has changed
    const playerPositionChanged = !arePositionsEqual(
      currentPlayerMinimapPosition,
      previousPlayerMinimapPosition,
    );

    // Update animation freeze and settling grace period states
    if (playerPositionChanged) {
      playerAnimationFreezeEndTime = now + PLAYER_ANIMATION_FREEZE_MS;
      playerSettlingGracePeriodEndTime =
        playerAnimationFreezeEndTime + PLAYER_SETTLING_GRACE_PERIOD_MS;
      // When player position changes, update lastStablePlayerMinimapPosition to the *new* position.
      lastStablePlayerMinimapPosition = { ...currentPlayerMinimapPosition };
    }
    previousPlayerMinimapPosition = { ...currentPlayerMinimapPosition }; // Update for next cycle's comparison

    const isPlayerInAnimationFreeze = now < playerAnimationFreezeEndTime;
    const isPlayerInSettlingGracePeriod =
      now < playerSettlingGracePeriodEndTime; // This includes the animation freeze period

    const ocrData = currentState.ocr.regions.gameWorld || [];

    const detectedEntities = processGameWorldEntities(
      ocrData,
      currentPlayerMinimapPosition,
      regions,
      tileSize,
      now,
      isPlayerInAnimationFreeze, // Pass animation freeze state
      isPlayerInSettlingGracePeriod, // Pass settling grace period state
    );

    if (!deepCompareEntities(detectedEntities, lastSentCreatures)) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'targeting/setEntities',
        payload: detectedEntities,
      });
      lastSentCreatures = detectedEntities;
    }

    // --- Target Detection Logic ---
    let currentTarget = null;
    try {
      const targetRect = await findTarget.findTarget(
        sharedBufferView,
        gameWorld,
      );

      if (targetRect) {
        const screenX = targetRect.x + targetRect.width / 2;
        const screenY = targetRect.y + targetRect.height / 2;

        // Use the appropriate player position for target game coordinate translation
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
          // Find the closest *reported* creature to the raw target coordinates
          let closestCreature = null;
          let minDistance = Infinity;

          for (const entity of detectedEntities) {
            if (entity.gameCoords) {
              const distance = calculateDistance(
                targetGameCoordsRaw, // Compare to raw target coords
                entity.gameCoords, // Compare to creature's *reported stable* game coords
              );
              if (distance < minDistance) {
                minDistance = distance;
                closestCreature = entity;
              }
            }
          }

          if (closestCreature) {
            const distanceFromPlayer = calculateDistance(
              currentPlayerMinimapPosition, // Distance from *actual* player position
              closestCreature.gameCoords, // to creature's *reported stable* game coords
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

// --- message handler ---
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
        // Initialize previousPlayerMinimapPosition and lastStablePlayerMinimapPosition on first state
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
      // Full state replace (initial state message without a 'type')
      currentState = message;
      lastSentCreatures = [];
      lastSentTarget = null;
      creatureLastReportedGameCoords.clear();
      creatureLastCalculatedFloatCoords.clear();
      creatureReportHistory.clear(); // Clear history on full state reset
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
//endFile
