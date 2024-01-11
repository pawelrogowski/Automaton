import { exec } from 'child_process';

const getWindowGeometry = async (windowId) => {
  return new Promise((resolve, reject) => {
    exec(`xdotool getwindowgeometry ${windowId}`, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }

      const match = stdout.match(
        /Position: (-?\d+),(-?\d+) \(screen: \d+\)\n {2}Geometry: (\d+)x(\d+)/,
      );
      if (match) {
        const [, x, y, width, height] = match;

        const windowGeometry = {
          x: parseInt(x, 10),
          y: parseInt(y, 10),
          width: parseInt(width, 10),
          height: parseInt(height, 10),
        };

        resolve(windowGeometry);
      } else {
        reject(new Error('Failed to parse window geometry'));
      }
    });
  });
};

export default getWindowGeometry;
