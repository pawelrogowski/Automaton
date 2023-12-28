import { configureStore } from '@reduxjs/toolkit';
import globalSlice from './slices/globalSlice.js';
import healingSlice from './slices/healingSlice.js';
import { createLogger } from 'redux-logger';

const logger = createLogger();

const store = configureStore({
  reducer: {
    global: globalSlice.reducer,
    healing: healingSlice.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(logger),
  devTools: true,
});

export default store;
