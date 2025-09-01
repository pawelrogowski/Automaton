import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import regionDefinitions from '../constants/regionDefinitions.js';
import { setAllRegions } from '../../frontend/redux/slices/regionCoordinatesSlice.js';
import findSequences from 'find-sequences-native';

// --- Worker Configuration & Setup ---
const { sharedData } = workerData;
const FULL_SCAN_INTERVAL_MS = 500;
const MIN_LOOP_DELAY_MS = 200;
const PERFORMANCE_LOG_INTERVAL = 10000;

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

// --- Performance tracking ---
let scanCount = 0;
let totalScanTime = 0;
let lastPerfReport = Date.now();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function logPerformanceStats() {
  const now = Date.now();
  if (now - lastPerfReport >= PERFORMANCE_LOG_INTERVAL) {
    const avgScanTime =
      scanCount > 0 ? (totalScanTime / scanCount).toFixed(2) : 0;
    const scansPerSecond = (
      (scanCount / (now - lastPerfReport)) *
      1000
    ).toFixed(1);
    console.log(
      `[RegionMonitor] Performance: ${scansPerSecond} scans/sec, avg: ${avgScanTime}ms`,
    );
    scanCount = 0;
    totalScanTime = 0;
    lastPerfReport = now;
  }
}

// --- Recursive Region Finding Logic (largely unchanged) ---
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

// --- BattleList & TileSize Helpers (unchanged) ---
const BATTLE_LIST_ENTRY_HEIGHT = 20;
const BATTLE_LIST_ENTRY_VERTICAL_PITCH = 22;
function generateBattleListTasks(entriesRegion) {
  const maxEntries = Math.floor(
    (entriesRegion.height +
      (BATTLE_LIST_ENTRY_VERTICAL_PITCH - BATTLE_LIST_ENTRY_HEIGHT)) /
      BATTLE_LIST_ENTRY_VERTICAL_PITCH,
  );
  if (maxEntries <= 0) return null;
  const pixelChecks = { '#FF0000': [], '#FF8080': [], '#000000': [] };
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
async function processSpecialRegions(buffer, regions, metadata) {
  if (regions.battleList?.children?.entries?.endFound) {
    const battleListTask = generateBattleListTasks(
      regions.battleList.children.entries,
    );
    if (battleListTask) {
      const results = await findSequences.findSequencesNativeBatch(buffer, {
        battleListChecks: battleListTask,
      });
      processBattleListResults(
        results.battleListChecks,
        regions.battleList.children.entries,
      );
    }
  }
  if (regions.gameWorld?.endFound) {
    const { gameWorld } = regions;
    regions.tileSize = {
      width: Math.round(gameWorld.width / 15),
      height: Math.round(gameWorld.height / 11),
    };
  }
}

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
  const scanTime = performance.now() - scanStart;
  scanCount++;
  totalScanTime += scanTime;
  if (scanTime > 100) {
    console.log(`[RegionMonitor] Slow full scan: ${scanTime.toFixed(2)}ms`);
  }
  return foundRegions;
}

async function mainLoop() {
  console.log('[RegionMonitor] Starting main loop...');
  while (!isShuttingDown) {
    const loopStartTime = performance.now();
    try {
      if (isScanning) {
        await delay(MIN_LOOP_DELAY_MS);
        continue;
      }

      const width = Atomics.load(syncArray, WIDTH_INDEX);
      const height = Atomics.load(syncArray, HEIGHT_INDEX);

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

      logPerformanceStats();
    } catch (err) {
      console.error('[RegionMonitor] Error in main loop:', err);
      lastKnownRegions = {};
    }

    const elapsedTime = performance.now() - loopStartTime;
    const delayTime = Math.max(0, FULL_SCAN_INTERVAL_MS - elapsedTime);
    if (delayTime > 0) {
      await delay(delayTime);
    }
  }
  console.log('[RegionMonitor] Main loop stopped.');
}

parentPort.on('message', (message) => {
  try {
    if (message.type === 'shutdown') {
      console.log('[RegionMonitor] Received shutdown command.');
      isShuttingDown = true;
    }
  } catch (err) {
    console.error('[RegionMonitor] Error handling message:', err);
  }
});

async function startWorker() {
  console.log('[RegionMonitor] Worker starting up...');
  mainLoop().catch((err) => {
    console.error('[RegionMonitor] Fatal error in main loop:', err);
    process.exit(1);
  });
}

startWorker();