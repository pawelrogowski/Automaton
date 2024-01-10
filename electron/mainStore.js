import { configureStore, combineReducers } from '@reduxjs/toolkit';
import globalSlice from '../src/redux/slices/globalSlice.js';
import healingSlice from '../src/redux/slices/healingSlice.js';
import gameStateSlice from '../src/redux/slices/gameStateSlice.js';

const logger = (storeAPI) => (next) => (action) => {
  console.table(action);
  return next(action);
};

const rootReducer = combineReducers({
  global: globalSlice.reducer,
  gameState: gameStateSlice.reducer,
  healing: healingSlice.reducer,
});
const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(logger),
});

export default store;
