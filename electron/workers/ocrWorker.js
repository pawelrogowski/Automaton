import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { appendFile } from 'fs/promises';
import path from 'path';
import pkg from 'font-ocr';
const { recognizeText } = pkg;

// --- Worker Configuration ---
const { enableMemoryLogging, sharedData } = workerData;

// --- Memory Usage Logging (Conditional) ---
const LOG_INTERVAL_MS = 10000; // 10 seconds
const LOG_FILE_NAME = 'ocr-worker-memory-usage.log';
const LOG_FILE_PATH = path.join(process.cwd(), LOG_FILE_NAME);
let lastLogTime = 0;

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
if (!sharedData) throw new Error('[OcrWorker] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const FRAME_COUNTER_INDEX = 0,
  WIDTH_INDEX = 1,
  HEIGHT_INDEX = 2,
  IS_RUNNING_INDEX = 3;
const HEADER_SIZE = 8;

// --- State Variables ---
let state = null;
let lastProcessedFrameCounter = -1;
const OCR_UPDATE_INTERVAL_MS = 100; // Approximately 10 FPS (1000ms / 100ms = 10 frames)
let lastOcrUpdateTime = 0;

// Define the color palettes for each region.
const GAME_LOG_COLORS = [[240, 240, 240]];

const SKILLS_WIDGET_COLORS = [
  [192, 192, 192],
  [68, 173, 37],
];

const CHATBOX_MAIN_COLORS = [
  [240, 240, 0],
  [248, 96, 96],
  [240, 240, 240],
  [96, 248, 248],
  [32, 160, 255],
  [160, 160, 255],
  [0, 240, 0],
];

async function processOcrRegions(buffer, metadata) {
  const { regions } = state.regionCoordinates;
  const ocrUpdates = {};

  if (regions.gameLog) {
    try {
      const detectedText = recognizeText(buffer, regions.gameLog, GAME_LOG_COLORS);
      ocrUpdates.gameLog = detectedText || '';
    } catch (ocrError) {
      console.error('[OcrWorker] OCR process failed for gameLog:', ocrError);
      ocrUpdates.gameLog = ''; // Clear on error
    }
  } else {
    ocrUpdates.gameLog = ''; // Clear if region is not found
  }
  if (regions.skillsWidget) {
    try {
      const detectedText = recognizeText(buffer, regions.skillsWidget, SKILLS_WIDGET_COLORS);
      ocrUpdates.skillsWidget = detectedText || '';
    } catch (ocrError) {
      console.error('[OcrWorker] OCR process failed for skillsWidget:', ocrError);
      ocrUpdates.skillsWidget = ''; // Clear on error
    }
  } else {
    ocrUpdates.skillsWidget = ''; // Clear if region is not found
  }
  if (regions.chatboxMain) {
    try {
      const detectedText = recognizeText(buffer, regions.chatboxMain, CHATBOX_MAIN_COLORS);
      ocrUpdates.chatboxMain = detectedText || '';
    } catch (ocrError) {
      console.error('[OcrWorker] OCR process failed for chatboxMain:', ocrError);
      ocrUpdates.chatboxMain = ''; // Clear on error
    }
  } else {
    ocrUpdates.chatboxMain = ''; // Clear if region is not found
  }

  if (regions.chatboxSecondary) {
    try {
      const detectedText = recognizeText(buffer, regions.chatboxSecondary, CHATBOX_MAIN_COLORS);
      ocrUpdates.chatboxSecondary = detectedText || '';
    } catch (ocrError) {
      console.error('[OcrWorker] OCR process failed for chatboxSecondary:', ocrError);
      ocrUpdates.chatboxSecondary = ''; // Clear on error
    }
  } else {
    ocrUpdates.chatboxSecondary = ''; // Clear if region is not found
  }

  if (Object.keys(ocrUpdates).length > 0) {
    parentPort.postMessage({ storeUpdate: true, type: 'ocr/setOcrRegionsText', payload: ocrUpdates });
  }
}

async function mainLoop() {
  console.log('[OcrWorker] Worker main loop started.');

  while (true) {
    try {
      Atomics.wait(syncArray, FRAME_COUNTER_INDEX, lastProcessedFrameCounter, 50); // Wait for new frame or timeout
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

      if (!state || !state.regionCoordinates || Object.keys(state.regionCoordinates.regions).length === 0) {
        lastProcessedFrameCounter = newFrameCounter;
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }

      if (now - lastOcrUpdateTime > OCR_UPDATE_INTERVAL_MS) {
        const width = Atomics.load(syncArray, WIDTH_INDEX);
        const height = Atomics.load(syncArray, HEIGHT_INDEX);
        if (width > 0 && height > 0) {
          const bufferSize = HEADER_SIZE + width * height * 4;
          const bufferView = Buffer.from(imageSAB, 0, bufferSize);
          const metadata = { width, height, frameCounter: newFrameCounter };
          await processOcrRegions(bufferView, metadata);
          lastOcrUpdateTime = now;
        }
      }
      lastProcessedFrameCounter = newFrameCounter;
    } catch (err) {
      console.error('[OcrWorker] Fatal error in main loop:', err);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

parentPort.on('message', (message) => {
  state = message;
});

async function startWorker() {
  console.log('[OcrWorker] Worker starting up...');

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
