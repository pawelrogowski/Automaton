import commandExecutor from '../utils/commandExecutor.js';
import getMouseLocation from './getMouseLocation.js';

async function useItemOnCoordinates(targetWindowId, targetX, targetY, key) {
  try {
    const originalLocation = getMouseLocation();
    if (!originalLocation) {
      console.error('Failed to get mouse location.');
      return;
    }
w 
hi

roshamuul

yes

hi

thais

yes
   

hi

svargrond

yes

hi

carlin

yes

hi

hi

ankrahmun

ab'dendriel

yes

hi

edron

yeshi

port hope

yesconst chainedCommands = [
      `key --window ${targetWindowId} ${key}`,
      `mousemove --clearmodifiers --sync ${targetX} ${targetY}`,
      `click --window ${targetWindowId} --clearmodifiers 1`,
      `keyup --delay 0 --clearmodifiers --window ${targetWindowId} ctrl alt shift`,
      `mousemove --clearmodifiers --sync ${originalLocation.x} ${originalLocation.y}`,
    ];

    for (const command of chainedCommands) {
      await commandExecutor.addCommand(command);
    }
  } catch (error) {
    console.error('Error in useItemOnCoordinates:', error);
  }
}

export default useItemOnCoordinates;
