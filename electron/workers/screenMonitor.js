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
  resourceBars,
  cooldownColorSequences,
  battleListSequences,
} from '../constants/index.js';
import { setBattleListEntries } from '../../frontend/redux/slices/battleListSlice.js';
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
let lastKnownPlayerMinimapPosition = { x: 0, y: 0, z: 0 }; // Initialize with a default
let lastMovementTimestamp = 0; // New variable to track last movement
const WALKING_STICKY_DURATION_MS = 750; // 750ms duration for isWalking to stay true
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

  const partyEntryRegions = calculatePartyEntryRegions(
    { x: 0, y: 0 },
    maxEntries,
  );
  for (let i = 0; i < partyEntryRegions.length; i++) {
    const entry = partyEntryRegions[i];
    const absoluteBarCoords = {
      x: partyListRegion.x + entry.bar.x,
      y: partyListRegion.y + entry.bar.y,
    };
    const hppc = calculatePartyHpPercentage(
      buffer,
      metadata,
      absoluteBarCoords,
      resourceBars.partyEntryHpBar,
      130,
    );
    if (hppc >= 0) {
      partyData.push({
        id: i,
        hppc,
        uhCoordinates: entry.uhCoordinates,
        isActive: true,
      });
    }
  }
  return partyData;
}

function runRules(ruleInput) {
  const currentPreset =
    state?.rules?.presets?.[state?.rules?.activePresetIndex];
  if (!currentPreset) return;
  try {
    console.log(state.global);
    ruleProcessorInstance.processRules(currentPreset, ruleInput, {
      ...state.global,
      isOnline: state?.regionCoordinates.regions.onlineMarker ?? false,
    });
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
      if (
        newFrameCounter > lastProcessedFrameCounter &&
        state?.regionCoordinates?.regions
      ) {
        if (Atomics.load(syncArray, IS_RUNNING_INDEX) !== 0) {
          const width = Atomics.load(syncArray, WIDTH_INDEX);
          const height = Atomics.load(syncArray, HEIGHT_INDEX);
          const { regions } = state.regionCoordinates;

          // Ensure we have regions to work with and the frame dimensions are valid.
          if (Object.keys(regions).length > 0 && width > 0 && height > 0) {
            lastProcessedFrameCounter = newFrameCounter;

            const metadata = { width, height, frameCounter: newFrameCounter };
            const bufferSize = HEADER_SIZE + width * height * 4;

            // Use the sharedBufferView directly. The native modules are designed to work with SABs.
            const bufferToUse = sharedBufferView;

            // --- Start of Analysis Cycle ---

            const searchTasks = {};
            if (regions.cooldowns)
              searchTasks.cooldowns = {
                sequences: cooldownColorSequences,
                searchArea: regions.cooldowns,
                occurrence: 'first',
              };
            if (regions.battleList)
              searchTasks.battleList = {
                sequences: { battleEntry: battleListSequences.battleEntry },
                searchArea: regions.battleList,
                occurrence: 'all',
              };

            const searchResults = findSequences.findSequencesNativeBatch(
              bufferToUse,
              searchTasks,
            );

            const { newHealthPercentage, newManaPercentage } =
              regions.healthBar && regions.manaBar
                ? {
                    newHealthPercentage: calculatePercentages(
                      bufferToUse,
                      metadata,
                      regions.healthBar,
                      resourceBars.healthBar,
                      94,
                    ),
                    newManaPercentage: calculatePercentages(
                      bufferToUse,
                      metadata,
                      regions.manaBar,
                      resourceBars.manaBar,
                      94,
                    ),
                  }
                : {
                    newHealthPercentage: lastKnownGoodHealthPercentage,
                    newManaPercentage: lastKnownGoodManaPercentage,
                  };
            lastKnownGoodHealthPercentage =
              newHealthPercentage ?? lastKnownGoodHealthPercentage;
            lastKnownGoodManaPercentage =
              newManaPercentage ?? lastKnownGoodManaPercentage;

            const currentCooldowns = searchResults.cooldowns || {};
            const healingCd = cooldownManager.updateCooldown(
              'healing',
              !!currentCooldowns.healing,
            );
            const supportCd = cooldownManager.updateCooldown(
              'support',
              !!currentCooldowns.support,
            );
            const attackCd = cooldownManager.updateCooldown(
              'attack',
              !!currentCooldowns.attack,
            );
            if (currentCooldowns.attackInactive)
              cooldownManager.forceDeactivate('attack');
            if (currentCooldowns.healingInactive)
              cooldownManager.forceDeactivate('healing');
            if (currentCooldowns.supportInactive)
              cooldownManager.forceDeactivate('support');

            const characterStatus = {};
            if (regions.statusBar?.children) {
              Object.keys(regions.statusBar.children).forEach((key) => {
                characterStatus[key] = !!regions.statusBar.children[key].x;
              });
            }

            const getEquippedItem = (slotRegion) => {
              if (!slotRegion?.children) return 'Unknown';

              const foundItems = Object.entries(slotRegion.children)
                .filter(
                  ([key, child]) =>
                    child && child.x !== undefined && child.y !== undefined,
                )
                .map(([key]) => key);

              if (foundItems.length === 0) return 'Empty';

              // Handle empty slot detection
              const emptySlot = foundItems.find((item) =>
                item.includes('empty'),
              );
              if (emptySlot) return 'Empty';

              // Return the first non-empty item found
              const actualItem = foundItems.find(
                (item) => !item.includes('empty'),
              );
              return actualItem || 'Empty';
            };

            const equippedItemsResult = {
              amulet: getEquippedItem(regions.amuletSlot),
              ring: getEquippedItem(regions.ringSlot),
              boots: getEquippedItem(regions.bootsSlot),
            };

            const hasPositionChanged =
              state.gameState.playerMinimapPosition.x !==
                lastKnownPlayerMinimapPosition.x ||
              state.gameState.playerMinimapPosition.y !==
                lastKnownPlayerMinimapPosition.y ||
              state.gameState.playerMinimapPosition.z !==
                lastKnownPlayerMinimapPosition.z;

            if (hasPositionChanged) {
              lastMovementTimestamp = performance.now();
            }

            const isWalking =
              hasPositionChanged ||
              performance.now() - lastMovementTimestamp <
                WALKING_STICKY_DURATION_MS;

            lastKnownPlayerMinimapPosition = {
              ...state.gameState.playerMinimapPosition,
            }; // Update for next cycle

            const currentStateUpdate = {
              hppc: lastKnownGoodHealthPercentage,
              mppc: lastKnownGoodManaPercentage,
              healingCd,
              supportCd,
              attackCd,
              characterStatus,
              partyMembers: getPartyData(
                regions.partyList,
                bufferToUse,
                metadata,
              ),
              isWalking, // Set isWalking based on minimap position change and sticky duration
              activeActionItems: regions.hotkeyBar?.children
                ? Object.fromEntries(
                    Object.entries(regions.hotkeyBar.children)
                      .filter(
                        ([, child]) =>
                          child &&
                          child.x !== undefined &&
                          child.y !== undefined,
                      )
                      .map(([key, child]) => [key, child]),
                  )
                : {},
              equippedItems: equippedItemsResult,
              rulesEnabled: state?.rules?.enabled ?? false,
            };

            // Process Battle List Entries
            const battleListEntries =
              regions.battleList?.children?.entries?.list || [];
            const uiBattleListNames = state.uiValues?.battleListEntries || [];

            const processedBattleListEntries = battleListEntries.map(
              (entry, index) => {
                const health = calculatePercentages(
                  bufferToUse,
                  metadata,
                  entry.healthBarFill, // Use healthBarFill for scanning colors
                  resourceBars.partyEntryHpBar, // Using partyEntryHpBar colors for battle list health
                  entry.healthBarFill.width, // Use healthBarFull.width as the total width for percentage
                );
                return {
                  name: uiBattleListNames[index] || '', // Get name from uiValues
                  health: health >= 0 ? health : 0, // Ensure health is not negative
                  isTargeted: entry.isTargeted,
                  isAttacking: entry.isAttacking,
                  region: entry.healthBarFull, // Use healthBarFull as the region for the entry
                };
              },
            );

            parentPort.postMessage({
              storeUpdate: true,
              type: 'gameState/updateGameStateFromMonitorData',
              payload: currentStateUpdate,
            });

            parentPort.postMessage({
              storeUpdate: true,
              type: setBattleListEntries.type,
              payload: processedBattleListEntries,
            });

            if (state?.rules?.enabled) runRules(currentStateUpdate);

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

// --- [MODIFIED] --- Updated message handler for new state management model.
parentPort.on('message', (message) => {
  if (message.type === 'state_diff') {
    // Merge the incoming changed slices into the local state.
    state = { ...state, ...message.payload };
  } else if (message.type === undefined) {
    // This is the initial, full state object sent when the worker starts.
    state = message;
  }
});

function startWorker() {
  console.log('[ScreenMonitor] Worker starting up...');
  mainLoop();
}

startWorker();
