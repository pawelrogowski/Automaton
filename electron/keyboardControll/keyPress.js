import commandExecutor from '../utils/commandExecutor.js';

export const keyPress = async (windowId, key) => {
  await commandExecutor.addCommand(`key --window ${windowId} ${key}`);
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
