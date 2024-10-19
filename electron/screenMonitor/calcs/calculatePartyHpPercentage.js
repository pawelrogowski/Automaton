/**
 * Calculates the percentage of matching pixels in a party member's HP bar.
 *
 * @param {Buffer} imageData - The Buffer containing image data (including dimensions)
 * @param {Array<Array<number>>} colors - Array of RGB color arrays to match against
 * @param {number} startIndex - The starting index of the bar in the image data
 * @param {number} barWidth - The width of the bar to analyze
 * @returns {number} The calculated HP percentage
 */
function calculatePartyHpPercentage(imageData, colors, startIndex, barWidth) {
  try {
    const rgbDataStart = 8;
    const colorSet = new Set(colors.map((color) => color.join(',')));

    let matchingPixelsCount = 0;
    const endIndex = startIndex + barWidth * 3;

    for (let i = startIndex; i < endIndex; i += 3) {
      const r = imageData[rgbDataStart + i];
      const g = imageData[rgbDataStart + i + 1];
      const b = imageData[rgbDataStart + i + 2];

      if (colorSet.has(`${r},${g},${b}`)) {
        matchingPixelsCount++;
      }
    }

    const percentage = Math.round((matchingPixelsCount / barWidth) * 100);

    return percentage;
  } catch (error) {
    console.log('Error in party hp calculator:', error);
  }
}

export default calculatePartyHpPercentage;
