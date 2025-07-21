import keypress from 'keypress-native';

let isTyping = false;

export const getIsTyping = () => isTyping;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const keyPress = async (
  windowId,
  display,
  key,
  { modifier = null } = {},
) => {
  await keypress.sendKey(parseInt(windowId), key, display, modifier); // Pass display
};

export const keyPressMultiple = async (
  windowId,
  display, // Add display parameter
  key,
  { count = 1, modifier = null, delayMs = 50 } = {},
) => {
  for (let i = 0; i < count; i++) {
    await keyPress(windowId, display, key, { modifier }); // Pass display
    if (i < count - 1) {
      await delay(delayMs);
    }
  }
};

export const type = async (
  windowId,
  display,
  texts,
  startAndEndWithEnter = true,
) => {
  // Add display parameter
  isTyping = true;
  try {
    for (const text of texts) {
      await keypress.type(
        parseInt(windowId),
        text,
        display,
        startAndEndWithEnter,
      ); // Pass display
      // Add a small delay between typing multiple strings to allow the game to process
      await delay(150);
    }
  } finally {
    isTyping = false;
  }
};

export const rotate = async (windowId, display, direction) => {
  // Add display parameter
  await keypress.rotate(parseInt(windowId), display, direction); // Pass display
};
