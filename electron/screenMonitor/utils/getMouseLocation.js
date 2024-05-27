import { exec } from 'child_process';
import setGlobalState from '../../setGlobalState.js';

export const getMouseLocation = async () => {
  return new Promise((resolve, reject) => {
    exec('xdotool getmouselocation --shell', (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing xdotool: ${error.message}`);
        reject(error);
        return;
      }

      if (stderr) {
        console.error(`Stderr: ${stderr}`);
        reject(stderr);
        return;
      }

      const lines = stdout.split('\n').filter((line) => line.trim() !== '');
      const xLine = lines.find((line) => line.startsWith('X='));
      const yLine = lines.find((line) => line.startsWith('Y='));
      const windowLine = lines.find((line) => line.startsWith('WINDOW='));

      if (xLine && yLine && windowLine) {
        const x = xLine.split('=')[1].trim();
        const y = yLine.split('=')[1].trim();
        const windowId = windowLine.split('=')[1].trim();
        resolve({ x, y, windowId });
      } else {
        console.error('Could not find required data in output.');
        reject(new Error('Required data not found in output.'));
      }
    });
  });
};
