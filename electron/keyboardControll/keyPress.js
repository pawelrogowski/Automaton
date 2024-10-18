import commandExecutor from '../utils/commandExecutor.js';

commandExecutor;
export const keyPress = async (windowId, keys, delay = null) => {
  const extraDelay = delay ? delay / 1000 : 0;
  const keySequence = keys.join(' ');
  const command = `key --delay 50  --window ${windowId} ${keySequence}`;

  if (delay) {
    await new Promise((resolve) => setTimeout(resolve, extraDelay * 1000));
  }

  await commandExecutor.addCommand(command);
};

export const keyPressManaSync = async (windowId, keys, delay = null, pressNumber = 1) => {
  const extraDelay = delay ? delay / 1000 : 0;
  const keySequence = keys.join(' ');
  const command = `key --window ${windowId} --repeat ${pressNumber} ${keySequence}`;

  if (delay) {
    await new Promise((resolve) => setTimeout(resolve, extraDelay * 1000));
  }

  await commandExecutor.addCommand(command);
};
