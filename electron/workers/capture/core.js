// capture/core.js (Final Corrected Version)

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import X11RegionCapture from 'x11-region-capture-native';
import * as config from './config.js';
import { PerformanceTracker } from './performanceTracker.js';

// --- Worker State & Setup ---
const { sharedData, display } = workerData;
if (!sharedData) throw new Error('[CaptureCore] Shared data not provided.');

const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const imageBuffer = Buffer.from(imageSAB);

const captureInstance = X11RegionCapture
  ? new X11RegionCapture.X11RegionCapture(display)
  : null;
let isCapturing = false;

// --- Performance Tracking ---
const perfTracker = new PerformanceTracker();
let lastPerfReportTime = Date.now();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function logPerformanceReport() {
  // This function is disabled in the provided code, but left for completeness.
  // if (!config.PERFORMANCE_LOGGING_ENABLED) return;

  const now = Date.now();
  const PERFORMANCE_LOG_INTERVAL_MS = 5000; // Example value
  if (now - lastPerfReportTime >= PERFORMANCE_LOG_INTERVAL_MS) {
    console.log(perfTracker.getReport());
    perfTracker.reset();
    lastPerfReportTime = now;
  }
}

async function captureLoop() {
  if (!captureInstance) {
    console.error(
      '[CaptureCore] X11 native module is not available. Cannot start capture.',
    );
    Atomics.store(syncArray, config.IS_RUNNING_INDEX, 0);
    return;
  }

  const windowId = Atomics.load(syncArray, config.WINDOW_ID_INDEX);
  if (!windowId) {
    console.error('[CaptureCore] No Window ID provided. Cannot start capture.');
    Atomics.store(syncArray, config.IS_RUNNING_INDEX, 0);
    return;
  }

  try {
    captureInstance.startMonitorInstance(windowId, config.TARGET_FPS);
    isCapturing = true;
    console.log(
      `[CaptureCore] Started monitoring window: ${windowId} at ${config.TARGET_FPS} FPS.`,
    );
  } catch (err) {
    console.error(
      '[CaptureCore] Failed to start native capture instance:',
      err,
    );
    Atomics.store(syncArray, config.IS_RUNNING_INDEX, 0);
    return;
  }

  Atomics.store(syncArray, config.IS_RUNNING_INDEX, 1);

  while (Atomics.load(syncArray, config.IS_RUNNING_INDEX) === 1) {
    const loopStartTime = performance.now();

    try {
      const frameResult = captureInstance.getLatestFrame(imageBuffer);

      if (frameResult) {
        // --- START OF SYNCHRONIZED UPDATE ---
        // All data related to the new frame is written to the syncSAB first.
        // The frame counter is only updated at the very end.

        const regionsToWrite = frameResult.changedRegions
          ? Math.min(
              frameResult.changedRegions.length,
              config.MAX_DIRTY_REGIONS,
            )
          : 0;

        // 1. Write all metadata (dirty rects, width, height).
        Atomics.store(
          syncArray,
          config.DIRTY_REGION_COUNT_INDEX,
          regionsToWrite,
        );

        if (frameResult.changedRegions) {
          for (let i = 0; i < regionsToWrite; i++) {
            const rect = frameResult.changedRegions[i];
            const offset = config.DIRTY_REGIONS_START_INDEX + i * 4;
            Atomics.store(syncArray, offset + 0, rect.x);
            Atomics.store(syncArray, offset + 1, rect.y);
            Atomics.store(syncArray, offset + 2, rect.width);
            Atomics.store(syncArray, offset + 3, rect.height);
          }
        }

        Atomics.store(syncArray, config.WIDTH_INDEX, frameResult.width);
        Atomics.store(syncArray, config.HEIGHT_INDEX, frameResult.height);

        // Increment frame counter and notify readers
        const newFrameCounter = Atomics.add(
          syncArray,
          config.FRAME_COUNTER_INDEX,
          1,
        );
        Atomics.notify(syncArray, config.FRAME_COUNTER_INDEX);

        // --- END OF SYNCHRONIZED UPDATE ---

        // This message is sent after the commit, so it's safe.
        if (
          frameResult.changedRegions &&
          frameResult.changedRegions.length > 0
        ) {
          parentPort.postMessage({
            type: 'frame-update',
            payload: {
              frameCounter: newFrameCounter,
              dirtyRects: frameResult.changedRegions,
            },
          });
        }

        const loopDuration = performance.now() - loopStartTime;
        perfTracker.addFrameMeasurement(loopDuration, regionsToWrite);
      }
    } catch (err) {
      console.error('[CaptureCore] Error in capture loop, stopping:', err);
      Atomics.store(syncArray, config.IS_RUNNING_INDEX, 0);
      Atomics.notify(syncArray, config.IS_RUNNING_INDEX);
      break;
    }

    const loopDuration = performance.now() - loopStartTime;
    const delayTime = Math.max(0, 1000 / config.TARGET_FPS - loopDuration);
    await delay(delayTime);
  }

  if (isCapturing) {
    captureInstance.stopMonitorInstance();
    isCapturing = false;
    console.log('[CaptureCore] Stopped capture instance.');
  }
}

function handleMessage(message) {
  if (message.command === 'stop') {
    Atomics.store(syncArray, config.IS_RUNNING_INDEX, 0);
  }
}

export async function start() {
  console.log('[CaptureCore] Worker starting up...');
  parentPort.on('message', handleMessage);
  await captureLoop();
  console.log(
    '[CaptureCore] Worker has finished its capture loop and is shutting down.',
  );
}
