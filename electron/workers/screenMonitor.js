// /home/feiron/Dokumenty/Automaton/electron/workers/screenMonitor.js
// --- REFACTORED ---

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { resourceBars } from '../constants/index.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import RuleProcessor from './screenMonitor/ruleProcessor.js';
import { CooldownManager } from './screenMonitor/CooldownManager.js';
import { FrameUpdateManager } from '../utils/frameUpdateManager.js';
import findSequences from 'find-sequences-native';
import actionBarItems from '../constants/actionBarItems.js';
import actionBarOcr from '../../nativeModules/actionBarOcr/wrapper.js';
import { rectsIntersect } from '../utils/rectsIntersect.js';

const isStackableItem = (itemName) => itemName.includes('Potion') || itemName.includes('Rune') || itemName === 'brownMushroom' || itemName === 'insectoidEggs';

console.log('[ScreenMonitor] actionBarOcr loaded:', !!actionBarOcr.recognizeNumber);
import { createWorkerInterface, WORKER_IDS } from './sabState/index.js';

const { sharedData } = workerData;
const SCAN_INTERVAL_MS = 100;

if (!sharedData) throw new Error('[ScreenMonitor] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const sharedBufferView = Buffer.from(imageSAB);

// Initialize SAB interface for real-time data access
let sabInterface = null;
if (workerData.unifiedSAB) {
  sabInterface = createWorkerInterface(
    workerData.unifiedSAB,
    WORKER_IDS.SCREEN_MONITOR,
  );
}

const WIDTH_INDEX = 1;
const HEIGHT_INDEX = 2;
const IS_RUNNING_INDEX = 3;

let currentState = null;
let isShuttingDown = false;
let isInitialized = false;
let hasScannedInitially = false;
// Region snapshot management
let regionsStale = false;
let lastRequestedRegionsVersion = -1;
// Track online state to detect relog
let wasOnline = false;

const cooldownManager = new CooldownManager();
const ruleProcessorInstance = new RuleProcessor(parentPort);
const frameUpdateManager = new FrameUpdateManager();

let lastCalculatedState = {
  hppc: null,
  mppc: null,
  healingCd: false,
  supportCd: false,
  attackCd: false,
  characterStatus: {},
  partyMembers: [],
  isWalking: false,
  activeActionItems: {},
  equippedItems: {},
  lastMovementTimestamp: 0,
  lastKnownPlayerMinimapPosition: null,
  monsterNum: 0,
};

// Track last sent payload to avoid redundant Redux updates
let lastSentPayload = null;

let itemHistory = new Map();

const MAX_COOLDOWN_MS = 6000;

// Per-region last scan timestamps for fallback scanning to detect disappearances
const lastScanTs = {
  healthBar: 0,
  manaBar: 0,
  cooldownBar: 0,
  statusBar: 0,
  equip: 0,
  hotkeyBar: 0,
};

// Fast checksum cache for resource bars
const lastBarChecksums = {
  healthBar: null,
  manaBar: null,
  hotkeyBar: null,
};

/**
 * Robust checksum for horizontal resource bars (HP/MP).
 * Uses a multi-layered approach:
 * 1. Dense horizontal sampling across the entire bar width (every N pixels)
 * 2. Vertical sampling at top/middle/bottom of bar
 * 3. Edge detection to catch bar transitions
 * 4. Color distribution histogram for robust change detection
 *
 * This ensures we catch even 1-2 pixel changes in the bar while maintaining performance.
 */
function computeBarChecksum(buffer, screenWidth, region, barWidth = 94) {
  if (!region || region.width <= 0 || region.height <= 0) return null;

  const { x: startX, y: startY, height } = region;

  // Sample points: every 2-3 pixels horizontally for dense coverage
  const HORIZONTAL_STEP = 3; // Sample every 3rd pixel across the bar
  const sampleCount = Math.floor(barWidth / HORIZONTAL_STEP);

  // Multi-component checksum for robustness
  let checksumParts = {
    topRow: 0, // Top edge of bar
    middleRow: 0, // Middle of bar
    bottomRow: 0, // Bottom edge of bar
    colorHist: {}, // Histogram of unique colors
    transitionCount: 0, // Number of color transitions (edge detection)
  };

  // Sample three horizontal lines through the bar
  const rows = [
    Math.floor(startY + height * 0.25), // Upper quarter
    Math.floor(startY + height * 0.5), // Middle
    Math.floor(startY + height * 0.75), // Lower quarter
  ];
  const rowKeys = ['topRow', 'middleRow', 'bottomRow'];

  let prevColor = null;

  for (let i = 0; i < sampleCount; i++) {
    const x = startX + i * HORIZONTAL_STEP;
    if (x >= startX + barWidth) break;

    // Sample all three rows at this x position
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const y = rows[rowIdx];
      const idx = ((y * screenWidth + x) * 4) >>> 0; // BGRA

      const b = buffer[idx] || 0;
      const g = buffer[idx + 1] || 0;
      const r = buffer[idx + 2] || 0;

      // Row-specific checksum with better mixing
      const pixelHash =
        (r * 16777619) ^ (g * 16777619) ^ (b * 16777619) ^ (i * 2654435761);
      checksumParts[rowKeys[rowIdx]] =
        (checksumParts[rowKeys[rowIdx]] + pixelHash) >>> 0;

      // Color histogram (only for middle row to reduce overhead)
      if (rowIdx === 1) {
        const colorKey = `${r},${g},${b}`;
        checksumParts.colorHist[colorKey] =
          (checksumParts.colorHist[colorKey] || 0) + 1;

        // Detect color transitions (edges in the bar)
        if (prevColor && prevColor !== colorKey) {
          checksumParts.transitionCount++;
        }
        prevColor = colorKey;
      }
    }
  }

  // Create composite checksum that's highly sensitive to changes
  const histKeys = Object.keys(checksumParts.colorHist).sort();
  let histHash = 0;
  for (const key of histKeys) {
    const count = checksumParts.colorHist[key];
    histHash = (histHash * 31 + count) >>> 0;
  }

  // Return object with multiple checksum components
  return {
    top: checksumParts.topRow,
    mid: checksumParts.middleRow,
    bot: checksumParts.bottomRow,
    hist: histHash,
    trans: checksumParts.transitionCount,
    // Composite hash for quick comparison
    composite:
      (checksumParts.topRow ^
        (checksumParts.middleRow << 5) ^
        (checksumParts.bottomRow << 10) ^
        (histHash << 15) ^
        (checksumParts.transitionCount << 20)) >>>
      0,
  };
}

