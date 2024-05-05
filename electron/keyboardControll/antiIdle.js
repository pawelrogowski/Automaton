import { exec } from 'child_process';

export const antiIdle = (windowId) => {
  // Chain the key presses together in a single command
  const command = `xdotool key --delay 25 --window ${windowId} ctrl+Left ctrl+Down ctrl+Rigt ctrl+Up`;
  exec(command);
};
