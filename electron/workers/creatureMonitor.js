import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { createLogger } from '../utils/logger.js';
import findTarget from 'find-target-native';
import findHealthBars from 'find-healthbars-native';
import findSequences from 'find-sequences-native';
import Pathfinder from 'pathfinder-native';
import pkg from 'font-ocr';
import regionDefinitions from '../constants/regionDefinitions.js';
import { calculateDistance, chebyshevDistance } from '../utils/distance.js';
import { getGameCoordinatesFromScreen } from '../utils/gameWorldClickTranslator.js';
import { FrameUpdateManager } from '../utils/frameUpdateManager.js';
import { SABStateManager } from './sabStateManager.js';
import { findBestNameMatch } from '../utils/nameMatcher.js';
import { processPlayerList, processNpcList } from './creatureMonitor/ocr.js';
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
const BATTLELIST_ALLOWED_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

const frameUpdateManager = new FrameUpdateManager();
let pathfinderInstance = null;
const { sharedData, paths } = workerData;
if (!sharedData) throw new Error('[CreatureMonitor] Shared data not provided.');

const {
  imageSAB,
  playerPosSAB,
  pathDataSAB,
  battleListSAB,
  creaturesSAB,
  lootingSAB,
  targetingListSAB,
  targetSAB,
} = sharedData;

const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const pathDataArray = pathDataSAB ? new Int32Array(pathDataSAB) : null;
const sharedBufferView = Buffer.from(imageSAB);

const sabStateManager = new SABStateManager({
  playerPosSAB,
  battleListSAB,
  creaturesSAB,
  lootingSAB,
  targetingListSAB,
  targetSAB,
});

const PLAYER_ANIMATION_FREEZE_MS = 120;
const STICKY_SNAP_THRESHOLD_TILES = 0.5;
const JITTER_CONFIRMATION_TIME_MS = 100;
const CORRELATION_DISTANCE_THRESHOLD_PIXELS = 81;
const TARGET_LOSS_GRACE_PERIOD_MS = 100;
const CREATURE_FLICKER_GRACE_PERIOD_MS = 200;
const ADJACENT_DISTANCE_THRESHOLD_DIAGONAL = 1.45;
const ADJACENT_DISTANCE_THRESHOLD_STRAIGHT = 1.0;
const ADJACENT_TIME_THRESHOLD_MS = 0;

let currentState = null;
let isInitialized = false;
let isShuttingDown = false;
let lastSentCreatures = [];
let lastSentTarget = null;
let lastBattleListEntries = [];
let lastPlayerNames = [];
let lastNpcNames = [];
let nextInstanceId = 1;
let activeCreatures = new Map();
const lastPostedResults = new Map();
let previousTargetedCreatureCounts = new Map();
let previousTargetName = null;
let isLootingInProgress = false;
let previousPlayerMinimapPosition = { x: 0, y: 0, z: 0 };
let playerAnimationFreezeEndTime = 0;
let lastStablePlayerMinimapPosition = { x: 0, y: 0, z: 0 };
let targetLossGracePeriodEndTime = 0;

function arePositionsEqual(pos1, pos2) {
  if (!pos1 || !pos2) return pos1 === pos2;
  return pos1.x === pos2.x && pos1.y === pos2.y && pos1.z === pos2.z;
}

function rectsIntersect(rectA, rectB) {
  if (
    !rectA ||
    !rectB ||
    rectA.width <= 0 ||
    rectA.height <= 0 ||
    rectB.width <= 0 ||
    rectB.height <= 0
  ) {
    return false;
  }
  return (
    rectA.x < rectB.x + rectB.width &&
    rectA.x + rectA.width > rectB.x &&
    rectA.y < rectB.y + rectB.height &&
    rectA.y + rectA.height > rectB.y
  );
}

