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
import { rectsIntersect } from '../utils/rectsIntersect.js';

const { sharedData } = workerData;
const SCAN_INTERVAL_MS = 50;

if (!sharedData) throw new Error('[ScreenMonitor] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const sharedBufferView = Buffer.from(imageSAB);

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
    topRow: 0,      // Top edge of bar
    middleRow: 0,   // Middle of bar
    bottomRow: 0,   // Bottom edge of bar
    colorHist: {},  // Histogram of unique colors
    transitionCount: 0, // Number of color transitions (edge detection)
  };
  
  // Sample three horizontal lines through the bar
  const rows = [
    Math.floor(startY + height * 0.25),  // Upper quarter
    Math.floor(startY + height * 0.5),   // Middle
    Math.floor(startY + height * 0.75),  // Lower quarter
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
      const pixelHash = (r * 16777619) ^ (g * 16777619) ^ (b * 16777619) ^ (i * 2654435761);
      checksumParts[rowKeys[rowIdx]] = (checksumParts[rowKeys[rowIdx]] + pixelHash) >>> 0;
      
      // Color histogram (only for middle row to reduce overhead)
      if (rowIdx === 1) {
        const colorKey = `${r},${g},${b}`;
        checksumParts.colorHist[colorKey] = (checksumParts.colorHist[colorKey] || 0) + 1;
        
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
    composite: (
      checksumParts.topRow ^ 
      (checksumParts.middleRow << 5) ^ 
      (checksumParts.bottomRow << 10) ^
      (histHash << 15) ^
      (checksumParts.transitionCount << 20)
    ) >>> 0,
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
  return ck1.top === ck2.top &&
         ck1.mid === ck2.mid &&
         ck1.bot === ck2.bot &&
         ck1.hist === ck2.hist &&
         ck1.trans === ck2.trans;
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
  const currentPreset = rules.presets?.[rules.activePresetIndex];
  if (!currentPreset) return;
  if (!regionCoordinates?.regions || Object.keys(regionCoordinates.regions).length === 0) return;
  try {
    ruleProcessorInstance.processRules(currentPreset, ruleInput, {
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
            occurrence: "first",
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
        }
    }
    return foundItems;
}


async function calculateActiveActionItems(hotkeyBarRegion, bufferToUse, metadata) {
    return await findActionItemsInHotkeyBar(hotkeyBarRegion, bufferToUse, metadata);
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

  try {
    const now = Date.now();
    // Coalesce dirty rectangles to reduce intersection checks
    const rawDirty = [...frameUpdateManager.accumulatedDirtyRects];
    frameUpdateManager.accumulatedDirtyRects.length = 0;

    const coalesceRects = (rects) => {
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
            const ix = !(r.x + r.width < o.x || o.x + o.width < r.x || r.y + r.height < o.y || o.y + o.height < r.y);
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

    const dirtyRects = coalesceRects(rawDirty);
    const anyDirty = dirtyRects.length > 0;

    if (!hasScannedInitially && !anyDirty) {
      lastCalculatedState.isWalking = calculateWalkingState();
      if (currentState?.rules?.enabled && currentState.gameState) {
        runRules({
          ...currentState.gameState,
          ...lastCalculatedState,
          rulesEnabled: true,
        });
      }
      return;
    }

    if (Atomics.load(syncArray, IS_RUNNING_INDEX) === 0) return;

    const width = Atomics.load(syncArray, WIDTH_INDEX);
    const height = Atomics.load(syncArray, HEIGHT_INDEX);
    // If regions are stale, request snapshot but keep using cached regions
    if (regionsStale && typeof version === 'number' && version !== lastRequestedRegionsVersion) {
      parentPort.postMessage({ type: 'request_regions_snapshot' });
      lastRequestedRegionsVersion = version;
    }

    if (Object.keys(regions).length === 0 || width <= 0 || height <= 0) return;

    const metadata = { width, height };
    const bufferToUse = sharedBufferView;

    const isDirty = (region) =>
      !!region && dirtyRects.some((dr) => rectsIntersect(region, dr));

    // Fallback thresholds (ms)
    const FALLBACK = {
      healthBar: 300,
      manaBar: 300,
      cooldownBar: 120,
      statusBar: 300,
      equip: 500,
      hotkeyBar: 250,
    };
    const MIN_HOTKEY_INTERVAL_MS = 100;

    const scanIfNeeded = async () => {
      // Health percentage with robust checksum gating
      const hbDirty = isDirty(regions.healthBar);
      if (hbDirty || now - lastScanTs.healthBar > FALLBACK.healthBar || !hasScannedInitially) {
        const ck = computeBarChecksum(bufferToUse, width, regions.healthBar, 94);
        const checksumUnchanged = checksumsMatch(lastBarChecksums.healthBar, ck);
        const withinFallback = now - lastScanTs.healthBar < FALLBACK.healthBar;
        // Skip calculation only if checksum is unchanged AND we're within fallback period AND we've scanned before
        const shouldSkip = checksumUnchanged && withinFallback && hasScannedInitially;
        if (!shouldSkip) {
          const hpValue = calculateHealthBar(bufferToUse, metadata, regions.healthBar);
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
      if (mbDirty || now - lastScanTs.manaBar > FALLBACK.manaBar || !hasScannedInitially) {
        const ck = computeBarChecksum(bufferToUse, width, regions.manaBar, 94);
        const checksumUnchanged = checksumsMatch(lastBarChecksums.manaBar, ck);
        const withinFallback = now - lastScanTs.manaBar < FALLBACK.manaBar;
        // Skip calculation only if checksum is unchanged AND we're within fallback period AND we've scanned before
        const shouldSkip = checksumUnchanged && withinFallback && hasScannedInitially;
        if (!shouldSkip) {
          const mpValue = calculateManaBar(bufferToUse, metadata, regions.manaBar);
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
      if (cdDirty || now - lastScanTs.cooldownBar > FALLBACK.cooldownBar || !hasScannedInitially) {
        Object.assign(lastCalculatedState, calculateCooldowns(regions.cooldownBar));
        lastScanTs.cooldownBar = now;
      }

      // Character status
      const sbDirty = isDirty(regions.statusBar);
      if (sbDirty || now - lastScanTs.statusBar > FALLBACK.statusBar || !hasScannedInitially) {
        lastCalculatedState.characterStatus = calculateCharacterStatus(regions.statusBar);
        lastScanTs.statusBar = now;
      }

      // Equipped items (amulet/ring/boots)
      const equipDirty =
        isDirty(regions.amuletSlot) || isDirty(regions.ringSlot) || isDirty(regions.bootsSlot);
      if (equipDirty || now - lastScanTs.equip > FALLBACK.equip || !hasScannedInitially) {
        lastCalculatedState.equippedItems = calculateEquippedItems(
          regions.amuletSlot,
          regions.ringSlot,
          regions.bootsSlot,
        );
        lastScanTs.equip = now;
      }

      // Hotkey bar action items (heaviest)
      const hkDirty = isDirty(regions.hotkeyBar);
      const hkSince = now - lastScanTs.hotkeyBar;
      if ((hkDirty && hkSince > MIN_HOTKEY_INTERVAL_MS) || hkSince > FALLBACK.hotkeyBar || !hasScannedInitially) {
        lastCalculatedState.activeActionItems = await calculateActiveActionItems(
          regions.hotkeyBar,
          bufferToUse,
          metadata,
        );
        lastScanTs.hotkeyBar = now;
      }
    };

    await scanIfNeeded();

    // Correctly calculate monsterNum from the battleList state.
    lastCalculatedState.monsterNum =
      currentState.battleList?.entriesCount || 0;
    lastCalculatedState.isWalking = calculateWalkingState();

    reusableGameStateUpdate.payload = {
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
    };
    parentPort.postMessage(reusableGameStateUpdate);

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

    if (message.type === 'shutdown') {
      isShuttingDown = true;
    } else if (message.type === 'state_diff') {
      if (!currentState) currentState = {};
      const payload = message.payload || {};
      if (payload.regionCoordinates) {
        const rc = payload.regionCoordinates;
        if (typeof rc.version === 'number' && !rc.regions) {
          if (!currentState.regionCoordinates) currentState.regionCoordinates = {};
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
