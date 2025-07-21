import mouseController from 'mouse-controller';
import { keyPress } from '../keyboardControll/keyPress.js';

function useItemOnCoordinates(targetWindowId, display, targetX, targetY, key) {
  // Add display parameter
  // First press the key
  keyPress(parseInt(targetWindowId), display, key); // Pass display to keyPress

  // Then perform left click on coordinates
  mouseController.leftClick(
    parseInt(targetWindowId),
    parseInt(targetX),
    parseInt(targetY),
    display, // Pass display to mouseController
  );
}

export default useItemOnCoordinates;
