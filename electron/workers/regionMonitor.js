/**
 * @file region-monitor.js
 * @summary A dedicated worker for continuously identifying UI elements on the screen.
 *
 * @description
 * This worker uses a hybrid "Scan-then-Monitor" state machine and is throttled to a
 * specific interval to ensure low CPU usage and high responsiveness. This version
 * is self-contained and correctly validates all region types, including multi-part
 * bounding boxes, by caching and checking their raw sequence positions.
 *
 * 1.  **CPU-Friendly Throttling:** The main loop is architected to "work-then-sleep".
 *     After each scan, it calculates the time remaining until the next interval
 *     and puts the worker thread to sleep, consuming virtually zero CPU while idle.
 *
 * 2.  **SEARCHING State (The Source of Truth):**
 *     On startup or after a change is detected, the worker performs a full-screen
 *     scan. This scan is the ONLY source of truth for the application's state. It
 *     dispatches the complete set of found regions. If any verifiable regions are
 *     found, it transitions to the MONITORING state.
 *
 * 3.  **MONITORING State (The Validator and Re-Affirmer):**
 *     This state performs fast, targeted checks for all previously found verifiable
 *     regions. It is smart enough to validate both simple regions and complex
 *     bounding-box regions. If any part of any region has moved, it switches back
 *     to SEARCHING. If all are stable, it re-dispatches the cached data.
 *
 * 4.  **Periodic Discovery Scan (The Robustness Guarantee):**
 *     To ensure newly appeared UI elements are detected, a full scan is automatically
 *     forced if one has not been performed within the `FULL_SCAN_INTERVAL_MS`. This
 *     provides the perfect balance between performance and data freshness.
 */

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { regionColorSequences } from '../constants/index.js';
import { setAllRegions } from '../../frontend/redux/slices/regionCoordinatesSlice.js';
import findSequences from 'find-sequences-native';

// --- Worker Configuration ---
const { sharedData } = workerData;
const SCAN_INTERVAL_MS = 50; // ~23.8 FPS. The target time between scans.
const FULL_SCAN_INTERVAL_MS = 250; // Force a full discovery scan at least this often.

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
let lastFullScanTimestamp = 0; // Timestamp for forcing periodic full scans.

// --- Self-Contained Utilities ---

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createRegion = (point, width, height) => ({ x: point.x, y: point.y, width, height });

/**
 * Finds a bounding rectangle and returns both the final widget coordinates and the
 * raw, non-offset coordinates of the start/end sequences for later validation.
 */
const findBoundingRect = (buffer, startSeqConfig, endSeqConfig, maxRight, maxDown, metadata) => {
  const fullSearchArea = { x: 0, y: 0, width: metadata.width, height: metadata.height };

  const startResult = findSequences.findSequencesNativeBatch(buffer, {
    startTask: { sequences: { start: startSeqConfig }, searchArea: fullSearchArea, occurrence: 'first' },
  });

  if (!startResult?.startTask?.start) {
    return { startFound: false, endFound: false };
  }
  const { x: startX, y: startY } = startResult.startTask.start;
  const rawStartPos = {
    x: startX - (startSeqConfig.offset?.x || 0),
    y: startY - (startSeqConfig.offset?.y || 0),
  };

  const endSearchArea = {
    x: startX,
    y: startY,
    width: Math.min(maxRight, metadata.width - startX),
    height: Math.min(maxDown, metadata.height - startY),
  };

  if (endSearchArea.width <= 0 || endSearchArea.height <= 0) {
    return { x: startX, y: startY, width: 0, height: 0, startFound: true, endFound: false, rawStartPos };
  }

  const endResult = findSequences.findSequencesNativeBatch(buffer, {
    endTask: { sequences: { end: endSeqConfig }, searchArea: endSearchArea, occurrence: 'first' },
  });

  if (!endResult?.endTask?.end) {
    return { x: startX, y: startY, width: 0, height: 0, startFound: true, endFound: false, rawStartPos };
  }
  const { x: endX, y: endY } = endResult.endTask.end;
  const rawEndPos = {
    x: endX - (endSeqConfig.offset?.x || 0),
    y: endY - (endSeqConfig.offset?.y || 0),
  };

  const rectWidth = endX - startX + 1;
  const rectHeight = endY - startY + 1;

  if (rectWidth <= 0 || rectHeight <= 0) {
    return { x: startX, y: startY, width: 0, height: 0, startFound: true, endFound: true, rawStartPos, rawEndPos };
  }

  return { x: startX, y: startY, width: rectWidth, height: rectHeight, startFound: true, endFound: true, rawStartPos, rawEndPos };
};

/**
 * Performs a full, expensive scan of the entire screen to find all regions.
 */
