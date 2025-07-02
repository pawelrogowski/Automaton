import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import X11RegionCapture from 'x11-region-capture-native';

const { sharedData } = workerData;
const { imageSAB, syncSAB } = sharedData;

// Create a typed array view for atomic operations on the sync buffer
const syncArray = new Int32Array(syncSAB);
const FRAME_COUNTER_INDEX = 0;
const WIDTH_INDEX = 1;
const HEIGHT_INDEX = 2;
const IS_RUNNING_INDEX = 3;
const WINDOW_ID_INDEX = 4; // We can even pass the window ID this way

const captureInstance = X11RegionCapture ? new X11RegionCapture.X11RegionCapture() : null;
let targetFps = 32;
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

  // Create a Buffer view of the SharedArrayBuffer. We write directly into it.
  const sharedBufferView = Buffer.from(imageSAB);
  Atomics.store(syncArray, IS_RUNNING_INDEX, 1);

  while (Atomics.load(syncArray, IS_RUNNING_INDEX) === 1) {
    const loopStartTime = performance.now();
    try {
      // getLatestFrame will copy data directly into our shared buffer view
      const frameResult = captureInstance.getLatestFrame(sharedBufferView);

      if (frameResult?.success) {
        // Update metadata in the sync array
        Atomics.store(syncArray, WIDTH_INDEX, frameResult.width);
        Atomics.store(syncArray, HEIGHT_INDEX, frameResult.height);

        // Increment the frame counter. This is the signal that a new frame is ready.
        Atomics.add(syncArray, FRAME_COUNTER_INDEX, 1);

        // Notify all waiting workers that the counter has changed.
        Atomics.notify(syncArray, FRAME_COUNTER_INDEX);
      }
    } catch (err) {
      console.error('[CaptureWorker] Error in capture loop:', err);
      Atomics.store(syncArray, IS_RUNNING_INDEX, 0); // Signal stop
      Atomics.notify(syncArray, IS_RUNNING_INDEX); // Notify consumers about the stop
      break;
    }

    const loopDuration = performance.now() - loopStartTime;
    const delayTime = Math.max(0, 1000 / targetFps - loopDuration);
    await delay(delayTime);
  }

  // Cleanup
  if (isCapturing) {
    captureInstance.stopMonitorInstance();
    console.log('[CaptureWorker] Stopped capture instance.');
  }
}

parentPort.on('message', (message) => {
  if (message.command === 'stop') {
    Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
  }
  // You can add logic to update FPS, etc.
});

// Start the loop
captureLoop().catch((err) => {
  console.error('[CaptureWorker] Fatal error:', err);
  Atomics.store(syncArray, IS_RUNNING_INDEX, 0);
  Atomics.notify(syncArray, IS_RUNNING_INDEX);
});
