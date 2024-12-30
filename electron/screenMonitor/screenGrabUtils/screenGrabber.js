import { spawn } from 'child_process';

class ScreenGrabber {
  constructor(programPath) {
    this.programPath = programPath;
    this.process = null;
    this.callbacks = [];
    this.currentBuffer = Buffer.alloc(0);
    this.init();
  }

  init() {
    this.process = spawn(this.programPath);

    const DELIMITER = 0xdeadbeef;

    this.process.stdout.on('data', (data) => {
      this.currentBuffer = Buffer.concat([this.currentBuffer, data]);

      while (this.currentBuffer.length > 0) {
        if (this.currentBuffer.length < 4) {
          console.log('ScreenGrabber: Insufficient data for delimiter.');
          break;
        }

        const startDelimiter = this.currentBuffer.readUInt32LE(0);
        if (startDelimiter !== DELIMITER) {
          console.error('ScreenGrabber: Invalid start delimiter. Discarding.');
          this.currentBuffer = this.currentBuffer.subarray(4);
          continue;
        }

        if (this.currentBuffer.length < 12) {
          console.log('ScreenGrabber: Insufficient data for frame header.');
          break;
        }

        const width = this.currentBuffer.readInt32LE(4);
        const height = this.currentBuffer.readInt32LE(8);
        const frameSize = width * height * 3;

        if (width <= 0 || height <= 0) {
          console.error('ScreenGrabber: Invalid frame dimensions. Discarding.');
          this.currentBuffer = this.currentBuffer.subarray(4);
          continue;
        }

        const totalFrameSize = 12 + frameSize + 4;
        if (this.currentBuffer.length < totalFrameSize) {
          break;
        }

        const endDelimiter = this.currentBuffer.readUInt32LE(12 + frameSize);
        if (endDelimiter !== DELIMITER) {
          console.error('ScreenGrabber: Invalid end delimiter. Discarding frame.');
          this.currentBuffer = this.currentBuffer.subarray(4);
          continue;
        }

        const rgbData = this.currentBuffer.subarray(12, 12 + frameSize);
        console.log(
          `ScreenGrabber: Frame received. Dimensions: ${width}x${height}, RGB data length: ${rgbData.length}`,
        );

        if (this.callbacks.length > 0) {
          const { resolve, timeout } = this.callbacks.shift();
          clearTimeout(timeout);
          resolve({ width, height, rgbData });
        } else {
          console.warn('ScreenGrabber: No callback registered. Discarding frame.');
        }

        this.currentBuffer = this.currentBuffer.subarray(totalFrameSize);
      }
    });

    this.process.stderr.on('data', (data) => {
      console.error(`C program: ${data.toString()}`);
    });

    this.process.on('close', (code) => {
      console.error(`C program exited with code ${code}`);
      this.cleanup();
    });
  }

  grab(windowId, region) {
    if (!this.process) {
      return Promise.reject(new Error('C program is not running'));
    }

    const { x = 0, y = 0, width, height } = region;
    if (!width || !height) {
      return Promise.reject(new Error('Region must include width and height'));
    }

    const startTime = performance.now();
    const command = `${windowId} ${x} ${y} ${width} ${height}\n`;

    return new Promise((resolve, reject) => {
      const timedResolve = ({ width, height, rgbData }) => {
        const duration = performance.now() - startTime;
        console.log(`Total grab time: ${duration.toFixed(2)}ms`);

        // Construct a Buffer including the width, height, and RGB data
        const headerBuffer = Buffer.alloc(8); // 4 bytes for width, 4 bytes for height
        headerBuffer.writeUInt32LE(width, 0);
        headerBuffer.writeUInt32LE(height, 4);

        const finalBuffer = Buffer.concat([headerBuffer, rgbData]);
        resolve(finalBuffer); // Return the Buffer
      };

      const timeout = setTimeout(() => {
        reject(new Error('Screen grab timed out'));
      }, 5000); // Timeout after 5 seconds

      this.callbacks.push({ resolve: timedResolve, reject, timeout });
      this.process.stdin.write(command);
    });
  }

  cleanup() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    this.callbacks.forEach(({ reject }) => reject(new Error('Screen grabber terminated')));
    this.callbacks = [];
  }
}

export default ScreenGrabber;
