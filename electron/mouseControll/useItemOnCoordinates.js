import commandExecutor from '../utils/commandExecutor.js';
import getMouseLocation from './getMouseLocation.js';

async function useItemOnCoordinates(targetWindowId, targetX, targetY, key) {
  try {
    const chainedCommands = [
      `mousemove --clearmodifiers ${targetX} ${targetY}`,
      `key --window ${targetWindowId} --clearmodifiers  ${key}`,
      `click --window ${targetWindowId} --clearmodifiers 1`,
      // `mousemove --clearmodifiers restore`,
      `keyup --clearmodifiers ctrl`,
      `keyup --clearmodifiers shift`,
      `keyup --clearmodifiers alt`,
    ];

    const combinedCommand = chainedCommands.join(' ');
    await commandExecutor.addCommand(combinedCommand);
  } catch (error) {
    console.error('Error in useItemOnCoordinates:', error);
  }
}

export default useItemOnCoordinates;
