import { configureStore, combineReducers } from '@reduxjs/toolkit';
import globalSlice from '../frontend/redux/slices/globalSlice.js';
import ruleSlice from '../frontend/redux/slices/ruleSlice.js';
import gameStateSlice from '../frontend/redux/slices/gameStateSlice.js';
import luaSlice from '../frontend/redux/slices/luaSlice.js';
import cavebotSlice from '../frontend/redux/slices/cavebotSlice.js';
import targetingSlice from '../frontend/redux/slices/targetingSlice.js';
import statusMessagesSlice from '../frontend/redux/slices/statusMessagesSlice.js';
import regionCoordinatesSlice from '../frontend/redux/slices/regionCoordinatesSlice.js';
import ocrSlice from '../frontend/redux/slices/ocrSlice.js';
import uiValuesSlice from '../frontend/redux/slices/uiValuesSlice.js';
import battleListSlice from '../frontend/redux/slices/battleListSlice.js';
import pathfinderSlice from '../frontend/redux/slices/pathfinderSlice.js';

const rootReducer = combineReducers({
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
});

const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware(),
});

export default store;
