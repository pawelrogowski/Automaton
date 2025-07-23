import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import regionDefinitions from '../constants/regionDefinitions.js';
import { setAllRegions } from '../../frontend/redux/slices/regionCoordinatesSlice.js';
import findSequences from 'find-sequences-native';

// --- Worker Configuration & Setup (Unchanged) ---
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

// ========================================================================
// --- CORRECTED findRegionsRecursive ---
// This version correctly calculates absolute coordinates for all children
// while also correctly calculating the dimensions of bounding boxes.
// ========================================================================
async function findRegionsRecursive(
  buffer,
  definitions,
  searchArea, // The absolute area within which to search
  baseOffset, // The absolute {x, y} of the parent region, ONLY for 'fixed' children
  parentResult,
  metadata,
) {
  const discoveryTasks = {};
  const boundingBoxDefs = {};
  const fixedDefs = {};

  // Step 1: Generate discovery tasks. The searchArea is always absolute.
  for (const [name, def] of Object.entries(definitions)) {
    switch (def.type) {
      case 'single':
        discoveryTasks[name] = {
          sequences: { [name]: def },
          searchArea,
          occurrence: 'first',
        };
        break;
      case 'boundingBox':
        discoveryTasks[`${name}_start`] = {
          sequences: { [`${name}_start`]: def.start },
          searchArea,
          occurrence: 'first',
        };
        boundingBoxDefs[name] = def;
        break;
      case 'fixed':
        fixedDefs[name] = def;
        break;
    }
  }

  // Process fixed regions. This is the ONLY place baseOffset should be used for positioning.
  for (const [name, def] of Object.entries(fixedDefs)) {
    parentResult[name] = {
      x: baseOffset.x + def.x,
      y: baseOffset.y + def.y,
      width: def.width,
      height: def.height,
    };
  }

  if (Object.keys(discoveryTasks).length === 0) {
    return;
  }

  // Step 2: Run the discovery search
  const discoveryResults = await findSequences.findSequencesNativeBatch(
    buffer,
    discoveryTasks,
  );

  const endpointTasks = {};
  const foundStarts = {};
  const childInvocations = [];

  // Step 3: Process 'single' results.
  for (const [name, def] of Object.entries(definitions)) {
    if (def.type === 'single' && discoveryResults[name]?.[name]) {
      const result = discoveryResults[name][name];
      // ** THE REAL FIX **: Treat the result coordinates as ALREADY ABSOLUTE. Do NOT add baseOffset.
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
        // For recursion, the new searchArea and baseOffset are the parent's absolute region.
        childInvocations.push(() =>
          findRegionsRecursive(
            buffer,
            def.children,
            {
              x: region.x,
              y: region.y,
              width: region.width,
              height: region.height,
            },
            { x: region.x, y: region.y },
            parentResult[name].children,
            metadata,
          ),
        );
      }
    }
  }

  // Step 4: Process 'boundingBox' start results and create endpoint tasks.
  for (const [name, def] of Object.entries(boundingBoxDefs)) {
    const startResult = discoveryResults[`${name}_start`]?.[`${name}_start`];
    if (startResult) {
      // The native module returns an absolute position, so we store it directly.
      foundStarts[name] = startResult;
      const maxW = def.maxRight === 'fullWidth' ? metadata.width : def.maxRight;
      const maxH = def.maxDown === 'fullHeight' ? metadata.height : def.maxDown;

      // The search for the endpoint starts from the absolute position of the start point.
      const endSearchArea = {
        x: startResult.x,
        y: startResult.y,
        width: Math.min(maxW, searchArea.x + searchArea.width - startResult.x),
        height: Math.min(
          maxH,
          searchArea.y + searchArea.height - startResult.y,
        ),
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

  // Step 5: Run endpoint search
  let endpointResults = {};
  if (Object.keys(endpointTasks).length > 0) {
    endpointResults = await findSequences.findSequencesNativeBatch(
      buffer,
      endpointTasks,
    );
  }

  // Step 6: Assemble bounding boxes.
  for (const [name, startPos] of Object.entries(foundStarts)) {
    const def = boundingBoxDefs[name];
    const endPos = endpointResults[`${name}_end`]?.[`${name}_end`];

    // ** THE REAL FIX **: The startPos from the native module is ALREADY ABSOLUTE.
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

    // Since both startPos and endPos are absolute, we can subtract them directly for the dimensions.
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
      // For recursion, the new searchArea and baseOffset are the parent's absolute region.
      childInvocations.push(() =>
        findRegionsRecursive(
          buffer,
          def.children,
          {
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
          },
          { x: region.x, y: region.y },
          parentResult[name].children,
          metadata,
        ),
      );
    }
  }

  // Step 7: Execute all queued recursive calls
  for (const invoke of childInvocations) {
    await invoke();
  }
}

// ========================================================================
// --- NEW: BattleList Entry Processing (Unchanged) ---
// ========================================================================
async function processBattleListEntries(buffer, entriesRegion) {
  const ENTRY_HEIGHT = 20;
  const ENTRY_VERTICAL_PITCH = 22;

  const maxEntries = Math.floor(
    (entriesRegion.height + (ENTRY_VERTICAL_PITCH - ENTRY_HEIGHT)) /
      ENTRY_VERTICAL_PITCH,
  );

  if (maxEntries <= 0) {
    entriesRegion.list = [];
    return;
  }

  const pixelChecks = {
    '#FF0000': [],
    '#FF8080': [],
    '#000000': [],
  };

  for (let i = 0; i < maxEntries; i++) {
    const entryBaseY = entriesRegion.y + i * ENTRY_VERTICAL_PITCH;
    const entryBaseX = entriesRegion.x;

    pixelChecks['#FF0000'].push({
      x: entryBaseX,
      y: entryBaseY,
      id: `entry_${i}_isTargeted_red`,
    });
    pixelChecks['#FF8080'].push({
      x: entryBaseX,
      y: entryBaseY,
      id: `entry_${i}_isTargeted_hovered`,
    });
    pixelChecks['#000000'].push({
      x: entryBaseX,
      y: entryBaseY,
      id: `entry_${i}_isAttacking_0_0`,
    });
    pixelChecks['#000000'].push({
      x: entryBaseX + 1,
      y: entryBaseY + 1,
      id: `entry_${i}_isAttacking_1_1`,
    });
    pixelChecks['#000000'].push({
      x: entryBaseX + 22,
      y: entryBaseY + 15,
      id: `entry_${i}_isValid`,
    });
  }

  const singleBatchTask = {
    battleListChecks: {
      searchArea: entriesRegion,
      pixelChecks: pixelChecks,
    },
  };

  const results = await findSequences.findSequencesNativeBatch(
    buffer,
    singleBatchTask,
  );
  const checkResults = results.battleListChecks || {};

  const entryList = [];
  for (let i = 0; i < maxEntries; i++) {
    if (checkResults[`entry_${i}_isValid`]) {
      const entryBaseY = entriesRegion.y + i * ENTRY_VERTICAL_PITCH;
      const entryBaseX = entriesRegion.x;

      const entryData = {
        isValid: true,
        isTargeted:
          !!checkResults[`entry_${i}_isTargeted_red`] ||
          !!checkResults[`entry_${i}_isTargeted_hovered`],
        isAttacking:
          !!checkResults[`entry_${i}_isAttacking_0_0`] ||
          !!checkResults[`entry_${i}_isAttacking_1_1`],
        name: {
          x: entryBaseX + 22,
          y: entryBaseY + 2,
          width: 131,
          height: 12,
        },
        healthBarFull: {
          x: entryBaseX + 22,
          y: entryBaseY + 15,
          width: 132,
          height: 5,
        },
        healthBarFill: {
          x: entryBaseX + 23,
          y: entryBaseY + 16,
          width: 130,
          height: 3,
        },
      };
      entryList.push(entryData);
    }
  }

  entriesRegion.list = entryList;
}

/**
 * Entry point for a full, expensive scan of the entire screen.
 */
async function performFullScan(buffer, metadata) {
  const foundRegions = {};
  try {
    // Start the recursive search from the top level with a base offset of (0,0)
    await findRegionsRecursive(
      buffer,
      regionDefinitions,
      { x: 0, y: 0, width: metadata.width, height: metadata.height },
      { x: 0, y: 0 }, // Initial base offset is the screen origin
      foundRegions,
      metadata,
    );

    if (foundRegions.battleList?.children?.entries?.endFound) {
      await processBattleListEntries(
        buffer,
        foundRegions.battleList.children.entries,
      );
    }

    if (foundRegions.gameWorld?.endFound) {
      const { gameWorld } = foundRegions;
      foundRegions.tileSize = {
        width: Math.round(gameWorld.width / 15),
        height: Math.round(gameWorld.height / 11),
      };
    }

    if (Object.keys(foundRegions).length > 0) {
      monitorState = 'MONITORING';
      lastKnownRegions = foundRegions;
    }
    parentPort.postMessage({
      storeUpdate: true,
      type: setAllRegions.type,
      payload: foundRegions,
    });
  } catch (error) {
    console.error('[RegionMonitor] Error during full scan:', error);
    monitorState = 'SEARCHING';
    lastKnownRegions = null;
    parentPort.postMessage({
      storeUpdate: true,
      type: setAllRegions.type,
      payload: {},
    });
  }
}

// --- collectValidationTasks (Unchanged) ---
function collectValidationTasks(
  regions,
  definitions,
  checkTasks,
  getValidationArea,
  path = [],
) {
  for (const [name, region] of Object.entries(regions)) {
    if (name === 'children' || name === 'list') {
      if (
        typeof region === 'object' &&
        region !== null &&
        !Array.isArray(region)
      ) {
        collectValidationTasks(
          region,
          definitions,
          checkTasks,
          getValidationArea,
          path,
        );
      }
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

    if (region.children && def.children) {
      collectValidationTasks(
        region.children,
        def.children,
        checkTasks,
        getValidationArea,
        [...path, name],
      );
    }
  }
}

// --- performTargetedCheck (Unchanged) ---
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

  collectValidationTasks(
    lastKnownRegions || {},
    regionDefinitions,
    checkTasks,
    getValidationArea,
  );

  if (Object.keys(checkTasks).length === 0) {
    monitorState = 'SEARCHING';
    lastKnownRegions = null;
    return;
  }

  try {
    const searchResults = await findSequences.findSequencesNativeBatch(
      buffer,
      checkTasks,
    );

    let isStable = true;
    for (const taskName in checkTasks) {
      if (!searchResults[taskName]?.[taskName]) {
        isStable = false;
        break;
      }
    }

    if (isStable) {
      if (lastKnownRegions.battleList?.children?.entries?.endFound) {
        await processBattleListEntries(
          buffer,
          lastKnownRegions.battleList.children.entries,
        );
      }
      parentPort.postMessage({
        storeUpdate: true,
        type: setAllRegions.type,
        payload: lastKnownRegions,
      });
    } else {
      monitorState = 'SEARCHING';
      lastKnownRegions = null;
    }
  } catch (error) {
    console.error(
      '[RegionMonitor] Error during targeted check. Reverting to full scan.',
      error,
    );
    monitorState = 'SEARCHING';
    lastKnownRegions = null;
  }
}

// --- Main Loop & Worker Setup (Unchanged) ---
async function mainLoop() {
  while (true) {
    const loopStartTime = performance.now();
    try {
      const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);
      if (newFrameCounter > lastProcessedFrameCounter) {
        if (Atomics.load(syncArray, IS_RUNNING_INDEX) === 0) {
          if (monitorState !== 'SEARCHING') {
            monitorState = 'SEARCHING';
            lastKnownRegions = null;
            parentPort.postMessage({
              storeUpdate: true,
              type: setAllRegions.type,
              payload: {},
            });
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
            const forceFullScan =
              now - lastFullScanTimestamp > FULL_SCAN_INTERVAL_MS;
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
