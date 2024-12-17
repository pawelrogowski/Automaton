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
    if (isProcessing || queue.length === 0) return;

    isProcessing = true;

    const { command, resolve, reject } = queue.shift();

    try {
      initXdotoolProcess();
      xdotoolProcess.stdin.write(command + '\n');
      resolve();
    } catch (error) {
      reject(error);
    } finally {
      isProcessing = false;
      processQueue();
    }
  };

  const addCommand = (command) => {
    return new Promise((resolve, reject) => {
      queue.push({ command, resolve, reject });
      processQueue();
    });
  };

  const cleanup = () => {
    if (xdotoolProcess) {
      xdotoolProcess.stdin.end();
      xdotoolProcess.kill();
      xdotoolProcess = null;
    }
    queue = [];
    isProcessing = false;
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('uncaughtException', (error) => {
    cleanup();
    process.exit(1);
  });

  return {
    addCommand,
    cleanup,
  };
})();

export default commandExecutor;
