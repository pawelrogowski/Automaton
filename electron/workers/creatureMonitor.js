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
import {
  getGameCoordinatesFromScreen,
  getAbsoluteGameWorldClickCoordinates,
} from '../utils/gameWorldClickTranslator.js';
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

const PLAYER_ANIMATION_FREEZE_MS = 25;
const STICKY_SNAP_THRESHOLD_TILES = 0.5;
const JITTER_CONFIRMATION_TIME_MS = 75;
const CORRELATION_DISTANCE_THRESHOLD_PIXELS = 200;
const TARGET_LOSS_GRACE_PERIOD_MS = 125;
const CREATURE_FLICKER_GRACE_PERIOD_MS = 125;
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
    const zLevelAtScanStart = Atomics.load(playerPosArray, PLAYER_Z_INDEX);

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
      newActiveCreatures = new Map(activeCreatures);
    }

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
        let creatureName = null;
        // Only OCR if the nameplate region is actually dirty; otherwise reuse cached name
        const nameplateRegion = getNameplateRegion(bestMatch, gameWorld, tileSize);
        const marginH = Math.max(8, Math.floor((tileSize?.width || 32) * 0.3));
        const marginV = 6;
        const nameRegionDirty =
          dirtyRects.length > 0 &&
          nameplateRegion &&
          dirtyRects.some((r) => rectanglesIntersectWithMargin(nameplateRegion, r, marginH, marginV));
        const recentOcr = oldCreature.lastOcrAt && now - oldCreature.lastOcrAt < 1000;
        if (oldCreature.name && !nameRegionDirty && recentOcr) {
          creatureName = oldCreature.name;
        } else {
          creatureName = await performOcrForHealthBar(bestMatch);
          if (creatureName) oldCreature.lastOcrAt = now;
          if (!creatureName) {
            creatureName = oldCreature.name;
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
          newActiveCreatures.set(id, updated);
        }
        matchedHealthBars.add(bestMatch);
      } else {
        if (!oldCreature.flickerGracePeriodEndTime) {
          oldCreature.flickerGracePeriodEndTime =
            now + CREATURE_FLICKER_GRACE_PERIOD_MS;
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
    if (cavebotTargetWpt) {
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
          battleListTargetName = closestEntry.name;
        }
      }
    }

    
    if (gameWorldTarget && battleListTargetName) {
      
      unifiedTarget = { ...gameWorldTarget, name: battleListTargetName };
    } else if (gameWorldTarget && !battleListTargetName) {
      
      
      
      unifiedTarget = gameWorldTarget;
    } else if (!gameWorldTarget && battleListTargetName) {
      
      
      const matchingCreature = detectedEntities.find(
        (c) => c.name === battleListTargetName,
      );
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

