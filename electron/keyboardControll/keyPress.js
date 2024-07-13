import { exec } from 'child_process';

export const keyPress = (windowId, keys) => {
  const keySequence = keys.join(' ');
  const command = `xdotool key --delay 25 --window ${windowId} ${keySequence}`;
  exec(command);
  console.log(command);
};
