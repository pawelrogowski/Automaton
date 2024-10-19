import { spawn } from 'child_process';

const commandExecutor = (() => {
  let queue = [];
  let isProcessing = false;
  let xdotoolProcess = null;

  const initXdotoolProcess = () => {
    if (xdotoolProcess) return;

    xdotoolProcess = spawn('xdotool', ['-']);
    xdotoolProcess.on('close', () => {
      xdotoolProcess = null;
    });
  };

  const processQueue = async () => {
    if (isProcessing || queue.length === 0) {
      return;
    }

    isProcessing = true;

    const { command, resolve } = queue.shift();

    initXdotoolProcess();

    xdotoolProcess.stdin.write(command + '\n');

    resolve();

    isProcessing = false;
    processQueue();
  };

  const addCommand = (command) => {
    return new Promise((resolve) => {
      queue.push({ command, resolve });
      processQueue();
    });
  };

  return { addCommand };
})();

export default commandExecutor;