/**
 * Compare two bar checksums for equality.
 * Returns true if they match, false otherwise.
 */
function checksumsMatch(ck1, ck2) {
  if (!ck1 || !ck2) return false;
  // Fast path: compare composite hash first
  if (ck1.composite !== ck2.composite) return false;
  // Verify all components match (guards against hash collisions)
  return (
    ck1.top === ck2.top &&
    ck1.mid === ck2.mid &&
    ck1.bot === ck2.bot &&
    ck1.hist === ck2.hist &&
    ck1.trans === ck2.trans
  );
}

const reusableGameStateUpdate = {
  storeUpdate: true,
  type: 'gameState/updateGameStateFromMonitorData',
  payload: {},
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function initializeWorker() {
  console.log('[ScreenMonitor] Initializing worker...');
  isInitialized = true;
}

function runRules(ruleInput) {
  const { rules, global, regionCoordinates } = currentState;
  if (!rules?.enabled) return;
  const currentRules = rules.rules;
  if (!currentRules || !Array.isArray(currentRules)) return;
  if (
    !regionCoordinates?.regions ||
    Object.keys(regionCoordinates.regions).length === 0
  )
    return;
  try {
    ruleProcessorInstance.processRules(currentRules, ruleInput, {
      ...global,
      isOnline: regionCoordinates?.regions?.onlineMarker ?? false,
    });
  } catch (error) {
    console.error('[ScreenMonitor] Rule processing error:', error);
  }
}

function calculateHealthBar(bufferToUse, metadata, healthBarRegion) {
  if (!healthBarRegion) return lastCalculatedState.hppc;
  return calculatePercentages(
    bufferToUse,
    metadata,
    healthBarRegion,
    resourceBars.healthBar,
    94,
  );
}
function calculateManaBar(bufferToUse, metadata, manaBarRegion) {
  if (!manaBarRegion) return lastCalculatedState.mppc;
  return calculatePercentages(
    bufferToUse,
    metadata,
    manaBarRegion,
    resourceBars.manaBar,
    94,
  );
}
function calculateCooldowns(cooldownsRegion) {
  const activeCooldowns = cooldownsRegion?.children || {};
  const healingCd = cooldownManager.updateCooldown(
    'healing',
    !!activeCooldowns.healing,
  );
  const supportCd = cooldownManager.updateCooldown(
    'support',
    !!activeCooldowns.support,
  );
  const attackCd = cooldownManager.updateCooldown(
    'attack',
    !!activeCooldowns.attack,
  );
  if (activeCooldowns.attackInactive) cooldownManager.forceDeactivate('attack');
  if (activeCooldowns.healingInactive)
    cooldownManager.forceDeactivate('healing');
  if (activeCooldowns.supportInactive)
    cooldownManager.forceDeactivate('support');
  return { healingCd, supportCd, attackCd };
}
function calculateCharacterStatus(statusBarRegion) {
  const characterStatus = {};
  if (statusBarRegion?.children) {
    Object.keys(statusBarRegion.children).forEach((key) => {
      characterStatus[key] = !!statusBarRegion.children[key].x;
    });
  }
  return characterStatus;
}
function calculateEquippedItems(amuletSlot, ringSlot, bootsSlot) {
  const getEquippedItem = (slotRegion) => {
    if (!slotRegion?.children) return 'Unknown';
    const foundItems = Object.keys(slotRegion.children);
    if (foundItems.length === 0) return 'Empty';
    const actualItem = foundItems.find((item) => !item.includes('empty'));
    return actualItem || 'Empty';
  };
  return {
    amulet: getEquippedItem(amuletSlot),
    ring: getEquippedItem(ringSlot),
    boots: getEquippedItem(bootsSlot),
  };
}

async function findActionItemsInHotkeyBar(hotkeyBarRegion, buffer, metadata) {
  if (!hotkeyBarRegion || !hotkeyBarRegion.width || !hotkeyBarRegion.height) {
    return {};
  }

  const tasks = {};
  for (const [key, value] of Object.entries(actionBarItems)) {
    tasks[key] = {
      sequences: { [key]: value },
      searchArea: hotkeyBarRegion,
      occurrence: 'first',
    };
  }

  const results = await findSequences.findSequencesNativeBatch(buffer, tasks);
  const foundItems = {};
  for (const [itemName, itemResult] of Object.entries(results)) {
    if (itemResult[itemName]) {
      const def = actionBarItems[itemName];
      const result = itemResult[itemName];
      foundItems[itemName] = {
        x: result.x,
        y: result.y,
        width: def.direction === 'vertical' ? 1 : def.sequence.length,
        height: def.direction === 'vertical' ? def.sequence.length : 1,
        rawPos: {
          x: result.x - (def.offset?.x || 0),
          y: result.y - (def.offset?.y || 0),
        },
      };

      // Calculate slot position and OCR count for stackable items
      const slotWidth = 32;  // Item width for bbox and OCR
      const slotPitch = 36;  // Full spacing: item + 4px margin
      const relX = result.x - hotkeyBarRegion.x;
      const slotIndex = Math.floor(relX / slotPitch);
      const slotX = hotkeyBarRegion.x + slotIndex * slotPitch;
      const slotY = hotkeyBarRegion.y;

      // Update to slot position for accurate item bounding box
      foundItems[itemName].x = slotX;
      foundItems[itemName].y = slotY;
      foundItems[itemName].width = 32;
      foundItems[itemName].height = 32;
      foundItems[itemName].slotIndex = slotIndex;


      // OCR for items with counts (potions, runes, food)
      if (itemName.includes('Potion') || itemName.includes('Rune') || itemName === 'brownMushroom' || itemName === 'insectoidEggs') {
        const numX = slotX; // left of slot, to scan full width rightward
        const numY = slotY + 22; // top of bottom 10px, so 6px digits fit within y=22-28
        const countStr = actionBarOcr.recognizeNumber(buffer, metadata.width, metadata.height, numX, numY, 1);
        const count = countStr === "-1" ? 0 : parseInt(countStr) || 0;
        foundItems[itemName].count = count;
      } else {
        foundItems[itemName].count = 1;
      }
      }
    }
  return foundItems;
}

async function calculateActiveActionItems(
  hotkeyBarRegion,
  bufferToUse,
  metadata,
) {
  return await findActionItemsInHotkeyBar(
    hotkeyBarRegion,
    bufferToUse,
    metadata,
  );
}

function calculateWalkingState() {
  const { gameState } = currentState;
  if (!gameState?.playerMinimapPosition) return lastCalculatedState.isWalking;
  const currentPos = gameState.playerMinimapPosition;
  const lastPos = lastCalculatedState.lastKnownPlayerMinimapPosition;
  const hasPositionChanged =
    !lastPos ||
    currentPos.x !== lastPos.x ||
    currentPos.y !== lastPos.y ||
    currentPos.z !== lastPos.z;
  if (hasPositionChanged) {
    lastCalculatedState.lastMovementTimestamp = performance.now();
    lastCalculatedState.lastKnownPlayerMinimapPosition = { ...currentPos };
    return true;
  }
  const timeSinceLastMove =
    performance.now() - (lastCalculatedState.lastMovementTimestamp || 0);
  return timeSinceLastMove < 750;
}

async function processGameState() {
  if (!isInitialized) return;

  // Ensure we have regions or request snapshot; continue with cached regions if stale
  const rc = currentState?.regionCoordinates;
  const regions = rc?.regions;
  const version = rc?.version;
  if (!regions) {
    if (version !== lastRequestedRegionsVersion) {
      parentPort.postMessage({ type: 'request_regions_snapshot' });
      lastRequestedRegionsVersion = version ?? -1;
    }
    return;
  }

  // Detect online state transition (relog) - reset scan flags
  const isOnline = !!regions.onlineMarker;
  if (isOnline && !wasOnline) {
    // Just logged in - force fresh scan of all values
    console.log('[ScreenMonitor] Player logged in, resetting scan state for fresh values');
    hasScannedInitially = false;
    lastBarChecksums.healthBar = null;
    lastBarChecksums.manaBar = null;
    lastBarChecksums.hotkeyBar = null;
    lastSentPayload = null;
    Object.keys(lastScanTs).forEach(key => lastScanTs[key] = 0);
    itemHistory.clear();
  }
  wasOnline = isOnline;

  try {
    const now = Date.now();
    // Coalesce dirty rectangles to reduce intersection checks
    const rawDirty = [...frameUpdateManager.accumulatedDirtyRects];
    frameUpdateManager.accumulatedDirtyRects.length = 0;

    const coalesceRects = (rects, tolerance = 0) => {
      if (!rects || rects.length <= 1) return rects || [];
      const merged = [];
      const list = rects.slice();
      while (list.length) {
        let r = list.pop();
        let changed = true;
        while (changed) {
          changed = false;
          for (let i = list.length - 1; i >= 0; i--) {
            const o = list[i];
            // Enhanced overlap check with tolerance for adjacent rects
            const overlapX = Math.max(0, Math.min(r.x + r.width, o.x + o.width) - Math.max(r.x, o.x));
            const overlapY = Math.max(0, Math.min(r.y + r.height, o.y + o.height) - Math.max(r.y, o.y));
            const adjacentX = Math.abs((r.x + r.width) - o.x) <= tolerance || Math.abs((o.x + o.width) - r.x) <= tolerance;
            const adjacentY = Math.abs((r.y + r.height) - o.y) <= tolerance || Math.abs((o.y + o.height) - r.y) <= tolerance;
            const ix = (overlapX > 0 && overlapY > 0) || (adjacentX && adjacentY);
            if (ix) {
              const nx = Math.min(r.x, o.x);
              const ny = Math.min(r.y, o.y);
              const nx2 = Math.max(r.x + r.width, o.x + o.width);
              const ny2 = Math.max(r.y + r.height, o.y + o.height);
              r = { x: nx, y: ny, width: nx2 - nx, height: ny2 - ny };
              list.splice(i, 1);
              changed = true;
            }
          }
        }
        merged.push(r);
      }
      return merged;
    };

    // Enhanced coalescing: Merge with padding for adjacent rects to catch fragmented changes
    const dirtyRects = coalesceRects(rawDirty, 2); // Add 2px tolerance for adjacent merges


    const anyDirty = dirtyRects.length > 0;


    if (Atomics.load(syncArray, IS_RUNNING_INDEX) === 0) return;

    const width = Atomics.load(syncArray, WIDTH_INDEX);
    const height = Atomics.load(syncArray, HEIGHT_INDEX);
    // If regions are stale, request snapshot but keep using cached regions
    if (
      regionsStale &&
      typeof version === 'number' &&
      version !== lastRequestedRegionsVersion
    ) {
      parentPort.postMessage({ type: 'request_regions_snapshot' });
      lastRequestedRegionsVersion = version;
    }

    if (Object.keys(regions).length === 0 || width <= 0 || height <= 0) return;

    const metadata = { width, height };
    const bufferToUse = sharedBufferView;

    const isDirty = (region, padding = 0) => {
      if (!region || region.width <= 0 || region.height <= 0) return false;
      const ex = region.x - padding;
      const ey = region.y - padding;
      const ew = region.width + 2 * padding;
      const eh = region.height + 2 * padding;
      const expanded = { x: ex, y: ey, width: ew, height: eh };
      return dirtyRects.some((dr) => rectsIntersect(expanded, dr));
    };

    // Fallback thresholds (ms)
    const FALLBACK = {
      healthBar: 300,
      manaBar: 300,
      cooldownBar: 120,
      statusBar: 150, // Reduced from 300ms for faster status effect detection
      equip: 500,
      hotkeyBar: 100, // Reduced to 50ms for faster detection of item changes/disappearances
    };
    const MIN_HOTKEY_INTERVAL_MS = 100; // Reduced for faster response to changes
    const HOTKEY_BAR_PADDING = 4; // Pixels to expand intersection check for edge cases

    const scanIfNeeded = async () => {
      // Health percentage with robust checksum gating
      const hbDirty = isDirty(regions.healthBar);
      if (
        hbDirty ||
        now - lastScanTs.healthBar > FALLBACK.healthBar ||
        !hasScannedInitially
      ) {
        const ck = computeBarChecksum(
          bufferToUse,
          width,
          regions.healthBar,
          94,
        );
        const checksumUnchanged = checksumsMatch(
          lastBarChecksums.healthBar,
          ck,
        );
        const withinFallback = now - lastScanTs.healthBar < FALLBACK.healthBar;
        // Skip calculation only if checksum is unchanged AND we're within fallback period AND we've scanned before
        const shouldSkip =
          checksumUnchanged && withinFallback && hasScannedInitially;
        if (!shouldSkip) {
          const hpValue = calculateHealthBar(
            bufferToUse,
            metadata,
            regions.healthBar,
          );
          // Validate returned value before storing
          if (hpValue >= 0 && hpValue <= 100) {
            lastCalculatedState.hppc = hpValue;
          } else if (hpValue === -1 && !hasScannedInitially) {
            // Allow -1 only on initial scan (indicates calculation error)
            lastCalculatedState.hppc = null;
          }
          // If invalid but we've scanned before, keep the last valid value
          lastScanTs.healthBar = now;
          lastBarChecksums.healthBar = ck;
        }
      }

      // Mana percentage with robust checksum gating
      const mbDirty = isDirty(regions.manaBar);
      if (
        mbDirty ||
        now - lastScanTs.manaBar > FALLBACK.manaBar ||
        !hasScannedInitially
      ) {
        const ck = computeBarChecksum(bufferToUse, width, regions.manaBar, 94);
        const checksumUnchanged = checksumsMatch(lastBarChecksums.manaBar, ck);
        const withinFallback = now - lastScanTs.manaBar < FALLBACK.manaBar;
        // Skip calculation only if checksum is unchanged AND we're within fallback period AND we've scanned before
        const shouldSkip =
          checksumUnchanged && withinFallback && hasScannedInitially;
        if (!shouldSkip) {
          const mpValue = calculateManaBar(
            bufferToUse,
            metadata,
            regions.manaBar,
          );
          // Validate returned value before storing
          if (mpValue >= 0 && mpValue <= 100) {
            lastCalculatedState.mppc = mpValue;
          } else if (mpValue === -1 && !hasScannedInitially) {
            // Allow -1 only on initial scan (indicates calculation error)
            lastCalculatedState.mppc = null;
          }
          // If invalid but we've scanned before, keep the last valid value
          lastScanTs.manaBar = now;
          lastBarChecksums.manaBar = ck;
        }
      }

      // Cooldowns
      const cdDirty = isDirty(regions.cooldownBar);
      if (
        cdDirty ||
        now - lastScanTs.cooldownBar > FALLBACK.cooldownBar ||
        !hasScannedInitially
      ) {
        Object.assign(
          lastCalculatedState,
          calculateCooldowns(regions.cooldownBar),
        );
        lastScanTs.cooldownBar = now;
      }

      // Character status
      const sbDirty = isDirty(regions.statusBar);
      if (
        sbDirty ||
        now - lastScanTs.statusBar > FALLBACK.statusBar ||
        !hasScannedInitially
      ) {
        lastCalculatedState.characterStatus = calculateCharacterStatus(
          regions.statusBar,
        );
        lastScanTs.statusBar = now;
      }

      // Equipped items (amulet/ring/boots)
      const equipDirty =
        isDirty(regions.amuletSlot) ||
        isDirty(regions.ringSlot) ||
        isDirty(regions.bootsSlot);
      if (
        equipDirty ||
        now - lastScanTs.equip > FALLBACK.equip ||
        !hasScannedInitially
      ) {
        lastCalculatedState.equippedItems = calculateEquippedItems(
          regions.amuletSlot,
          regions.ringSlot,
          regions.bootsSlot,
        );
        lastScanTs.equip = now;
      }

      // Hotkey bar action items (heaviest) - Enhanced with better accumulation and forced scans
      const hkDirty = isDirty(regions.hotkeyBar, HOTKEY_BAR_PADDING);
      const hkSince = now - lastScanTs.hotkeyBar;
   
      // Force scan more frequently for hotkey bar to catch disappearances reliably
      // Scan if: dirty intersection, fallback interval, initial scan
      if (
        hkDirty ||
        hkSince > FALLBACK.hotkeyBar ||
        !hasScannedInitially
      ) {
        let searchArea = regions.hotkeyBar;
        lastCalculatedState.activeActionItems =
          await calculateActiveActionItems(
            searchArea,
            bufferToUse,
            metadata,
          );
  
        const scanTime = Date.now();
        for (const name of Object.keys(actionBarItems)) {
          const detectedItem = lastCalculatedState.activeActionItems[name];
          if (detectedItem) {
            const count = isStackableItem(name) ? (detectedItem.count || 0) : 1;
            let history = itemHistory.get(name) || [];
            history.push({timestamp: scanTime, count});
            // Prune old history (keep last 10 entries, ~500ms at 50ms ticks)
            if (history.length > 10) history = history.slice(-10);
            itemHistory.set(name, history);
          }
        }
   
        lastScanTs.hotkeyBar = now;
      }
    };

    await scanIfNeeded();

    // Read monsterNum directly from SAB for zero-latency updates
    if (sabInterface) {
      try {
        const battleListData = sabInterface.get('battleList');
        lastCalculatedState.monsterNum = battleListData?.data?.length || 0;
      } catch (error) {
        console.error(
          '[ScreenMonitor] Error reading battleList from SAB:',
          error,
        );
        // Fallback to Redux state
        lastCalculatedState.monsterNum =
          currentState.battleList?.entriesCount || 0;
      }
    } else {
      // Fallback to Redux state if SAB not available
      lastCalculatedState.monsterNum =
        currentState.battleList?.entriesCount || 0;
    }

    // Write activeActionItems with counts to SAB for Lua access
    if (sabInterface && lastCalculatedState.activeActionItems) {
      try {
        const actionItemsData = Object.entries(lastCalculatedState.activeActionItems)
          .map(([name, item]) => ({
            name,
            count: item.count || 0,
          }));
        sabInterface.set('actionItems', actionItemsData, { lastUpdateTimestamp: now });
      } catch (error) {
        console.error('[ScreenMonitor] Error writing actionItems to SAB:', error);
      }
    }

    // Always update item cache every frame for time-based filtering (even when skipping scan)
    const currentTime = Date.now();
    const allItemsData = {};
    for (const name of Object.keys(actionBarItems)) {
      let history = itemHistory.get(name) || [];
      const recentHistory = history.filter(h => currentTime - h.timestamp < 6000);
      let effective;
      const detectedItem = lastCalculatedState.activeActionItems[name];
      const isHotkeyFresh = currentTime - lastScanTs.hotkeyBar < 500;
      const isDetected = isHotkeyFresh && !!detectedItem;
      if (isDetected) {
        const count = isStackableItem(name) ? (detectedItem.count || 0) : 1;
        effective = count;
      } else {
        if (history.length === 0) {
          effective = 0;
        } else if (recentHistory.some(h => h.count > 0)) {
          const recentPositives = recentHistory.filter(h => h.count > 0);
          effective = recentPositives[recentPositives.length - 1].count;
        } else {
          effective = 0;
        }
      }
      allItemsData[name] = effective;
    }

    lastCalculatedState.isWalking = calculateWalkingState();

    // Build new payload
    const newPayload = {
      hppc: lastCalculatedState.hppc,
      mppc: lastCalculatedState.mppc,
      monsterNum: lastCalculatedState.monsterNum,
      partyMembers: lastCalculatedState.partyMembers,
      healingCd: lastCalculatedState.healingCd,
      supportCd: lastCalculatedState.supportCd,
      attackCd: lastCalculatedState.attackCd,
      characterStatus: lastCalculatedState.characterStatus,
      isWalking: lastCalculatedState.isWalking,
      activeActionItems: lastCalculatedState.activeActionItems,
      equippedItems: lastCalculatedState.equippedItems,
      itemCache: allItemsData,
    };

    // Only send update if payload actually changed (deep comparison)
    const payloadChanged =
      !lastSentPayload ||
      newPayload.hppc !== lastSentPayload.hppc ||
      newPayload.mppc !== lastSentPayload.mppc ||
      newPayload.monsterNum !== lastSentPayload.monsterNum ||
      newPayload.healingCd !== lastSentPayload.healingCd ||
      newPayload.supportCd !== lastSentPayload.supportCd ||
      newPayload.attackCd !== lastSentPayload.attackCd ||
      newPayload.isWalking !== lastSentPayload.isWalking ||
      JSON.stringify(newPayload.characterStatus) !==
        JSON.stringify(lastSentPayload.characterStatus) ||
      JSON.stringify(newPayload.partyMembers) !==
        JSON.stringify(lastSentPayload.partyMembers) ||
      JSON.stringify(newPayload.activeActionItems) !==
        JSON.stringify(lastSentPayload.activeActionItems) ||
      JSON.stringify(newPayload.equippedItems) !==
        JSON.stringify(lastSentPayload.equippedItems) ||
      JSON.stringify(newPayload.itemCache) !==
        JSON.stringify(lastSentPayload?.itemCache || {});

    if (payloadChanged || !hasScannedInitially) {
      reusableGameStateUpdate.payload = newPayload;
      parentPort.postMessage(reusableGameStateUpdate);
      lastSentPayload = newPayload;
    }

    hasScannedInitially = true;

    if (currentState?.rules?.enabled && currentState.gameState) {
      runRules({
        ...currentState.gameState,
        ...lastCalculatedState,
        rulesEnabled: true,
      });
    }
  } catch (error) {
    console.error('[ScreenMonitor] Error in processGameState:', error);
  }
}

async function mainLoop() {
  console.log('[ScreenMonitor] Starting main loop...');
  while (!isShuttingDown) {
    const loopStart = performance.now();
    try {
      await processGameState();
    } catch (error) {
      console.error('[ScreenMonitor] Error in main loop:', error);
      await delay(Math.max(SCAN_INTERVAL_MS * 2, 100));
      continue;
    }
    const elapsedTime = performance.now() - loopStart;
    const delayTime = Math.max(0, SCAN_INTERVAL_MS - elapsedTime);
    if (delayTime > 0) await delay(delayTime);
  }
  console.log('[ScreenMonitor] Main loop stopped.');
}

parentPort.on('message', (message) => {
  try {
    if (message.type === 'frame-update') {
      frameUpdateManager.addDirtyRects(message.payload.dirtyRects);
      return;
    }

    if (message.type === 'window_changed') {
      // Window has changed - reset initial scan flags to force full scan on first frame
      console.log('[ScreenMonitor] Window changed, resetting initial scan state');
      hasScannedInitially = false;
      lastBarChecksums.healthBar = null;
      lastBarChecksums.manaBar = null;
      lastBarChecksums.hotkeyBar = null;
      lastSentPayload = null;
      // Reset scan timestamps to force immediate scan
      Object.keys(lastScanTs).forEach(key => lastScanTs[key] = 0);
      return;
    }

    if (message.type === 'shutdown') {
      isShuttingDown = true;
    } else if (message.type === 'state_diff') {
      if (!currentState) currentState = {};
      const payload = message.payload || {};
      if (payload.regionCoordinates) {
        const rc = payload.regionCoordinates;
        if (typeof rc.version === 'number' && !rc.regions) {
          if (!currentState.regionCoordinates)
            currentState.regionCoordinates = {};
          if (currentState.regionCoordinates.version !== rc.version) {
            currentState.regionCoordinates.version = rc.version;
            regionsStale = true;
          }
          delete payload.regionCoordinates;
        }
      }
      Object.assign(currentState, payload);
      if (payload.regionCoordinates) {
        hasScannedInitially = false;
      }
    } else if (message.type === 'regions_snapshot') {
      if (!currentState) currentState = {};
      currentState.regionCoordinates = message.payload;
      regionsStale = false;
      hasScannedInitially = false;
      // Reset checksums when regions change to force fresh calculation
      lastBarChecksums.healthBar = null;
      lastBarChecksums.manaBar = null;
      lastBarChecksums.hotkeyBar = null;
      // Reset last sent payload to force update on next scan
      lastSentPayload = null;
    } else if (typeof message === 'object' && !message.type) {
      currentState = message;
      if (!isInitialized) initializeWorker();
    }
  } catch (error) {
    console.error('[ScreenMonitor] Error handling message:', error);
  }
});

async function startWorker() {
  console.log('[ScreenMonitor] Worker starting up...');
  mainLoop().catch((error) => {
    console.error('[ScreenMonitor] Fatal error in main loop:', error);
    process.exit(1);
  });
}

startWorker();
