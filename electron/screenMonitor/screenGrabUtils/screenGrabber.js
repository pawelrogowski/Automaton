import { spawn } from 'child_process';
class ScreenGrabber {
  constructor(programPath) {
    this.programPath = programPath;
    this.process = null;
    this.callbacks = [];
    this.outputBuffer = [];
    this.errorBuffer = [];
    this.init();
  }

  init() {
    this.process = spawn(this.programPath);

    this.process.stdout.on('data', (data) => {
      this.outputBuffer.push(data);
      this.checkCallbacks();
    });

    this.process.stderr.on('data', (data) => {
      this.errorBuffer.push(data);
    });

    this.process.on('close', (code) => {
      console.error(`C program exited with code ${code}`);
      this.cleanup();
    });

    this.process.on('error', (err) => {
      console.error(`C program error: ${err.message}`);
      this.cleanup();
    });
  }

  cleanup() {
    this.process = null;
    this.callbacks.forEach(({ reject }) => reject(new Error('C program terminated unexpectedly.')));
    this.callbacks = [];
  }

  checkCallbacks() {
    if (this.callbacks.length > 0) {
      const { resolve } = this.callbacks.shift();
      resolve(Buffer.concat(this.outputBuffer));
      this.outputBuffer = [];
    }
  }

  grab(windowId, region) {
    if (!this.process) {
      return Promise.reject(new Error('C program is not running.'));
    }

    const { x = 0, y = 0, width, height } = region;
    if (!width || !height) {
      return Promise.reject(new Error('Region must include width and height.'));
    }

    const command = `${windowId} ${x} ${y} ${width} ${height}\n`;
    return new Promise((resolve, reject) => {
      this.callbacks.push({ resolve, reject });
      this.process.stdin.write(command, (err) => {
        if (err) {
          this.callbacks.pop(); // Remove callback if write fails
          reject(err);
        }
      });
    });
  }

  terminate() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

export default ScreenGrabber;
