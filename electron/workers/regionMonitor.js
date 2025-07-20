import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import regionDefinitions from '../constants/regionDefinitions.js'; // <-- UPDATED IMPORT
import { setAllRegions } from '../../frontend/redux/slices/regionCoordinatesSlice.js';
import findSequences from 'find-sequences-native';

// --- Worker Configuration & Setup ---
const { sharedData } = workerData;
const SCAN_INTERVAL_MS = 50;
const FULL_SCAN_INTERVAL_MS = 250;
if (!sharedData) throw new Error('[RegionMonitor] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const FRAME_COUNTER_INDEX = 0,
  WIDTH_INDEX = 1,
  HEIGHT_INDEX = 2,
  IS_RUNNING_INDEX = 3;
const HEADER_SIZE = 8;
const sharedBufferView = Buffer.from(imageSAB);
let monitorState = 'SEARCHING';
let lastProcessedFrameCounter = -1;
let lastKnownRegions = null;
let lastFullScanTimestamp = 0;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Flattened definitions are no longer needed with hierarchical structure

/**
 * Recursively finds regions defined in the new structure.
 * This function is the core of the new scanning logic.
 * @param {Buffer} buffer - The image buffer to scan.
 * @param {object} definitions - The current level of region definitions to process.
 * @param {object} searchArea - The area within which to search for the current definitions.
 * @param {object} baseOffset - The {x, y} offset of the searchArea relative to the full screen.
 * @param {object} parentResult - The parent object to populate with results (or root object).
 * @param {object} metadata - Screen metadata { width, height }.
 */
async function findRegionsRecursive(buffer, definitions, searchArea, baseOffset, parentResult, metadata) {
  const discoveryTasks = {};
  const boundingBoxDefs = {};
  const fixedDefs = {};

  // ========================================================================
  // STEP 1: Generate discovery tasks for the current hierarchy level
  // ========================================================================
  for (const [name, def] of Object.entries(definitions)) {
    switch (def.type) {
      case 'single':
        discoveryTasks[name] = { sequences: { [name]: def }, searchArea, occurrence: 'first' };
        break;
      case 'boundingBox':
        // For discovery, we only search for the 'start' sequence
        discoveryTasks[`${name}_start`] = { sequences: { [`${name}_start`]: def.start }, searchArea, occurrence: 'first' };
        boundingBoxDefs[name] = def;
        break;
      case 'fixed':
        fixedDefs[name] = def;
        break;
    }
  }

  // Process fixed regions immediately as they don't require a search
  for (const [name, def] of Object.entries(fixedDefs)) {
    parentResult[name] = {
      x: baseOffset.x + def.x,
      y: baseOffset.y + def.y,
      width: def.width,
      height: def.height,
    };
  }

  if (Object.keys(discoveryTasks).length === 0) {
    return; // No searchable regions at this level
  }

  // ========================================================================
  // STEP 2: Run the discovery search (1st native call for this level)
  // ========================================================================
  const discoveryResults = await findSequences.findSequencesNativeBatch(buffer, discoveryTasks);

  const endpointTasks = {};
  const foundStarts = {};
  const childInvocations = [];

  // ========================================================================
  // STEP 3: Process discovery results and prepare for endpoint search / recursion
  // ========================================================================

  // Process 'single' type results
  for (const [name, def] of Object.entries(definitions)) {
    if (def.type === 'single' && discoveryResults[name]?.[name]) {
      const result = discoveryResults[name][name];
      const region = {
        x: baseOffset.x + result.x,
        y: baseOffset.y + result.y,
        width: def.width,
        height: def.height,
        rawPos: {
          x: baseOffset.x + result.x - (def.offset?.x || 0),
          y: baseOffset.y + result.y - (def.offset?.y || 0),
        },
      };
      parentResult[name] = region;

      // If this region has children, queue a recursive call
      if (def.children) {
        // Initialize children object for this region
        parentResult[name].children = {};
        childInvocations.push(() =>
          findRegionsRecursive(
            buffer,
            def.children,
            { x: region.x, y: region.y, width: region.width, height: region.height },
            { x: region.x, y: region.y },
            parentResult[name].children,
            metadata,
          ),
        );
      }
    }
  }

  // Process 'boundingBox' start results and create endpoint tasks
  for (const [name, def] of Object.entries(boundingBoxDefs)) {
    const startResult = discoveryResults[`${name}_start`]?.[`${name}_start`];
    if (startResult) {
      foundStarts[name] = startResult;
      const maxW = def.maxRight === 'fullWidth' ? metadata.width : def.maxRight;
      const maxH = def.maxDown === 'fullHeight' ? metadata.height : def.maxDown;

      const endSearchArea = {
        x: baseOffset.x + startResult.x,
        y: baseOffset.y + startResult.y,
        width: Math.min(maxW, metadata.width - (baseOffset.x + startResult.x)),
        height: Math.min(maxH, metadata.height - (baseOffset.y + startResult.y)),
      };

      if (endSearchArea.width > 0 && endSearchArea.height > 0) {
        endpointTasks[`${name}_end`] = {
          sequences: { [`${name}_end`]: def.end },
          searchArea: endSearchArea,
          occurrence: 'first',
        };
      }
    }
  }

  // ========================================================================
  // STEP 4: Run endpoint search (2nd native call for this level)
  // ========================================================================
  let endpointResults = {};
  if (Object.keys(endpointTasks).length > 0) {
    endpointResults = await findSequences.findSequencesNativeBatch(buffer, endpointTasks);
  }

  // ========================================================================
  // STEP 5: Assemble bounding boxes and queue child recursion
  // ========================================================================
  for (const [name, startPos] of Object.entries(foundStarts)) {
    const def = boundingBoxDefs[name];
    const endPos = endpointResults[`${name}_end`]?.[`${name}_end`];
    const absStartPos = { x: baseOffset.x + startPos.x, y: baseOffset.y + startPos.y };

    const rawStartPos = {
      x: absStartPos.x - (def.start.offset?.x || 0),
      y: absStartPos.y - (def.start.offset?.y || 0),
    };

    if (!endPos) {
      parentResult[name] = { ...absStartPos, width: 0, height: 0, startFound: true, endFound: false, rawStartPos };
      continue;
    }

    const rawEndPos = {
      x: endPos.x - (def.end.offset?.x || 0),
      y: endPos.y - (def.end.offset?.y || 0),
    };
    const rectWidth = endPos.x - absStartPos.x + 1;
    const rectHeight = endPos.y - absStartPos.y + 1;

    const region = {
      x: absStartPos.x,
      y: absStartPos.y,
      width: rectWidth > 0 ? rectWidth : 0,
      height: rectHeight > 0 ? rectHeight : 0,
      startFound: true,
      endFound: true,
      rawStartPos,
      rawEndPos,
    };
    parentResult[name] = region;

    // If this region was fully found and has children, queue a recursive call
    if (def.children) {
      // Initialize children object for this region
      parentResult[name].children = {};
      childInvocations.push(() =>
        findRegionsRecursive(
          buffer,
          def.children,
          { x: region.x, y: region.y, width: region.width, height: region.height },
          { x: region.x, y: region.y },
          parentResult[name].children,
          metadata,
        ),
      );
    }
  }

  // ========================================================================
  // STEP 6: Execute all queued recursive calls for the next level down
  // ========================================================================
  for (const invoke of childInvocations) {
    await invoke();
  }
}

/**
 * Entry point for a full, expensive scan of the entire screen.
 */
async function performFullScan(buffer, metadata) {
  const foundRegions = {};
  try {
    // Start the recursive search from the top level
    await findRegionsRecursive(
      buffer,
      regionDefinitions,
      { x: 0, y: 0, width: metadata.width, height: metadata.height }, // Initial search area is the full screen
      { x: 0, y: 0 }, // Initial base offset
      foundRegions,
      metadata,
    );

    // Post-processing for special calculated regions
    if (foundRegions.gameWorld?.endFound) {
      const { gameWorld } = foundRegions;
      foundRegions.tileSize = { width: Math.round(gameWorld.width / 15), height: Math.round(gameWorld.height / 11) };
    }

    if (Object.keys(foundRegions).length > 0) {
      monitorState = 'MONITORING';
      lastKnownRegions = foundRegions;
    }
    parentPort.postMessage({ storeUpdate: true, type: setAllRegions.type, payload: foundRegions });
  } catch (error) {
    console.error('[RegionMonitor] Error during full scan:', error);
    monitorState = 'SEARCHING';
    lastKnownRegions = null;
    parentPort.postMessage({ storeUpdate: true, type: setAllRegions.type, payload: {} });
  }
}

/**
 * Recursively collects validation tasks for hierarchical regions.
 * @param {object} regions - The regions object to collect tasks from.
 * @param {object} definitions - The region definitions.
 * @param {object} checkTasks - The tasks object to populate.
 * @param {function} getValidationArea - Helper function to calculate validation areas.
 */
function collectValidationTasks(regions, definitions, checkTasks, getValidationArea, path = []) {
  for (const [name, region] of Object.entries(regions)) {
    if (name === 'children') {
      // Process children recursively
      collectValidationTasks(region, definitions, checkTasks, getValidationArea, path);
      continue;
    }

    const def = definitions[name];
    if (!def) continue;

    const currentPath = [...path, name].join('.');

    if (def.type === 'single' && region.rawPos) {
      const seqDef = { ...def, offset: { x: 0, y: 0 } };
      checkTasks[currentPath] = {
        sequences: { [currentPath]: seqDef },
        searchArea: getValidationArea(region.rawPos, def.sequence),
        occurrence: 'first',
      };
    } else if (def.type === 'boundingBox') {
      if (region.rawStartPos) {
        const startSeqDef = { ...def.start, offset: { x: 0, y: 0 } };
        checkTasks[`${currentPath}_start`] = {
          sequences: { [`${currentPath}_start`]: startSeqDef },
          searchArea: getValidationArea(region.rawStartPos, def.start.sequence),
          occurrence: 'first',
        };
      }
      if (region.rawEndPos) {
        const endSeqDef = { ...def.end, offset: { x: 0, y: 0 } };
        checkTasks[`${currentPath}_end`] = {
          sequences: { [`${currentPath}_end`]: endSeqDef },
          searchArea: getValidationArea(region.rawEndPos, def.end.sequence),
          occurrence: 'first',
        };
      }
    }

    // Process children recursively
    if (region.children && def.children) {
      collectValidationTasks(region.children, def.children, checkTasks, getValidationArea, [...path, name]);
    }
  }
}

/**
 * Performs a cheap, targeted check on all previously found verifiable regions.
 */
async function performTargetedCheck(buffer) {
  const checkTasks = {};

  const getValidationArea = (rawPos, seq) => {
    const seqLen = seq.length;
    const isVertical = seq.direction === 'vertical';
    return {
      x: rawPos.x,
      y: rawPos.y,
      width: isVertical ? 1 : seqLen,
      height: isVertical ? seqLen : 1,
    };
  };

  // Build a set of all validation tasks needed from hierarchical regions
  collectValidationTasks(lastKnownRegions || {}, regionDefinitions, checkTasks, getValidationArea);

  if (Object.keys(checkTasks).length === 0) {
    // No verifiable regions were found last time, so we must do a full scan.
    monitorState = 'SEARCHING';
    lastKnownRegions = null;
    return;
  }

  try {
    const searchResults = await findSequences.findSequencesNativeBatch(buffer, checkTasks);

    // Verify that all expected sequences were found
    let isStable = true;
    for (const taskName in checkTasks) {
      if (!searchResults[taskName]?.[taskName]) {
        isStable = false;
        break;
      }
    }

    if (isStable) {
      // The layout is stable, no need to send an update unless the data is different
      // For simplicity, we send it anyway. Redux will handle shallow comparisons.
      parentPort.postMessage({ storeUpdate: true, type: setAllRegions.type, payload: lastKnownRegions });
    } else {
      // Layout changed, trigger a full rescan on the next tick
      monitorState = 'SEARCHING';
      lastKnownRegions = null;
    }
  } catch (error) {
    console.error('[RegionMonitor] Error during targeted check. Reverting to full scan.', error);
    monitorState = 'SEARCHING';
    lastKnownRegions = null;
  }
}

// --- Main Loop (Unchanged) ---
async function mainLoop() {
  while (true) {
    const loopStartTime = performance.now();
    try {
      const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);
      if (newFrameCounter > lastProcessedFrameCounter) {
        if (Atomics.load(syncArray, IS_RUNNING_INDEX) === 0) {
          if (monitorState !== 'SEARCHING') {
            monitorState = 'SEARCHING';
            lastKnownRegions = null; // Clear regions when game is not running
            parentPort.postMessage({ storeUpdate: true, type: setAllRegions.type, payload: {} });
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
              await performTargetedCheck(bufferSnapshot);
            }
          }
        }
      }
    } catch (err) {
      console.error('[RegionMonitor] Fatal error in main loop:', err);
      monitorState = 'SEARCHING';
      lastKnownRegions = null;
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
    lastKnownRegions = null;
  }
});
async function startWorker() {
  console.log('[RegionMonitor] Worker starting up in SEARCHING state...');
  mainLoop();
}
startWorker();
