import { exec } from 'child_process';

export const keyPress = (windowId, keys, delay = null) => {
  const extraDelay = delay / 1000;
  const delayCommand = `sleep ${extraDelay} && `;
  const keySequence = keys.join(' ');
  const keyCommand = `xdotool key --delay 25 --window ${windowId} ${keySequence}`;
  let command;
  if (delay) {
    command = delayCommand + keyCommand;
  } else {
    command = keyCommand;
  }
  exec(command);
  console.log(command);
};
