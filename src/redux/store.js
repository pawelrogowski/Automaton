import { configureStore } from '@reduxjs/toolkit';
// import pkg from 'redux-logger';
import globalSlice from './slices/globalSlice.js';
import healingSlice from './slices/healingSlice.js';
import gameStateSlice from './slices/gameStateSlice.js';

// const { createLogger } = pkg;

// const logger = createLogger();

const ipcMiddleware = () => (next) => (action) => {
  console.log('Sending action to main process:', action);
  const actionWithOrigin = { ...action, origin: 'renderer' };
  const serializedAction = JSON.stringify(actionWithOrigin);
  window.electron.ipcRenderer.send('state-change', serializedAction);
  return next(action);
};

const store = configureStore({
  reducer: {
    global: globalSlice.reducer,
    gameState: gameStateSlice.reducer,
    healing: healingSlice.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(ipcMiddleware),
  // devTools: true,
});

export default store;
