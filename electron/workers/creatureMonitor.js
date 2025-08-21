// creatureMonitor.dropin.js
// Event-driven worker for creature detection: processes only on state updates, no polling, no visual offset tracking, no dirty rects, no logs.

import { parentPort, workerData } from 'worker_threads';
// Removed: performance import (as no timing is done)

import { chebyshevDistance } from '../utils/distance.js';
import { getGameCoordinatesFromScreen } from '../utils/gameWorldClickTranslator.js';
// Removed: all imports for now-unused modules

// --- Config ---
// Removed: SCAN_INTERVAL_MS and other config constants as the worker is now event-driven

// --- Shared data & SAB views ---
const { sharedData } = workerData;
if (!sharedData) throw new Error('[CreatureMonitor] Shared data not provided.');
const { imageSAB, syncSAB, playerPosSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
// sharedBufferView is no longer actively used for image processing in this stripped-down version,
// but it might be implicitly part of sharedData setup, so leaving its declaration.
const sharedBufferView = Buffer.from(imageSAB);

// shared array indices - keep in sync with your main process
const IS_RUNNING_INDEX = 3;
const PLAYER_X_INDEX = 0;
const PLAYER_Y_INDEX = 1;
const PLAYER_Z_INDEX = 2;

// --- State ---
let currentState = null;
let isInitialized = false; // Still useful for tracking initial setup completion
let isShuttingDown = false;
let lastSentCreatures = [];
let lastPlayerMinimapPosition = null;

// Removed: all logging-related state variables

/**
 * Deep comparison for entity arrays/lists to detect meaningful changes.
 */
function deepCompareEntities(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepCompareEntities(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!deepCompareEntities(a[key], b[key])) return false;
    }
    return true;
  }

  return a === b;
}

// --- process OCR -> game coords (no visualOffsetPx application) ---
function processGameWorldEntities(
  ocrData,
  playerMinimapPosition,
  regions,
  tileSize,
) {
  if (
    !regions?.gameWorld ||
    !tileSize ||
    !playerMinimapPosition ||
    !Array.isArray(ocrData)
  )
    return [];
  const entities = ocrData
    .map((r) => {
      // ScreenX and screenY are simply the raw OCR detection. No offset applied.
      const creatureScreenX = r.click.x;
      const NAMEPLATE_TEXT_HEIGHT = 10;
      const textHeight = r.height ?? NAMEPLATE_TEXT_HEIGHT;
      const nameplateCenterY = r.y + textHeight / 2;

      // map nameplate center down by half a tile to reach approximate creature center
      const creatureScreenY = nameplateCenterY + tileSize.height / 2;

      const gameCoords = getGameCoordinatesFromScreen(
        creatureScreenX,
        creatureScreenY,
        playerMinimapPosition,
        regions.gameWorld,
        tileSize,
      );
      if (!gameCoords) return null;
      gameCoords.x = Math.round(gameCoords.x);
      gameCoords.y = Math.round(gameCoords.y);
      gameCoords.z = playerMinimapPosition.z;
      const distance = chebyshevDistance(gameCoords, playerMinimapPosition);
      return {
        name: r.text,
        absoluteCoords: {
          x: Math.round(creatureScreenX),
          y: Math.round(creatureScreenY),
        },
        gameCoords,
        distance,
      };
    })
    .filter(Boolean)
    .filter(
      (e) =>
        e.gameCoords.x !== playerMinimapPosition.x ||
        e.gameCoords.y !== playerMinimapPosition.y ||
        e.gameCoords.z !== playerMinimapPosition.z,
    );

  entities.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.name.localeCompare(b.name);
  });

  return entities;
}

// --- main operation ---
async function performOperation() {
  try {
    // Check for essential state, but no longer gate by `isInitialized` as message handler does.
    if (
      !currentState?.regionCoordinates?.regions ||
      !currentState?.ocr?.regions
    )
      return;

    const { regions } = currentState.regionCoordinates;
    const { gameWorld, tileSize } = regions;
    if (!gameWorld || !tileSize) return;

    // Player position remains important for game world coordinate translation
    const currentPlayerMinimapPosition = {
      x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
      y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
      z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
    };
    lastPlayerMinimapPosition = currentPlayerMinimapPosition; // Update last known player position for future checks

    // No dynamic offset tracking. visualOffsetPx is always 0,0.
    const visualOffsetPx = { dx: 0, dy: 0 };

    const ocrData = currentState.ocr.regions.gameWorld || [];

    // Creature coordinates are processed using the current `ocrData` (fresh detections)
    // and a fixed {0,0} visualOffsetPx.
    const detectedEntities = processGameWorldEntities(
      ocrData,
      currentPlayerMinimapPosition,
      regions,
      tileSize,
      visualOffsetPx, // Pass {0,0} as visual offset
    );

    if (!deepCompareEntities(detectedEntities, lastSentCreatures)) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'targeting/setEntities',
        payload: detectedEntities,
      });
      lastSentCreatures = detectedEntities;
    }
  } catch (error) {
    // Basic error logging remains to catch unexpected issues
    console.error('[CreatureMonitor] Error in operation:', error);
  }
}

// --- message handler ---
parentPort.on('message', (message) => {
  if (isShuttingDown) {
    return; // Stop processing messages if shutting down
  }

  try {
    // No 'frame-update' message type handling
    if (message.type === 'shutdown') {
      isShuttingDown = true;
      return;
    } else if (message.type === 'state_diff') {
      if (!currentState) currentState = {}; // Initialize if null
      Object.assign(currentState, message.payload); // Apply diff
      if (!isInitialized) {
        // First state message received
        isInitialized = true;
        // Optionally log initialization if needed, but no logger import now
      }
      // CRITICAL: Call performOperation only when state_diff arrives
      performOperation();
      return;
    } else if (typeof message === 'object' && !message.type) {
      // Full state replace (initial state message without a 'type')
      currentState = message;
      lastSentCreatures = []; // Reset tracked creatures on full state replace
      lastPlayerMinimapPosition = null; // Reset player position
      if (!isInitialized) {
        isInitialized = true;
      }
      // CRITICAL: Call performOperation only after initial state is set
      performOperation();
      return;
    }
  } catch (e) {
    console.error('[CreatureMonitor] Error handling message:', e);
  }
});

// Removed: mainLoop and its `catch` block as the worker is now message-driven.
// The worker will stay alive as long as messages can be received and processed,
// and will exit when the parent thread explicitly sends a 'shutdown' message
// or when the parent thread itself exits.
