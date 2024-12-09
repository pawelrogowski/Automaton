import commandExecutor from '../utils/commandExecutor.js';

async function useItemOnCoordinates(targetWindowId, targetX, targetY, key) {
  try {
    const chainedCommands = [
      `mousemove --clearmodifiers --sync ${targetX} ${targetY}`,
      `key --window ${targetWindowId} --clearmodifiers  ${key}`,
      `click --window ${targetWindowId} --clearmodifiers 1`,
      `mousemove --clearmodifiers --sync restore`,
      `keyup --window ${targetWindowId} --delay 0 ctrl`,
      `keyup --window ${targetWindowId} --delay 0 shift`,
      `keyup --window ${targetWindowId} --delay 0 alt`,
    ];

    const combinedCommand = chainedCommands.join(' ');
    await commandExecutor.addCommand(combinedCommand);
  } catch (error) {
    console.error('Error in useItemOnCoordinates:', error);
  }
}
export default useItemOnCoordinates;
