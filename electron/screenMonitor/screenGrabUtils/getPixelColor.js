import getPixelRGB from './getPixelRGB.js';
import grabScreen from './grabScreen.js';

/**
 * Retrieves the RGB or hex color value of a pixel at a specific (x, y) coordinate within a window.
 *
 * @param {number} windowId - The ID of the window to retrieve the pixel color from.
 * @param {number} x - The x-coordinate of the pixel.
 * @param {number} y - The y-coordinate of the pixel.
 * @param {boolean} returnHex - Whether to return the color value as a hex string (true) or as an RGB array (false).
 * @returns {Promise<string | number[]>} A promise that resolves with the color value as either a hex string or an RGB array.
 */
async function getPixelColor(windowId, x, y, returnHex) {
  try {
    const imageData = await grabScreen(windowId);

    const rgbValues = getPixelRGB(imageData, x, y, imageData.width);
    if (returnHex) {
      return `#${rgbValues.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    }
    return rgbValues;
  } catch (error) {
    console.error('getPixelColor error::', error);
    throw error;
  }
}

export default getPixelColor;
