// /home/feiron/Dokumenty/Automaton/electron/workers/ocr/core.js
// --- REFACTORED ---

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import * as config from './config.js';
import { rectsIntersect, processOcrRegions } from './processing.js';

// --- Worker Configuration & Setup ---
const { sharedData } = workerData;
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const sharedBufferView = Buffer.from(imageSAB);

// --- State ---
let currentState = null;
let isShuttingDown = false;
let isInitialized = false;
let lastProcessedFrameCounter = -1;
let lastBattleListProcessTime = 0;
let lastRegionHash = null;
let oneTimeInitializedRegions = new Set();
const pendingThrottledRegions = new Map();

// Fast checksum gating for OCR regions
const lastRegionChecksums = new Map(); // regionKey -> number
const lastRegionProcessTimes = new Map(); // regionKey -> ms timestamp
const CHECKSUM_GRID = 4; // 4x4 sampling grid
const CHECKSUM_FALLBACK_MS = 1000; // always process at least once per second to catch disappearances

function computeRegionChecksum(buffer, screenWidth, region) {
  if (!region || region.width <= 0 || region.height <= 0) return 0;
  const stepX = Math.max(1, Math.floor(region.width / (CHECKSUM_GRID + 1)));
  const stepY = Math.max(1, Math.floor(region.height / (CHECKSUM_GRID + 1)));
  let sum = 0 >>> 0;
  for (let gy = 1; gy <= CHECKSUM_GRID; gy++) {
    const y = region.y + gy * stepY;
    if (y < 0) continue;
    for (let gx = 1; gx <= CHECKSUM_GRID; gx++) {
      const x = region.x + gx * stepX;
      if (x < 0) continue;
      const idx = ((y * screenWidth + x) * 4) >>> 0; // BGRA
      const b = buffer[idx] || 0;
      const g = buffer[idx + 1] || 0;
      const r = buffer[idx + 2] || 0;
      // Mix in position to reduce collisions when regions slide
      sum =
        (sum +
          r +
          (g << 1) +
          (b << 2) +
          ((x & 0xff) << 3) +
          ((y & 0xff) << 4)) >>>
        0;
    }
  }
  // Mix in region dimensions
  sum = (sum + ((region.width & 0xffff) << 8) + (region.height & 0xffff)) >>> 0;
  return sum >>> 0;
}

// Region snapshot management
let regionsStale = false;
let lastRequestedRegionsVersion = -1;
// Track online state to detect relog
let wasOnline = false;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to get nested region by path (e.g., "preyModal.children.balance")
function getNestedRegion(regions, path) {
  const parts = path.split('.');
  let current = regions;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return null;
    current = current[part];
  }
  return current;
}

function hashRegionCoordinates(regionCoordinates) {
  if (!regionCoordinates || typeof regionCoordinates !== 'object') {
    return JSON.stringify(regionCoordinates);
  }
  const replacer = (key, value) =>
    value instanceof Object && !(value instanceof Array)
      ? Object.keys(value)
          .sort()
          .reduce((sorted, key) => {
            sorted[key] = value[key];
            return sorted;
          }, {})
      : value;
  return JSON.stringify(regionCoordinates, replacer);
}

async function processPendingRegions() {
  if (pendingThrottledRegions.size === 0) return;
  const now = Date.now();
  const regionsToProcessNow = new Set();
  for (const [regionKey, startTime] of pendingThrottledRegions.entries()) {
    const regionConfig = config.OCR_REGION_CONFIGS[regionKey];
    if (now - startTime >= (regionConfig.throttleMs || 0)) {
      regionsToProcessNow.add(regionKey);
    }
  }
  if (regionsToProcessNow.size > 0) {
    await processOcrRegions(
      sharedBufferView,
      currentState.regionCoordinates.regions,
      regionsToProcessNow,
    );
    // Update checksums and last processed times for throttled regions we just processed
    const screenWidth = Atomics.load(syncArray, config.WIDTH_INDEX);
    for (const regionKey of regionsToProcessNow) {
      const region = getNestedRegion(currentState.regionCoordinates.regions, regionKey);
      if (region) {
        const ck = computeRegionChecksum(sharedBufferView, screenWidth, region);
        lastRegionChecksums.set(regionKey, ck);
        lastRegionProcessTimes.set(regionKey, Date.now());
      }
      pendingThrottledRegions.delete(regionKey);
    }
  }
}

