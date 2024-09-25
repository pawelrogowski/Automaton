import { exec } from 'child_process';

function useItemOnCoordinates(targetWindowId, x, y, key) {
  const chainedCommands = [
    `key --window ${targetWindowId} --clearmodifiers --delay 0 ${key}`,
    `mousemove --sync ${x} ${y}`,
    `click --clearmodifiers 1`,
    `mousemove restore`,
    `keyup ctrl`,
    `keyup shift`,
    `keyup alt`,
  ].join(' ');

  const fullCommand = `xdotool ${chainedCommands}`;
  exec(fullCommand);
}

export default useItemOnCoordinates;
