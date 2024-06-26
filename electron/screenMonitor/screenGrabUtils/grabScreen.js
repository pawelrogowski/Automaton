import createX11Client from './createX11Client.js';

/**
 * Grabs the screen content of a specific window.
 *
 * @param {number} windowId - The ID of the window to grab the screen content from.
 * @param {Object} [region] - The region of the screen to grab. If not provided, the entire window will be grabbed.
 * @param {Boolean} measureTime - Show a console.time measurement of the function
 * @returns {Promise<Uint32Array>} A promise that resolves with the screen content as a Uint32Array.
 */
async function grabScreen(windowId, region, measureTime) {
  let imageData = null; // Initialize imageData to null

  try {
    const { X } = await createX11Client();
    const geom = await new Promise((resolve, reject) => {
      X.GetGeometry(windowId, (err, geom) => {
        if (err) {
          reject(err);
        } else {
          resolve(geom);
        }
      });
    });
    const captureRegion = region || geom;
    imageData = await getImageFromWindow(X, windowId, captureRegion, region);
    return imageData;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    // Clear imageData after use
    imageData = null;
  }
}

async function getImageFromWindow(X, windowId, captureRegion, region) {
  return new Promise((resolve, reject) => {
    X.GetImage(
      2,
      windowId,
      captureRegion.x,
      captureRegion.y,
      captureRegion.width,
      captureRegion.height,
      0xffffff,
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
          resolve([]);
        } else {
          const imageDataArray = new Uint32Array(image.data);
          resolve(imageDataArray);
        }
      },
    );
  });
}

export default grabScreen;
