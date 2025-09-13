import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { createLogger } from '../utils/logger.js'; // Corrected import path
import findTarget from 'find-target-native';
import findHealthBars from 'find-healthbars-native';
import findSequences from 'find-sequences-native';
import Pathfinder from 'pathfinder-native';
import pkg from 'font-ocr';
import regionDefinitions from '../constants/regionDefinitions.js';
import { calculateDistance } from '../utils/distance.js';
import { getGameCoordinatesFromScreen } from '../utils/gameWorldClickTranslator.js';
import {
  PLAYER_X_INDEX, // Corrected import path
  PLAYER_Y_INDEX, // Corrected import path
  PLAYER_Z_INDEX, // Corrected import path
} from './sharedConstants.js';
const logger = createLogger({ info: true, error: true, debug: false });
const { recognizeText } = pkg;
const CHAR_PRESETS = {
  ALPHA: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  BATTLE_LIST_NAMES:
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ., -0123456789()', // Added for battle list OCR
  CREATURE_NAMES:
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ., -0123456789()', // Added for creature name OCR
};

let pathfinderInstance = null;
const { sharedData, paths } = workerData;
if (!sharedData) throw new Error('[CreatureMonitor] Shared data not provided.');
const { imageSAB, playerPosSAB } = sharedData;
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const sharedBufferView = Buffer.from(imageSAB);

// Moved to constants as they are used globally in this worker
// const PLAYER_X_INDEX = 0;
// const PLAYER_Y_INDEX = 1;
// const PLAYER_Z_INDEX = 2;

const PLAYER_ANIMATION_FREEZE_MS = 120;
const STICKY_SNAP_THRESHOLD_TILES = 0.5;
const JITTER_CONFIRMATION_TIME_MS = 75;
const CORRELATION_DISTANCE_THRESHOLD_PIXELS = 125;
const TARGET_LOSS_GRACE_PERIOD_MS = 100;
const ADJACENT_DISTANCE_THRESHOLD = 1.6;

let currentState = null;
let isInitialized = false;
let isShuttingDown = false;
let lastSentCreatures = [];
let lastSentTarget = null;
let lastSpecialAreasJson = null;
let nextInstanceId = 1;
let activeCreatures = new Map();
let reachableTilesCache = new Map();
const lastPostedResults = new Map();

let previousTargetedCreatureNamesInBattleList = new Set();
let lootingPauseTimerId = null;
const LOOTING_PAUSE_DURATION_MS = 100;

let previousPlayerMinimapPosition = { x: 0, y: 0, z: 0 };
let playerAnimationFreezeEndTime = 0;
let lastStablePlayerMinimapPosition = { x: 0, y: 0, z: 0 };
let targetLossGracePeriodEndTime = 0;

// Implemented directly as positionUtils does not exist
function arePositionsEqual(pos1, pos2) {
  if (!pos1 || !pos2) return pos1 === pos2;
  return pos1.x === pos2.x && pos1.y === pos2.y && pos1.z === pos2.z;
}

// Helper function to check if a targeted creature is present in the battle list,
// accounting for truncated names.
function isCreaturePresent(targetingCreatureName, battleListEntries) {
  for (const battleListEntry of battleListEntries) {
    const battleListName = battleListEntry.name;

    // Exact match
    if (targetingCreatureName === battleListName) {
      return true;
    }

    // Truncated match: battleListName ends with "..." and targetingCreatureName starts with the non-"..." part
    if (
      battleListName.endsWith('...') &&
      targetingCreatureName.startsWith(battleListName.slice(0, -3))
    ) {
      return true;
    }
  }
  return false;
}

function postLootingRequired(isLootingRequired) {
  parentPort.postMessage({
    storeUpdate: true,
    type: 'cavebot/setLootingRequired',
    payload: isLootingRequired,
  });
}

function postUpdateOnce(type, payload) {
  const key = type;
  const prev = lastPostedResults.get(key);
  const payloadString = JSON.stringify(payload);
  if (prev === payloadString) return;
  lastPostedResults.set(key, payloadString);
  parentPort.postMessage({ storeUpdate: true, type, payload });
}

