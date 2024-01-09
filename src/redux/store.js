import { configureStore } from '@reduxjs/toolkit';
// import pkg from 'redux-logger';
import globalSlice from './slices/globalSlice.js';
import healingSlice from './slices/healingSlice.js';
import gameStateSlice from './slices/gameStateSlice.js';

// const { createLogger } = pkg;

// const logger = createLogger();

const store = configureStore({
  reducer: {
    global: globalSlice.reducer,
    gameState: gameStateSlice.reducer,
    healing: healingSlice.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware(),
  // devTools: true,
});

export default store;
