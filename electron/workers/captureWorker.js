import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import { appendFile } from 'fs/promises';
import path from 'path';
import X11RegionCapture from 'x11-region-capture-native';

// --- Worker Configuration ---
const { enableMemoryLogging = false, sharedData } = workerData;

// --- Memory Usage Logging (Conditional) ---
const LOG_INTERVAL_MS = 30000; // 10 seconds
const LOG_FILE_NAME = 'capture-worker-memory-usage.log';
const LOG_FILE_PATH = path.join(process.cwd(), LOG_FILE_NAME);
let lastLogTime = 0;

const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

async function logMemoryUsage() {
  try {
    const memoryUsage = process.memoryUsage();
    const timestamp = new Date().toISOString();
    const logEntry =
      `${timestamp} | ` +
      `RSS: ${toMB(memoryUsage.rss)} MB, ` +
      `HeapTotal: ${toMB(memoryUsage.heapTotal)} MB, ` +
      `HeapUsed: ${toMB(memoryUsage.heapUsed)} MB, ` +
      `External: ${toMB(memoryUsage.external)} MB\n`;

    await appendFile(LOG_FILE_PATH, logEntry);
  } catch (error) {
    console.error('[MemoryLogger] Failed to write to memory log file:', error);
  }
}
// --- End of Memory Usage Logging ---

// --- Shared Buffer Setup ---
if (!sharedData) throw new Error('[CaptureWorker] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const FRAME_COUNTER_INDEX = 0;
const WIDTH_INDEX = 1;
const HEIGHT_INDEX = 2;
const IS_RUNNING_INDEX = 3;
const WINDOW_ID_INDEX = 4;

const captureInstance = X11RegionCapture ? new X11RegionCapture.X11RegionCapture() : null;
let targetFps = 10;
let isCapturing = false;

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureLoop() {
  if (!captureInstance) {
    console.error('[CaptureWorker] X11 module not available.');
    Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
    return;
  }

  const windowId = Atomics.load(syncArray, WINDOW_ID_INDEX);
  if (!windowId) {
    console.error('[CaptureWorker] No Window ID provided.');
    Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
    return;
  }

  try {
    captureInstance.startMonitorInstance(windowId, targetFps);
    isCapturing = true;
    console.log(`[CaptureWorker] Started monitoring window: ${windowId}`);
  } catch (err) {
    console.error('[CaptureWorker] Failed to start capture instance:', err);
    Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
    return;
  }

  const sharedBufferView = Buffer.from(imageSAB);
  Atomics.store(syncArray, IS_RUNNING_INDEX, 1);

  while (Atomics.load(syncArray, IS_RUNNING_INDEX) === 1) {
    const loopStartTime = performance.now();

    // --- Integrated Memory Logging Check ---
    if (enableMemoryLogging && loopStartTime - lastLogTime > LOG_INTERVAL_MS) {
      await logMemoryUsage();
      lastLogTime = loopStartTime;
    }
    // --- End of Integrated Memory Logging Check ---

    try {
      const frameResult = captureInstance.getLatestFrame(sharedBufferView);

      if (frameResult?.success) {
        Atomics.store(syncArray, WIDTH_INDEX, frameResult.width);
        Atomics.store(syncArray, HEIGHT_INDEX, frameResult.height);
        Atomics.add(syncArray, FRAME_COUNTER_INDEX, 1);
        Atomics.notify(syncArray, FRAME_COUNTER_INDEX);
      }
    } catch (err) {
      console.error('[CaptureWorker] Error in capture loop:', err);
      Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
      Atomics.notify(syncArray, IS_RUNNING_INDEX);
      break;
    }

    const loopDuration = performance.now() - loopStartTime;
    const delayTime = Math.max(0, 1000 / targetFps - loopDuration);
    await delay(delayTime);
  }

  if (isCapturing) {
    captureInstance.stopMonitorInstance();
    console.log('[CaptureWorker] Stopped capture instance.');
  }
}

parentPort.on('message', (message) => {
  if (message.command === 'stop') {
    Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
  }
});

async function start() {
  // --- Initialize Logger if Enabled ---
  if (enableMemoryLogging) {
    try {
      const header = `\n--- New Session Started at ${new Date().toISOString()} ---\n`;
      await appendFile(LOG_FILE_PATH, header);
      console.log(`[MemoryLogger] Memory usage logging is active for CaptureWorker. Outputting to ${LOG_FILE_PATH}`);
      lastLogTime = performance.now();
      await logMemoryUsage();
    } catch (error) {
      console.error('[MemoryLogger] Could not initialize memory log file:', error);
    }
  }
  // --- End of Logger Initialization ---

  // Start the main capture loop
  await captureLoop();
}

start().catch((err) => {
  console.error('[CaptureWorker] Fatal error:', err);
  Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
  Atomics.notify(syncArray, IS_RUNNING_INDEX);
});
