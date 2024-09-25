import { configureStore, combineReducers } from '@reduxjs/toolkit';

import globalSlice from '../src/redux/slices/globalSlice.js';
import healingSlice from '../src/redux/slices/healingSlice.js';
import gameStateSlice from '../src/redux/slices/gameStateSlice.js';
const logger = (store) => (next) => (action) => {
  let result = next(action);
  // if (action.type.startsWith('healing')) {
  //   console.log('Healing slice changed:', store.getState().healing);
  // }
  return result;
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
});
const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(logger),
});

export default store;
