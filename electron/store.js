import { configureStore, combineReducers } from '@reduxjs/toolkit';
import globalSlice from '../frontend/redux/slices/globalSlice.js';
import ruleSlice from '../frontend/redux/slices/ruleSlice.js';
import gameStateSlice from '../frontend/redux/slices/gameStateSlice.js';
import luaSlice from '../frontend/redux/slices/luaSlice.js';

const rootReducer = combineReducers({
  global: globalSlice.reducer,
  gameState: gameStateSlice.reducer,
  lua: luaSlice.reducer,
  rules: ruleSlice.reducer,
});

const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware(),
});

export default store;
