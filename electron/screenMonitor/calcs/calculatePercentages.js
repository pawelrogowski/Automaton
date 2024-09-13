/**
 * Calculates the percentage of matching pixels in a bar region of an image.
 *
 * @param {Object} barPosition - The position of the bar {x, y}
 * @param {Object} combinedRegion - The region of the combined image {x, y, width}
 * @param {Uint32Array} combinedPixels - The pixel data of the combined image
 * @param {Array<Array<number>>} colors - Array of RGB color arrays to match against
 * @param {number} barWidth - The width of the bar to analyze
 * @returns {Object} An object containing the calculated percentage
 */
async function calculatePercentages(barPosition, combinedRegion, combinedPixels, colors, barWidth) {
  // Create a Set of color strings for faster lookup
  const colorSet = new Set(colors.map((color) => color.join(',')));

  let matchingPixelsCount = 0;
  const startIndex =
    ((barPosition.y - combinedRegion.y) * combinedRegion.width +
      (barPosition.x - combinedRegion.x)) *
    4;
  const endIndex = startIndex + barWidth * 4;

  for (let i = startIndex; i < endIndex; i += 4) {
    const r = combinedPixels[i + 2];
    const g = combinedPixels[i + 1];
    const b = combinedPixels[i];

    // Use the Set for faster color matching
    if (colorSet.has(`${r},${g},${b}`)) {
      matchingPixelsCount++;
    }
  }

  const percentage = Math.round((matchingPixelsCount / barWidth) * 100);

  return percentage;
}

export default calculatePercentages;
