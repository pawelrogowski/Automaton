import { execSync } from 'child_process';
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
const getWindowName = (windowId) => {
  const stdout = execSync(`${xdotool} getwindowname ${windowId}`);
  return stdout.toString().trim();
};

export default getWindowName;
