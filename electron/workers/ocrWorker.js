/**
 * @file ocrWorker.js
 * (omitting file description for brevity)
 */

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import pkg from 'font-ocr';
import { regionParsers } from './ocrWorker/parsers.js';
import regionDefinitions from '../constants/regionDefinitions.js';
const { recognizeText } = pkg;

// --- Worker Configuration & Setup ---
const { sharedData } = workerData;
const SCAN_INTERVAL_MS = 200;
if (!sharedData) throw new Error('[OcrWorker] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const FRAME_COUNTER_INDEX = 0,
  WIDTH_INDEX = 1,
  HEIGHT_INDEX = 2,
  IS_RUNNING_INDEX = 3;
const HEADER_SIZE = 8;
const sharedBufferView = Buffer.from(imageSAB);
let state = null;
let lastProcessedFrameCounter = -1;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Core OCR Logic (Unchanged) ---
async function processOcrRegions(buffer, metadata) {
  const { regions } = state.regionCoordinates;
  const ocrUpdates = {};

  // ========================================================================
  // --- OPTIMAL: Battle List Entry OCR Processing (Single Region Scan) ---
  // ========================================================================
  const battleListEntries = regions.battleList?.children?.entries?.list;

  if (
    battleListEntries &&
    Array.isArray(battleListEntries) &&
    battleListEntries.length > 0
  ) {
    try {
      // Step 1: Filter for valid entries and their name regions
      const validNameRegions = battleListEntries
        .filter(
          (entry) => entry && entry.name && typeof entry.name.x === 'number',
        )
        .map((entry) => entry.name);

      if (validNameRegions.length > 0) {
        // Step 2: Calculate a single "super-region" that contains all name regions
        let minX = Infinity,
          minY = Infinity;
        let maxX = -Infinity,
          maxY = -Infinity;

        for (const region of validNameRegions) {
          minX = Math.min(minX, region.x);
          minY = Math.min(minY, region.y);
          maxX = Math.max(maxX, region.x + region.width);
          maxY = Math.max(maxY, region.y + region.height);
        }

        const superRegion = {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        };

        // Step 3: Perform a SINGLE, STABLE OCR call on the super-region
        const monsterNameColors = regionDefinitions.battleList?.ocrColors || [
          [240, 240, 240],
        ];
        const ocrResults =
          recognizeText(buffer, superRegion, monsterNameColors) || [];
        // ocrResults is now an array like: [{ text: 'Rat', x: 1594, y: 17 }, { text: 'Cave Spider', x: 1594, y: 39 }]

        // Step 4: Map the found text lines back to the original entries by position
        const monsterNames = battleListEntries.map((entry) => {
          if (!entry || !entry.name) return ''; // Safety check for malformed entries

          // Find the OCR result whose Y-coordinate is very close to this entry's name region's Y-coordinate
          const foundText = ocrResults.find(
            (ocrLine) => Math.abs(ocrLine.y - entry.name.y) <= 3, // Use a small tolerance for Y-axis
          );

          return foundText ? foundText.text.trim() : '';
        });

        // Step 5: Dispatch the final, ordered list of names
        parentPort.postMessage({
          storeUpdate: true,
          type: 'uiValues/updateBattleListEntries',
          payload: monsterNames,
        });
      } else {
        // No valid name regions were found
        parentPort.postMessage({
          storeUpdate: true,
          type: 'uiValues/updateBattleListEntries',
          payload: [],
        });
      }
    } catch (ocrError) {
      console.error(
        `[OcrWorker] OCR process failed for battleList entries:`,
        ocrError,
      );
    }
  } else {
    // If the battle list is not on screen or empty, clear the UI
    parentPort.postMessage({
      storeUpdate: true,
      type: 'uiValues/updateBattleListEntries',
      payload: [],
    });
  }
  // ========================================================================
  // --- End of Battle List Processing ---
  // ========================================================================

  const regionConfigs = {
    gameLog: {
      colors: regionDefinitions.gameLog?.ocrColors || [[240, 240, 240]],
      parser: null,
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
      colors: regionDefinitions.selectCharacterModal?.ocrColors || [
        [240, 240, 240],
      ],
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

  for (const [regionKey, config] of Object.entries(regionConfigs)) {
    if (regions[regionKey]) {
      try {
        const rawData =
          recognizeText(buffer, regions[regionKey], config.colors) || [];
        ocrUpdates[regionKey] = rawData;
        if (
          config.parser &&
          rawData &&
          Array.isArray(rawData) &&
          rawData.length > 0
        ) {
          const parsedData = config.parser(rawData);
          if (
            parsedData &&
            (Array.isArray(parsedData) ? parsedData.length > 0 : true)
          ) {
            if (regionKey === 'skillsWidget') {
              parentPort.postMessage({
                storeUpdate: true,
                type: 'uiValues/updateSkillsWidget',
                payload: parsedData,
              });
            } else {
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
        console.error(
          `[OcrWorker] OCR process failed for ${regionKey}:`,
          ocrError,
        );
      }
    }
  }

  if (Object.keys(ocrUpdates).length > 0) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'ocr/setOcrRegionsText',
      payload: ocrUpdates,
    });
  }
}

async function mainLoop() {
  while (true) {
    const loopStartTime = performance.now();
    try {
      const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);
      if (
        newFrameCounter > lastProcessedFrameCounter &&
        state?.regionCoordinates?.regions
      ) {
        if (Atomics.load(syncArray, IS_RUNNING_INDEX) !== 0) {
          const width = Atomics.load(syncArray, WIDTH_INDEX);
          const height = Atomics.load(syncArray, HEIGHT_INDEX);
          const { regions } = state.regionCoordinates;
          if (Object.keys(regions).length > 0 && width > 0 && height > 0) {
            lastProcessedFrameCounter = newFrameCounter;
            const metadata = { width, height, frameCounter: newFrameCounter };

            // --- [OPTIMIZED] ---
            // The inefficient buffer snapshot has been removed.
            // We now pass the sharedBufferView directly to the OCR function,
            // eliminating a costly memory allocation and copy on every frame.
            await processOcrRegions(sharedBufferView, metadata);
          }
        }
      }
    } catch (err) {
      console.error('[OcrWorker] Fatal error in main loop:', err);
    }
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
  console.log('[OcrWorker] Worker starting up...');
  mainLoop();
}

startWorker();
