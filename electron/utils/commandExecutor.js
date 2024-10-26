import { spawn } from 'child_process';

const ENABLE_COMMAND_LOGGING = true;
const MAX_LOG_ENTRIES = 10;

const commandExecutor = (() => {
  let queue = [];
  let isProcessing = false;
  let executionLog = [];
  let xdotoolProcess = null;

  let lastF2PressTime = null;
  let previousF2PressTime = null; // Track the previous press time
  let f2Statistics = {
    pressCount: 0,
    intervals: [],
    averageInterval: 0,
    minInterval: Infinity,
    maxInterval: 0,
    lastInterval: 0, // Time between last and current press
    previousInterval: 0, // Time between previous and last press
  };

  const updateF2Statistics = (currentTime) => {
    if (lastF2PressTime) {
      const interval = currentTime - lastF2PressTime;
      f2Statistics.intervals.push(interval);
      f2Statistics.pressCount++;

      f2Statistics.previousInterval = f2Statistics.lastInterval; // Store the previous interval
      f2Statistics.lastInterval = interval; // Update last interval

      f2Statistics.averageInterval =
        f2Statistics.intervals.reduce((a, b) => a + b, 0) / f2Statistics.intervals.length;
      f2Statistics.minInterval = Math.min(f2Statistics.minInterval, interval);
      f2Statistics.maxInterval = Math.max(f2Statistics.maxInterval, interval);

      if (f2Statistics.intervals.length > MAX_LOG_ENTRIES) {
        f2Statistics.intervals = f2Statistics.intervals.slice(-MAX_LOG_ENTRIES);
      }
    }

    previousF2PressTime = lastF2PressTime; // Update previous press time
    lastF2PressTime = currentTime; // Update last press time

    return {
      pressCount: f2Statistics.pressCount,
      lastInterval: f2Statistics.lastInterval,
      previousInterval: f2Statistics.previousInterval,
      averageInterval: f2Statistics.averageInterval.toFixed(2),
      minInterval: f2Statistics.minInterval,
      maxInterval: f2Statistics.maxInterval,
    };
  };

  const stripFlags = (command) => {
    if (!ENABLE_COMMAND_LOGGING) return command;

    const parts = command.split(' ');
    return parts
      .filter((part, index) => {
        if (part.startsWith('--')) return false;
        if (index > 0 && parts[index - 1].startsWith('--')) return false;
        return true;
      })
      .join(' ');
  };

  const addLogEntry = (entry) => {
    if (!ENABLE_COMMAND_LOGGING) return;

    const strippedCommand = stripFlags(entry.command);

    let f2Stats = null;
    if (strippedCommand.includes('key F2')) {
      f2Stats = updateF2Statistics(Date.now());
    }

    executionLog.push({
      ...entry,
      command: strippedCommand,
      f2Stats: f2Stats,
    });

    if (executionLog.length > MAX_LOG_ENTRIES) {
      executionLog = executionLog.slice(-MAX_LOG_ENTRIES);
    }
  };

  const initXdotoolProcess = () => {
    if (xdotoolProcess) return;

    xdotoolProcess = spawn('xdotool', ['-']);

    if (ENABLE_COMMAND_LOGGING) {
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
    }
  };

  const displayLogs = () => {
    clearConsole();

    if (f2Statistics.pressCount > 0) {
      console.log('\nF2 Key Statistics:');
      console.table({
        'Current Statistics': {
          'Total Presses': f2Statistics.pressCount,
          'Last Interval (ms)': f2Statistics.lastInterval,
          'Previous Interval (ms)': f2Statistics.previousInterval,
          'Average Interval (ms)': f2Statistics.averageInterval.toFixed(2),
          'Min Interval (ms)': f2Statistics.minInterval,
          'Max Interval (ms)': f2Statistics.maxInterval,
        },
      });
    }

    console.log('\nCommand Log:');
    console.table(
      executionLog.map((entry) => ({
        Command: entry.command,
        Time: entry.executionTime,
        Status: entry.status,
        Timestamp: entry.timestamp,
      })),
    );
  };

  const processQueue = async () => {
    if (isProcessing || queue.length === 0) return;

    isProcessing = true;

    const { command, resolve, reject } = queue.shift();
    const startTime = ENABLE_COMMAND_LOGGING ? process.hrtime() : null;

    try {
      initXdotoolProcess();
      xdotoolProcess.stdin.write(command + '\n');

      if (ENABLE_COMMAND_LOGGING) {
        const [seconds, nanoseconds] = process.hrtime(startTime);
        const executionTime = seconds * 1000 + nanoseconds / 1e6;

        addLogEntry({
          command,
          executionTime: `${executionTime.toFixed(3)}ms`,
          status: 'Sent',
          timestamp: new Date().toISOString(),
        });

        displayLogs();
      }

      resolve();
    } catch (error) {
      if (ENABLE_COMMAND_LOGGING) {
        console.error('Command execution error:', error);
      }
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

  const getExecutionLog = () => {
    if (!ENABLE_COMMAND_LOGGING) return null;
    return [...executionLog];
  };

  const getF2Statistics = () => {
    return { ...f2Statistics };
  };

  const clearExecutionLog = () => {
    if (!ENABLE_COMMAND_LOGGING) return;
    executionLog = [];
  };

  const cleanup = () => {
    if (xdotoolProcess) {
      xdotoolProcess.stdin.end();
      xdotoolProcess.kill();
      xdotoolProcess = null;
    }
    queue = [];
    executionLog = ENABLE_COMMAND_LOGGING ? [] : null;
    isProcessing = false;
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('uncaughtException', (error) => {
    if (ENABLE_COMMAND_LOGGING) {
      console.error('Uncaught Exception:', error);
    }
    cleanup();
    process.exit(1);
  });

  return {
    addCommand,
    getExecutionLog,
    clearExecutionLog,
    getF2Statistics,
    cleanup,
  };
})();

const clearConsole = () => {
  if (ENABLE_COMMAND_LOGGING) {
    console.log('\x1Bc');
  }
};

export default commandExecutor;
