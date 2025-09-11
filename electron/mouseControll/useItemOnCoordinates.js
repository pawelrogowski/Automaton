import { parentPort } from 'worker_threads';
import { keyPress } from '../keyboardControll/keyPress.js';

const post = (payload) => {
  parentPort.postMessage({
    type: 'inputAction',
    payload,
  });
};

function useItemOnCoordinates(targetX, targetY, key, { type = 'default' } = {}) {
  keyPress(key, { type });

  post({
    type,
    action: {
      module: 'mouseController',
      method: 'leftClick',
      args: [parseInt(targetX), parseInt(targetY)],
    },
  });
}

export default useItemOnCoordinates;