async function processBattleListOcr(buffer, regions) {
  const entriesRegion = regions.battleList?.children?.entries;
  if (!entriesRegion) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'battleList/setBattleListEntries',
      payload: [],
    });
    return [];
  }
  try {
    const ocrResults =
      recognizeText(
        buffer,
        entriesRegion,
        regionDefinitions.battleList?.ocrColors || [],
        CHAR_PRESETS.BATTLE_LIST_NAMES,
      ) || [];
    return ocrResults
      .map((result) => ({ name: result.text.trim(), x: result.x, y: result.y }))
      .filter((creature) => creature.name.length > 0);
  } catch (ocrError) {
    logger(
      'error',
      '[CreatureMonitor] OCR failed for battleList region:',
      ocrError,
    );
    parentPort.postMessage({
      storeUpdate: true,
      type: 'battleList/setBattleListEntries',
      payload: [],
    });
    return [];
  }
}

function getCoordsKey(coords) {
  if (!coords) return '';
  return `${coords.x},${coords.y},${coords.z}`;
}

function deepCompareEntities(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (
        a[i].instanceId !== b[i].instanceId ||
        a[i].isReachable !== b[i].isReachable ||
        a[i].isAdjacent !== b[i].isAdjacent ||
        !arePositionsEqual(a[i].gameCoords, b[i].gameCoords)
      )
        return false;
    }
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    return (
      a.instanceId === b.instanceId &&
      a.name === b.name &&
      arePositionsEqual(a.gameCoordinates, b.gameCoordinates)
    );
  }
  return false;
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
  const creatureScreenX = detection.absoluteCoords.x;

  const creatureScreenY = detection.healthBarY + 14 + tileSize.height / 2;

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

  creature.rawDistance = calculateDistance(
    currentPlayerMinimapPosition,
    rawGameCoordsFloat,
  );

  let finalGameCoords;
  if (isPlayerInAnimationFreeze && creature.gameCoords) {
    finalGameCoords = creature.gameCoords;
  } else {
    let intermediateX = Math.floor(rawGameCoordsFloat.x);
    let intermediateY = Math.floor(rawGameCoordsFloat.y);
    if (creature.gameCoords) {
      const distX = Math.abs(rawGameCoordsFloat.x - creature.gameCoords.x);
      const distY = Math.abs(rawGameCoordsFloat.y - creature.gameCoords.y);
      if (
        distX < STICKY_SNAP_THRESHOLD_TILES &&
        distY < STICKY_SNAP_THRESHOLD_TILES
      ) {
        intermediateX = creature.gameCoords.x;
        intermediateY = creature.gameCoords.y;
      }
    }
    const newCoords = {
      x: intermediateX,
      y: intermediateY,
      z: currentPlayerMinimapPosition.z,
    };
    if (!creature.stableCoords) creature.stableCoords = newCoords;
    const hasChanged = !arePositionsEqual(newCoords, creature.stableCoords);
    if (creature.unconfirmedChange) {
      if (arePositionsEqual(newCoords, creature.unconfirmedChange.newCoords)) {
        if (
          now - creature.unconfirmedChange.timestamp >
          JITTER_CONFIRMATION_TIME_MS
        ) {
          creature.stableCoords = creature.unconfirmedChange.newCoords;
          creature.unconfirmedChange = null;
        }
      } else {
        creature.unconfirmedChange = { newCoords: newCoords, timestamp: now };
      }
    } else if (hasChanged) {
      creature.unconfirmedChange = { newCoords: newCoords, timestamp: now };
    }
    finalGameCoords = creature.stableCoords;
  }

  creature.absoluteCoords = {
    x: Math.round(creatureScreenX),
    y: Math.round(creatureScreenY),
    lastUpdate: now,
  };
  creature.gameCoords = {
    x: finalGameCoords.x,
    y: finalGameCoords.y,
    z: finalGameCoords.z,
  };
  creature.distance = calculateDistance(
    currentPlayerMinimapPosition,
    creature.gameCoords,
  );
  creature.lastSeen = now;
  return creature;
}

