import createX11Client from './createX11Client.js';
import findWindowById from './findWindowById.js';

/**
 * Grabs the screen content of a specific window.
 *
 * @param {number} windowId - The ID of the window to grab the screen content from.
 * @param {Object} [region] - The region of the screen to grab. If not provided, the entire window will be grabbed.
 * @param {Boolean} measureTime - Show a condole.time measurment of the function
 * @returns {Promise<Uint8Array>} A promise that resolves with the screen content as a Uint8Array.
 */
async function grabScreen(windowId, region, measureTime) {
  try {
    if (measureTime) {
      console.time('grabScreen');
    }

    const { X } = await createX11Client();

    return new Promise((resolve, reject) => {
      findWindowById(X, windowId, windowId, async (foundWindowId) => {
        try {
          X.GetGeometry(foundWindowId, (err, geom) => {
            if (err) {
              reject(err);
              return;
            }

            const captureRegion = region || geom;

            X.GetImage(
              2,
              foundWindowId,
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
                      grabScreen(windowId, region).then(resolve).catch(reject);
                    }, 250);
                  } else {
                    console.log('error GrabScreen Callback');
                    reject(new Error(`X.GetImage failed: ${error.message}`));
                    return;
                  }
                }

                if (!image) {
                  console.log('Image is undefined');
                  setTimeout(() => {
                    resolve([]);
                  }, 1);
                  return;
                }
                setTimeout(() => {
                  resolve(image.data);
                }, 1);
              },
            );
          });
          if (measureTime) {
            console.timeEnd('grabScreen');
          }
        } catch (error) {
          console.error('error grabScreen:', error);
          setTimeout(() => {
            grabScreen(windowId, region).then(resolve).catch(reject);
          }, 250);
        }
      });
    });
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

export default grabScreen;

// (async () => {
//   try {
//     console.time('timer');
//     const windowId = 109051930;
//     const imageData = await grabScreen(windowId);
//     console.log('ImageData length:', imageData.length, '# of pixels:', imageData.length / 4);

//     const targetColors = {
//       healthBar: [
//         [120, 61, 64],
//         [211, 79, 79],
//       ],
//       manaBar: [
//         [61, 61, 125],
//         [82, 79, 211],
//       ],
//       cooldownBar: [
//         [109, 109, 110],
//         [65, 18, 2],
//         [49, 14, 4],
//       ],
//     };

//     const width = 1920; // Assuming the width of your image is 1920
//     const regionStart = await findSequencesInImageData(imageData, targetColors, width);
//     console.log('found region', regionStart);
//   } catch (err) {
//     console.error('Error:', err);
//   }
// })();
