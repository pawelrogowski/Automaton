import createX11Client from './createX11Client.js';

/**
 * Grabs the screen content of a specific window.
 *
 * @param {number} windowId - The ID of the window to grab the screen content from.
 * @param {Object} [region] - The region of the screen to grab. If not provided, the entire window will be grabbed.
 * @param {Boolean} measureTime - Show a console.time measurement of the function
 * @returns {Promise<Uint8Array>} A promise that resolves with the screen content as a Uint8Array.
 */
async function grabScreen(windowId, region, measureTime) {
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
    const image = await getImageFromWindow(X, windowId, captureRegion, region);

    return image;
  } catch (error) {
    console.error('Error:', error);
    throw error;
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
            console.log('Window is minimized, waiting for it to be maximized...');
            setTimeout(() => {
              getImageFromWindow(X, windowId, region, windowId, region).then(resolve).catch(reject);
            }, 25);
          } else {
            console.log('error GrabScreen Callback');
            reject(new Error(`X.GetImage failed: ${error.message}`));
          }
        } else if (!image) {
          console.log('Image is undefined');
          resolve([]);
        } else {
          resolve(new Uint8Array(image.data));
        }
      },
    );
  });
}

export default grabScreen;
