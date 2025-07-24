import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import regionDefinitions from '../constants/regionDefinitions.js';
import { setAllRegions } from '../../frontend/redux/slices/regionCoordinatesSlice.js';
import findSequences from 'find-sequences-native';

// --- Worker Configuration & Setup ---
const { sharedData } = workerData;
// NOTE: SCAN_INTERVAL_MS is now the same as FULL_SCAN_INTERVAL_MS
const SCAN_INTERVAL_MS = 150;
const FULL_SCAN_INTERVAL_MS = 150;

if (!sharedData) throw new Error('[RegionMonitor] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const FRAME_COUNTER_INDEX = 0,
  WIDTH_INDEX = 1,
  HEIGHT_INDEX = 2,
  IS_RUNNING_INDEX = 3;
const HEADER_SIZE = 8;
const sharedBufferView = Buffer.from(imageSAB);
let lastProcessedFrameCounter = -1;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ========================================================================
// --- findRegionsRecursive (Unchanged) ---
// ========================================================================
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

  // Step 1: Generate discovery tasks
  for (const [name, def] of defEntries) {
    const type = def.type;
    switch (type) {
      case 'single':
        discoveryTasks[name] = {
          sequences: { [name]: def },
          searchArea,
          occurrence: 'first',
        };
        break;
      case 'boundingBox':
        const startTaskKey = `${name}_start`;
        discoveryTasks[startTaskKey] = {
          sequences: { [startTaskKey]: def.start },
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

  // Process fixed regions
  for (const [name, def] of Object.entries(fixedDefs)) {
    parentResult[name] = {
      x: baseOffset.x + def.x,
      y: baseOffset.y + def.y,
      width: def.width,
      height: def.height,
    };
  }

  if (!Object.keys(discoveryTasks).length) return;

  // Step 2: Run discovery search
  const discoveryResults = await findSequences.findSequencesNativeBatch(
    buffer,
    discoveryTasks,
  );

  const endpointTasks = {};
  const foundStarts = {};
  const childInvocations = [];

  // Step 3: Process 'single' results
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

  // Step 4: Process bounding boxes
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

  // Step 5: Run endpoint search
  let endpointResults = {};
  if (Object.keys(endpointTasks).length > 0) {
    endpointResults = await findSequences.findSequencesNativeBatch(
      buffer,
      endpointTasks,
    );
  }

  // Step 6: Assemble bounding boxes
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

  // Step 7: Parallelize child processing
  if (childInvocations.length > 0) {
    await Promise.all(childInvocations.map((invoke) => invoke()));
  }
}

// ========================================================================
// --- BattleList Processing Helpers (Unchanged) ---
// ========================================================================
const BATTLE_LIST_ENTRY_HEIGHT = 20;
const BATTLE_LIST_ENTRY_VERTICAL_PITCH = 22;

function generateBattleListTasks(entriesRegion) {
  const maxEntries = Math.floor(
    (entriesRegion.height +
      (BATTLE_LIST_ENTRY_VERTICAL_PITCH - BATTLE_LIST_ENTRY_HEIGHT)) /
      BATTLE_LIST_ENTRY_VERTICAL_PITCH,
  );
  if (maxEntries <= 0) return null;
  const pixelChecks = {
    '#FF0000': [],
    '#FF8080': [],
    '#000000': [],
  };
  for (let i = 0; i < maxEntries; i++) {
    const entryBaseY = entriesRegion.y + i * BATTLE_LIST_ENTRY_VERTICAL_PITCH;
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
  return { searchArea: entriesRegion, pixelChecks };
}

function processBattleListResults(checkResults, entriesRegion) {
  const maxEntries = Math.floor(
    (entriesRegion.height +
      (BATTLE_LIST_ENTRY_VERTICAL_PITCH - BATTLE_LIST_ENTRY_HEIGHT)) /
      BATTLE_LIST_ENTRY_VERTICAL_PITCH,
  );
  const entryList = [];
  if (!checkResults || maxEntries <= 0) {
    entriesRegion.list = [];
    return;
  }
  for (let i = 0; i < maxEntries; i++) {
    if (checkResults[`entry_${i}_isValid`]) {
      const entryBaseY = entriesRegion.y + i * BATTLE_LIST_ENTRY_VERTICAL_PITCH;
      const entryBaseX = entriesRegion.x;
      entryList.push({
        isValid: true,
        isTargeted:
          !!checkResults[`entry_${i}_isTargeted_red`] ||
          !!checkResults[`entry_${i}_isTargeted_hovered`],
        isAttacking:
          !!checkResults[`entry_${i}_isAttacking_0_0`] ||
          !!checkResults[`entry_${i}_isAttacking_1_1`],
        name: { x: entryBaseX + 22, y: entryBaseY + 2, width: 131, height: 12 },
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
      });
    }
  }
  entriesRegion.list = entryList;
}

// ========================================================================
// --- performFullScan (Now the only search function) ---
// ========================================================================
async function performFullScan(buffer, metadata) {
  const foundRegions = {};
  try {
    // Always start a fresh recursive search from the top level.
    await findRegionsRecursive(
      buffer,
      regionDefinitions,
      { x: 0, y: 0, width: metadata.width, height: metadata.height },
      { x: 0, y: 0 },
      foundRegions,
      metadata,
    );

    // Process dynamic content like the battle list if its container was found.
    if (foundRegions.battleList?.children?.entries?.endFound) {
      const battleListTask = generateBattleListTasks(
        foundRegions.battleList.children.entries,
      );
      if (battleListTask) {
        const batchTask = { battleListChecks: battleListTask };
        const results = await findSequences.findSequencesNativeBatch(
          buffer,
          batchTask,
        );
        processBattleListResults(
          results.battleListChecks,
          foundRegions.battleList.children.entries,
        );
      }
    }

    // Calculate tile size if the game world was found.
    if (foundRegions.gameWorld?.endFound) {
      const { gameWorld } = foundRegions;
      foundRegions.tileSize = {
        width: Math.round(gameWorld.width / 15),
        height: Math.round(gameWorld.height / 11),
      };
    }

    // Post the results to the main thread.
    parentPort.postMessage({
      storeUpdate: true,
      type: setAllRegions.type,
      payload: foundRegions,
    });
  } catch (error) {
    console.error('[RegionMonitor] Error during full scan:', error);
    // On error, post an empty object to clear the UI.
    parentPort.postMessage({
      storeUpdate: true,
      type: setAllRegions.type,
      payload: {},
    });
  }
}

// ========================================================================
// --- Main Loop (Simplified for Full Scan Only) ---
// ========================================================================
async function mainLoop() {
  while (true) {
    const loopStartTime = performance.now();
    try {
      const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);
      if (newFrameCounter > lastProcessedFrameCounter) {
        if (Atomics.load(syncArray, IS_RUNNING_INDEX) === 1) {
          const width = Atomics.load(syncArray, WIDTH_INDEX);
          const height = Atomics.load(syncArray, HEIGHT_INDEX);
          if (width > 0 && height > 0) {
            lastProcessedFrameCounter = newFrameCounter;
            const metadata = { width, height, frameCounter: newFrameCounter };

            // Always perform a full scan.
            await performFullScan(sharedBufferView, metadata);
          }
        } else {
          // If not running, clear the regions.
          parentPort.postMessage({
            storeUpdate: true,
            type: setAllRegions.type,
            payload: {},
          });
        }
      }
    } catch (err) {
      console.error('[RegionMonitor] Fatal error in main loop:', err);
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
  // The 'forceRegionSearch' command is no longer needed as every scan is a full one.
  // We can leave the handler here in case it's used elsewhere, but it does nothing.
});

async function startWorker() {
  console.log('[RegionMonitor] Worker starting up in "Full Scan Only" mode...');
  mainLoop();
}

startWorker();
