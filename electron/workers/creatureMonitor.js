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
  battleListCounts,
  matchedCounts,
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

  // identifiedCounts is now the same as matchedCounts (creatures already identified in STAGE 1)
  const identifiedCounts = new Map(matchedCounts);

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
        // Increment identified count to prevent over-assignment
        identifiedCounts.set(neededName, (identifiedCounts.get(neededName) || 0) + 1);
        matchedCounts.set(neededName, (matchedCounts.get(neededName) || 0) + 1);
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

    const dirtyRects = [...frameUpdateManager.accumulatedDirtyRects];
    frameUpdateManager.accumulatedDirtyRects.length = 0;

    // ========================================================================
    // PHASE 1: Read targeting configuration from SAB
    // ========================================================================
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

    // ========================================================================
    // PHASE 2: Perform OCR on battle list
    // ========================================================================
    let battleListEntries = lastBattleListEntries;
    let forceBattleListOcr = false;
    // if (now - lastBattleListOcrTime > 500) {
    //   forceBattleListOcr = true;
    // }

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
    }

    // ========================================================================
    // PHASE 3: Perform OCR on player/NPC lists
    // ========================================================================
    let playerNames = lastPlayerNames;
    let npcNames = lastNpcNames;
    
    if (dirtyRects.length > 0) {
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

    // Auto-looting logic when creatures die
    if (
      targetingEnabled &&
      !isLootingInProgress &&
      lastBattleListEntries.length > battleListEntries.length
    ) {
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

    // Track which battle list entry is targeted (index), additive only
    let battleListTargetIndex = -1;
    if (battleListRegion && (dirtyRects.length > 0 && dirtyRects.some(r => rectsIntersect(r, battleListRegion)))) {
      const targetColors = [[255, 0, 0], [255, 128, 128]];
      const sequences = {};
      for (let i = 0; i < targetColors.length; i++) {
        sequences[`target_bar_${i}`] = { sequence: new Array(5).fill(targetColors[i]), direction: 'vertical' };
      }
      try {
        const result = await findSequences.findSequencesNative(sharedBufferView, sequences, battleListRegion);
        let markerY = null;
        for (const key in result) { if (result[key]) { markerY = result[key].y; break; } }
        if (markerY !== null) {
          let minDistance = Infinity;
          for (let i = 0; i < battleListEntries.length; i++) {
            const entry = battleListEntries[i];
            const distance = Math.abs(entry.y - markerY);
            if (distance < minDistance) { minDistance = distance; battleListTargetIndex = i; }
          }
          if (minDistance >= 20) battleListTargetIndex = -1;
        }
      } catch (e) {}
    }

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

    // ========================================================================
    // PHASE 4: Detect health bars and perform gameWorld nameplate OCR
    // ========================================================================
    const constrainedGameWorld = {
      ...gameWorld,
      y: gameWorld.y + 14,
      height: Math.max(0, gameWorld.height - 28),
    };

    let healthBars = await findHealthBars.findHealthBars(
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
        
        if (roundedX === currentPlayerMinimapPosition.x && 
            roundedY === currentPlayerMinimapPosition.y && 
            roundedZ === currentPlayerMinimapPosition.z) {
          playerHealthBarsToRemove.push(hb);
        }
      }
    }
    
    if (playerHealthBarsToRemove.length > 0) {
      healthBars = healthBars.filter(hb => !playerHealthBarsToRemove.includes(hb));
    }

    // Prepare canonical names from targeting list and battle list
    // NOTE: New creature creation still uses ONLY battleList counts; targetingList
    // here is for better name normalization/matching (does not create creatures).
    const explicitTargetNames = targetingList
      .filter((rule) => rule.name.toLowerCase() !== 'others')
      .map((rule) => rule.name);
    const battleListNames = battleListEntries.map((e) => e.name);
    const canonicalNames = [...new Set([...explicitTargetNames, ...battleListNames])];

    // Helper function for nameplate OCR
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

    // ========================================================================
    // PHASE 5: Match creatures - Track existing and identify new
    // ========================================================================
    let newActiveCreatures = new Map();
    const matchedHealthBars = new Set();
    const currentBattleListNames = battleListEntries.map(e => e.name);
    
    // Count how many of each creature name are in battle list
    const battleListCounts = new Map();
    for (const entry of battleListEntries) {
      let fullName = canonicalNames.find(cName => isBattleListMatch(cName, entry.name)) || entry.name;
      if (fullName.endsWith('...')) {
        fullName = fullName.slice(0, -3);
      }
      battleListCounts.set(fullName, (battleListCounts.get(fullName) || 0) + 1);
    }
    
    // Track how many of each creature name we've already matched in STAGE 1
    const matchedCounts = new Map();
    
    // STAGE 1: Track existing creatures by finding closest health bar
    // Only match creatures that are still in battle list AND haven't exceeded the count
    const shouldVerifyNameplates = healthBars.length > battleListEntries.length;
    
    for (const [id, oldCreature] of activeCreatures.entries()) {
      if (oldCreature.name) {
        // Check if this creature name is in battle list
        const stillInBattleList = currentBattleListNames.some(blName => 
          isBattleListMatch(oldCreature.name, blName)
        );
        
        if (!stillInBattleList) {
          continue;
        }
        
        // Check if we've already matched enough creatures with this name
        const battleListCount = battleListCounts.get(oldCreature.name) || 0;
        const alreadyMatched = matchedCounts.get(oldCreature.name) || 0;
        
        if (alreadyMatched >= battleListCount) {
          // We've already matched enough creatures with this name, skip this one
          continue;
        }
      }
      
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
        // If more health bars than battle list entries, verify nameplate matches
        if (shouldVerifyNameplates && oldCreature.name) {
          const rawOcr = getRawOcrForHealthBar(bestMatchHb);
          if (rawOcr) {
            const similarity = getSimilarityScore(rawOcr, oldCreature.name);
            if (similarity < 0.5) {
              // Nameplate doesn't match expected name - likely wrong creature, skip
              continue;
            }
          }
        }
        
        const detection = {
          absoluteCoords: { x: bestMatchHb.x, y: bestMatchHb.y },
          healthBarY: bestMatchHb.y,
          name: oldCreature.name, // Keep the existing, trusted name (validated above)
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
          newActiveCreatures.set(id, updated);
          matchedHealthBars.add(bestMatchHb);
          // Increment matched count for this creature name
          if (updated.name) {
            matchedCounts.set(updated.name, (matchedCounts.get(updated.name) || 0) + 1);
          }
        }
      }
    }

    // STAGE 2: Identify new creatures from unmatched health bars
    // For each unmatched health bar, perform nameplate OCR and match against
    // battle list entries to identify new creatures
    const unmatchedHealthBars = healthBars.filter(hb => !matchedHealthBars.has(hb));
    if (unmatchedHealthBars.length > 0 && battleListEntries.length > 0) {
      await identifyAndAssignNewCreatures({
        unmatchedHealthBars,
        newActiveCreatures,
        battleListCounts,
        matchedCounts,
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
    // Remove creatures no longer in battle list and handle position-uncertain creatures
    
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

    // Count mismatch detection: if battle list has more creatures than we detected,
    // force full rescan on next frame (don't keep stale positionUncertain creatures)
    if (battleListEntries.length > 0) {
      const detectedCounts = new Map();
      for (const c of newActiveCreatures.values()) {
        detectedCounts.set(c.name, (detectedCounts.get(c.name) || 0) + 1);
      }

      let hasCountMismatch = false;
      for (const [name, blCount] of battleListCounts.entries()) {
        const detectedCount = detectedCounts.get(name) || 0;
        if (blCount > detectedCount) {
          hasCountMismatch = true;
          console.log(
            `[CreatureMonitor] Count mismatch: ${name} - battle list: ${blCount}, detected: ${detectedCount}. Will rescan on next frame.`,
          );
          break;
        }
      }

      // No need to keep unmatched creatures - they'll be re-detected on next frame
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
      // OPTIMIZED: numeric hash signature to avoid per-frame string allocs
      let reachableSig = 0;
      // mix in player pos
      reachableSig = ((reachableSig * 31) ^ (currentPlayerMinimapPosition.x | 0)) | 0;
      reachableSig = ((reachableSig * 31) ^ (currentPlayerMinimapPosition.y | 0)) | 0;
      reachableSig = ((reachableSig * 31) ^ (currentPlayerMinimapPosition.z | 0)) | 0;
      // mix in screen bounds
      reachableSig = ((reachableSig * 31) ^ (screenBounds.minX | 0)) | 0;
      reachableSig = ((reachableSig * 31) ^ (screenBounds.maxX | 0)) | 0;
      reachableSig = ((reachableSig * 31) ^ (screenBounds.minY | 0)) | 0;
      reachableSig = ((reachableSig * 31) ^ (screenBounds.maxY | 0)) | 0;
      // mix in creature positions
      for (let i = 0; i < allCreaturePositions.length; i++) {
        const p = allCreaturePositions[i];
        if (p) {
          reachableSig = ((reachableSig * 31) ^ (p.x | 0)) | 0;
          reachableSig = ((reachableSig * 31) ^ (p.y | 0)) | 0;
          reachableSig = ((reachableSig * 31) ^ (p.z | 0)) | 0;
        } else {
          reachableSig = ((reachableSig * 31) ^ 0) | 0;
        }
      }
      // ensure unsigned 32-bit for map/cache keys if needed
      reachableSig >>>= 0;
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
        const isReachable = typeof reachableTiles[coordsKey] !== 'undefined';
        
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

    // Check if dirty rects intersect game world (target box appearing/disappearing creates dirty rects)
    const gameWorldChanged = dirtyRects.some((r) => rectsIntersect(r, gameWorld));

    // Rescan target only when there are dirty rects intersecting gameWorld
    const shouldDetectTarget = !allObstructed && gameWorldChanged;

    if (shouldDetectTarget) {
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
          // Snap to nearest tile and match by exact tile coords (1 creature per tile)
          const targetTile = {
            x: Math.round(targetGameCoordsRaw.x),
            y: Math.round(targetGameCoordsRaw.y),
            z: targetGameCoordsRaw.z ?? ((isPlayerInAnimationFreeze ? lastStablePlayerMinimapPosition : currentPlayerMinimapPosition).z),
          };

          // Try exact tile match first
          let matched = detectedEntities.find((e) =>
            e.gameCoords &&
            e.gameCoords.x === targetTile.x &&
            e.gameCoords.y === targetTile.y &&
            e.gameCoords.z === targetTile.z
          );

          // Fallback: choose closest within 1 tile if exact match fails
          if (!matched) {
            let closestCreature = null;
            let minDistance = Infinity;
            for (const entity of detectedEntities) {
              if (entity.gameCoords) {
                const distance = calculateDistance(targetTile, entity.gameCoords);
                if (distance < minDistance) {
                  minDistance = distance;
                  closestCreature = entity;
                }
              }
            }
            if (minDistance <= 1.0) matched = closestCreature;
          }

          if (matched) {
            gameWorldTarget = {
              instanceId: matched.instanceId,
              name: matched.name,
              hp: matched.hp,
              distance: parseFloat(matched.distance.toFixed(1)),
              gameCoordinates: matched.gameCoords,
              isReachable: matched.isReachable,
            };
          }
        }
      }
    }

    // Battle list target box is not used anymore; gameWorld target is authoritative
    let unifiedTarget = null;
    if (shouldDetectTarget) {
      // After a rescan, adopt detected target (or clear if none)
      unifiedTarget = gameWorldTarget || null;

      // Sticky rule: do not switch between same-name creatures unless previous becomes unreachable
      if (
        gameWorldTarget &&
        lastSentTarget &&
        gameWorldTarget.instanceId !== lastSentTarget.instanceId &&
        gameWorldTarget.name &&
        lastSentTarget.name &&
        isBattleListMatch(gameWorldTarget.name, lastSentTarget.name)
      ) {
        const prevEntity = detectedEntities.find(c => c.instanceId === lastSentTarget.instanceId);
        if (prevEntity && prevEntity.isReachable) {
          unifiedTarget = lastSentTarget; // keep previous target
        }
      }
    } else {
      // No rescan this frame: persist previous target
      unifiedTarget = lastSentTarget;
    }

    if (shouldDetectTarget && unifiedTarget && !detectedEntities.some(c => c.instanceId === unifiedTarget.instanceId)) {
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

        const sabBattleList = battleListEntries.slice(0, 50).map((b, i) => ({
          name: b.name,
          x: b.x,
          y: b.y,
          isTarget: (typeof battleListTargetIndex === 'number' && i === battleListTargetIndex) ? 1 : 0,
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

    // Push battle list target index to Redux if it changed
    if (typeof battleListTargetIndex === 'number') {
      const idxStr = JSON.stringify(battleListTargetIndex);
      if (idxStr !== lastPostedResults.get('battleList/setTargetIndex')) {
        lastPostedResults.set('battleList/setTargetIndex', idxStr);
        batchUpdates.push({ type: 'battleList/setTargetIndex', payload: battleListTargetIndex });
      }
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
