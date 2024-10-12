/**
 * Calculates the percentage of matching pixels in a bar region of an image.
 *
 * @param {Object} barPosition - The position of the bar {x, y}
 * @param {Object} combinedRegion - The region of the combined image {x, y, width, height}
 * @param {Buffer} imageData - The Buffer containing image data (including dimensions)
 * @param {Array<Array<number>>} colors - Array of RGB color arrays to match against
 * @param {number} barWidth - The width of the bar to analyze
 * @returns {number} The calculated percentage
 */
function calculatePercentages(barPosition, combinedRegion, imageData, colors) {
  // Extract dimensions from the buffer
  const barWidth = imageData.readUInt32LE(0);
  const rgbData = imageData.subarray(8);

  // Create a Set of color strings for faster lookup
  const colorSet = new Set(colors.map((color) => color.join(',')));

  let matchingPixelsCount = 0;
  const startIndex =
    ((barPosition.y - combinedRegion.y) * combinedRegion.width +
      (barPosition.x - combinedRegion.x)) *
    3;
  const endIndex = startIndex + barWidth * 3;

  for (let i = startIndex; i < endIndex; i += 3) {
    const r = rgbData[i];
    const g = rgbData[i + 1];
    const b = rgbData[i + 2];

    // Use the Set for faster color matching
    if (colorSet.has(`${r},${g},${b}`)) {
      matchingPixelsCount++;
    }
  }

  const percentage = Math.round((matchingPixelsCount / barWidth) * 100);

  return percentage;
}

export default calculatePercentages;
