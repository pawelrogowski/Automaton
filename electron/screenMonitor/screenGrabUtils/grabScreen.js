import createX11Client from './createX11Client.js';

/**
 * Grabs the RGB screen content of a specific window and saves it to a raw file with dimensions.
 *
 * @param {number} windowId - The ID of the window to grab the screen content from.
 * @param {Object} [region] - The region of the screen to grab. If not provided, the entire window will be grabbed.
 * @returns {Promise<Buffer>} A promise that resolves with the RGB screen content as a Buffer, including dimensions.
 */
async function grabScreen(windowId, region) {
  let fullData = null;
  const metrics = {
    startTime: performance.now(),
    getGeometryTime: 0,
    captureTime: 0,
    processingTime: 0,
    totalTime: 0,
    width: 0,
    height: 0,
  };

  try {
    const { X } = await createX11Client();

    // Check if window exists
    const windowExists = await checkWindowExists(X, windowId);
    if (!windowExists) {
      throw new Error('Window does not exist');
    }

    const geom = await new Promise((resolve, reject) => {
      X.GetGeometry(windowId, (_, geom) => {
        resolve(geom);
      });
    });

    const captureRegion = region || geom;
    metrics.width = captureRegion.width;
    metrics.height = captureRegion.height;

    // Measure image capture time
    const captureStartTime = performance.now();
    const imageData = await getImageFromWindow(X, windowId, captureRegion, region);
    metrics.captureTime = performance.now() - captureStartTime;

    // Measure processing time
    const processStartTime = performance.now();

    // Pre-calculate total size needed
    const totalSize = 8 + imageData.length;

    // Pre-allocate the final buffer instead of using concat
    fullData = Buffer.allocUnsafe(totalSize);

    // Write dimensions directly to the final buffer
    fullData.writeUInt32LE(captureRegion.width, 0);
    fullData.writeUInt32LE(captureRegion.height, 4);

    // Copy image data directly to the final buffer
    imageData.copy(fullData, 8);

    metrics.processingTime = performance.now() - processStartTime;
    metrics.totalTime = performance.now() - metrics.startTime;

    // Log performance metrics
    const area = metrics.width * metrics.height;
    const timePerPixel = metrics.totalTime / area;

    // console.table({
    //   'Capture Area': {
    //     Width: metrics.width,
    //     Height: metrics.height,
    //     'Total Pixels': area.toLocaleString(),
    //   },
    //   'Timing (ms)': {
    //     'Image Capture': metrics.captureTime.toFixed(2),
    //     'Total Time': metrics.totalTime.toFixed(2),
    //     'Time per Pixel (μs)': (timePerPixel * 1000).toFixed(4),
    //   },
    // });

    return fullData;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    fullData = null;
  }
}

/**
 * Checks if a window exists by attempting to query its attributes
 * @param {Object} X - X11 client instance
 * @param {number} windowId - Window ID to check
 * @returns {Promise<boolean>} - True if window exists, false otherwise
 */
async function checkWindowExists(X, windowId) {
  return new Promise((resolve) => {
    X.GetWindowAttributes(windowId, (err) => {
      resolve(!err);
    });
  });
}

async function getImageFromWindow(X, windowId, captureRegion, region) {
  let retryCount = 0;
  const MAX_RETRIES = 10;

  const tryGetImage = async () => {
    try {
      // Check if window still exists before attempting capture
      const windowExists = await checkWindowExists(X, windowId);
      if (!windowExists) {
        throw new Error('Window no longer exists');
      }

      const image = await new Promise((resolve, reject) => {
        X.GetImage(
          2, // ZPixmap format
          windowId,
          captureRegion.x,
          captureRegion.y,
          captureRegion.width,
          captureRegion.height,
          0xffffff, // RGB mask (no alpha)
          (error, img) => {
            if (error) {
              reject(error);
            } else {
              resolve(img);
            }
          },
        );
      });

      if (!image || image.data.length === 0) {
        return Buffer.alloc(0);
      }

      // Pre-allocate RGB buffer with unsafe allocation for better performance
      const rgbData = Buffer.allocUnsafe((image.data.length * 3) / 4);

      // Direct buffer manipulation for better performance
      for (let i = 0, j = 0; i < image.data.length; i += 4, j += 3) {
        rgbData[j] = image.data[i + 2]; // R
        rgbData[j + 1] = image.data[i + 1]; // G
        rgbData[j + 2] = image.data[i]; // B
      }

      return rgbData;
    } catch (error) {
      if (error.message.includes('Bad match') && retryCount < MAX_RETRIES) {
        retryCount++;
        console.log(`Retry attempt ${retryCount} of ${MAX_RETRIES}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        return tryGetImage();
      }
      throw new Error(`getImageFromWindow failed after ${retryCount} retries: ${error.message}`);
    }
  };

  return tryGetImage();
}

export { grabScreen };
