import { exec } from 'child_process';

export const keyPress = (windowId, key) => {
  const command = `xdotool key --delay 0 --window ${windowId} ${key}`;
  exec(command);
  console.log(`KeyPress: ${key}`);
};
