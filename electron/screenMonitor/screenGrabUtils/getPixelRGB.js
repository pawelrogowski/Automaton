/**
 * Gets the RGB values of a pixel at a specified location in an image.
 *
 * @param {Uint8Array} imageData - The image data, as a flat array of pixel values.
 * @param {number} x - The x-coordinate of the pixel.
 * @param {number} y - The y-coordinate of the pixel.
 * @param {number} width - The width of the image, in pixels.
 *
 * @returns {number[]} An array containing the red, green, and blue values of the pixel.
 *
 * @throws Will log a warning and return the RGB values of the first pixel if the coordinates are out of bounds.
 */
const getPixelRGB = (imageData, x, y, width) => {
  if (x < 0 || y < 0 || x >= width || y >= imageData.length / (width * 4)) {
    console.warn('Coordinates are out of bounds. Returning RGB values of the first pixel.');
    return getPixelRGB(imageData, 0, 0, width);
  }

  const index = (y * width + x) * 4;
  const b = imageData[index];
  const g = imageData[index + 1];
  const r = imageData[index + 2];
  return [r, g, b];
};

export default getPixelRGB;
