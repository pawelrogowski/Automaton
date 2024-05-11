import packColors from './packColors.js'; // Assuming packColors is in a separate file

/**
 * Limits the image data to a specified rectangular area.
 * @param {Uint8ClampedArray} imageData - The image data to limit.
 * @param {Object} startCoordinates - The starting coordinates of the area { x, y }.
 * @param {Object} dimensions - The dimensions of the area { width, height }.
 * @param {number} imageWidth - The width of the original image.
 * @returns {Uint8ClampedArray} The limited image data.
 */
function cropImageData(imageData, startCoordinates, dimensions, imageWidth) {
  const { x: startX, y: startY } = startCoordinates;
  const { width, height } = dimensions;

  // Pack the original image data into a more compact format.
  const packedImageData = packColors(imageData);

  // Calculate the total number of pixels in the limited area.
  const limitedWidth = width;
  const limitedHeight = height === Infinity ? imageWidth / limitedWidth : height;
  const limitedPixels = limitedWidth * limitedHeight;

  // Create a new Uint8ClampedArray to hold the limited image data.
  const limitedImageData = new Uint8ClampedArray(limitedPixels * 4);

  // Iterate over the specified area and copy pixel data to the limited image data.
  let limitedIndex = 0;
  for (let y = startY; y < startY + (height === Infinity ? limitedHeight : height); y++) {
    for (let x = startX; x < startX + width; x++) {
      const originalIndex = y * imageWidth + x;

      // Check if the pixel is within the image bounds.
      if (originalIndex < packedImageData.length) {
        const packedColor = packedImageData[originalIndex];
        limitedImageData[limitedIndex] = packedColor & 0xff; // Blue
        limitedImageData[limitedIndex + 1] = (packedColor >> 8) & 0xff; // Green
        limitedImageData[limitedIndex + 2] = (packedColor >> 16) & 0xff; // Red
        limitedImageData[limitedIndex + 3] = 0xff; // Alpha (fully opaque)
      }

      limitedIndex += 4;
    }
  }

  return limitedImageData;
}
export default cropImageData;