async function performOperation() {
  try {
    if (
      !isInitialized ||
      !currentState?.regionCoordinates?.regions ||
      !pathfinderInstance?.isLoaded
    )
      return;
    const { regions } = currentState.regionCoordinates;
    const { gameWorld, tileSize } = regions;
    if (!gameWorld || !tileSize) return;

    // --- NEW: Respect looting pause from Redux state ---
    if (currentState.cavebot?.isLootingRequired) {
      return; // Do not perform any targeting or creature detection if looting is required
    }
    // --- END NEW ---

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
      lastStablePlayerMinimapPosition = { ...currentPlayerMinimapPosition };
      reachableTilesCache.clear();
    }
    previousPlayerMinimapPosition = { ...currentPlayerMinimapPosition };
    const isPlayerInAnimationFreeze = now < playerAnimationFreezeEndTime;

    const healthBars = await findHealthBars.findHealthBars(
      sharedBufferView,
      gameWorld,
    );
    const detections = healthBars.map((hb) => ({
      absoluteCoords: { x: hb.x, y: hb.y },
      healthBarY: hb.y,
    }));

    const newActiveCreatures = new Map();
    const matchedDetections = new Set();
    for (const [id, oldCreature] of activeCreatures.entries()) {
      let bestMatch = null;
      let minDistance = CORRELATION_DISTANCE_THRESHOLD_PIXELS;
      for (const detection of detections) {
        if (matchedDetections.has(detection)) continue;
        const distance = screenDist(
          detection.absoluteCoords,
          oldCreature.absoluteCoords,
        );
        if (distance < minDistance) {
          minDistance = distance;
          bestMatch = detection;
        }
      }
      if (bestMatch) {
        const updated = updateCreatureState(
          oldCreature,
          bestMatch,
          currentPlayerMinimapPosition,
          regions,
          tileSize,
          now,
          isPlayerInAnimationFreeze,
        );
        if (updated) newActiveCreatures.set(id, updated);
        matchedDetections.add(bestMatch);
      }
    }
    for (const detection of detections) {
      if (!matchedDetections.has(detection)) {
        const newId = nextInstanceId++;
        let newCreature = { instanceId: newId };
        newCreature = updateCreatureState(
          newCreature,
          detection,
          currentPlayerMinimapPosition,
          regions,
          tileSize,
          now,
          isPlayerInAnimationFreeze,
        );
        if (newCreature) newActiveCreatures.set(newId, newCreature);
      }
    }
    activeCreatures = newActiveCreatures;

    let detectedEntities = Array.from(activeCreatures.values());
    if (detectedEntities.length > 0) {
      detectedEntities = detectedEntities.map((entity) => {
        const coordsKey = getCoordsKey(entity.gameCoords);
        let isReachable = reachableTilesCache.get(coordsKey);
        if (typeof isReachable === 'undefined') {
          const pathLength = pathfinderInstance.getPathLength(
            currentPlayerMinimapPosition,
            entity.gameCoords,
            [],
          );
          isReachable = pathLength !== -1 && pathLength <= 14;
          reachableTilesCache.set(coordsKey, isReachable);
        }
        const isAdjacent = entity.rawDistance < ADJACENT_DISTANCE_THRESHOLD;
        return { ...entity, isReachable, isAdjacent };
      });
    }

    if (!deepCompareEntities(detectedEntities, lastSentCreatures)) {
      postUpdateOnce('targeting/setEntities', detectedEntities);
      lastSentCreatures = detectedEntities;
    }

    let gameWorldTarget = null;
    const targetRect = await findTarget.findTarget(sharedBufferView, gameWorld);
    if (targetRect) {
      targetLossGracePeriodEndTime = 0;
      const playerPosForTargetCalc = isPlayerInAnimationFreeze
        ? lastStablePlayerMinimapPosition
        : currentPlayerMinimapPosition;
      const screenX = targetRect.x + targetRect.width / 2;
      const screenY = targetRect.y + targetRect.height / 2;
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
          gameWorldTarget = {
            instanceId: closestCreature.instanceId,
            distance: parseFloat(closestCreature.distance.toFixed(1)),
            gameCoordinates: closestCreature.gameCoords,
            isReachable: closestCreature.isReachable,
          };
        }
      }
    } else {
      if (lastSentTarget) {
        if (targetLossGracePeriodEndTime === 0) {
          targetLossGracePeriodEndTime = now + TARGET_LOSS_GRACE_PERIOD_MS;
        }
        if (now < targetLossGracePeriodEndTime) {
          gameWorldTarget = lastSentTarget;
        }
      }
    }

    let unifiedTarget = null;
    const battleListRegion = currentState.regionCoordinates.regions.battleList;
    if (gameWorldTarget && battleListRegion) {
      const battleListEntries = await processBattleListOcr(
        sharedBufferView,
        currentState.regionCoordinates.regions,
      );
      const redColor = [255, 0, 0];
      const redBarSequence = new Array(5).fill(redColor);
      const result = await findSequences.findSequencesNative(
        sharedBufferView,
        {
          red_vertical_bar: { sequence: redBarSequence, direction: 'vertical' },
        },
        battleListRegion,
      );
      if (result && result.red_vertical_bar) {
        const markerY = result.red_vertical_bar.y;
        let closestEntry = null;
        let minDistance = Infinity;
        for (const entry of battleListEntries) {
          const distance = Math.abs(entry.y - markerY);
          if (distance < minDistance) {
            minDistance = distance;
            closestEntry = entry;
          }
        }
        if (closestEntry) {
          unifiedTarget = { ...gameWorldTarget, name: closestEntry.name };
        }
      }
    }

    if (!deepCompareEntities(unifiedTarget, lastSentTarget)) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'targeting/setTarget',
        payload: unifiedTarget,
      });
      lastSentTarget = unifiedTarget;
    }

    const battleListEntriesForStore = await processBattleListOcr(
      sharedBufferView,
      currentState.regionCoordinates.regions,
    );
    postUpdateOnce(
      'battleList/setBattleListEntries',
      battleListEntriesForStore,
    );

    // --- NEW: Looting Detection and Action ---
    const targetingList = currentState.targeting?.targetingList || [];

    const currentTargetedCreatureNamesInBattleList = new Set();
    for (const targetingCreature of targetingList) {
      if (
        isCreaturePresent(targetingCreature.name, battleListEntriesForStore)
      ) {
        currentTargetedCreatureNamesInBattleList.add(targetingCreature.name);
      }
    }

    const disappearedCreatures = [
      ...previousTargetedCreatureNamesInBattleList,
    ].filter(
      (creatureName) =>
        !currentTargetedCreatureNamesInBattleList.has(creatureName),
    );

    if (disappearedCreatures.length > 0) {
      logger(
        'info',
        `[CreatureMonitor] Targeted creatures disappeared from battle list: ${Array.from(disappearedCreatures).join(', ')}. Triggering looting pause.`,
      );

      // Send keypress for looting
      parentPort.postMessage({
        type: 'inputAction',
        payload: {
          type: 'looting',
          action: {
            module: 'keypress',
            method: 'sendKey',
            args: ['f8'],
          },
        },
      });

      // Start the looting pause via Redux state
      if (lootingPauseTimerId) clearTimeout(lootingPauseTimerId);
      const timerId = setTimeout(() => {
        postLootingRequired(false); // End looting pause
        lootingPauseTimerId = null;
      }, LOOTING_PAUSE_DURATION_MS);
      lootingPauseTimerId = timerId;
      postLootingRequired(true); // Start looting pause
    }
    // Always update previousTargetedCreatureNamesInBattleList for the next cycle
    previousTargetedCreatureNamesInBattleList =
      currentTargetedCreatureNamesInBattleList;
    // --- END NEW ---
  } catch (error) {
    logger('error', '[CreatureMonitor] Error in operation:', error);
  }
}

