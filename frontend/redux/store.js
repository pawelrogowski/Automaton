import { configureStore } from '@reduxjs/toolkit';
import globalSlice from './slices/globalSlice.js';
import ruleSlice from './slices/ruleSlice.js';
import gameStateSlice from './slices/gameStateSlice.js';
import luaSlice from './slices/luaSlice.js';
import cavebotSlice from './slices/cavebotSlice.js';
import targetingSlice from './slices/targetingSlice.js';
import statusMessagesSlice from './slices/statusMessagesSlice.js';
import regionCoordinatesSlice from './slices/regionCoordinatesSlice.js';
import ocrSlice from './slices/ocrSlice.js';
import uiValuesSlice from './slices/uiValuesSlice.js';
import battleListSlice from './slices/battleListSlice.js';
import pathfinderSlice from './slices/pathfinderSlice.js';

let actionBatch = [];
let batchTimeout = null;
const BATCH_DELAY = 50; // milliseconds

const ipcMiddleware = () => (next) => (action) => {
  // If the action comes from the backend, let it pass through to the reducer.
  if (action.origin === 'backend') {
    return next(action);
  }

  const actionWithOrigin = { ...action, origin: 'renderer' };
  actionBatch.push(actionWithOrigin);

  if (batchTimeout) {
    clearTimeout(batchTimeout);
  }

  batchTimeout = setTimeout(() => {
    // Coalesce redundant actions: keep only the last action per type; preserve additive types
    const ACCUMULATIVE_TYPES = new Set([
      'lua/addLogEntry',
      'cavebot/addVisitedTile',
    ]);

    const latestByType = new Map();
    const coalesced = [];
    for (const a of actionBatch) {
      if (ACCUMULATIVE_TYPES.has(a.type)) coalesced.push(a);
      else latestByType.set(a.type, a);
    }
    for (const a of latestByType.values()) coalesced.push(a);

    window.electron.ipcRenderer.send('state-change-batch', coalesced);
    actionBatch = []; // Clear the batch after sending
    batchTimeout = null;
  }, BATCH_DELAY);

  // By not calling next(action), we prevent the action from being processed
  // in the renderer store immediately. The renderer will only update when
  // the state comes back from the main process.
  return;
};

const store = configureStore({
  reducer: {
    global: globalSlice.reducer,
    gameState: gameStateSlice.reducer,
    rules: ruleSlice.reducer,
    lua: luaSlice.reducer,
    cavebot: cavebotSlice.reducer,
    targeting: targetingSlice.reducer,
    statusMessages: statusMessagesSlice.reducer,
    regionCoordinates: regionCoordinatesSlice.reducer,
    ocr: ocrSlice.reducer,
    uiValues: uiValuesSlice.reducer,
    battleList: battleListSlice.reducer,
    pathfinder: pathfinderSlice.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      immutableCheck: false,
      serializableCheck: false,
    }).concat(ipcMiddleware),
});

export default store;
