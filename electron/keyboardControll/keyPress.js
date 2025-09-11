import { parentPort } from 'worker_threads';

const post = (payload) => {
  parentPort.postMessage({
    type: 'inputAction',
    payload,
  });
};

export const keyPress = (key, { modifier = null, type = 'default' } = {}) => {
  post({
    type,
    action: {
      module: 'keypress',
      method: 'sendKey',
      args: [key, modifier],
    },
  });
};

export const keyPressMultiple = (
  key,
  { count = 1, modifier = null, delayMs = 50, type = 'default' } = {},
) => {
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      keyPress(key, { modifier, type });
    }, i * delayMs);
  }
};

export const typeArray = (
  texts,
  { startAndEndWithEnter = true, type = 'default' } = {},
) => {
  post({
    type,
    action: {
      module: 'keypress',
      method: 'typeArray',
      args: [texts, startAndEndWithEnter],
    },
  });
};

export const rotate = (direction, { type = 'default' } = {}) => {
  post({
    type,
    action: {
      module: 'keypress',
      method: 'rotate',
      args: [direction],
    },
  });
};

export const getIsTyping = () => false;

export const keyDown = (key, { modifier = null, type = 'default' } = {}) => {
  post({
    type,
    action: {
      module: 'keypress',
      method: 'keyDown',
      args: [key, modifier],
    },
  });
};

export const keyUp = (key, { modifier = null, type = 'default' } = {}) => {
  post({
    type,
    action: {
      module: 'keypress',
      method: 'keyUp',
      args: [key, modifier],
    },
  });
};
