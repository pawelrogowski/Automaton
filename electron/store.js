import { configureStore, combineReducers } from '@reduxjs/toolkit';
import globalSlice from '../frontend/redux/slices/globalSlice.js';
import healingSlice from '../frontend/redux/slices/healingSlice.js';
import gameStateSlice from '../frontend/redux/slices/gameStateSlice.js';

const rootReducer = combineReducers({
  global: globalSlice.reducer,
  gameState: gameStateSlice.reducer,
  healing: healingSlice.reducer,
});

const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware(),
});

export default store;
