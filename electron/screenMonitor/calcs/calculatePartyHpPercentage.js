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
  // Extract dimensions from the buffer
  const bufferWidth = imageData.readUInt32LE(0);
  const bufferHeight = imageData.readUInt32LE(4);
  const rgbDataStart = 8; // RGB data starts after width and height (8 bytes)

  // Create a Set of color strings for faster lookup
  const colorSet = new Set(colors.map((color) => color.join(',')));

  let matchingPixelsCount = 0;
  const endIndex = startIndex + barWidth * 3;

  for (let i = startIndex; i < endIndex; i += 3) {
    const r = imageData[rgbDataStart + i];
    const g = imageData[rgbDataStart + i + 1];
    const b = imageData[rgbDataStart + i + 2];

    // Use the Set for faster color matching
    if (colorSet.has(`${r},${g},${b}`)) {
      matchingPixelsCount++;
    }
  }

  const percentage = Math.round((matchingPixelsCount / barWidth) * 100);

  return percentage;
}

export default calculatePartyHpPercentage;
