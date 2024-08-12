/**
 * Calculates the percentage of matching pixels in an image.
 *
 * @param {Uint32Array} imageData - The pixel data of the image
 * @param {Array<Array<number>>} colors - Array of RGB color arrays to match against
 * @returns {number} The calculated health percentage
 */
function calculatePartyHpPercentage(imageData, colors) {
  if (!(imageData instanceof Uint32Array)) {
    console.error('imageData is not a Uint32Array');
    return -1;
  }

  if (!Array.isArray(colors) || colors.length === 0 || !Array.isArray(colors[0])) {
    console.error('colors is not a valid array of color arrays');
    return -1;
  }

  const colorSet = new Set(colors.map((color) => `${color[0]},${color[1]},${color[2]}`));

  let matchingPixelsCount = 0;
  const totalPixels = imageData.length / 4;

  for (let i = 0; i < imageData.length; i += 4) {
    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];

    const colorString = `${r},${g},${b}`;

    if (colorSet.has(colorString)) {
      matchingPixelsCount++;
    }
  }

  // Adjust calculation to show at least 1% if there's at least one matching pixel
  let percentage = Math.round((matchingPixelsCount / totalPixels) * 100);
  if (matchingPixelsCount > 0 && percentage === 0) {
    percentage = 1; // Ensure minimum 1% if there's at least one matching pixel
  }

  return percentage;
}

export default calculatePartyHpPercentage;
