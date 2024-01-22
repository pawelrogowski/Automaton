async function calculatePercentages(barPosition, combinedRegion, combinedPixels, colors, barWidth) {
  let matchingPixelsCount = 0;

  for (let { x } = barPosition; x < barPosition.x + barWidth; x += 1) {
    const index =
      ((barPosition.y - combinedRegion.y) * combinedRegion.width + (x - combinedRegion.x)) * 4;
    const b = combinedPixels[index];
    const g = combinedPixels[index + 1];
    const r = combinedPixels[index + 2];

    // Convert the BGR values to a string to compare with the colors array
    const colorString = `${r},${g},${b}`;

    // Check if the colorString is included in the colors array
    if (colors.some((color) => color.join(',') === colorString)) {
      matchingPixelsCount += 1;
    }
  }
  const percentage = Math.floor((matchingPixelsCount / barWidth) * 100);

  return { percentage };
}

export default calculatePercentages;
