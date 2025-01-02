import commandExecutor from '../utils/commandExecutor.js';

async function useItemOnCoordinates(targetWindowId, targetX, targetY, key) {
  try {
    const chainedCommands = [
      `mousemove ${targetX} ${targetY}`,
      `key --window ${targetWindowId} ${key}`,
      `click --window ${targetWindowId} 1`,
      `mousemove restore`,
    ];

    const combinedCommand = chainedCommands.join(' ');
    await commandExecutor.addCommand(combinedCommand);
  } catch (error) {
    console.error('Error in useItemOnCoordinates:', error);
  }
}
export default useItemOnCoordinates;
