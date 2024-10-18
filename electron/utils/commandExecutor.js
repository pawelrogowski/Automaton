import { spawn } from 'child_process';

const commandExecutor = (() => {
  let queue = [];
  let isProcessing = false;
  let executionLog = [];
  const MAX_LOG_ENTRIES = 25;
  let xdotoolProcess = null;

  const addLogEntry = (entry) => {
    executionLog.push(entry);
    if (executionLog.length > MAX_LOG_ENTRIES) {
      executionLog.shift();
    }
  };

  const initXdotoolProcess = () => {
    if (xdotoolProcess) return;

    xdotoolProcess = spawn('xdotool', ['-']);
    xdotoolProcess.stdout.on('data', (data) => {
      console.log(`xdotool stdout: ${data}`);
    });
    xdotoolProcess.stderr.on('data', (data) => {
      console.error(`xdotool stderr: ${data}`);
    });
    xdotoolProcess.on('close', (code) => {
      console.log(`xdotool process exited with code ${code}`);
      xdotoolProcess = null;
    });
  };

  const processQueue = async () => {
    if (isProcessing || queue.length === 0) {
      return;
    }

    isProcessing = true;

    const { command, resolve, reject } = queue.shift();
    const startTime = process.hrtime();

    initXdotoolProcess();

    xdotoolProcess.stdin.write(command + '\n');

    // For simplicity, we're resolving immediately.
    // In a real-world scenario, you might want to wait for some kind of acknowledgement.
    const [seconds, nanoseconds] = process.hrtime(startTime);
    const executionTime = seconds * 1000 + nanoseconds / 1e6;

    addLogEntry({
      command,
      executionTime: `${executionTime.toFixed(3)}ms`,
      status: 'Sent',
      timestamp: new Date().toISOString(),
    });

    console.table(executionLog);

    resolve();

    isProcessing = false;
    processQueue();
  };

  const addCommand = (command) => {
    return new Promise((resolve, reject) => {
      queue.push({ command, resolve, reject });
      processQueue();
    });
  };

  const getExecutionLog = () => [...executionLog];

  const clearExecutionLog = () => {
    executionLog = [];
  };

  return { addCommand, getExecutionLog, clearExecutionLog };
})();

export default commandExecutor;
