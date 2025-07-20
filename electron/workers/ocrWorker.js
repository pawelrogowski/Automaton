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
 */

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import pkg from 'font-ocr';
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

  if (regions.gameLog) {
    try {
      const rawText = recognizeText(buffer, regions.gameLog, [[240, 240, 240]]) || '';
      ocrUpdates.gameLog = rawText;
    } catch (ocrError) {
      console.error('[OcrWorker] OCR process failed for gameLog:', ocrError);
    }
  }

  if (regions.skillsWidget) {
    try {
      const rawText =
        recognizeText(buffer, regions.skillsWidget, [
          [192, 192, 192],
          [68, 173, 37],
        ]) || '';
      ocrUpdates.skillsWidget = rawText;
    } catch (ocrError) {
      console.error('[OcrWorker] OCR process failed for skillsWidget:', ocrError);
    }
  }

  const chatColors = [
    [240, 240, 0],
    [248, 96, 96],
    [240, 240, 240],
    [96, 248, 248],
    [32, 160, 255],
    [160, 160, 255],
    [0, 240, 0],
  ];

  if (regions.chatboxMain) {
    try {
      const rawText = recognizeText(buffer, regions.chatboxMain, chatColors) || '';
      ocrUpdates.chatboxMain = rawText;
    } catch (ocrError) {
      console.error('[OcrWorker] OCR process failed for chatboxMain:', ocrError);
    }
  }

  if (regions.chatboxSecondary) {
    try {
      const rawText = recognizeText(buffer, regions.chatboxSecondary, chatColors) || '';
      ocrUpdates.chatboxSecondary = rawText;
    } catch (ocrError) {
      console.error('[OcrWorker] OCR process failed for chatboxSecondary:', ocrError);
    }
  }

  const chatBoxTabRowColors = [
    [223, 223, 223],
    [247, 95, 95],
    [127, 127, 127],
  ];

  if (regions.chatBoxTabRow) {
    try {
      const rawText = recognizeText(buffer, regions.chatBoxTabRow, chatBoxTabRowColors) || '';
      ocrUpdates.chatBoxTabRow = rawText;
    } catch (ocrError) {
      console.error('[OcrWorker] OCR process failed for chatBoxTabRow:', ocrError);
    }
  }

  // Process selectCharacterModal for OCR
  if (regions.selectCharacterModal) {
    try {
      const rawText =
        recognizeText(buffer, regions.selectCharacterModal, [
          [244, 244, 244],
          [192, 192, 192],
        ]) || '';
      ocrUpdates.selectCharacterModal = rawText;
    } catch (ocrError) {
      console.error('[OcrWorker] OCR process failed for selectCharacterModal:', ocrError);
    }
  }

  // Send OCR updates (raw text)
  if (Object.keys(ocrUpdates).length > 0) {
    parentPort.postMessage({ storeUpdate: true, type: 'ocr/setOcrRegionsText', payload: ocrUpdates });
  }

  // Parse skillsWidget data from OCR results
  if (ocrUpdates.skillsWidget) {
    try {
      const rawText = ocrUpdates.skillsWidget;

      // Handle direct array/object returns from OCR
      let skillsWidgetArray = [];

      // Check if we already have an array (direct return from OCR)
      if (Array.isArray(rawText)) {
        skillsWidgetArray = rawText;
      }
      // Check if we have an object that might be the OCR result
      else if (typeof rawText === 'object' && rawText !== null) {
        if (rawText.text) {
          skillsWidgetArray = [rawText];
        } else if (Array.isArray(rawText.data)) {
          skillsWidgetArray = rawText.data;
        } else {
          skillsWidgetArray = Object.values(rawText).filter((item) => item && typeof item === 'object' && item.text !== undefined);
        }
      }
      // Handle string data (JSON string or other)
      else if (typeof rawText === 'string') {
        const textToParse = rawText.trim();
        if (!textToParse) return;

        if (textToParse === '[object Object]' || textToParse.includes('[object Object]')) return;

        try {
          const parsed = JSON.parse(textToParse);
          if (Array.isArray(parsed)) {
            skillsWidgetArray = parsed;
          } else if (parsed && typeof parsed === 'object') {
            skillsWidgetArray = [parsed];
          }
        } catch (jsonError) {
          const textMatches = textToParse.match(/"text"\s*:\s*"([^"]*)"/g);
          if (textMatches) {
            skillsWidgetArray = textMatches.map((match, index) => ({
              text: match.match(/"([^"]*)"/)[1],
              x: index * 100,
              y: 0,
            }));
          }
        }
      }

      // Filter valid items
      const validItems = skillsWidgetArray.filter((item) => item && typeof item === 'object' && item.text && item.text.trim());

      if (validItems.length > 0) {
        parentPort.postMessage({
          storeUpdate: true,
          type: 'uiValues/updateSkillsWidget',
          payload: validItems,
        });
      }
    } catch (error) {
      console.error('[OcrWorker] Error in skillsWidget processing:', error);
    }
  }

  // Parse chatboxMain data from OCR results
  if (ocrUpdates.chatboxMain) {
    try {
      let ocrDataArray = [];

      // Handle the actual OCR data format from recognizeText
      if (Array.isArray(ocrUpdates.chatboxMain)) {
        ocrDataArray = ocrUpdates.chatboxMain;
      } else if (typeof ocrUpdates.chatboxMain === 'object' && ocrUpdates.chatboxMain !== null) {
        // Handle single object case
        ocrDataArray = [ocrUpdates.chatboxMain];
      } else {
        return;
      }

      // Send OCR data array for parsing in uiValuesSlice
      parentPort.postMessage({
        storeUpdate: true,
        type: 'uiValues/updateRegionData',
        payload: {
          region: 'chatboxMain',
          data: ocrDataArray,
        },
      });
    } catch (error) {
      console.error('[OcrWorker] Error in chatboxMain processing:', error);
    }
  }

  // Parse chatboxSecondary data from OCR results
  if (ocrUpdates.chatboxSecondary) {
    try {
      let ocrDataArray = [];

      // Handle the actual OCR data format from recognizeText
      if (Array.isArray(ocrUpdates.chatboxSecondary)) {
        ocrDataArray = ocrUpdates.chatboxSecondary;
      } else if (typeof ocrUpdates.chatboxSecondary === 'object' && ocrUpdates.chatboxSecondary !== null) {
        // Handle single object case
        ocrDataArray = [ocrUpdates.chatboxSecondary];
      } else {
        return;
      }

      // Send OCR data array for parsing in uiValuesSlice
      parentPort.postMessage({
        storeUpdate: true,
        type: 'uiValues/updateRegionData',
        payload: {
          region: 'chatboxSecondary',
          data: ocrDataArray,
        },
      });
    } catch (error) {
      console.error('[OcrWorker] Error in chatboxSecondary processing:', error);
    }
  }

  // Parse chatBoxTabRow data from OCR results
  if (ocrUpdates.chatBoxTabRow) {
    try {
      let ocrDataArray = [];

      // Handle the actual OCR data format from recognizeText
      if (Array.isArray(ocrUpdates.chatBoxTabRow)) {
        ocrDataArray = ocrUpdates.chatBoxTabRow;
      } else if (typeof ocrUpdates.chatBoxTabRow === 'object' && ocrUpdates.chatBoxTabRow !== null) {
        // Handle single object case
        ocrDataArray = [ocrUpdates.chatBoxTabRow];
      } else {
        return;
      }

      // Send OCR data array for parsing in uiValuesSlice
      parentPort.postMessage({
        storeUpdate: true,
        type: 'uiValues/updateRegionData',
        payload: {
          region: 'chatBoxTabRow',
          data: ocrDataArray,
        },
      });
    } catch (error) {
      console.error('[OcrWorker] Error in chatBoxTabRow processing:', error);
    }
  }

  // Parse selectCharacterModal data from OCR results
  if (ocrUpdates.selectCharacterModal) {
    try {
      let ocrDataArray = [];

      // Handle the actual OCR data format from recognizeText
      if (Array.isArray(ocrUpdates.selectCharacterModal)) {
        ocrDataArray = ocrUpdates.selectCharacterModal;
      } else if (typeof ocrUpdates.selectCharacterModal === 'object' && ocrUpdates.selectCharacterModal !== null) {
        // Handle single object case
        ocrDataArray = [ocrUpdates.selectCharacterModal];
      } else {
        return;
      }

      // Send OCR data array for parsing in uiValuesSlice
      parentPort.postMessage({
        storeUpdate: true,
        type: 'uiValues/updateRegionData',
        payload: {
          region: 'selectCharacterModal',
          data: ocrDataArray,
        },
      });
    } catch (error) {
      console.error('[OcrWorker] Error in selectCharacterModal processing:', error);
    }
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
