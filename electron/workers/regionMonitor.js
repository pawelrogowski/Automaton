// @regionMonitor.js

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import regionDefinitions from '../constants/regionDefinitions.js';
import { setAllRegions } from '../../frontend/redux/slices/regionCoordinatesSlice.js';
import findSequences from 'find-sequences-native';

// --- Worker Configuration & Setup ---
const { sharedData } = workerData;
const PARTIAL_SCAN_INTERVAL_MS = 50; // How often to check for dirty regions
const FULL_SCAN_INTERVAL_MS = 500; // How often to force a full rescan as a fallback
const PERFORMANCE_LOG_INTERVAL = 10000; // Log performance stats every 10 seconds

if (!sharedData) throw new Error('[RegionMonitor] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const sharedBufferView = Buffer.from(imageSAB);

// --- Correct SharedArrayBuffer Indices ---
const FRAME_COUNTER_INDEX = 0;
const WIDTH_INDEX = 1;
const HEIGHT_INDEX = 2;
const IS_RUNNING_INDEX = 3;
const WINDOW_ID_INDEX = 4;
const DIRTY_REGION_COUNT_INDEX = 5;
const DIRTY_REGIONS_START_INDEX = 6;

// --- State variables for the hybrid scan model ---
let lastProcessedFrameCounter = -1;
let lastKnownRegions = {};
let lastFullScanTime = 0;
let lastWidth = 0;
let lastHeight = 0;
let forceFullScan = false;
let currentState = null; // Store the latest state from WorkerManager
let isShuttingDown = false;

// --- Performance tracking ---
let scanCount = 0;
let fullScanCount = 0;
let partialScanCount = 0;
let totalScanTime = 0;
let lastPerfReport = Date.now();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Performance monitoring ---
function logPerformanceStats() {
  const now = Date.now();
  const timeSinceLastReport = now - lastPerfReport;

  if (timeSinceLastReport >= PERFORMANCE_LOG_INTERVAL) {
    const avgScanTime =
      scanCount > 0 ? (totalScanTime / scanCount).toFixed(2) : 0;
    const scansPerSecond = ((scanCount / timeSinceLastReport) * 1000).toFixed(
      1,
    );

    console.log(
      `[RegionMonitor] Performance: ${scansPerSecond} scans/sec, ` +
        `avg: ${avgScanTime}ms, full: ${fullScanCount}, partial: ${partialScanCount}`,
    );

    // Reset counters
    scanCount = 0;
    fullScanCount = 0;
    partialScanCount = 0;
    totalScanTime = 0;
    lastPerfReport = now;
  }
}

// --- Helper function to check if two rectangles intersect ---
function rectsIntersect(rectA, rectB) {
  if (
    !rectA ||
    !rectB ||
    rectA.width <= 0 ||
    rectA.height <= 0 ||
    rectB.width <= 0 ||
    rectB.height <= 0
  ) {
    return false;
  }
  return (
    rectA.x < rectB.x + rectB.width &&
    rectA.x + rectA.width > rectB.x &&
    rectA.y < rectB.y + rectB.height &&
    rectA.y + rectA.height > rectB.y
  );
}

// ========================================================================
// --- findRegionsRecursive (Optimized with early returns) ---
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

  // Early return if no definitions
  if (defEntries.length === 0) return;

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
// --- BattleList & TileSize Helpers (Optimized) ---
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

// --- Process special regions after a scan ---
async function processSpecialRegions(buffer, regions, metadata) {
  // Process dynamic content like the battle list if its container was found.
  if (regions.battleList?.children?.entries?.endFound) {
    const battleListTask = generateBattleListTasks(
      regions.battleList.children.entries,
    );
    if (battleListTask) {
      const batchTask = { battleListChecks: battleListTask };
      const results = await findSequences.findSequencesNativeBatch(
        buffer,
        batchTask,
      );
      processBattleListResults(
        results.battleListChecks,
        regions.battleList.children.entries,
      );
    }
  }

  // Calculate tile size if the game world was found.
  if (regions.gameWorld?.endFound) {
    const { gameWorld } = regions;
    regions.tileSize = {
      width: Math.round(gameWorld.width / 15),
      height: Math.round(gameWorld.height / 11),
    };
  }
}

// ========================================================================
// --- Scanning Functions (performFullScan & performPartialScan) ---
// ========================================================================
async function performFullScan(buffer, metadata) {
  const scanStart = performance.now();

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

  const scanEnd = performance.now();
  const scanTime = scanEnd - scanStart;

  // Update performance stats
  scanCount++;
  fullScanCount++;
  totalScanTime += scanTime;

  // Log slow scans
  if (scanTime > 100) {
    console.log(`[RegionMonitor] Slow full scan: ${scanTime.toFixed(2)}ms`);
  }

  return foundRegions;
}

async function performPartialScan(buffer, metadata, dirtyRects) {
  const scanStart = performance.now();

  const definitionsToRescan = new Set();
  for (const [name, regionData] of Object.entries(lastKnownRegions)) {
    for (const dirtyRect of dirtyRects) {
      if (rectsIntersect(regionData, dirtyRect)) {
        definitionsToRescan.add(name);
        break;
      }
    }
  }

  if (definitionsToRescan.size === 0) {
    return null; // Return null to indicate no changes
  }

  const subDefinitions = {};
  for (const name of definitionsToRescan) {
    if (regionDefinitions[name]) {
      subDefinitions[name] = regionDefinitions[name];
    }
  }

  const newlyFoundRegions = {};
  await findRegionsRecursive(
    buffer,
    subDefinitions,
    { x: 0, y: 0, width: metadata.width, height: metadata.height },
    { x: 0, y: 0 },
    newlyFoundRegions,
    metadata,
  );

  const finalRegions = { ...lastKnownRegions, ...newlyFoundRegions };
  await processSpecialRegions(buffer, finalRegions, metadata);

  const scanEnd = performance.now();
  const scanTime = scanEnd - scanStart;

  // Update performance stats
  scanCount++;
  partialScanCount++;
  totalScanTime += scanTime;

  // Log slow scans
  if (scanTime > 50) {
    console.log(
      `[RegionMonitor] Slow partial scan: ${scanTime.toFixed(2)}ms, regions: ${definitionsToRescan.size}`,
    );
  }

  return finalRegions;
}

// ========================================================================
// --- Main Loop (Optimized with better error handling) ---
// ========================================================================
async function mainLoop() {
  console.log('[RegionMonitor] Starting main loop with hybrid scanning...');

  while (!isShuttingDown) {
    const loopStartTime = performance.now();

    try {
      const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);

      if (newFrameCounter > lastProcessedFrameCounter) {
        lastProcessedFrameCounter = newFrameCounter;

        if (Atomics.load(syncArray, IS_RUNNING_INDEX) !== 1) {
          if (Object.keys(lastKnownRegions).length > 0) {
            console.log('[RegionMonitor] Capture stopped. Clearing regions.');
            lastKnownRegions = {};
            parentPort.postMessage({
              storeUpdate: true,
              type: setAllRegions.type,
              payload: {},
            });
          }
          await delay(PARTIAL_SCAN_INTERVAL_MS);
          continue;
        }

        const width = Atomics.load(syncArray, WIDTH_INDEX);
        const height = Atomics.load(syncArray, HEIGHT_INDEX);

        if (width <= 0 || height <= 0) {
          await delay(PARTIAL_SCAN_INTERVAL_MS);
          continue;
        }

        const metadata = { width, height, frameCounter: newFrameCounter };
        const now = performance.now();
        let newRegions = null;

        const needsFullScan =
          forceFullScan ||
          Object.keys(lastKnownRegions).length === 0 ||
          width !== lastWidth ||
          height !== lastHeight ||
          now - lastFullScanTime > FULL_SCAN_INTERVAL_MS;

        if (needsFullScan) {
          newRegions = await performFullScan(sharedBufferView, metadata);
          forceFullScan = false;
          lastFullScanTime = now;
          lastWidth = width;
          lastHeight = height;
        } else {
          const dirtyRegionCount = Atomics.load(
            syncArray,
            DIRTY_REGION_COUNT_INDEX,
          );
          if (dirtyRegionCount > 0) {
            const dirtyRects = [];
            for (let i = 0; i < dirtyRegionCount && i < 64; i++) {
              // Limit to max 64 regions
              const offset = DIRTY_REGIONS_START_INDEX + i * 4;
              const rect = {
                x: Atomics.load(syncArray, offset + 0),
                y: Atomics.load(syncArray, offset + 1),
                width: Atomics.load(syncArray, offset + 2),
                height: Atomics.load(syncArray, offset + 3),
              };

              // Validate rect before adding
              if (rect.width > 0 && rect.height > 0) {
                dirtyRects.push(rect);
              }
            }

            if (dirtyRects.length > 0) {
              newRegions = await performPartialScan(
                sharedBufferView,
                metadata,
                dirtyRects,
              );
            }
          }
        }

        if (newRegions) {
          lastKnownRegions = newRegions;
          parentPort.postMessage({
            storeUpdate: true,
            type: setAllRegions.type,
            payload: newRegions,
          });
        }
      }

      // Log performance stats periodically
      logPerformanceStats();
    } catch (err) {
      console.error('[RegionMonitor] Error in main loop:', err);
      // Reset state on error to force recovery
      lastKnownRegions = {};
      lastProcessedFrameCounter = -1;

      // Wait longer on error to avoid tight error loops
      await delay(Math.max(PARTIAL_SCAN_INTERVAL_MS * 2, 100));
      continue;
    }

    const loopEndTime = performance.now();
    const elapsedTime = loopEndTime - loopStartTime;
    const delayTime = Math.max(0, PARTIAL_SCAN_INTERVAL_MS - elapsedTime);

    if (delayTime > 0) {
      await delay(delayTime);
    }
  }

  console.log('[RegionMonitor] Main loop stopped.');
}

