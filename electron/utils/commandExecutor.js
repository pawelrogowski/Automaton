import { spawn } from 'child_process';

const commandExecutor = (() => {
  let queue = [];
  let isProcessing = false;
  let xdotoolProcess = null;
  let lastExecutionTime = 0;
  const MIN_DELAY = 50; // Minimum delay in milliseconds between commands

  const initXdotoolProcess = () => {
    if (xdotoolProcess) return;

    xdotoolProcess = spawn('xdotool', ['-']);

    // Minimal process initialization without logging stdout or stderr
    xdotoolProcess.on('close', () => {
      xdotoolProcess = null;
    });
  };

  const processQueue = async () => {
    if (isProcessing || queue.length === 0) return;

    isProcessing = true;

    const now = Date.now();
    const delay = Math.max(0, MIN_DELAY - (now - lastExecutionTime));

    setTimeout(async () => {
      const { command, resolve, reject } = queue.shift();

      try {
        initXdotoolProcess();
        xdotoolProcess.stdin.write(command + '\n');
        lastExecutionTime = Date.now();
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        isProcessing = false;
        processQueue();
      }
    }, delay);
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
