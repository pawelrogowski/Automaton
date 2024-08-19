import { exec } from 'child_process';

function useUHonParty(targetWindowId, x, y, key) {
  console.log('UH firing');

  const executeShellCommand = (command, callback) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing command: ${command}`, error);
        return;
      }
      callback(stdout.trim());
    });
  };

  executeShellCommand('xdotool getmouselocation', (mouseLocation) => {
    const match = mouseLocation.match(/x:(\d+) y:(\d+) screen:\d+ window:\d+/);
    if (!match) {
      console.error('Failed to parse mouse location');
      return;
    }

    const originalX = parseInt(match[1], 10);
    const originalY = parseInt(match[2], 10);

    const chainedCommands = [
      `key --window ${targetWindowId} --clearmodifiers --delay 0 ${key}`,
      `mousemove --window ${targetWindowId} --sync ${x} ${y}`,
      `click --window ${targetWindowId} --clearmodifiers --delay 0 1`,
      `mousemove --sync ${originalX} ${originalY}`,
    ].join(' ');

    const fullCommand = `xdotool ${chainedCommands}`;
    executeShellCommand(fullCommand, () => {
      console.log('Command executed successfully');
    });
  });
}

export default useUHonParty;
