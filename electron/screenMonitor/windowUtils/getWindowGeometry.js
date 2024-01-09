import { execSync } from 'child_process';

const getWindowGeometry = (windowId) => {
  let windowGeometry = null;
  const output = execSync(`xdotool getwindowgeometry ${windowId}`).toString();

  const match = output.match(
    /Position: (-?\d+),(-?\d+) \(screen: \d+\)\n {2}Geometry: (\d+)x(\d+)/,
  );
  if (match) {
    const [, x, y, width, height] = match;

    windowGeometry = {
      x: parseInt(x, 10),
      y: parseInt(y, 10),
      width: parseInt(width, 10),
      height: parseInt(height, 10),
    };
  }
  return windowGeometry;
};

export default getWindowGeometry;