async function performOperation() {
  try {
    if (!isInitialized || !currentState || !currentState.regionCoordinates)
      return;

    const newFrameCounter = Atomics.load(syncArray, config.FRAME_COUNTER_INDEX);
    if (
      newFrameCounter <= lastProcessedFrameCounter ||
      Atomics.load(syncArray, config.IS_RUNNING_INDEX) !== 1
    ) {
      return;
    }

    const width = Atomics.load(syncArray, config.WIDTH_INDEX);
    const height = Atomics.load(syncArray, config.HEIGHT_INDEX);

    // Ensure we have regions or request snapshot; continue with cached regions if stale
    const rc = currentState.regionCoordinates;
    const regions = rc?.regions;
    const version = rc?.version;
    if (!regions) {
      if (version !== lastRequestedRegionsVersion) {
        parentPort.postMessage({ type: 'request_regions_snapshot' });
        lastRequestedRegionsVersion = version ?? -1;
      }
      return;
    }
    if (
      regionsStale &&
      typeof version === 'number' &&
      version !== lastRequestedRegionsVersion
    ) {
      parentPort.postMessage({ type: 'request_regions_snapshot' });
      lastRequestedRegionsVersion = version;
    }

    if (Object.keys(regions).length === 0 || width <= 0 || height <= 0) return;

    // Detect online state transition (relog) - reset scan flags
    const isOnline = !!regions.onlineMarker;
    if (isOnline && !wasOnline) {
      // Just logged in - force fresh OCR of all regions
      console.log('[OcrCore] Player logged in, resetting scan state for fresh OCR');
      oneTimeInitializedRegions.clear();
      lastRegionChecksums.clear();
      lastRegionProcessTimes.clear();
      pendingThrottledRegions.clear();
    }
    wasOnline = isOnline;

    lastProcessedFrameCounter = newFrameCounter;

    const dirtyRegionCount = Atomics.load(
      syncArray,
      config.DIRTY_REGION_COUNT_INDEX,
    );
    const dirtyRects = [];
    const now = Date.now();
    for (let i = 0; i < dirtyRegionCount; i++) {
      const offset = config.DIRTY_REGIONS_START_INDEX + i * 4;
      dirtyRects.push({
        x: Atomics.load(syncArray, offset + 0),
        y: Atomics.load(syncArray, offset + 1),
        width: Atomics.load(syncArray, offset + 2),
        height: Atomics.load(syncArray, offset + 3),
      });
    }

    const processingTasks = [];
    const immediateGenericRegions = new Set();

    // --- MODIFIED LOGIC ---

    // 2. Handle all other generic OCR regions.
    for (const regionKey of Object.keys(config.OCR_REGION_CONFIGS)) {
      if (regionKey === 'gameWorld') continue;
      const region = getNestedRegion(regions, regionKey);
      if (!region) {
        continue;
      }

      const isDirty = dirtyRects.some((dirtyRect) =>
        rectsIntersect(region, dirtyRect),
      );
      const needsOneTimeInit = !oneTimeInitializedRegions.has(regionKey);

      // Process region if dirty OR if we need one-time init (first frame)
      if (isDirty || needsOneTimeInit) {
        const regionConfig = config.OCR_REGION_CONFIGS[regionKey];

        // Fast checksum gating: skip OCR if region checksum unchanged and fallback window not exceeded
        // BUT always process on first frame (needsOneTimeInit)
        const screenWidth = Atomics.load(syncArray, config.WIDTH_INDEX);
        const ck = computeRegionChecksum(sharedBufferView, screenWidth, region);
        const lastCk = lastRegionChecksums.get(regionKey);
        const lastTs = lastRegionProcessTimes.get(regionKey) || 0;
        const withinFallback =
          now - lastTs < (regionConfig.throttleMs || CHECKSUM_FALLBACK_MS);
        const unchanged = lastCk !== undefined && ck === lastCk;

        // Skip only if: NOT first frame AND checksum unchanged AND within fallback window
        if (!needsOneTimeInit && unchanged && withinFallback) {
          // Skip scheduling OCR for this region this cycle
          continue;
        }

        if (regionConfig.throttleMs && !needsOneTimeInit) {
          if (!pendingThrottledRegions.has(regionKey)) {
            pendingThrottledRegions.set(regionKey, now);
          }
        } else {
          immediateGenericRegions.add(regionKey);
          if (needsOneTimeInit) {
            oneTimeInitializedRegions.add(regionKey);
          }
        }
      }
    }

    if (immediateGenericRegions.size > 0) {
      processingTasks.push(
        (async () => {
          await processOcrRegions(
            sharedBufferView,
            regions,
            immediateGenericRegions,
          );
          // Update checksums and last processed times for the regions we just OCR'd
          const screenWidth = Atomics.load(syncArray, config.WIDTH_INDEX);
          for (const regionKey of immediateGenericRegions) {
            const region = getNestedRegion(regions, regionKey);
            if (!region) continue;
            const ck = computeRegionChecksum(
              sharedBufferView,
              screenWidth,
              region,
            );
            lastRegionChecksums.set(regionKey, ck);
            lastRegionProcessTimes.set(regionKey, now);
          }
        })(),
      );
    }
    // --- END MODIFICATION ---

    if (processingTasks.length > 0) {
      await Promise.all(processingTasks);
    }
  } catch (error) {
    console.error('[OcrCore] Error in operation:', error);
  }
}

