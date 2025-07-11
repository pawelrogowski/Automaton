import keypress from 'keypress-native';

let isTyping = false;

export const getIsTyping = () => isTyping;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const keyPress = async (windowId, key, { modifier = null } = {}) => {
  await keypress.sendKey(parseInt(windowId), key, modifier);
};

export const keyPressMultiple = async (windowId, key, { count = 1, modifier = null, delayMs = 50 } = {}) => {
  for (let i = 0; i < count; i++) {
    await keyPress(windowId, key, { modifier });
    if (i < count - 1) {
      await delay(delayMs);
    }
  }
};

export const type = async (windowId, texts, startAndEndWithEnter = true) => {
  isTyping = true;
  try {
    for (const text of texts) {
      await keypress.type(parseInt(windowId), text, startAndEndWithEnter);
      // Add a small delay between typing multiple strings to allow the game to process
      await delay(150); 
    }
  } finally {
    isTyping = false;
  }
};

export const rotate = async (windowId, direction) => {
  await keypress.rotate(parseInt(windowId), direction);
};
