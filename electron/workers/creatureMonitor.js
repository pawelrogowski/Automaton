// ---- FILE: workers/creatureMonitor.js ----
/**
 * Full drop-in replacement for creatureMonitor.js
 * - Preserves original architecture and logic
 * - Fixes name matching argument order and lowers thresholds for OCR noise
 * - Ensures OCR names are matched against both targeting and battle list canonical names
 * - Prefers canonical matched names when available (fixes "wamp Troll" -> "Swamp Troll")
 */
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
  PLAYER_SCREEN_TILE_X,
  PLAYER_SCREEN_TILE_Y,
} from '../utils/gameWorldClickTranslator.js';
import { FrameUpdateManager } from '../utils/frameUpdateManager.js';
import {
  findBestNameMatch,
  getSimilarityScore,
  isBattleListMatch,
} from '../utils/nameMatcher.js';
import { processPlayerList, processNpcList } from './creatureMonitor/ocr.js';

const logger = createLogger({ info: false, error: true, debug: false });

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

const { imageSAB } = sharedData;

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

// Worker configuration - loaded from SAB (synced from Redux)
let config = {
  PLAYER_ANIMATION_FREEZE_MS: 25,
  STICKY_SNAP_THRESHOLD_TILES: 0.5,
  JITTER_CONFIRMATION_TIME_MS: 75,
  CORRELATION_DISTANCE_THRESHOLD_PIXELS: 200,
  CREATURE_GRACE_PERIOD_MS: 250,
  UNMATCHED_BLACKLIST_MS: 500,
  NAME_MATCH_THRESHOLD: 0.4,
};

// Load config from SAB on startup and on config updates
function loadConfigFromSAB() {
  try {
    const result = sabInterface.get('creatureMonitorConfig');
    if (result && result.data) {
      config.PLAYER_ANIMATION_FREEZE_MS =
        result.data.PLAYER_ANIMATION_FREEZE_MS ?? 25;
      config.STICKY_SNAP_THRESHOLD_TILES =
        (result.data.STICKY_SNAP_THRESHOLD_TILES ?? 50) / 100;
      config.JITTER_CONFIRMATION_TIME_MS =
        result.data.JITTER_CONFIRMATION_TIME_MS ?? 75;
      config.CORRELATION_DISTANCE_THRESHOLD_PIXELS =
        result.data.CORRELATION_DISTANCE_THRESHOLD_PIXELS ?? 200;
      config.CREATURE_GRACE_PERIOD_MS =
        result.data.CREATURE_GRACE_PERIOD_MS ?? 250;
      config.UNMATCHED_BLACKLIST_MS = result.data.UNMATCHED_BLACKLIST_MS ?? 500;
      config.NAME_MATCH_THRESHOLD =
        (result.data.NAME_MATCH_THRESHOLD ?? 40) / 100;
    }
  } catch (err) {
    // Silent fallback to defaults
  }
}

let currentState = null;
let isInitialized = false;
let isShuttingDown = false;
let lastSentCreatures = [];
let lastSentTarget = null;
let lastBattleListEntries = [];
let lastPlayerNames = [];
let lastNpcNames = [];
let lastSentHealthBars = [];
let nextInstanceId = 1;
let activeCreatures = new Map();
const lastPostedResults = new Map();
let previousTargetName = null;
let isLootingInProgress = false;
let previousPlayerMinimapPosition = { x: 0, y: 0, z: 0 };
let playerAnimationFreezeEndTime = 0;
let lastStablePlayerMinimapPosition = { x: 0, y: 0, z: 0 };
let lastBattleListOcrTime = 0;
let lastFrameHealthBars = [];
let lastReachableSig = null;
let lastReachableTiles = null;
let regionsStale = false;

// Cached health bar state to avoid redundant native calls
let lastHealthBarsRaw = [];
let lastHealthBarsForReporting = [];
let lastHealthBarsUpdateTime = 0;
// Track last confirmed reachability status per creature to prevent flickering
// Map: instanceId -> { isReachable: boolean, confirmedAt: timestamp }
const reachabilityStableState = new Map();
const REACHABILITY_DEBOUNCE_MS = 150; // Require 150ms of consistent state before changing
let lastRequestedRegionsVersion = -1;
let lastHealthScanTime = 0;

// Track creatures that lost health bar detection for redetection timing
// Map: instanceId -> { name, lostAt, battleListName, lastSeenAt }
const missingHealthBarTracking = new Map();

// Blacklist for tiles with healthbars we explicitly choose to ignore.
// This prevents those tiles from generating creatures and avoids matching
// their healthbar pixels to other creatures for a short time.
let blacklistedTiles = new Set();
let blacklistedUntil = new Map();

