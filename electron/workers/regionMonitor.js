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
const PARTIAL_SCAN_MARGIN_PX = 24; // expand union of dirty rects to better capture anchors

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
let lastFullScanTime = 0;
const frameUpdateManager = new FrameUpdateManager();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Geometry utils
function rectsIntersect(a, b) {
  if (!a || !b) return false;
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false;
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function unionRect(rects, margin = 0) {
  if (!rects || rects.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    if (!r) continue;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (!isFinite(minX)) return null;
  return {
    x: Math.max(0, Math.floor(minX - margin)),
    y: Math.max(0, Math.floor(minY - margin)),
    width: Math.max(0, Math.ceil(maxX - minX + margin * 2)),
    height: Math.max(0, Math.ceil(maxY - minY + margin * 2)),
  };
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
}

function flattenRegionsWithPaths(regions, basePath = '', out = new Map()) {
  if (!regions || typeof regions !== 'object') return out;
  for (const [key, val] of Object.entries(regions)) {
    if (!val || typeof val !== 'object') continue;
    if ('x' in val && 'y' in val && 'width' in val && 'height' in val) {
      const path = basePath ? `${basePath}.${key}` : key;
      out.set(path, val);
      if (val.children) {
        flattenRegionsWithPaths(val.children, path, out);
      }
    }
  }
  return out;
}

function deleteByPath(obj, path) {
  const parts = path.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!node[p]) return;
    node = node[p].children ? node[p] : node[p];
    if (!node) return;
    if (i < parts.length - 2) {
      if (!node.children) return; // path invalid
      node = node.children;
    }
  }
  const leaf = parts[parts.length - 1];
  if (node.children && node.children[leaf]) {
    delete node.children[leaf];
  } else if (node[leaf]) {
    delete node[leaf];
  }
}

function setByPath(obj, path, value) {
  const parts = path.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!node[p]) node[p] = { children: {} };
    if (!node[p].children) node[p].children = {};
    node = node[p].children;
  }
  const leaf = parts[parts.length - 1];
  node[leaf] = value;
}

// Helper function to remove unnecessary raw position data before sending to store
function sanitizeRegionsForStore(regions) {
  if (!regions || typeof regions !== 'object') {
    return regions;
  }

  const newRegions = { ...regions };

  // Remove raw position properties from the current level
  delete newRegions.rawPos;
  delete newRegions.rawStartPos;
  delete newRegions.rawEndPos;

  // Recursively sanitize children
  for (const key in newRegions) {
    if (
      Object.prototype.hasOwnProperty.call(newRegions, key) &&
      newRegions[key] &&
      typeof newRegions[key] === 'object'
    ) {
      newRegions[key] = sanitizeRegionsForStore(newRegions[key]);
    }
  }

  return newRegions;
}

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

async function performPartialScan(buffer, metadata, area) {
  const foundRegions = {};
  // Limit search to dirty-union area, but keep baseOffset at (0,0) so absolute positions remain correct
  await findRegionsRecursive(
    buffer,
    regionDefinitions,
    area,
    { x: 0, y: 0 },
    foundRegions,
    metadata,
  );
  await processSpecialRegions(buffer, foundRegions, metadata);
  return foundRegions;
}

function mergePartialIntoLast(lastRegions, partialRegions, affectedArea) {
  const merged = deepClone(lastRegions);
  const lastFlat = flattenRegionsWithPaths(merged);
  const partialFlat = flattenRegionsWithPaths(partialRegions);

  // Remove any last-known regions that intersect affectedArea but were not rediscovered
  for (const [path, rect] of lastFlat.entries()) {
    if (rectsIntersect(rect, affectedArea) && !partialFlat.has(path)) {
      deleteByPath(merged, path);
    }
  }

  // Overlay partial results
  for (const [path, val] of partialFlat.entries()) {
    setByPath(merged, path, val);
  }
  return merged;
}

async function mainLoop() {
  while (!isShuttingDown) {
    try {
      if (isScanning) {
        await delay(MIN_LOOP_DELAY_MS);
        continue;
      }

      // Collect and clear dirty rects
      const dirtyRects = [...frameUpdateManager.accumulatedDirtyRects];
      frameUpdateManager.accumulatedDirtyRects.length = 0;

      const width = Atomics.load(syncArray, WIDTH_INDEX);
      const height = Atomics.load(syncArray, HEIGHT_INDEX);
      const dimensionsChanged = width !== lastWidth || height !== lastHeight;

      if (dirtyRects.length === 0 && !dimensionsChanged && Date.now() - lastFullScanTime < FULL_SCAN_INTERVAL_MS) {
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

        const now = Date.now();
        let updatedRegions;

        if (dimensionsChanged || now - lastFullScanTime >= FULL_SCAN_INTERVAL_MS || Object.keys(lastKnownRegions).length === 0) {
          // Full scan path
          const newRegions = await performFullScan(sharedBufferView, metadata);
          lastWidth = width;
          lastHeight = height;
          lastKnownRegions = newRegions;
          lastFullScanTime = now;
          updatedRegions = newRegions;
        } else if (dirtyRects.length > 0) {
          // Partial scan path
          const area = unionRect(dirtyRects, PARTIAL_SCAN_MARGIN_PX);
          if (area && area.width > 0 && area.height > 0) {
            const partial = await performPartialScan(sharedBufferView, metadata, area);
            lastKnownRegions = mergePartialIntoLast(lastKnownRegions, partial, area);
            updatedRegions = lastKnownRegions;
          } else {
            updatedRegions = lastKnownRegions;
          }
        } else {
          updatedRegions = lastKnownRegions;
        }

        // Sanitize the regions object to remove unnecessary data before posting
        const sanitizedRegions = sanitizeRegionsForStore(updatedRegions);

        parentPort.postMessage({
          storeUpdate: true,
          type: setAllRegions.type,
          payload: sanitizedRegions,
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
