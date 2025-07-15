/**
 * @file screenMonitor.js
 * @summary A dedicated worker for monitoring specific screen regions for game state changes.
 *
 * @description
 * This worker continuously analyzes specific, known regions of the screen to extract
 * real-time game state data (e.g., health, mana, cooldowns, status effects). It
 * relies on the `region-monitor` worker to first locate these regions.
 *
 * Key Architectural Decisions:
 * 1.  **CPU-Friendly Throttling:** The main loop is architected to "work-then-sleep".
 *     After each analysis cycle, it calculates the time remaining until the next
 *     interval and puts the worker thread to sleep. This ensures the worker consumes
 *     virtually zero CPU while idle, providing predictable performance.
 *
 * 2.  **Data Snapshotting:** To ensure data consistency for the entire analysis cycle,
 *     the worker creates a single, private copy (a "snapshot") of the shared screen
 *     buffer at the beginning of each loop. This prevents race conditions and memory
 *     accumulation from repeated `Buffer.from()` calls.
 *
 * 3.  **State-Driven:** The worker remains idle until it receives the necessary
 *     region coordinates from the main thread's global state. All operations are
 *     based on the last known good state.
 */

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import {
  regionColorSequences,
  resourceBars,
  cooldownColorSequences,
  statusBarSequences,
  battleListSequences,
  actionBarItems,
  equippedItems,
} from '../constants/index.js';
import { calculatePartyEntryRegions } from '../screenMonitor/calcs/calculatePartyEntryRegions.js';
import calculatePartyHpPercentage from '../screenMonitor/calcs/calculatePartyHpPercentage.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import RuleProcessor from './screenMonitor/ruleProcessor.js';
import { CooldownManager } from './screenMonitor/CooldownManager.js';
import findSequences from 'find-sequences-native';

// --- Worker Configuration ---
const { sharedData } = workerData;
const SCAN_INTERVAL_MS = 50; // ~23.8 FPS. The target time between scans.