async function mainLoop() {
  console.log('[OcrCore] Starting main loop...');
  while (!isShuttingDown) {
    const loopStart = performance.now();
    if (isInitialized) {
      await performOperation();
      await processPendingRegions();
    }
    const elapsedTime = performance.now() - loopStart;
    const delayTime = Math.max(0, config.MAIN_LOOP_INTERVAL - elapsedTime);
    if (delayTime > 0) await delay(delayTime);
  }
  console.log('[OcrCore] Main loop stopped.');
}

function handleMessage(message) {
  try {
    if (message.type === 'window_changed') {
      // Window has changed - reset initial scan flags to force full OCR on first frame
      console.log('[OcrCore] Window changed, resetting initial scan state');
      oneTimeInitializedRegions.clear();
      lastRegionChecksums.clear();
      lastRegionProcessTimes.clear();
      pendingThrottledRegions.clear();
      lastProcessedFrameCounter = -1;
      return;
    } else if (message.type === 'state_diff') {
      if (!currentState) currentState = {};
      const payload = message.payload || {};
      if (payload.regionCoordinates) {
        const rc = payload.regionCoordinates;
        if (typeof rc.version === 'number' && !rc.regions) {
          // version-only diff: mark stale, keep cached regions
          if (!currentState.regionCoordinates)
            currentState.regionCoordinates = {};
          if (currentState.regionCoordinates.version !== rc.version) {
            currentState.regionCoordinates.version = rc.version;
            regionsStale = true;
          }
          // do not include in hashing to avoid false invalidation
          delete payload.regionCoordinates;
        } else {
          const newHash = hashRegionCoordinates(rc);
          if (newHash !== lastRegionHash) {
            lastRegionHash = newHash;
            oneTimeInitializedRegions.clear();
          }
        }
      }
      Object.assign(currentState, payload);
    } else if (message.type === 'regions_snapshot') {
      currentState = currentState || {};
      currentState.regionCoordinates = message.payload;
      regionsStale = false;
      // Reset one-time init set due to region structure change
      lastRegionHash = hashRegionCoordinates(message.payload);
      oneTimeInitializedRegions.clear();
    } else if (message.type === 'shutdown') {
      isShuttingDown = true;
    } else if (typeof message === 'object' && !message.type) {
      currentState = message;
      lastRegionHash = hashRegionCoordinates(message.regionCoordinates || {});
      oneTimeInitializedRegions.clear();
      if (!isInitialized) {
        isInitialized = true;
        console.log('[OcrCore] Initial state received. Worker is now active.');
      }
    }
  } catch (error) {
    console.error('[OcrCore] Error handling message:', error);
  }
}

export async function start() {
  console.log('[OcrCore] Worker starting up...');
  if (!workerData?.sharedData) {
    throw new Error('[OcrCore] Shared data not provided');
  }
  parentPort.on('message', handleMessage);
  mainLoop().catch((error) => {
    console.error('[OcrCore] Fatal error in main loop:', error);
    process.exit(1);
  });
}