function postUpdateOnce(type, payload) {
  const key = type;
  const prevPayloadString = lastPostedResults.get(key);
  const payloadString = JSON.stringify(payload);
  if (prevPayloadString === payloadString) return;
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
        BATTLELIST_ALLOWED_CHARS,
      ) || [];
    return ocrResults
      .map((result) => {
        const trimmedName = result.text.trim();
        const fixedName = trimmedName.replace(/([a-z])([A-Z])/g, '$1 $2');
        return { name: fixedName, x: result.x, y: result.y };
      })
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
        a[i].hp !== b[i].hp ||
        a[i].distance !== b[i].distance ||
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
  creature.distance = chebyshevDistance(
    currentPlayerMinimapPosition,
    creature.gameCoords,
  );
  creature.lastSeen = now;
  if (detection.name) creature.name = detection.name;
  if (detection.hp) creature.hp = detection.hp;

  return creature;
}

async function performOperation() {
  try {
    const startTime = performance.now();

    if (
      !isInitialized ||
      !currentState?.regionCoordinates?.regions ||
      !pathfinderInstance?.isLoaded
    )
      return;
    const { regions } = currentState.regionCoordinates;
    const { gameWorld, tileSize } = regions;
    if (!gameWorld || !tileSize) return;

    let battleListEntries = lastBattleListEntries;
    let playerNames = lastPlayerNames;
    let npcNames = lastNpcNames;

    const dirtyRects = [...frameUpdateManager.accumulatedDirtyRects];
    frameUpdateManager.accumulatedDirtyRects.length = 0;

    if (dirtyRects.length > 0) {
      if (
        regions.battleList &&
        dirtyRects.some((r) => rectsIntersect(r, regions.battleList))
      ) {
        battleListEntries = await processBattleListOcr(
          sharedBufferView,
          regions,
        );
      }
      if (
        regions.playerList &&
        dirtyRects.some((r) => rectsIntersect(r, regions.playerList))
      ) {
        playerNames = await processPlayerList(sharedBufferView, regions);
      }
      if (
        regions.npcList &&
        dirtyRects.some((r) => rectsIntersect(r, regions.npcList))
      ) {
        npcNames = await processNpcList(sharedBufferView, regions);
      }
    }

    lastBattleListEntries = battleListEntries;
    lastPlayerNames = playerNames;
    lastNpcNames = npcNames;

    const targetingList = sabStateManager.getTargetingList();
    let lootReason = '';
    const currentTargetedCreatureCounts = new Map();
    for (const targetingCreature of targetingList) {
      const count = battleListEntries.filter((entry) => {
        if (targetingCreature.name === entry.name) return true;
        if (entry.name.endsWith('...')) {
          const truncatedPart = entry.name.slice(0, -3);
          return targetingCreature.name.startsWith(truncatedPart);
        }
        return false;
      }).length;
      if (count > 0)
        currentTargetedCreatureCounts.set(targetingCreature.name, count);
    }

    const disappearedCreatures = new Set();
    for (const [
      creatureName,
      previousCount,
    ] of previousTargetedCreatureCounts) {
      const currentCount = currentTargetedCreatureCounts.get(creatureName) || 0;
      if (currentCount < previousCount) disappearedCreatures.add(creatureName);
    }
    if (disappearedCreatures.size > 0)
      lootReason = `Count decreased for: ${[...disappearedCreatures].join(', ')}`;

    if (previousTargetName) {
      const targetStillPresent = battleListEntries.some((entry) => {
        if (previousTargetName === entry.name) return true;
        if (entry.name.endsWith('...')) {
          const truncatedPart = entry.name.slice(0, -3);
          return previousTargetName.startsWith(truncatedPart);
        }
        return false;
      });
      if (!targetStillPresent && !lootReason)
        lootReason = `Target '${previousTargetName}' disappeared from battle list`;
    }

    if (lootReason && !isLootingInProgress) {
      logger('info', `[CreatureMonitor] ${lootReason} - triggering looting.`);
      await performImmediateLooting();
    }

    if (sabStateManager.isLootingRequired()) return;

    if (
      battleListEntries.length === 0 &&
      playerNames.length === 0 &&
      npcNames.length === 0
    ) {
      if (lastSentCreatures.length > 0 || lastSentTarget !== null) {
        activeCreatures.clear();
        lastSentCreatures = [];
        lastSentTarget = null;
        sabStateManager.writeWorldState({
          creatures: [],
          target: null,
          battleList: [],
        });
        postUpdateOnce('targeting/setEntities', { creatures: [], duration: 0 });
        postUpdateOnce('targeting/setTarget', null);
      }
      postUpdateOnce('battleList/setBattleListEntries', battleListEntries);
      postUpdateOnce('uiValues/setPlayers', playerNames);
      postUpdateOnce('uiValues/setNpcs', npcNames);
      previousTargetName = null;
      previousTargetedCreatureCounts = new Map();
      return;
    }

    const currentPlayerMinimapPosition = {
      x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
      y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
      z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
    };
    const now = Date.now();

    const playerDelta = {
      x: currentPlayerMinimapPosition.x - previousPlayerMinimapPosition.x,
      y: currentPlayerMinimapPosition.y - previousPlayerMinimapPosition.y,
    };
    const scrollDeltaPixels = {
      x: -playerDelta.x * tileSize.width,
      y: -playerDelta.y * tileSize.height,
    };

    const playerPositionChanged = !arePositionsEqual(
      currentPlayerMinimapPosition,
      previousPlayerMinimapPosition,
    );
    if (playerPositionChanged) {
      playerAnimationFreezeEndTime = now + PLAYER_ANIMATION_FREEZE_MS;
      lastStablePlayerMinimapPosition = { ...currentPlayerMinimapPosition };
    }
    previousPlayerMinimapPosition = { ...currentPlayerMinimapPosition };
    const isPlayerInAnimationFreeze = now < playerAnimationFreezeEndTime;

    const constrainedGameWorld = {
      ...gameWorld,
      y: gameWorld.y + 14,
      height: Math.max(0, gameWorld.height - 28),
    };
    const healthBars = await findHealthBars.findHealthBars(
      sharedBufferView,
      constrainedGameWorld,
    );
    const newActiveCreatures = new Map();
    const matchedHealthBars = new Set();

    const canonicalNames = [...new Set(targetingList.map((rule) => rule.name))];
    const performOcrForHealthBar = async (hb) => {
      const idealOcrX = hb.x - tileSize.width / 2;
      const idealOcrY = hb.y - 16;
      const ocrWidth = tileSize.width;
      const ocrHeight = 14;
      const clampedX = Math.max(gameWorld.x, idealOcrX);
      const clampedY = Math.max(gameWorld.y, idealOcrY);
      const clampedWidth = Math.min(
        ocrWidth,
        gameWorld.x + gameWorld.width - clampedX,
      );
      const clampedHeight = Math.min(
        ocrHeight,
        gameWorld.y + gameWorld.height - clampedY,
      );
      if (clampedWidth <= 0 || clampedHeight <= 0) return null;
      const ocrRegion = {
        x: clampedX,
        y: clampedY,
        width: clampedWidth,
        height: clampedHeight,
      };
      const nameplateOcrResults =
        recognizeText(
          sharedBufferView,
          ocrRegion,
          regionDefinitions.gameWorld?.ocrColors || [],
          BATTLELIST_ALLOWED_CHARS,
        ) || [];
      const rawOcrName =
        nameplateOcrResults.length > 0
          ? nameplateOcrResults[0].text
              .trim()
              .replace(/([a-z])([A-Z])/g, '$1 $2')
          : null;
      return findBestNameMatch(rawOcrName, canonicalNames, logger);
    };

    for (const [id, oldCreature] of activeCreatures.entries()) {
      let bestMatch = null;
      let minDistance = CORRELATION_DISTANCE_THRESHOLD_PIXELS;

      for (const hb of healthBars) {
        if (matchedHealthBars.has(hb)) continue;
        const distance = screenDist(
          { x: hb.x, y: hb.y },
          oldCreature.absoluteCoords,
        );
        if (distance < minDistance) {
          minDistance = distance;
          bestMatch = hb;
        }
      }

      if (bestMatch) {
        let creatureName = oldCreature.name;
        if (!creatureName) {
          creatureName = await performOcrForHealthBar(bestMatch);
        }
        const detection = {
          absoluteCoords: { x: bestMatch.x, y: bestMatch.y },
          healthBarY: bestMatch.y,
          name: creatureName,
          hp: bestMatch.healthTag,
        };
        const updated = updateCreatureState(
          oldCreature,
          detection,
          currentPlayerMinimapPosition,
          regions,
          tileSize,
          now,
          isPlayerInAnimationFreeze,
        );
        if (updated) {
          if (updated.flickerGracePeriodEndTime)
            delete updated.flickerGracePeriodEndTime;
          newActiveCreatures.set(id, updated);
        }
        matchedHealthBars.add(bestMatch);
      } else {
        if (!oldCreature.flickerGracePeriodEndTime) {
          oldCreature.flickerGracePeriodEndTime =
            now + CREATURE_FLICKER_GRACE_PERIOD_MS;
        }
        if (now < oldCreature.flickerGracePeriodEndTime) {
          if (playerPositionChanged) {
            oldCreature.absoluteCoords.x += scrollDeltaPixels.x;
            oldCreature.absoluteCoords.y += scrollDeltaPixels.y;
          }
          newActiveCreatures.set(id, oldCreature);
        }
      }
    }

    if (healthBars.length > matchedHealthBars.size) {
      for (const hb of healthBars) {
        if (!matchedHealthBars.has(hb)) {
          const creatureName = await performOcrForHealthBar(hb);
          const detection = {
            absoluteCoords: { x: hb.x, y: hb.y },
            healthBarY: hb.y,
            name: creatureName,
            hp: hb.healthTag,
          };
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
          if (newCreature) {
            newActiveCreatures.set(newId, newCreature);
          }
        }
      }
    }

    activeCreatures = newActiveCreatures;

    let detectedEntities = Array.from(activeCreatures.values());
    let blockingCreatureCoords = null;
    if (
      pathDataArray &&
      Atomics.load(pathDataArray, PATHFINDING_STATUS_INDEX) ===
        PATH_STATUS_BLOCKED_BY_CREATURE
    ) {
      blockingCreatureCoords = {
        x: Atomics.load(pathDataArray, PATH_BLOCKING_CREATURE_X_INDEX),
        y: Atomics.load(pathDataArray, PATH_BLOCKING_CREATURE_Y_INDEX),
        z: Atomics.load(pathDataArray, PATH_BLOCKING_CREATURE_Z_INDEX),
      };
    }

    if (detectedEntities.length > 0) {
      const allCreaturePositions = detectedEntities.map((c) => c.gameCoords);
      const reachableTiles = pathfinderInstance.getReachableTiles(
        currentPlayerMinimapPosition,
        allCreaturePositions,
        14,
      );
      detectedEntities = detectedEntities.map((entity) => {
        const coordsKey = getCoordsKey(entity.gameCoords);
        const isReachable = typeof reachableTiles[coordsKey] !== 'undefined';
        let isAdjacent = false;
        if (entity.gameCoords) {
          const deltaX = Math.abs(
            currentPlayerMinimapPosition.x - entity.gameCoords.x,
          );
          const deltaY = Math.abs(
            currentPlayerMinimapPosition.y - entity.gameCoords.y,
          );
          if ((deltaX === 1 && deltaY <= 1) || (deltaY === 1 && deltaX <= 1)) {
            isAdjacent = true;
          }
        }
        let isBlockingPath =
          blockingCreatureCoords && entity.gameCoords
            ? entity.gameCoords.x === blockingCreatureCoords.x &&
              entity.gameCoords.y === blockingCreatureCoords.y &&
              entity.gameCoords.z === blockingCreatureCoords.z
            : false;
        return { ...entity, isReachable, isAdjacent, isBlockingPath };
      });
    }

    const creaturesChanged = !deepCompareEntities(
      detectedEntities,
      lastSentCreatures,
    );
    if (creaturesChanged) {
      const duration = (performance.now() - startTime).toFixed(2);
      postUpdateOnce('targeting/setEntities', {
        creatures: detectedEntities,
        duration,
      });
      lastSentCreatures = detectedEntities;
    }

    let gameWorldTarget = null;
    const allObstructed =
      detectedEntities.length > 0 &&
      detectedEntities.every((e) => e.hp === 'Obstructed');

    if (!allObstructed) {
      const targetRect = await findTarget.findTarget(
        sharedBufferView,
        gameWorld,
      );
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
              name: closestCreature.name || null,
              hp: closestCreature.hp || null,
              distance: parseFloat(closestCreature.distance.toFixed(1)),
              gameCoordinates: closestCreature.gameCoords,
              isReachable: closestCreature.isReachable,
            };
          }
        }
      } else if (lastSentTarget) {
        if (targetLossGracePeriodEndTime === 0)
          targetLossGracePeriodEndTime = now + TARGET_LOSS_GRACE_PERIOD_MS;
        if (now < targetLossGracePeriodEndTime)
          gameWorldTarget = lastSentTarget;
      }
    }

    let unifiedTarget = null;
    const battleListRegion = currentState.regionCoordinates.regions.battleList;
    if (gameWorldTarget && battleListRegion) {
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
        if (closestEntry)
          unifiedTarget = { ...gameWorldTarget, name: closestEntry.name };
      }
    }

    if (detectedEntities.length === 0 && unifiedTarget !== null) {
      unifiedTarget = null;
    }

    const targetChanged = !deepCompareEntities(unifiedTarget, lastSentTarget);
    if (targetChanged) {
      const newTargetName = unifiedTarget?.name || null;
      const oldTargetName = lastSentTarget?.name || null;
      if (newTargetName !== oldTargetName)
        logger(
          'debug',
          `[CreatureMonitor] Target switched: ${oldTargetName || 'none'} → ${newTargetName || 'none'}`,
        );
      lastSentTarget = unifiedTarget;
    }

    sabStateManager.writeWorldState({
      creatures: detectedEntities,
      target: unifiedTarget,
      battleList: battleListEntries,
    });

    postUpdateOnce('targeting/setTarget', unifiedTarget);
    postUpdateOnce('battleList/setBattleListEntries', battleListEntries);
    if (battleListEntries.length > 0)
      parentPort.postMessage({
        storeUpdate: true,
        type: 'battleList/updateLastSeenMs',
      });

    postUpdateOnce('uiValues/setPlayers', playerNames);
    if (playerNames.length > 0)
      parentPort.postMessage({
        storeUpdate: true,
        type: 'uiValues/updateLastSeenPlayerMs',
      });

    postUpdateOnce('uiValues/setNpcs', npcNames);
    if (npcNames.length > 0)
      parentPort.postMessage({
        storeUpdate: true,
        type: 'uiValues/updateLastSeenNpcMs',
      });

    const currentTarget = sabStateManager.getCurrentTarget();
    previousTargetName = currentTarget?.name || null;
    previousTargetedCreatureCounts = new Map(currentTargetedCreatureCounts);
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
    sabStateManager.setLootingRequired(true);
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setLootingRequired',
      payload: true,
    });
    parentPort.postMessage({
      type: 'inputAction',
      payload: {
        type: 'looting',
        action: { module: 'keypress', method: 'sendKey', args: ['f8'] },
      },
    });
    await delay(50);
    sabStateManager.setLootingRequired(false);
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setLootingRequired',
      payload: false,
    });
    logger('info', '[CreatureMonitor] Immediate looting action completed');
  } catch (error) {
    logger('error', '[CreatureMonitor] Error during immediate looting:', error);
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
    if (message.type === 'frame-update') {
      frameUpdateManager.addDirtyRects(message.payload.dirtyRects);
      return;
    }
    if (message.type === 'shutdown') {
      isShuttingDown = true;
      if (pathfinderInstance) pathfinderInstance.destroy();
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
