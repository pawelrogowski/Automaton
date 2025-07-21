import mouseController from 'mouse-controller';
import { keyPress } from '../keyboardControll/keyPress.js';

function useItemOnCoordinates(targetWindowId, targetX, targetY, key) {
  // First press the key
  keyPress(parseInt(targetWindowId), key);

  // Then perform left click on coordinates
  mouseController.leftClick(
    parseInt(targetWindowId),
    parseInt(targetX),
    parseInt(targetY),
  );
}

export default useItemOnCoordinates;
