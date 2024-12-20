import commandExecutor from '../utils/commandExecutor.js';

commandExecutor;
export const keyPress = async (windowId, keys, delay = null) => {
  const extraDelay = delay ? delay / 1000 : 0;
  const keySequence = keys.join(' ');
  const command = `key --delay 0 --window ${windowId} ${keySequence}`;

  if (delay) {
    await new Promise((resolve) => setTimeout(resolve, extraDelay * 1000));
  }

  await commandExecutor.addCommand(command);
};

export const keyPressManaSync = async (windowId, key, pressNumber = 1) => {
  const singlePressCommand = `key --window ${windowId} ${key}`;

  // Execute first press immediately
  await commandExecutor.addCommand(singlePressCommand);

  // Handle remaining presses with delays
  for (let i = 1; i < pressNumber; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await commandExecutor.addCommand(singlePressCommand);
  }
};
