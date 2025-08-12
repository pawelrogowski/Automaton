/**
 * @file screenMonitor.js
 * @summary A dedicated worker for processing game state data from pre-identified screen regions.
 */

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { resourceBars } from '../constants/index.js';
import { setBattleListEntries } from '../../frontend/redux/slices/battleListSlice.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import RuleProcessor from './screenMonitor/ruleProcessor.js';
import { CooldownManager } from './screenMonitor/CooldownManager.js';
import { rectsIntersect } from './minimap/helpers.js';

// --- Worker Configuration ---
const { sharedData } = workerData;
const SCAN_INTERVAL_MS = 50;
const PERFORMANCE_LOG_INTERVAL = 10000; // Log performance every 10 seconds

// --- Shared Buffer Setup ---
if (!sharedData) throw new Error('[ScreenMonitor] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const sharedBufferView = Buffer.from(imageSAB);

// --- Correct SharedArrayBuffer Indices ---
const FRAME_COUNTER_INDEX = 0;
const WIDTH_INDEX = 1;
const HEIGHT_INDEX = 2;
const IS_RUNNING_INDEX = 3;
const DIRTY_REGION_COUNT_INDEX = 5;
const DIRTY_REGIONS_START_INDEX = 6;

// --- State Variables ---
let currentState = null;
let lastProcessedFrameCounter = -1;
let isShuttingDown = false;
let isInitialized = false;

const cooldownManager = new CooldownManager();
const ruleProcessorInstance = new RuleProcessor();
const initializedRegions = new Set();

// --- Performance Tracking ---
let operationCount = 0;
let calculationCount = 0;
let totalOperationTime = 0;
let totalCalculationTime = 0;
let lastPerfReport = Date.now();

// --- Cached State ---
let lastCalculatedState = {
  hppc: null,
  mppc: null,
  healingCd: { onCooldown: false, remaining: 0 },
  supportCd: { onCooldown: false, remaining: 0 },
  attackCd: { onCooldown: false, remaining: 0 },
  characterStatus: {},
  partyMembers: [],
  isWalking: false,
  activeActionItems: {},
  equippedItems: {},
  battleList: [],
  lastMovementTimestamp: 0,
  lastKnownPlayerMinimapPosition: null,
  monsterNum: 0,
};

// --- Reusable objects to reduce GC pressure ---
const reusableGameStateUpdate = {
  storeUpdate: true,
  type: 'gameState/updateGameStateFromMonitorData',
  payload: {},
};

const reusableBattleListUpdate = {
  storeUpdate: true,
  type: setBattleListEntries.type,
  payload: [],
};

// --- Utilities ---
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Performance Monitoring ---
function logPerformanceStats() {
  const now = Date.now();
  const timeSinceLastReport = now - lastPerfReport;

  if (timeSinceLastReport >= PERFORMANCE_LOG_INTERVAL) {
    const avgOpTime =
      operationCount > 0 ? (totalOperationTime / operationCount).toFixed(2) : 0;
    const avgCalcTime =
      calculationCount > 0
        ? (totalCalculationTime / calculationCount).toFixed(2)
        : 0;
    const opsPerSecond = (
      (operationCount / timeSinceLastReport) *
      1000
    ).toFixed(1);
    const calcsPerSecond = (
      (calculationCount / timeSinceLastReport) *
      1000
    ).toFixed(1);

    console.log(
      `[ScreenMonitor] Performance: ${opsPerSecond} ops/sec (avg: ${avgOpTime}ms), ` +
        `${calcsPerSecond} calcs/sec (avg: ${avgCalcTime}ms)`,
    );

    // Reset counters
    operationCount = 0;
    calculationCount = 0;
    totalOperationTime = 0;
    totalCalculationTime = 0;
    lastPerfReport = now;
  }
}

// --- Worker Initialization ---
function initializeWorker() {
  console.log('[ScreenMonitor] Initializing worker...');
  isInitialized = true;
}

// --- Rule Processing ---
function runRules(ruleInput) {
  const { rules, global, regionCoordinates } = currentState;
  if (!rules?.enabled) return;

  const currentPreset = rules.presets?.[rules.activePresetIndex];
  if (!currentPreset) return;

  try {
    ruleProcessorInstance.processRules(currentPreset, ruleInput, {
      ...global,
      isOnline: regionCoordinates?.regions?.onlineMarker ?? false,
    });
  } catch (error) {
    console.error('[ScreenMonitor] Rule processing error:', error);
  }
}

// --- Calculation Functions ---
function calculateHealthBar(bufferToUse, metadata, healthBarRegion) {
  if (!healthBarRegion) return lastCalculatedState.hppc;

  const calcStart = performance.now();
  const result = calculatePercentages(
    bufferToUse,
    metadata,
    healthBarRegion,
    resourceBars.healthBar,
    94,
  );
  const calcEnd = performance.now();

  calculationCount++;
  totalCalculationTime += calcEnd - calcStart;

  return result;
}

function calculateManaBar(bufferToUse, metadata, manaBarRegion) {
  if (!manaBarRegion) return lastCalculatedState.mppc;

  const calcStart = performance.now();
  const result = calculatePercentages(
    bufferToUse,
    metadata,
    manaBarRegion,
    resourceBars.manaBar,
    94,
  );
  const calcEnd = performance.now();

  calculationCount++;
  totalCalculationTime += calcEnd - calcStart;

  return result;
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

  // Handle inactive states
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

function calculateActiveActionItems(hotkeyBarRegion) {
  return hotkeyBarRegion?.children
    ? Object.fromEntries(
        Object.entries(hotkeyBarRegion.children).map(([key, child]) => [
          key,
          child,
        ]),
      )
    : {};
}

function calculateBattleList(bufferToUse, metadata, battleListRegion) {
  const battleListEntries = battleListRegion?.children?.entries?.list || [];
  const uiBattleListNames = currentState.uiValues?.battleListEntries || [];

  return battleListEntries.map((entry, index) => {
    const calcStart = performance.now();
    const health = calculatePercentages(
      bufferToUse,
      metadata,
      entry.healthBarFill,
      resourceBars.partyEntryHpBar,
      entry.healthBarFill.width,
    );
    const calcEnd = performance.now();

    calculationCount++;
    totalCalculationTime += calcEnd - calcStart;

    return {
      name: uiBattleListNames[index] || '',
      health: health >= 0 ? health : 0,
      isTargeted: entry.isTargeted,
      isAttacking: entry.isAttacking,
      region: entry.healthBarFull,
    };
  });
}

function calculateWalkingState() {
  const { gameState } = currentState;
  if (!gameState?.playerMinimapPosition) {
    return lastCalculatedState.isWalking;
  }

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

// --- Main Processing Function ---
async function processGameState() {
  if (!isInitialized || !currentState?.regionCoordinates?.regions) {
    return;
  }

  const opStart = performance.now();

  try {
    const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);

    if (newFrameCounter <= lastProcessedFrameCounter) {
      return; // No new frame to process
    }

    if (Atomics.load(syncArray, IS_RUNNING_INDEX) === 0) {
      return; // Capture not running
    }

    const width = Atomics.load(syncArray, WIDTH_INDEX);
    const height = Atomics.load(syncArray, HEIGHT_INDEX);
    const { regions } = currentState.regionCoordinates;
    if (Object.keys(regions).length === 0 || width <= 0 || height <= 0) {
      return; // No regions or invalid dimensions
    }

    // Destructure regions once for the frame to avoid repeated property access.
    const {
      healthBar,
      manaBar,
      cooldowns,
      statusBar,
      amuletSlot,
      ringSlot,
      bootsSlot,
      hotkeyBar,
      battleList,
    } = regions;

    lastProcessedFrameCounter = newFrameCounter;
    const metadata = { width, height, frameCounter: newFrameCounter };
    const bufferToUse = sharedBufferView;

    // --- Dirty Region Optimization ---
    const dirtyRegionCount = Atomics.load(syncArray, DIRTY_REGION_COUNT_INDEX);
    let hasPixelChanges =
      dirtyRegionCount === 0 && initializedRegions.size > 0 ? false : true;

    if (!hasPixelChanges) {
      const watchedRegions = Object.values(regions).filter(Boolean);
      for (let i = 0; i < dirtyRegionCount; i++) {
        const offset = DIRTY_REGIONS_START_INDEX + i * 4;
        const dirtyRect = {
          x: Atomics.load(syncArray, offset + 0),
          y: Atomics.load(syncArray, offset + 1),
          width: Atomics.load(syncArray, offset + 2),
          height: Atomics.load(syncArray, offset + 3),
        };

        if (dirtyRect.width > 0 && dirtyRect.height > 0) {
          for (const watched of watchedRegions) {
            if (rectsIntersect(watched, dirtyRect)) {
              hasPixelChanges = true;
              break;
            }
          }
        }
        if (hasPixelChanges) break;
      }
    }

    let hasUpdates = false;

    if (hasPixelChanges) {
      lastCalculatedState.hppc = calculateHealthBar(
        bufferToUse,
        metadata,
        healthBar,
      );
      lastCalculatedState.mppc = calculateManaBar(
        bufferToUse,
        metadata,
        manaBar,
      );
      const cooldownsResult = calculateCooldowns(cooldowns);
      Object.assign(lastCalculatedState, cooldownsResult);
      lastCalculatedState.characterStatus = calculateCharacterStatus(statusBar);
      lastCalculatedState.equippedItems = calculateEquippedItems(
        amuletSlot,
        ringSlot,
        bootsSlot,
      );
      lastCalculatedState.activeActionItems =
        calculateActiveActionItems(hotkeyBar);
      lastCalculatedState.battleList = calculateBattleList(
        bufferToUse,
        metadata,
        battleList,
      );
      hasUpdates = true;

      // Mark all regions as initialized after the first full calculation
      if (initializedRegions.size === 0) {
        Object.keys(regions).forEach((name) => initializedRegions.add(name));
      }
    }

    // Always calculate walking state and monster count (non-pixel based)
    lastCalculatedState.isWalking = calculateWalkingState();
    lastCalculatedState.monsterNum =
      battleList?.children?.entries?.list?.length || 0;

    // Send updates if we have changes
    if (hasUpdates || !initializedRegions.size) {
      // Update reusable game state object
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

      // Update battle list
      reusableBattleListUpdate.payload = lastCalculatedState.battleList;
      parentPort.postMessage(reusableBattleListUpdate);
    }

    // Run rules if enabled
    if (currentState?.rules?.enabled && currentState.gameState) {
      const ruleInput = {
        ...currentState.gameState,
        ...lastCalculatedState,
        rulesEnabled: true,
      };
      runRules(ruleInput);
    }
  } catch (error) {
    console.error('[ScreenMonitor] Error in processGameState:', error);
  } finally {
    const opEnd = performance.now();
    const opTime = opEnd - opStart;

    // Update performance stats
    operationCount++;
    totalOperationTime += opTime;

    // Log slow operations
    if (opTime > 25) {
      console.log(`[ScreenMonitor] Slow operation: ${opTime.toFixed(2)}ms`);
    }
  }
}

// --- Main Loop ---
async function mainLoop() {
  console.log('[ScreenMonitor] Starting main loop...');

  while (!isShuttingDown) {
    const loopStart = performance.now();

    try {
      await processGameState();
      logPerformanceStats();
    } catch (error) {
      console.error('[ScreenMonitor] Error in main loop:', error);
      // Wait longer on error to avoid tight error loops
      await delay(Math.max(SCAN_INTERVAL_MS * 2, 100));
      continue;
    }

    const loopEnd = performance.now();
    const elapsedTime = loopEnd - loopStart;
    const delayTime = Math.max(0, SCAN_INTERVAL_MS - elapsedTime);

    if (delayTime > 0) {
      await delay(delayTime);
    }
  }

  console.log('[ScreenMonitor] Main loop stopped.');
}

// --- Message Handler ---
parentPort.on('message', (message) => {
  try {
    if (message.type === 'state_diff') {
      // Handle state updates from WorkerManager
      if (!currentState) {
        currentState = {};
      }

      // Apply state diff
      Object.assign(currentState, message.payload);

      // Handle specific state changes
      if (message.payload.global) {
        const globalState = message.payload.global;

        // If window changed, reset initialized regions
        if (
          globalState.windowId !== undefined &&
          currentState.global?.windowId !== globalState.windowId
        ) {
          console.log(
            '[ScreenMonitor] Window changed, resetting calculations.',
          );
          initializedRegions.clear();
          lastProcessedFrameCounter = -1;
        }
      }

      // If regions changed, reset initialized regions
      if (message.payload.regionCoordinates) {
        // console.log('[ScreenMonitor] Regions updated, resetting calculations.');
        initializedRegions.clear();
        lastProcessedFrameCounter = -1;
      }
    } else if (message.type === 'shutdown') {
      console.log('[ScreenMonitor] Received shutdown command.');
      isShuttingDown = true;
    } else if (typeof message === 'object' && !message.type) {
      // Handle full state updates (initial state from WorkerManager)
      currentState = message;
      console.log('[ScreenMonitor] Received initial state update.');

      if (!isInitialized) {
        initializeWorker();
      }
    } else {
      console.log(
        '[ScreenMonitor] Received message:',
        message.type || 'unknown',
      );
    }
  } catch (error) {
    console.error('[ScreenMonitor] Error handling message:', error);
  }
});

// --- Worker Startup ---
async function startWorker() {
  console.log(
    '[ScreenMonitor] Worker starting up in hybrid calculation mode...',
  );

  // Handle graceful shutdown signals
  process.on('SIGTERM', () => {
    console.log('[ScreenMonitor] Received SIGTERM, shutting down...');
    isShuttingDown = true;
  });

  process.on('SIGINT', () => {
    console.log('[ScreenMonitor] Received SIGINT, shutting down...');
    isShuttingDown = true;
  });

  // Start the main loop
  mainLoop().catch((error) => {
    console.error('[ScreenMonitor] Fatal error in main loop:', error);
    process.exit(1);
  });
}

startWorker();
