import { parentPort, workerData } from 'worker_threads';
import { createLogger } from '../utils/logger.js';
import { createWorkerInterface, WORKER_IDS } from './sabState/index.js';
import findTarget from 'find-target-native';
import findHealthBars from 'find-healthbars-native';
import findSequences from 'find-sequences-native';
import Pathfinder from 'pathfinder-native';
import pkg from 'font-ocr';
import regionDefinitions from '../constants/regionDefinitions.js';
import { calculateDistance, chebyshevDistance } from '../utils/distance.js';
import {
  getGameCoordinatesFromScreen,
} from '../utils/gameWorldClickTranslator.js';
import { FrameUpdateManager } from '../utils/frameUpdateManager.js';
// Import robust matching utilities
import { findBestNameMatch, getSimilarityScore, isBattleListMatch } from '../utils/nameMatcher.js';
import { processPlayerList, processNpcList } from './creatureMonitor/ocr.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { recognizeText } = pkg;

const BATTLELIST_ALLOWED_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ. ';
const NAMEPLATE_ALLOWED_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ';

const frameUpdateManager = new FrameUpdateManager();
let pathfinderInstance = null;
const { sharedData, paths } = workerData;
if (!sharedData) throw new Error('[CreatureMonitor] Shared data not provided.');

const {
  imageSAB,
} = sharedData;

const sharedBufferView = Buffer.from(imageSAB);

let sabInterface = null;
if (workerData.unifiedSAB) {
  sabInterface = createWorkerInterface(
    workerData.unifiedSAB,
    WORKER_IDS.CREATURE_MONITOR,
  );
} else {
  throw new Error('[CreatureMonitor] Unified SAB interface is required');
}

const PLAYER_ANIMATION_FREEZE_MS = 25;
const STICKY_SNAP_THRESHOLD_TILES = 0.5;
const JITTER_CONFIRMATION_TIME_MS = 75;
const CORRELATION_DISTANCE_THRESHOLD_PIXELS = 200;

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
let previousTargetName = null;
let isLootingInProgress = false;
let previousPlayerMinimapPosition = { x: 0, y: 0, z: 0 };
let playerAnimationFreezeEndTime = 0;
let lastStablePlayerMinimapPosition = { x: 0, y: 0, z: 0 };
let lastBattleListOcrTime = 0;
// Performance caches for detection
let lastReachableSig = null;
let lastReachableTiles = null;
// Region snapshot management
let regionsStale = false;
let lastRequestedRegionsVersion = -1;
let lastHealthScanTime = 0;

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