async function initialize() {
  logger('info', '[CreatureMonitor] Initializing Pathfinder instance...');
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
        if (e.code !== 'ENOENT')
          logger(
            'error',
            `[CreatureMonitor] Could not load path data for Z=${zLevel}: ${e.message}`,
          );
      }
    }
    pathfinderInstance.loadMapData(mapDataForAddon);
    if (pathfinderInstance.isLoaded)
      logger(
        'info',
        '[CreatureMonitor] Pathfinder instance loaded map data successfully.',
      );
    else throw new Error('Pathfinder failed to load map data.');
  } catch (err) {
    logger(
      'error',
      '[CreatureMonitor] FATAL: Could not initialize Pathfinder instance:',
      err,
    );
    pathfinderInstance = null;
  }
}

parentPort.on('message', (message) => {
  if (isShuttingDown) return;
  try {
    if (message.type === 'shutdown') {
      isShuttingDown = true;
      if (pathfinderInstance) {
        pathfinderInstance.destroy();
      }
      return;
    } else if (message.type === 'state_full_sync') {
      currentState = message.payload;
    } else if (message.type === 'state_diff') {
      // Apply diff to current state
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
        .catch((err) =>
          logger('error', '[CreatureMonitor] Initialization failed:', err),
        );
    }
    performOperation();
  } catch (e) {
    logger('error', '[CreatureMonitor] Error handling message:', e);
  }
});
