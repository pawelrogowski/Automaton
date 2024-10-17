import { exec } from 'child_process';
import { workerData } from 'worker_threads';

const xdotool = workerData.xdotoolPath;

export const keyPress = (windowId, keys, delay = null) => {
  const extraDelay = delay / 1000;
  const delayCommand = `sleep ${extraDelay} && `;
  const keySequence = keys.join(' ');
  const keyCommand = `"${xdotool}" key --delay 0 --window ${windowId} ${keySequence}`;
  let command;
  if (delay) {
    command = delayCommand + keyCommand;
  } else {
    command = keyCommand;
  }
  exec(command);
};

export const keyPressManaSync = (windowId, keys, delay = null, pressNumber = 1) => {
  const extraDelay = delay / 1000;
  const delayCommand = `sleep ${extraDelay} && `;
  const keySequence = keys.join(' ');
  const keyCommand = `"${xdotool}" key --delay 0 --window ${windowId} --repeat ${pressNumber} ${keySequence}`;
  let command;
  if (delay) {
    command = delayCommand + keyCommand;
  } else {
    command = keyCommand;
  }
  exec(command);
};