function getNameplateRegion(hb, gameWorld, tileSize) {
  if (!hb || !gameWorld || !tileSize) return null;
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
  return {
    x: clampedX,
    y: clampedY,
    width: clampedWidth,
    height: clampedHeight,
  };
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
        return {
          name: fixedName,
          x: result.click.x,
          y: result.click.y,
        };
      })
      .filter((creature) => creature.name.length > 0);
  } catch (ocrError) {
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
  lastStablePlayerMinimapPosition,
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

  const newAbsoluteCoords = {
    x: Math.round(creatureScreenX),
    y: Math.round(creatureScreenY),
    lastUpdate: now,
  };

  creature.absoluteCoords = newAbsoluteCoords;
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

// --- RESTORED HELPER FUNCTION ---
async function identifyAndAssignNewCreatures({
  unmatchedHealthBars,
  newActiveCreatures,
  battleListEntries,
  canonicalNames,
  performOcrForHealthBar,
  currentPlayerMinimapPosition,
  lastStablePlayerMinimapPosition,
  regions,
  tileSize,
  now,
  isPlayerInAnimationFreeze,
}) {
  if (unmatchedHealthBars.length === 0) return;

  const battleListCounts = new Map();
  for (const entry of battleListEntries) {
    let fullName = canonicalNames.find(cName => isBattleListMatch(cName, entry.name)) || entry.name;
    if (fullName.endsWith('...')) {
      fullName = fullName.slice(0, -3);
    }
    battleListCounts.set(fullName, (battleListCounts.get(fullName) || 0) + 1);
  }

  const identifiedCounts = new Map();
  for (const creature of newActiveCreatures.values()) {
    if (creature.name) {
      identifiedCounts.set(creature.name, (identifiedCounts.get(creature.name) || 0) + 1);
    }
  }

  const neededCreatures = [];
  for (const [name, count] of battleListCounts.entries()) {
    const identified = identifiedCounts.get(name) || 0;
    if (count > identified) {
      for (let i = 0; i < count - identified; i++) {
        neededCreatures.push(name);
      }
    }
  }

  if (neededCreatures.length === 0) return;

  const barOcrData = [];
  for (const hb of unmatchedHealthBars) {
    const rawOcr = await performOcrForHealthBar(hb);
    if (rawOcr) {
      barOcrData.push({ hb, rawOcr });
    }
  }

  const usedBars = new Set();
  
  for (const neededName of neededCreatures) {
    let bestBar = null;
    let highestScore = -1;

    for (const data of barOcrData) {
      if (usedBars.has(data.hb)) continue;
      const score = getSimilarityScore(data.rawOcr, neededName);
      
      if (score > 0.5 && score > highestScore) {
        highestScore = score;
        bestBar = data.hb;
      }
    }

    if (bestBar) {
      const detection = {
        absoluteCoords: { x: bestBar.x, y: bestBar.y },
        healthBarY: bestBar.y,
        name: neededName,
        hp: bestBar.healthTag,
      };
      
      const newId = nextInstanceId++;
      let newCreature = { instanceId: newId };
      
      newCreature = updateCreatureState(
        newCreature,
        detection,
        currentPlayerMinimapPosition,
        lastStablePlayerMinimapPosition,
        regions,
        tileSize,
        now,
        isPlayerInAnimationFreeze,
      );

      if (newCreature) {
        newActiveCreatures.set(newId, newCreature);
        usedBars.add(bestBar);
      }
    }
  }
}


async function performOperation() {
  try {
    const now = Date.now();

    if (
      !isInitialized ||
      !currentState?.regionCoordinates?.regions ||
      !pathfinderInstance?.isLoaded
    )
      return;
    const rc = currentState.regionCoordinates;
    const regions = rc?.regions;
    const version = rc?.version;
    if (!regions) {
      if (version !== lastRequestedRegionsVersion) {
        parentPort.postMessage({ type: 'request_regions_snapshot' });
        lastRequestedRegionsVersion = version ?? -1;
      }
      return;
    }
    if (
      regionsStale &&
      typeof version === 'number' &&
      version !== lastRequestedRegionsVersion
    ) {
      parentPort.postMessage({ type: 'request_regions_snapshot' });
      lastRequestedRegionsVersion = version;
    }

    const { gameWorld, tileSize, battleList: battleListRegion } = regions;
    if (!gameWorld || !tileSize) return;

    let currentPlayerMinimapPosition = { x: 0, y: 0, z: 0 };
    if (sabInterface) {
      try {
        const posResult = sabInterface.get('playerPos');
        if (posResult && posResult.data && posResult.data.x !== 0) {
          currentPlayerMinimapPosition = posResult.data;
        } else {
          currentPlayerMinimapPosition = previousPlayerMinimapPosition;
        }
      } catch (err) {
        currentPlayerMinimapPosition = previousPlayerMinimapPosition;
      }
    }

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

    let battleListEntries = lastBattleListEntries;
    let playerNames = lastPlayerNames;
    let npcNames = lastNpcNames;

    const dirtyRects = [...frameUpdateManager.accumulatedDirtyRects];
    frameUpdateManager.accumulatedDirtyRects.length = 0;

    let forceBattleListOcr = false;
    if (now - lastBattleListOcrTime > 500) {
      forceBattleListOcr = true;
    }

    if (dirtyRects.length > 0 || forceBattleListOcr) {
      if (
        regions.battleList &&
        (dirtyRects.some((r) => rectsIntersect(r, regions.battleList)) ||
          forceBattleListOcr)
      ) {
        battleListEntries = await processBattleListOcr(
          sharedBufferView,
          regions,
        );
        lastBattleListOcrTime = now;
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

    let targetingEnabled = false;
    let targetingList = [];
    if (sabInterface) {
      try {
        const targetingConfigResult = sabInterface.get('targetingConfig');
        if (targetingConfigResult && targetingConfigResult.data) {
          targetingEnabled = targetingConfigResult.data.enabled === 1;
        }
        const targetingListResult = sabInterface.get('targetingList');
        if (
          targetingListResult &&
          targetingListResult.data &&
          Array.isArray(targetingListResult.data)
        ) {
          targetingList = targetingListResult.data;
        }
      } catch (err) {}
    }

    if (
      targetingEnabled &&
      !isLootingInProgress &&
      lastBattleListEntries.length > battleListEntries.length
    ) {
      // Battle list count decreased - something died, check if it's in targeting list
      const hadTargetable = lastBattleListEntries.some((entry) =>
        targetingList.some((rule) => isBattleListMatch(rule.name, entry.name)),
      );
      
      if (hadTargetable) {
        console.log(`[CreatureMonitor] Battle list decreased from ${lastBattleListEntries.length} to ${battleListEntries.length}, triggering loot.`);
        await performImmediateLooting();
      }
    }

    lastBattleListEntries = battleListEntries;
    lastPlayerNames = playerNames;
    lastNpcNames = npcNames;

    let lootingRequired = false;
    if (sabInterface) {
      try {
        const result = sabInterface.get('looting');
        if (result && result.data) {
          lootingRequired = result.data.required === 1;
        }
      } catch (err) {}
      }
    if (lootingRequired) return;

    const hasEntities = battleListEntries.length > 0 || playerNames.length > 0 || npcNames.length > 0;

    if (!hasEntities) {
      if (lastSentCreatures.length > 0 || lastSentTarget !== null) {
        if (activeCreatures.size > 0) {
          console.log(
            `[CreatureMonitor] No entities detected, clearing all ${activeCreatures.size} active creatures.`,
          );
        }
        activeCreatures.clear();
        lastSentCreatures = [];
        lastSentTarget = null;

        if (sabInterface) {
          try {
            sabInterface.setMany({
              creatures: [],
              target: { instanceId: 0, x: 0, y: 0, z: 0, distance: 0, isReachable: 0, name: '' },
              battleList: [],
            });
          } catch (err) {}
        }

        postUpdateOnce('targeting/setEntities', { creatures: [], duration: 0 });
        postUpdateOnce('targeting/setTarget', null);
      }
      postUpdateOnce('battleList/setBattleListEntries', battleListEntries);
      postUpdateOnce('uiValues/setPlayers', playerNames);
      postUpdateOnce('uiValues/setNpcs', npcNames);
      previousTargetName = null;
      return;
    }

    const constrainedGameWorld = {
      ...gameWorld,
      y: gameWorld.y + 14,
      height: Math.max(0, gameWorld.height - 28),
    };

    let healthBars = [];
    healthBars = await findHealthBars.findHealthBars(
      sharedBufferView,
      constrainedGameWorld,
    );
    lastHealthScanTime = now;
    
    // Filter out player's own health bar to prevent false creature detection
    const playerHealthBarsToRemove = [];
    for (const hb of healthBars) {
      const creatureScreenX = hb.x;
      const creatureScreenY = hb.y + 14 + tileSize.height / 2;
      const gameCoords = getGameCoordinatesFromScreen(
        creatureScreenX,
        creatureScreenY,
        currentPlayerMinimapPosition,
        gameWorld,
        tileSize,
      );
      
      if (gameCoords) {
        const roundedX = Math.round(gameCoords.x);
        const roundedY = Math.round(gameCoords.y);
        const roundedZ = gameCoords.z;
        
        // Check if this health bar is at the player's exact position
        if (roundedX === currentPlayerMinimapPosition.x && 
            roundedY === currentPlayerMinimapPosition.y && 
            roundedZ === currentPlayerMinimapPosition.z) {
          playerHealthBarsToRemove.push(hb);
        }
      }
    }
    
    // Remove player health bars from the list
    if (playerHealthBarsToRemove.length > 0) {
      healthBars = healthBars.filter(hb => !playerHealthBarsToRemove.includes(hb));
    }
    
    let newActiveCreatures = new Map();
    const matchedHealthBars = new Set();

    const explicitTargetNames = targetingList
      .filter((rule) => rule.name.toLowerCase() !== 'others')
      .map((rule) => rule.name);

    const battleListNames = battleListEntries.map((e) => e.name);

    const canonicalNames = [
      ...new Set([
        ...explicitTargetNames,
        ...battleListNames,
      ]),
    ];

    const getRawOcrForHealthBar = (hb) => {
      const ocrRegion = getNameplateRegion(hb, gameWorld, tileSize);
      if (!ocrRegion) return null;
      
      const results = recognizeText(
          sharedBufferView,
          ocrRegion,
          regionDefinitions.gameWorld?.ocrColors || [],
          NAMEPLATE_ALLOWED_CHARS,
        ) || [];
      return results.length > 0 ? results[0].text.trim().replace(/([a-z])([A-Z])/g, '$1 $2') : null;
    };

    // --- CORRECTED TWO-STAGE LOGIC ---

    // STAGE 1: Track existing creatures by finding the closest health bar
    for (const [id, oldCreature] of activeCreatures.entries()) {
      let bestMatchHb = null;
      let minDistance = CORRELATION_DISTANCE_THRESHOLD_PIXELS;

      for (const hb of healthBars) {
        if (matchedHealthBars.has(hb)) continue;
        const distance = screenDist(hb, oldCreature.absoluteCoords);
        if (distance < minDistance) {
          minDistance = distance;
          bestMatchHb = hb;
        }
      }

      if (bestMatchHb) {
        const detection = {
          absoluteCoords: { x: bestMatchHb.x, y: bestMatchHb.y },
          healthBarY: bestMatchHb.y,
          name: oldCreature.name, // CRITICAL: Keep the existing, trusted name
          hp: bestMatchHb.healthTag,
        };
        const updated = updateCreatureState(
          oldCreature,
          detection,
          currentPlayerMinimapPosition,
          lastStablePlayerMinimapPosition,
          regions,
          tileSize,
          now,
          isPlayerInAnimationFreeze,
        );
        if (updated) {
          if (updated.positionUncertain) delete updated.positionUncertain;
          newActiveCreatures.set(id, updated);
          matchedHealthBars.add(bestMatchHb);
        }
      }
    }

    // STAGE 2: Identify genuinely new creatures from unmatched health bars
    const unmatchedHealthBars = healthBars.filter(hb => !matchedHealthBars.has(hb));
    if (unmatchedHealthBars.length > 0 && battleListEntries.length > 0) {
      await identifyAndAssignNewCreatures({
        unmatchedHealthBars,
        newActiveCreatures,
        battleListEntries,
        canonicalNames,
        performOcrForHealthBar: async (hb) => getRawOcrForHealthBar(hb),
        currentPlayerMinimapPosition,
        lastStablePlayerMinimapPosition,
        regions,
        tileSize,
        now,
        isPlayerInAnimationFreeze,
      });
    }

    // STAGE 3: Cleanup and state finalization
    const currentBattleListNames = battleListEntries.map(e => e.name);
    
    for (const [id, creature] of newActiveCreatures.entries()) {
      if (creature.name) {
        const isInBattleList = currentBattleListNames.some(blName => isBattleListMatch(creature.name, blName));
        
        if (!isInBattleList) {
          console.log(
            `[CreatureMonitor] Creature disappeared from battle list: ${creature.name} (instanceId: ${id})`,
          );
          newActiveCreatures.delete(id);
        }
      }
    }

    if (battleListEntries.length > 0) {
      const detectedCounts = new Map();
      for (const c of newActiveCreatures.values()) {
        detectedCounts.set(c.name, (detectedCounts.get(c.name) || 0) + 1);
      }

      const blCounts = new Map();
      for (const name of canonicalNames) {
        const count = battleListEntries.filter(e => isBattleListMatch(name, e.name)).length;
        if (count > 0) blCounts.set(name, count);
      }

      for (const [id, oldCreature] of activeCreatures.entries()) {
        if (!newActiveCreatures.has(id) && oldCreature.name) {
          const blCount = blCounts.get(oldCreature.name) || 0;
          const detectedCount = detectedCounts.get(oldCreature.name) || 0;

          if (blCount > detectedCount) {
            if (!oldCreature.positionUncertain) {
              oldCreature.positionUncertainSince = now;
            }
            oldCreature.lastSeen = now;
            oldCreature.positionUncertain = true;
            detectedCounts.set(oldCreature.name, detectedCount + 1);

            if (now - (oldCreature.positionUncertainSince || now) < 2000) {
              newActiveCreatures.set(id, oldCreature);
            } else {
              console.log(
                `[CreatureMonitor] Creature disappeared (uncertain timeout): ${oldCreature.name} (instanceId: ${id})`,
              );
            }
          }
        }
      }
    }

    activeCreatures = newActiveCreatures;

    let detectedEntities = Array.from(activeCreatures.values());
    
    if (detectedEntities.length > 0) {
      const allCreaturePositions = detectedEntities.map((c) => c.gameCoords);
      const screenBounds = {
        minX: currentPlayerMinimapPosition.x - 7,
        maxX: currentPlayerMinimapPosition.x + 7,
        minY: currentPlayerMinimapPosition.y - 5,
        maxY: currentPlayerMinimapPosition.y + 5,
      };
      const reachableSig = `${currentPlayerMinimapPosition.x},${currentPlayerMinimapPosition.y},${currentPlayerMinimapPosition.z}|${screenBounds.minX},${screenBounds.maxX},${screenBounds.minY},${screenBounds.maxY}|${allCreaturePositions.map((p) => (p ? `${p.x},${p.y},${p.z}` : '0,0,0')).join(';')}`;
      let reachableTiles = null;
      if (reachableSig === lastReachableSig && lastReachableTiles) {
        reachableTiles = lastReachableTiles;
      } else {
        reachableTiles = pathfinderInstance.getReachableTiles(
          currentPlayerMinimapPosition,
          allCreaturePositions,
          screenBounds,
        );
        lastReachableSig = reachableSig;
        lastReachableTiles = reachableTiles;
      }
      detectedEntities = detectedEntities.map((entity) => {
        const coordsKey = getCoordsKey(entity.gameCoords);
        const isReachable = entity.positionUncertain
          ? false
          : typeof reachableTiles[coordsKey] !== 'undefined';
        
        let isAdjacent = false;
        if (entity.gameCoords) {
          const deltaX = Math.abs(currentPlayerMinimapPosition.x - entity.gameCoords.x);
          const deltaY = Math.abs(currentPlayerMinimapPosition.y - entity.gameCoords.y);
          isAdjacent = (deltaX <= 1 && deltaY <= 1) && !(deltaX === 0 && deltaY === 0);
        }
        return { ...entity, isReachable, isAdjacent, isBlockingPath: false };
      });
    }

    const creaturesChanged = !deepCompareEntities(detectedEntities, lastSentCreatures);
    if (creaturesChanged) {
      postUpdateOnce('targeting/setEntities', { creatures: detectedEntities, duration: '0.00' });
      lastSentCreatures = detectedEntities;
    }

    let gameWorldTarget = null;
    const allObstructed = detectedEntities.length > 0 && detectedEntities.every((e) => e.hp === 'Obstructed');

    if (!allObstructed && (playerPositionChanged || creaturesChanged)) {
      const targetRect = await findTarget.findTarget(sharedBufferView, gameWorld);
      if (targetRect) {
        const screenX = targetRect.x + targetRect.width / 2;
        const screenY = targetRect.y + targetRect.height / 2;
        const targetGameCoordsRaw = getGameCoordinatesFromScreen(
          screenX,
          screenY,
          isPlayerInAnimationFreeze ? lastStablePlayerMinimapPosition : currentPlayerMinimapPosition,
          gameWorld,
          tileSize,
        );
        if (targetGameCoordsRaw) {
          let closestCreature = null;
          let minDistance = Infinity;
          for (const entity of detectedEntities) {
            if (entity.gameCoords) {
              const distance = calculateDistance(targetGameCoordsRaw, entity.gameCoords);
              if (distance < minDistance && distance < 1.0) {
                minDistance = distance;
                closestCreature = entity;
              }
            }
          }
          if (closestCreature) {
            gameWorldTarget = {
              instanceId: closestCreature.instanceId,
              name: closestCreature.name,
              hp: closestCreature.hp,
              distance: parseFloat(closestCreature.distance.toFixed(1)),
              gameCoordinates: closestCreature.gameCoords,
              isReachable: closestCreature.isReachable,
            };
          }
        }
      }
    }

    let battleListTargetEntry = null;
    if (battleListRegion) {
      const targetColors = [[255, 0, 0], [255, 128, 128]];
      const sequences = {};
      for (let i = 0; i < targetColors.length; i++) {
        sequences[`target_bar_${i}`] = { sequence: new Array(5).fill(targetColors[i]), direction: 'vertical' };
      }
      const result = await findSequences.findSequencesNative(sharedBufferView, sequences, battleListRegion);
      let markerY = null;
      for (const key in result) { if (result[key]) { markerY = result[key].y; break; } }

      if (markerY !== null) {
        let closestEntry = null;
        let minDistance = Infinity;
        for (const entry of battleListEntries) {
          const distance = Math.abs(entry.y - markerY);
          if (distance < minDistance) { minDistance = distance; closestEntry = entry; }
        }
        if (closestEntry && minDistance < 20) {
          battleListTargetEntry = closestEntry;
        }
      }
    }

    let unifiedTarget = null;
    if (gameWorldTarget) {
      unifiedTarget = gameWorldTarget;
    } else if (battleListTargetEntry) {
      const match = detectedEntities.find(c => isBattleListMatch(c.name, battleListTargetEntry.name));
      if (match) {
        unifiedTarget = {
          instanceId: match.instanceId,
          name: match.name,
          hp: match.hp,
          distance: parseFloat(match.distance.toFixed(1)),
          gameCoordinates: match.gameCoords,
          isReachable: match.isReachable,
        };
      }
    }

    if (unifiedTarget && !detectedEntities.some(c => c.instanceId === unifiedTarget.instanceId)) {
      unifiedTarget = null;
    }

    const targetChanged = !deepCompareEntities(unifiedTarget, lastSentTarget);
    if (targetChanged) {
      if (lastSentTarget && !unifiedTarget) {
        console.log(`[CreatureMonitor] Target disappeared. Last known target was: ${lastSentTarget.name} (instanceId: ${lastSentTarget.instanceId})`);
      }
      lastSentTarget = unifiedTarget;
    }

    if (sabInterface) {
      try {
        const sabTarget = unifiedTarget ? {
          instanceId: unifiedTarget.instanceId,
          x: unifiedTarget.gameCoordinates.x,
          y: unifiedTarget.gameCoordinates.y,
          z: unifiedTarget.gameCoordinates.z,
          distance: Math.round(unifiedTarget.distance * 100),
          isReachable: unifiedTarget.isReachable ? 1 : 0,
          name: unifiedTarget.name,
        } : { instanceId: 0, x: 0, y: 0, z: 0, distance: 0, isReachable: 0, name: '' };

        const sabCreatures = detectedEntities.slice(0, 100).map((c) => ({
          instanceId: c.instanceId,
          x: c.gameCoords?.x || 0,
          y: c.gameCoords?.y || 0,
          z: c.gameCoords?.z || 0,
          absoluteX: c.absoluteCoords.x,
          absoluteY: c.absoluteCoords.y,
          isReachable: c.isReachable ? 1 : 0,
          isAdjacent: c.isAdjacent ? 1 : 0,
          isBlockingPath: 0,
          distance: Math.round(c.distance * 100),
          hp: typeof c.hp === 'string' ? 0 : c.hp,
          name: c.name,
        }));

        const sabBattleList = battleListEntries.slice(0, 50).map(b => ({
          name: b.name,
          x: b.x,
          y: b.y,
          isTarget: (battleListTargetEntry && b === battleListTargetEntry) ? 1 : 0
        }));

        sabInterface.setMany({
          creatures: sabCreatures,
          battleList: sabBattleList,
          target: sabTarget,
        });
      } catch (err) {}
    }

    const batchUpdates = [];
    if (targetChanged) {
      batchUpdates.push({ type: 'targeting/setTarget', payload: unifiedTarget });
    }
    const blString = JSON.stringify(battleListEntries);
    if (blString !== lastPostedResults.get('battleList/setBattleListEntries')) {
      lastPostedResults.set('battleList/setBattleListEntries', blString);
      batchUpdates.push({ type: 'battleList/setBattleListEntries', payload: battleListEntries });
      if (battleListEntries.length > 0) {
        batchUpdates.push({ type: 'battleList/updateLastSeenMs', payload: undefined });
      }
    }
    
    const playersString = JSON.stringify(playerNames);
    if (playersString !== lastPostedResults.get('uiValues/setPlayers')) {
      lastPostedResults.set('uiValues/setPlayers', playersString);
      batchUpdates.push({ type: 'uiValues/setPlayers', payload: playerNames });
      if (playerNames.length > 0) batchUpdates.push({ type: 'uiValues/updateLastSeenPlayerMs', payload: undefined });
    }
    const npcsString = JSON.stringify(npcNames);
    if (npcsString !== lastPostedResults.get('uiValues/setNpcs')) {
      lastPostedResults.set('uiValues/setNpcs', npcsString);
      batchUpdates.push({ type: 'uiValues/setNpcs', payload: npcNames });
      if (npcNames.length > 0) batchUpdates.push({ type: 'uiValues/updateLastSeenNpcMs', payload: undefined });
    }

    if (batchUpdates.length > 0) {
      parentPort.postMessage({ type: 'batch-update', payload: batchUpdates });
    }

  } catch (error) {
    console.error('[CreatureMonitor] CRITICAL ERROR in performOperation:', error);
  }
}

async function performImmediateLooting() {
  if (isLootingInProgress) {
    return;
  }
  try {
    isLootingInProgress = true;
  
    if (sabInterface) {
      try {
        sabInterface.set('looting', { required: 1 });
      } catch (err) {}
    }

    parentPort.postMessage({ storeUpdate: true, type: 'cavebot/setLootingRequired', payload: true });
    parentPort.postMessage({ type: 'inputAction', payload: { type: 'looting', action: { module: 'keypress', method: 'sendKey', args: ['f8'] } } });
    await delay(50);

    if (sabInterface) {
      try {
        sabInterface.set('looting', { required: 0 });
      } catch (err) {}
    }

    parentPort.postMessage({ storeUpdate: true, type: 'cavebot/setLootingRequired', payload: false });
    } catch (error) {
    if (sabInterface) {
      try {
        sabInterface.set('looting', { required: 0 });
      } catch (err) {}
    }
    parentPort.postMessage({ storeUpdate: true, type: 'cavebot/setLootingRequired', payload: false });
  } finally {
    isLootingInProgress = false;
  }
}

async function initialize() {
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
      } catch (e) {}
    }
    pathfinderInstance.loadMapData(mapDataForAddon);
    if (!pathfinderInstance.isLoaded) {
      throw new Error('Pathfinder failed to load map data.');
    }
    } catch (err) {
    pathfinderInstance = null;
    }
}

