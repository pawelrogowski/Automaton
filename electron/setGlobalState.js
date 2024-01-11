import { getMainWindow } from './createMainWindow.js';

const setGlobalState = (type, payload) => {
  getMainWindow().webContents.send('state-update', {
    type,
    payload,
  });
};

export default setGlobalState;
