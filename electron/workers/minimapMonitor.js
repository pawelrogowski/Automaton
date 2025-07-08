import { parentPort, workerData } from 'worker_threads';
import { regionColorSequences, floorLevelIndicators } from '../constants/index.js';
import { PALETTE_DATA } from '../constants/palette.js';
import { createLogger } from '../utils/logger.js';
import { delay, createRegion, validateRegionDimensions } from './screenMonitor/modules/utils.js';
import { MinimapMatcher } from '../utils/minimapMatcher.js';
import findSequences from 'find-sequences-native';

const logger = createLogger({ info: true, error: true, debug: false });

// --- Shared Buffer Setup ---
const { sharedData } = workerData;
if (!sharedData) throw new Error('[MinimapMonitor] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const FRAME_COUNTER_INDEX = 0,
  WIDTH_INDEX = 1,
  HEIGHT_INDEX = 2,
  IS_RUNNING_INDEX = 3;
const HEADER_SIZE = 8; // Define the header size as a constant

// --- Configuration ---
const MINIMAP_WIDTH = 106,
  MINIMAP_HEIGHT = 109;
const minimapMatcher = new MinimapMatcher();

const colorToIndexMap = new Map();
PALETTE_DATA.forEach((color, index) => {
  const intKey = (color.r << 16) | (color.g << 8) | color.b;
  colorToIndexMap.set(intKey, index);
});

// --- Worker State ---
let state = null,
  initialized = false,
  shouldRestart = false,
  isSearching = false,
  lastKnownZ = null,
  lastProcessedFrameCounter = -1;
let fullWindowBufferView = null,
  fullWindowBufferMetadata = { width: 0, height: 0, frameCounter: 0 };
let minimapRegionDef = null,
  floorIndicatorRegionDef = null;
let lastMinimapFrameData = null;

function resetState() {
  initialized = false;
  shouldRestart = false;
  isSearching = false;
  lastKnownZ = null;
  lastProcessedFrameCounter = -1;
  fullWindowBufferView = null;
  minimapRegionDef = null;
  floorIndicatorRegionDef = null;
}

async function initialize() {
  resetState();
  logger('info', 'Initializing Minimap Monitor...');
  try {
    if (!minimapMatcher.isLoaded) await minimapMatcher.loadMapData();

    const lastFrame = Atomics.load(syncArray, FRAME_COUNTER_INDEX);
    const waitResult = Atomics.wait(syncArray, FRAME_COUNTER_INDEX, lastFrame, 5000);
    if (waitResult === 'timed-out') throw new Error('Timed out waiting for first frame.');

    const width = Atomics.load(syncArray, WIDTH_INDEX),
      height = Atomics.load(syncArray, HEIGHT_INDEX);
    if (width === 0 || height === 0) throw new Error('Received invalid frame dimension.');

    // *** THE FIRST PART OF THE FIX: Create a view of the correct size, including the header ***
    const bufferSize = HEADER_SIZE + width * height * 4;
    fullWindowBufferView = Buffer.from(imageSAB, 0, bufferSize);
    fullWindowBufferMetadata = { width, height, frameCounter: Atomics.load(syncArray, FRAME_COUNTER_INDEX) };

    // The rest of this logic is now operating on a buffer identical to the old one.
    const searchResults = findSequences.findSequencesNative(
      fullWindowBufferView,
      {
        minimapFull: regionColorSequences.minimapFull,
        minimapFloorIndicatorColumn: regionColorSequences.minimapFloorIndicatorColumn,
      },
      null,
      'first',
    );

    if (searchResults.minimapFull) minimapRegionDef = createRegion(searchResults.minimapFull, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    if (searchResults.minimapFloorIndicatorColumn) floorIndicatorRegionDef = createRegion(searchResults.minimapFloorIndicatorColumn, 2, 63);
    if (!minimapRegionDef || !floorIndicatorRegionDef) throw new Error('Could not locate all required minimap regions.');

    initialized = true;
    logger('info', 'Minimap monitor initialized successfully.');
  } catch (error) {
    logger('error', `Initialization error: ${error.message}`);
    shouldRestart = true;
  }
}

// *** THE SECOND PART OF THE FIX: Use the ORIGINAL, WORKING extractBGRA function ***
function extractBGRA(sourceBuffer, sourceMeta, rect) {
  if (!sourceBuffer || !rect || !validateRegionDimensions(rect)) return null;
  const { width: sourceWidth } = sourceMeta;
  const bytesPerPixel = 4;
  const headerSize = HEADER_SIZE; // Use the constant
  const targetSize = rect.width * rect.height * bytesPerPixel;
  const targetBuffer = Buffer.alloc(targetSize);
  for (let y = 0; y < rect.height; y++) {
    const sourceY = rect.y + y;
    // This calculation is now correct again, because our sourceBuffer (the view) contains the header.
    const sourceRowStart = headerSize + (sourceY * sourceWidth + rect.x) * bytesPerPixel;
    const targetRowStart = y * rect.width * bytesPerPixel;
    sourceBuffer.copy(targetBuffer, targetRowStart, sourceRowStart, sourceRowStart + rect.width * bytesPerPixel);
  }
  return targetBuffer;
}

// The rest of the file uses the same async/await logic which is correct.
async function processFrame() {
  if (!initialized || isSearching) return;

  Atomics.wait(syncArray, FRAME_COUNTER_INDEX, lastProcessedFrameCounter, 200);
  const currentFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);
  if (currentFrameCounter <= lastProcessedFrameCounter) return;

  const width = Atomics.load(syncArray, WIDTH_INDEX),
    height = Atomics.load(syncArray, HEIGHT_INDEX);
  const bufferSize = HEADER_SIZE + width * height * 4;
  fullWindowBufferView = Buffer.from(imageSAB, 0, bufferSize);
  fullWindowBufferMetadata = { width, height, frameCounter: currentFrameCounter };

  const now = Date.now();
  const currentMinimapData = extractBGRA(fullWindowBufferView, fullWindowBufferMetadata, minimapRegionDef);
  if (!currentMinimapData) {
    lastProcessedFrameCounter = currentFrameCounter;
    return;
  }

  if (lastMinimapFrameData && lastMinimapFrameData.equals(currentMinimapData)) {
    lastProcessedFrameCounter = currentFrameCounter;
    return;
  }
  lastMinimapFrameData = currentMinimapData;

  const searchResults = findSequences.findSequencesNativeBatch(fullWindowBufferView, {
    floor: { sequences: floorLevelIndicators, searchArea: floorIndicatorRegionDef, occurrence: 'first' },
  });
  const foundFloor = searchResults.floor || {};
  const floorKey = Object.keys(foundFloor).reduce(
    (lowest, key) => (foundFloor[key] !== null && foundFloor[key].y < lowest.y ? { key, y: foundFloor[key].y } : lowest),
    { key: null, y: Infinity },
  ).key;
  const detectedZ = floorKey !== null ? parseInt(floorKey, 10) : null;

  if (detectedZ !== null && detectedZ !== lastKnownZ) {
    lastKnownZ = detectedZ;
    parentPort.postMessage({ storeUpdate: true, type: 'gameState/setPlayerMinimapPosition', payload: { z: detectedZ } });
  }
  if (detectedZ === null) {
    lastProcessedFrameCounter = currentFrameCounter;
    return;
  }

  const minimapIndexData = new Uint8Array(MINIMAP_WIDTH * MINIMAP_HEIGHT);
  for (let i = 0; i < minimapIndexData.length; i++) {
    const p = i * 4;
    const key = (currentMinimapData[p + 2] << 16) | (currentMinimapData[p + 1] << 8) | currentMinimapData[p];
    minimapIndexData[i] = colorToIndexMap.get(key) ?? 0;
  }

  isSearching = true;
  minimapMatcher.cancelCurrentSearch();
  try {
    const result = await minimapMatcher.findPosition(minimapIndexData, MINIMAP_WIDTH, MINIMAP_HEIGHT, detectedZ);
    if (result?.position) {
      const cleanPayload = { x: result.position.x, y: result.position.y, z: result.position.z };
      parentPort.postMessage({ storeUpdate: true, type: 'gameState/setPlayerMinimapPosition', payload: cleanPayload });
    }
  } catch (err) {
    if (err.message !== 'Search cancelled') logger('error', `Minimap search failed: ${err.message}`);
  } finally {
    isSearching = false;
  }

  lastProcessedFrameCounter = currentFrameCounter;
}

async function start() {
  logger('info', 'Minimap monitor worker started.');
  while (true) {
    try {
      if (!initialized || shouldRestart) {
        await initialize();
      }
      if (initialized) {
        await processFrame();
      } else {
        await delay(50);
      }
      if (Atomics.load(syncArray, IS_RUNNING_INDEX) === 0) {
        shouldRestart = true;
      }
    } catch (err) {
      logger('error', `Fatal error in mainLoop: ${err.stack}`);
      shouldRestart = true;
      await delay(500);
    }
  }
}

parentPort.on('message', (message) => {
  if (message?.command === 'forceReinitialize') {
    shouldRestart = true;
  }
  state = message;
});

parentPort.on('close', () => {
  process.exit(0);
});

start();
