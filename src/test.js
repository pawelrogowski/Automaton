const robotjs = require('robotjs');

let count = 0;
const startTime = Date.now();

const intervalId = setInterval(() => {
  robotjs.keyTap('a');
  count++;

  const elapsedSeconds = (Date.now() - startTime) / 1000;
  if (elapsedSeconds >= 10) {
    clearInterval(intervalId);
    console.log(`Pressed 'a' ${count} times in 10 seconds.`);
  }
}, 0);
