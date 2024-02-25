import { configureStore, combineReducers } from '@reduxjs/toolkit';

import globalSlice from '../src/redux/slices/globalSlice.js';
import healingSlice from '../src/redux/slices/healingSlice.js';
import gameStateSlice from '../src/redux/slices/gameStateSlice.js';
import lastActionSlice, { setLastAction } from '../src/redux/slices/lastAction.js';

const logger = () => (next) => (action) => {
  if (action.type !== setLastAction.type) {
    console.table(action);
  }
  return next(action);
};

// const lastActionMiddleware = (store) => (next) => (action) => {
//   if (action.type !== setLastAction.type) {
//     next(action);
//     action.origin = 'backend';
//     // store.dispatch(setLastAction(action));
//   } else {
//     next(action);
//   }
// };

const rootReducer = combineReducers({
  global: globalSlice.reducer,
  gameState: gameStateSlice.reducer,
  healing: healingSlice.reducer,
  lastAction: lastActionSlice.reducer,
});
const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(logger),
});

export default store;
