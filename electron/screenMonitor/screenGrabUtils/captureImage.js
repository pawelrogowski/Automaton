export const captureImage = (windowId, options, captureInstance) => {
  const { x, y, width, height } = options;

  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error('Invalid coordinate or dimension');
  }

  const bufferSize = width * height * 3 + 8;
  const buffer = Buffer.allocUnsafe(bufferSize);

  try {
    captureInstance.getImageData(windowId, x, y, width, height, buffer);
    return buffer;
  } catch (error) {
    console.error('Capture error:', error);
    throw error;
  }
};