// Debug logging helper
let lastDebugLogPayload = '';
function logDetectionSummary(data) {
  try {
    const dedup = (arr) => [...new Set(arr.filter(Boolean))];
    const fmt = (arr) =>
      `[${dedup(arr)
        .map((s) => `"${s}"`)
        .join(',')}]`;
    const payload =
      `battleListItems: ${data.battleListItemNumber}, ` +
      `healthBars: ${data.healthBarNumber}, ` +
      `players: ${data.playerListNumber}, ` +
      `npcs: ${data.npcListNumber}, ` +
      `battleListMatched: ${data.battleListMatchedNameNumber}, ` +
      `gameWorldMatched: ${data.gameWorldMatchedNameNumber}, ` +
      `battleListMatchedNames: ${fmt(data.battleListMatchedNames)}, ` +
      `gameWorldMatchedNames: ${fmt(data.gameWorldMatchedNames)}, ` +
      `unmatchedBattleListNames: ${fmt(data.unmatchedBattleListNames)}, ` +
      `unmatchedGameWorldNames: ${fmt(data.unmatchedGameWorldNames)}`;
    if (payload !== lastDebugLogPayload) {
      lastDebugLogPayload = payload;
    }
  } catch (_) {}
}

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

  // Helper to sanitize OCR'd battle list names:
  // - convert unicode ellipsis to dots
  // - trim trailing dots / ellipsis
  // - split camelCase like "MuglexClan" -> "Muglex Clan"
  // - remove non-letter characters but keep spaces
  const sanitizeBattleListName = (raw) => {
    if (!raw) return '';
    let s = String(raw).trim();
    // Normalize unicode ellipsis character to three dots
    s = s.replace(/\u2026/g, '...');
    // Check if truncated (has ellipsis) before removing it
    const wasTruncated = s.endsWith('...');
    // Remove trailing sequences of dots (including "...")
    s = s.replace(/\.{1,}$/g, '').trim();
    // Break camelCase (e.g. "MuglexClan" -> "Muglex Clan")
    s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
    // Remove any remaining characters that are not letters or spaces
    s = s.replace(/[^a-zA-Z\s]/g, '');
    // Collapse multiple spaces
    s = s.replace(/\s+/g, ' ').trim();
    return { name: s, wasTruncated };
  };

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
        const trimmedName = (result.text || '').trim();
        const fixedName = trimmedName.replace(/([a-z])([A-Z])/g, '$1 $2');
        const { name, wasTruncated } = sanitizeBattleListName(fixedName);
        return {
          name,
          isTruncated: wasTruncated,
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

/**
 * Matches battle list entries to targeting list canonical names.
 * Returns a map of { battleListName -> canonicalTargetingName }
 *
 * - Complete (non-truncated) names: EXACT match only (case-insensitive)
 * - Truncated names: Fuzzy match allowed
 */
function matchBattleListToTargeting(battleListEntries, targetingList) {
  const result = new Map();
  const explicitTargetNames = targetingList
    .filter((rule) => rule && rule.name && rule.name.toLowerCase() !== 'others')
    .map((rule) => rule.name);

  for (const entry of battleListEntries) {
    if (!entry.name) continue;

    const blName = entry.name;
    const blLower = blName.toLowerCase();

    if (entry.isTruncated) {
      // Truncated: allow fuzzy matching
      const fuzzyMatch = findBestNameMatch(blName, explicitTargetNames, 0.3);
      if (fuzzyMatch) {
        result.set(blName, fuzzyMatch);
      } else {
        // No match found, keep original name
        result.set(blName, blName);
      }
    } else {
      // Complete name: EXACT match only (case-insensitive)
      const exactMatch = explicitTargetNames.find(
        (target) => target && target.toLowerCase() === blLower,
      );
      if (exactMatch) {
        result.set(blName, exactMatch);
      } else {
        // Not in targeting list, but keep it as valid battle list name
        result.set(blName, blName);
      }
    }
  }

  return result;
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
        distX < config.STICKY_SNAP_THRESHOLD_TILES &&
        distY < config.STICKY_SNAP_THRESHOLD_TILES
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
          config.JITTER_CONFIRMATION_TIME_MS
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
  // Generate stable instanceKey for sync
  const normalizedName = (detection.name || creature.name || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  creature.instanceKey = normalizedName
    ? `${creature.gameCoords.x}-${creature.gameCoords.y}-${creature.gameCoords.z}-${normalizedName}`
    : creature.instanceId.toString();
  logger(
    'debug',
    `[CREATURE] Assigned key ${creature.instanceKey} for ${creature.name || 'unknown'}`,
  );
  creature.distance = chebyshevDistance(
    currentPlayerMinimapPosition,
    creature.gameCoords,
  );
  creature.lastSeen = now;
  creature.disappearedAt = null; // Reset grace period timer on successful update
  if (detection.name) creature.name = detection.name;
  if (detection.hp) creature.hp = detection.hp;

  return creature;
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

    // NEW: Fetch red-box (targeted creature) position from SAB for priority matching
    let redBoxPosition = null;
    let previousTargetInstanceId = null;
    if (sabInterface) {
      try {
        const targetResult = sabInterface.get('currentTarget');
        if (
          targetResult &&
          targetResult.data &&
          targetResult.data.screenX &&
          targetResult.data.screenY
        ) {
          redBoxPosition = {
            x: targetResult.data.screenX,
            y: targetResult.data.screenY,
          };
          previousTargetInstanceId = targetResult.data.instanceId || null; // Assume SAB provides instanceId if available
        }
      } catch (err) {
        // Silently fail if no target data
      }
    }

    const playerPositionChanged = !arePositionsEqual(
      currentPlayerMinimapPosition,
      previousPlayerMinimapPosition,
    );

    if (playerPositionChanged) {
      playerAnimationFreezeEndTime = now + config.PLAYER_ANIMATION_FREEZE_MS;
      lastStablePlayerMinimapPosition = { ...currentPlayerMinimapPosition };
    }
    previousPlayerMinimapPosition = { ...currentPlayerMinimapPosition };
    const isPlayerInAnimationFreeze = now < playerAnimationFreezeEndTime;

    const dirtyRects = [...frameUpdateManager.accumulatedDirtyRects];
    frameUpdateManager.accumulatedDirtyRects.length = 0;

    // ===== PHASE 1: Read targeting configuration from SAB =====
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

    // ENHANCED: Fetch red-box details for forced ID preservation (after dirtyRects)
    let redBoxInfo = null;
    if (sabInterface) {
      try {
        const targetSAB = sabInterface.get('currentTarget');
        if (targetSAB && targetSAB.data) {
          redBoxInfo = {
            instanceKey:
              targetSAB.data.instanceKey || lastSentTarget?.instanceKey || null,
            screenPos: { x: targetSAB.data.screenX, y: targetSAB.data.screenY },
            name: lastSentTarget?.name || '',
          };
        }
      } catch (err) {
        logger('warn', `[CREATURE] Red-box fetch failed: ${err.message}`);
      }
    }

    // ===== PHASE 2: OCR battle list =====
    let battleListEntries = lastBattleListEntries;

    // Only OCR battle list if it actually changed (dirty rect intersection)
    if (dirtyRects.length > 0) {
      if (
        regions.battleList &&
        dirtyRects.some((r) => rectsIntersect(r, regions.battleList))
      ) {
        battleListEntries = await processBattleListOcr(
          sharedBufferView,
          regions,
        );
        lastBattleListOcrTime = now;

        // Post-process battle list entries:
        // 1) Ensure names are sanitized (remove trailing '...' or unicode ellipsis and non-letters).
        // 2) Keep original OCR names to ensure matching with creatures (for 'others' rule)
        try {
          battleListEntries = (battleListEntries || []).map((entry) => {
            if (!entry || !entry.name) return entry;
            let name = String(entry.name || '').trim();
            // Normalize unicode ellipsis and remove trailing dots/ellipsis
            name = name
              .replace(/\u2026/g, '...')
              .replace(/\.{1,}$/g, '')
              .trim();
            if (name.endsWith('...')) name = name.slice(0, -3).trim();

            // Collapse multiple spaces
            name = name.replace(/\s+/g, ' ').trim();

            // Keep original OCR name - don't rename to canonical targeting names
            // This ensures battle list names match creature names for 'others' rule
            return {
              ...entry,
              name: name,
            };
          });
        } catch (e) {
          // If anything goes wrong here, keep original OCR results (sanitized by processBattleListOcr)
        }
      }
    }

    // ===== PHASE 3: OCR player/NPC lists =====
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

    // Auto-looting trigger when battle list shrinks
    if (
      targetingEnabled &&
      !isLootingInProgress &&
      lastBattleListEntries.length > battleListEntries.length
    ) {
      const hadTargetable = lastBattleListEntries.some((entry) =>
        targetingList.some((rule) => isBattleListMatch(rule.name, entry.name)),
      );

      if (hadTargetable) {
        await performImmediateLooting();
      }
    }

    lastBattleListEntries = battleListEntries;
    lastPlayerNames = playerNames;
    lastNpcNames = npcNames;

    // Track battleList selection via target bar detection
    let battleListTargetIndex = -1;
    if (
      battleListRegion &&
      dirtyRects.length > 0 &&
      dirtyRects.some((r) => rectsIntersect(r, battleListRegion))
    ) {
      const targetColors = [
        [255, 0, 0],
        [255, 128, 128],
      ];
      const sequences = {};
      for (let i = 0; i < targetColors.length; i++) {
        sequences[`target_bar_${i}`] = {
          sequence: new Array(5).fill(targetColors[i]),
          direction: 'vertical',
        };
      }
      try {
        const result = await findSequences.findSequencesNative(
          sharedBufferView,
          sequences,
          battleListRegion,
        );
        let markerY = null;
        for (const key in result) {
          if (result[key]) {
            markerY = result[key].y;
            break;
          }
        }
        if (markerY !== null) {
          let minDistance = Infinity;
          for (let i = 0; i < battleListEntries.length; i++) {
            const entry = battleListEntries[i];
            const distance = Math.abs(entry.y - markerY);
            if (distance < minDistance) {
              minDistance = distance;
              battleListTargetIndex = i;
            }
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

    // ===== PHASE 4: Detect health bars and OCR nameplates =====
    // Single-call, dirty-rect and entity-gated health bar detection.
    const constrainedGameWorld = {
      ...gameWorld,
      y: gameWorld.y + 14,
      height: Math.max(0, gameWorld.height - 28),
    };

    const hasDirtyRects = dirtyRects.length > 0;
    const healthBarsGameWorldChanged =
      hasDirtyRects && dirtyRects.some((r) => rectsIntersect(r, gameWorld));

    // Determine if there are any relevant entities that justify scanning:
    // - battleListEntries (monsters)
    // - playerNames (players that could have bars / interactions)
    // NOTE: npcNames is intentionally not used as a hard gate to avoid coupling
    // health bar presence strictly to NPC OCR.
    const hasRelevantEntities =
      battleListEntries.length > 0 || playerNames.length > 0;

    let healthBarsRaw = lastHealthBarsRaw || [];

    // Only rescan health bars when:
    // - We have relevant entities (BL or players), AND
    // - The game world actually changed (dirty rects), OR
    // - We have no cached result yet.
    if (
      hasRelevantEntities &&
      (healthBarsGameWorldChanged ||
        !healthBarsRaw ||
        healthBarsRaw.length === 0)
    ) {
      healthBarsRaw = await findHealthBars.findHealthBars(
        sharedBufferView,
        gameWorld,
      );
      lastHealthBarsRaw = healthBarsRaw;
      lastHealthBarsUpdateTime = now;
      lastHealthScanTime = now;
    }

    // Build reporting view (all tiles with health bars except player tile)
    let healthBarsForReporting;
    if (healthBarsRaw && healthBarsRaw.length > 0) {
      const allHealthBarTiles = [];
      for (const hb of healthBarsRaw) {
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
          // Exclude player tile from reporting (matches existing behavior)
          if (
            roundedX !== currentPlayerMinimapPosition.x ||
            roundedY !== currentPlayerMinimapPosition.y ||
            roundedZ !== currentPlayerMinimapPosition.z
          ) {
            allHealthBarTiles.push({
              x: roundedX,
              y: roundedY,
              z: roundedZ,
            });
          }
        }
      }
      healthBarsForReporting = allHealthBarTiles.slice(0, 200);
    } else {
      healthBarsForReporting = lastHealthBarsForReporting || [];
    }
    lastHealthBarsForReporting = healthBarsForReporting;

    // Derive constrained healthBars for creature detection logic from the single scan:
    // - Only bars within constrainedGameWorld
    // - Player bar will be removed in the existing filtering step below
    let healthBars = (healthBarsRaw || []).filter((hb) => {
      return (
        hb.x >= constrainedGameWorld.x &&
        hb.x < constrainedGameWorld.x + constrainedGameWorld.width &&
        hb.y >= constrainedGameWorld.y &&
        hb.y < constrainedGameWorld.y + constrainedGameWorld.height
      );
    });

    const hasEntities =
      battleListEntries.length > 0 ||
      playerNames.length > 0 ||
      npcNames.length > 0;

    // Gracefully clear active creatures only when none present and grace expired
    if (!hasEntities && activeCreatures.size > 0) {
      let allExpired = true;
      for (const creature of activeCreatures.values()) {
        if (!creature.disappearedAt) {
          creature.disappearedAt = now;
        }
        if (now - creature.disappearedAt < config.CREATURE_GRACE_PERIOD_MS) {
          allExpired = false;
        }
      }
      if (allExpired) {
        activeCreatures.clear();
        // Clear reachability stable state when all creatures are gone
        reachabilityStableState.clear();
      }
    }

    if (!hasEntities && activeCreatures.size === 0) {
      if (lastSentCreatures.length > 0 || lastSentTarget !== null || lastSentHealthBars.length > 0) {
        lastSentCreatures = [];
        lastSentTarget = null;
        lastSentHealthBars = healthBarsForReporting;

        if (sabInterface) {
          try {
            sabInterface.setMany({
              creatures: [],
              target: {
                instanceId: 0,
                x: 0,
                y: 0,
                z: 0,
                distance: 0,
                isReachable: 0,
                name: '',
              },
              battleList: [],
              healthBars: healthBarsForReporting,
            });
          } catch (err) {}
        }

        postUpdateOnce('targeting/setEntities', { creatures: [], duration: 0 });
        postUpdateOnce('targeting/setTarget', null);
        postUpdateOnce('targeting/setHealthBars', healthBarsForReporting);
      }
      // Always ensure health bars are updated in clearing case
      const healthBarsString = JSON.stringify(healthBarsForReporting);
      if (healthBarsString !== lastPostedResults.get('targeting/setHealthBars')) {
        lastPostedResults.set('targeting/setHealthBars', healthBarsString);
        parentPort.postMessage({ storeUpdate: true, type: 'targeting/setHealthBars', payload: healthBarsForReporting });
        lastSentHealthBars = healthBarsForReporting;
      }
      if (sabInterface) {
        try {
          sabInterface.set('healthBars', healthBarsForReporting);
        } catch (err) {}
      }
      postUpdateOnce('battleList/setBattleListEntries', battleListEntries);
      postUpdateOnce('uiValues/setPlayers', playerNames);
      postUpdateOnce('uiValues/setNpcs', npcNames);
      previousTargetName = null;
      return;
    }

    // Filter player's own health bar for creature detection logic
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
        if (
          roundedX === currentPlayerMinimapPosition.x &&
          roundedY === currentPlayerMinimapPosition.y &&
          roundedZ === currentPlayerMinimapPosition.z
        ) {
          playerHealthBarsToRemove.push(hb);
        }
      }
    }
    if (playerHealthBarsToRemove.length > 0) {
      healthBars = healthBars.filter(
        (hb) => !playerHealthBarsToRemove.includes(hb),
      );
    }

    // Debug count mismatch
    const battleListCount = battleListEntries.length;
    const gameWorldHealthBarCount = healthBars.length;

    // ===== NEW CREATURE DETECTION PIPELINE =====
    // This pipeline ensures creatures are only detected if they appear in the battle list,
    // preventing false matches like "Rabbit" being matched to "Bat" from targeting list.
    //
    // PIPELINE STEPS:
    // 1. Battle list OCR (already done above) - detects truncation ("...")
    // 2. Match battle list → targeting list:
    //    - Complete names: EXACT match only (case-insensitive)
    //    - Truncated names: Fuzzy match allowed
    // 3. Match game world nameplates → battle list names (NOT targeting list)
    // 4. Use battle list → targeting mapping to get canonical names
    // 5. Only report creatures that exist in battle list
    //
    // This creates a map of { battleListName -> canonicalTargetingName }
    const battleListToTargeting = matchBattleListToTargeting(
      battleListEntries,
      targetingList,
    );

    // All valid battle list names (both matched and unmatched to targeting)
    const allValidBattleListNames = Array.from(battleListToTargeting.keys());

    // All canonical names (from targeting) that were matched
    const matchedCanonicalNames = new Set(
      Array.from(battleListToTargeting.values()),
    );

    // Helper: perform OCR for nameplate for a given healthbar
    const getRawOcrForHealthBar = (hb) => {
      const ocrRegion = getNameplateRegion(hb, gameWorld, tileSize);
      if (!ocrRegion) return null;
      try {
        const results =
          recognizeText(
            sharedBufferView,
            ocrRegion,
            regionDefinitions.gameWorld?.ocrColors || [],
            NAMEPLATE_ALLOWED_CHARS,
          ) || [];
        return results.length > 0
          ? results[0].text.trim().replace(/([a-z])([A-Z])/g, '$1 $2')
          : null;
      } catch (e) {
        return null;
      }
    };

    // ===== PHASE 5: Multi-factor matching and tracking =====
    let newActiveCreatures = new Map();
    const playerPosForCalc = isPlayerInAnimationFreeze
      ? lastStablePlayerMinimapPosition
      : currentPlayerMinimapPosition;

    // Expire any stale blacklisted tile entries
    for (const [k, until] of blacklistedUntil.entries()) {
      if (until <= now) {
        blacklistedUntil.delete(k);
        blacklistedTiles.delete(k);
      }
    }

    // NEW PIPELINE STEP 3: Build detections by matching nameplates to battle list
    // Only health bars whose nameplate matches a battle list entry are kept
    // We match against the processed battle list names (post-sanitization)

    const detections = [];
    for (const hb of healthBars) {
      const creatureScreenX = hb.x;
      const creatureScreenY = hb.y + 14 + tileSize.height / 2;
      const gameCoords = getGameCoordinatesFromScreen(
        creatureScreenX,
        creatureScreenY,
        playerPosForCalc,
        gameWorld,
        tileSize,
      );

      if (!gameCoords) continue;

      // Tile key used for blacklisting
      const tileKey = `${Math.round(gameCoords.x)},${Math.round(gameCoords.y)},${gameCoords.z}`;

      // Special handling for current target tile
      const isTargetTile =
        lastSentTarget &&
        lastSentTarget.gameCoordinates &&
        tileKey ===
          `${lastSentTarget.gameCoordinates.x},${lastSentTarget.gameCoordinates.y},${lastSentTarget.gameCoordinates.z}`;

      // Skip blacklisted tiles (except target tile)
      if (!isTargetTile && blacklistedTiles.has(tileKey)) continue;

      // Read nameplate OCR
      let ocrName = getRawOcrForHealthBar(hb);

      // For target tile, use last known name if OCR fails
      if (isTargetTile && (!ocrName || ocrName.length === 0)) {
        ocrName = lastSentTarget?.name || '';
      }

      // CRITICAL: Match nameplate OCR against battle list names ONLY
      // This prevents false matches like "Rabbit" -> "Bat" (from targeting list)
      let matchedBattleListName = null;

      if (ocrName && ocrName.length > 0) {
        const ocrLower = ocrName.toLowerCase();

        // Try exact match first (case-insensitive)
        matchedBattleListName = allValidBattleListNames.find(
          (blName) => blName && blName.toLowerCase() === ocrLower,
        );

        // If no exact match, try fuzzy matching against battle list only
        if (!matchedBattleListName) {
          matchedBattleListName = findBestNameMatch(
            ocrName,
            allValidBattleListNames,
            0.3,
          );
        }
      }

      // If nameplate doesn't match any battle list entry, blacklist and skip
      // Exception: always keep target tile even if match fails
      if (!matchedBattleListName && !isTargetTile) {
        blacklistedTiles.add(tileKey);
        blacklistedUntil.set(tileKey, now + config.UNMATCHED_BLACKLIST_MS);
        continue;
      }

      // Get canonical name from battle list -> targeting mapping
      // If not matched to targeting, use the battle list name itself
      const canonicalName = matchedBattleListName
        ? battleListToTargeting.get(matchedBattleListName) ||
          matchedBattleListName
        : lastSentTarget?.name || ocrName;

      detections.push({
        hb,
        ocrName,
        matchedBattleListName,
        canonicalName,
        gameCoords,
        isTargetTile: !!isTargetTile,
      });
    }

    // Scoring function — corrected argument order for similarity
    const calculateMatchScore = (creature, detection) => {
      if (!detection.gameCoords || !creature.gameCoords) {
        return -Infinity;
      }

      // Factor 0: Instance Continuity (HIGHEST PRIORITY)
      // Strongly prefer matching creatures to their previous tile positions
      // This prevents ID swaps for stationary adjacent creatures with identical names
      let continuityBonus = 0;
      if (creature.gameCoords) {
        const prevTileKey = `${creature.gameCoords.x},${creature.gameCoords.y},${creature.gameCoords.z}`;
        const detectionTileKey = `${Math.round(detection.gameCoords.x)},${Math.round(detection.gameCoords.y)},${detection.gameCoords.z}`;
        if (prevTileKey === detectionTileKey) {
          // Same tile as last frame - massive bonus to maintain ID continuity
          continuityBonus = 1000000;
        }
      }

      // Factor 1: Name Similarity (Highest Weight)
      // Allow OCR to be missing for the current target or its tile; otherwise require OCR.
      const isCurrentTargetCreature =
        !!lastSentTarget && creature.instanceId === lastSentTarget.instanceId;
      const isTargetTile = !!detection.isTargetTile;

      let nameScore = 0;
      if (detection.ocrName && detection.ocrName.length > 0) {
        nameScore = getSimilarityScore(detection.ocrName, creature.name);
      } else if (isCurrentTargetCreature || isTargetTile) {
        // Treat as minimally acceptable if this is the current target or on the target tile
        nameScore = config.NAME_MATCH_THRESHOLD;
      } else {
        return -Infinity; // Isolate other bars without OCR
      }
      if (
        nameScore < config.NAME_MATCH_THRESHOLD &&
        !(isCurrentTargetCreature || isTargetTile)
      ) {
        return -Infinity;
      }

      // Factor 2: Game Tile Distance
      const tileDist = chebyshevDistance(
        creature.gameCoords,
        detection.gameCoords,
      );
      if (tileDist > 2) {
        return -Infinity;
      }
      const gameCoordScore = (2 - tileDist) * 100;

      // Factor 3: Screen Pixel Distance
      const screenDistValue = screenDist(detection.hb, creature.absoluteCoords);
      if (screenDistValue > config.CORRELATION_DISTANCE_THRESHOLD_PIXELS) {
        return -Infinity;
      }
      const screenScore =
        config.CORRELATION_DISTANCE_THRESHOLD_PIXELS - screenDistValue;

      return continuityBonus + nameScore * 1000 + gameCoordScore + screenScore;
    };

    // Find potential matches between existing creatures and detections
    const potentialMatches = [];
    const creaturesToProcess = new Map(activeCreatures);

    for (const [id, creature] of creaturesToProcess.entries()) {
      for (const detection of detections) {
        const score = calculateMatchScore(creature, detection);
        if (score > -Infinity) {
          potentialMatches.push({ creatureId: id, creature, detection, score });
        }
      }
    }

    potentialMatches.sort((a, b) => b.score - a.score);

    const assignedCreatureIds = new Set();
    const assignedDetections = new Set();

    for (const match of potentialMatches) {
      if (
        !assignedCreatureIds.has(match.creatureId) &&
        !assignedDetections.has(match.detection)
      ) {
        const { creature, detection } = match;

        // Use the pre-computed canonical name from detection
        // This was already matched: nameplate -> battle list -> targeting
        const updatedDetection = {
          absoluteCoords: { x: detection.hb.x, y: detection.hb.y },
          healthBarY: detection.hb.y,
          // Use canonical name from pipeline, fallback to existing creature name
          name: detection.canonicalName || creature.name,
          hp: detection.hb.healthTag,
        };

        const updated = updateCreatureState(
          creature,
          updatedDetection,
          currentPlayerMinimapPosition,
          lastStablePlayerMinimapPosition,
          regions,
          tileSize,
          now,
          isPlayerInAnimationFreeze,
        );
        if (updated) {
          newActiveCreatures.set(match.creatureId, updated);
          assignedCreatureIds.add(match.creatureId);
          assignedDetections.add(detection);
        }
      }
    }

    // Unmatched detections: attempt to create new creatures
    const unmatchedDetections = detections.filter(
      (d) => !assignedDetections.has(d),
    );
    const allKnownSafeNames = new Set([...playerNames, ...npcNames]);

    for (const detection of unmatchedDetections) {
      // Only consider detections that aren't known safe names (players/npcs)
      if (!allKnownSafeNames.has(detection.ocrName || '')) {
        // Construct a tile key for occupancy checks
        if (!detection.gameCoords) continue;
        const tileKey = `${Math.round(detection.gameCoords.x)},${Math.round(detection.gameCoords.y)},${detection.gameCoords.z}`;

        // Skip if this tile is currently blacklisted
        if (blacklistedTiles.has(tileKey)) continue;

        // If tile already used by a newly-created creature, skip
        let tileIsOccupied = false;
        for (const c of newActiveCreatures.values()) {
          if (
            c.gameCoords &&
            detection.gameCoords &&
            arePositionsEqual(c.gameCoords, detection.gameCoords)
          ) {
            tileIsOccupied = true;
            break;
          }
        }
        if (tileIsOccupied) continue;

        // Detection already has canonical name from pipeline
        // (nameplate -> battle list -> targeting)
        const finalName = detection.canonicalName || 'Unknown';

        const newCreatureDetection = {
          absoluteCoords: { x: detection.hb.x, y: detection.hb.y },
          healthBarY: detection.hb.y,
          name: finalName,
          hp: detection.hb.healthTag,
        };

        const newId = nextInstanceId++;
        let newCreature = { instanceId: newId };

        newCreature = updateCreatureState(
          newCreature,
          newCreatureDetection,
          currentPlayerMinimapPosition,
          lastStablePlayerMinimapPosition,
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

    // Disappeared creatures: apply count-based logic + grace period
    const liveCounts = new Map();
    for (const creature of newActiveCreatures.values()) {
      liveCounts.set(creature.name, (liveCounts.get(creature.name) || 0) + 1);
    }

    const battleListCounts = new Map();
    const allKnownCreatureNames = new Set(
      Array.from(activeCreatures.values()).map((c) => c.name),
    );
    for (const name of allKnownCreatureNames) {
      const count = battleListEntries.filter((be) =>
        isBattleListMatch(name, be.name),
      ).length;
      battleListCounts.set(name, count);
    }

    for (const [id, creature] of activeCreatures.entries()) {
      if (newActiveCreatures.has(id)) {
        continue;
      }
      const name = creature.name;
      const liveCount = liveCounts.get(name) || 0;
      const expectedCount = battleListCounts.get(name) || 0;

      if (liveCount >= expectedCount) {
        // confirmed dead; do not re-add
      } else {
        if (!creature.disappearedAt) {
          creature.disappearedAt = now;
        }
        if (
          now - creature.disappearedAt <= config.CREATURE_GRACE_PERIOD_MS &&
          !assignedCreatureIds.has(id)
        ) {
          newActiveCreatures.set(id, creature);
        }
      }
    }

    activeCreatures = newActiveCreatures;

    // ISSUE #1: Remove stale reachability state for creatures that no longer exist
    // ISSUE #5: Cleanup when creatures disappear (not just on full clear)
    const currentInstanceIds = new Set(activeCreatures.keys());
    for (const instanceId of reachabilityStableState.keys()) {
      if (!currentInstanceIds.has(instanceId)) {
        reachabilityStableState.delete(instanceId);
      }
    }

    let detectedEntities = Array.from(activeCreatures.values());

    // DETECTION FAILURE TRACKING: Compare battleList vs detected health bars
    // This detects when health bar detection fails (creature in BL but no health bar detected)
    const battleListNames = battleListEntries.map((be) => be.name);
    const detectedCreatureNames = new Set(detectedEntities.map((c) => c.name));

    // Find creatures in battleList but not detected (detection failure)
    for (const blName of battleListNames) {
      if (!blName) continue;

      // Check if this battleList entry has a detected creature
      const hasDetection =
        detectedCreatureNames.has(blName) ||
        Array.from(detectedCreatureNames).some(
          (detName) =>
            isBattleListMatch(blName, detName) ||
            isBattleListMatch(detName, blName),
        );

      if (!hasDetection) {
        // Creature in battleList but no health bar detected
        // Find if we were tracking this creature before
        const previousCreature = Array.from(activeCreatures.values()).find(
          (c) =>
            c.name === blName ||
            isBattleListMatch(c.name, blName) ||
            isBattleListMatch(blName, c.name),
        );

        if (previousCreature) {
          const trackingKey = `${blName}-${previousCreature.instanceId}`;

          if (!missingHealthBarTracking.has(trackingKey)) {
            // First time missing - log it
            missingHealthBarTracking.set(trackingKey, {
              name: blName,
              instanceId: previousCreature.instanceId,
              lostAt: now,
              battleListName: blName,
              lastSeenAt: previousCreature.lastSeen || now,
            });
          } else {
            // Update last seen timestamp
            const tracking = missingHealthBarTracking.get(trackingKey);
            tracking.lastSeenAt = now;
          }
        }
      }
    }

    // Check for redetections (creature was missing, now detected again)
    for (const creature of detectedEntities) {
      if (!creature || !creature.name) continue;

      // Check if this creature was being tracked as missing
      const trackingKey = `${creature.name}-${creature.instanceId}`;
      const tracking = missingHealthBarTracking.get(trackingKey);

      if (tracking) {
        const missingDuration = now - tracking.lostAt;
        missingHealthBarTracking.delete(trackingKey);
      }
    }

    // Clean up old tracking entries (creature left battleList or > 5 seconds missing)
    for (const [key, tracking] of missingHealthBarTracking.entries()) {
      const stillInBattleList = battleListNames.some(
        (blName) =>
          blName === tracking.battleListName ||
          isBattleListMatch(blName, tracking.battleListName) ||
          isBattleListMatch(tracking.battleListName, blName),
      );

      const missingTooLong = now - tracking.lostAt > 5000;

      if (!stillInBattleList || missingTooLong) {
        missingHealthBarTracking.delete(key);
      }
    }

    // Enforce reporting policy:
    // Only report creatures that are in the battle list (validated during detection building)
    // Also ensure we never report players/NPCs.
    // Allow ALL battle list creatures through - let targeting logic handle 'others' rule
    detectedEntities = detectedEntities.filter((c) => {
      if (!c || !c.name) return false;

      const nameLower = c.name.toLowerCase();
      if (playerNames.some((p) => p && p.toLowerCase() === nameLower))
        return false;
      if (npcNames.some((n) => n && n.toLowerCase() === nameLower))
        return false;

      // Check if creature name matches any battle list entry (original or canonical)
      // This preserves ALL battle list creatures, even without explicit targeting rules
      for (const blEntry of battleListEntries) {
        if (!blEntry.name) continue;

        const blName = blEntry.name;
        const canonicalName = battleListToTargeting.get(blName);

        // Match against both battle list name and its canonical targeting name
        if (c.name === blName || c.name === canonicalName) {
          return true;
        }

        // For truncated names, allow fuzzy matching
        if (blEntry.isTruncated) {
          if (
            isBattleListMatch(c.name, blName) ||
            isBattleListMatch(blName, c.name)
          ) {
            return true;
          }
        }
      }

      // Not present in battle list -> exclude from reporting
      return false;
    });

    if (detectedEntities.length > 0) {
      // Read blocking creature coordinates from cavebot path
      let blockingCreatureCoords = null;
      if (sabInterface) {
        try {
          const cavebotPathResult = sabInterface.get('cavebotPathData');
          if (cavebotPathResult && cavebotPathResult.data) {
            const pathData = cavebotPathResult.data;
            if (
              pathData.blockingCreatureX !== 0 ||
              pathData.blockingCreatureY !== 0
            ) {
              blockingCreatureCoords = {
                x: pathData.blockingCreatureX,
                y: pathData.blockingCreatureY,
                z: pathData.blockingCreatureZ,
              };
            }
          }
        } catch (err) {
          // Silent - blocking creature check is optional
        }
      }

      // ISSUE #7: Pre-filter creatures outside screen bounds (±7 X, ±5 Y from player)
      // Only creatures on-screen can affect reachability pathfinding
      const screenBoundsCheck = {
        minX: currentPlayerMinimapPosition.x - 7,
        maxX: currentPlayerMinimapPosition.x + 7,
        minY: currentPlayerMinimapPosition.y - 5,
        maxY: currentPlayerMinimapPosition.y + 5,
      };

      const onScreenEntities = detectedEntities.filter((c) => {
        if (!c.gameCoords) return false;
        return (
          c.gameCoords.x >= screenBoundsCheck.minX &&
          c.gameCoords.x <= screenBoundsCheck.maxX &&
          c.gameCoords.y >= screenBoundsCheck.minY &&
          c.gameCoords.y <= screenBoundsCheck.maxY &&
          c.gameCoords.z === currentPlayerMinimapPosition.z // ISSUE #12: Ensure same Z-level
        );
      });

      // ISSUE #4: Only use position data (x,y,z) in signature, not full creature objects
      // This prevents HP changes from causing reachability recalculation
      const allCreaturePositions = onScreenEntities.map((c) => ({
        x: c.gameCoords.x,
        y: c.gameCoords.y,
        z: c.gameCoords.z,
      }));

      // ISSUE #2: Fix target coordinate property name (gameCoords not gameCoordinates)
      if (lastSentTarget && lastSentTarget.gameCoordinates) {
        const t = lastSentTarget.gameCoordinates;
        // Only include if on-screen and same Z-level
        if (
          t.x >= screenBoundsCheck.minX &&
          t.x <= screenBoundsCheck.maxX &&
          t.y >= screenBoundsCheck.minY &&
          t.y <= screenBoundsCheck.maxY &&
          t.z === currentPlayerMinimapPosition.z
        ) {
          const present = allCreaturePositions.some(
            (p) => p && p.x === t.x && p.y === t.y && p.z === t.z,
          );
          if (!present) allCreaturePositions.push({ x: t.x, y: t.y, z: t.z });
        }
      }

      // Build signature: include player position, screen bounds, and creature positions
      // Creature positions ARE needed since they act as dynamic obstacles in pathfinding
      // The temporal stability system (150ms debounce) prevents flickering during recalculation
      // ISSUE #9: Use BigInt to prevent integer overflow with many creatures
      let reachableSig = 0n;
      reachableSig =
        (reachableSig * 31n) ^ BigInt(currentPlayerMinimapPosition.x | 0);
      reachableSig =
        (reachableSig * 31n) ^ BigInt(currentPlayerMinimapPosition.y | 0);
      reachableSig =
        (reachableSig * 31n) ^ BigInt(currentPlayerMinimapPosition.z | 0);
      reachableSig = (reachableSig * 31n) ^ BigInt(screenBoundsCheck.minX | 0);
      reachableSig = (reachableSig * 31n) ^ BigInt(screenBoundsCheck.maxX | 0);
      reachableSig = (reachableSig * 31n) ^ BigInt(screenBoundsCheck.minY | 0);
      reachableSig = (reachableSig * 31n) ^ BigInt(screenBoundsCheck.maxY | 0);
      // Include creature count first for faster invalidation on count changes
      reachableSig =
        (reachableSig * 31n) ^ BigInt(allCreaturePositions.length | 0);
      for (let i = 0; i < allCreaturePositions.length; i++) {
        const p = allCreaturePositions[i];
        if (p) {
          reachableSig = (reachableSig * 31n) ^ BigInt(p.x | 0);
          reachableSig = (reachableSig * 31n) ^ BigInt(p.y | 0);
          reachableSig = (reachableSig * 31n) ^ BigInt(p.z | 0);
        } else {
          reachableSig = (reachableSig * 31n) ^ 0n;
        }
      }
      let reachableTiles = null;
      if (reachableSig === lastReachableSig && lastReachableTiles) {
        reachableTiles = lastReachableTiles;
      } else {
        reachableTiles = pathfinderInstance.getReachableTiles(
          currentPlayerMinimapPosition,
          allCreaturePositions,
          screenBoundsCheck,
        );
        lastReachableSig = reachableSig;
        lastReachableTiles = reachableTiles;
      }
      // Pixel-based adjacency using a single tile size and absoluteCoords.
      // Player’s screen center is at fixed tile offset inside gameWorld.
      // Apply a slight NW bias to equalize adjacency timing across directions
      const BIAS_TILES_X = -0.12; // west (left)
      const BIAS_TILES_Y = -0.12; // north (up)
      const playerCenterPx = {
        x:
          gameWorld.x +
          (PLAYER_SCREEN_TILE_X + 0.5 + BIAS_TILES_X) * tileSize.width,
        y:
          gameWorld.y +
          (PLAYER_SCREEN_TILE_Y + 0.5 + BIAS_TILES_Y) * tileSize.height,
      };

      detectedEntities = detectedEntities.map((entity) => {
        const coordsKey = getCoordsKey(entity.gameCoords);
        const newReachable = typeof reachableTiles[coordsKey] !== 'undefined';

        // Apply temporal stability to prevent flickering
        let isReachable = newReachable;
        const stableState = reachabilityStableState.get(entity.instanceId);

        if (stableState) {
          if (stableState.isReachable === newReachable) {
            // Status unchanged, keep confirmed value and update timestamp
            isReachable = stableState.isReachable;
            stableState.confirmedAt = now;
          } else {
            // Status changed - check if enough time has passed to accept the change
            const timeSinceConfirmed = now - stableState.confirmedAt;
            if (timeSinceConfirmed >= REACHABILITY_DEBOUNCE_MS) {
              // Enough time passed with new value, accept the change
              isReachable = newReachable;
              stableState.isReachable = newReachable;
              stableState.confirmedAt = now;
            } else {
              // Not enough time, keep old value
              isReachable = stableState.isReachable;
            }
          }
        } else {
          // First time seeing this creature, initialize stable state
          reachabilityStableState.set(entity.instanceId, {
            isReachable: newReachable,
            confirmedAt: now,
          });
        }

        let isAdjacent = false;
        if (entity?.absoluteCoords && tileSize?.width && tileSize?.height) {
          const dxPx = Math.abs(entity.absoluteCoords.x - playerCenterPx.x);
          const dyPx = Math.abs(entity.absoluteCoords.y - playerCenterPx.y);
          const dxTiles = dxPx / tileSize.width;
          const dyTiles = dyPx / tileSize.height;
          // Snap to nearest tile offset around the player to remove directional bias
          const rx = Math.round(dxTiles);
          const ry = Math.round(dyTiles);
          const chebRounded = Math.max(Math.abs(rx), Math.abs(ry));
          // Add a small float slack window to catch in-flight animations toward adjacency
          const chebFloat = Math.max(dxTiles, dyTiles);
          const sameTile = dxTiles < 0.5 && dyTiles < 0.5;
          isAdjacent = chebRounded === 1 || (!sameTile && chebFloat <= 1.2);
        } else if (entity.gameCoords) {
          // Fallback to tile-based if pixel data unavailable
          const deltaX = Math.abs(
            currentPlayerMinimapPosition.x - entity.gameCoords.x,
          );
          const deltaY = Math.abs(
            currentPlayerMinimapPosition.y - entity.gameCoords.y,
          );
          isAdjacent =
            deltaX <= 1 && deltaY <= 1 && !(deltaX === 0 && deltaY === 0);
        }

        // Check if this creature is blocking the cavebot path
        let isBlockingPath = false;
        if (blockingCreatureCoords && entity.gameCoords) {
          isBlockingPath =
            entity.gameCoords.x === blockingCreatureCoords.x &&
            entity.gameCoords.y === blockingCreatureCoords.y &&
            entity.gameCoords.z === blockingCreatureCoords.z;
        }

        return { ...entity, isReachable, isAdjacent, isBlockingPath };
      });
    }

    // Debug detection summary
    try {
      const assignedNames = detectedEntities
        .map((e) => e?.name)
        .filter(Boolean);
      const battleListSet = new Set(battleListNames);
      const assignedSet = new Set(assignedNames);
      const gameWorldSet = new Set(
        healthBars.map((hb) => hb.matchedName).filter(Boolean),
      );

      const battleListMatchedNames = [...battleListSet].filter((n) =>
        assignedSet.has(n),
      );
      const gameWorldMatchedNames = [...gameWorldSet].filter((n) =>
        assignedSet.has(n),
      );
      const unmatchedBattleListNames = [...battleListSet].filter(
        (n) => !assignedSet.has(n),
      );
      const unmatchedGameWorldNames = [...gameWorldSet].filter(
        (n) => !assignedSet.has(n),
      );

      logDetectionSummary({
        battleListItemNumber: battleListEntries.length,
        healthBarNumber: healthBars.length,
        playerListNumber: playerNames.length,
        npcListNumber: npcNames.length,
        battleListMatchedNameNumber: battleListMatchedNames.length,
        gameWorldMatchedNameNumber: gameWorldMatchedNames.length,
        battleListMatchedNames,
        gameWorldMatchedNames,
        unmatchedBattleListNames,
        unmatchedGameWorldNames,
      });
    } catch (_) {}

    lastFrameHealthBars = healthBars.map((hb) => ({
      x: hb.x,
      y: hb.y,
      healthTag: hb.healthTag,
    }));

    const creaturesChanged = !deepCompareEntities(
      detectedEntities,
      lastSentCreatures,
    );
    if (creaturesChanged) {
      postUpdateOnce('targeting/setEntities', {
        creatures: detectedEntities,
        duration: '0.00',
      });
      lastSentCreatures = detectedEntities;
    }

    let gameWorldTarget = null;
    const allObstructed =
      detectedEntities.length > 0 &&
      detectedEntities.every((e) => e.hp === 'Obstructed');

    const gameWorldChanged = dirtyRects.some((r) =>
      rectsIntersect(r, gameWorld),
    );
    const shouldDetectTarget = !allObstructed && gameWorldChanged;

    if (shouldDetectTarget) {
      const targetRect = await findTarget.findTarget(
        sharedBufferView,
        gameWorld,
      );
      if (targetRect) {
        const screenX = targetRect.x + targetRect.width / 2;
        const screenY = targetRect.y + targetRect.height / 2;
        const targetGameCoordsRaw = getGameCoordinatesFromScreen(
          screenX,
          screenY,
          isPlayerInAnimationFreeze
            ? lastStablePlayerMinimapPosition
            : currentPlayerMinimapPosition,
          gameWorld,
          tileSize,
        );
        if (targetGameCoordsRaw) {
          const targetTile = {
            x: Math.round(targetGameCoordsRaw.x),
            y: Math.round(targetGameCoordsRaw.y),
            z:
              targetGameCoordsRaw.z ??
              (isPlayerInAnimationFreeze
                ? lastStablePlayerMinimapPosition
                : currentPlayerMinimapPosition
              ).z,
          };

          let matched = detectedEntities.find(
            (e) =>
              e.gameCoords &&
              e.gameCoords.x === targetTile.x &&
              e.gameCoords.y === targetTile.y &&
              e.gameCoords.z === targetTile.z,
          );

          if (!matched) {
            let closestCreature = null;
            let minDistance = Infinity;
            for (const entity of detectedEntities) {
              if (entity.gameCoords) {
                const distance = calculateDistance(
                  targetTile,
                  entity.gameCoords,
                );
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

    let unifiedTarget = null;
    if (shouldDetectTarget) {
      unifiedTarget = gameWorldTarget || null;
    } else {
      unifiedTarget = lastSentTarget;
    }

    // Only invalidate the target when we actually re-evaluated the game world this frame.
    if (
      shouldDetectTarget &&
      unifiedTarget &&
      !detectedEntities.some((c) => c.instanceId === unifiedTarget.instanceId)
    ) {
      unifiedTarget = null;
    }

    const targetChanged = !deepCompareEntities(unifiedTarget, lastSentTarget);
    if (targetChanged) {
      lastSentTarget = unifiedTarget;
    }

    if (sabInterface) {
      try {
        const sabTarget = unifiedTarget
          ? {
              instanceId: unifiedTarget.instanceId,
              x: unifiedTarget.gameCoordinates.x,
              y: unifiedTarget.gameCoordinates.y,
              z: unifiedTarget.gameCoordinates.z,
              distance: Math.round(unifiedTarget.distance * 100),
              isReachable: unifiedTarget.isReachable ? 1 : 0,
              name: unifiedTarget.name,
              lastUpdateTimestamp: Date.now(),
            }
          : {
              instanceId: 0,
              x: 0,
              y: 0,
              z: 0,
              distance: 0,
              isReachable: 0,
              name: '',
              lastUpdateTimestamp: Date.now(),
            };

        const healthTagToNumber = (tag) => {
          switch (tag) {
            case 'Full':
              return 5;
            case 'High':
              return 4;
            case 'Medium':
              return 3;
            case 'Low':
              return 2;
            case 'Critical':
              return 1;
            case 'Obstructed':
              return 0;
            default:
              return 0;
          }
        };

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
          hp: healthTagToNumber(c.hp),
          name: c.name,
        }));

        const sabBattleList = battleListEntries.slice(0, 50).map((b, i) => ({
          name: b.name,
          x: b.x,
          y: b.y,
          isTarget:
            typeof battleListTargetIndex === 'number' &&
            i === battleListTargetIndex
              ? 1
              : 0,
        }));

        sabInterface.setMany(
          {
            creatures: sabCreatures,
            battleList: sabBattleList,
            target: sabTarget,
            healthBars: healthBarsForReporting, // Use the complete, unfiltered list
          },
          {
            creatures: { lastUpdateTimestamp: Date.now() },
          },
        );
      } catch (err) {}
    }

    const batchUpdates = [];
    if (targetChanged) {
      batchUpdates.push({
        type: 'targeting/setTarget',
        payload: unifiedTarget,
      });
    }

    // Check if healthBars changed and add to batch updates
    const healthBarsString = JSON.stringify(healthBarsForReporting);
    if (healthBarsString !== lastPostedResults.get('targeting/setHealthBars')) {
      lastPostedResults.set('targeting/setHealthBars', healthBarsString);
      batchUpdates.push({
        type: 'targeting/setHealthBars',
        payload: healthBarsForReporting,
      });
      lastSentHealthBars = healthBarsForReporting;
    }
    const blString = JSON.stringify(battleListEntries);
    if (blString !== lastPostedResults.get('battleList/setBattleListEntries')) {
      lastPostedResults.set('battleList/setBattleListEntries', blString);
      batchUpdates.push({
        type: 'battleList/setBattleListEntries',
        payload: battleListEntries,
      });
      if (battleListEntries.length > 0) {
        batchUpdates.push({
          type: 'battleList/updateLastSeenMs',
          payload: undefined,
        });
      }
    }

    const playersString = JSON.stringify(playerNames);
    if (playersString !== lastPostedResults.get('uiValues/setPlayers')) {
      lastPostedResults.set('uiValues/setPlayers', playersString);
      batchUpdates.push({ type: 'uiValues/setPlayers', payload: playerNames });
      if (playerNames.length > 0)
        batchUpdates.push({
          type: 'uiValues/updateLastSeenPlayerMs',
          payload: undefined,
        });
    }
    const npcsString = JSON.stringify(npcNames);
    if (npcsString !== lastPostedResults.get('uiValues/setNpcs')) {
      lastPostedResults.set('uiValues/setNpcs', npcsString);
      batchUpdates.push({ type: 'uiValues/setNpcs', payload: npcNames });
      if (npcNames.length > 0)
        batchUpdates.push({
          type: 'uiValues/updateLastSeenNpcMs',
          payload: undefined,
        });
    }

    if (typeof battleListTargetIndex === 'number') {
      const idxStr = JSON.stringify(battleListTargetIndex);
      if (idxStr !== lastPostedResults.get('battleList/setTargetIndex')) {
        lastPostedResults.set('battleList/setTargetIndex', idxStr);
        batchUpdates.push({
          type: 'battleList/setTargetIndex',
          payload: battleListTargetIndex,
        });
      }
    }

    if (batchUpdates.length > 0) {
      parentPort.postMessage({ type: 'batch-update', payload: batchUpdates });
    }
  } catch (error) {
    console.error(
      '[CreatureMonitor] CRITICAL ERROR in performOperation:',
      error,
    );
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

    if (sabInterface) {
      try {
        sabInterface.set('looting', { required: 0 });
      } catch (err) {}
    }

    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setLootingRequired',
      payload: false,
    });
  } catch (error) {
    if (sabInterface) {
      try {
        sabInterface.set('looting', { required: 0 });
      } catch (err) {}
    }
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
      loadConfigFromSAB(); // Reload config on full state sync
    } else if (message.type === 'state_diff') {
      if (!currentState) currentState = {};
      Object.assign(currentState, message.payload);
      // Reload config if workerConfig slice changed
      if (message.payload.workerConfig) {
        loadConfigFromSAB();
      }
    } else if (message.type === 'regions_snapshot') {
      currentState = currentState || {};
      currentState.regionCoordinates = message.payload;
      regionsStale = false;
      return;
    } else if (typeof message === 'object' && !message.type) {
      currentState = message;
      if (currentState && !isInitialized) {
        isInitialized = true;
        loadConfigFromSAB(); // Load config on initialization
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
          .catch((err) => {});
      }
    }
    performOperation();
  } catch (e) {
    console.error('[CreatureMonitor] CRITICAL ERROR in message handler:', e);
  }
});