// ========================================================================
// --- Message Handler (Updated for new WorkerManager) ---
// ========================================================================
parentPort.on('message', (message) => {
  try {
    if (message.command === 'forceRegionSearch') {
      console.log(
        '[RegionMonitor] Received command to force a full region scan.',
      );
      forceFullScan = true;
    } else if (message.type === 'state_diff') {
      // Handle state updates from WorkerManager
      if (!currentState) {
        currentState = {};
      }

      // Apply state diff
      Object.assign(currentState, message.payload);

      // Handle specific state changes that affect region monitoring
      if (message.payload.global) {
        const globalState = message.payload.global;

        // If window changed, force a full scan
        if (
          globalState.windowId !== undefined &&
          currentState.global?.windowId !== globalState.windowId
        ) {
          console.log('[RegionMonitor] Window changed, forcing full scan.');
          forceFullScan = true;
        }
      }
    } else if (message.type === 'shutdown') {
      console.log('[RegionMonitor] Received shutdown command.');
      isShuttingDown = true;
    } else if (
      typeof message === 'object' &&
      !message.type &&
      !message.command
    ) {
      // Handle full state updates (initial state)
      currentState = message;
      console.log('[RegionMonitor] Received initial state update.');
    }
  } catch (err) {
    console.error('[RegionMonitor] Error handling message:', err);
  }
});

// ========================================================================
// --- Worker Startup ---
// ========================================================================
async function startWorker() {
  console.log('[RegionMonitor] Worker starting up in hybrid scan mode...');

  // Handle graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[RegionMonitor] Received SIGTERM, shutting down...');
    isShuttingDown = true;
  });

  process.on('SIGINT', () => {
    console.log('[RegionMonitor] Received SIGINT, shutting down...');
    isShuttingDown = true;
  });

  mainLoop().catch((err) => {
    console.error('[RegionMonitor] Fatal error in main loop:', err);
    process.exit(1);
  });
}

startWorker();
