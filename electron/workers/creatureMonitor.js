import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
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
  getAbsoluteGameWorldClickCoordinates,
} from '../utils/gameWorldClickTranslator.js';
import { FrameUpdateManager } from '../utils/frameUpdateManager.js';
import { SABStateManager } from './sabStateManager.js';
import { findBestNameMatch } from '../utils/nameMatcher.js';
import { processPlayerList, processNpcList } from './creatureMonitor/ocr.js';
import {
  PATH_STATUS_BLOCKED_BY_CREATURE,
} from './sharedConstants.js';

const logger = createLogger({ info: true, error: true, debug: false });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { recognizeText } = pkg;
// Battle list can have truncation markers (...)
const BATTLELIST_ALLOWED_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ. ';
// Nameplate OCR should NOT include dots (creatures never have dots in names)
const NAMEPLATE_ALLOWED_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ';

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

const sharedBufferView = Buffer.from(imageSAB);

const sabStateManager = new SABStateManager({
  playerPosSAB,
  pathDataSAB,
  battleListSAB,
  creaturesSAB,
  lootingSAB,
  targetingListSAB,
  targetSAB,
});

// Initialize unified SAB interface
let sabInterface = null;
if (workerData.unifiedSAB) {
  sabInterface = createWorkerInterface(workerData.unifiedSAB, WORKER_IDS.CREATURE_MONITOR);
  logger('info', '[CreatureMonitor] Unified SAB interface initialized');
}

const PLAYER_ANIMATION_FREEZE_MS = 25;
const STICKY_SNAP_THRESHOLD_TILES = 0.5;
const JITTER_CONFIRMATION_TIME_MS = 75;
const CORRELATION_DISTANCE_THRESHOLD_PIXELS = 200;
const TARGET_LOSS_GRACE_PERIOD_MS = 125;
const CREATURE_FLICKER_GRACE_PERIOD_MS = 250; // Increased from 125ms to prevent false ID changes
const STATIONARY_CREATURE_GRACE_PERIOD_MS = 500; // Increased from 300ms for more stability
const ADJACENT_DISTANCE_THRESHOLD_DIAGONAL = 1.45;
const ADJACENT_DISTANCE_THRESHOLD_STRAIGHT = 1.0;
const ADJACENT_TIME_THRESHOLD_MS = 0;
const HEALTHBAR_SCAN_MIN_INTERVAL_MS = 25;
const TARGET_SCAN_FALLBACK_MS = 250;

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
let lastBattleListOcrTime = 0;
// Performance caches for detection
let lastBarAreas = [];
let lastReachableSig = null;
let lastReachableTiles = null;
// Region snapshot management
let regionsStale = false;
let lastRequestedRegionsVersion = -1;
let lastHealthScanTime = 0;
let lastTargetScanTime = 0;
let lastBattleListCount = 0;
let battleListCreatureNames = new Map(); // name -> count

function arePositionsEqual(pos1, pos2) {
  if (!pos1 || !pos2) return pos1 === pos2;
  return pos1.x === pos2.x && pos1.y === pos2.y && pos1.z === pos2.z;
}

