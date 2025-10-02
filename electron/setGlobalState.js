import store from './store.js';
import { getMainWindow, getWidgetWindow } from './createMainWindow.js';

// A blacklist of action types that should NOT be forwarded to the renderer process.
// This is for state that is only relevant to the main process and workers.
const RENDERER_BLACKLIST = new Set(['regionCoordinates/setAllRegions']);

let actionQueue = [];
let isScheduled = false;

function sendBatch() {
  if (actionQueue.length === 0) {
    isScheduled = false;
    return;
  }

  const mainWindow = getMainWindow();
  const widgetWindow = getWidgetWindow();
  // Coalesce redundant actions: keep only the last action per type; preserve additive types
  const ACCUMULATIVE_TYPES = new Set([
    'lua/addLogEntry',
    'cavebot/addVisitedTile',
  ]);
  const latestByType = new Map();
  const coalesced = [];
  for (const a of actionQueue) {
    if (ACCUMULATIVE_TYPES.has(a.type)) coalesced.push(a);
    else latestByType.set(a.type, a);
  }
  for (const a of latestByType.values()) coalesced.push(a);
  actionQueue = [];

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state-update-batch', coalesced);
  }
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send('state-update-batch', coalesced);
  }

  isScheduled = false;
}

function scheduleBatch() {
  if (!isScheduled) {
    isScheduled = true;
    // Throttle renderer update batching to ~60fps to reduce IPC/paint thrash.
    setTimeout(sendBatch, 16);
  }
}

/**
 * A centralized function to update the main process Redux store
 * and broadcast the change to the renderer process.
 * @param {string} type - The action type (e.g., 'cavebot/setEnabled').
 * @param {*} payload - The action payload.
 */
function setGlobalState(type, payload) {
  const action = {
    type,
    payload,
    origin: 'backend',
  };

  // 1. Dispatch the action to the main process store immediately.
  store.dispatch(action);

  // 2. Queue the action to be sent to the renderer in a batch, unless it's blacklisted.
  if (!RENDERER_BLACKLIST.has(type)) {
    actionQueue.push(action);
    scheduleBatch();
  }
}

export default setGlobalState;
