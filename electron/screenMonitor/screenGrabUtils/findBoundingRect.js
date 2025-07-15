/**
 * @file region-monitor.js
 * @summary A dedicated worker for continuously identifying UI elements on the screen.
 *
 * @description
 * This worker uses a "Scan-then-Monitor" state machine and is throttled to a
 * specific interval to ensure low CPU usage and high responsiveness. This version
 * treats all regions as equal and correctly validates multi-part regions.
 *
 * 1.  **CPU-Friendly Throttling:** The main loop is architected to "work-then-sleep".
 *     After each scan, it calculates the time remaining until the next interval
 *     and puts the worker thread to sleep, consuming virtually zero CPU while idle.
 *
 * 2.  **SEARCHING State (The Source of Truth):**
 *     On startup or after a change is detected, the worker performs a full-screen
 *     scan. This scan is the ONLY source of truth for the application's state. It
 *     dispatches the complete set of found regions. For bounding box regions, it now
 *     also caches the raw coordinates of the start/end sequences. If any verifiable
 *     regions are found, it transitions to the MONITORING state.
 *
 * 3.  **MONITORING State (The Validator and Re-Affirmer):**
 *     This state performs fast, targeted checks for all previously found verifiable
 *     regions. It is smart enough to validate both simple regions (by checking their
 *     raw position) and complex bounding-box regions (by checking the cached raw
 *     positions of their start/end sequences). If any part of any region has moved,
 *
 *     it switches back to SEARCHING. If all are stable, it re-dispatches the cached data.
 */

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { regionColorSequences } from '../constants/index.js';
import { setAllRegions } from '../../frontend/redux/slices/regionCoordinatesSlice.js';
// We need to import the original findBoundingRect to use it.
import { findBoundingRect } from '../screenMonitor/screenGrabUtils/findBoundingRect.js';
import { createRegion } from './screenMonitor/modules/utils.js';
import findSequences from 'find-sequences-native';

// --- Worker Configuration ---
const { sharedData } = workerData;
const SCAN_INTERVAL_MS = 42; // ~23.8 FPS. The target time between scan starts.