parentPort.on('message', async (message) => {
  if (isShuttingDown) return;
  try {
    if (message.type === 'frame-update') {
      frameUpdateManager.addDirtyRects(message.payload.dirtyRects);
    }
    if (message.type === 'shutdown') {
      isShuttingDown = true;
      if (pathfinderInstance) pathfinderInstance.destroy();
      return;
    } else if (message.type === 'sab_sync_targeting_list') {
      if (sabInterface) {
        try {
          sabInterface.set('targetingList', message.payload);
        } catch (err) {}
      }
      return;
    } else if (message.type === 'manual_loot_trigger') {
      await performImmediateLooting();
      return;
    } else if (message.type === 'state_full_sync') {
      currentState = message.payload;
    } else if (message.type === 'state_diff') {
      if (!currentState) currentState = {};
      Object.assign(currentState, message.payload);
    } else if (message.type === 'regions_snapshot') {
      currentState = currentState || {};
      currentState.regionCoordinates = message.payload;
      regionsStale = false;
      return;
    } else if (typeof message === 'object' && !message.type) {
      currentState = message;
      if (currentState && !isInitialized) {
        isInitialized = true;
        initialize()
          .then(() => {
            if (currentState.gameState?.playerMinimapPosition) {
              previousPlayerMinimapPosition = { ...currentState.gameState.playerMinimapPosition };
              lastStablePlayerMinimapPosition = { ...currentState.gameState.playerMinimapPosition };
            }
          })
          .catch((err) => {});
          }
          }
    performOperation();
  } catch (e) {
    console.error('[CreatureMonitor] CRITICAL ERROR in message handler:', e);
  }
  });
