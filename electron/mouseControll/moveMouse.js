import { exec } from 'child_process';

import path from 'path';
import { fileURLToPath } from 'url';
import { app } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let xdotool;

if (app.isPackaged) {
  xdotool = path.join(app.getAppPath(), '..', 'resources', 'xdotool', 'xdotool');
} else {
  xdotool = path.join(__dirname, '..', '..', 'resources', 'xdotool', 'xdotool');
}
function moveMouse(targetWindowId, x, y) {
  const getFocusedWindowIdCommand = 'xdotool getwindowfocus';

  exec(getFocusedWindowIdCommand, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error executing command: ${error}`);
      return;
    }

    const focusedWindowId = stdout.trim();

    // Check if the focused window matches the target window ID
    if (focusedWindowId === targetWindowId) {
      const command = `${xdotool} mousemove --window ${targetWindowId} ${x} ${y}`;
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error executing command: ${error}`);
          return;
        }
        console.log(`Mouse moved to (${x}, ${y}) in window ID ${targetWindowId}`);
      });
    } else {
      console.log('Target window is not currently focused.');
    }
  });
}

export default moveMouse;
