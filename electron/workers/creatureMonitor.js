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
import { getGameCoordinatesFromScreen } from '../utils/gameWorldClickTranslator.js';
import { FrameUpdateManager } from '../utils/frameUpdateManager.js';
import {
  findBestNameMatch,
  getSimilarityScore,
  isBattleListMatch,
} from '../utils/nameMatcher.js';
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

const PLAYER_ANIMATION_FREEZE_MS = 25;
const STICKY_SNAP_THRESHOLD_TILES = 0.5;
const JITTER_CONFIRMATION_TIME_MS = 75;
const CORRELATION_DISTANCE_THRESHOLD_PIXELS = 200;
const CREATURE_GRACE_PERIOD_MS = 150; // Grace period for temporary disappearances
// How long to blacklist a tile's healthbar after we decide it's an unmatched creature.
// During this time the tile will be ignored for detections to avoid mis-assignment.
const UNMATCHED_BLACKLIST_MS = 500;

// Name matching threshold — lowered to be tolerant to OCR noise
const NAME_MATCH_THRESHOLD = 0.3;

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
let lastFrameHealthBars = [];
let lastReachableSig = null;
let lastReachableTiles = null;
let regionsStale = false;
let lastRequestedRegionsVersion = -1;
let lastHealthScanTime = 0;

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
      if (data.healthBarNumber !== data.battleListItemNumber) {
        console.log(`[NamesDebug] ${payload}`);
      }
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
    // Remove trailing sequences of dots (including "...")
    s = s.replace(/\.{1,}$/g, '').trim();
    // Break camelCase (e.g. "MuglexClan" -> "Muglex Clan")
    s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
    // Remove any remaining characters that are not letters or spaces
    s = s.replace(/[^a-zA-Z\s]/g, '');
    // Collapse multiple spaces
    s = s.replace(/\s+/g, ' ').trim();
    return s;
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
        const sanitized = sanitizeBattleListName(fixedName);
        return {
          name: sanitized,
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

    // ===== PHASE 2: OCR battle list =====n
    let battleListEntries = lastBattleListEntries;
    let forceBattleListOcr = false;

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

        // Post-process battle list entries:
        // 1) Ensure names are sanitized (remove trailing '...' or unicode ellipsis and non-letters).
        // 2) Prefer mapping each battle list entry to a targeting-list canonical name (if any).
        try {
          const explicitTargetNames = (targetingList || [])
            .filter(
              (rule) =>
                rule && rule.name && rule.name.toLowerCase() !== 'others',
            )
            .map((r) => r.name);

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

            // If there are explicit target names, try to match the sanitized battle
            // list entry to one of them. Prefer exact/isBattleListMatch, then fuzzy.
            let matched = null;
            if (explicitTargetNames.length > 0) {
              // direct/truncated match
              for (const tname of explicitTargetNames) {
                if (
                  isBattleListMatch(tname, name) ||
                  isBattleListMatch(name, tname)
                ) {
                  matched = tname;
                  break;
                }
              }
              // fuzzy fallback using findBestNameMatch
              if (!matched) {
                const fuzzy = findBestNameMatch(name, explicitTargetNames);
                if (fuzzy) matched = fuzzy;
              }
            }

            return {
              ...entry,
              name: matched || name,
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
        if (now - creature.disappearedAt < CREATURE_GRACE_PERIOD_MS) {
          allExpired = false;
        }
      }
      if (allExpired) {
        activeCreatures.clear();
      }
    }

    if (!hasEntities && activeCreatures.size === 0) {
      if (lastSentCreatures.length > 0 || lastSentTarget !== null) {
        lastSentCreatures = [];
        lastSentTarget = null;

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

    // ===== PHASE 4: Detect health bars and OCR nameplates =====
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

    // Filter player's own health bar
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
    if (battleListCount !== gameWorldHealthBarCount) {
      console.log(`BL/GW ${battleListCount}/${gameWorldHealthBarCount}`);
    }

    // Prepare canonical names from targeting list and battle list
    const explicitTargetNames = targetingList
      .filter((rule) => rule.name.toLowerCase() !== 'others')
      .map((rule) => rule.name);
    const battleListNames = battleListEntries.map((e) => e.name);
    const canonicalNames = [
      ...new Set([...explicitTargetNames, ...battleListNames]),
    ];

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
    for (const [k, until] of Array.from(blacklistedUntil.entries())) {
      if (until <= now) {
        blacklistedUntil.delete(k);
        blacklistedTiles.delete(k);
      }
    }

    // Build detections list but filter out healthbars that:
    // - are on a blacklisted tile, or
    // - have an OCR name that cannot be matched to an explicit targeting name
    //
    // Also: if we encounter a healthbar whose OCR name cannot be matched to
    // the explicit targeting list, we blacklist its tile for a short period
    // (UNMATCHED_BLACKLIST_MS) so that the same healthbar pixels won't be
    // accidentally matched to other creatures immediately afterwards.
    //
    // NOTE: `explicitTargetNames` is prepared earlier in the function (to avoid
    // redeclaration). Reuse that value here.

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

      // Tile key used for blacklisting (prevents re-using this tile for other creatures)
      const tileKey = `${Math.round(gameCoords.x)},${Math.round(gameCoords.y)},${gameCoords.z}`;

      // Skip if this tile is currently blacklisted
      if (blacklistedTiles.has(tileKey)) continue;

      const ocrName = getRawOcrForHealthBar(hb);

      // If explicit targeting names exist, require the detection to match one of them.
      // If it doesn't match, blacklist the tile for a short time and skip it.
      if (explicitTargetNames.length > 0) {
        let matchedToTarget = false;

        if (ocrName && ocrName.length > 0) {
          // direct/truncated check
          for (const tname of explicitTargetNames) {
            if (
              isBattleListMatch(tname, ocrName) ||
              isBattleListMatch(ocrName, tname)
            ) {
              matchedToTarget = true;
              break;
            }
          }

          // fuzzy fallback using findBestNameMatch
          if (!matchedToTarget) {
            const fuzzy = findBestNameMatch(ocrName, explicitTargetNames);
            if (fuzzy) matchedToTarget = true;
          }
        }

        // If no match to the explicit targeting list, blacklist and skip this healthbar.
        if (!matchedToTarget) {
          blacklistedTiles.add(tileKey);
          blacklistedUntil.set(tileKey, now + UNMATCHED_BLACKLIST_MS);
          continue;
        }
      }

      // Keep this detection since it passed blacklisting / matching checks
      detections.push({ hb, ocrName, gameCoords });
    }

    // Scoring function — corrected argument order for similarity
    const calculateMatchScore = (creature, detection) => {
      if (!detection.gameCoords || !creature.gameCoords) {
        return -Infinity;
      }

      // Factor 1: Name Similarity (Highest Weight)
      const nameScore = detection.ocrName
        ? getSimilarityScore(detection.ocrName, creature.name)
        : 0.5;
      if (nameScore < NAME_MATCH_THRESHOLD) {
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
      if (screenDistValue > CORRELATION_DISTANCE_THRESHOLD_PIXELS) {
        return -Infinity;
      }
      const screenScore =
        CORRELATION_DISTANCE_THRESHOLD_PIXELS - screenDistValue;

      return nameScore * 1000 + gameCoordScore + screenScore;
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

        // Try to prefer canonical name when OCR suggests one
        const matchedCanonical = detection.ocrName
          ? findBestNameMatch(detection.ocrName, canonicalNames)
          : null;

        const updatedDetection = {
          absoluteCoords: { x: detection.hb.x, y: detection.hb.y },
          healthBarY: detection.hb.y,
          // prefer matched canonical name, then OCR raw, then existing creature.name
          name: matchedCanonical || detection.ocrName || creature.name,
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

    // Use canonicalNames (both targeting + battle list) for best-match attempts
    const canonicalTargetNames = canonicalNames;
    // Allowed canonical names for reporting: explicit targeting names + battle list names.
    // We will only report creatures whose names are present in one of these sets.
    const allowedCanonicalNames = [
      ...new Set([...explicitTargetNames, ...battleListNames]),
    ];

    for (const detection of unmatchedDetections) {
      if (
        detection.ocrName &&
        detection.ocrName.length > 2 &&
        !allKnownSafeNames.has(detection.ocrName)
      ) {
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

        const bestMatchName = findBestNameMatch(
          detection.ocrName,
          canonicalTargetNames,
        );
        const finalName = bestMatchName || detection.ocrName;

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
        if (now - creature.disappearedAt <= CREATURE_GRACE_PERIOD_MS) {
          newActiveCreatures.set(id, creature);
        }
      }
    }

    activeCreatures = newActiveCreatures;

    let detectedEntities = Array.from(activeCreatures.values());

    // Enforce reporting policy:
    // Only report creatures that match an entry in the battle list or the explicit targeting list.
    // This ensures every reported creature is visible/known (reduces false positives).
    detectedEntities = detectedEntities.filter((c) => {
      if (!c || !c.name) return false;

      // 1) Check against battleList names (handle truncated/trusted matching)
      for (const blName of battleListNames) {
        if (!blName) continue;
        if (
          isBattleListMatch(c.name, blName) ||
          isBattleListMatch(blName, c.name)
        ) {
          return true;
        }
      }

      // 2) Check against explicit targeting names
      for (const tName of explicitTargetNames) {
        if (!tName) continue;
        if (
          isBattleListMatch(c.name, tName) ||
          isBattleListMatch(tName, c.name)
        ) {
          return true;
        }
        // fuzzy check as a last resort
        const fuzzy = findBestNameMatch(c.name, [tName], NAME_MATCH_THRESHOLD);
        if (fuzzy) return true;
      }

      // Not present in battle list nor targeting list -> exclude from reporting
      return false;
    });

    if (detectedEntities.length > 0) {
      const allCreaturePositions = detectedEntities.map((c) => c.gameCoords);
      const screenBounds = {
        minX: currentPlayerMinimapPosition.x - 7,
        maxX: currentPlayerMinimapPosition.x + 7,
        minY: currentPlayerMinimapPosition.y - 5,
        maxY: currentPlayerMinimapPosition.y + 5,
      };
      let reachableSig = 0;
      reachableSig =
        ((reachableSig * 31) ^ (currentPlayerMinimapPosition.x | 0)) | 0;
      reachableSig =
        ((reachableSig * 31) ^ (currentPlayerMinimapPosition.y | 0)) | 0;
      reachableSig =
        ((reachableSig * 31) ^ (currentPlayerMinimapPosition.z | 0)) | 0;
      reachableSig = ((reachableSig * 31) ^ (screenBounds.minX | 0)) | 0;
      reachableSig = ((reachableSig * 31) ^ (screenBounds.maxX | 0)) | 0;
      reachableSig = ((reachableSig * 31) ^ (screenBounds.minY | 0)) | 0;
      reachableSig = ((reachableSig * 31) ^ (screenBounds.maxY | 0)) | 0;
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
          const deltaX = Math.abs(
            currentPlayerMinimapPosition.x - entity.gameCoords.x,
          );
          const deltaY = Math.abs(
            currentPlayerMinimapPosition.y - entity.gameCoords.y,
          );
          isAdjacent =
            deltaX <= 1 && deltaY <= 1 && !(deltaX === 0 && deltaY === 0);
        }
        return { ...entity, isReachable, isAdjacent, isBlockingPath: false };
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

    if (
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
            }
          : {
              instanceId: 0,
              x: 0,
              y: 0,
              z: 0,
              distance: 0,
              isReachable: 0,
              name: '',
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

        sabInterface.setMany({
          creatures: sabCreatures,
          battleList: sabBattleList,
          target: sabTarget,
        });
      } catch (err) {}
    }

    const batchUpdates = [];
    if (targetChanged) {
      batchUpdates.push({
        type: 'targeting/setTarget',
        payload: unifiedTarget,
      });
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
          .catch((err) => {});
      }
    }
    performOperation();
  } catch (e) {
    console.error('[CreatureMonitor] CRITICAL ERROR in message handler:', e);
  }
});
