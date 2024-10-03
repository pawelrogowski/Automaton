/**
 * Calculates the percentage of matching pixels in a party member's HP bar.
 *
 * @param {Uint32Array} imageData - The pixel data of the image
 * @param {Array<Array<number>>} colors - Array of RGB color arrays to match against
 * @param {number} startIndex - The starting index in the imageData array
 * @param {number} barWidth - The width of the bar to analyze (130 pixels)
 * @returns {number} The calculated health percentage
 */
function calculatePartyHpPercentage(imageData, colors, startIndex, barWidth) {
  if (!(imageData instanceof Uint32Array)) {
    console.error('imageData is not a Uint32Array');
    return -1;
  }

  if (!Array.isArray(colors) || colors.length === 0 || !Array.isArray(colors[0])) {
    console.error('colors is not a valid array of color arrays');
    return -1;
  }

  // Create a Set of color strings for faster lookup
  const colorSet = new Set(colors.map((color) => color.join(',')));

  // console.log('Color set:', Array.from(colorSet));

  let matchingPixelsCount = 0;
  const endIndex = startIndex + barWidth * 4;

  // Log the first 3 pixels
  // console.log('First 3 pixels:');
  // for (let i = startIndex; i < startIndex + 12; i += 4) {
  //   const b = imageData[i];
  //   const g = imageData[i + 1];
  //   const r = imageData[i + 2];
  //   console.log(`Pixel ${(i - startIndex) / 4}: R:${r}, G:${g}, B:${b}`);
  // }

  for (let i = startIndex; i < endIndex; i += 4) {
    const b = imageData[i];
    const g = imageData[i + 1];
    const r = imageData[i + 2];

    const colorString = `${r},${g},${b}`;

    if (colorSet.has(colorString)) {
      matchingPixelsCount++;
    }
  }

  const percentage = Math.round((matchingPixelsCount / barWidth) * 100);

  // console.log('Total pixels checked:', barWidth);
  // console.log('Matching pixels:', matchingPixelsCount);
  // console.log('Calculated percentage:', percentage);

  return percentage;
}

export default calculatePartyHpPercentage;
