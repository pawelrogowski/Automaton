import { configureStore, combineReducers } from '@reduxjs/toolkit';
import globalSlice from '../frontend/redux/slices/globalSlice.js';
import ruleSlice from '../frontend/redux/slices/ruleSlice.js';
import gameStateSlice from '../frontend/redux/slices/gameStateSlice.js';
import luaSlice from '../frontend/redux/slices/luaSlice.js';
import cavebotSlice from '../frontend/redux/slices/cavebotSlice.js';
import statusMessagesSlice from '../frontend/redux/slices/statusMessagesSlice.js';
import regionCoordinatesSlice from '../frontend/redux/slices/regionCoordinatesSlice.js';

const rootReducer = combineReducers({
  global: globalSlice.reducer,
  gameState: gameStateSlice.reducer,
  rules: ruleSlice.reducer,
  lua: luaSlice.reducer,
  cavebot: cavebotSlice.reducer,
  statusMessages: statusMessagesSlice.reducer,
  regionCoordinates: regionCoordinatesSlice.reducer,
});

const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware(),
});

export default store;
