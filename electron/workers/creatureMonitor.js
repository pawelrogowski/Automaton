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
import { SABStateManager } from './sabStateManager.js';
import {
  PLAYER_X_INDEX,
  PLAYER_Y_INDEX,
  PLAYER_Z_INDEX,
  PATHFINDING_STATUS_INDEX,
  PATH_STATUS_BLOCKED_BY_CREATURE,
  PATH_BLOCKING_CREATURE_X_INDEX,
  PATH_BLOCKING_CREATURE_Y_INDEX,
  PATH_BLOCKING_CREATURE_Z_INDEX,
} from './sharedConstants.js';
const logger = createLogger({ info: false, error: true, debug: false });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { recognizeText } = pkg;
const CHAR_PRESETS = {
  ALPHA: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  };

let pathfinderInstance = null;
const { sharedData, paths } = workerData;
if (!sharedData) throw new Error('[CreatureMonitor] Shared data not provided.');
const { imageSAB, playerPosSAB, pathDataSAB } = sharedData;
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const pathDataArray = pathDataSAB ? new Int32Array(pathDataSAB) : null;
const sharedBufferView = Buffer.from(imageSAB);

// Initialize SAB state manager
const sabStateManager = new SABStateManager({
  playerPosSAB: workerData.playerPosSAB,
  battleListSAB: workerData.battleListSAB,
  creaturesSAB: workerData.creaturesSAB,
  lootingSAB: workerData.lootingSAB,
  targetingListSAB: workerData.targetingListSAB,
  targetSAB: workerData.targetSAB,
});

// Moved to constants as they are used globally in this worker
// const PLAYER_X_INDEX = 0;
// const PLAYER_Y_INDEX = 1;
// const PLAYER_Z_INDEX = 2;

const PLAYER_ANIMATION_FREEZE_MS = 120;
const STICKY_SNAP_THRESHOLD_TILES = 0.5;
const JITTER_CONFIRMATION_TIME_MS = 75;
const CORRELATION_DISTANCE_THRESHOLD_PIXELS = 125;
const TARGET_LOSS_GRACE_PERIOD_MS = 100;
const CREATURE_FLICKER_GRACE_PERIOD_MS = 175;
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

let previousTargetedCreatureCounts = new Map();

// Simple immediate looting
let previousTargetName = null; // Track previous target name for stable detection
let isLootingInProgress = false; // Lock to prevent multiple simultaneous looting

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
// accounting for truncated names with ellipsis.
function isCreaturePresent(targetingCreatureName, battleListEntries) {
  for (const battleListEntry of battleListEntries) {
    const battleListName = battleListEntry.name;

    // Exact match
    if (targetingCreatureName === battleListName) {
      return true;
    }

    // Handle truncated names: if battle list name ends with "..." check if targeting name starts with the truncated part
    if (battleListName.endsWith('...')) {
      const truncatedPart = battleListName.slice(0, -3);
      if (targetingCreatureName.startsWith(truncatedPart)) {
        return true;
      }
    }
  }
  return false;
}

