let reusableBuffer;
export const captureImage = (windowId, options, captureInstance) => {
  return new Promise((resolve, reject) => {
    const { x, y, width, height } = options;

    // Calculate buffer size once
    const bufferSize = width * height * 3 + 8;
    const reusableBuffer = Buffer.allocUnsafe(bufferSize);

    try {
      captureInstance.getImageData(windowId, x, y, width, height, reusableBuffer);

      resolve(reusableBuffer);
    } catch (error) {
      console.error('Capture error:', error);
      reject(error);
    }
  });
};
