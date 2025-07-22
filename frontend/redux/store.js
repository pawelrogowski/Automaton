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

const ipcMiddleware = () => (next) => (action) => {
  // If the action comes from the backend, let it pass through to the reducer.
  if (action.origin === 'backend') {
    return next(action);
  }

  const actionWithOrigin = { ...action, origin: 'renderer' };
  const serializedAction = JSON.stringify(actionWithOrigin);
  window.electron.ipcRenderer.send('state-change', serializedAction);
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
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(ipcMiddleware),
});

export default store;