async function performFullScan(buffer, metadata) {
  const foundRegions = {};
  const searchArea = { x: 0, y: 0, width: metadata.width, height: metadata.height };
  try {
    const simpleSequences = Object.fromEntries(
      Object.entries(regionColorSequences).filter(([key]) => !key.endsWith('Start') && !key.endsWith('End')),
    );
    const searchResults = findSequences.findSequencesNativeBatch(buffer, {
      main: { sequences: simpleSequences, searchArea, occurrence: 'first' },
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
    }

    const battleListRegion = findBoundingRect(
      buffer,
      regionColorSequences.battleListStart,
      regionColorSequences.battleListEnd,
      160,
      600,
      metadata,
    );
    if (battleListRegion?.startFound) foundRegions.battleList = battleListRegion;
    const partyListRegion = findBoundingRect(
      buffer,
      regionColorSequences.partyListStart,
      regionColorSequences.partyListEnd,
      160,
      200,
      metadata,
    );
    if (partyListRegion?.startFound) foundRegions.partyList = partyListRegion;
    const overallActionBarsRegion = findBoundingRect(
      buffer,
      regionColorSequences.hotkeyBarBottomStart,
      regionColorSequences.hotkeyBarBottomEnd,
      2000,
      100,
      metadata,
    );
    if (overallActionBarsRegion?.startFound) foundRegions.overallActionBars = overallActionBarsRegion;
    const skillsWidgetRegion = findBoundingRect(
      buffer,
      regionColorSequences.skillsWidgetStart,
      regionColorSequences.skillsWidgetEnd,
      170,
      1000,
      metadata,
    );
    if (skillsWidgetRegion?.startFound) foundRegions.skillsWidget = skillsWidgetRegion;
    const chatboxMainRegion = findBoundingRect(
      buffer,
      regionColorSequences.chatboxMainStart,
      regionColorSequences.chatboxMainEnd,
      1400,
      1000,
      metadata,
    );
    if (chatboxMainRegion?.startFound) foundRegions.chatboxMain = chatboxMainRegion;
    const chatboxSecondaryRegion = findBoundingRect(
      buffer,
      regionColorSequences.chatboxSecondaryStart,
      regionColorSequences.chatboxSecondaryEnd,
      1400,
      1000,
      metadata,
    );
    if (chatboxSecondaryRegion?.startFound) foundRegions.chatboxSecondary = chatboxSecondaryRegion;
    const gameWorldRegion = findBoundingRect(
      buffer,
      regionColorSequences.gameWorldStart,
      regionColorSequences.gameWorldEnd,
      metadata.width,
      metadata.height,
      metadata,
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

    if (Object.keys(foundRegions).length > 0) {
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

  for (const name in lastKnownRegions) {
    const cachedWidget = lastKnownRegions[name];
    let sequenceDef, expectedRawX, expectedRawY, taskName;

    if (cachedWidget.rawStartPos) {
      const startSeqName = `${name}Start`;
      const endSeqName = `${name}End`;
      const startSeqDef = regionColorSequences[startSeqName];
      const endSeqDef = regionColorSequences[endSeqName];

      if (startSeqDef) {
        checkTasks[startSeqName] = {
          sequences: { [startSeqName]: { ...startSeqDef, offset: { x: 0, y: 0 } } },
          searchArea: { x: cachedWidget.rawStartPos.x, y: cachedWidget.rawStartPos.y, width: startSeqDef.sequence.length, height: 1 },
          occurrence: 'first',
        };
      }
      if (endSeqDef && cachedWidget.rawEndPos) {
        checkTasks[endSeqName] = {
          sequences: { [endSeqName]: { ...endSeqDef, offset: { x: 0, y: 0 } } },
          searchArea: { x: cachedWidget.rawEndPos.x, y: cachedWidget.rawEndPos.y, width: endSeqDef.sequence.length, height: 1 },
          occurrence: 'first',
        };
      }
    } else if (regionColorSequences[name]) {
      taskName = name;
      sequenceDef = regionColorSequences[name];
      expectedRawX = cachedWidget.x - (sequenceDef.offset?.x || 0);
      expectedRawY = cachedWidget.y - (sequenceDef.offset?.y || 0);
      checkTasks[taskName] = {
        sequences: { [taskName]: { ...sequenceDef, offset: { x: 0, y: 0 } } },
        searchArea: { x: expectedRawX, y: expectedRawY, width: sequenceDef.sequence.length, height: 1 },
        occurrence: 'first',
      };
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
        break;
      }
    }

    if (isStable) {
      parentPort.postMessage({ storeUpdate: true, type: setAllRegions.type, payload: lastKnownRegions });
    } else {
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

            const now = performance.now();
            const forceFullScan = now - lastFullScanTimestamp > FULL_SCAN_INTERVAL_MS;

            if (monitorState === 'SEARCHING' || forceFullScan) {
              await performFullScan(bufferSnapshot, metadata);
              lastFullScanTimestamp = now;
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
