import { getRandomNumber } from '../utils/getRandomNumber.js';

export const wait = async (min_ms, max_ms, refreshCallback = null) => {
  const delay = max_ms === undefined ? min_ms : getRandomNumber(min_ms, max_ms);
  return new Promise((resolve) =>
    setTimeout(() => {
      if (refreshCallback) {
        refreshCallback(); // Call the refresh callback after the delay
      }
      resolve();
    }, delay),
  );
};
