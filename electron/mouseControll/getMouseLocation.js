import { exec } from 'child_process';
import { workerData } from 'worker_threads';

const xdotool = workerData.xdotoolPath;

function getMouseLocation() {
  try {
    const stdout = exec(`${xdotool} getmouselocation`).toString();
    const location = stdout.split(' ').reduce((obj, item) => {
      const [key, value] = item.split(':');
      obj[key] = Number(value);
      return obj;
    }, {});
    return location;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return null;
  }
}

export default getMouseLocation;