// Helper function to check if two names are similar (handles OCR errors)
function isSimilarName(name1, name2) {
  if (!name1 || !name2) return false;
  if (name1 === name2) return true;
  
  // Normalize: trim and lowercase
  const n1 = name1.trim().toLowerCase();
  const n2 = name2.trim().toLowerCase();
  if (n1 === n2) return true;
  
  // Check if one is substring of other (handles truncation)
  if (n1.includes(n2) || n2.includes(n1)) return true;
  
  // Check if names start the same way (OCR might miss last chars)
  const minLen = Math.min(n1.length, n2.length);
  if (minLen >= 4) { // At least 4 characters
    const prefix1 = n1.substring(0, minLen - 1);
    const prefix2 = n2.substring(0, minLen - 1);
    if (prefix1 === prefix2) return true;
  }
  
  return false;
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

// Helper functions for dirty-rect gating and OCR regions
function rectanglesIntersectWithMargin(a, b, marginX = 0, marginY = marginX) {
  if (!a || !b) return false;
  const expanded = {
    x: a.x - marginX,
    y: a.y - marginY,
    width: a.width + marginX * 2,
    height: a.height + marginY * 2,
  };
  return rectsIntersect(expanded, b);
}

function unionRect(rects, margin = 0) {
  if (!rects || rects.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    if (!r) continue;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (!isFinite(minX)) return null;
  return {
    x: Math.max(0, Math.floor(minX - margin)),
    y: Math.max(0, Math.floor(minY - margin)),
    width: Math.max(0, Math.ceil(maxX - minX + margin * 2)),
    height: Math.max(0, Math.ceil(maxY - minY + margin * 2)),
  };
}

function intersectRects(a, b) {
  if (!a || !b) return null;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function getNameplateRegion(hb, gameWorld, tileSize) {
  if (!hb || !gameWorld || !tileSize) return null;
  const idealOcrX = hb.x - tileSize.width / 2;
  const idealOcrY = hb.y - 16;
  const ocrWidth = tileSize.width;
  const ocrHeight = 14;
  const clampedX = Math.max(gameWorld.x, idealOcrX);
  const clampedY = Math.max(gameWorld.y, idealOcrY);
  const clampedWidth = Math.min(ocrWidth, gameWorld.x + gameWorld.width - clampedX);
  const clampedHeight = Math.min(ocrHeight, gameWorld.y + gameWorld.height - clampedY);
  if (clampedWidth <= 0 || clampedHeight <= 0) return null;
  return { x: clampedX, y: clampedY, width: clampedWidth, height: clampedHeight };
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

  // Track velocity and stationary time
  const previousAbsoluteCoords = creature.absoluteCoords;
  const previousGameCoords = creature.gameCoords;
  const timeSinceLastUpdate = previousAbsoluteCoords?.lastUpdate 
    ? now - previousAbsoluteCoords.lastUpdate 
    : 0;

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

  // Check if creature is adjacent (within 1 tile)
  const deltaX = Math.abs(currentPlayerMinimapPosition.x - finalGameCoords.x);
  const deltaY = Math.abs(currentPlayerMinimapPosition.y - finalGameCoords.y);
  const isCurrentlyAdjacent = (deltaX === 1 && deltaY <= 1) || (deltaY === 1 && deltaX <= 1);

  // Track stationary duration only for adjacent creatures
  if (previousAbsoluteCoords && timeSinceLastUpdate > 0 && !isPlayerInAnimationFreeze) {
    const screenPosUnchanged = 
      newAbsoluteCoords.x === previousAbsoluteCoords.x && 
      newAbsoluteCoords.y === previousAbsoluteCoords.y;
    
    const gameCoordsUnchanged = previousGameCoords && 
      previousGameCoords.x === finalGameCoords.x && 
      previousGameCoords.y === finalGameCoords.y &&
      previousGameCoords.z === finalGameCoords.z;
    
    if (isCurrentlyAdjacent && screenPosUnchanged && gameCoordsUnchanged) {
      if (!creature.adjacentStationaryStartTime) {
        creature.adjacentStationaryStartTime = now;
      }
      creature.adjacentStationaryDuration = now - creature.adjacentStationaryStartTime;
    } else {
      creature.adjacentStationaryStartTime = null;
      creature.adjacentStationaryDuration = 0;
    }
  } else {
    if (!creature.adjacentStationaryStartTime && isCurrentlyAdjacent) {
      creature.adjacentStationaryStartTime = now;
    }
    if (!creature.adjacentStationaryDuration) creature.adjacentStationaryDuration = 0;
  }

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
    if (regionsStale && typeof version === 'number' && version !== lastRequestedRegionsVersion) {
      parentPort.postMessage({ type: 'request_regions_snapshot' });
      lastRequestedRegionsVersion = version;
    }

    const { gameWorld, tileSize } = regions;
    if (!gameWorld || !tileSize) return;

    const now = Date.now();
    // Get player z-level from unified SAB
    let zLevelAtScanStart = 0;
    if (sabInterface) {
      try {
        const posResult = sabInterface.get('playerPos');
        if (posResult && posResult.data) {
          zLevelAtScanStart = posResult.data.z;
        }
      } catch (err) {
        // Fall back to reading from legacy SAB if needed
        if (workerData.sharedData?.playerPosSAB) {
          const playerPosArray = new Int32Array(workerData.sharedData.playerPosSAB);
          zLevelAtScanStart = playerPosArray[2]; // PLAYER_Z_INDEX = 2
        }
      }
    }

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
        
        // Write to unified SAB (null target becomes empty object with instanceId: 0)
        if (sabInterface) {
          try {
            sabInterface.batch({
              creatures: [],
              target: { instanceId: 0, x: 0, y: 0, z: 0, distance: 0, isReachable: 0, name: '' },
              battleList: [],
            });
          } catch (err) {
            logger('error', `[CreatureMonitor] Failed to write empty state to unified SAB: ${err.message}`);
          }
        }
        
        // Legacy SAB support (keep for targeting worker compatibility)
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

    // Get current player position from unified SAB
    let currentPlayerMinimapPosition = { x: 0, y: 0, z: 0 };
    if (sabInterface) {
      try {
        const posResult = sabInterface.get('playerPos');
        if (posResult && posResult.data) {
          currentPlayerMinimapPosition = posResult.data;
        }
      } catch (err) {
        logger('error', `[CreatureMonitor] Failed to read player pos from SAB: ${err.message}`);
      }
    }

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

    // Skip expensive health bar/target scans unless the game world changed or the player moved
    const intersectsGameWorld =
      dirtyRects.length > 0 && dirtyRects.some((r) => rectsIntersect(r, constrainedGameWorld));
    if (!intersectsGameWorld && !playerPositionChanged) {
      // Still propagate lightweight list updates if we refreshed them above
      postUpdateOnce('battleList/setBattleListEntries', battleListEntries);
      if (battleListEntries.length > 0)
        parentPort.postMessage({ storeUpdate: true, type: 'battleList/updateLastSeenMs' });
      postUpdateOnce('uiValues/setPlayers', playerNames);
      if (playerNames.length > 0)
        parentPort.postMessage({ storeUpdate: true, type: 'uiValues/updateLastSeenPlayerMs' });
      postUpdateOnce('uiValues/setNpcs', npcNames);
      if (npcNames.length > 0)
        parentPort.postMessage({ storeUpdate: true, type: 'uiValues/updateLastSeenNpcMs' });
      return;
    }

    // Minimal interval to smooth out bursts when frames arrive very fast
    if (!playerPositionChanged && now - lastHealthScanTime < HEALTHBAR_SCAN_MIN_INTERVAL_MS) {
      postUpdateOnce('battleList/setBattleListEntries', battleListEntries);
      postUpdateOnce('uiValues/setPlayers', playerNames);
      postUpdateOnce('uiValues/setNpcs', npcNames);
      return;
    }

    // Compute dirty union for ROI and skip if not touching previous bar areas
    let dirtyUnion = null;
    if (dirtyRects.length > 0) {
      const margin = Math.max(8, Math.floor((tileSize?.width || 32) * 0.5));
      dirtyUnion = unionRect(dirtyRects, margin);
    }

    let skipHealthScan = false;
    if (!playerPositionChanged && dirtyUnion && lastBarAreas && lastBarAreas.length) {
      let touchesBar = false;
      for (const area of lastBarAreas) {
        if (rectsIntersect(area, dirtyUnion)) { touchesBar = true; break; }
      }
      if (!touchesBar) skipHealthScan = true;
    }

    // Crop health bar scan to dirty union area inside the game world if available
    let healthScanArea = null;
    if (!skipHealthScan && dirtyUnion) {
      healthScanArea = intersectRects(dirtyUnion, constrainedGameWorld);
    }

    let healthBars = [];
    if (!skipHealthScan) {
      healthBars = await findHealthBars.findHealthBars(
        sharedBufferView,
        healthScanArea || constrainedGameWorld,
      );
      lastHealthScanTime = now;
    }
    let newActiveCreatures = new Map();
    const matchedHealthBars = new Set();
    if (skipHealthScan) {
      // Reuse previous activeCreatures if skipping heavy scan
      // Update lastSeen and positions to prevent flicker grace period expiration
      newActiveCreatures = new Map();
      for (const [id, creature] of activeCreatures.entries()) {
        const updated = { ...creature, lastSeen: now };
        // If player moved, update creature's expected screen position
        if (playerPositionChanged && creature.gameCoords) {
          const expectedScreenPos = getAbsoluteGameWorldClickCoordinates(
            creature.gameCoords.x,
            creature.gameCoords.y,
            currentPlayerMinimapPosition,
            regions.gameWorld,
            regions.tileSize
          );
          if (expectedScreenPos) {
            updated.absoluteCoords = {
              x: expectedScreenPos.x,
              y: expectedScreenPos.y,
              lastUpdate: now,
            };
          }
        }
        newActiveCreatures.set(id, updated);
      }
    }

    // Build canonical names list for OCR matching
    // Strategy: 
    // 1. PRIMARY: Targeting list (full, correct names - best for matching mangled OCR)
    // 2. SECONDARY: Battle list (for "Others" wildcard - creatures not in targeting list)
    // Remove "Others" wildcard and duplicates
    
    const explicitTargetNames = targetingList
      .filter((rule) => rule.name.toLowerCase() !== 'others')
      .map((rule) => rule.name);
    
    const battleListNames = battleListEntries.map(e => e.name);
    
    // Targeting list FIRST (full names, better fuzzy matching)
    // Then battle list (for creatures not in targeting, i.e., "Others" case)
    const canonicalNames = [...new Set([
      ...explicitTargetNames,    // PRIMARY: Full correct names from targeting
      ...battleListNames,        // SECONDARY: Battle list for "Others" wildcard
    ])];
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
          NAMEPLATE_ALLOWED_CHARS,
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
      
      // Pre-check name validation to prevent wrong creature taking over instanceId
      let preOcrName = null;
      if (bestMatch && oldCreature.name) {
        // Do OCR once for validation (will be reused below if match succeeds)
        preOcrName = await performOcrForHealthBar(bestMatch);
        
        // If OCR succeeds and names DON'T match, check if they're similar
        // Use fuzzy matching to handle OCR errors (missing chars, typos)
        if (preOcrName && !isSimilarName(preOcrName, oldCreature.name)) {
          // Names are completely different - this is probably a different creature
          logger('info', `[CREATURE REJECT] ID ${id} "${oldCreature.name}" rejected match - OCR read "${preOcrName}" (not similar)`);
          bestMatch = null;
        }
      }

      if (bestMatch) {
        let creatureName = null;
        // Check if we should use cached name or do fresh OCR
        const nameplateRegion = getNameplateRegion(bestMatch, gameWorld, tileSize);
        const marginH = Math.max(8, Math.floor((tileSize?.width || 32) * 0.3));
        const marginV = 6;
        const nameRegionDirty =
          dirtyRects.length > 0 &&
          nameplateRegion &&
          dirtyRects.some((r) => rectanglesIntersectWithMargin(nameplateRegion, r, marginH, marginV));
        const recentOcr = oldCreature.lastOcrAt && now - oldCreature.lastOcrAt < 1000;
        
        if (oldCreature.name && !nameRegionDirty && recentOcr) {
          // Use cached name
          creatureName = oldCreature.name;
        } else if (preOcrName) {
          // Reuse the OCR result from validation check above
          creatureName = preOcrName;
          oldCreature.lastOcrAt = now;
        } else {
          // Do fresh OCR (only happens if no validation was needed)
          creatureName = await performOcrForHealthBar(bestMatch);
          if (creatureName) oldCreature.lastOcrAt = now;
          if (!creatureName) {
            creatureName = oldCreature.name;
          } else if (oldCreature.name && creatureName !== oldCreature.name) {
            // Name changed! Validate against battle list before accepting
            const newNameInBattleList = battleListEntries.some(entry => {
              if (entry.name === creatureName) return true;
              // Handle truncated names
              if (entry.name.endsWith('...')) {
                const truncated = entry.name.slice(0, -3);
                return creatureName.startsWith(truncated);
              }
              return false;
            });
            
            // If new name NOT in battle list, it's probably OCR garbage from overlap
            // Keep the old name
            if (!newNameInBattleList) {
              creatureName = oldCreature.name;
            }
          }
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
          // Clear positionUncertain flag since we have a valid health bar detection
          if (updated.positionUncertain)
            delete updated.positionUncertain;
          newActiveCreatures.set(id, updated);
        }
        matchedHealthBars.add(bestMatch);
      } else {
        if (!oldCreature.flickerGracePeriodEndTime) {
          const isAdjacentStationary = (oldCreature.adjacentStationaryDuration || 0) > 100;
          const gracePeriod = isAdjacentStationary 
            ? STATIONARY_CREATURE_GRACE_PERIOD_MS 
            : CREATURE_FLICKER_GRACE_PERIOD_MS;
          oldCreature.flickerGracePeriodEndTime = now + gracePeriod;
        }
        if (now < oldCreature.flickerGracePeriodEndTime) {
          if (playerPositionChanged && oldCreature.gameCoords) {
            const expectedScreenPos = getAbsoluteGameWorldClickCoordinates(
              oldCreature.gameCoords.x,
              oldCreature.gameCoords.y,
              currentPlayerMinimapPosition,
              regions.gameWorld,
              regions.tileSize
            );
            if (expectedScreenPos) {
              oldCreature.absoluteCoords = {
                x: expectedScreenPos.x,
                y: expectedScreenPos.y,
                lastUpdate: now,
              };
            }
          }
          newActiveCreatures.set(id, oldCreature);
        }
      }
    }

    if (!skipHealthScan && healthBars.length > matchedHealthBars.size) {
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
          logger('info', `[CREATURE NEW] ${creatureName || 'unknown'} created with ID ${newId} at screen pos (${hb.x}, ${hb.y})`);
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
            // Ensure new creatures don't have positionUncertain flag
            if (newCreature.positionUncertain)
              delete newCreature.positionUncertain;
            newActiveCreatures.set(newId, newCreature);
          }
        }
      }
    }

    // Battle list based persistence and cleanup
    const currentBattleListCount = battleListEntries.length;
    const currentBattleListNames = new Map();
    for (const entry of battleListEntries) {
      currentBattleListNames.set(entry.name, (currentBattleListNames.get(entry.name) || 0) + 1);
    }
    
    // FIRST: Remove creatures that are NO LONGER in battle list at all (died/despawned)
    for (const [id, creature] of newActiveCreatures.entries()) {
      if (creature.name) {
        const stillInBattleList = currentBattleListNames.get(creature.name) > 0;
        if (!stillInBattleList) {
          // This creature is NOT in battle list anymore - it's dead!
          logger('info', `[CREATURE REMOVED] ID ${id} "${creature.name}" - not in battle list (died/despawned)`);
          newActiveCreatures.delete(id);
        }
      }
    }
    
    // SECOND: If battle list is stable (same count), keep creatures that might have lost health bars
    if (currentBattleListCount === lastBattleListCount && currentBattleListCount > 0) {
      // Check if any OLD creatures should be kept alive because battle list still shows them
      for (const [id, oldCreature] of activeCreatures.entries()) {
        if (!newActiveCreatures.has(id) && oldCreature.name) {
          // This creature lost its health bar detection
          const battleListCountForName = currentBattleListNames.get(oldCreature.name) || 0;
          const detectedCountForName = Array.from(newActiveCreatures.values())
            .filter(c => c.name === oldCreature.name).length;
          
          // If battle list shows MORE of this creature than we detected, keep the old one
          if (battleListCountForName > detectedCountForName) {
            // Keep creature alive but mark position as uncertain
            oldCreature.lastSeen = now;
            oldCreature.positionUncertain = true;
            newActiveCreatures.set(id, oldCreature);
          }
        }
      }
    }
    
    activeCreatures = newActiveCreatures;
    lastBattleListCount = currentBattleListCount;
    battleListCreatureNames = currentBattleListNames;

    // Update lastBarAreas for next-frame proximity checks
    if (!skipHealthScan && Array.isArray(healthBars)) {
      lastBarAreas = healthBars.map((hb) => ({
        x: hb.x - (tileSize?.width || 32),
        y: hb.y - 20,
        width: (tileSize?.width || 32) * 2,
        height: 40,
      }));
    }

    let detectedEntities = Array.from(activeCreatures.values());
    const blockingCreatures = new Set();

    
    const cavebotTargetWpt = sabStateManager.getCavebotTargetWaypoint();
    
    // Check if we have a valid waypoint (coordinates are not zero/null)
    const hasValidWaypoint = cavebotTargetWpt && (cavebotTargetWpt.x !== 0 || cavebotTargetWpt.y !== 0);
    
    if (hasValidWaypoint) {
      const blockingCavebotCreature = pathfinderInstance.getBlockingCreature(
        currentPlayerMinimapPosition,
        cavebotTargetWpt,
        detectedEntities.map((c) => c.gameCoords),
      );
      if (blockingCavebotCreature) {
        const blocker = detectedEntities.find(
          (c) =>
            c.gameCoords.x === blockingCavebotCreature.x &&
            c.gameCoords.y === blockingCavebotCreature.y &&
            c.gameCoords.z === blockingCavebotCreature.z,
        );
        if (blocker) {
          blockingCreatures.add(blocker.instanceId);
        }
      }
    }

    
    const primaryTargets = detectedEntities.filter((entity) => {
      const rule = targetingList.find((r) => r.name === entity.name);
      return rule && !rule.onlyIfTrapped && entity.isReachable;
    });

    for (const primaryTarget of primaryTargets) {
      const blockingTargetCreature = pathfinderInstance.getBlockingCreature(
        currentPlayerMinimapPosition,
        primaryTarget.gameCoords,
        detectedEntities.map((c) => c.gameCoords),
      );
      if (blockingTargetCreature) {
        const blocker = detectedEntities.find(
          (c) =>
            c.gameCoords.x === blockingTargetCreature.x &&
            c.gameCoords.y === blockingTargetCreature.y &&
            c.gameCoords.z === blockingTargetCreature.z,
        );
        if (blocker) {
          blockingCreatures.add(blocker.instanceId);
        }
      }
    }

    if (detectedEntities.length > 0) {
      const allCreaturePositions = detectedEntities.map((c) => c.gameCoords);
      const screenBounds = {
        minX: currentPlayerMinimapPosition.x - 7,
        maxX: currentPlayerMinimapPosition.x + 7,
        minY: currentPlayerMinimapPosition.y - 5,
        maxY: currentPlayerMinimapPosition.y + 5,
      };
      const reachableSig = `${currentPlayerMinimapPosition.x},${currentPlayerMinimapPosition.y},${currentPlayerMinimapPosition.z}|${screenBounds.minX},${screenBounds.maxX},${screenBounds.minY},${screenBounds.maxY}|${allCreaturePositions.map((p)=>p?`${p.x},${p.y},${p.z}`:'0,0,0').join(';')}`;
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
        // Force creatures with uncertain positions to be unreachable
        const isReachable = entity.positionUncertain 
          ? false 
          : typeof reachableTiles[coordsKey] !== 'undefined';
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
        const isBlockingPath = blockingCreatures.has(entity.instanceId);
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
      let didScanTarget = false;
      let targetRect = null;
      const needsTargetScan =
        intersectsGameWorld ||
        playerPositionChanged ||
        creaturesChanged ||
        now - lastTargetScanTime >= TARGET_SCAN_FALLBACK_MS;

      if (needsTargetScan) {
        let targetScanArea = null;
        if (dirtyRects.length > 0) {
          const margin = Math.max(8, Math.floor((tileSize?.width || 32) * 0.5));
          const dirtyUnion = unionRect(dirtyRects, margin);
          if (dirtyUnion) targetScanArea = intersectRects(dirtyUnion, gameWorld);
        }
        targetRect = await findTarget.findTarget(
          sharedBufferView,
          targetScanArea || gameWorld,
        );
        didScanTarget = true;
        lastTargetScanTime = now;
      }
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

    
    
    let battleListTargetName = null;
    if (battleListRegion) {
      // Check for target marker colors (only when actually TARGETED, not just hovered):
      // [255, 0, 0] - targeted, [255, 128, 128] - targeted+hovered
      // Note: We do NOT check white [255, 255, 255] because that's hover-only, not targeted
      const targetColors = [
        [255, 0, 0],     // Pure targeted (red)
        [255, 128, 128], // Targeted + hovered (light red)
      ];
      
      const sequences = {};
      for (let i = 0; i < targetColors.length; i++) {
        sequences[`target_bar_${i}`] = {
          sequence: new Array(5).fill(targetColors[i]),
          direction: 'vertical'
        };
      }
      
      const result = await findSequences.findSequencesNative(
        sharedBufferView,
        sequences,
        battleListRegion,
      );
      
      // Check if any of the target colors were found
      let markerY = null;
      for (const key in result) {
        if (result[key]) {
          markerY = result[key].y;
          break; // Use first match found
        }
      }
      
      if (markerY !== null) {
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
          battleListTargetName = closestEntry.name;
        }
      }
    }

    
    if (gameWorldTarget && battleListTargetName) {
      // Use gameWorldTarget (OCR'd name is full), keep it instead of truncated battle list name
      unifiedTarget = gameWorldTarget;
    } else if (gameWorldTarget && !battleListTargetName) {
      
      
      
      unifiedTarget = gameWorldTarget;
    } else if (!gameWorldTarget && battleListTargetName) {
      
      // Try to find matching creature using truncated name matching
      const matchingCreature = detectedEntities.find((c) => {
        if (c.name === battleListTargetName) return true;
        // Check if battle list entry is truncated (ends with ...)
        if (battleListTargetName.endsWith('...')) {
          const truncatedPart = battleListTargetName.slice(0, -3);
          return c.name && c.name.startsWith(truncatedPart);
        }
        return false;
      });
      if (matchingCreature) {
        unifiedTarget = {
          instanceId: matchingCreature.instanceId,
          name: matchingCreature.name || null,
          hp: matchingCreature.hp || null,
          distance: parseFloat(matchingCreature.distance.toFixed(1)),
          gameCoordinates: matchingCreature.gameCoords,
          isReachable: matchingCreature.isReachable,
        };
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

    
    
    const detectedCreatureNames = new Set(detectedEntities.map(c => c.name));
    const sanitizedBattleList = battleListEntries.filter(entry => detectedCreatureNames.has(entry.name));

    if (sanitizedBattleList.length < battleListEntries.length) {
        logger('debug', `[CreatureMonitor] Sanitized battle list. Removed ${battleListEntries.length - sanitizedBattleList.length} ghost entries.`);
    }

    // Write to unified SAB (batch write for atomicity)
    // Convert null target to empty object (instanceId: 0 means no target)
    if (sabInterface) {
      try {
        const sabTarget = unifiedTarget ? {
          instanceId: unifiedTarget.instanceId || 0,
          x: unifiedTarget.gameCoordinates?.x || 0,
          y: unifiedTarget.gameCoordinates?.y || 0,
          z: unifiedTarget.gameCoordinates?.z || 0,
          distance: Math.round((unifiedTarget.distance || 0) * 100),
          isReachable: unifiedTarget.isReachable ? 1 : 0,
          name: unifiedTarget.name || '',
        } : { 
          instanceId: 0, 
          x: 0, 
          y: 0, 
          z: 0, 
          distance: 0, 
          isReachable: 0, 
          name: '' 
        };
        
        // Map creatures to SAB format
        const sabCreatures = detectedEntities.slice(0, 50).map(c => ({
          instanceId: c.instanceId || 0,
          x: c.gameCoords?.x || 0,
          y: c.gameCoords?.y || 0,
          z: c.gameCoords?.z || 0,
          absoluteX: Math.round(c.absoluteCoords?.x || 0),
          absoluteY: Math.round(c.absoluteCoords?.y || 0),
          isReachable: c.isReachable ? 1 : 0,
          isAdjacent: c.isAdjacent ? 1 : 0,
          isBlockingPath: c.isBlockingPath ? 1 : 0,
          distance: Math.round((c.distance || 0) * 100),
          hp: typeof c.hp === 'string' ? 0 : (c.hp || 0), // TODO: proper hp encoding
          name: c.name || '',
        }));
        
        // Map battle list to SAB format
        const sabBattleList = sanitizedBattleList.slice(0, 50).map(b => ({
          name: b.name || '',
          x: b.x || 0,
          y: b.y || 0,
          isTarget: b.isTarget ? 1 : 0,
        }));
        
        sabInterface.batch({
          creatures: sabCreatures,
          battleList: sabBattleList,
          target: sabTarget,
        });
      } catch (err) {
        logger('error', `[CreatureMonitor] Failed to write to unified SAB: ${err.message}`);
      }
    }

    // Legacy SAB support (keep for targeting worker compatibility)
    sabStateManager.writeWorldState({
      creatures: detectedEntities,
      target: unifiedTarget,
      battleList: sanitizedBattleList,
    });

    sabStateManager.writeCreatureMonitorLastProcessedZ(zLevelAtScanStart);

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
    }
    performOperation();
  } catch (e) {
    logger('error', '[CreatureMonitor] Error handling message:', e);
  }
});

