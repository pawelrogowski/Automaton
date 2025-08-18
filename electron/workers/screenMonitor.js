// /home/feiron/Dokumenty/Automaton/electron/workers/screenMonitor.js
import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { resourceBars } from '../constants/index.js';
import { setBattleListEntries } from '../../frontend/redux/slices/battleListSlice.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import RuleProcessor from './screenMonitor/ruleProcessor.js';
import { CooldownManager } from './screenMonitor/CooldownManager.js';
import { FrameUpdateManager } from '../utils/frameUpdateManager.js';

// --- Worker Configuration ---
const { sharedData } = workerData;
const SCAN_INTERVAL_MS = 50;
const PERFORMANCE_LOG_INTERVAL = 10000;

// --- Shared Buffer Setup ---
if (!sharedData) throw new Error('[ScreenMonitor] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const sharedBufferView = Buffer.from(imageSAB);

// --- SharedArrayBuffer Indices ---
const WIDTH_INDEX = 1;
const HEIGHT_INDEX = 2;
const IS_RUNNING_INDEX = 3;

// --- State Variables ---
let currentState = null;
let isShuttingDown = false;
let isInitialized = false;
let hasScannedInitially = false; // NEW: Flag for the initial scan

const cooldownManager = new CooldownManager();
const ruleProcessorInstance = new RuleProcessor();
const frameUpdateManager = new FrameUpdateManager();

// --- Performance Tracking ---
let operationCount = 0;
let totalOperationTime = 0;
let lastPerfReport = Date.now();

// --- Cached State ---
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
  battleList: [],
  lastMovementTimestamp: 0,
  lastKnownPlayerMinimapPosition: null,
  monsterNum: 0,
};

// --- Reusable objects ---
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function logPerformanceStats() {
  const now = Date.now();
  if (now - lastPerfReport >= PERFORMANCE_LOG_INTERVAL) {
    const avgOpTime =
      operationCount > 0 ? (totalOperationTime / operationCount).toFixed(2) : 0;
    const opsPerSecond = (
      (operationCount / (now - lastPerfReport)) *
      1000
    ).toFixed(1);
    console.log(
      `[ScreenMonitor] Performance: ${opsPerSecond} ops/sec (avg: ${avgOpTime}ms)`,
    );
    operationCount = 0;
    totalOperationTime = 0;
    lastPerfReport = now;
  }
}

function initializeWorker() {
  console.log('[ScreenMonitor] Initializing worker...');
  isInitialized = true;
}

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

// --- Calculation Functions (unchanged) ---
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
  return battleListEntries.map((entry, index) => ({
    name: uiBattleListNames[index] || '',
    health:
      calculatePercentages(
        bufferToUse,
        metadata,
        entry.healthBarFill,
        resourceBars.partyEntryHpBar,
        entry.healthBarFill.width,
      ) ?? 0,
    isTargeted: entry.isTargeted,
    isAttacking: entry.isAttacking,
    region: entry.healthBarFull,
  }));
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
  if (!isInitialized || !currentState?.regionCoordinates?.regions) return;

  const opStart = performance.now();
  try {
    // MODIFIED: Use the manager and the initial scan flag to decide if we should process
    if (!hasScannedInitially && !frameUpdateManager.shouldProcess()) {
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
    const { regions } = currentState.regionCoordinates;
    if (Object.keys(regions).length === 0 || width <= 0 || height <= 0) return;

    const metadata = { width, height };
    const bufferToUse = sharedBufferView;

    lastCalculatedState.hppc = calculateHealthBar(
      bufferToUse,
      metadata,
      regions.healthBar,
    );
    lastCalculatedState.mppc = calculateManaBar(
      bufferToUse,
      metadata,
      regions.manaBar,
    );
    Object.assign(lastCalculatedState, calculateCooldowns(regions.cooldowns));
    lastCalculatedState.characterStatus = calculateCharacterStatus(
      regions.statusBar,
    );
    lastCalculatedState.equippedItems = calculateEquippedItems(
      regions.amuletSlot,
      regions.ringSlot,
      regions.bootsSlot,
    );
    lastCalculatedState.activeActionItems = calculateActiveActionItems(
      regions.hotkeyBar,
    );
    lastCalculatedState.battleList = calculateBattleList(
      bufferToUse,
      metadata,
      regions.battleList,
    );
    lastCalculatedState.isWalking = calculateWalkingState();
    lastCalculatedState.monsterNum =
      regions.battleList?.children?.entries?.list?.length || 0;

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

    reusableBattleListUpdate.payload = lastCalculatedState.battleList;
    parentPort.postMessage(reusableBattleListUpdate);

    hasScannedInitially = true; // NEW: Set flag after the first successful scan

    if (currentState?.rules?.enabled && currentState.gameState) {
      runRules({
        ...currentState.gameState,
        ...lastCalculatedState,
        rulesEnabled: true,
      });
    }
  } catch (error) {
    console.error('[ScreenMonitor] Error in processGameState:', error);
  } finally {
    const opEnd = performance.now();
    operationCount++;
    totalOperationTime += opEnd - opStart;
  }
}

async function mainLoop() {
  console.log('[ScreenMonitor] Starting main loop...');
  while (!isShuttingDown) {
    const loopStart = performance.now();
    try {
      await processGameState();
      logPerformanceStats();
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
      Object.assign(currentState, message.payload);
      if (message.payload.regionCoordinates) {
        const { regions } = currentState.regionCoordinates;
        frameUpdateManager.setRegionsOfInterest(
          Object.values(regions).filter(Boolean),
        );
        hasScannedInitially = false; // NEW: Reset flag if regions change
      }
    } else if (typeof message === 'object' && !message.type) {
      currentState = message;
      if (message.regionCoordinates) {
        const { regions } = currentState.regionCoordinates;
        frameUpdateManager.setRegionsOfInterest(
          Object.values(regions).filter(Boolean),
        );
      }
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
