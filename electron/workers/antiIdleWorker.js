import { parentPort } from 'worker_threads';
import { exec } from 'child_process';

let prevState;
let state;
let intervalId; // Flag to store the interval ID
let shouldExecute = false; // Flag to control execution

parentPort.on('message', (state) => {
  if (prevState !== state) {
    ({ global } = state);
    if (!shouldExecute && global.antiIdleEnabled) {
      shouldExecute = true; // Set flag to allow periodic execution
    } else if (shouldExecute && !global.antiIdleEnabled) {
      clearInterval(intervalId); // Stop repeating execution
      shouldExecute = false; // Reset flag
    }
    prevState = state;
  }

  // Only execute the anti-idle command if the flag is set and the global setting allows it
  if (shouldExecute && global.antiIdleEnabled) {
    executeAntiIdle();
  }
});

function executeAntiIdle() {
  const command = `xdotool keydown ctrl key --window ${global.windowId} --delay 0 Up key --window ${global.windowId} --delay 0 Down keyup --window ${global.windowId} ctrl`;
  exec(command);
  console.log(global.antiIdleEnabled);
  // Schedule next execution at a random time between 3-6 minutes
  const minDelay = 1; // Minimum delay in seconds
  const maxDelay = 5; // Maximum delay in seconds
  const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
  setTimeout(() => {
    if (global.antiIdleEnabled) {
      executeAntiIdle();
    }
  }, delay * 1000); // Convert seconds to milliseconds
}