// --- Shared Buffer Setup ---
if (!sharedData) throw new Error('[ScreenMonitor] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const FRAME_COUNTER_INDEX = 0,
  WIDTH_INDEX = 1,
  HEIGHT_INDEX = 2,
  IS_RUNNING_INDEX = 3;
const HEADER_SIZE = 8;

const sharedBufferView = Buffer.from(imageSAB);

// --- State Variables ---
let state = null;
let lastProcessedFrameCounter = -1;
let lastKnownGoodHealthPercentage = null;
let lastKnownGoodManaPercentage = null;
const cooldownManager = new CooldownManager();
const ruleProcessorInstance = new RuleProcessor();

// --- Self-Contained Utilities ---
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getPartyData(partyListRegion, buffer, metadata) {
  if (!partyListRegion || !buffer) return [];
  const partyData = [];
  const approxEntryHeight = 26;
  const maxEntries = Math.floor(partyListRegion.height / approxEntryHeight);
  if (maxEntries <= 0) return [];

  const partyEntryRegions = calculatePartyEntryRegions({ x: 0, y: 0 }, maxEntries);
  for (let i = 0; i < partyEntryRegions.length; i++) {
    const entry = partyEntryRegions[i];
    const absoluteBarCoords = { x: partyListRegion.x + entry.bar.x, y: partyListRegion.y + entry.bar.y };
    const hppc = calculatePartyHpPercentage(buffer, metadata, absoluteBarCoords, resourceBars.partyEntryHpBar, 130);
    if (hppc >= 0) {
      partyData.push({ id: i, hppc, uhCoordinates: entry.uhCoordinates, isActive: true });
    }
  }
  return partyData;
}

function runRules(ruleInput) {
  const currentPreset = state?.rules?.presets?.[state?.rules?.activePresetIndex];
  if (!currentPreset) return;
  try {
    ruleProcessorInstance.processRules(currentPreset, ruleInput, state.global);
  } catch (error) {
    console.error('Rule processing error:', error);
  }
}

/**
 * The main execution loop for the worker.
 */
async function mainLoop() {
  while (true) {
    const loopStartTime = performance.now();

    try {
      const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);

      // Only proceed if there's a new frame and we have the necessary state from the main thread.
      if (newFrameCounter > lastProcessedFrameCounter && state?.regionCoordinates?.regions) {
        if (Atomics.load(syncArray, IS_RUNNING_INDEX) !== 0) {
          const width = Atomics.load(syncArray, WIDTH_INDEX);
          const height = Atomics.load(syncArray, HEIGHT_INDEX);
          const { regions } = state.regionCoordinates;

          // Ensure we have regions to work with and the frame dimensions are valid.
          if (Object.keys(regions).length > 0 && width > 0 && height > 0) {
            lastProcessedFrameCounter = newFrameCounter;

            const metadata = { width, height, frameCounter: newFrameCounter };
            const bufferSize = HEADER_SIZE + width * height * 4;

            // Create a single, private snapshot of the buffer for this entire cycle.
            // This is the key fix for memory stability and data consistency.
            const bufferSnapshot = Buffer.alloc(bufferSize);
            sharedBufferView.copy(bufferSnapshot, 0, 0, bufferSize);

            // --- Start of Analysis Cycle ---

            const searchTasks = {};
            if (regions.cooldowns)
              searchTasks.cooldowns = { sequences: cooldownColorSequences, searchArea: regions.cooldowns, occurrence: 'first' };
            if (regions.statusBar)
              searchTasks.statusBar = { sequences: statusBarSequences, searchArea: regions.statusBar, occurrence: 'first' };
            if (regions.amuletSlot) searchTasks.amulet = { sequences: equippedItems, searchArea: regions.amuletSlot, occurrence: 'first' };
            if (regions.ringSlot) searchTasks.ring = { sequences: equippedItems, searchArea: regions.ringSlot, occurrence: 'first' };
            if (regions.bootsSlot) searchTasks.boots = { sequences: equippedItems, searchArea: regions.bootsSlot, occurrence: 'first' };
            if (regions.onlineMarker)
              searchTasks.onlineMarker = {
                sequences: { onlineMarker: regionColorSequences.onlineMarker },
                searchArea: regions.onlineMarker,
                occurrence: 'first',
              };
            if (regions.chatOff)
              searchTasks.chatOff = {
                sequences: { chatOff: regionColorSequences.chatOff },
                searchArea: regions.chatOff,
                occurrence: 'first',
              };
            if (regions.overallActionBars)
              searchTasks.actionItems = { sequences: actionBarItems, searchArea: regions.overallActionBars, occurrence: 'first' };
            if (regions.battleList)
              searchTasks.battleList = {
                sequences: { battleEntry: battleListSequences.battleEntry },
                searchArea: regions.battleList,
                occurrence: 'all',
              };

            const searchResults = findSequences.findSequencesNativeBatch(bufferSnapshot, searchTasks);

            const { newHealthPercentage, newManaPercentage } =
              regions.healthBar && regions.manaBar
                ? {
                    newHealthPercentage: calculatePercentages(bufferSnapshot, metadata, regions.healthBar, resourceBars.healthBar, 94),
                    newManaPercentage: calculatePercentages(bufferSnapshot, metadata, regions.manaBar, resourceBars.manaBar, 94),
                  }
                : { newHealthPercentage: lastKnownGoodHealthPercentage, newManaPercentage: lastKnownGoodManaPercentage };
            lastKnownGoodHealthPercentage = newHealthPercentage ?? lastKnownGoodHealthPercentage;
            lastKnownGoodManaPercentage = newManaPercentage ?? lastKnownGoodManaPercentage;

            const currentCooldowns = searchResults.cooldowns || {};
            const healingCd = cooldownManager.updateCooldown('healing', !!currentCooldowns.healing);
            const supportCd = cooldownManager.updateCooldown('support', !!currentCooldowns.support);
            const attackCd = cooldownManager.updateCooldown('attack', !!currentCooldowns.attack);
            if (currentCooldowns.attackInactive) cooldownManager.forceDeactivate('attack');
            if (currentCooldowns.healingInactive) cooldownManager.forceDeactivate('healing');
            if (currentCooldowns.supportInactive) cooldownManager.forceDeactivate('support');

            const characterStatus = {};
            Object.keys(statusBarSequences).forEach((key) => {
              characterStatus[key] = !!(searchResults.statusBar || {})[key];
            });

            const equippedItemsResult = {
              amulet: Object.keys(searchResults.amulet || {}).find((key) => searchResults.amulet[key] !== null) || 'Unknown',
              ring: Object.keys(searchResults.ring || {}).find((key) => searchResults.ring[key] !== null) || 'Unknown',
              boots: Object.keys(searchResults.boots || {}).find((key) => searchResults.boots[key] !== null) || 'Unknown',
            };
            if (equippedItemsResult.amulet === 'emptyAmuletSlot') equippedItemsResult.amulet = 'Empty';
            if (equippedItemsResult.ring === 'emptyRingSlot') equippedItemsResult.ring = 'Empty';
            if (equippedItemsResult.boots === 'emptyBootsSlot') equippedItemsResult.boots = 'Empty';

            const currentStateUpdate = {
              hppc: lastKnownGoodHealthPercentage,
              mppc: lastKnownGoodManaPercentage,
              healingCd,
              supportCd,
              attackCd,
              characterStatus,
              monsterNum: (searchResults.battleList?.battleEntry || []).length,
              partyMembers: getPartyData(regions.partyList, bufferSnapshot, metadata),
              activeActionItems: Object.fromEntries(Object.entries(searchResults.actionItems || {}).filter(([, val]) => val !== null)),
              equippedItems: equippedItemsResult,
              isLoggedIn: !!searchResults.onlineMarker?.onlineMarker,
              isChatOff: !!searchResults.chatOff?.chatOff,
            };
            parentPort.postMessage({ storeUpdate: true, type: 'gameState/updateGameStateFromMonitorData', payload: currentStateUpdate });

            if (state?.global?.isBotEnabled) runRules(currentStateUpdate);

            // --- End of Analysis Cycle ---
          }
        }
      }
    } catch (err) {
      console.error('[ScreenMonitor] Fatal error in main loop:', err);
    }

    // --- CPU-Friendly Throttling Logic ---
    const loopEndTime = performance.now();
    const elapsedTime = loopEndTime - loopStartTime;
    const delayTime = Math.max(0, SCAN_INTERVAL_MS - elapsedTime);

    if (delayTime > 0) {
      await delay(delayTime);
    }
  }
}

parentPort.on('message', (message) => {
  // The worker receives the full state from the main thread on every update.
  state = message;
});

function startWorker() {
  console.log('[ScreenMonitor] Worker starting up...');
  mainLoop();
}

startWorker();
