import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { appendFile, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { regionColorSequences } from '../constants/index.js';
import { setAllRegions } from '../../frontend/redux/slices/regionCoordinatesSlice.js';
import { findBoundingRect } from '../screenMonitor/screenGrabUtils/findBoundingRect.js';
import { createRegion } from './screenMonitor/modules/utils.js';
import findSequences from 'find-sequences-native';

// --- Worker Configuration ---
const { enableMemoryLogging, sharedData } = workerData;

// --- Memory Usage Logging (Conditional) ---
const LOG_INTERVAL_MS = 10000; // 10 seconds
const LOG_FILE_NAME = 'region-monitor-memory-usage.log';
const LOG_FILE_PATH = path.join(process.cwd(), LOG_FILE_NAME);
let lastLogTime = 0;

const PERF_LOG_FILE_NAME = 'region-monitor-performance.json';
const PERF_LOG_FILE_PATH = path.join(process.cwd(), PERF_LOG_FILE_NAME);

const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

async function logMemoryUsage() {
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

async function updatePerformanceLog(durationMs, width, height) {
  let summary = {
    sessionLength: 0,
    highestTimeMs: 0,
    lowestTimeMs: Infinity,
    totalDurationMs: 0,
    totalPixels: 0,
    meanDurationMs: 0, // For Welford's algorithm
    sumOfSquaredDifferences: 0, // For Welford's algorithm
  };

  try {
    const fileContent = await readFile(PERF_LOG_FILE_PATH, 'utf8');
    const parsedData = JSON.parse(fileContent);
    // Check if the parsed data is a valid summary object (not an old 'entries' format)
    if (parsedData && typeof parsedData.sessionLength === 'number') {
      summary = parsedData;
    } else {
      console.warn('[PerformanceTracker] Old or malformed performance log file detected. Starting new summary.');
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('[PerformanceTracker] Performance log file not found, creating new one.');
    } else {
      console.error('[PerformanceTracker] Error reading performance log file:', error);
    }
  }

  summary.sessionLength++;
  summary.highestTimeMs = Math.max(summary.highestTimeMs, durationMs);
  summary.lowestTimeMs = Math.min(summary.lowestTimeMs, durationMs);
  summary.totalDurationMs += durationMs;
  summary.totalPixels += width * height;

  // Welford's algorithm for calculating mean and variance incrementally
  const oldMean = summary.meanDurationMs;
  summary.meanDurationMs += (durationMs - oldMean) / summary.sessionLength;
  summary.sumOfSquaredDifferences += (durationMs - oldMean) * (durationMs - summary.meanDurationMs);

  const averageMs = summary.totalDurationMs / summary.sessionLength;
  const jitterMs = summary.sessionLength > 1 ? Math.sqrt(summary.sumOfSquaredDifferences / (summary.sessionLength - 1)) : 0;
  const totalMegapixels = summary.totalPixels / (1024 * 1024);
  const megapixelsPerSecond = summary.totalDurationMs > 0 ? totalMegapixels / (summary.totalDurationMs / 1000) : 0;

  summary.averageMs = averageMs;
  summary.jitterMs = jitterMs;
  summary.totalMegapixels = totalMegapixels;
  summary.megapixelsPerSecond = megapixelsPerSecond;

  try {
    await writeFile(PERF_LOG_FILE_PATH, JSON.stringify(summary, null, 2)); // Write the full summary object
    console.log('[PerformanceTracker] Performance summary updated.');
  } catch (error) {
    console.error('[PerformanceTracker] Error writing performance log file:', error);
  }
}

async function findAndDispatchRegions(buffer, metadata) {
  const fullSearchArea = { x: 0, y: 0, width: metadata.width, height: metadata.height };
  const foundRegions = {};

  try {
    const startTime = performance.now();
    const initialSearchResults = findSequences.findSequencesNativeBatch(buffer, {
      main: { sequences: regionColorSequences, searchArea: fullSearchArea, occurrence: 'first' },
    });
    const endTime = performance.now();
    const durationMs = endTime - startTime;

    await updatePerformanceLog(durationMs, metadata.width, metadata.height);

    const startRegions = initialSearchResults.main;
    if (!startRegions) {
      console.warn('[RegionMonitor] No initial regions found in batch search.');
      return;
    }

    // --- Static Sized Regions ---
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

    // --- Dynamic Bounding-Box Regions ---
    const findBoundingRectBatch = (startSeq, endSeq, ...args) =>
      findBoundingRect(findSequences.findSequencesNativeBatch, buffer, startSeq, endSeq, ...args);

    const battleListRegion = findBoundingRectBatch(regionColorSequences.battleListStart, regionColorSequences.battleListEnd, 160, 600);
    if (battleListRegion?.startFound) foundRegions.battleList = battleListRegion;

    const partyListRegion = findBoundingRectBatch(regionColorSequences.partyListStart, regionColorSequences.partyListEnd, 160, 200);
    if (partyListRegion?.startFound) foundRegions.partyList = partyListRegion;

    const overallActionBarsRegion = findBoundingRectBatch(
      regionColorSequences.hotkeyBarBottomStart,
      regionColorSequences.hotkeyBarBottomEnd,
      2000,
      100,
    );
    if (overallActionBarsRegion?.startFound) foundRegions.overallActionBars = overallActionBarsRegion;

    const skillsWidgetRegion = findBoundingRectBatch(
      regionColorSequences.skillsWidgetStart,
      regionColorSequences.skillsWidgetEnd,
      170,
      1000,
    );
    if (skillsWidgetRegion?.startFound) foundRegions.skillsWidget = skillsWidgetRegion;

    const chatboxMainRegion = findBoundingRectBatch(regionColorSequences.chatboxMainStart, regionColorSequences.chatboxMainEnd, 1400, 1000);
    if (chatboxMainRegion?.startFound) foundRegions.chatboxMain = chatboxMainRegion;

    // --- Game World Detection and Tile Size Calculation ---
    const gameWorldRegion = findBoundingRectBatch(
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
    // --- End Game World Section ---

    // --- Hardcoded Regions (if any remain) ---
    foundRegions.gameLog = { x: 808, y: 695, width: 125, height: 11 };

    // --- Dispatch to Redux ---
    parentPort.postMessage({
      storeUpdate: true,
      type: setAllRegions.type,
      payload: foundRegions,
    });

    if (Object.keys(foundRegions).length <= 1) {
      // console.warn('[RegionMonitor] No dynamic regions found to dispatch.');
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

      if (enableMemoryLogging && now - lastLogTime > LOG_INTERVAL_MS) {
        await logMemoryUsage();
        lastLogTime = now;
      }

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

  if (enableMemoryLogging) {
    try {
      const header = `\n--- New Session Started at ${new Date().toISOString()} ---\n`;
      await appendFile(LOG_FILE_PATH, header);
      console.log(`[MemoryLogger] Memory usage logging is active. Outputting to ${LOG_FILE_PATH}`);
      lastLogTime = performance.now();
      await logMemoryUsage();
    } catch (error) {
      console.error('[MemoryLogger] Could not initialize memory log file:', error);
    }
  }

  mainLoop();
}

startWorker();