// --- Shared Buffer Setup ---
if (!sharedData) throw new Error('[RegionMonitor] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const FRAME_COUNTER_INDEX = 0,
  WIDTH_INDEX = 1,
  HEIGHT_INDEX = 2,
  IS_RUNNING_INDEX = 3;
const HEADER_SIZE = 8;

const sharedBufferView = Buffer.from(imageSAB);

// --- State Machine ---
let monitorState = 'SEARCHING';
let lastProcessedFrameCounter = -1;
let lastKnownRegions = null;

/**
 * A helper function to pause execution without busy-waiting.
 * @param {number} ms - The number of milliseconds to sleep.
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A wrapper around the original findBoundingRect that also returns the raw
 * coordinates of the start and end sequences for later validation.
 */
const findBoundingRectAndCacheRawPositions = (buffer, startSeqDef, endSeqDef, maxRight, maxDown) => {
  const result = findBoundingRect(findSequences.findSequencesNativeBatch, buffer, startSeqDef, endSeqDef, maxRight, maxDown);

  if (result.startFound) {
    const startResult = findSequences.findSequencesNativeBatch(buffer, {
      task: {
        sequences: { start: startSeqDef },
        searchArea: { x: 0, y: 0, width: metadata.width, height: metadata.height },
        occurrence: 'first',
      },
    }).task.start;
    if (startResult) {
      result.rawStartPos = { x: startResult.x - (startSeqDef.offset?.x || 0), y: startResult.y - (startSeqDef.offset?.y || 0) };
    }
  }
  if (result.endFound) {
    const endResult = findSequences.findSequencesNativeBatch(buffer, {
      task: {
        sequences: { end: endSeqDef },
        searchArea: { x: result.x, y: result.y, width: result.width, height: result.height },
        occurrence: 'first',
      },
    }).task.end;
    if (endResult) {
      result.rawEndPos = { x: endResult.x - (endSeqDef.offset?.x || 0), y: endResult.y - (endSeqDef.offset?.y || 0) };
    }
  }
  return result;
};

/**
 * Performs a full, expensive scan of the entire screen to find all regions.
 */
async function performFullScan(buffer, metadata) {
  const foundRegions = {};
  const searchArea = { x: 0, y: 0, width: metadata.width, height: metadata.height };
  try {
    const searchResults = findSequences.findSequencesNativeBatch(buffer, {
      main: { sequences: regionColorSequences, searchArea, occurrence: 'first' },
    });
    const startRegions = searchResults.main;
    if (startRegions) {
      if (startRegions.healthBar)
        foundRegions.healthBar = { x: startRegions.healthBar.x, y: startRegions.healthBar.y, width: 94, height: 14 };
      if (startRegions.manaBar) foundRegions.manaBar = { x: startRegions.manaBar.x, y: startRegions.manaBar.y, width: 94, height: 14 };
      if (startRegions.cooldownBar || startRegions.cooldownBarFallback)
        foundRegions.cooldowns = createRegion(startRegions.cooldownBar || startRegions.cooldownBarFallback, 56, 4);
      if (startRegions.statusBar) foundRegions.statusBar = createRegion(startRegions.statusBar, 104, 9);
      if (startRegions.amuletSlot) foundRegions.amuletSlot = createRegion(startRegions.amuletSlot, 32, 32);
      if (startRegions.ringSlot) foundRegions.ringSlot = createRegion(startRegions.ringSlot, 32, 32);
      if (startRegions.bootsSlot) foundRegions.bootsSlot = createRegion(startRegions.bootsSlot, 32, 32);
      if (startRegions.onlineMarker)
        foundRegions.onlineMarker = createRegion(startRegions.onlineMarker, 1, regionColorSequences.onlineMarker.sequence.length);
      if (startRegions.chatOff) foundRegions.chatOff = createRegion(startRegions.chatOff, regionColorSequences.chatOff.sequence.length, 1);
      if (startRegions.minimapFull) foundRegions.minimapFull = createRegion(startRegions.minimapFull, 106, 109);
      if (startRegions.minimapFloorIndicatorColumn)
        foundRegions.minimapFloorIndicatorColumn = createRegion(startRegions.minimapFloorIndicatorColumn, 2, 63);
      if (startRegions.preyWindow)
        foundRegions.preyWindow = { x: startRegions.preyWindow.x, y: startRegions.preyWindow.y, width: 657, height: 503 };

      const battleListRegion = findBoundingRectAndCacheRawPositions(
        buffer,
        regionColorSequences.battleListStart,
        regionColorSequences.battleListEnd,
        160,
        600,
      );
      if (battleListRegion?.startFound) foundRegions.battleList = battleListRegion;
      const partyListRegion = findBoundingRectAndCacheRawPositions(
        buffer,
        regionColorSequences.partyListStart,
        regionColorSequences.partyListEnd,
        160,
        200,
      );
      if (partyListRegion?.startFound) foundRegions.partyList = partyListRegion;
      const overallActionBarsRegion = findBoundingRectAndCacheRawPositions(
        buffer,
        regionColorSequences.hotkeyBarBottomStart,
        regionColorSequences.hotkeyBarBottomEnd,
        2000,
        100,
      );
      if (overallActionBarsRegion?.startFound) foundRegions.overallActionBars = overallActionBarsRegion;
      const skillsWidgetRegion = findBoundingRectAndCacheRawPositions(
        buffer,
        regionColorSequences.skillsWidgetStart,
        regionColorSequences.skillsWidgetEnd,
        170,
        1000,
      );
      if (skillsWidgetRegion?.startFound) foundRegions.skillsWidget = skillsWidgetRegion;
      const chatboxMainRegion = findBoundingRectAndCacheRawPositions(
        buffer,
        regionColorSequences.chatboxMainStart,
        regionColorSequences.chatboxMainEnd,
        1400,
        1000,
      );
      if (chatboxMainRegion?.startFound) foundRegions.chatboxMain = chatboxMainRegion;
      const chatboxSecondaryRegion = findBoundingRectAndCacheRawPositions(
        buffer,
        regionColorSequences.chatboxSecondaryStart,
        regionColorSequences.chatboxSecondaryEnd,
        1400,
        1000,
      );
      if (chatboxSecondaryRegion?.startFound) foundRegions.chatboxSecondary = chatboxSecondaryRegion;
      const gameWorldRegion = findBoundingRectAndCacheRawPositions(
        buffer,
        regionColorSequences.gameWorldStart,
        regionColorSequences.gameWorldEnd,
        metadata.width,
        metadata.height,
      );
      if (gameWorldRegion?.startFound && gameWorldRegion?.endFound) {
        foundRegions.gameWorld = gameWorldRegion;
        const TILES_HORIZONTAL = 15;
        const TILES_VERTICAL = 11;
        const tileWidth = Math.round(gameWorldRegion.width / TILES_HORIZONTAL);
        const tileHeight = Math.round(gameWorldRegion.height / TILES_VERTICAL);
        foundRegions.tileSize = { width: tileWidth, height: tileHeight };
      }
      foundRegions.gameLog = { x: 808, y: 695, width: 125, height: 11 };
    }

    const checkableRegionCount = Object.keys(foundRegions).length;
    if (checkableRegionCount > 0) {
      monitorState = 'MONITORING';
      lastKnownRegions = foundRegions;
    }

    parentPort.postMessage({ storeUpdate: true, type: setAllRegions.type, payload: foundRegions });
  } catch (error) {
    console.error('[RegionMonitor] Error during full scan:', error);
    parentPort.postMessage({ storeUpdate: true, type: setAllRegions.type, payload: {} });
  }
}

/**
 * Performs a cheap, targeted check on all previously found verifiable regions.
 */
async function performTargetedCheck(buffer, metadata) {
  const checkTasks = {};

  // 1. Prepare checks for simple regions.
  for (const name in lastKnownRegions) {
    const sequenceDef = regionColorSequences[name];
    if (sequenceDef) {
      const regionWidget = lastKnownRegions[name];
      const expectedRawX = regionWidget.x - (sequenceDef.offset?.x || 0);
      const expectedRawY = regionWidget.y - (sequenceDef.offset?.y || 0);

      checkTasks[name] = {
        sequences: { [name]: { ...sequenceDef, offset: { x: 0, y: 0 } } },
        searchArea: { x: expectedRawX, y: expectedRawY, width: sequenceDef.sequence.length, height: 1 },
        occurrence: 'first',
      };
    }
  }

  // 2. Prepare checks for complex bounding box regions.
  const boundingBoxRegions = [
    'battleList',
    'partyList',
    'overallActionBars',
    'skillsWidget',
    'chatboxMain',
    'chatboxSecondary',
    'gameWorld',
  ];
  for (const regionName of boundingBoxRegions) {
    const cachedRegion = lastKnownRegions[regionName];
    if (cachedRegion) {
      const startSeqName = `${regionName}Start`;
      const endSeqName = `${regionName}End`;
      const startSeqDef = regionColorSequences[startSeqName];
      const endSeqDef = regionColorSequences[endSeqName];

      // Check if we have the cached raw positions.
      if (startSeqDef && cachedRegion.rawStartPos) {
        checkTasks[startSeqName] = {
          sequences: { [startSeqName]: { ...startSeqDef, offset: { x: 0, y: 0 } } },
          searchArea: { x: cachedRegion.rawStartPos.x, y: cachedRegion.rawStartPos.y, width: startSeqDef.sequence.length, height: 1 },
          occurrence: 'first',
        };
      }
      if (endSeqDef && cachedRegion.rawEndPos) {
        checkTasks[endSeqName] = {
          sequences: { [endSeqName]: { ...endSeqDef, offset: { x: 0, y: 0 } } },
          searchArea: { x: cachedRegion.rawEndPos.x, y: cachedRegion.rawEndPos.y, width: endSeqDef.sequence.length, height: 1 },
          occurrence: 'first',
        };
      }
    }
  }

  if (Object.keys(checkTasks).length === 0) {
    monitorState = 'SEARCHING';
    lastKnownRegions = null;
    return;
  }

  try {
    const searchResults = findSequences.findSequencesNativeBatch(buffer, checkTasks);
    let isStable = true;

    for (const taskName in checkTasks) {
      if (!searchResults[taskName]?.[taskName]) {
        isStable = false;
        // --- DETAILED FAILURE LOG ---
        console.log(`\n--- [RegionMonitor] TARGETED CHECK FAILED ---`);
        console.log(`- Frame: #${metadata.frameCounter}, Time: ${new Date().toISOString()}`);
        console.log(`- Reason: Sequence '${taskName}' was NOT found at its expected position.`);
        const task = checkTasks[taskName];
        if (task) {
          console.log(
            `- Expected Position (Search Area): { x: ${task.searchArea.x}, y: ${task.searchArea.y}, w: ${task.searchArea.width}, h: ${task.searchArea.height} }`,
          );
        }
        console.log(`--- END OF FAILURE REPORT ---\n`);
        break;
      }
    }

    if (isStable) {
      parentPort.postMessage({ storeUpdate: true, type: setAllRegions.type, payload: lastKnownRegions });
    } else {
      console.log(`[RegionMonitor] [Frame #${metadata.frameCounter}] State is UNSTABLE. Switching to SEARCHING state.`);
      monitorState = 'SEARCHING';
      lastKnownRegions = null;
    }
  } catch (error) {
    console.error('[RegionMonitor] Error during targeted check. Reverting to full scan.', error);
    monitorState = 'SEARCHING';
    lastKnownRegions = null;
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

      if (newFrameCounter > lastProcessedFrameCounter) {
        if (Atomics.load(syncArray, IS_RUNNING_INDEX) === 0) {
          if (monitorState !== 'SEARCHING') {
            monitorState = 'SEARCHING';
          }
        } else {
          const width = Atomics.load(syncArray, WIDTH_INDEX);
          const height = Atomics.load(syncArray, HEIGHT_INDEX);

          if (width > 0 && height > 0) {
            lastProcessedFrameCounter = newFrameCounter;

            const metadata = { width, height, frameCounter: newFrameCounter };
            const bufferSize = HEADER_SIZE + width * height * 4;
            const bufferSnapshot = Buffer.alloc(bufferSize);
            sharedBufferView.copy(bufferSnapshot, 0, 0, bufferSize);

            if (monitorState === 'SEARCHING') {
              await performFullScan(bufferSnapshot, metadata);
            } else {
              // monitorState === 'MONITORING'
              await performTargetedCheck(bufferSnapshot, metadata);
            }
          }
        }
      }
    } catch (err) {
      console.error('[RegionMonitor] Fatal error in main loop:', err);
      monitorState = 'SEARCHING';
    }

    const loopEndTime = performance.now();
    const elapsedTime = loopEndTime - loopStartTime;
    const delayTime = Math.max(0, SCAN_INTERVAL_MS - elapsedTime);

    if (delayTime > 0) {
      await delay(delayTime);
    }
  }
}

parentPort.on('message', (message) => {
  if (message.command === 'forceRegionSearch') {
    monitorState = 'SEARCHING';
  }
});

/**
 * Initializes and starts the worker's main loop.
 */
async function startWorker() {
  console.log('[RegionMonitor] Worker starting up in SEARCHING state...');
  mainLoop();
}

startWorker();
