import { configureStore } from '@reduxjs/toolkit';
import globalSlice from './slices/globalSlice.js';
import ruleSlice from './slices/ruleSlice.js';
import gameStateSlice from './slices/gameStateSlice.js';
import luaSlice from './slices/luaSlice.js';
import cavebotSlice from './slices/cavebotSlice.js';

const ipcMiddleware = () => (next) => (action) => {
  if (action.origin !== 'backend') {
    // console.log('Sending action to main process:', action.origin);
    const actionWithOrigin = { ...action, origin: 'renderer' };
    const serializedAction = JSON.stringify(actionWithOrigin);
    window.electron.ipcRenderer.send('state-change', serializedAction);
  }
  return next(action);
};

const store = configureStore({
  reducer: {
    global: globalSlice.reducer,
    gameState: gameStateSlice.reducer,
    rules: ruleSlice.reducer,
    lua: luaSlice.reducer,
    cavebot: cavebotSlice.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(ipcMiddleware),
});

export default store;
