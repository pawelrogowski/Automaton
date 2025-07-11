import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { appendFile } from 'fs/promises';
import path from 'path';
import { regionColorSequences } from '../constants/index.js';
import { setAllRegions } from '../../frontend/redux/slices/regionCoordinatesSlice.js';
import { findBoundingRect } from '../screenMonitor/screenGrabUtils/findBoundingRect.js';
import { createRegion } from './screenMonitor/modules/utils.js';
import findSequences from 'find-sequences-native';

// --- Worker Configuration ---
// Destructure workerData, providing a default for the logging flag.
const { enableMemoryLogging, sharedData } = workerData;

// --- Memory Usage Logging (Conditional) ---
const LOG_INTERVAL_MS = 10000; // 10 seconds
const LOG_FILE_NAME = 'region-monitor-memory-usage.log';
const LOG_FILE_PATH = path.join(process.cwd(), LOG_FILE_NAME);
let lastLogTime = 0; // Will be initialized properly if logging is enabled.

const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

async function logMemoryUsage() {
  // This function will only be called if enableMemoryLogging is true.
  try {
    const memoryUsage = process.memoryUsage();
    const timestamp = new Date().toISOString();
    const logEntry =
      `${timestamp} | ` +
      `RSS: ${toMB(memoryUsage.rss)} MB, ` +
      `HeapTotal: ${toMB(memoryUsage.heapTotal)} MB, ` +
      `HeapUsed: ${toMB(memoryUsage.heapUsed)} MB, ` +
      `External: ${toMB(memoryUsage.external)} MB\n`;

    await appendFile(LOG_FILE_PATH, logEntry);
  } catch (error) {
    console.error('[MemoryLogger] Failed to write to memory log file:', error);
  }
}
// --- End of Memory Usage Logging ---

// --- Shared Buffer Setup ---
if (!sharedData) throw new Error('[RegionMonitor] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const FRAME_COUNTER_INDEX = 0,
  WIDTH_INDEX = 1,
  HEIGHT_INDEX = 2,
  IS_RUNNING_INDEX = 3;
const HEADER_SIZE = 8;

// --- State ---
let lastProcessedFrameCounter = -1;
let lastRegionUpdateTime = 0;
const REGION_UPDATE_INTERVAL_MS = 1000;

async function findAndDispatchRegions(buffer, metadata) {
  // This function remains unchanged
  // console.log('[RegionMonitor] Searching for all UI regions...');
  const fullSearchArea = { x: 0, y: 0, width: metadata.width, height: metadata.height };
  const foundRegions = {};

  try {
    const initialSearchResults = findSequences.findSequencesNativeBatch(buffer, {
      main: { sequences: regionColorSequences, searchArea: fullSearchArea, occurrence: 'first' },
    });

    const startRegions = initialSearchResults.main;
    if (!startRegions) {
      console.warn('[RegionMonitor] No initial regions found in batch search.');
      return;
    }

    if (startRegions.healthBar)
      foundRegions.healthBar = { x: startRegions.healthBar.x, y: startRegions.healthBar.y, width: 94, height: 14 };
    if (startRegions.manaBar) foundRegions.manaBar = { x: startRegions.manaBar.x, y: startRegions.manaBar.y, width: 94, height: 14 };
    if (startRegions.cooldownBar || startRegions.cooldownBarFallback) {
      foundRegions.cooldowns = createRegion(startRegions.cooldownBar || startRegions.cooldownBarFallback, 56, 4);
    }
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

    const findBoundingRectBatch = (startSeq, endSeq, ...args) =>
      findBoundingRect(findSequences.findSequencesNativeBatch, buffer, startSeq, endSeq, ...args);
    const battleListRegion = findBoundingRectBatch(regionColorSequences.battleListStart, regionColorSequences.battleListEnd, 160, 600);
    if (battleListRegion?.startFound) foundRegions.battleList = battleListRegion;
    const partyListRegion = findBoundingRectBatch(regionColorSequences.partyListStart, regionColorSequences.partyListEnd, 160, 200);
    if (partyListRegion?.startFound) foundRegions.partyList = partyListRegion;
    const overallActionBarsRegion = findBoundingRectBatch(
      regionColorSequences.hotkeyBarBottomStart,
      regionColorSequences.hotkeyBarBottomEnd,
      600,
      100,
    );
    if (overallActionBarsRegion?.startFound) foundRegions.overallActionBars = overallActionBarsRegion;

    foundRegions.gameLog = { x: 808, y: 695, width: 125, height: 11 };
    foundRegions.gameWorld = { x: 330, y: 6, width: 1086, height: 796 };

    parentPort.postMessage({
      storeUpdate: true,
      type: setAllRegions.type,
      payload: foundRegions,
    });
    if (Object.keys(foundRegions).length > 0) {
      // console.log('[RegionMonitor] Successfully found and dispatched regions.');
    } else {
      console.warn('[RegionMonitor] No regions found to dispatch.');
    }
  } catch (error) {
    console.error('[RegionMonitor] Error during region location:', error);
  }
}

async function mainLoop() {
  console.log('[RegionMonitor] Worker main loop started.');

  while (true) {
    try {
      Atomics.wait(syncArray, FRAME_COUNTER_INDEX, lastProcessedFrameCounter, 500);
      const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);
      const now = performance.now();

      // --- Integrated Memory Logging Check ---
      // This block only runs if the feature is enabled.
      if (enableMemoryLogging && now - lastLogTime > LOG_INTERVAL_MS) {
        await logMemoryUsage();
        lastLogTime = now; // Reset the timer
      }
      // --- End of Integrated Memory Logging Check ---

      if (newFrameCounter <= lastProcessedFrameCounter) continue;

      if (Atomics.load(syncArray, IS_RUNNING_INDEX) === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      if (now - lastRegionUpdateTime > REGION_UPDATE_INTERVAL_MS) {
        const width = Atomics.load(syncArray, WIDTH_INDEX);
        const height = Atomics.load(syncArray, HEIGHT_INDEX);
        if (width > 0 && height > 0) {
          const bufferSize = HEADER_SIZE + width * height * 4;
          const bufferView = Buffer.from(imageSAB, 0, bufferSize);
          const metadata = { width, height, frameCounter: newFrameCounter };
          await findAndDispatchRegions(bufferView, metadata);
          lastRegionUpdateTime = now;
        }
      }
      lastProcessedFrameCounter = newFrameCounter;
    } catch (err) {
      console.error('[RegionMonitor] Fatal error in main loop:', err);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

parentPort.on('message', (message) => {
  if (message.command === 'forceRegionSearch') {
    console.log('[RegionMonitor] Received request for immediate region search. Triggering on next loop.');
    lastRegionUpdateTime = 0;
  }
});

async function startWorker() {
  console.log('[RegionMonitor] Worker starting up...');

  // --- Initialize Logger if Enabled ---
  if (enableMemoryLogging) {
    try {
      const header = `\n--- New Session Started at ${new Date().toISOString()} ---\n`;
      await appendFile(LOG_FILE_PATH, header);
      console.log(`[MemoryLogger] Memory usage logging is active. Outputting to ${LOG_FILE_PATH}`);
      lastLogTime = performance.now(); // Initialize the timer
      await logMemoryUsage(); // Perform an initial log right away
    } catch (error) {
      console.error('[MemoryLogger] Could not initialize memory log file:', error);
    }
  }
  // --- End of Logger Initialization ---

  mainLoop();
}

startWorker();
