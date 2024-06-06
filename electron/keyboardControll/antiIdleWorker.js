import { exec } from 'child_process';

self.addEventListener('message', (e) => {
  const { antiIdleEnabled, windowId } = e.data;
  if (antiIdleEnabled) {
    const delay = Math.floor(Math.random() * 180) + 180; // Random delay between 3 to 6 minutes
    setTimeout(() => {
      const command = `xdotool keydown ctrl key --delay 0 Up key --delay 0 Down keyup ctrl --window ${windowId}`;
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`exec error: ${error}`);
          return;
        }
        console.log(`stdout: ${stdout}`);
        console.error(`stderr: ${stderr}`);
      });
    }, delay);
  }
});
