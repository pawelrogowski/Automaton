// regionMonitor.js – CLEANED — NO BENCHMARKING
import { parentPort, workerData } from 'worker_threads';
import regionDefinitions from '../constants/regionDefinitions.js';
import { setAllRegions } from '../../frontend/redux/slices/regionCoordinatesSlice.js';
import findSequences from 'find-sequences-native';
import { FrameUpdateManager } from '../utils/frameUpdateManager.js';

// --- Worker Configuration & Setup ---
const { sharedData } = workerData;
const FULL_SCAN_INTERVAL_MS = 500;
const MIN_LOOP_DELAY_MS = 250;

if (!sharedData) throw new Error('[RegionMonitor] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const sharedBufferView = Buffer.from(imageSAB);

// --- SharedArrayBuffer Indices ---
const WIDTH_INDEX = 1;
const HEIGHT_INDEX = 2;
const IS_RUNNING_INDEX = 3;

// --- State variables ---
let lastKnownRegions = {};
let lastWidth = 0;
let lastHeight = 0;
let isShuttingDown = false;
let isScanning = false;
const frameUpdateManager = new FrameUpdateManager();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function to calculate constrained search area based on definition
function calculateConstrainedSearchArea(def, fullSearchArea, metadata) {
  if (!def.searchArea) return fullSearchArea;

  const { searchArea } = def;
  let constrainedArea = { ...fullSearchArea };

  switch (searchArea.type) {
    case 'rightEdge':
      if (searchArea.maxFromRight) {
        const minX = Math.max(0, metadata.width - searchArea.maxFromRight);
        constrainedArea.x = Math.max(constrainedArea.x, minX);
        constrainedArea.width = Math.min(
          constrainedArea.width,
          metadata.width - constrainedArea.x,
        );
      }
      break;

    case 'leftEdge':
      if (searchArea.maxFromLeft) {
        constrainedArea.width = Math.min(
          constrainedArea.width,
          searchArea.maxFromLeft,
        );
      }
      break;

    case 'bottomHalf':
      const halfHeight = Math.floor(metadata.height / 2);
      constrainedArea.y = Math.max(constrainedArea.y, halfHeight);
      constrainedArea.height = Math.min(
        constrainedArea.height,
        metadata.height - constrainedArea.y,
      );
      break;

    case 'center':
      const centerX = Math.floor(metadata.width / 2);
      const centerY = Math.floor(metadata.height / 2);
      const quarterWidth = Math.floor(metadata.width / 4);
      const quarterHeight = Math.floor(metadata.height / 4);

      constrainedArea.x = Math.max(constrainedArea.x, centerX - quarterWidth);
      constrainedArea.y = Math.max(constrainedArea.y, centerY - quarterHeight);
      constrainedArea.width = Math.min(constrainedArea.width, quarterWidth * 2);
      constrainedArea.height = Math.min(
        constrainedArea.height,
        quarterHeight * 2,
      );
      break;
  }

  // Ensure area is valid
  constrainedArea.width = Math.max(0, constrainedArea.width);
  constrainedArea.height = Math.max(0, constrainedArea.height);

  return constrainedArea;
}

// --- Recursive Region Finding Logic ---
async function findRegionsRecursive(
  buffer,
  definitions,
  searchArea,
  baseOffset,
  parentResult,
  metadata,
) {
  const discoveryTasks = {};
  const boundingBoxDefs = {};
  const fixedDefs = {};
  const defEntries = Object.entries(definitions);
  if (defEntries.length === 0) return;

  for (const [name, def] of defEntries) {
    switch (def.type) {
      case 'single':
        const singleSearchArea = calculateConstrainedSearchArea(
          def,
          searchArea,
          metadata,
        );
        discoveryTasks[name] = {
          sequences: { [name]: def },
          searchArea: singleSearchArea,
          occurrence: 'first',
        };
        break;
      case 'boundingBox':
        const boundingBoxSearchArea = calculateConstrainedSearchArea(
          def,
          searchArea,
          metadata,
        );
        discoveryTasks[`${name}_start`] = {
          sequences: { [`${name}_start`]: def.start },
          searchArea: boundingBoxSearchArea,
          occurrence: 'first',
        };
        boundingBoxDefs[name] = def;
        break;
      case 'fixed':
        fixedDefs[name] = def;
        break;
    }
  }

  for (const [name, def] of Object.entries(fixedDefs)) {
    parentResult[name] = {
      x: baseOffset.x + def.x,
      y: baseOffset.y + def.y,
      width: def.width,
      height: def.height,
    };
  }

  if (!Object.keys(discoveryTasks).length) return;

  const discoveryResults = await findSequences.findSequencesNativeBatch(
    buffer,
    discoveryTasks,
  );
  const endpointTasks = {};
  const foundStarts = {};
  const childInvocations = [];

  for (const [name, def] of defEntries) {
    if (def.type === 'single' && discoveryResults[name]?.[name]) {
      const result = discoveryResults[name][name];
      const region = {
        x: result.x,
        y: result.y,
        width: def.width,
        height: def.height,
        rawPos: {
          x: result.x - (def.offset?.x || 0),
          y: result.y - (def.offset?.y || 0),
        },
      };
      parentResult[name] = region;
      if (def.children) {
        parentResult[name].children = {};
        childInvocations.push(() =>
          findRegionsRecursive(
            buffer,
            def.children,
            region,
            { x: region.x, y: region.y },
            parentResult[name].children,
            metadata,
          ),
        );
      }
    }
  }

  for (const [name, def] of Object.entries(boundingBoxDefs)) {
    const startResult = discoveryResults[`${name}_start`]?.[`${name}_start`];
    if (!startResult) continue;
    foundStarts[name] = startResult;
    const maxW = def.maxRight === 'fullWidth' ? metadata.width : def.maxRight;
    const maxH = def.maxDown === 'fullHeight' ? metadata.height : def.maxDown;
    const endSearchArea = {
      x: startResult.x,
      y: startResult.y,
      width: Math.min(maxW, searchArea.x + searchArea.width - startResult.x),
      height: Math.min(maxH, searchArea.y + searchArea.height - startResult.y),
    };
    if (endSearchArea.width > 0 && endSearchArea.height > 0) {
      endpointTasks[`${name}_end`] = {
        sequences: { [`${name}_end`]: def.end },
        searchArea: endSearchArea,
        occurrence: 'first',
      };
    }
  }

  let endpointResults = {};
  if (Object.keys(endpointTasks).length > 0) {
    endpointResults = await findSequences.findSequencesNativeBatch(
      buffer,
      endpointTasks,
    );
  }

  for (const [name, startPos] of Object.entries(foundStarts)) {
    const def = boundingBoxDefs[name];
    const endPos = endpointResults[`${name}_end`]?.[`${name}_end`];
    const absStartPos = { x: startPos.x, y: startPos.y };
    const rawStartPos = {
      x: absStartPos.x - (def.start.offset?.x || 0),
      y: absStartPos.y - (def.start.offset?.y || 0),
    };
    if (!endPos) {
      parentResult[name] = {
        ...absStartPos,
        width: 0,
        height: 0,
        startFound: true,
        endFound: false,
        rawStartPos,
      };
      continue;
    }
    const rectWidth = endPos.x - startPos.x + 1;
    const rectHeight = endPos.y - startPos.y + 1;
    const region = {
      ...absStartPos,
      width: rectWidth > 0 ? rectWidth : 0,
      height: rectHeight > 0 ? rectHeight : 0,
      startFound: true,
      endFound: true,
      rawStartPos,
      rawEndPos: {
        x: endPos.x - (def.end.offset?.x || 0),
        y: endPos.y - (def.end.offset?.y || 0),
      },
    };
    parentResult[name] = region;
    if (def.children) {
      parentResult[name].children = {};
      childInvocations.push(() =>
        findRegionsRecursive(
          buffer,
          def.children,
          region,
          { x: region.x, y: region.y },
          parentResult[name].children,
          metadata,
        ),
      );
    }
  }

  if (childInvocations.length > 0) {
    await Promise.all(childInvocations.map((invoke) => invoke()));
  }
}

/**
 * Processes special regions after the main recursive find.
 */
async function processSpecialRegions(buffer, regions, metadata) {
  if (regions.gameWorld?.endFound) {
    const { gameWorld } = regions;
    regions.tileSize = {
      width: Math.round(gameWorld.width / 15),
      height: Math.round(gameWorld.height / 11),
    };
  }
}

async function performFullScan(buffer, metadata) {
  const foundRegions = {};
  await findRegionsRecursive(
    buffer,
    regionDefinitions,
    { x: 0, y: 0, width: metadata.width, height: metadata.height },
    { x: 0, y: 0 },
    foundRegions,
    metadata,
  );
  await processSpecialRegions(buffer, foundRegions, metadata);
  return foundRegions;
}

async function mainLoop() {
  while (!isShuttingDown) {
    try {
      if (isScanning) {
        await delay(MIN_LOOP_DELAY_MS);
        continue;
      }

      const width = Atomics.load(syncArray, WIDTH_INDEX);
      const height = Atomics.load(syncArray, HEIGHT_INDEX);
      const dimensionsChanged = width !== lastWidth || height !== lastHeight;

      if (!frameUpdateManager.shouldProcess() && !dimensionsChanged) {
        await delay(MIN_LOOP_DELAY_MS);
        continue;
      }

      if (Atomics.load(syncArray, IS_RUNNING_INDEX) !== 1) {
        if (Object.keys(lastKnownRegions).length > 0) {
          lastKnownRegions = {};
          parentPort.postMessage({
            storeUpdate: true,
            type: setAllRegions.type,
            payload: {},
          });
        }
        await delay(MIN_LOOP_DELAY_MS);
        continue;
      }

      if (width <= 0 || height <= 0) {
        await delay(MIN_LOOP_DELAY_MS);
        continue;
      }

      isScanning = true;
      try {
        const metadata = { width, height };
        const newRegions = await performFullScan(sharedBufferView, metadata);

        lastWidth = width;
        lastHeight = height;
        lastKnownRegions = newRegions;

        parentPort.postMessage({
          storeUpdate: true,
          type: setAllRegions.type,
          payload: newRegions,
        });
      } catch (err) {
        console.error('[RegionMonitor] Error during scan:', err);
        lastKnownRegions = {};
      } finally {
        isScanning = false;
      }
    } catch (err) {
      console.error('[RegionMonitor] Error in main loop:', err);
      lastKnownRegions = {};
    }

    // Respect timing logic
    const elapsedTime = Date.now();
    const delayTime = Math.max(
      0,
      FULL_SCAN_INTERVAL_MS - (Date.now() - elapsedTime),
    );
    if (delayTime > 0) {
      await delay(delayTime);
    }
  }
}

parentPort.on('message', (message) => {
  try {
    if (message.type === 'frame-update') {
      frameUpdateManager.addDirtyRects(message.payload.dirtyRects);
      return;
    }

    if (message.type === 'shutdown') {
      isShuttingDown = true;
    }
  } catch (err) {
    console.error('[RegionMonitor] Error handling message:', err);
  }
});

async function startWorker() {
  mainLoop().catch((err) => {
    console.error('[RegionMonitor] Fatal error in main loop:', err);
    process.exit(1);
  });
}

startWorker();
