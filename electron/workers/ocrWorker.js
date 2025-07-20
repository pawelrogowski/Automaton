/**
 * @file ocrWorker.js
 * @summary A dedicated worker for performing Optical Character Recognition (OCR) on specific screen regions.
 *
 * @description
 * This worker's responsibility is to extract text from predefined regions of the screen,
 * such as chat logs or skill widgets. It relies on the `region-monitor` worker to first
 * locate these regions.
 *
 * Key Architectural Decisions:
 * 1.  **CPU-Friendly Throttling:** The main loop is architected to "work-then-sleep".
 *     After each OCR cycle, it calculates the time remaining until the next interval
 *     and puts the worker thread to sleep. This ensures the worker consumes virtually
 *     zero CPU while idle.
 *
 * 2.  **Data Snapshotting:** To ensure data consistency for the OCR process, the worker
 *     creates a single, private copy (a "snapshot") of the shared screen buffer at the
 *     beginning of each loop. This prevents race conditions and memory accumulation.
 *
 * 3.  **State-Driven:** The worker remains idle until it receives the necessary
 *     region coordinates from the main thread's global state. All operations are
 *     based on the last known good state.
 *
 * 4.  **Modular Parsers:** All OCR data processing is delegated to specialized parsers
 *     imported from parsers.js, keeping the worker focused solely on OCR extraction.
 */

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import pkg from 'font-ocr';
import { regionParsers } from './ocrWorker/parsers.js';
import regionDefinitions from '../constants/regionDefinitions.js';
const { recognizeText } = pkg;

// --- Worker Configuration ---
const { sharedData } = workerData;
const SCAN_INTERVAL_MS = 200; // OCR is expensive and doesn't need to be real-time.

// --- Shared Buffer Setup ---
if (!sharedData) throw new Error('[OcrWorker] Shared data not provided.');
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

// --- Self-Contained Utilities ---
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Core OCR Logic ---
async function processOcrRegions(buffer, metadata) {
  const { regions } = state.regionCoordinates;
  const ocrUpdates = {};

  // The recognizeText function expects a buffer containing the header.
  // Our snapshot already includes this, so we can pass it directly.

  // Process each region with OCR and delegate parsing to specialized parsers
  const regionConfigs = {
    gameLog: {
      colors: regionDefinitions.gameLog?.ocrColors || [[240, 240, 240]],
      parser: null, // gameLog doesn't need parsing, just raw data
    },
    skillsWidget: {
      colors: regionDefinitions.skillsWidget?.ocrColors || [
        [192, 192, 192],
        [68, 173, 37],
      ],
      parser: regionParsers.skillsWidget,
    },
    chatboxMain: {
      colors: regionDefinitions.chatboxMain?.ocrColors || [
        [240, 240, 0],
        [248, 96, 96],
        [240, 240, 240],
        [96, 248, 248],
        [32, 160, 255],
        [160, 160, 255],
        [0, 240, 0],
      ],
      parser: regionParsers.chatboxMain,
    },
    chatboxSecondary: {
      colors: regionDefinitions.chatboxSecondary?.ocrColors || [
        [240, 240, 0],
        [248, 96, 96],
        [240, 240, 240],
        [96, 248, 248],
        [32, 160, 255],
        [160, 160, 255],
        [0, 240, 0],
      ],
      parser: regionParsers.chatboxSecondary,
    },
    chatBoxTabRow: {
      colors: regionDefinitions.chatBoxTabRow?.ocrColors || [
        [223, 223, 223],
        [247, 95, 95],
        [127, 127, 127],
      ],
      parser: regionParsers.chatBoxTabRow,
    },
    selectCharacterModal: {
      colors: regionDefinitions.selectCharacterModal?.ocrColors || [[240, 240, 240]],
      parser: regionParsers.selectCharacterModal,
    },
    vipWidget: {
      colors: regionDefinitions.vipWidget?.ocrColors || [
        [96, 248, 96],
        [248, 96, 96],
      ],
      parser: regionParsers.vipWidget,
    },
  };

  // Process each region with OCR
  for (const [regionKey, config] of Object.entries(regionConfigs)) {
    if (regions[regionKey]) {
      try {
        const rawData = recognizeText(buffer, regions[regionKey], config.colors) || [];

        // Store raw data for OCR slice - preserve the actual data structure
        ocrUpdates[regionKey] = rawData;

        // Process with parser if available
        if (config.parser && rawData && Array.isArray(rawData) && rawData.length > 0) {
          const parsedData = config.parser(rawData);

          if (parsedData && (Array.isArray(parsedData) ? parsedData.length > 0 : true)) {
            // Route to appropriate UI update based on region
            if (regionKey === 'skillsWidget') {
              parentPort.postMessage({
                storeUpdate: true,
                type: 'uiValues/updateSkillsWidget',
                payload: parsedData,
              });
            } else {
              // Generic region data update for all other regions
              parentPort.postMessage({
                storeUpdate: true,
                type: 'uiValues/updateRegionData',
                payload: {
                  region: regionKey,
                  data: parsedData,
                },
              });
            }
          }
        }
      } catch (ocrError) {
        console.error(`[OcrWorker] OCR process failed for ${regionKey}:`, ocrError);
      }
    }
  }

  // Send OCR updates (structured data)
  if (Object.keys(ocrUpdates).length > 0) {
    parentPort.postMessage({ storeUpdate: true, type: 'ocr/setOcrRegionsText', payload: ocrUpdates });
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

          if (Object.keys(regions).length > 0 && width > 0 && height > 0) {
            lastProcessedFrameCounter = newFrameCounter;

            const metadata = { width, height, frameCounter: newFrameCounter };
            const bufferSize = HEADER_SIZE + width * height * 4;

            // Create a single, private snapshot of the buffer for this cycle.
            const bufferSnapshot = Buffer.alloc(bufferSize);
            sharedBufferView.copy(bufferSnapshot, 0, 0, bufferSize);

            await processOcrRegions(bufferSnapshot, metadata);
          }
        }
      }
    } catch (err) {
      console.error('[OcrWorker] Fatal error in main loop:', err);
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
  state = message;
});

function startWorker() {
  console.log('[OcrWorker] Worker starting up...');
  mainLoop();
}

startWorker();
