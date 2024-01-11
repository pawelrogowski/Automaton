import { execSync } from 'child_process';

const getWindowName = (windowId) => {
  const stdout = execSync(`xdotool getwindowname ${windowId}`);
  return stdout.toString().trim();
};

export default getWindowName;
