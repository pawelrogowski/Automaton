import { exec } from 'child_process';

const antiIdle = () => {
  const command = 'xdotool keydown ctrl key --delay 0 Up key --delay 0 Down keyup ctrl';
  exec(command);
};

antiIdle();
export default antiIdle;
