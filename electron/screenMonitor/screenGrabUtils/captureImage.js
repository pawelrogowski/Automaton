export const captureImage = (windowId, options, captureInstance) => {
  return new Promise(async (resolve, reject) => {
    const { x, y, width, height } = options;
    const MAX_RETRIES = 0;
    const RETRY_DELAY = 50; // ms between retries
    const RECONNECT_DELAY = 100; // ms after reconnection

    // Input validation
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(width) || !Number.isInteger(height)) {
      reject(new Error('Invalid coordinate or dimension'));
      return;
    }

    // Calculate buffer size once
    const bufferSize = width * height * 3 + 8;
    let buffer = Buffer.allocUnsafe(bufferSize);

    const validateBuffer = (buf) => {
      if (!buf || buf.length !== bufferSize) return false;

      try {
        const bufferWidth = buf.readInt32LE(0);
        const bufferHeight = buf.readInt32LE(4);
        return bufferWidth === width && bufferHeight === height && !buf.slice(8).every((byte) => byte === 0);
      } catch (error) {
        console.error('Buffer validation error:', error);
        return false;
      }
    };

    const captureWithRetry = async (retryCount = 0) => {
      try {
        // Clear the buffer before each capture attempt
        buffer = Buffer.allocUnsafe(bufferSize);

        captureInstance.getImageData(windowId, x, y, width, height, buffer);

        if (!validateBuffer(buffer)) {
          throw new Error('Invalid buffer data');
        }

        return buffer;
      } catch (error) {
        if (retryCount >= MAX_RETRIES) {
          throw new Error(`Max retries (${MAX_RETRIES}) exceeded: ${error.message}`);
        }

        console.log(`Capture attempt ${retryCount + 1} failed, reconnecting...`);

        try {
          // Force a reconnection
          await new Promise((resolve) => {
            captureInstance.reconnect();
            setTimeout(resolve, RECONNECT_DELAY);
          });
        } catch (reconnectError) {
          console.error('Reconnection failed:', reconnectError);
        }

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));

        // Recursive retry with incremented counter
        return captureWithRetry(retryCount + 1);
      }
    };

    try {
      const result = await captureWithRetry();
      resolve(result);
    } catch (finalError) {
      console.error('Final capture error:', finalError);
      reject(finalError);
    }
  });
};
