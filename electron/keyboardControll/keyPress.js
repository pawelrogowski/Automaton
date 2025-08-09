import keypress from 'keypress-native';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends a single key press with an optional modifier.
 * @param {string} display - The display to send the key to (e.g., ':0').
 * @param {string} key - The key to press (e.g., 'a', 'f1', 'enter').
 * @param {object} [options] - Optional parameters.
 * @param {string|null} [options.modifier=null] - The modifier key (e.g., 'shift', 'ctrl').
 */
export const keyPress = async (display, key, { modifier = null } = {}) => {
  await keypress.sendKey(key, display, modifier);
};

/**
 * Sends a key press multiple times with a delay.
 * @param {string} display - The display to send the key to.
 * @param {string} key - The key to press.
 * @param {object} [options] - Optional parameters.
 * @param {number} [options.count=1] - The number of times to press the key.
 * @param {string|null} [options.modifier=null] - The modifier key.
 * @param {number} [options.delayMs=50] - The delay between key presses.
 */
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

/**
 * Types an array of strings with human-like behavior. This is the primary function for typing text.
 * It is aliased as 'type' in luaApi.js.
 * @param {string} display - The display to send the keys to.
 * @param {string[]} texts - An array of strings to type.
 * @param {boolean} [startAndEndWithEnter=true] - Whether to press Enter before and after each string.
 */
export const typeArray = async (
  display,
  texts,
  startAndEndWithEnter = true,
) => {
  // The native addon's typeArray function can handle both single and multiple strings efficiently.
  await keypress.typeArray(texts, display, startAndEndWithEnter);
};

/**
 * Simulates a complex rotation key sequence.
 * @param {string} display - The display to send the keys to.
 * @param {string} [direction] - An optional final direction ('n', 's', 'e', 'w').
 */
export const rotate = async (display, direction) => {
  await keypress.rotate(display, direction);
};

/**
 * A stub function to indicate typing status.
 * @returns {boolean} Always returns false.
 */
export const getIsTyping = () => false;

/**
 * Holds a key down.
 * @param {string} display - The display to send the key to.
 * @param {string} key - The key to hold down.
 * @param {object} [options] - Optional parameters.
 * @param {string|null} [options.modifier=null] - The modifier key.
 */
export const keyDown = (display, key, { modifier = null } = {}) => {
  keypress.keyDown(key, display, modifier);
};

/**
 * Releases a key.
 * @param {string} display - The display to send the key to.
 * @param {string} key - The key to release.
 * @param {object} [options] - Optional parameters.
 * @param {string|null} [options.modifier=null] - The modifier key.
 */
export const keyUp = (display, key, { modifier = null } = {}) => {
  keypress.keyUp(key, display, modifier);
};
