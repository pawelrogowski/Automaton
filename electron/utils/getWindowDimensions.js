import { spawn } from 'child_process';

class XdotoolManager {
  constructor() {
    this.process = null;
    this.commandQueue = [];
    this.isProcessing = false;
  }

  init() {
    if (this.process) return;

    this.process = spawn('xdotool', ['-']);

    // Handle process output
    this.process.stdout.on('data', (data) => {
      const result = data.toString().trim();
      if (this.commandQueue.length > 0) {
        const { resolve } = this.commandQueue.shift();
        resolve(result);
        this.processNextCommand();
      }
    });

    this.process.stderr.on('data', (data) => {
      if (this.commandQueue.length > 0) {
        const { reject } = this.commandQueue.shift();
        reject(new Error(data.toString()));
        this.processNextCommand();
      }
    });

    // Clean up on exit
    process.on('exit', () => {
      if (this.process) {
        this.process.kill();
      }
    });
  }

  async executeCommand(command) {
    return new Promise((resolve, reject) => {
      this.commandQueue.push({ command, resolve, reject });
      if (!this.isProcessing) {
        this.processNextCommand();
      }
    });
  }

  async processNextCommand() {
    if (this.commandQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const { command } = this.commandQueue[0];

    try {
      // Send command through stdin
      this.process.stdin.write(`${command}\n`);
    } catch (error) {
      const { reject } = this.commandQueue.shift();
      reject(error);
      this.processNextCommand();
    }
  }
}

// Singleton instance
const xdotoolManager = new XdotoolManager();

async function getWindowDimensions(windowId) {
  xdotoolManager.init();

  try {
    const output = await xdotoolManager.executeCommand(
      `getwindowgeometry ${windowId}`,
    );
    const dimensions = output.match(/Geometry: (\d+)x(\d+)/);

    if (!dimensions) {
      throw new Error('Failed to parse window dimensions');
    }

    return {
      width: parseInt(dimensions[1]),
      height: parseInt(dimensions[2]),
    };
  } catch (error) {
    console.error('Error:', error);
    return null;
  }
}

export { getWindowDimensions, xdotoolManager };
