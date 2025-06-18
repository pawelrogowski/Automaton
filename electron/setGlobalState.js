import { getMainWindow } from './createMainWindow.js';
import store from './store.js';
import { setPlayerMinimapPosition } from '../frontend/redux/slices/gameStateSlice.js'; // Import the specific action

const setGlobalState = (type, payload) => {
  // console.log('debug', `[setGlobalState] Received type: ${type}, payload:`, payload);
  // Handle specific actions from workers
  if (type === 'playerMinimapPosition') {
    // console.log('info', `[setGlobalState] Dispatching playerMinimapPosition with payload:`, payload);
    store.dispatch(setPlayerMinimapPosition(payload));
  } else {
    // For other actions, dispatch as usual
    store.dispatch({ type, payload });
  }

  // Send state update to renderer process
  getMainWindow().webContents.send('state-update', {
    type,
    payload,
    origin: 'backend',
  });
};

export default setGlobalState;
