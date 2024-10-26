import createX11Client from './createX11Client.js';

/**
 * Grabs the RGB screen content of a specific window and saves it to a raw file with dimensions.
 *
 * @param {number} windowId - The ID of the window to grab the screen content from.
 * @param {Object} [region] - The region of the screen to grab. If not provided, the entire window will be grabbed.
 * @returns {Promise<Buffer>} A promise that resolves with the RGB screen content as a Buffer, including dimensions.
 */
async function grabScreen(windowId, region) {
  try {
    const { X } = await createX11Client();
    const geom = await new Promise((resolve, reject) => {
      X.GetGeometry(windowId, (_, geom) => {
        resolve(geom);
      });
    });
    const captureRegion = region || geom;
    const imageData = await getImageFromWindow(X, windowId, captureRegion, region);

    // Prepare buffer with dimensions
    const dimensionsBuffer = Buffer.alloc(8);
    dimensionsBuffer.writeUInt32LE(captureRegion.width, 0);
    dimensionsBuffer.writeUInt32LE(captureRegion.height, 4);

    // Combine dimensions and image data
    const fullData = Buffer.concat([dimensionsBuffer, imageData]);
    return fullData;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

function packColor(r, g, b) {
  return (r << 16) | (g << 8) | b;
}

async function getImageFromWindow(X, windowId, captureRegion, region) {
  return new Promise((resolve, reject) => {
    X.GetImage(
      2, // ZPixmap format
      windowId,
      captureRegion.x,
      captureRegion.y,
      captureRegion.width,
      captureRegion.height,
      0xffffff, // RGB mask (no alpha)
      (error, image) => {
        if (error) {
          if (error.message.includes('Bad match')) {
            setTimeout(() => {
              getImageFromWindow(X, windowId, region, windowId, region).then(resolve).catch(reject);
            }, 25);
          } else {
            reject(new Error(`X.GetImage failed: ${error.message}`));
          }
        } else if (!image) {
          resolve(Buffer.alloc(0));
        } else {
          // Convert BGRA to RGB using packColor
          const rgbData = Buffer.alloc((image.data.length * 3) / 4);
          for (let i = 0, j = 0; i < image.data.length; i += 4, j += 3) {
            const packedColor = packColor(image.data[i + 2], image.data[i + 1], image.data[i]);
            rgbData.writeUInt8(packedColor >> 16, j);
            rgbData.writeUInt8((packedColor >> 8) & 0xff, j + 1);
            rgbData.writeUInt8(packedColor & 0xff, j + 2);
          }
          resolve(rgbData);
        }
      },
    );
  });
}

export { grabScreen };
