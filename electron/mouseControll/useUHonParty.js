import { exec } from 'child_process';

function useUHonParty(targetWindowId, x, y, key) {
  console.log('UH firing');

  // Function to execute shell commands
  const executeShellCommand = (command, callback) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing command: ${command}`, error);
        return;
      }
      callback(stdout.trim());
    });
  };

  // Step 1: Get current mouse position
  executeShellCommand('xdotool getmouselocation', (mouseLocation) => {
    const match = mouseLocation.match(/x:(\d+) y:(\d+) screen:\d+ window:\d+/);
    if (!match) {
      console.error('Failed to parse mouse location');
      return;
    }

    const originalX = parseInt(match[1], 10);
    const originalY = parseInt(match[2], 10);

    // Step 2: Execute the main command sequence
    const chainedCommands = [
      `mousemove --window ${targetWindowId} ${x} ${y}`,
      `key --window ${targetWindowId} ${key}`,
      `click --window ${targetWindowId} 1`,
      // Step 3: Move mouse back to original position
      `mousemove ${originalX} ${originalY}`,
    ].join(' ');

    const fullCommand = `xdotool ${chainedCommands}`;
    executeShellCommand(fullCommand, () => {
      console.log('Command executed successfully');
    });
  });
}

export default useUHonParty;
