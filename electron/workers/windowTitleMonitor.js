import { parentPort, workerData } from 'worker_threads';
import windowinfo from 'windowinfo-native';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ info: false, debug: false });
log('info', '[WindowTitleMonitor] Worker file loaded.');

const POLLING_INTERVAL = 100;
const INITIAL_CHECK_DELAY_MS = 2500; // A one-time delay for the very first check.

let intervalId = null;
let isInitialized = false;
let isShuttingDown = false;
let currentState = null; // This worker's local copy of the Redux state.
let lastKnownLiveName = null; // An internal tracker to prevent spamming updates.

const CHARACTER_NAME_REGEX = /Tibia - (.+)/;
const getCharacterNameFromTitle = (title) => {
  const match = title.match(CHARACTER_NAME_REGEX);
  return match ? match[1] : null;
};

const reusableUpdate = {
  storeUpdate: true,
  type: 'gameState/updateCharacterNames',
  payload: {},
};

const monitorWindowTitle = async () => {
  if (!isInitialized || !currentState || isShuttingDown) {
    return;
  }

  const { windowId, display } = currentState.global;
  if (!windowId || !display) {
    return;
  }

  try {
    const windowInfo = await windowinfo.getAllInfo({ windowId, display });
    const liveCharacterName = windowInfo?.name
      ? getCharacterNameFromTitle(windowInfo.name)
      : null;

    // The core logic: We only act if the live name is different from the last live name we processed.
    if (liveCharacterName !== lastKnownLiveName) {
      log(
        'info',
        `[WindowTitleMonitor] Live name change detected: '${lastKnownLiveName || 'None'}' -> '${liveCharacterName || 'None'}'. Dispatching update.`,
      );

      const updatePayload = {
        characterName: liveCharacterName,
      };

      if (lastKnownLiveName) {
        updatePayload.lastCharacterName = lastKnownLiveName;
      }

      reusableUpdate.payload = updatePayload;
      parentPort.postMessage(reusableUpdate);

      // CRITICAL: Update our internal tracker immediately after sending.
      lastKnownLiveName = liveCharacterName;
    }

    if (!windowInfo) {
      stopMonitoring();
    }
  } catch (error) {
    log('error', '[WindowTitleMonitor] Critical error in monitor loop:', error);
    stopMonitoring();
    if (lastKnownLiveName !== null) {
      reusableUpdate.payload = {
        characterName: null,
        lastCharacterName: lastKnownLiveName,
      };
      parentPort.postMessage(reusableUpdate);
      lastKnownLiveName = null;
    }
  }
};

const startMonitoring = () => {
  if (intervalId) return;
  log(
    'info',
    `[WindowTitleMonitor] Scheduling first check in ${INITIAL_CHECK_DELAY_MS}ms.`,
  );

  // --- THIS IS THE FIX ---
  // We wait a moment before the first check to ensure the OS has registered the window title.
  setTimeout(() => {
    if (isShuttingDown) return;

    log('info', '[WindowTitleMonitor] Starting relentless polling loop.');
    // Run the check once immediately after the delay.
    monitorWindowTitle();
    // Then, start the regular interval for all subsequent checks.
    intervalId = setInterval(monitorWindowTitle, POLLING_INTERVAL);
  }, INITIAL_CHECK_DELAY_MS);
};

const stopMonitoring = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    log('info', '[WindowTitleMonitor] Stopped polling loop.');
  }
};

parentPort.on('message', (message) => {
  try {
    if (message.type === 'shutdown') {
      isShuttingDown = true;
      log('info', '[WindowTitleMonitor] Received shutdown signal.');
      stopMonitoring();
      parentPort.close();
      return;
    }

    if (message.type === 'state_diff') {
      if (!currentState) currentState = {};
      Object.assign(currentState, message.payload);
    } else if (typeof message === 'object' && !message.type) {
      currentState = message;
      if (!isInitialized) {
        isInitialized = true;
        log(
          'info',
          '[WindowTitleMonitor] Received initial state. Starting monitor...',
        );
        // Initialize our tracker with the official state from the store, just once.
        lastKnownLiveName = currentState.gameState.characterName;
        startMonitoring();
      }
    }
  } catch (error) {
    log('error', '[WindowTitleMonitor] Error handling message:', error);
  }
});

log(
  'info',
  '[WindowTitleMonitor] Worker initialized and awaiting initial state.',
);
