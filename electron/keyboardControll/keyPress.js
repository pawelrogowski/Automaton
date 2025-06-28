import keypress from 'keypress-native';

export const keyPress = (windowId, key) => {
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

export const keyPressType = (windowId, str, delayMs = 10, finishWithEnter = false) => {
  keypress.type(parseInt(windowId), str, delayMs, finishWithEnter);
};

export const keyPressRotate = (windowId) => {
  keypress.rotate(parseInt(windowId));
};
