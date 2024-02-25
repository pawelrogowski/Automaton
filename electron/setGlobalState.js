import { getMainWindow } from './createMainWindow.js';
import store from './store.js';

const setGlobalState = (type, payload) => {
  store.dispatch({ type, payload });
  getMainWindow().webContents.send('state-update', {
    type,
    payload,
    origin: 'backend',
  });
};

export default setGlobalState;
