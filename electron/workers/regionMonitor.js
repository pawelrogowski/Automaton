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

// --- findRegionsRecursive (Unchanged from previous correct version) ---
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

  const discoveryResults = await findSequences.findSequencesNativeBatch(
    buffer,
    discoveryTasks,
  );

  const endpointTasks = {};
  const foundStarts = {};
  const childInvocations = [];

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

      if (def.children) {
        parentResult[name].children = {};
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
            { x: 0, y: 0 },
            parentResult[name].children,
            metadata,
          ),
        );
      }
    }
  }

  for (const [name, def] of Object.entries(boundingBoxDefs)) {
    const startResult = discoveryResults[`${name}_start`]?.[`${name}_start`];
    if (startResult) {
      foundStarts[name] = startResult;
      const maxW = def.maxRight === 'fullWidth' ? metadata.width : def.maxRight;
      const maxH = def.maxDown === 'fullHeight' ? metadata.height : def.maxDown;

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
    const absStartPos = {
      x: baseOffset.x + startPos.x,
      y: baseOffset.y + startPos.y,
    };

    const rawStartPos = {
      x: absStartPos.x - (def.start.offset?.x || 0),
      y: absStartPos.y - (def.start.offset?.y || 0),
    };

    if (!endPos) {
      parentResult[name] = {
        x: absStartPos.x,
        y: absStartPos.y,
        width: 0,
        height: 0,
        startFound: true,
        endFound: false,
        rawStartPos,
      };
      continue;
    }

    const absEndPos = {
      x: baseOffset.x + endPos.x,
      y: baseOffset.y + endPos.y,
    };

    const rawEndPos = {
      x: absEndPos.x - (def.end.offset?.x || 0),
      y: absEndPos.y - (def.end.offset?.y || 0),
    };
    const rectWidth = absEndPos.x - absStartPos.x + 1;
    const rectHeight = absEndPos.y - absStartPos.y + 1;

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

    if (def.children) {
      parentResult[name].children = {};
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
          { x: 0, y: 0 },
          parentResult[name].children,
          metadata,
        ),
      );
    }
  }

  for (const invoke of childInvocations) {
    await invoke();
  }
}

// ========================================================================
// --- NEW: BattleList Entry Processing ---
// ========================================================================
/**
 * Dynamically finds and analyzes each entry within the battle list.
 * This runs after the main 'entries' bounding box has been found.
 * @param {Buffer} buffer - The image buffer to scan.
 * @param {object} entriesRegion - The found region object for the 'entries' area.
 */
async function processBattleListEntries(buffer, entriesRegion) {
  // Define constants for entry layout
  const ENTRY_HEIGHT = 20;
  const ENTRY_VERTICAL_PITCH = 22; // 20px height + 2px gap

  const maxEntries = Math.floor(
    (entriesRegion.height + (ENTRY_VERTICAL_PITCH - ENTRY_HEIGHT)) /
      ENTRY_VERTICAL_PITCH,
  );

  if (maxEntries <= 0) {
    entriesRegion.list = [];
    return;
  }

  // Step 1: Build a SINGLE task with all pixel checks
  const pixelChecks = {
    '#FF0000': [], // Red for isTargeted
    '#000000': [], // Black for isAttacking and isValid
  };

  for (let i = 0; i < maxEntries; i++) {
    const entryBaseY = entriesRegion.y + i * ENTRY_VERTICAL_PITCH;
    const entryBaseX = entriesRegion.x;

    // Check for isTargeted (red border)
    pixelChecks['#FF0000'].push({
      x: entryBaseX,
      y: entryBaseY,
      id: `entry_${i}_isTargeted`,
    });

    // Check for isAttacking (black inner border)
    pixelChecks['#000000'].push({
      x: entryBaseX + 1,
      y: entryBaseY + 1,
      id: `entry_${i}_isAttacking`,
    });

    // Check for isValid (health bar's black border)
    pixelChecks['#000000'].push({
      x: entryBaseX + 22,
      y: entryBaseY + 15,
      id: `entry_${i}_isValid`,
    });
  }

  const singleBatchTask = {
    battleListChecks: {
      // A single task that contains all our checks
      searchArea: entriesRegion, // searchArea is still required, but not used for scanning
      pixelChecks: pixelChecks,
    },
  };

  // Step 2: Run the single, optimized batch scan
  const results = await findSequences.findSequencesNativeBatch(
    buffer,
    singleBatchTask,
  );
  const checkResults = results.battleListChecks || {};

  // Step 3: Process the results and build the final list
  const entryList = [];
  for (let i = 0; i < maxEntries; i++) {
    // An entry is only valid if its health bar border was found.
    if (checkResults[`entry_${i}_isValid`]) {
      const entryBaseY = entriesRegion.y + i * ENTRY_VERTICAL_PITCH;
      const entryBaseX = entriesRegion.x;

      const entryData = {
        isValid: true,
        isTargeted: !!checkResults[`entry_${i}_isTargeted`],
        isAttacking: !!checkResults[`entry_${i}_isAttacking`],
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
    // Start the recursive search from the top level
    await findRegionsRecursive(
      buffer,
      regionDefinitions,
      { x: 0, y: 0, width: metadata.width, height: metadata.height },
      { x: 0, y: 0 },
      foundRegions,
      metadata,
    );

    // --- MODIFICATION: Post-processing for BattleList ---
    // If the battle list's entries area was found, dissect it.
    if (foundRegions.battleList?.children?.entries?.endFound) {
      await processBattleListEntries(
        buffer,
        foundRegions.battleList.children.entries,
      );
    }
    // --- END MODIFICATION ---

    // Post-processing for special calculated regions
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
      // Modified to ignore 'list'
      // Process children recursively
      if (
        typeof region === 'object' &&
        region !== null &&
        !Array.isArray(region)
      ) {
        collectValidationTasks(
          region,
          definitions, // This might need adjustment if list items have defs
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

// --- performTargetedCheck (Unchanged, but may need future updates for entries) ---
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

  // NOTE: For now, targeted check only validates the main regions.
  // A full rescan will happen if the main layout changes, which will
  // re-run the dynamic entry processing. This is a reasonable starting point.

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
      // To keep the entry list fresh, we might need to re-run processing here too.
      // For now, we assume if the container is stable, the content is stable enough
      // to wait for the next full scan.
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