function postLootingRequired(isLootingRequired) {
  sabStateManager.setLootingRequired(isLootingRequired);
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
        CHAR_PRESETS.ALPHA,
      ) || [];
    const entries = ocrResults
      .map((result) => {
        const trimmedName = result.text.trim();
        // Fix camelCase names like "FrostGiantess" into "Frost Giantess"
        const fixedName = trimmedName.replace(/([a-z])([A-Z])/g, '$1 $2');
        return { name: fixedName, x: result.x, y: result.y };
      })
      .filter((creature) => creature.name.length > 0);

    sabStateManager.writeBattleList(entries);
    return entries;
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
        a[i].hp !== b[i].hp ||
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
      a.hp === b.hp &&
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

  // Persist name if OCR fails temporarily
  if (detection.name) {
    creature.name = detection.name;
  }

  if (detection.hp) {
    creature.hp = detection.hp;
  }

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

    if (sabStateManager.isLootingRequired()) {
      return; // Do not perform any targeting or creature detection if looting is required
    }

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

    // Create a constrained gameWorld region excluding top and bottom 14 pixels
    const constrainedGameWorld = {
      ...gameWorld,
      y: gameWorld.y + 14,
      height: Math.max(0, gameWorld.height - 28), // Ensure height doesn't go negative
    };

    const healthBars = await findHealthBars.findHealthBars(
      sharedBufferView,
      constrainedGameWorld,
    );

    let detections = [];
    if (healthBars.length > 0) {
      const minX = Math.min(...healthBars.map((hb) => hb.x)) - 120;
      const maxX = Math.max(...healthBars.map((hb) => hb.x)) + 120;
      const minY = Math.min(...healthBars.map((hb) => hb.y)) - 28;
      const maxY = Math.max(...healthBars.map((hb) => hb.y));

      const ocrRegion = {
        x: Math.max(0, minX),
        y: Math.max(0, minY),
        width: maxX - minX,
        height: maxY - minY,
      };

      const nameplateOcrResults =
        recognizeText(
          sharedBufferView,
          ocrRegion,
          regionDefinitions.gameWorld?.ocrColors || [], // Assuming same colors for now
          CHAR_PRESETS.ALPHA,
        ) || [];

      detections = healthBars.map((hb) => {
        let closestName = null;
        let minDistance = Infinity;

        for (const result of nameplateOcrResults) {
          // Prioritize names that are close and above the health bar
          const distance = Math.sqrt(
            Math.pow(result.x - hb.x, 2) + Math.pow(result.y - (hb.y - 14), 2),
          );

          if (distance < minDistance && distance < 120) {
            minDistance = distance;
            closestName = result.text.trim().replace(/([a-z])([A-Z])/g, '$1 $2');
          }
        }

        return {
          absoluteCoords: { x: hb.x, y: hb.y },
          healthBarY: hb.y,
          name: closestName,
          hp: hb.healthTag,
        };
      });
    }

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
        if (updated) {
          // Clear flicker grace period since creature was found
          if (updated.flickerGracePeriodEndTime) {
            logger(
              'debug',
              `[CreatureMonitor] Creature ${updated.instanceId} reappeared, clearing flicker grace period`,
            );
            delete updated.flickerGracePeriodEndTime;
          }
          newActiveCreatures.set(id, updated);
        }
        matchedDetections.add(bestMatch);
      } else {
        // Creature not found in current detections - check flicker grace period
        if (!oldCreature.flickerGracePeriodEndTime) {
          // Start grace period
          oldCreature.flickerGracePeriodEndTime =
            now + CREATURE_FLICKER_GRACE_PERIOD_MS;
          logger(
            'debug',
            `[CreatureMonitor] Creature ${oldCreature.instanceId} disappeared, starting flicker grace period (${CREATURE_FLICKER_GRACE_PERIOD_MS}ms)`,
          );
        }

        if (now < oldCreature.flickerGracePeriodEndTime) {
          // Still within grace period - keep the creature
          newActiveCreatures.set(id, oldCreature);
        } else {
          logger(
            'debug',
            `[CreatureMonitor] Creature ${oldCreature.instanceId} flicker grace period expired, removing creature`,
          );
        }
        // If grace period expired, creature is not added to newActiveCreatures (removed)
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

    let blockingCreatureCoords = null;
    if (pathDataArray && Atomics.load(pathDataArray, PATHFINDING_STATUS_INDEX) === PATH_STATUS_BLOCKED_BY_CREATURE) {
      blockingCreatureCoords = {
        x: Atomics.load(pathDataArray, PATH_BLOCKING_CREATURE_X_INDEX),
        y: Atomics.load(pathDataArray, PATH_BLOCKING_CREATURE_Y_INDEX),
        z: Atomics.load(pathDataArray, PATH_BLOCKING_CREATURE_Z_INDEX),
      };
    }

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
        
        let isBlockingPath = false;
        if (blockingCreatureCoords && entity.gameCoords) {
            isBlockingPath = entity.gameCoords.x === blockingCreatureCoords.x &&
                             entity.gameCoords.y === blockingCreatureCoords.y &&
                             entity.gameCoords.z === blockingCreatureCoords.z;
        }

        return { ...entity, isReachable, isAdjacent, isBlockingPath };
      });
    }

    if (!deepCompareEntities(detectedEntities, lastSentCreatures)) {
      sabStateManager.writeCreatures(detectedEntities);
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
            name: closestCreature.name || null, // Add name from OCR
            hp: closestCreature.hp || null,
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
      sabStateManager.writeCurrentTarget(unifiedTarget);
      parentPort.postMessage({
        storeUpdate: true,
        type: 'targeting/setTarget',
        payload: unifiedTarget,
      });

      // Only log when target name actually changes (reduce spam)
      const newTargetName = unifiedTarget?.name || null;
      const oldTargetName = lastSentTarget?.name || null;
      if (newTargetName !== oldTargetName) {
        logger(
          'debug',
          `[CreatureMonitor] Target switched: ${oldTargetName || 'none'} → ${newTargetName || 'none'}`,
        );
      }

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

    if (battleListEntriesForStore.length > 0) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'battleList/updateLastSeenMs',
      });
    }

    // --- SEPARATE TARGET DEATH DETECTION (bypasses flicker detection) ---
    const currentTarget = sabStateManager.getCurrentTarget();

    // Check if our target disappeared (for immediate looting)
    if (previousTargetName) {
      let targetStillPresent = false;

      // Check if previous target name is still in battle list
      for (const battleListEntry of battleListEntriesForStore) {
        const battleListName = battleListEntry.name;

        // Exact match
        if (previousTargetName === battleListName) {
          targetStillPresent = true;
          break;
        }

        // Handle truncated names
        if (battleListName.endsWith('...')) {
          const truncatedPart = battleListName.slice(0, -3);
          if (previousTargetName.startsWith(truncatedPart)) {
            targetStillPresent = true;
            break;
          }
        }
      }

      // If target was present but is now gone, trigger immediate looting
      if (!targetStillPresent && !isLootingInProgress) {
        logger(
          'info',
          `[CreatureMonitor] Target '${previousTargetName}' disappeared from battle list - triggering immediate looting (bypassing flicker detection)`,
        );
        await performImmediateLooting();
      }
    }

    // Update previous target name for next cycle
    previousTargetName = currentTarget?.name || null;

    // --- IMPROVED: Looting Detection and Action with Count-Based Tracking ---
    const targetingList = sabStateManager.getTargetingList();

    const currentTargetedCreatureCounts = new Map();
    for (const targetingCreature of targetingList) {
      // Count how many of this creature type are present in battle list
      const count = battleListEntriesForStore.filter((entry) => {
        // Exact match
        if (targetingCreature.name === entry.name) return true;

        // Handle truncated names: if battle list entry ends with "..."
        // check if targeting name starts with the truncated part
        if (entry.name.endsWith('...')) {
          const truncatedPart = entry.name.slice(0, -3);
          return targetingCreature.name.startsWith(truncatedPart);
        }

        return false;
      }).length;

      if (count > 0) {
        currentTargetedCreatureCounts.set(targetingCreature.name, count);
      }
    }

    // Check for creatures that died (count decreased)
    const disappearedCreatures = [];
    for (const [
      creatureName,
      previousCount,
    ] of previousTargetedCreatureCounts) {
      const currentCount = currentTargetedCreatureCounts.get(creatureName) || 0;
      if (currentCount < previousCount) {
        // This many creatures of this type died
        const diedCount = previousCount - currentCount;
        logger(
          'info',
          `[CreatureMonitor] DEATH DETECTED: ${creatureName}: ${previousCount} -> ${currentCount} (${diedCount} died)`,
        );
        for (let i = 0; i < diedCount; i++) {
          disappearedCreatures.push(creatureName);
        }
      }
    }

    // Fallback looting logic: if any creature died and we haven't looted yet, loot
    // (This covers cases where target detection might miss something)
    if (
      disappearedCreatures.length > 0 &&
      !sabStateManager.isLootingRequired() &&
      !isLootingInProgress
    ) {
      logger(
        'info',
        `[CreatureMonitor] Creature(s) died: ${disappearedCreatures.join(', ')} - triggering fallback looting`,
      );

      // Perform looting immediately
      await performImmediateLooting();
    }

    // Always update previousTargetedCreatureCounts for the next cycle
    previousTargetedCreatureCounts = new Map(currentTargetedCreatureCounts);
    // --- END NEW ---
  } catch (error) {
    logger('error', '[CreatureMonitor] Error in operation:', error);
  }
}

