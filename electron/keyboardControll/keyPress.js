import { workerData } from 'worker_threads';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const keypress = require(workerData.keypressPath);

export const keyPress = (windowId, key, rule = null) => {
  keypress.sendKey(parseInt(windowId), key);
};

export const keyPressManaSync = async (windowId, key, pressNumber = 1) => {
  keypress.sendKey(parseInt(windowId), key);

  // Handle remaining presses with delays
  for (let i = 1; i < pressNumber; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await keypress.sendKey(parseInt(windowId), key);
  }
};
