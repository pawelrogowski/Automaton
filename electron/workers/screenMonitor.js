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
  if (!isInitialized || !currentState?.regionCoordinates?.regions) return;

  try {
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
    Object.assign(lastCalculatedState, calculateCooldowns(regions.cooldownBar));
    lastCalculatedState.characterStatus = calculateCharacterStatus(
      regions.statusBar,
    );
    lastCalculatedState.equippedItems = calculateEquippedItems(
      regions.amuletSlot,
      regions.ringSlot,
      regions.bootsSlot,
    );
    lastCalculatedState.activeActionItems = await calculateActiveActionItems(
      regions.hotkeyBar,
      bufferToUse,
      metadata
    );

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
      Object.assign(currentState, message.payload);
      if (message.payload.regionCoordinates) {
        hasScannedInitially = false;
      }
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