async function performImmediateLooting() {
  if (isLootingInProgress) {
    logger('debug', '[CreatureMonitor] Looting already in progress, skipping');
    return;
  }

  try {
    isLootingInProgress = true;
    logger('info', '[CreatureMonitor] Starting immediate looting action');

    // Set looting flag in shared state
    sabStateManager.setLootingRequired(true);

    // Send looting required state update to Redux
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setLootingRequired',
      payload: true,
    });

    // Press F8 for looting
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

    // Wait 200ms
    await delay(200);

    // Clear looting flag
    sabStateManager.setLootingRequired(false);

    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setLootingRequired',
      payload: false,
    });

    logger('info', '[CreatureMonitor] Immediate looting action completed');
  } catch (error) {
    logger('error', '[CreatureMonitor] Error during immediate looting:', error);

    // Ensure flag is cleared on error
    sabStateManager.setLootingRequired(false);
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setLootingRequired',
      payload: false,
    });
  } finally {
    isLootingInProgress = false;
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

parentPort.on('message', async (message) => {
  if (isShuttingDown) return;
  try {
    if (message.type === 'shutdown') {
      isShuttingDown = true;
      if (pathfinderInstance) {
        pathfinderInstance.destroy();
      }
      return;
    } else if (message.type === 'sab_sync_targeting_list') {
      sabStateManager.writeTargetingList(message.payload);
      return;
    } else if (message.type === 'manual_loot_trigger') {
      logger('info', '[CreatureMonitor] Manual looting trigger received');
      await performImmediateLooting();
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
