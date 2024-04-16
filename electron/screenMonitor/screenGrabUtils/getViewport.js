import createX11Client from './createX11Client.js';

/**
 * Retrieves the width and height of a specific window.
 *
 * @param {number} windowId - The ID of the window to get the dimensions from.
 * @returns {Promise<{width: number, height: number}>} A promise that resolves with the window's width and height.
 */
async function getViewport(windowId) {
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

    return { width: geom.width, height: geom.height };
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

export default getViewport;
