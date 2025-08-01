import keypress from 'keypress-native';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const keyPress = async (display, key, { modifier = null } = {}) => {
  await keypress.sendKey(key, display, modifier);
};

export const keyPressMultiple = async (
  display,
  key,
  { count = 1, modifier = null, delayMs = 50 } = {},
) => {
  for (let i = 0; i < count; i++) {
    await keyPress(display, key, { modifier });
    if (i < count - 1) {
      await delay(delayMs);
    }
  }
};

export const type = async (display, text, startAndEndWithEnter = true) => {
  await keypress.type(text, display, startAndEndWithEnter);
};

export const rotate = async (display, direction) => {
  await keypress.rotate(display, direction);
};

export const getIsTyping = () => false; // Simple stub that always returns false
